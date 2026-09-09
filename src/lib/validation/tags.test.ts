import { describe, expect, it } from "vitest";

import { tagNameSchema } from "./tags";

// Unit tests for the typed-tag-name schema (issue #17), same client
// pre-check + server re-check role as items.test.ts covers for
// lib/validation/items.ts.

describe("tagNameSchema", () => {
  it("accepts a plain tag name", () => {
    const result = tagNameSchema.safeParse({ name: "Python" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Python");
    }
  });

  it("trims leading/trailing whitespace", () => {
    const result = tagNameSchema.safeParse({ name: "  cozy  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("cozy");
    }
  });

  it("rejects an empty name", () => {
    const result = tagNameSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    const result = tagNameSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });
});
