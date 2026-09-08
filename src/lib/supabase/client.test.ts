import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient } from "./client";

// Loads SUPABASE_SERVICE_ROLE_KEY (and reconfirms the NEXT_PUBLIC_* vars)
// from .env.local. vitest.config.ts already forwards the two NEXT_PUBLIC_
// vars into the test env for #2's test; this additionally pulls in the
// service-role key, which is used ONLY here (never by client.ts/server.ts)
// to create/delete a throwaway auth user for this test, matching the
// temp-user pattern used for RLS verification in #5/#6.
try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env.local"));
} catch {
  // Already loaded (e.g. re-run in the same process) or file not present.
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// `categories` is RLS-scoped `to authenticated` with no grant to `anon` (see
// #3's migration), so the browser client needs a real signed-in session to
// read it at all -- this is why the test creates and signs in a temporary
// auth user rather than querying with the bare anon key.
const testEmail = `hlib-test-issue7-${Date.now()}@example.com`;
const testPassword = `Test-${crypto.randomUUID()}`;
let testUserId: string;

beforeAll(async () => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create temp test user: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: string };
  testUserId = body.id;
});

afterAll(async () => {
  if (!testUserId) return;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
});

// Proves the generated Database type actually resolves against the live
// schema: runs a real query against the live Supabase project referenced by
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.local),
// with the response typed via the inferred Database type -- no manual cast.
describe("Supabase browser client", () => {
  it("counts the four seeded V1 categories (Games/Books/Audio/Video)", async () => {
    const supabase = createClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    expect(signInError).toBeNull();

    const { count, error } = await supabase
      .from("categories")
      .select("*", { count: "exact", head: true });

    expect(error).toBeNull();
    expect(count).toBe(4);

    await supabase.auth.signOut();
  });
});
