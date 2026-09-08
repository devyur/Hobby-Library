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

const { quickAddItemAction } = await import("./items");
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
