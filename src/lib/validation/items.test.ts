import { describe, expect, it } from "vitest";

import { addItemSchema, editItemSchema, quickAddItemSchema } from "./items";

// Unit tests for the shared Zod schema backing the Full Add form (issue
// #14). Same "client pre-check + server re-check share one schema" role as
// auth.test.ts covers for lib/validation/auth.ts.

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";

function minimumValidItem(overrides: Record<string, unknown> = {}) {
  return {
    title: "Elden Ring",
    categoryId: VALID_UUID_A,
    subtypeId: VALID_UUID_B,
    status: "planned",
    rating: "",
    priority: "",
    tagIds: [],
    notes: "",
    review: "",
    ...overrides,
  };
}

describe("addItemSchema", () => {
  it("accepts the minimum valid item (title + category + subtype + status only)", () => {
    const result = addItemSchema.safeParse(minimumValidItem());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rating).toBeUndefined();
      expect(result.data.priority).toBeUndefined();
      expect(result.data.tagIds).toEqual([]);
      expect(result.data.notes).toBeUndefined();
      expect(result.data.review).toBeUndefined();
    }
  });

  it("rejects an empty title", () => {
    const result = addItemSchema.safeParse(minimumValidItem({ title: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "title")).toBe(
        true,
      );
    }
  });

  it("rejects a missing category (and, transitively, a missing subtype)", () => {
    const result = addItemSchema.safeParse(
      minimumValidItem({ categoryId: "", subtypeId: "" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path[0]);
      expect(fields).toContain("categoryId");
      expect(fields).toContain("subtypeId");
    }
  });

  it("rejects a non-uuid category/subtype id (a tampered <option value>)", () => {
    const result = addItemSchema.safeParse(
      minimumValidItem({ categoryId: "not-a-uuid", subtypeId: "also-not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a missing/invalid status", () => {
    const result = addItemSchema.safeParse(minimumValidItem({ status: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "status"),
      ).toBe(true);
    }
  });

  it.each([0, 11, -1, 100])(
    "rejects a rating of %i (outside 1-10, matching items_rating_check)",
    (rating) => {
      const result = addItemSchema.safeParse(
        minimumValidItem({ rating: String(rating) }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path[0] === "rating"),
        ).toBe(true);
      }
    },
  );

  it.each([1, 5, 10])("accepts a rating of %i", (rating) => {
    const result = addItemSchema.safeParse(
      minimumValidItem({ rating: String(rating) }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rating).toBe(rating);
    }
  });

  it("rejects a non-integer rating", () => {
    const result = addItemSchema.safeParse(minimumValidItem({ rating: "5.5" }));
    expect(result.success).toBe(false);
  });

  it("accepts a full field set including tags, priority, notes, and review", () => {
    const result = addItemSchema.safeParse(
      minimumValidItem({
        rating: "9",
        priority: "high",
        tagIds: [VALID_UUID_A, VALID_UUID_B],
        notes: "Some notes",
        review: "Some review",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("high");
      expect(result.data.tagIds).toEqual([VALID_UUID_A, VALID_UUID_B]);
      expect(result.data.notes).toBe("Some notes");
      expect(result.data.review).toBe("Some review");
    }
  });

  it("rejects an invalid priority value", () => {
    const result = addItemSchema.safeParse(
      minimumValidItem({ priority: "urgent" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid entry in tagIds (a tampered checkbox value)", () => {
    const result = addItemSchema.safeParse(
      minimumValidItem({ tagIds: ["not-a-uuid"] }),
    );
    expect(result.success).toBe(false);
  });
});

// Unit tests for the Quick Add form's schema (issue #15) -- title + category
// only. status/subtype_id have no fields here at all (resolved server-side
// in quickAddItemAction), so there's nothing to test-for-absence beyond
// checking the parsed shape below.
describe("quickAddItemSchema", () => {
  it("accepts a valid title + category", () => {
    const result = quickAddItemSchema.safeParse({
      title: "Elden Ring",
      categoryId: VALID_UUID_A,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: "Elden Ring", categoryId: VALID_UUID_A });
    }
  });

  it("rejects an empty title", () => {
    const result = quickAddItemSchema.safeParse({
      title: "",
      categoryId: VALID_UUID_A,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "title")).toBe(
        true,
      );
    }
  });

  it("rejects a whitespace-only title", () => {
    const result = quickAddItemSchema.safeParse({
      title: "   ",
      categoryId: VALID_UUID_A,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing category", () => {
    const result = quickAddItemSchema.safeParse({
      title: "Elden Ring",
      categoryId: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "categoryId"),
      ).toBe(true);
    }
  });

  it("rejects a non-uuid category id (a tampered <option value>)", () => {
    const result = quickAddItemSchema.safeParse({
      title: "Elden Ring",
      categoryId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

// Unit tests for the Edit item form's schema (issue #16; subtypeId added in
// #18; notes/review removed entirely in #48, now that they save
// independently through updateNotesAction/updateReviewAction instead of
// through this shared form -- see lib/actions/items.ts) --
// status/subtypeId/rating/priority. No title/category fields exist here at
// all (permanently out of scope for editing), unlike addItemSchema. Unlike
// rating/priority, subtypeId is required -- same `.min(1).uuid()` shape as
// addItemSchema's own subtypeId -- since every item always has a subtype
// and this form never lets it go blank.
describe("editItemSchema", () => {
  function minimumValidEdit(overrides: Record<string, unknown> = {}) {
    return {
      status: "planned",
      subtypeId: VALID_UUID_B,
      rating: "",
      priority: "",
      ...overrides,
    };
  }

  it("accepts status-only input, with rating/priority left undefined", () => {
    const result = editItemSchema.safeParse(minimumValidEdit());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rating).toBeUndefined();
      expect(result.data.priority).toBeUndefined();
    }
  });

  it("has no notes/review fields at all -- they save independently, never through this schema", () => {
    const result = editItemSchema.safeParse(
      minimumValidEdit({ notes: "Some notes", review: "Some review" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("notes");
      expect(result.data).not.toHaveProperty("review");
    }
  });

  it("rejects a missing/invalid status", () => {
    const result = editItemSchema.safeParse(minimumValidEdit({ status: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "status")).toBe(
        true,
      );
    }
  });

  it.each([0, 11, -1])(
    "rejects a rating of %i (outside 1-10, matching items_rating_check)",
    (rating) => {
      const result = editItemSchema.safeParse(minimumValidEdit({ rating: String(rating) }));
      expect(result.success).toBe(false);
    },
  );

  it("accepts a full field set including rating and priority", () => {
    const result = editItemSchema.safeParse(
      minimumValidEdit({
        status: "completed",
        rating: "8",
        priority: "medium",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("completed");
      expect(result.data.rating).toBe(8);
      expect(result.data.priority).toBe("medium");
    }
  });

  it("rejects an invalid priority value", () => {
    const result = editItemSchema.safeParse(minimumValidEdit({ priority: "urgent" }));
    expect(result.success).toBe(false);
  });

  it("has no categoryId/title fields at all", () => {
    const result = editItemSchema.safeParse(
      minimumValidEdit({ title: "New Title", categoryId: "x" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("title");
      expect(result.data).not.toHaveProperty("categoryId");
    }
  });

  it("rejects a missing subtype", () => {
    const result = editItemSchema.safeParse(minimumValidEdit({ subtypeId: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "subtypeId"),
      ).toBe(true);
    }
  });

  it("rejects a non-uuid subtype id (a tampered <option value>)", () => {
    const result = editItemSchema.safeParse(minimumValidEdit({ subtypeId: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  // completedAt (issue #34): always optional at the schema level -- the
  // form always renders it, but leaving it blank is exactly how a user
  // clears completed_at, same shape as rating/priority.
  describe("completedAt", () => {
    it("leaves completedAt undefined when the field is empty", () => {
      const result = editItemSchema.safeParse(minimumValidEdit());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedAt).toBeUndefined();
      }
    });

    it("accepts a well-formed YYYY-MM-DD date", () => {
      const result = editItemSchema.safeParse(minimumValidEdit({ completedAt: "2024-03-15" }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedAt).toBe("2024-03-15");
      }
    });

    it("accepts a completed date earlier than any plausible add date -- no cross-field check exists", () => {
      const result = editItemSchema.safeParse(minimumValidEdit({ completedAt: "1999-01-01" }));
      expect(result.success).toBe(true);
    });

    it.each(["not-a-date", "2024/03/15", "03-15-2024", "2024-3-15", "15-2024-03"])(
      "rejects a malformed date string %s",
      (value) => {
        const result = editItemSchema.safeParse(minimumValidEdit({ completedAt: value }));
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(
            result.error.issues.some((issue) => issue.path[0] === "completedAt"),
          ).toBe(true);
        }
      },
    );

    it("rejects a well-shaped but nonexistent calendar date (Feb 30)", () => {
      const result = editItemSchema.safeParse(minimumValidEdit({ completedAt: "2024-02-30" }));
      expect(result.success).toBe(false);
    });

    it("accepts Feb 29 on a leap year and rejects it on a non-leap year", () => {
      expect(
        editItemSchema.safeParse(minimumValidEdit({ completedAt: "2024-02-29" })).success,
      ).toBe(true);
      expect(
        editItemSchema.safeParse(minimumValidEdit({ completedAt: "2023-02-29" })).success,
      ).toBe(false);
    });
  });
});
