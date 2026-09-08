import { expect, test, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  getUserIdByEmail,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #15 (Quick Add flow): the real
// title+category-only form + Server Action, the ?category=<slug>
// preselect, server-side status/subtype_id resolution (never trusted from
// the client), the redirect to the category library view (not the item
// detail page, unlike Full Add), and a clean failure if a category's
// predefined "Other" subtype is ever missing. Each test registers its own
// disposable account via the real UI and deletes it afterward, same
// convention as add-item.spec.ts.

async function registerViaUI(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^register$/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Quick Add flow (issue #15)", () => {
  test("entry point: LibraryView's header has a Quick Add link to /quick-add?category=<slug>, alongside the unchanged Add item link", async ({
    page,
  }) => {
    const email = randomTestEmail("quickadd-entry");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);
      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");

      await expect(page.getByRole("link", { name: "Add item" })).toHaveAttribute(
        "href",
        "/add",
      );
      await expect(page.getByRole("link", { name: "Quick Add" })).toHaveAttribute(
        "href",
        "/quick-add?category=games",
      );
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("minimum flow: arriving with ?category= preselected, typing a title and submitting (two interactions) creates a Planned item with the category's 'Other' subtype, and redirects to the category library view (not the item detail page)", async ({
    page,
  }) => {
    test.setTimeout(60_000); // real POST + redirect + render, under fullyParallel contention -- same budget as add-item.spec.ts's heavier tests
    const email = randomTestEmail("quickadd-min");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");

      await page.locator("aside").getByRole("link", { name: "Games" }).click();
      await page.waitForURL("**/games");
      await page.getByRole("link", { name: "Quick Add" }).click();
      await page.waitForURL("**/quick-add?category=games");

      await expect(page.getByLabel("Category")).toHaveValue(/.+/);
      const preselectedLabel = await page
        .getByLabel("Category")
        .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent);
      expect(preselectedLabel).toBe("Games");

      // Two interactions from here: type the title, submit.
      await page.getByLabel("Title").fill("Quick Added Game");
      await page.getByRole("button", { name: /^add$/i }).click();

      // Redirects to the category library view, not a detail page.
      await page.waitForURL("**/games");
      expect(page.url()).not.toMatch(/\/games\/[0-9a-f-]+$/);
      await expect(page.getByText("Quick Added Game")).toBeVisible();
      await expect(page.getByText("Planned")).toBeVisible();

      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { data: items } = await user
        .from("items")
        .select("id, status, subtypes(name, user_id)")
        .eq("title", "Quick Added Game");
      expect(items).toHaveLength(1);
      expect(items?.[0]?.status).toBe("planned");
      const subtype = items?.[0]?.subtypes as unknown as
        | { name: string; user_id: string | null }
        | { name: string; user_id: string | null }[]
        | null;
      const resolvedSubtype = Array.isArray(subtype) ? subtype[0] : subtype;
      expect(resolvedSubtype?.name).toBe("Other");
      expect(resolvedSubtype?.user_id).toBeNull();
      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("no ?category= (or an invalid slug): no category is preselected, and the user must choose one", async ({
    page,
  }) => {
    const email = randomTestEmail("quickadd-nopreselect");
    const admin = createSupabaseAdminClient();

    try {
      await registerViaUI(page, email);

      await page.goto("/quick-add");
      await expect(page.getByLabel("Category")).toHaveValue("");

      await page.goto("/quick-add?category=not-a-real-category");
      await expect(page.getByLabel("Category")).toHaveValue("");
    } finally {
      const userId = await getUserIdByEmail(admin, email);
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("client-side validation blocks an empty title and a missing category -- no navigation, no database write", async ({
    page,
  }) => {
    const email = randomTestEmail("quickadd-clientvalid");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      // --- Empty title ---
      await page.goto("/quick-add?category=games");
      await page.getByRole("button", { name: /^add$/i }).click();
      await expect(page.getByText("Title is required")).toBeVisible();
      expect(page.url()).toContain("/quick-add");

      // --- No category ---
      await page.goto("/quick-add");
      await page.getByLabel("Title").fill("Some Title");
      await page.getByRole("button", { name: /^add$/i }).click();
      await expect(page.getByText("Category is required")).toBeVisible();
      expect(page.url()).toContain("/quick-add");

      const { data: items } = await user.from("items").select("id");
      expect(items).toHaveLength(0);
      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("the server never trusts a client-supplied subtype_id: injecting one into the form still resolves the category's own 'Other' subtype", async ({
    page,
  }) => {
    const email = randomTestEmail("quickadd-tamper");
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      await registerViaUI(page, email);
      userId = await getUserIdByEmail(admin, email);
      if (!userId) throw new Error("test user id not found after registration");
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);

      const { data: booksCategory } = await user
        .from("categories")
        .select("id")
        .eq("slug", "books")
        .single();
      if (!booksCategory) throw new Error("books category not found");
      const { data: fictionSubtype } = await user
        .from("subtypes")
        .select("id")
        .eq("category_id", booksCategory.id)
        .eq("name", "Fiction")
        .single();
      if (!fictionSubtype) throw new Error("Fiction subtype not found");

      await page.goto("/quick-add?category=books");
      await page.getByLabel("Title").fill("Tampered Quick Add");

      // The form has no subtype input at all -- inject one directly at the
      // DOM level to simulate a hand-crafted/devtools submission attempting
      // to smuggle a subtype_id past the server, which never reads one.
      await page.evaluate((fictionSubtypeId) => {
        const form = document.querySelector("form") as HTMLFormElement;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "subtypeId";
        input.value = fictionSubtypeId;
        form.appendChild(input);
      }, fictionSubtype.id);

      await page.getByRole("button", { name: /^add$/i }).click();
      await page.waitForURL("**/books");

      const { data: items } = await user
        .from("items")
        .select("id, subtypes(name)")
        .eq("title", "Tampered Quick Add");
      expect(items).toHaveLength(1);
      const subtype = items?.[0]?.subtypes as unknown as
        | { name: string }
        | { name: string }[]
        | null;
      const resolvedSubtype = Array.isArray(subtype) ? subtype[0] : subtype;
      // Resolved to "Other" (Books), not "Fiction" -- the injected field
      // was never read.
      expect(resolvedSubtype?.name).toBe("Other");
      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  // The "category's 'Other' subtype is missing" failure path (data drift)
  // is NOT covered here: this project's reference-table migrations grant
  // only `select` on `subtypes` to any API role (see
  // supabase/migrations/20260908123222_create_reference_tables.sql), so
  // there is no supported way for even the admin/service-role client to
  // delete-then-restore a seeded row through the API for a live e2e run --
  // confirmed by a "permission denied" trying exactly that here. Covered
  // instead by a mocked-Supabase unit test in
  // src/lib/actions/items.test.ts, which exercises the same
  // quickAddItemAction branch with zero live-data risk.
});
