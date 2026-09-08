import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

// Playwright's own Node process doesn't load .env.local the way Next.js's
// dev server (spawned separately via playwright.config.ts's `webServer`) or
// Vitest (via vite's `loadEnv`, see vitest.config.ts) do -- read it directly
// here so specs can reach Supabase's admin API for disposable test-account
// cleanup, without adding a new env-loading dependency just for this.
function readEnvLocal(): Record<string, string> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(dir, "../.env.local");
  const contents = fs.readFileSync(envPath, "utf-8");

  const env: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = readEnvLocal();

// Admin client (service role key -- bypasses RLS/auth) used only to delete
// the disposable accounts these specs create via the UI, so no leftover
// test users accumulate in the live Supabase project across runs.
export function createSupabaseAdminClient() {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// A plain (anon-key, signed-in) client for reading a test user's own
// user_preferences row directly against the live project -- NOT the admin
// client above. The live project's user_preferences table grants
// select/insert/update/delete to the `authenticated` role only (see the #8
// migration); the service_role key has no table-level grant on it, so
// `createSupabaseAdminClient()` gets a bare "permission denied" from
// PostgREST for this one table even though it bypasses RLS everywhere else.
// Signing in as the user and relying on the table's own
// "select own row" RLS policy sidesteps that entirely.
export async function createSupabaseUserClient(email: string, password: string) {
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

// Supabase's admin API has no "get user by email" call, so page through
// listUsers() (only ever a handful of disposable e2e accounts exist at
// once in this project) to find the id these specs need for direct
// user_preferences reads and for cleanup.
export async function getUserIdByEmail(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find((user) => user.email === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
}

export function randomTestEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

// Well above the live project's configured minimum (6 chars, per
// lib/validation/auth.ts's comment) so registration never hits the
// weak-password path.
export const TEST_PASSWORD = "Test-Password-123!";
