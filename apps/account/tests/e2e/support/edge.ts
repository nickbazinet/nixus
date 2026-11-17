import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";

/**
 * Stand-in for the CloudFront distribution.
 *
 * It exists because the Lambda server deliberately serves NO static files: in
 * production `/assets/*` comes from S3 through the same distribution, and without
 * that split the page never hydrates and every interaction test silently measures
 * server-rendered HTML.
 *
 * It also reproduces the one CloudFront behaviour the app's security depends on:
 * the viewer's `Host` is NOT forwarded (the managed `AllViewerExceptHostHeader`
 * policy), so the server sees a different host than the browser used — which is
 * why the app derives its origin from configuration.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface RunningEdge {
  readonly origin: string;
  close: () => Promise<void>;
}

export async function startEdge(input: {
  port: number;
  serverOrigin: string;
  clientDir: string;
}): Promise<RunningEdge> {
  const server: Server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");

      if (url.pathname.startsWith("/assets/")) {
        // `normalize` before joining: a `..` in the path must not escape the dir.
        const file = join(input.clientDir, normalize(url.pathname));
        if (!file.startsWith(input.clientDir) || !existsSync(file) || !statSync(file).isFile()) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
        });
        createReadStream(file).pipe(response);
        return;
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined || name === "host" || name === "connection") continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk as Buffer);

      const upstream = await fetch(`${input.serverOrigin}${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
      });

      const outgoing = new Headers(upstream.headers);
      outgoing.delete("set-cookie");
      response.writeHead(upstream.status, {
        ...Object.fromEntries(outgoing.entries()),
        // Multiple Set-Cookie headers survive only as an array.
        ...(upstream.headers.getSetCookie().length > 0
          ? { "set-cookie": upstream.headers.getSetCookie() }
          : {}),
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    })();
  });

  await new Promise<void>((resolve) => server.listen(input.port, "127.0.0.1", resolve));

  return {
    origin: `http://127.0.0.1:${input.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
