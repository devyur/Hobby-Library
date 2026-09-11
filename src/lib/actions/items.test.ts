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

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: [string]) => revalidatePathMock(...args),
}));

const {
  quickAddItemAction,
  updateItemAction,
  deleteItemAction,
  updateNotesAction,
  updateReviewAction,
  markItemCompletedAction,
} = await import("./items");
const { initialItemFormState, initialDeleteItemActionState } = await import(
  "@/lib/validation/items"
);

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
// #18; notes/review removed from this action's payload entirely in #48),
// focused on the things e2e coverage can exercise but not directly inspect
// the call arguments for: (1) the ownership/not-found check never
// distinguishing another user's item from a nonexistent one, (2) the
// explicit-null-vs-omitted-key clearing behavior -- that a cleared rating/
// priority is written as an explicit `null` in the update payload, never
// left out of it (which Supabase's `.update()` would silently ignore), (3)
// the new subtype_id cross-check -- that a submitted subtype not belonging
// to (or not visible within) the item's own category is rejected before
// ever reaching `.update()`, and (4) that notes/review never appear in the
// payload, even for a tampered submission that still sends them.
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

  it("writes explicit null (not an omitted key) for a cleared rating, priority, and completed date", async () => {
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
        // clears a previously-set rating/priority/completedAt.
        editFormData({
          status: "ongoing",
          rating: "",
          priority: "",
          completedAt: "",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    expect(supabase.updateMock).toHaveBeenCalledTimes(1);
    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload).toEqual({
      status: "ongoing",
      subtype_id: VALID_SUBTYPE_ID,
      rating: null,
      priority: null,
      completed_at: null,
    });
    // Explicit key presence, not just an equal value -- `{ rating: undefined }`
    // would also satisfy toEqual's rating check but get silently dropped by
    // Supabase's own JSON serialization before ever reaching Postgres.
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining(["rating", "priority", "completed_at"]),
    );
  });

  // Issue #48: notes/review are no longer part of this form at all -- a
  // main-form save must never write them, even as a byproduct of an
  // unrelated field change, since Notes/Review now save independently
  // (updateNotesAction/updateReviewAction below) and could be clobbered by a
  // stale/absent value from this form otherwise.
  it("never includes notes or review in the update payload, even if a caller tries to submit them", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      subtype: { id: VALID_SUBTYPE_ID },
    });
    createClientMock.mockResolvedValue(supabase);

    const formData = editFormData({ status: "ongoing" });
    // Simulates a tampered/direct submission still carrying notes/review
    // keys -- editItemSchema no longer declares these fields, so they must
    // be silently ignored, not smuggled through into the update payload.
    formData.set("notes", "Should never be written");
    formData.set("review", "Should never be written either");

    await expect(
      updateItemAction("item-1", initialItemFormState, formData),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty("notes");
    expect(payload).not.toHaveProperty("review");
  });

  it("includes the submitted subtype_id but never category_id in the update payload, even when status is set to completed", async () => {
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
  });

  // Issue #34: completed_at is set manually via its own field, never
  // inferred from status -- these mirror the "explicit null, never omitted"
  // and "status alone never touches it" acceptance criteria.
  it("writes completed_at as UTC midnight for the submitted calendar date, regardless of status", async () => {
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
        editFormData({ status: "planned", completedAt: "2024-03-15" }),
      ),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload.completed_at).toBe("2024-03-15T00:00:00.000Z");
    expect(payload.status).toBe("planned");
  });

  it("writes explicit null (not an omitted key) when the completed date field is left empty", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      subtype: { id: VALID_SUBTYPE_ID },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      updateItemAction("item-1", initialItemFormState, editFormData({ completedAt: "" })),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload).toHaveProperty("completed_at");
    expect(payload.completed_at).toBeNull();
  });

  it("rejects a malformed completed date (tampered input) with a field error, never reaching update", async () => {
    const result = await updateItemAction(
      "item-1",
      initialItemFormState,
      editFormData({ completedAt: "not-a-date" }),
    );

    expect(result.fieldErrors.completedAt).toBeDefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a completed date earlier than the add date? -- no, it's explicitly allowed: accepts any well-formed calendar date regardless of createdAt", async () => {
    const supabase = fakeSupabaseForUpdate({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      subtype: { id: VALID_SUBTYPE_ID },
    });
    createClientMock.mockResolvedValue(supabase);

    // A backfilled completion date long before this save -- no cross-field
    // check against created_at exists (issue #34's Out of scope), so this
    // must succeed exactly like any other valid date.
    await expect(
      updateItemAction(
        "item-1",
        initialItemFormState,
        editFormData({ completedAt: "1999-01-01" }),
      ),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    const payload = supabase.updateMock.mock.calls[0][0];
    expect(payload.completed_at).toBe("1999-01-01T00:00:00.000Z");
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

// Unit coverage for deleteItemAction (issue #25's soft delete), focused on
// what e2e coverage (e2e/item-delete.spec.ts) can exercise live but not
// directly inspect: (1) the ownership/not-found check never distinguishing
// another user's item (or an already-deleted one) from a nonexistent one --
// same .eq("user_id", ...).is("deleted_at", null) shape updateItemAction
// itself uses, and (2) that the update payload touches only deleted_at,
// never any other column.
describe("deleteItemAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    redirectMock.mockClear();
  });

  function fakeSupabaseForDelete(options: {
    user?: { id: string } | null;
    item?: FakeRow;
    category?: FakeRow;
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
      throw new Error(`Unexpected table in test: ${table}`);
    });

    return {
      from: fromMock,
      updateMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    };
  }

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabaseForDelete({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteItemAction("item-1", initialDeleteItemActionState, new FormData());

    expect(result.error).toMatch(/signed in/i);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one -- a plain not-found error, update never called", async () => {
    const supabase = fakeSupabaseForDelete({
      user: { id: "user-1" },
      item: null, // .eq("user_id", user.id) excludes another user's row
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteItemAction(
      "someone-elses-item",
      initialDeleteItemActionState,
      new FormData(),
    );

    expect(result.error).toMatch(/could not be found/i);
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("treats an already soft-deleted item the same as a nonexistent one (the .is('deleted_at', null) filter excludes it)", async () => {
    const supabase = fakeSupabaseForDelete({
      user: { id: "user-1" },
      item: null, // already-deleted rows are excluded by the query's own .is("deleted_at", null)
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteItemAction(
      "already-deleted-item",
      initialDeleteItemActionState,
      new FormData(),
    );

    expect(result.error).toMatch(/could not be found/i);
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("sets only deleted_at and redirects to the item's own category library page", async () => {
    const supabase = fakeSupabaseForDelete({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      deleteItemAction("item-1", initialDeleteItemActionState, new FormData()),
    ).rejects.toThrow("REDIRECT:/games");

    expect(supabase.updateMock).toHaveBeenCalledTimes(1);
    const payload = supabase.updateMock.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(["deleted_at"]);
    expect(typeof payload.deleted_at).toBe("string");
  });

  it("a failed update returns a clean error and never redirects", async () => {
    const supabase = fakeSupabaseForDelete({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteItemAction("item-1", initialDeleteItemActionState, new FormData());

    expect(result.error).toMatch(/failed to delete/i);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

// Unit coverage for updateNotesAction/updateReviewAction/
// markItemCompletedAction (issue #48) -- the three new independent Server
// Actions backing NotesReview.tsx's always-interactive editors. Focused on
// what e2e coverage can exercise live but not directly inspect the call
// arguments for: (1) the same ownership/not-found shape every other action
// in this module uses, (2) empty-string-trims-to-null clearing, and (3) the
// Review-triggered nudge's check-after-save computation against a freshly
// read `review`/`status`, not a client-supplied value.
describe("updateNotesAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  function fakeSupabaseForNotes(options: {
    user?: { id: string } | null;
    item?: FakeRow;
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
              eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: options.item ?? null }) }) }),
            }),
          }),
          update: updateMock,
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
    const supabase = fakeSupabaseForNotes({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateNotesAction("item-1", "Some notes");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one", async () => {
    const supabase = fakeSupabaseForNotes({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateNotesAction("someone-elses-item", "Some notes");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("saves a trimmed non-empty value", async () => {
    const supabase = fakeSupabaseForNotes({ user: { id: "user-1" }, item: { id: "item-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateNotesAction("item-1", "  Working notes  ");

    expect(result).toEqual({ notes: "Working notes" });
    expect(supabase.updateMock).toHaveBeenCalledWith({ notes: "Working notes" });
  });

  it("clears to an explicit null for an empty/whitespace-only value, not an empty string", async () => {
    const supabase = fakeSupabaseForNotes({ user: { id: "user-1" }, item: { id: "item-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateNotesAction("item-1", "   ");

    expect(result).toEqual({ notes: null });
    expect(supabase.updateMock).toHaveBeenCalledWith({ notes: null });
  });

  it("returns a clean error when the update fails", async () => {
    const supabase = fakeSupabaseForNotes({
      user: { id: "user-1" },
      item: { id: "item-1" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateNotesAction("item-1", "Notes");

    expect(result).toEqual({ error: expect.stringMatching(/failed to save/i) });
  });
});

describe("updateReviewAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  function fakeSupabaseForReview(options: {
    user?: { id: string } | null;
    item?: (FakeRow & { review?: string | null; status?: string }) | null;
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
              eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: options.item ?? null }) }) }),
            }),
          }),
          update: updateMock,
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
    const supabase = fakeSupabaseForReview({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "Some review");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one", async () => {
    const supabase = fakeSupabaseForReview({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("someone-elses-item", "Some review");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("saves a trimmed value and signals showNudge when the freshly-read current review was empty and status isn't completed", async () => {
    const supabase = fakeSupabaseForReview({
      user: { id: "user-1" },
      item: { id: "item-1", review: null, status: "ongoing" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "  This was great  ");

    expect(result).toEqual({ review: "This was great", showNudge: true });
    expect(supabase.updateMock).toHaveBeenCalledWith({ review: "This was great" });
  });

  it("does not signal showNudge when the current review was already non-empty (re-editing, not newly filled)", async () => {
    const supabase = fakeSupabaseForReview({
      user: { id: "user-1" },
      item: { id: "item-1", review: "An earlier draft", status: "ongoing" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "A revised review");

    expect(result).toEqual({ review: "A revised review", showNudge: false });
  });

  it("does not signal showNudge when the current status is already completed", async () => {
    const supabase = fakeSupabaseForReview({
      user: { id: "user-1" },
      item: { id: "item-1", review: null, status: "completed" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "This was great");

    expect(result).toEqual({ review: "This was great", showNudge: false });
  });

  it("clears to an explicit null for an empty value and never signals showNudge", async () => {
    const supabase = fakeSupabaseForReview({
      user: { id: "user-1" },
      item: { id: "item-1", review: "Something", status: "ongoing" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "   ");

    expect(result).toEqual({ review: null, showNudge: false });
    expect(supabase.updateMock).toHaveBeenCalledWith({ review: null });
  });

  it("still saves (the write is never blocked by the nudge check) even though it also signals showNudge", async () => {
    const supabase = fakeSupabaseForReview({
      user: { id: "user-1" },
      item: { id: "item-1", review: "", status: "planned" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "Loved it");

    expect(supabase.updateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ review: "Loved it", showNudge: true });
  });

  it("returns a clean error when the update fails", async () => {
    const supabase = fakeSupabaseForReview({
      user: { id: "user-1" },
      item: { id: "item-1", review: null, status: "planned" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await updateReviewAction("item-1", "Review");

    expect(result).toEqual({ error: expect.stringMatching(/failed to save/i) });
  });
});

describe("markItemCompletedAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    revalidatePathMock.mockClear();
  });

  function fakeSupabaseForMarkCompleted(options: {
    user?: { id: string } | null;
    item?: FakeRow;
    category?: FakeRow;
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
              eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: options.item ?? null }) }) }),
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
      throw new Error(`Unexpected table in test: ${table}`);
    });
    return {
      from: fromMock,
      updateMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    };
  }

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabaseForMarkCompleted({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await markItemCompletedAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one", async () => {
    const supabase = fakeSupabaseForMarkCompleted({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await markItemCompletedAction("someone-elses-item");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.updateMock).not.toHaveBeenCalled();
  });

  it("sets only status to completed and revalidates the item's own route instead of redirecting", async () => {
    const supabase = fakeSupabaseForMarkCompleted({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await markItemCompletedAction("item-1");

    expect(result).toEqual({ success: true });
    expect(supabase.updateMock).toHaveBeenCalledWith({ status: "completed" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/games/item-1");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns a clean error when the update fails, without revalidating", async () => {
    const supabase = fakeSupabaseForMarkCompleted({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      updateError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await markItemCompletedAction("item-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to update/i) });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
