import { describe, expect, it } from "vitest";

import { itemLinkSchema } from "./links";

// Unit tests for the item-link schema (issue #20), same client pre-check +
// server re-check role as tags.test.ts covers for tagNameSchema.

describe("itemLinkSchema", () => {
  it("accepts a well-formed https URL with a label", () => {
    const result = itemLinkSchema.safeParse({ url: "https://imdb.com/title/1", label: "IMDb" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe("https://imdb.com/title/1");
      expect(result.data.label).toBe("IMDb");
    }
  });

  it("accepts a well-formed http URL", () => {
    const result = itemLinkSchema.safeParse({ url: "http://example.com" });
    expect(result.success).toBe(true);
  });

  it("trims leading/trailing whitespace on the URL", () => {
    const result = itemLinkSchema.safeParse({ url: "  https://example.com  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe("https://example.com");
    }
  });

  it("rejects an empty URL", () => {
    const result = itemLinkSchema.safeParse({ url: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only URL", () => {
    const result = itemLinkSchema.safeParse({ url: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a schemeless domain", () => {
    const result = itemLinkSchema.safeParse({ url: "imdb.com" });
    expect(result.success).toBe(false);
  });

  it("rejects a javascript: scheme", () => {
    const result = itemLinkSchema.safeParse({ url: "javascript:alert(1)" });
    expect(result.success).toBe(false);
  });

  it("rejects an ftp: scheme", () => {
    const result = itemLinkSchema.safeParse({ url: "ftp://example.com/file" });
    expect(result.success).toBe(false);
  });

  it("rejects a mailto: scheme", () => {
    const result = itemLinkSchema.safeParse({ url: "mailto:someone@example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed URL", () => {
    const result = itemLinkSchema.safeParse({ url: "not a url at all" });
    expect(result.success).toBe(false);
  });

  it("normalizes an absent label to null", () => {
    const result = itemLinkSchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeNull();
    }
  });

  it("normalizes a blank/whitespace-only label to null", () => {
    const result = itemLinkSchema.safeParse({ url: "https://example.com", label: "   " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeNull();
    }
  });
});
