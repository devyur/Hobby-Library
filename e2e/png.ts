import zlib from "node:zlib";

// Minimal PNG encoder for e2e fixtures that need a real, sizeable image
// (issue #37's resize/compress tests) -- no image-library dependency, just
// Node's built-in zlib for the IDAT chunk's zlib-format deflate stream
// (RFC1950, exactly what PNG's IDAT expects) and a standard CRC32 for each
// chunk's trailer. Always encodes 8-bit RGBA (color type 6) so callers can
// freely mix opaque and transparent pixels; each scanline uses PNG's "Sub"
// filter (subtract the pixel to the left) so a smooth, photo-like gradient
// compresses close to how a real JPEG-derived PNG would, instead of
// exploding into tens of MB the way filter-none + per-pixel noise would.

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export type Rgba = [r: number, g: number, b: number, a: number];

export function buildPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): Buffer {
  const channels = 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  const rowPixels = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1; // filter type 1 == Sub

    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const off = x * channels;
      rowPixels[off] = r;
      rowPixels[off + 1] = g;
      rowPixels[off + 2] = b;
      rowPixels[off + 3] = a;
    }

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? rowPixels[i - channels] : 0;
      raw[rowStart + 1 + i] = (rowPixels[i] - left) & 0xff;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A smooth sinusoidal gradient -- large pixel dimensions, but (like a real
// photo re-saved as PNG) compresses to a few MB rather than the tens of MB
// pure per-pixel noise would produce at this resolution.
export function buildLargePhotoPng(width: number, height: number): Buffer {
  return buildPng(width, height, (x, y) => {
    const r = clamp8(128 + 100 * Math.sin(x / 300));
    const g = clamp8(128 + 100 * Math.sin(y / 300 + 1));
    const b = clamp8(128 + 100 * Math.sin((x + y) / 400 + 2));
    return [r, g, b, 255];
  });
}

// Left half opaque red, right half fully transparent -- for asserting the
// resize/re-encode pipeline preserves alpha instead of flattening it.
export function buildHalfTransparentPng(width: number, height: number): Buffer {
  return buildPng(width, height, (x) => {
    const transparent = x > width / 2;
    return [220, 40, 40, transparent ? 0 : 255];
  });
}

function clamp8(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
