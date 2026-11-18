import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";

/** Shared plumbing for the three local fakes the E2E suite runs against. */

export interface JsonRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

export type Route = (
  request: JsonRequest,
  response: ServerResponse,
) => Promise<boolean> | boolean;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export interface RunningFake {
  readonly origin: string;
  close: () => Promise<void>;
}

export async function startFake(name: string, route: Route): Promise<RunningFake> {
  const server: Server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const handled = await route(
        {
          method: incoming.method ?? "GET",
          url,
          headers: incoming.headers,
          body: await readBody(incoming),
        },
        response,
      );
      if (!handled) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ fake: name, path: url.pathname }));
      }
    })();
  });

  // Port 0: two checkouts of the repo must be able to run this suite at once.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Since Node 19 `close()` waits on idle keep-alive sockets, and the
        // browser holds several per origin — so without this the teardown of a
        // spec that navigated more than once or twice never resolves.
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function sendJson(response: ServerResponse, status: number, body: unknown): true {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
  return true;
}
