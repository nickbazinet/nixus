/**
 * Unit tests for the SEO meta helper (Story 4.2).
 *
 * Coverage matrix:
 *   1. Defaults: every required meta tag (description, OG, Twitter, canonical)
 *      is present with the SITE-level defaults when no input is provided.
 *   2. Description length: the default description sits in the SEO sweet spot
 *      (~150–160 chars) so search snippets don't get truncated.
 *   3. Title override: passing `title` updates `<title>`, og:title, and
 *      twitter:title — they MUST stay in sync.
 *   4. Path → canonical: passing `path` builds a correct absolute URL for
 *      the canonical link and og:url tag.
 *   5. ogImage override: passing `ogImage` updates both og:image and
 *      twitter:image (consumer expectation: pass once, get both).
 */

import { describe, expect, it } from "vitest";

// Initialize i18n so buildMeta's getFixedT can resolve title/description.
import "./i18n";
import { jsonLdScript } from "./jsonLd";
import { buildMeta, SITE } from "./meta";

/**
 * Helper: pull a single meta-tag entry out of `buildMeta`'s result by its
 * `name` or `property` attribute. Returns the `content` string, or undefined
 * if no such tag exists. Keeps the test bodies readable.
 */
function metaContent(
  result: ReturnType<typeof buildMeta>,
  selector: { name?: string; property?: string },
): string | undefined {
  const entry = result.meta.find((m) => {
    if (selector.name && "name" in m) return m.name === selector.name;
    if (selector.property && "property" in m)
      return m.property === selector.property;
    return false;
  });
  if (!entry) return undefined;
  return "content" in entry ? entry.content : undefined;
}

/** Helper: pull the `<title>` entry out of buildMeta's `meta` array. */
function metaTitle(result: ReturnType<typeof buildMeta>): string | undefined {
  const entry = result.meta.find(
    (m): m is { title: string } => "title" in m && typeof m.title === "string",
  );
  return entry?.title;
}

describe("buildMeta", () => {
  it("returns default title, description, OG, Twitter, and canonical tags when given no input", () => {
    const result = buildMeta();

    expect(metaTitle(result)).toBe(SITE.defaultTitle);
    expect(metaContent(result, { name: "description" })).toBe(
      SITE.defaultDescription,
    );

    // Open Graph essentials — type, site_name, title, description, url, image.
    expect(metaContent(result, { property: "og:type" })).toBe("website");
    expect(metaContent(result, { property: "og:site_name" })).toBe(SITE.name);
    expect(metaContent(result, { property: "og:title" })).toBe(
      SITE.defaultTitle,
    );
    expect(metaContent(result, { property: "og:description" })).toBe(
      SITE.defaultDescription,
    );
    expect(metaContent(result, { property: "og:url" })).toBe(`${SITE.url}/`);
    expect(metaContent(result, { property: "og:image" })).toBe(SITE.ogImage);
    expect(metaContent(result, { property: "og:image:width" })).toBe("1200");
    expect(metaContent(result, { property: "og:image:height" })).toBe("630");
    expect(metaContent(result, { property: "og:locale" })).toBe("en_US");

    // Twitter card.
    expect(metaContent(result, { name: "twitter:card" })).toBe(
      "summary_large_image",
    );
    expect(metaContent(result, { name: "twitter:title" })).toBe(
      SITE.defaultTitle,
    );
    expect(metaContent(result, { name: "twitter:description" })).toBe(
      SITE.defaultDescription,
    );
    expect(metaContent(result, { name: "twitter:image" })).toBe(SITE.ogImage);

    // Canonical link points at the site root, with the same single trailing
    // slash the sitemap and hreflang alternates use.
    expect(result.links).toContainEqual({
      rel: "canonical",
      href: `${SITE.url}/`,
    });

    // hreflang alternates emitted on every page.
    expect(result.links).toContainEqual({
      rel: "alternate",
      hrefLang: "en",
      href: `${SITE.url}/`,
    });
    expect(result.links).toContainEqual({
      rel: "alternate",
      hrefLang: "fr",
      href: `${SITE.url}/fr/`,
    });
    expect(result.links).toContainEqual({
      rel: "alternate",
      hrefLang: "x-default",
      href: `${SITE.url}/`,
    });
  });

  it("emits og:locale=fr_CA + canonical at /fr/ when locale=fr", () => {
    const result = buildMeta({ locale: "fr" });
    expect(metaContent(result, { property: "og:locale" })).toBe("fr_CA");
    expect(metaContent(result, { property: "og:locale:alternate" })).toBe(
      "en_US",
    );
    expect(result.links).toContainEqual({
      rel: "canonical",
      href: `${SITE.url}/fr/`,
    });
    // FR title comes from the FR translation file.
    expect(metaTitle(result)).toMatch(/Finances personnelles/);
  });

  it("uses a default description in the SEO-sweet-spot length range", () => {
    // Search snippets typically truncate ~155–160 chars; below ~100 looks
    // thin. Asserting a band guards against future edits drifting out of it.
    const len = SITE.defaultDescription.length;
    expect(len).toBeGreaterThanOrEqual(100);
    expect(len).toBeLessThanOrEqual(200);
  });

  it("propagates a custom title to <title>, og:title, and twitter:title", () => {
    const result = buildMeta({ title: "Custom — Nixus" });

    expect(metaTitle(result)).toBe("Custom — Nixus");
    expect(metaContent(result, { property: "og:title" })).toBe("Custom — Nixus");
    expect(metaContent(result, { name: "twitter:title" })).toBe(
      "Custom — Nixus",
    );
  });

  it("builds canonical and og:url from a path argument", () => {
    const result = buildMeta({ path: "/foo" });

    expect(result.links).toContainEqual({
      rel: "canonical",
      href: `${SITE.url}/foo`,
    });
    expect(metaContent(result, { property: "og:url" })).toBe(
      `${SITE.url}/foo`,
    );
  });

  it("propagates a custom ogImage to og:image and twitter:image", () => {
    const override = "https://example.com/custom-og.png";
    const result = buildMeta({ ogImage: override });

    expect(metaContent(result, { property: "og:image" })).toBe(override);
    expect(metaContent(result, { name: "twitter:image" })).toBe(override);
  });

  it("attaches the locale's JSON-LD graph as a head script", () => {
    const result = buildMeta({ locale: "fr", path: "/fr/beta" });

    expect(result.scripts).toEqual([jsonLdScript("fr")]);
  });
});

describe("site identity", () => {
  it("declares nixusapp.com as the public origin, with no trailing slash", () => {
    expect(SITE.url).toBe("https://nixusapp.com");
    expect(SITE.ogImage).toBe("https://nixusapp.com/og-image.png");
  });

  /** Absolute URLs emitted for a page, across meta, links, and JSON-LD. */
  function emittedUrls(result: ReturnType<typeof buildMeta>): string[] {
    const fromMeta = result.meta.flatMap((entry) =>
      "content" in entry && typeof entry.content === "string"
        ? [entry.content]
        : [],
    );
    const fromLinks = result.links.map((link) => link.href);
    const fromJsonLd = result.scripts.flatMap(
      (script) => script.children.match(/https?:\/\/[^"]+/g) ?? [],
    );
    return [...fromMeta, ...fromLinks, ...fromJsonLd].filter((value) =>
      value.startsWith("http"),
    );
  }

  it("keeps every emitted URL on the canonical origin, on both locales", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const url of emittedUrls(buildMeta({ locale }))) {
        expect(
          url.startsWith(`${SITE.url}/`) ||
            url === "https://schema.org" ||
            url === SITE.repositoryUrl,
        ).toBe(true);
      }
    }
  });

  it("never emits the retired marketing hostname", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const url of emittedUrls(buildMeta({ locale }))) {
        expect(url).not.toContain("nixus.nicolasbazinet.net");
      }
    }
  });

  it("agrees between root canonical, og:url, and the x-default alternate", () => {
    const result = buildMeta({ locale: "en" });
    const canonical = result.links.find((link) => link.rel === "canonical");
    const xDefault = result.links.find(
      (link) => "hrefLang" in link && link.hrefLang === "x-default",
    );

    expect(canonical?.href).toBe(`${SITE.url}/`);
    expect(canonical?.href).toBe(xDefault?.href);
    expect(metaContent(result, { property: "og:url" })).toBe(canonical?.href);
  });

  it("agrees between canonical and og:url on a nested locale route", () => {
    const result = buildMeta({ locale: "fr", path: "/fr/beta" });
    const canonical = result.links.find((link) => link.rel === "canonical");

    expect(canonical?.href).toBe(`${SITE.url}/fr/beta`);
    expect(metaContent(result, { property: "og:url" })).toBe(canonical?.href);
  });
});
