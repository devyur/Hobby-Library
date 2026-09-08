import { describe, expect, it } from "vitest";

// Proof-of-read for issue #2: confirms the Supabase env vars are wired up
// end-to-end (.env.local -> process.env) with no hardcoded fallback values.
// This does NOT instantiate a Supabase client (see #7) — it only checks
// that the two NEXT_PUBLIC_ vars the client layer will need resolve to
// non-empty strings at runtime.
describe("Supabase environment variables", () => {
  it("resolves NEXT_PUBLIC_SUPABASE_URL to a non-empty string", () => {
    expect(typeof process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("string");
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).not.toHaveLength(0);
  });

  it("resolves NEXT_PUBLIC_SUPABASE_ANON_KEY to a non-empty string", () => {
    expect(typeof process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("string");
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).not.toHaveLength(0);
  });
});
