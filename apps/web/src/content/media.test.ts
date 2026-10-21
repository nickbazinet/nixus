import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { closingPhoto, productTour } from "./media";
import { stages } from "./stages";

/*
 * `media.ts` is the one file you edit to change the site's imagery, and it states facts
 * about files it cannot see: where they are, and how big. A wrong number there does not
 * fail loudly — it renders a frame the wrong shape, with bars or a crop, and the page
 * shifts when the real file loads. So the numbers are checked against the files.
 */

// `__dirname` rather than `import.meta.url`: under jsdom the latter is an http: URL.
const PUBLIC = resolve(__dirname, "../../public");
const onDisk = (sitePath: string): string => `${PUBLIC}${sitePath}`;

type Box = { readonly type: string; readonly start: number; readonly end: number };

function boxesIn(buf: Buffer, start = 0, end = buf.length): Box[] {
  const out: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header) break;
    out.push({ type: buf.toString("latin1", pos + 4, pos + 8), start: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

/** Pixel size of the first video track: the `tkhd` box, 16.16 fixed point. */
function mp4Size(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  const moov = boxesIn(buf).find((box) => box.type === "moov");
  if (moov === undefined) throw new Error(`${file}: no moov box — not a playable MP4`);
  for (const trak of boxesIn(buf, moov.start, moov.end).filter((box) => box.type === "trak")) {
    const tkhd = boxesIn(buf, trak.start, trak.end).find((box) => box.type === "tkhd");
    if (tkhd === undefined) continue;
    const version = buf.readUInt8(tkhd.start);
    const at = tkhd.start + (version === 1 ? 88 : 76);
    const width = buf.readUInt32BE(at) >>> 16;
    const height = buf.readUInt32BE(at + 4) >>> 16;
    // Audio tracks carry a 0 x 0 size; the video track is the one with pixels.
    if (width > 0 && height > 0) return { width, height };
  }
  throw new Error(`${file}: no video track found`);
}

/** Pixel size of a WebP, PNG or JPEG without decoding it. */
function imageSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  const ext = extname(file).toLowerCase();
  if (ext === ".webp") {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8L") {
      const w = 1 + (((b[22] ?? 0) & 0x3f) << 8 | (b[21] ?? 0));
      const h = 1 + ((((b[24] ?? 0) & 0x0f) << 10) | ((b[23] ?? 0) << 2) | (((b[22] ?? 0) & 0xc0) >> 6));
      return { width: w, height: h };
    }
  }
  if (ext === ".png") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (ext === ".jpg" || ext === ".jpeg") {
    let pos = 2;
    while (pos + 9 < b.length) {
      if (b[pos] !== 0xff) { pos += 1; continue; }
      const marker = b[pos + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: b.readUInt16BE(pos + 7), height: b.readUInt16BE(pos + 5) };
      }
      pos += 2 + b.readUInt16BE(pos + 2);
    }
  }
  throw new Error(`${file}: poster must be .webp, .png or .jpg so its shape can be checked`);
}

describe("product tour media", () => {
  it("points at files that exist", () => {
    for (const path of [productTour.src, productTour.poster, closingPhoto.src]) {
      if (path === undefined) continue;
      expect(existsSync(onDisk(path)), `${path} is missing from apps/web/public`).toBe(true);
    }
  });

  /* The frame takes its shape from these two numbers. If they disagree with the file, the
   * film is letterboxed inside a frame of the wrong shape — the exact problem this layout
   * exists to avoid — and nothing else would notice. */
  it("declares the film's real pixel size", () => {
    if (productTour.src === undefined) return;
    expect({ width: productTour.width, height: productTour.height }).toEqual(
      mp4Size(onDisk(productTour.src)),
    );
  });

  it("has a poster in the film's shape", () => {
    if (productTour.poster === undefined) return;
    const poster = imageSize(onDisk(productTour.poster));
    const film = productTour.width / productTour.height;
    // A different shape would show bars until the first frame replaces the poster.
    expect(Math.abs(poster.width / poster.height - film) / film).toBeLessThan(0.005);
  });
});

/* The four stage rows alternate sides, so the height of each screenshot sets the height of
 * its row. Native ratios once ranged from 0.41 to 0.98, which swung the rows by more than
 * double and left dead space under the shorter text columns. 16:10 is the contract, and a
 * screenshot that drifts from it breaks the page's rhythm without failing anything else. */
describe("stage screenshots", () => {
  it.each(stages.map((stage) => [stage.id, stage.image] as const))(
    "%s is 1600 x 1000 (16:10) and exists",
    (_id, image) => {
      expect(existsSync(onDisk(image)), `${image} is missing from apps/web/public`).toBe(true);
      expect(imageSize(onDisk(image))).toEqual({ width: 1600, height: 1000 });
    },
  );
});
