/**
 * Static preview server for the responsive E2E suite.
 *
 * Serves `.output/public` — the exact objects CloudFront serves — through the
 * exact viewer-request function that ships (`infra/cloudfront/spa-index-rewrite.js`),
 * and answers a miss with the real `/404/index.html` object at status 404.
 *
 * Why not `vite preview`: that boots the Nitro SSR server on the app's dev port,
 * which (a) is not what production serves and (b) collides with whatever else is
 * on port 3000. This server is the production artifact plus the production edge
 * rule, on a port nothing else claims.
 *
 * Run: pnpm --filter @nixus/web preview:static   (build first)
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrotliCompress, createGzip } from "node:zlib";

import {
  loadRewriteHandler,
  rewriteUri,
} from "../infra/cloudfront/loadRewriteHandler.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)), ".output/public");
const PORT = Number(process.env.WEB_PREVIEW_PORT ?? 4319);
const NOT_FOUND_OBJECT = join(ROOT, "404", "index.html");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * Text types CloudFront compresses. Serving them raw makes a Lighthouse run
 * measure this server's transfer size instead of the site's — the 73 KB
 * stylesheet reads as 1.2s of render blocking uncompressed and ~10 KB
 * compressed.
 */
const COMPRESSIBLE = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".map",
  ".txt",
  ".xml",
  ".svg",
]);

function contentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Parses a single `Range: bytes=a-b` request. `null` means "serve the whole
 * object" (no header, or a form this server does not honour); `"unsatisfiable"`
 * is a 416. S3 behind CloudFront answers ranges natively, and a video element
 * needs them: Safari refuses to play a file it cannot seek, and every browser
 * seeks by range. Without this the local server would pass in Chromium and fail
 * in the browser the video is most likely to be watched in.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (match === null) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return null;
  // `bytes=-500` is the last 500 bytes.
  const start = from === "" ? Math.max(size - Number(to), 0) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}

/** Hashed build assets are immutable; HTML must revalidate to pick up a deploy. */
function cacheControl(filePath: string): string {
  return filePath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

/** Resolved file inside ROOT, or `null` for a miss or an escape attempt. */
function resolveObject(uri: string): string | null {
  const candidate = resolve(join(ROOT, normalize(uri)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
  return candidate;
}

function encodingFor(filePath: string, acceptEncoding: string): "br" | "gzip" | null {
  if (!COMPRESSIBLE.has(extname(filePath).toLowerCase())) return null;
  if (acceptEncoding.includes("br")) return "br";
  if (acceptEncoding.includes("gzip")) return "gzip";
  return null;
}

if (!existsSync(ROOT)) {
  throw new Error(
    `${ROOT} does not exist — run \`pnpm --filter @nixus/web build\` first.`,
  );
}

const rewrite = loadRewriteHandler();

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url ?? "/", `http://localhost:${PORT}`).pathname,
  );
  const found = resolveObject(rewriteUri(rewrite, pathname));
  const object = found ?? NOT_FOUND_OBJECT;
  const acceptEncoding = String(request.headers["accept-encoding"] ?? "");
  const encoding = encodingFor(object, acceptEncoding);

  const size = statSync(object).size;
  const range =
    encoding === null && found !== null
      ? parseRange(request.headers.range, size)
      : null;

  if (range === "unsatisfiable") {
    response.writeHead(416, { "content-range": `bytes */${size}` });
    response.end();
    return;
  }

  response.writeHead(range === null ? (found === null ? 404 : 200) : 206, {
    "content-type": contentType(object),
    "cache-control": cacheControl(object),
    vary: "accept-encoding",
    ...(encoding === null
      ? {
          "accept-ranges": "bytes",
          "content-length": String(range === null ? size : range.end - range.start + 1),
        }
      : { "content-encoding": encoding }),
    ...(range === null
      ? {}
      : { "content-range": `bytes ${range.start}-${range.end}/${size}` }),
  });

  if (range !== null) {
    createReadStream(object, { start: range.start, end: range.end }).pipe(response);
    return;
  }

  const body = createReadStream(object);
  if (encoding === "br") {
    body.pipe(createBrotliCompress()).pipe(response);
    return;
  }
  if (encoding === "gzip") {
    body.pipe(createGzip()).pipe(response);
    return;
  }
  body.pipe(response);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`static preview: http://127.0.0.1:${PORT}\n`);
});
