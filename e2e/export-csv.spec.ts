import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #45 (CSV export): GET /api/export?format=csv
// against the real project, mirroring e2e/export.spec.ts's reasoning for
// why this lives in Playwright rather than a mocked unit test -- the actual
// download response (status/headers/body) through real cookie-based auth.
// exportCsv.ts's row-shaping/escaping logic itself is covered by the mocked
// unit tests in src/lib/queries/exportCsv.test.ts; this spec only proves
// the route wiring and headers are correct against a live session, plus a
// regression check that adding the CSV branch left the plain JSON response
// untouched.

const HEADER_ROW =
  "Title,Category,Subtype,Status,Priority,Rating,Notes,Review,Tags,Links,Lists,Created At,Updated At,Completed At";

async function loginViaUI(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("CSV export (issue #45)", () => {
  test("a signed-in user downloads CSV via ?format=csv: correct headers and exact header row; plain /api/export is unaffected", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const email = randomTestEmail("export-csv-user");
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("createUser failed");
      userId = data.user.id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: category } = await user
        .from("categories")
        .select("id, slug")
        .eq("slug", "games")
        .single();
      if (!category) throw new Error("games category not found");
      const { data: subtype } = await user
        .from("subtypes")
        .select("id, name")
        .eq("category_id", category.id)
        .eq("name", "RPG")
        .single();
      if (!subtype) throw new Error("RPG subtype not found");

      // A field containing a comma, a quote, and a newline -- proves the
      // route's real body (not just the unit-tested pure function) escapes
      // per RFC 4180 end to end.
      await user.from("items").insert({
        user_id: userId,
        category_id: category.id,
        subtype_id: subtype.id,
        title: "Mass Effect 2",
        status: "completed",
        notes: 'Has a comma, a "quote", and\na newline',
      });

      await loginViaUI(page, email);

      const csvResponse = await page.request.get("/api/export?format=csv");
      expect(csvResponse.status()).toBe(200);
      expect(csvResponse.headers()["content-type"]).toBe("text/csv; charset=utf-8");
      const today = new Date().toISOString().slice(0, 10);
      expect(csvResponse.headers()["content-disposition"]).toBe(
        `attachment; filename="hobby-library-export-${today}.csv"`,
      );

      const csvBuffer = await csvResponse.body();
      const csvText = csvBuffer.toString("utf-8");
      // Leading UTF-8 BOM (3 bytes: EF BB BF).
      expect(csvBuffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      const withoutBom = csvText.slice(1);
      expect(withoutBom.split("\r\n")[0]).toBe(HEADER_ROW);
      expect(withoutBom).toContain("Mass Effect 2");
      // The escaped Notes field: quote-wrapped, internal quotes doubled,
      // the embedded bare newline preserved inside the quotes.
      expect(withoutBom).toContain('"Has a comma, a ""quote"", and\na newline"');

      // Regression check (issue #45 AC): plain /api/export (no format
      // param) is byte-for-byte the same JSON response as before this
      // issue -- still 200, still application/json, still a .json filename.
      const jsonResponse = await page.request.get("/api/export");
      expect(jsonResponse.status()).toBe(200);
      expect(jsonResponse.headers()["content-type"]).toContain("application/json");
      expect(jsonResponse.headers()["content-disposition"]).toBe(
        `attachment; filename="hobby-library-export-${today}.json"`,
      );
      const jsonBody = await jsonResponse.json();
      expect(jsonBody.items.some((item: { title: string }) => item.title === "Mass Effect 2")).toBe(
        true,
      );

      // ?format=<anything else> also falls back to JSON, no new error path.
      const unknownFormatResponse = await page.request.get("/api/export?format=xml");
      expect(unknownFormatResponse.status()).toBe(200);
      expect(unknownFormatResponse.headers()["content-type"]).toContain("application/json");

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("an unauthenticated CSV request gets 401 with no library data in the body", async ({
    request,
  }) => {
    const response = await request.get("/api/export?format=csv");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.items).toBeUndefined();
  });
});
