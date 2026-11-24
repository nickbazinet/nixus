import { describe, expect, it } from "vitest";

import { copyFor } from "@/content/index";
import { buildMeta } from "@/lib/meta";
import { LANG_TAG, LOCALES, OG_LOCALE, otherLocale, type Locale } from "@/lib/locale";
import { PAGES, canonicalAlternates, canonicalPath, isNoindex, type PageId } from "@/lib/routes";

/*
 * `verify:prerender` checks these same invariants against the built HTML, which
 * is the authority. These tests are the fast half of the same contract: they
 * fail in a second when `buildMeta` loses a tag, instead of after a full build.
 */

const ORIGIN = "https://nixusapp.com";

function metaOf(page: PageId, locale: Locale) {
  const built = buildMeta({ page, locale });
  const byKey = new Map<string, string>();
  for (const tag of built.meta) {
    if (tag.title !== undefined) {
      byKey.set("title", tag.title);
      continue;
    }
    const key = tag.name !== undefined ? `name:${tag.name}` : `property:${tag.property}`;
    byKey.set(key, tag.content ?? "");
  }
  return { built, byKey };
}

describe("buildMeta", () => {
  it("takes the title and description from the page's own language", () => {
    for (const locale of LOCALES) {
      for (const page of PAGES) {
        const expected = copyFor(locale).meta.pages[page];
        const { byKey } = metaOf(page, locale);
        expect(byKey.get("title"), `${locale} ${page}`).toBe(expected.title);
        expect(byKey.get("name:description"), `${locale} ${page}`).toBe(expected.description);
        // Social titles must not drift from the document title.
        expect(byKey.get("property:og:title")).toBe(expected.title);
        expect(byKey.get("name:twitter:title")).toBe(expected.title);
      }
    }
  });

  it("points canonical and og:url at the same absolute URL", () => {
    for (const locale of LOCALES) {
      for (const page of PAGES) {
        const { built, byKey } = metaOf(page, locale);
        const url = `${ORIGIN}${canonicalPath(page, locale)}`;
        const canonicals = built.links.filter((link) => link.rel === "canonical");
        expect(canonicals).toHaveLength(1);
        expect(canonicals[0].href).toBe(url);
        expect(byKey.get("property:og:url")).toBe(url);
      }
    }
  });

  it("declares the page's own og:locale and the other as the alternate", () => {
    for (const locale of LOCALES) {
      const { byKey } = metaOf("home", locale);
      expect(byKey.get("property:og:locale")).toBe(OG_LOCALE[locale]);
      expect(byKey.get("property:og:locale:alternate")).toBe(OG_LOCALE[otherLocale(locale)]);
    }
    expect(metaOf("home", "fr").byKey.get("property:og:locale")).toBe("fr_CA");
    expect(metaOf("home", "en").byKey.get("property:og:locale")).toBe("en_CA");
  });

  it("advertises the full, reciprocal hreflang cluster on every page", () => {
    for (const locale of LOCALES) {
      for (const page of PAGES) {
        const alternates = canonicalAlternates(page);
        const emitted = buildMeta({ page, locale })
          .links.filter((link) => link.rel === "alternate")
          .map((link) => [link.hrefLang, link.href]);

        expect(emitted, `${locale} ${page}`).toEqual([
          [LANG_TAG.en, `${ORIGIN}${alternates.en}`],
          [LANG_TAG.fr, `${ORIGIN}${alternates.fr}`],
          // English is what an unmatched visitor gets.
          ["x-default", `${ORIGIN}${alternates.en}`],
        ]);
      }
    }
  });

  it("uses regional language tags, because the copy is Canadian on both sides", () => {
    const tags = buildMeta({ page: "home", locale: "fr" })
      .links.filter((link) => link.rel === "alternate")
      .map((link) => link.hrefLang);
    expect(tags).toEqual(["en-CA", "fr-CA", "x-default"]);
  });

  it("noindexes only the 404 pages", () => {
    for (const locale of LOCALES) {
      for (const page of PAGES) {
        const robots = metaOf(page, locale).byKey.get("name:robots");
        expect(robots, `${locale} ${page}`).toBe(isNoindex(page) ? "noindex, follow" : undefined);
      }
    }
  });

  it("embeds one JSON-LD graph that declares this page's language", () => {
    for (const locale of LOCALES) {
      const scripts = buildMeta({ page: "home", locale }).scripts;
      expect(scripts).toHaveLength(1);
      const graph = JSON.parse(scripts[0].children) as {
        "@graph": Array<{ "@type": string; inLanguage?: string; description?: string }>;
      };
      const website = graph["@graph"].find((node) => node["@type"] === "WebSite");
      expect(website?.inLanguage).toBe(LANG_TAG[locale]);
      expect(website?.description).toBe(copyFor(locale).meta.siteDescription);
    }
  });

  it("localizes the share-card alt text", () => {
    for (const locale of LOCALES) {
      expect(metaOf("home", locale).byKey.get("property:og:image:alt")).toBe(
        copyFor(locale).meta.ogImageAlt,
      );
    }
    expect(metaOf("home", "fr").byKey.get("property:og:image:alt")).toContain("paperasse");
  });

  it("emits no URL off the canonical origin", () => {
    for (const locale of LOCALES) {
      for (const page of PAGES) {
        const built = buildMeta({ page, locale });
        for (const link of built.links) {
          expect(link.href.startsWith(`${ORIGIN}/`), `${page} ${link.rel}`).toBe(true);
        }
      }
    }
  });
});
