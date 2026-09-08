import { describe, expect, it } from "vitest";

import { addItemSchema, quickAddItemSchema } from "./items";

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
