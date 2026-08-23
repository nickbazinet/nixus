/**
 * Test/verification seam for `spa-index-rewrite.js`.
 *
 * The deployed artifact must expose `handler` as a global (CloudFront's
 * contract), so it cannot be imported as a module. Evaluating the real file in
 * a fresh VM context keeps tests and the route verifier pointed at the exact
 * source that ships, instead of a re-implementation that can drift from it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

export type ViewerRequest = { uri: string };
export type ViewerRequestEvent = { request: ViewerRequest };
export type RewriteHandler = (event: ViewerRequestEvent) => ViewerRequest;

export const REWRITE_FUNCTION_PATH = fileURLToPath(
  new URL("./spa-index-rewrite.js", import.meta.url),
);

export function loadRewriteHandler(): RewriteHandler {
  const source = readFileSync(REWRITE_FUNCTION_PATH, "utf8");
  const loaded: unknown = runInNewContext(`${source}\nhandler;`);
  if (typeof loaded !== "function") {
    throw new Error(
      `${REWRITE_FUNCTION_PATH} must declare a global \`handler\` function`,
    );
  }

  // Dynamically evaluated source: `typeof` is the only structural proof the
  // type system can get, so the result shape is checked on every call.
  const handler = loaded as RewriteHandler;
  return (event) => {
    const result = handler(event);
    if (typeof result?.uri !== "string") {
      throw new Error("handler must return a request carrying a string uri");
    }
    return result;
  };
}

/** Rewritten URI for a viewer request path. */
export function rewriteUri(handler: RewriteHandler, uri: string): string {
  return handler({ request: { uri } }).uri;
}
