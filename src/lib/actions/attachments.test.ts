import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit coverage for lib/actions/attachments.ts (issue #21), same
// createClient-mocking shape as lib/actions/covers.test.ts and
// lib/actions/links.test.ts -- focused on the branches e2e coverage
// (e2e/item-attachments.spec.ts) can exercise live but can't directly force
// or inspect: type/size/count rejection happening *before* any network
// round trip, the ownership/not-found checks short-circuiting before
// storage or item_attachments is ever touched, the id-keyed storage path
// and derived-not-trusted MIME type, the upload-then-insert-then-sign
// sequence (with cleanup on a post-upload insert failure), and remove's
// storage-then-row ordering.

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

const { uploadAttachmentAction, removeAttachmentAction } = await import("./attachments");

type FakeRow = Record<string, unknown> | null;

function itemsTable(item: FakeRow) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({ maybeSingle: async () => ({ data: item }) }),
        }),
      }),
    }),
  };
}

function fakeSupabase(options: {
  user?: { id: string } | null;
  item?: FakeRow;
  count?: number;
  attachment?: FakeRow;
  uploadError?: { message: string } | null;
  insertResult?: FakeRow;
  insertError?: { message: string } | null;
  signedUrl?: string | null;
  removeError?: { message: string } | null;
  deleteError?: { message: string } | null;
}) {
  const singleMock = vi.fn().mockResolvedValue({
    data: options.insertError ? null : (options.insertResult ?? null),
    error: options.insertError ?? null,
  });
  const selectAfterInsertMock = vi.fn(() => ({ single: singleMock }));
  const insertMock = vi.fn(() => ({ select: selectAfterInsertMock }));

  const secondEq = vi.fn().mockResolvedValue({ error: options.deleteError ?? null });
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const deleteMock = vi.fn(() => ({ eq: firstEq }));

  // Used for both uploadAttachmentAction's count query
  // (select("id", { count: "exact", head: true }).eq(...)) and
  // removeAttachmentAction's row lookup
  // (select("id, storage_path").eq(...).eq(...).maybeSingle()) --
  // distinguished by whether a count option was passed, since only one of
  // the two flows runs per test.
  const selectMock = vi.fn((_columns: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count) {
      return { eq: vi.fn().mockResolvedValue({ count: options.count ?? 0 }) };
    }
    return {
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: options.attachment ?? null }) }),
      }),
    };
  });

  const uploadMock = vi.fn(
    async (path: string, file: File, uploadOptions: { contentType: string }) => {
      void path;
      void file;
      void uploadOptions;
      return {
        data: options.uploadError ? null : { path: "irrelevant" },
        error: options.uploadError ?? null,
      };
    },
  );
  const removeMock = vi.fn(async (paths: string[]) => {
    void paths;
    return {
      data: options.removeError ? null : [],
      error: options.removeError ?? null,
    };
  });
  const createSignedUrlMock = vi.fn(
    async (path: string, ttl: number, signOptions: { download: string }) => {
      void path;
      void ttl;
      void signOptions;
      return {
        data: options.signedUrl ? { signedUrl: options.signedUrl } : null,
        error: null,
      };
    },
  );

  const fromMock = vi.fn((table: string) => {
    if (table === "items") return itemsTable(options.item ?? null);
    if (table === "item_attachments") {
      return { select: selectMock, insert: insertMock, delete: deleteMock };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });

  return {
    from: fromMock,
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        remove: removeMock,
        createSignedUrl: createSignedUrlMock,
      })),
    },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user ?? null } }) },
    uploadMock,
    removeMock,
    createSignedUrlMock,
    insertMock,
    deleteMock,
    selectMock,
  };
}

function makeFile(options: { name: string; sizeBytes: number }): File {
  return new File([new Uint8Array(options.sizeBytes)], options.name);
}

const VALID_TXT = makeFile({ name: "notes.txt", sizeBytes: 100 });

beforeEach(() => {
  createClientMock.mockReset();
});

describe("uploadAttachmentAction", () => {
  it("rejects a disallowed extension before ever calling createClient", async () => {
    const result = await uploadAttachmentAction(
      "item-1",
      makeFile({ name: "notes.exe", sizeBytes: 100 }),
    );

    expect(result).toEqual({ error: expect.stringMatching(/\.txt, \.md, or \.pdf/i) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects a .md file with an empty/unreliable File.type the same as any other allowed extension (MIME is derived, not trusted)", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      count: 0,
      insertResult: { id: "a-1", filename: "README.md", mime_type: "text/markdown", size_bytes: 10 },
    });
    createClientMock.mockResolvedValue(supabase);

    const file = new File([new Uint8Array(10)], "README.md", { type: "" });
    const result = await uploadAttachmentAction("item-1", file);

    expect("error" in result).toBe(false);
    const [, , uploadOptions] = supabase.uploadMock.mock.calls[0];
    expect(uploadOptions).toMatchObject({ contentType: "text/markdown" });
  });

  it("rejects a file over 2 MB before ever calling createClient", async () => {
    const oversized = makeFile({ name: "notes.txt", sizeBytes: 2 * 1024 * 1024 + 1 });

    const result = await uploadAttachmentAction("item-1", oversized);

    expect(result).toEqual({ error: expect.stringMatching(/2 mb or smaller/i) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an empty file before ever calling createClient", async () => {
    const result = await uploadAttachmentAction(
      "item-1",
      makeFile({ name: "notes.txt", sizeBytes: 0 }),
    );

    expect(result).toEqual({ error: expect.any(String) });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadAttachmentAction("item-1", VALID_TXT);

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one -- rejected before the count check", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadAttachmentAction("someone-elses-item", VALID_TXT);

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.uploadMock).not.toHaveBeenCalled();
  });

  it("rejects an 11th attachment (count already at the cap) without ever calling storage.upload", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      count: 10,
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadAttachmentAction("item-1", VALID_TXT);

    expect(result).toEqual({ error: expect.stringMatching(/maximum allowed/i) });
    expect(supabase.uploadMock).not.toHaveBeenCalled();
  });

  it("uploads to an id-keyed path, inserts the row, and resolves a download URL", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      count: 0,
      insertResult: {
        id: "attach-1",
        filename: "notes.txt",
        mime_type: "text/plain",
        size_bytes: 100,
      },
      signedUrl: "https://signed.example.com/notes.txt",
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadAttachmentAction("item-1", VALID_TXT);

    expect(supabase.uploadMock).toHaveBeenCalledTimes(1);
    const [path, , uploadOptions] = supabase.uploadMock.mock.calls[0];
    expect(path).toMatch(/^user-1\/item-1\/[0-9a-f-]{36}$/);
    expect(uploadOptions).toMatchObject({ contentType: "text/plain" });

    expect(supabase.insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: "item-1",
        storage_path: path,
        filename: "notes.txt",
        mime_type: "text/plain",
        size_bytes: 100,
      }),
    );

    expect(result).toEqual({
      attachment: {
        id: "attach-1",
        filename: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        downloadUrl: "https://signed.example.com/notes.txt",
      },
    });
  });

  it("a storage upload failure returns a clean error and never inserts a row", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      count: 0,
      uploadError: { message: "storage exploded" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadAttachmentAction("item-1", VALID_TXT);

    expect(result).toEqual({ error: expect.stringMatching(/failed to upload/i) });
    expect(supabase.insertMock).not.toHaveBeenCalled();
  });

  it("a DB insert failure after a successful upload removes the now-orphaned storage object", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      count: 0,
      insertError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await uploadAttachmentAction("item-1", VALID_TXT);

    expect(result).toEqual({ error: expect.stringMatching(/saving it failed/i) });
    expect(supabase.removeMock).toHaveBeenCalledTimes(1);
  });
});

describe("removeAttachmentAction", () => {
  it("rejects an unauthenticated request without touching the database", async () => {
    const supabase = fakeSupabase({ user: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeAttachmentAction("item-1", "attach-1");

    expect(result).toEqual({ error: expect.stringMatching(/signed in/i) });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("treats another user's item id the same as a nonexistent one", async () => {
    const supabase = fakeSupabase({ user: { id: "user-1" }, item: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeAttachmentAction("someone-elses-item", "attach-1");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.removeMock).not.toHaveBeenCalled();
  });

  it("returns an error for an attachment id that isn't on this item, without touching storage", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      attachment: null,
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeAttachmentAction("item-1", "not-this-items-attachment");

    expect(result).toEqual({ error: expect.stringMatching(/could not be found/i) });
    expect(supabase.removeMock).not.toHaveBeenCalled();
  });

  it("deletes the storage object before the item_attachments row", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      attachment: { id: "attach-1", storage_path: "user-1/item-1/attach-1" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeAttachmentAction("item-1", "attach-1");

    expect(result).toEqual({ success: true });
    expect(supabase.removeMock).toHaveBeenCalledWith(["user-1/item-1/attach-1"]);
    expect(supabase.deleteMock).toHaveBeenCalledTimes(1);
    expect(
      supabase.removeMock.mock.invocationCallOrder[0],
    ).toBeLessThan(supabase.deleteMock.mock.invocationCallOrder[0]);
  });

  it("a storage removal failure returns an error and never deletes the row (nothing orphaned)", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      attachment: { id: "attach-1", storage_path: "user-1/item-1/attach-1" },
      removeError: { message: "storage exploded" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeAttachmentAction("item-1", "attach-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to remove/i) });
    expect(supabase.deleteMock).not.toHaveBeenCalled();
  });

  it("a DB delete failure after a successful storage removal still returns an error", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1" },
      item: { id: "item-1" },
      attachment: { id: "attach-1", storage_path: "user-1/item-1/attach-1" },
      deleteError: { message: "boom" },
    });
    createClientMock.mockResolvedValue(supabase);

    const result = await removeAttachmentAction("item-1", "attach-1");

    expect(result).toEqual({ error: expect.stringMatching(/failed to remove/i) });
    expect(supabase.removeMock).toHaveBeenCalledTimes(1);
  });
});
