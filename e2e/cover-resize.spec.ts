import { expect, test, type Page } from "@playwright/test";

import { buildHalfTransparentPng, buildLargePhotoPng } from "./png";
import {
  createSupabaseAdminClient,
  createSupabaseUserClient,
  randomTestEmail,
  TEST_PASSWORD,
} from "./testAccount";

// End-to-end coverage for issue #37 (client-side resize/compress cover
// images before upload): the real browser Canvas/OffscreenCanvas resize
// path in resizeCoverImage.ts (called from CoverUploadControl.tsx's
// handleChange), verified against the live Supabase project the same way
// cover-upload.spec.ts (#19) and cover-remove.spec.ts (#35) already do --
// unit coverage for the resize function's own scaling math and fallback
// branches lives in src/lib/images/resizeCoverImage.test.ts (mocked
// Canvas APIs); this file is for what only a real browser's actual image
// decode/encode can confirm: real pixel dimensions, real WebP bytes, and a
// real, dramatic size reduction on the stored object.

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

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

// Decodes an image buffer in the real browser (Chromium natively decodes
// WebP and PNG alike) and reports its pixel dimensions -- avoids needing
// any image-decoding dependency on the Node side.
async function decodedDimensions(
  page: Page,
  buffer: Buffer,
  mimeType: string,
): Promise<{ width: number; height: number }> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  return page.evaluate((src) => {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("failed to decode image in browser"));
      img.src = src;
    });
  }, dataUrl);
}

// Samples the alpha channel at a fractional (x, y) position (0..1 of width/
// height) by drawing the decoded image to a canvas and reading it back --
// how the test confirms alpha survived the resize + WebP re-encode instead
// of flattening to an opaque background.
async function alphaAt(
  page: Page,
  buffer: Buffer,
  mimeType: string,
  fx: number,
  fy: number,
): Promise<number> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  return page.evaluate(
    ({ src, fx, fy }) => {
      return new Promise<number>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("no 2d context"));
          ctx.drawImage(img, 0, 0);
          const x = Math.min(canvas.width - 1, Math.floor(canvas.width * fx));
          const y = Math.min(canvas.height - 1, Math.floor(canvas.height * fy));
          resolve(ctx.getImageData(x, y, 1, 1).data[3]);
        };
        img.onerror = () => reject(new Error("failed to decode image in browser"));
        img.src = src;
      });
    },
    { src: dataUrl, fx, fy },
  );
}

test.describe("Cover image resize/compress (issue #37)", () => {
  test("a large 4000x3000 photo is resized to 800px on the long edge, re-encoded to WebP, and stored dramatically smaller", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverresize-large");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Large Photo Item");
      storagePath = `${userId}/${itemId}/cover`;

      const originalPng = buildLargePhotoPng(4000, 3000);
      expect(originalPng.length).toBeLessThan(5 * 1024 * 1024); // must clear the existing 5MB pre-check unresized

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await page
        .getByLabel("Cover image", { exact: true })
        .setInputFiles({ name: "large-photo.png", mimeType: "image/png", buffer: originalPng });

      await expect(page.getByRole("img", { name: "Cover for Large Photo Item" })).toBeVisible({
        timeout: 30_000,
      });

      const { data: downloaded, error: downloadError } = await user.storage
        .from("covers")
        .download(storagePath);
      if (downloadError || !downloaded) throw downloadError ?? new Error("download failed");
      const stored = Buffer.from(await downloaded.arrayBuffer());

      // Format: WebP, not the source PNG.
      expect(isWebp(stored)).toBe(true);

      // Size: dramatically smaller than the already-modest 2MB-ish source,
      // landing in the "roughly 100-300KB" range #37's acceptance criteria
      // describes (some slack for real encoder variance).
      expect(stored.length).toBeLessThan(400 * 1024);
      expect(stored.length).toBeLessThan(originalPng.length * 0.3);

      console.log(
        `[#37] large photo resize: ${originalPng.length} bytes (PNG, 4000x3000) -> ${stored.length} bytes (WebP)`,
      );

      // Dimensions: 4000x3000 scaled to an 800px long edge -> exactly 800x600.
      const dims = await decodedDimensions(page, stored, "image/webp");
      expect(dims).toEqual({ width: 800, height: 600 });

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("a source PNG with transparency keeps its alpha channel after resize + WebP re-encode", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverresize-alpha");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Transparent Cover Item");
      storagePath = `${userId}/${itemId}/cover`;

      // Left half opaque red, right half fully transparent, 1200x900 (above
      // the 800px cap, so this also exercises the resize -- not just a
      // pass-through of an already-small file).
      const originalPng = buildHalfTransparentPng(1200, 900);

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await page
        .getByLabel("Cover image", { exact: true })
        .setInputFiles({ name: "half-transparent.png", mimeType: "image/png", buffer: originalPng });

      await expect(
        page.getByRole("img", { name: "Cover for Transparent Cover Item" }),
      ).toBeVisible({ timeout: 30_000 });

      const { data: downloaded, error: downloadError } = await user.storage
        .from("covers")
        .download(storagePath);
      if (downloadError || !downloaded) throw downloadError ?? new Error("download failed");
      const stored = Buffer.from(await downloaded.arrayBuffer());

      expect(isWebp(stored)).toBe(true);

      // Opaque (left quarter) stays opaque; transparent (right quarter)
      // stays transparent -- not flattened to a solid background the way a
      // JPEG re-encode would.
      const opaqueAlpha = await alphaAt(page, stored, "image/webp", 0.25, 0.5);
      const transparentAlpha = await alphaAt(page, stored, "image/webp", 0.75, 0.5);
      expect(opaqueAlpha).toBeGreaterThan(200);
      expect(transparentAlpha).toBeLessThan(50);

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  test("when client-side resize fails, the original (already validated) file is uploaded unchanged instead of blocking the upload", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const admin = createSupabaseAdminClient();
    let userId: string | null = null;
    let storagePath: string | null = null;

    try {
      const { email, userId: id } = await createAdminUser(admin, "coverresize-fallback");
      userId = id;
      const user = await createSupabaseUserClient(email, TEST_PASSWORD);
      const { itemId, categorySlug } = await insertGamesRpgItem(user, userId, "Fallback Cover Item");
      storagePath = `${userId}/${itemId}/cover`;

      // Force resizeCoverImage's own try/catch down its failure path before
      // any app code runs, simulating a browser/runtime that can't decode
      // the image client-side.
      await page.addInitScript(() => {
        window.createImageBitmap = () =>
          Promise.reject(new Error("forced failure for e2e test"));
      });

      const consoleWarnings: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "warning") consoleWarnings.push(msg.text());
      });

      const originalPng = buildHalfTransparentPng(200, 200);

      await loginViaUI(page, email);
      await page.goto(`/${categorySlug}/${itemId}`);

      await page
        .getByLabel("Cover image", { exact: true })
        .setInputFiles({ name: "small.png", mimeType: "image/png", buffer: originalPng });

      await expect(
        page.getByRole("img", { name: "Cover for Fallback Cover Item" }),
      ).toBeVisible({ timeout: 15_000 });

      const { data: downloaded, error: downloadError } = await user.storage
        .from("covers")
        .download(storagePath);
      if (downloadError || !downloaded) throw downloadError ?? new Error("download failed");
      const stored = Buffer.from(await downloaded.arrayBuffer());

      // Upload still succeeded, with the exact original PNG bytes -- no
      // resize, no re-encode, and the upload was never blocked.
      expect(stored.equals(originalPng)).toBe(true);
      expect(isWebp(stored)).toBe(false);
      expect(consoleWarnings.some((text) => text.includes("resizeCoverImage"))).toBe(true);

      await user.auth.signOut();
    } finally {
      if (userId && storagePath) {
        await admin.storage.from("covers").remove([storagePath]);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
