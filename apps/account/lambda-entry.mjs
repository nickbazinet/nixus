// AWS Lambda Web Function entry wrapper for the TanStack Start plain-Node server
// build. Verbatim from the Phase 0 hosting spike, which proved every fact below.
//
// Lambda sets AWS_LAMBDA_HTTP_ENDPOINT to "host:port" (NOT a URL) and the server
// must begin listening within 10s of start. Lambda does not verify that: an Active
// revision whose server never listened just returns errors at request time.
//
// Lambda terminates TLS at the endpoint and forwards plain HTTP with X-Forwarded-*
// populated, so trustProxy is correct here and nowhere else.
import { serve } from "srvx";
import app from "./server/server.js";

const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? "127.0.0.1:3000";
const separator = endpoint.lastIndexOf(":");
const hostname = endpoint.slice(0, separator);
const port = Number(endpoint.slice(separator + 1));

const server = serve({
  hostname,
  port,
  trustProxy: true,
  fetch: (request) => app.fetch(request),
});

await server.ready();
console.log(JSON.stringify({ level: "info", route: "cold-start", code: "listening" }));
