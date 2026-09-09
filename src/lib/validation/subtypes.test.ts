import { describe, expect, it } from "vitest";

import { subtypeNameSchema } from "./subtypes";

// Unit tests for the typed-subtype-name schema (issue #18), same client
// pre-check + server re-check role as items.test.ts covers for
// lib/validation/items.ts and tags.test.ts covers for
// lib/validation/tags.ts's tagNameSchema.

describe("subtypeNameSchema", () => {
  it("accepts a plain subtype name", () => {
    const result = subtypeNameSchema.safeParse({ name: "Roguelike" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Roguelike");
    }
  });

  it("trims leading/trailing whitespace", () => {
    const result = subtypeNameSchema.safeParse({ name: "  Roguelike  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Roguelike");
    }
  });

  it("rejects an empty name", () => {
    const result = subtypeNameSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    const result = subtypeNameSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });
});
