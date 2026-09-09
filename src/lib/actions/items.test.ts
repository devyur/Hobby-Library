import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for quickAddItemAction (issue #15), focused on the one
// path e2e coverage (e2e/quick-add.spec.ts) can't safely exercise against
// the live project: what happens when a category's predefined "Other"
// subtype is missing. Reproducing that live would mean deleting/restoring
// seeded reference data that this project's own migrations only grant
// `select` on (no insert/update/delete grant to any API role) -- not
// something a disposable e2e run should be mutating. Mocking the Supabase
// client here tests the same server-side branch in items.ts directly, with
// zero live-data risk.
//
// Same createClient/redirect mocking shape as
// components/nav/LastScreenTracker.test.tsx uses for next/navigation.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirectMock(...args),
}));

const { quickAddItemAction, updateItemAction } = await import("./items");
const { initialItemFormState } = await import("@/lib/validation/items");

type FakeRow = Record<string, unknown> | null;

function fakeSupabase(options: {
  user?: { id: string } | null;
  category?: FakeRow;
  otherSubtype?: FakeRow;
  insertResult?: { data: { id: string } | null; error: { message: string } | null };
}) {
  const fromMock = vi.fn((table: string) => {
    if (table === "categories") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.category ?? null }) }) }) };
    }
    if (table === "subtypes") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: options.otherSubtype ?? null }) }),
            }),
          }),
        }),
      };
    }
    if (table === "items") {
      return {
        insert: () => ({
          select: () => ({
            single: async () =>
              options.insertResult ?? { data: null, error: { message: "insert should not be called" } },
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
  };
}

function formDataFor(title: string, categoryId: string) {
  const formData = new FormData();
  formData.set("title", title);
  formData.set("categoryId", categoryId);
  return formData;
}

describe("quickAddItemAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    redirectMock.mockClear();
  });

  it("fails cleanly (a formError, no thrown 500) when the category's predefined 'Other' subtype doesn't exist -- and never attempts the insert", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: "cat-1", slug: "audio" },
      otherSubtype: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await quickAddItemAction(
      initialItemFormState,
      formDataFor("Should Not Be Created", "11111111-1111-4111-8111-111111111111"),
    );

    expect(result.formError).toMatch(/doesn't have a default subtype/i);
    expect(result.fieldErrors).toEqual({});
    expect(supabase.from).not.toHaveBeenCalledWith("items");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("resolves the category's 'Other' subtype server-side, inserts status='planned', and redirects to the category library view", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      category: { id: "cat-1", slug: "audio" },
      otherSubtype: { id: "other-subtype-1" },
      insertResult: { data: { id: "item-1" }, error: null },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      quickAddItemAction(
        initialItemFormState,
        formDataFor("Quick Added Thing", "11111111-1111-4111-8111-111111111111"),
      ),
    ).rejects.toThrow("REDIRECT:/audio");

    expect(redirectMock).toHaveBeenCalledWith("/audio");
  });

  it("rejects a client-supplied categoryId that doesn't match a real category, without touching subtypes/items", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, category: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await quickAddItemAction(
      initialItemFormState,
      formDataFor("Some Title", "11111111-1111-4111-8111-111111111111"),
    );

    expect(result.fieldErrors.categoryId).toMatch(/does not exist/i);
    expect(supabase.from).not.toHaveBeenCalledWith("subtypes");
    expect(supabase.from).not.toHaveBeenCalledWith("items");
  });

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await quickAddItemAction(
      initialItemFormState,
      formDataFor("Some Title", "11111111-1111-4111-8111-111111111111"),
    );

    expect(result.formError).toMatch(/signed in/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects an empty title / missing category client-side-equivalent input before ever calling createClient", async () => {
    const result = await quickAddItemAction(initialItemFormState, formDataFor("", ""));

    expect(result.fieldErrors.title).toBeDefined();
    expect(result.fieldErrors.categoryId).toBeDefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

// Unit coverage for updateItemAction (issue #16; subtype editing added in
// #18), focused on the things e2e coverage can exercise but not directly
// inspect the call arguments for: (1) the ownership/not-found check never
// distinguishing another user's item from a nonexistent one, (2) the
// explicit-null-vs-omitted-key clearing behavior -- that a cleared rating/
// priority/notes/review is written as an explicit `null` in the update
// payload, never left out of it (which Supabase's `.update()` would
// silently ignore), and (3) the new subtype_id cross-check -- that a
// submitted subtype not belonging to (or not visible within) the item's own
// category is rejected before ever reaching `.update()`.
const VALID_SUBTYPE_ID = "33333333-3333-4333-8333-333333333333";

describe("updateItemAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    redirectMock.mockClear();
  });

  function editFormData(overrides: Record<string, string> = {}) {
    const formData = new FormData();
    formData.set("status", "planned");
    formData.set("subtypeId", VALID_SUBTYPE_ID);
    for (const [key, value] of Object.entries(overrides)) {
      formData.set(key, value);
    }
    return formData;
  }

  function fakeSupabaseForUpdate(options: {
    user?: { id: string } | null;
    item?: FakeRow;
    category?: FakeRow;
    subtype?: FakeRow;
    updateError?: { message: string } | null;
  }) {
    const updateMock = vi.fn((payload: Record<string, unknown>) => {
      void payload;
      return { eq: async () => ({ error: options.updateError ?? null }) };
    });

    const fromMock = vi.fn((table: string) => {
      if (table === "items") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: options.item ?? null }),
                }),
              }),
            }),
          }),
          update: updateMock,
        };
      }
      if (table === "categories") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: options.category ?? null }) }),
          }),
        };
      }
      if (table === "subtypes") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({ maybeSingle: async () => ({ data: options.subtype ?? null }) }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    });

    return {
      from: fromMock,
      updateMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    };
  }

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabaseForUpdate({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateItemAction("item-1", initialItemFormState, editFormData());

    expect(result.formError).toMatch(/signed in/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one -- a plain not-found formError, never a distinguishable RLS/Postgres error", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: null, // .eq("user_id", user.id) excludes another user's row -- same shape as "doesn't exist"
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateItemAction(
      "someone-elses-item",
      initialItemFormState,
      editFormData(),
    );

    expect(result.formError).toMatch(/could not be found/i);
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("writes explicit null (not an omitted key) for a cleared rating, priority, notes, and review", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      subtype: { id: VALID_SUBTYPE_ID },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      updateItemAction(
        "item-1",
        initialItemFormState,
        // Every clearable field submitted empty -- simulating a save that
        // clears a previously-set rating/priority/notes/review.
        editFormData({ status: "ongoing", rating: "", priority: "", notes: "", review: "" }),
      ),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    expect(supabase.updateMock).toHaveBeenCalledTimes(1);
    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload).toEqual({
      status: "ongoing",
      subtype_id: VALID_SUBTYPE_ID,
      rating: null,
      priority: null,
      notes: null,
      review: null,
    });
    // Explicit key presence, not just an equal value -- `{ rating: undefined }`
    // would also satisfy toEqual's rating check but get silently dropped by
    // Supabase's own JSON serialization before ever reaching Postgres.
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(["rating", "priority", "notes", "review"]),
    );
  });

  it("includes the submitted subtype_id but never category_id or completed_at in the update payload, even when status is set to completed", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      subtype: { id: VALID_SUBTYPE_ID },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      updateItemAction(
        "item-1",
        initialItemFormState,
        editFormData({ status: "completed", rating: "9" }),
      ),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload.subtype_id).toBe(VALID_SUBTYPE_ID);
    expect(payload).not.toHaveProperty("category_id");
    expect(payload).not.toHaveProperty("completed_at");
  });

  it("rejects a subtype that doesn't belong to (or isn't visible within) the item's own category, without ever calling update", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      subtype: null, // not found for this category_id/user -- mismatched category or another user's private subtype
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateItemAction("item-1", initialItemFormState, editFormData());

    expect(result.fieldErrors.subtypeId).toMatch(/does not belong to this item's category/i);
    expect(supabase.updateMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("rejects a missing subtype client-side-equivalent input before ever calling createClient", async () => {
    const result = await updateItemAction(
      "item-1",
      initialItemFormState,
      editFormData({ subtypeId: "" }),
    );

    expect(result.fieldErrors.subtypeId).toBeDefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid status client-side-equivalent input before ever calling createClient", async () => {
    const result = await updateItemAction(
      "item-1",
      initialItemFormState,
      editFormData({ status: "" }),
    );

    expect(result.fieldErrors.status).toBeDefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
