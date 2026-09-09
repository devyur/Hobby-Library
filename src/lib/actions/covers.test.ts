import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for uploadCoverAction (issue #19), focused on what e2e
// coverage (e2e/cover-upload.spec.ts) can exercise live but not directly
// inspect call arguments/ordering for: (1) type/size rejection happening
// *before* createClient is ever called -- no network round trip, let alone
// a storage/DB write, for an invalid file, (2) the ownership/not-found
// check short-circuiting before storage.upload is ever called, and (3) the
// "check for an existing is_cover=true row first" branch -- that a
// first-ever upload inserts one item_images row, while a replace uploads to
// storage but never calls item_images.insert again. Same createClient/
// redirect mocking shape as lib/actions/items.test.ts.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirectMock(...args),
}));

const { uploadCoverAction } = await import("./covers");
const { initialUploadCoverState } = await import("@/lib/validation/covers");

type FakeRow = Record<string, unknown> | null;

function fakeSupabase(options: {
  user?: { id: string } | null;
  item?: FakeRow;
  category?: FakeRow;
  existingCover?: FakeRow;
  uploadError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const uploadMock = vi.fn(
    async (
      path: string,
      file: File,
      uploadOptions: { upsert: boolean; contentType: string },
    ) => {
      void path;
      void file;
      void uploadOptions;
      return {
        data: options.uploadError ? null : { path: "irrelevant" },
        error: options.uploadError ?? null,
      };
    },
  );
  const itemImagesInsertMock = vi.fn(() => ({
    // insert() itself is the terminal call here (no .select().single()
    // chained in the action) -- resolved directly as a promise-like.
    then: (resolve: (v: { error: unknown }) => void) =>
      resolve({ error: options.insertError ?? null }),
  }));

  const fromMock = vi.fn((table: string) => {
    if (table === "items") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: async () => ({ data: options.item ?? null }) }),
            }),
          }),
        }),
      };
    }
    if (table === "categories") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: options.category ?? null }) }),
        }),
      };
    }
    if (table === "item_images") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options.existingCover ?? null }),
            }),
          }),
        }),
        insert: itemImagesInsertMock,
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    storage: { from: vi.fn(() => ({ upload: uploadMock })) },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    uploadMock,
    itemImagesInsertMock,
  };
}

function formDataWithFile(file: File | null): FormData {
  const formData = new FormData();
  if (file) formData.set("cover", file);
  return formData;
}

function makeFile(options: { name?: string; type: string; sizeBytes: number }): File {
  const bytes = new Uint8Array(options.sizeBytes);
  return new File([bytes], options.name ?? "cover.jpg", { type: options.type });
}

const VALID_JPEG = makeFile({ type: "image/jpeg", sizeBytes: 1024 });

describe("uploadCoverAction", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    redirectMock.mockClear();
  });

  it("rejects a non-image file type before ever calling createClient (no storage/DB write attempted)", async () => {
    const result = await uploadCoverAction(
      "item-1",
      initialUploadCoverState,
      formDataWithFile(makeFile({ name: "notes.txt", type: "text/plain", sizeBytes: 100 })),
    );

    expect(result.error).toMatch(/jpg, png, or webp/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an SVG (a browser-renderable image type this app still excludes) before ever calling createClient", async () => {
    const result = await uploadCoverAction(
      "item-1",
      initialUploadCoverState,
      formDataWithFile(makeFile({ name: "cover.svg", type: "image/svg+xml", sizeBytes: 100 })),
    );

    expect(result.error).toMatch(/jpg, png, or webp/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a file over 5 MB before ever calling createClient", async () => {
    const oversized = makeFile({ type: "image/png", sizeBytes: 5 * 1024 * 1024 + 1 });

    const result = await uploadCoverAction(
      "item-1",
      initialUploadCoverState,
      formDataWithFile(oversized),
    );

    expect(result.error).toMatch(/5 mb or smaller/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a missing file before ever calling createClient", async () => {
    const result = await uploadCoverAction(
      "item-1",
      initialUploadCoverState,
      formDataWithFile(null),
    );

    expect(result.error).toMatch(/choose an image/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request without touching storage or the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadCoverAction(
      "item-1",
      initialUploadCoverState,
      formDataWithFile(VALID_JPEG),
    );

    expect(result.error).toMatch(/signed in/i);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.uploadMock).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one -- rejected before storage.upload is ever called", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: null, // .eq("user_id", user.id) excludes another user's row
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadCoverAction(
      "someone-elses-item",
      initialUploadCoverState,
      formDataWithFile(VALID_JPEG),
    );

    expect(result.error).toMatch(/could not be found/i);
    expect(supabase.uploadMock).not.toHaveBeenCalled();
  });

  it("first-ever upload: uploads to the fixed path and inserts exactly one item_images row, then redirects", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      existingCover: null,
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      uploadCoverAction("item-1", initialUploadCoverState, formDataWithFile(VALID_JPEG)),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    expect(supabase.uploadMock).toHaveBeenCalledTimes(1);
    const [path, , uploadOptions] = supabase.uploadMock.mock.calls[0];
    expect(path).toBe("user-1/item-1/cover");
    expect(uploadOptions).toMatchObject({ upsert: true, contentType: "image/jpeg" });

    expect(supabase.itemImagesInsertMock).toHaveBeenCalledTimes(1);
    expect(supabase.itemImagesInsertMock).toHaveBeenCalledWith({
      item_id: "item-1",
      storage_path: "user-1/item-1/cover",
      is_cover: true,
    });
  });

  it("replacing an existing cover overwrites the same storage object but never inserts a second item_images row", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      existingCover: { id: "image-1" },
    });
    createClientMock.mockResolvedValue(supabase);

    await expect(
      uploadCoverAction("item-1", initialUploadCoverState, formDataWithFile(VALID_JPEG)),
    ).rejects.toThrow("REDIRECT:/games/item-1");

    expect(supabase.uploadMock).toHaveBeenCalledTimes(1);
    expect(supabase.itemImagesInsertMock).not.toHaveBeenCalled();
  });

  it("a storage upload failure returns a clean error and never touches item_images", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1", category_id: "cat-1" },
      category: { slug: "games" },
      uploadError: { message: "storage exploded" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadCoverAction(
      "item-1",
      initialUploadCoverState,
      formDataWithFile(VALID_JPEG),
    );

    expect(result.error).toMatch(/failed to upload/i);
    expect(supabase.itemImagesInsertMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
