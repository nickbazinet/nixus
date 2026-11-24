// @vitest-environment node
// Required: the jsdom default breaks the file-URL resolution this test relies on.

import { describe, expect, it } from "vitest";

import { loadRewriteHandler, rewriteUri } from "./loadRewriteHandler";

const handler = loadRewriteHandler();
const rewrite = (uri: string) => rewriteUri(handler, uri);

describe("spa-index-rewrite viewer request", () => {
  it("maps a directory URI onto its index.html object", () => {
    expect(rewrite("/")).toBe("/index.html");
    expect(rewrite("/fr/")).toBe("/fr/index.html");
    expect(rewrite("/beta/")).toBe("/beta/index.html");
  });

  it("maps an extensionless route onto its index.html object", () => {
    expect(rewrite("/beta")).toBe("/beta/index.html");
    expect(rewrite("/fr")).toBe("/fr/index.html");
    expect(rewrite("/fr/beta")).toBe("/fr/beta/index.html");
    expect(rewrite("/404")).toBe("/404/index.html");
    expect(rewrite("/fr/404")).toBe("/fr/404/index.html");
  });

  it("maps every French marketing route onto its own object", () => {
    // The whole FR half of the site reaches the edge as `/fr/<en-slug>`, so a
    // rule that special-cased the prefix would strand every page but the index.
    for (const slug of [
      "features",
      "pricing",
      "mission",
      "privacy",
      "founding-users",
      "download",
      "terms",
      "privacy-policy",
    ]) {
      expect(rewrite(`/fr/${slug}`)).toBe(`/fr/${slug}/index.html`);
      expect(rewrite(`/fr/${slug}/`)).toBe(`/fr/${slug}/index.html`);
    }
  });

  it("leaves a URI with a file extension untouched", () => {
    for (const asset of [
      "/og-image.png",
      "/favicon.svg",
      "/robots.txt",
      "/sitemap.xml",
      "/assets/main-DGP0dY5H.css",
      "/beta/accounts.png",
      "/apple-touch-icon.png",
    ]) {
      expect(rewrite(asset)).toBe(asset);
    }
  });

  it("treats a dotted directory segment as a route, not an asset", () => {
    // AWS's stock sample tests the whole URI for a dot and would pass this
    // through to a nonexistent S3 key.
    expect(rewrite("/v1.2/beta")).toBe("/v1.2/beta/index.html");
  });

  it("does not map an unknown extensionless route to the homepage", () => {
    // Both homepages matter: a French visitor on a mistyped French URL must get
    // a 404, not the French index at 200.
    for (const unknown of ["/nope", "/fr/nope", "/beta/nope", "/fr/unknown/deeper"]) {
      const rewritten = rewrite(unknown);
      expect(rewritten).not.toBe("/index.html");
      expect(rewritten).not.toBe("/fr/index.html");
      expect(rewritten).toBe(`${unknown}/index.html`);
    }
  });

  it("rewrites idempotently, so a resolved object is never re-suffixed", () => {
    expect(rewrite(rewrite("/beta"))).toBe("/beta/index.html");
  });

  it("mutates only the uri of the request it is handed back", () => {
    const request = { uri: "/beta" };

    const returned = handler({ request });

    expect(returned).toBe(request);
    expect(returned.uri).toBe("/beta/index.html");
  });
});
