import { AVATAR_MIME_TYPES, type AvatarMimeType } from "@nixus/shared";

/*
 * Container headers parsed by hand, bounds-checked through explicit index reads,
 * and failing closed: an image whose dimensions cannot be determined is refused
 * rather than stored (AD-5). No decoder is involved, so a crafted file can cost
 * nothing beyond this scan.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

export function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, PNG_SIGNATURE);
}

export function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, JPEG_SIGNATURE);
}

/** The mime the client declared must be the one the bytes actually are. */
export function mimeMatchesMagic(
  mimeType: AvatarMimeType,
  bytes: Uint8Array
): boolean {
  return mimeType === "image/png" ? isPng(bytes) : isJpeg(bytes);
}

export function detectedMimeType(
  bytes: Uint8Array
): AvatarMimeType | undefined {
  if (isPng(bytes)) return AVATAR_MIME_TYPES[0];
  if (isJpeg(bytes)) return AVATAR_MIME_TYPES[1];
  return undefined;
}

function readU16(bytes: Uint8Array, offset: number): number | undefined {
  const high = bytes[offset];
  const low = bytes[offset + 1];
  if (high === undefined || low === undefined) return undefined;
  return (high << 8) | low;
}

function readU32(bytes: Uint8Array, offset: number): number | undefined {
  const high = readU16(bytes, offset);
  const low = readU16(bytes, offset + 2);
  if (high === undefined || low === undefined) return undefined;
  // Widened before combining: a 0xFFFFFFFF width must not come out negative.
  return high * 0x10000 + low;
}

const PNG_IHDR: readonly number[] = [0x49, 0x48, 0x44, 0x52];

function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // Signature (8) + length (4) + "IHDR" (4) + width (4) + height (4).
  if (bytes.length < 24) return undefined;
  if (!PNG_IHDR.every((byte, index) => bytes[12 + index] === byte)) {
    return undefined;
  }

  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (width === undefined || height === undefined) return undefined;
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}

/** SOF0-SOF15, minus DHT (0xC4), JPG (0xC8) and DAC (0xCC), which are not frame headers. */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

const STANDALONE_MARKERS: readonly number[] = [
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
];

function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;

    // A marker may be preceded by any number of 0xFF fill bytes.
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;

    const marker = bytes[markerOffset];
    if (marker === undefined) return undefined;

    if (STANDALONE_MARKERS.includes(marker)) {
      offset = markerOffset + 1;
      continue;
    }

    // Start of scan or end of image: the frame header is behind us or absent.
    if (marker === 0xda || marker === 0xd9) return undefined;

    const segmentLength = readU16(bytes, markerOffset + 1);
    if (segmentLength === undefined || segmentLength < 2) return undefined;

    if (isStartOfFrame(marker)) {
      // length (2) + precision (1) + height (2) + width (2)
      if (segmentLength < 7) return undefined;
      const height = readU16(bytes, markerOffset + 4);
      const width = readU16(bytes, markerOffset + 6);
      if (width === undefined || height === undefined) return undefined;
      if (width === 0 || height === 0) return undefined;
      return { width, height };
    }

    offset = markerOffset + 1 + segmentLength;
  }

  return undefined;
}

export function readImageDimensions(
  bytes: Uint8Array
): ImageDimensions | undefined {
  if (isPng(bytes)) return pngDimensions(bytes);
  if (isJpeg(bytes)) return jpegDimensions(bytes);
  return undefined;
}
