import { afterEach, describe, expect, it, vi } from "vitest";

import { resizeCoverImage } from "./resizeCoverImage";

// jsdom doesn't implement a real Canvas 2D context / createImageBitmap, so
// each test stubs the browser APIs resizeCoverImage.ts calls directly --
// this exercises the module's own scaling math, WebP re-encode, and
// fallback-on-failure branches without needing a real image decoder.

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function stubBitmap(width: number, height: number) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue(bitmap),
  );
  return { bitmap, close };
}

function stubOffscreenCanvas(blob: Blob | null, capture: { width?: number; height?: number }) {
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      capture.width = width;
      capture.height = height;
    }
    getContext() {
      return { drawImage: vi.fn() };
    }
    convertToBlob() {
      return Promise.resolve(blob);
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
}

describe("resizeCoverImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scales a large image down to 800px on the long edge and re-encodes to webp", async () => {
    const { close } = stubBitmap(4000, 3000);
    const capture: { width?: number; height?: number } = {};
    const blob = new Blob(["resized"], { type: "image/webp" });
    stubOffscreenCanvas(blob, capture);

    const original = makeFile("photo.png", "image/png");
    const result = await resizeCoverImage(original);

    expect(result).not.toBe(original);
    expect(result.type).toBe("image/webp");
    expect(result.name).toBe("photo.webp");
    expect(capture).toEqual({ width: 800, height: 600 });
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not upscale a source already under the 800px cap", async () => {
    stubBitmap(400, 300);
    const capture: { width?: number; height?: number } = {};
    stubOffscreenCanvas(new Blob(["resized"], { type: "image/webp" }), capture);

    const result = await resizeCoverImage(makeFile("small.jpg", "image/jpeg"));

    expect(capture).toEqual({ width: 400, height: 300 });
    expect(result.type).toBe("image/webp");
  });

  it("re-encodes a transparent PNG to webp (alpha-capable) rather than JPEG", async () => {
    stubBitmap(1000, 1000);
    stubOffscreenCanvas(new Blob(["resized"], { type: "image/webp" }), {});

    const result = await resizeCoverImage(makeFile("logo.png", "image/png"));

    expect(result.type).toBe("image/webp");
  });

  it("falls back to the original file when the canvas produces no blob", async () => {
    stubBitmap(4000, 3000);
    stubOffscreenCanvas(null, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const original = makeFile("photo.png", "image/png");
    const result = await resizeCoverImage(original);

    expect(result).toBe(original);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back to the original file when createImageBitmap throws", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode failed")),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const original = makeFile("photo.png", "image/png");
    const result = await resizeCoverImage(original);

    expect(result).toBe(original);
    expect(warn).toHaveBeenCalledOnce();
  });
});
