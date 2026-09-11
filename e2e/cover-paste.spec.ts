import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #47 (clipboard-paste cover upload): the new
// `paste` input path into CoverUploadControl.tsx's existing upload pipeline
// (isAllowedCoverMimeType/MAX_COVER_SIZE_BYTES pre-check -> resizeCoverImage
// (#37) -> the same hidden <input type="file">/useActionState(uploadCoverAction)
// (#19) submission the file-input flow already uses), verified against the
// real Supabase project the same way cover-upload.spec.ts (#19) and
// cover-resize.spec.ts (#37) already do.
//
// jsdom (Vitest's environment) implements neither DataTransfer nor
// ClipboardEvent, so this behavior can only be exercised in a real browser
// -- there is no accompanying Vitest component test for the paste path
// itself. Playwright has no API to drive the OS clipboard headlessly, so
// each test synthesizes the closest real equivalent: a real ClipboardEvent,
// constructed and dispatched inside the page (not marshalled from Node) with
// a real DataTransfer carrying a real File, fired at the same focusable
// "paste zone" element a user would have just clicked into. This exercises
// CoverUploadControl's actual handlePaste code path (event.clipboardData.items
// -> getAsFile()), just with a scripted clipboard instead of an OS one.

async function createAdminUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string,
): Promise<{ email: string; userId: string }> {
  const email = randomTestEmail(label);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`createUser(${label}) failed`);
  return { email, userId: data.user.id };
}

async function loginViaUI(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL("**/dashboard");
}

async function insertGamesRpgItem(
  user: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  userId: string,
  title: string,
) {
  const { data: category } = await user
    .from("categories")
    .select("id, slug")
    .eq("slug", "games")
    .single();
  if (!category) throw new Error("games category not found");

  const { data: subtype } = await user
    .from("subtypes")
    .select("id")
    .eq("category_id", category.id)
    .eq("name", "RPG")
    .single();
  if (!subtype) throw new Error("RPG subtype not found");

  const { data: item } = await user
    .from("items")
    .insert({ user_id: userId, category_id: category.id, subtype_id: subtype.id, title, status: "planned" })
    .select("id")
    .single();
  if (!item) throw new Error(`insert ${title} failed`);

  return { itemId: item.id as string, categorySlug: category.slug as string };
}

// The "paste zone" is the whole CoverUploadControl wrapper -- role="group"
// with an aria-label naming the paste affordance (see CoverUploadControl.tsx).
function pasteZone(page: Page): Locator {
  return page.getByRole("group", { name: /cover image/i });
}

// Focuses the paste zone (mirroring the "click here" the hint text
// instructs), then dispatches a real `paste` ClipboardEvent at it from
// inside the page, carrying a real DataTransfer + File built from the given
// base64 bytes -- as close as Playwright can get to an actual OS Ctrl+V.
async function pasteImageFile(page: Page, base64: string, mimeType: string, filename: string) {
  const target = pasteZone(page);
  const handle = await target.elementHandle();
  if (!handle) throw new Error("paste zone not found");
  await target.focus();
  await page.evaluate(
    ({ el, base64, mimeType, filename }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], filename, { type: mimeType });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      (el as HTMLElement).dispatchEvent(event);
    },
    { el: handle, base64, mimeType, filename },
  );
}

// Same shape as pasteImageFile, but the (oversized) file's bytes are
// generated inside the page from a byte count alone -- avoids marshalling a
// multi-MB base64 string from Node into the page for what only needs to
// clear the client-side size check, not decode as a real image.
async function pasteOversizedImageFile(
  page: Page,
  sizeBytes: number,
  mimeType: string,
  filename: string,
) {
  const target = pasteZone(page);
  const handle = await target.elementHandle();
  if (!handle) throw new Error("paste zone not found");
  await target.focus();
  await page.evaluate(
    ({ el, sizeBytes, mimeType, filename }) => {
      const file = new File([new Uint8Array(sizeBytes)], filename, { type: mimeType });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      (el as HTMLElement).dispatchEvent(event);
    },
    { el: handle, sizeBytes, mimeType, filename },
  );
}

// Plain-text clipboard content -- no file at all, just like a real Ctrl+V of
// copied text. Exercises the "non-image paste is a clean no-op" branch of
// handlePaste (clipboardData.items has no kind:"file" image entry).
async function pasteText(page: Page, text: string) {
  const target = pasteZone(page);
  const handle = await target.elementHandle();
  if (!handle) throw new Error("paste zone not found");
  await target.focus();
  await page.evaluate(
    ({ el, text }) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", text);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      (el as HTMLElement).dispatchEvent(event);
    },
    { el: handle, text },
  );
}

const ONE_PIXEL_PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
).toString("base64");
const ONE_PIXEL_PNG_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
).toString("base64");

test.describe("Cover image upload via clipboard paste (issue #47)", () => {
  test("the paste affordance (hint text + button title) is visible before any paste happens", async ({
    page,
  }) => {
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverpaste-hint");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Hint Visibility Item");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      // Visible hint text, not hidden behind hover/focus.
      await expect(page.getByText(/press ctrl\+v to paste an image/i)).toBeVisible();
      // The upload button's own title= is the hover-tooltip affordance.
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toHaveAttribute(
        "title",
        /paste an image here/i,
      );

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("pasting an image sets the cover when there is none yet -- same pipeline as picking a file", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverpaste-fresh");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Paste Fresh Cover Item");
      storagePath = `${userId}/${itemId}/cover`;

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();

      await pasteImageFile(page, ONE_PIXEL_PNG_RED, "image/png", "pasted.png");

      await expect(page.getByRole("img", { name: "Cover for Paste Fresh Cover Item" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: /^replace cover$/i })).toBeVisible();

      // Went through the real uploadCoverAction pipeline -- one item_images
      // row at the fixed extension-less path, resized to WebP (#37) just
      // like a file-input upload.
      const { data: images } = await user
        .from("item_images")
        .select("id, storage_path, is_cover")
        .eq("item_id", itemId);
      expect(images).toHaveLength(1);
      expect(images?.[0].is_cover).toBe(true);
      expect(images?.[0].storage_path).toBe(storagePath);

      const { data: downloaded, error: downloadError } = await user.storage
        .from("covers")
        .download(storagePath);
      if (downloadError || !downloaded) throw downloadError ?? new Error("download failed");
      const stored = Buffer.from(await downloaded.arrayBuffer());
      expect(stored.toString("ascii", 8, 12)).toBe("WEBP");

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("pasting a new image over an existing cover replaces it -- still exactly one item_images row", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverpaste-replace");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Paste Replace Cover Item");

      storagePath = `${userId}/${itemId}/cover`;
      const { error: uploadError } = await user.storage
        .from("covers")
        .upload(storagePath, Buffer.from(ONE_PIXEL_PNG_RED, "base64"), { contentType: "image/png" });
      if (uploadError) throw uploadError;
      const { data: firstImage, error: insertError } = await user
        .from("item_images")
        .insert({ item_id: itemId, storage_path: storagePath, is_cover: true })
        .select("id")
        .single();
      if (insertError || !firstImage) throw insertError ?? new Error("seed insert failed");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      const coverImg = page.getByRole("img", { name: "Cover for Paste Replace Cover Item" });
      await expect(coverImg).toBeVisible();
      const oldSrc = await coverImg.getAttribute("src");
      await expect(page.getByRole("button", { name: /^replace cover$/i })).toBeVisible();

      await pasteImageFile(page, ONE_PIXEL_PNG_BLUE, "image/png", "pasted2.png");

      await expect
        .poll(async () => coverImg.getAttribute("src"), { timeout: 15_000 })
        .not.toBe(oldSrc);

      const { data: images } = await user
        .from("item_images")
        .select("id, storage_path, is_cover")
        .eq("item_id", itemId);
      expect(images).toHaveLength(1);
      expect(images?.[0].id).toBe(firstImage.id);
      expect(images?.[0].storage_path).toBe(storagePath);

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("pasting non-image clipboard content (plain text) is a clean no-op -- no error, no submission, nothing written", async ({
    page,
  }) => {
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverpaste-textnoop");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Paste Text Noop Item");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await pasteText(page, "just some copied text, not an image");

      // Give any (incorrect) async handling a moment to surface before
      // asserting nothing changed.
      await page.waitForTimeout(500);

      // getByRole("alert") alone also matches Next's own
      // #__next-route-announcer__ (role="alert", empty text) -- scope to
      // the error text itself instead, same workaround cover-upload.spec.ts
      // already uses.
      await expect(page.getByText(/jpg, png, or webp/i)).toHaveCount(0);
      await expect(page.getByText(/5 mb or smaller/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Cover for Paste Text Noop Item" }),
      ).toHaveCount(0);

      const { data: images } = await user.from("item_images").select("id").eq("item_id", itemId);
      expect(images ?? []).toHaveLength(0);
      const { data: listing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("pasting an oversized image is rejected with the same inline error the file-input flow shows -- the client pre-check pipeline is shared, not duplicated", async ({
    page,
  }) => {
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverpaste-oversized");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Paste Oversized Item");

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await pasteOversizedImageFile(page, 5 * 1024 * 1024 + 1024, "image/png", "big.png");

      await expect(page.getByText(/5 mb or smaller/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /^upload cover$/i })).toBeVisible();

      const { data: images } = await user.from("item_images").select("id").eq("item_id", itemId);
      expect(images ?? []).toHaveLength(0);
      const { data: listing } = await user.storage.from("covers").list(`${userId}/${itemId}`);
      expect(listing ?? []).toHaveLength(0);

      await user.auth.signOut();
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
