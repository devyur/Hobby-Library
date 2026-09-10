import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #31 (Responsive/mobile polish pass): every
// in-scope route (14 total, per the issue's own list) renders with no
// horizontal overflow and every sampled interactive element meets the
// 44x44 CSS pixel touch-target minimum (WCAG 2.2 SC 2.5.8 / Apple HIG
// baseline, per the issue's own standard) at both 375x667 (iPhone SE/mini
// class, the width e2e/nav.spec.ts's own mobile test already uses) and
// 414x896 (iPhone 11/XR/Plus class).
//
// Two tests, split by auth state (same reason e2e/nav.spec.ts's mobile test
// stands alone): the 5 (auth)/root routes need no account at all, so they
// run with zero Supabase calls; the 9 authenticated routes share ONE
// disposable account (created via the Supabase Admin API, not /register --
// same rate-limit-avoidance precedent as e2e/trash.spec.ts/dashboard.spec.ts)
// seeded with just enough real data (two items, one list, one trashed item)
// that every page's list/card-row and form-control samples have something
// real to measure instead of an empty state.
//
// Per-page checks follow the issue's own "representative interactive
// element sample" definition: primary nav control (the hamburger toggle,
// every (app) page), primary CTA/submit, at least one form control, and at
// least one list/card row where the page has one -- not an exhaustive scan
// of every control on every page.

const VIEWPORTS = [
  { width: 375, height: 667, label: "375x667" },
  { width: 414, height: 896, label: "414x896" },
] as const;

const MIN_TOUCH_TARGET = 44;
// Small epsilon for boundingBox() subpixel/antialiasing rounding -- the
// underlying Tailwind classes resolve to exactly 44px (h-11/size-11 at the
// default 16px root font size), but real browser layout can report
// 43.98-ish values for an element sized via border-box CSS.
const EPSILON = 0.5;

async function assertNoOverflow(page: Page, label: string) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasOverflow, `${label}: no horizontal overflow`).toBe(false);
}

async function assertTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label}: visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label}: has a bounding box`).not.toBeNull();
  expect(box!.width, `${label}: width >= 44px`).toBeGreaterThanOrEqual(
    MIN_TOUCH_TARGET - EPSILON,
  );
  expect(box!.height, `${label}: height >= 44px`).toBeGreaterThanOrEqual(
    MIN_TOUCH_TARGET - EPSILON,
  );
}

const navToggle = (page: Page) => page.getByRole("button", { name: /open navigation/i });

test.describe("Mobile polish: unauthenticated pages (issue #31)", () => {
  test("/, /login, /register, /forgot-password, /reset-password: no horizontal overflow, primary CTA meets the 44x44 touch-target minimum, at 375px and 414px", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);

      await page.goto("/");
      await assertNoOverflow(page, `/ @ ${viewport.label}`);
      await assertTouchTarget(
        page.getByRole("link", { name: "Register" }),
        `/ Register CTA @ ${viewport.label}`,
      );

      await page.goto("/login");
      await assertNoOverflow(page, `/login @ ${viewport.label}`);
      await assertTouchTarget(page.getByLabel("Email"), `/login Email field @ ${viewport.label}`);
      await assertTouchTarget(
        page.getByRole("button", { name: /^log in$/i }),
        `/login submit CTA @ ${viewport.label}`,
      );

      await page.goto("/register");
      await assertNoOverflow(page, `/register @ ${viewport.label}`);
      await assertTouchTarget(page.getByLabel("Email"), `/register Email field @ ${viewport.label}`);
      await assertTouchTarget(
        page.getByRole("button", { name: /^register$/i }),
        `/register submit CTA @ ${viewport.label}`,
      );

      await page.goto("/forgot-password");
      await assertNoOverflow(page, `/forgot-password @ ${viewport.label}`);
      await assertTouchTarget(
        page.getByLabel("Email"),
        `/forgot-password Email field @ ${viewport.label}`,
      );
      await assertTouchTarget(
        page.getByRole("button", { name: /send reset link/i }),
        `/forgot-password submit CTA @ ${viewport.label}`,
      );

      // No recovery session here (a real one requires a live email round
      // trip nothing else in this suite sets up either) -- this renders the
      // page's other real, reachable state: "Link invalid or expired" plus
      // a single inline text link, which WCAG's own exception for inline
      // text links inside a sentence exempts from the touch-target minimum
      // (per the issue's own "Standards used" section). Only overflow is
      // checked here.
      await page.goto("/reset-password");
      await assertNoOverflow(page, `/reset-password @ ${viewport.label}`);
      await expect(page.getByText(/link invalid or expired/i)).toBeVisible();
    }
  });
});

test.describe("Mobile polish: authenticated pages (issue #31)", () => {
  test("dashboard/add/quick-add/category/item-detail/lists/list-detail/trash/settings: no horizontal overflow, nav toggle + primary CTA/form control/list row meet the 44x44 touch-target minimum, at 375px and 414px", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const email = randomTestEmail("mobile-polish");
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
        .select("id, slug, name")
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

      // Item A: list member + the item-detail page's own subject.
      const { data: itemA } = await user
        .from("items")
        .insert({
          user_id: userId,
          category_id: category.id,
          subtype_id: subtype.id,
          title: "Mobile Polish Item A",
          status: "planned",
        })
        .select("id")
        .single();
      if (!itemA) throw new Error("insert item A failed");

      // Item B: left OUT of the list so lists/[listId]'s "Add an item"
      // picker has a real addable candidate.
      const { data: itemB } = await user
        .from("items")
        .insert({
          user_id: userId,
          category_id: category.id,
          subtype_id: subtype.id,
          title: "Mobile Polish Item B",
          status: "planned",
        })
        .select("id")
        .single();
      if (!itemB) throw new Error("insert item B failed");

      // Item C: soft-deleted, for /trash's row.
      const { data: itemC } = await user
        .from("items")
        .insert({
          user_id: userId,
          category_id: category.id,
          subtype_id: subtype.id,
          title: "Mobile Polish Item C Trashed",
          status: "planned",
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!itemC) throw new Error("insert item C failed");

      const { data: list } = await user
        .from("lists")
        .insert({ user_id: userId, name: "Mobile Polish List" })
        .select("id")
        .single();
      if (!list) throw new Error("insert list failed");
      await user.from("list_items").insert({ list_id: list.id, item_id: itemA.id });

      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /log in/i }).click();
      await page.waitForURL("**/dashboard");

      interface PageCheck {
        path: string;
        label: string;
        cta?: (page: Page) => Locator;
        formControl?: (page: Page) => Locator;
        row?: (page: Page) => Locator;
        // Extra, page-specific interaction run after the standard checks
        // above (e.g. entering the item-detail page's edit mode) -- kept
        // separate so a failure there doesn't mask the standard checks.
        extra?: (page: Page) => Promise<void>;
      }

      const main = (page: Page) => page.locator("main");

      const pages: PageCheck[] = [
        {
          path: "/dashboard",
          label: "/dashboard",
          // Placeholder-free since #27/#28 shipped (see this file's header
          // comment) -- but generic per issue #31's own Constraints: no
          // stat-tile/recommendation-card selectors, just the page-level nav
          // toggle + overflow check every (app) page gets.
        },
        {
          path: "/add",
          label: "/add",
          cta: (p) => p.getByRole("button", { name: /^add item$/i }),
          formControl: (p) => p.getByLabel("Title"),
        },
        {
          path: "/quick-add",
          label: "/quick-add",
          cta: (p) => p.getByRole("button", { name: /^add$/i }),
          formControl: (p) => p.getByLabel("Title"),
        },
        {
          path: "/games",
          label: "/games ([category])",
          cta: (p) => p.getByRole("link", { name: "Add item" }),
          formControl: (p) => p.getByLabel("Search"),
          row: (p) => main(p).getByRole("link", { name: /Mobile Polish Item A/i }),
        },
        {
          path: `/games/${itemA.id}`,
          label: "/games/[itemId] (item detail)",
          cta: (p) => p.getByRole("button", { name: /^edit$/i }),
          extra: async (p) => {
            // The item-detail page's layout was reworked after this issue
            // was originally groomed (commits 6ef579d/1716c15) -- verify
            // its edit-mode form controls too, not just the view-mode Edit
            // button, since that's exactly the surface those commits
            // touched.
            await p.getByRole("button", { name: /^edit$/i }).click();
            await assertTouchTarget(
              p.getByLabel("Status"),
              `${p.url()} edit-mode Status field`,
            );
            await assertNoOverflow(p, `${p.url()} (edit mode)`);
          },
        },
        {
          path: "/lists",
          label: "/lists",
          cta: (p) => p.getByRole("button", { name: /^create list$/i }),
          formControl: (p) => p.getByLabel("New list name"),
          row: (p) => p.getByRole("button", { name: /^rename$/i }).first(),
        },
        {
          path: `/lists/${list.id}`,
          label: "/lists/[listId] (list detail)",
          cta: (p) => p.getByRole("button", { name: /^add to list$/i }),
          formControl: (p) => p.getByLabel("Item", { exact: true }),
          row: (p) => p.getByRole("button", { name: /^remove$/i }).first(),
        },
        {
          path: "/trash",
          label: "/trash",
          row: (p) => p.getByRole("button", { name: /^restore$/i }).first(),
        },
        {
          path: "/settings",
          label: "/settings",
          cta: (p) => p.getByRole("button", { name: /^log out$/i }),
          formControl: (p) => p.getByRole("button", { name: /toggle theme/i }),
        },
      ];

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);

        for (const pageCheck of pages) {
          await page.goto(pageCheck.path);
          await assertNoOverflow(page, `${pageCheck.label} @ ${viewport.label}`);
          await assertTouchTarget(navToggle(page), `${pageCheck.label} nav toggle @ ${viewport.label}`);

          if (pageCheck.cta) {
            await assertTouchTarget(
              pageCheck.cta(page),
              `${pageCheck.label} primary CTA @ ${viewport.label}`,
            );
          }
          if (pageCheck.formControl) {
            await assertTouchTarget(
              pageCheck.formControl(page),
              `${pageCheck.label} form control @ ${viewport.label}`,
            );
          }
          if (pageCheck.row) {
            await assertTouchTarget(
              pageCheck.row(page),
              `${pageCheck.label} list/card row control @ ${viewport.label}`,
            );
          }
          if (pageCheck.extra) {
            await pageCheck.extra(page);
          }
        }

        // NavLinks.tsx's mobile panel links (issue #31's other explicit
        // acceptance criterion, alongside the hamburger toggle above):
        // opening the panel from any (app) page must not introduce
        // overflow, and every destination link in it must meet the 44x44
        // minimum -- was ~36px tall before this pass.
        await page.goto("/dashboard");
        await navToggle(page).click();
        const panel = page.locator("#mobile-nav-panel");
        await expect(panel, `mobile nav panel @ ${viewport.label}`).toBeVisible();
        await assertTouchTarget(
          panel.getByRole("link", { name: "Trash", exact: true }),
          `mobile nav panel "Trash" link @ ${viewport.label}`,
        );
        await assertNoOverflow(page, `/dashboard with nav panel open @ ${viewport.label}`);
      }

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
