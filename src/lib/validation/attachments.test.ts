import { describe, expect, it } from "vitest";

import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  getFileExtension,
  isAllowedAttachmentExtension,
  resolveAttachmentMimeType,
} from "./attachments";

// Unit tests for the shared extension/MIME constants backing file
// attachment uploads (issue #21) -- both ItemAttachmentsEditor's client
// pre-check and uploadAttachmentAction's server re-check
// (lib/actions/attachments.ts) rely on these.

describe("getFileExtension", () => {
  it("returns the lowercased extension with no leading dot", () => {
    expect(getFileExtension("notes.TXT")).toBe("txt");
    expect(getFileExtension("guide.pdf")).toBe("pdf");
    expect(getFileExtension("README.md")).toBe("md");
  });

  it("returns only the final extension for a multi-dot filename", () => {
    expect(getFileExtension("archive.tar.gz")).toBe("gz");
  });

  it("returns an empty string for a filename with no extension", () => {
    expect(getFileExtension("README")).toBe("");
  });

  it("returns an empty string for a filename ending in a bare dot", () => {
    expect(getFileExtension("notes.")).toBe("");
  });

  it("returns an empty string for a dotfile with no further extension", () => {
    expect(getFileExtension(".gitignore")).toBe("");
  });
});

describe("isAllowedAttachmentExtension", () => {
  it("accepts exactly txt, md, and pdf", () => {
    for (const extension of ALLOWED_ATTACHMENT_EXTENSIONS) {
      expect(isAllowedAttachmentExtension(extension)).toBe(true);
    }
  });

  it("rejects anything else, including a browser-renderable but disallowed type", () => {
    expect(isAllowedAttachmentExtension("html")).toBe(false);
    expect(isAllowedAttachmentExtension("png")).toBe(false);
    expect(isAllowedAttachmentExtension("")).toBe(false);
  });
});

describe("resolveAttachmentMimeType", () => {
  it("maps each allowed extension to its canonical MIME type, case-insensitively", () => {
    expect(resolveAttachmentMimeType("notes.txt")).toBe("text/plain");
    expect(resolveAttachmentMimeType("NOTES.TXT")).toBe("text/plain");
    expect(resolveAttachmentMimeType("README.md")).toBe("text/markdown");
    expect(resolveAttachmentMimeType("guide.pdf")).toBe("application/pdf");
  });

  it("returns null for a disallowed extension, regardless of the browser-supplied File.type", () => {
    expect(resolveAttachmentMimeType("notes.exe")).toBeNull();
    expect(resolveAttachmentMimeType("no-extension")).toBeNull();
  });
});
