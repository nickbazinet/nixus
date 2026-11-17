import { AVATAR_MAX_DECODED_BYTES, AVATAR_MAX_EDGE_PX, type AvatarMimeType } from "@nixus/shared";

/**
 * The browser produces the stored derivative (AD-5).
 *
 * The contract is identical on every surface — PNG or JPEG, longest edge
 * ≤ 256 px, ≤ 64 KiB of DECODED bytes — and the profile API re-checks all of it.
 * Producing it here means the original photo never leaves the machine, and the
 * filename is never read, so it cannot reach a request or a log.
 *
 * Fitting under the byte ceiling is a search, not a calculation: PNG and JPEG
 * sizes depend on image content. Quality is stepped down first because it costs
 * no resolution, and only then is the edge shortened.
 */

const JPEG_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3] as const;
const EDGE_STEPS = [AVATAR_MAX_EDGE_PX, 224, 192, 160, 128] as const;

export interface AvatarDerivative {
  readonly mime_type: AvatarMimeType;
  /** Base64 of the derivative's bytes. */
  readonly data: string;
  readonly decoded_bytes: number;
  /** Object URL for the preview; the caller revokes it. */
  readonly preview: string;
}

export class AvatarTooComplexError extends Error {}
export class AvatarUnreadableError extends Error {}

function scaled(width: number, height: number, maxEdge: number): [number, number] {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return [width, height];
  const ratio = maxEdge / longest;
  return [Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))];
}

function encode(canvas: HTMLCanvasElement, type: AvatarMimeType, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new AvatarUnreadableError("encode failed"))),
      type,
      quality,
    );
  });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function draw(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const [width, height] = scaled(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new AvatarUnreadableError("no 2d context");
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

async function firstFittingBlob(bitmap: ImageBitmap): Promise<{ blob: Blob; type: AvatarMimeType }> {
  for (const edge of EDGE_STEPS) {
    const canvas = draw(bitmap, edge);

    const png = await encode(canvas, "image/png");
    if (png.size <= AVATAR_MAX_DECODED_BYTES) return { blob: png, type: "image/png" };

    for (const quality of JPEG_QUALITIES) {
      const jpeg = await encode(canvas, "image/jpeg", quality);
      if (jpeg.size <= AVATAR_MAX_DECODED_BYTES) return { blob: jpeg, type: "image/jpeg" };
    }
  }
  throw new AvatarTooComplexError("cannot fit the byte ceiling");
}

export async function makeAvatarDerivative(file: File): Promise<AvatarDerivative> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarUnreadableError("not an image");
  }

  try {
    const { blob, type } = await firstFittingBlob(bitmap);
    return {
      mime_type: type,
      data: await toBase64(blob),
      decoded_bytes: blob.size,
      preview: URL.createObjectURL(blob),
    };
  } finally {
    bitmap.close();
  }
}
