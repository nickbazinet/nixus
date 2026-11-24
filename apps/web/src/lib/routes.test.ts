import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LOCALES, localeFromPath, otherLocale, type Locale } from "@/lib/locale";
import {
  PAGES,
  PAGE_PATH,
  canonicalAlternates,
  canonicalPath,
  isNoindex,
  pageFromPath,
  pagePath,
  switchLocalePath,
} from "@/lib/routes";

/*
 * The URL map is the contract between four things that are maintained
 * separately: the route files on disk, the `hreflang` cluster, the sitemap, and
 * the account app's outbound links. These tests tie them together, because a
 * French page that exists in the table but not on disk is a 404 that no type
 * can catch.
 */

// Vitest roots at apps/web.
const ROUTES_DIR = resolve(process.cwd(), "src/routes");

/** The route file a path is expected to come from. */
function routeFile(path: string): string {
  if (path === "/") return "index.tsx";
  if (path === "/fr") return "fr/index.tsx";
  return `${path.slice(1)}.tsx`;
}

describe("locale detection", () => {
  it("reads the locale off the pathname, on a route boundary", () => {
    expect(localeFromPath("/")).toBe("en");
    expect(localeFromPath("/pricing")).toBe("en");
    expect(localeFromPath("/fr")).toBe("fr");
    expect(localeFromPath("/fr/")).toBe("fr");
    expect(localeFromPath("/fr/pricing")).toBe("fr");
  });

  it("does not treat an `/fr`-prefixed word as French", () => {
    // A page called `/french-banks` or `/frobnicate` is still English.
    expect(localeFromPath("/frobnicate")).toBe("en");
    expect(localeFromPath("/french-banks")).toBe("en");
  });

  it("pairs each locale with the other one", () => {
    expect(otherLocale("en")).toBe("fr");
    expect(otherLocale("fr")).toBe("en");
  });
});

describe("the page table", () => {
  it("gives every page a route file in both languages", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const file = routeFile(PAGE_PATH[page][locale]);
        expect(
          existsSync(resolve(ROUTES_DIR, file)),
          `${page} (${locale}) expects src/routes/${file}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the French slug identical to the English one", () => {
    // `apps/account/src/lib/marketing.ts` already links to nixusapp.com/fr/<en-slug>.
    for (const page of PAGES) {
      const { en, fr } = PAGE_PATH[page];
      expect(fr).toBe(en === "/" ? "/fr" : `/fr${en}`);
    }
  });

  it("uses no path twice", () => {
    const all = PAGES.flatMap((page) => LOCALES.map((locale) => PAGE_PATH[page][locale]));
    expect(new Set(all).size).toBe(all.length);
  });

  it("resolves a router target back to its page, in either spelling", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        expect(pageFromPath(PAGE_PATH[page][locale])).toBe(page);
        expect(pageFromPath(canonicalPath(page, locale))).toBe(page);
      }
    }
  });

  it("reports an unknown path as unknown rather than guessing", () => {
    expect(pageFromPath("/nope")).toBeNull();
    expect(pageFromPath("/fr/nope")).toBeNull();
  });

  it("exposes the router target through `pagePath`", () => {
    expect(pagePath("pricing", "en")).toBe("/pricing");
    expect(pagePath("pricing", "fr")).toBe("/fr/pricing");
    expect(pagePath("home", "fr")).toBe("/fr");
  });
});

describe("canonical paths", () => {
  it("slash a language root, so one page has one URL", () => {
    expect(canonicalPath("home", "en")).toBe("/");
    expect(canonicalPath("home", "fr")).toBe("/fr/");
  });

  it("match the router target everywhere else", () => {
    for (const page of PAGES) {
      if (page === "home") continue;
      for (const locale of LOCALES) {
        expect(canonicalPath(page, locale)).toBe(PAGE_PATH[page][locale]);
      }
    }
  });

  it("are reciprocal: both languages of a page advertise the same pair", () => {
    for (const page of PAGES) {
      const alternates = canonicalAlternates(page);
      for (const locale of LOCALES) {
        expect(alternates[locale]).toBe(canonicalPath(page, locale));
      }
    }
  });
});

describe("the language switcher target", () => {
  it("lands on the same page in the other language", () => {
    expect(switchLocalePath("/pricing", "fr")).toBe("/fr/pricing");
    expect(switchLocalePath("/fr/pricing", "en")).toBe("/pricing");
    expect(switchLocalePath("/", "fr")).toBe("/fr/");
    expect(switchLocalePath("/fr/", "en")).toBe("/");
    expect(switchLocalePath("/fr", "en")).toBe("/");
  });

  it("is idempotent for the language already shown", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const here = canonicalPath(page, locale);
        expect(switchLocalePath(here, locale)).toBe(here);
      }
    }
  });

  it("round-trips through both languages for every page", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const here = canonicalPath(page, locale);
        const there = switchLocalePath(here, otherLocale(locale));
        expect(switchLocalePath(there, locale)).toBe(here);
      }
    }
  });

  it("falls back to that language's home when there is no twin", () => {
    expect(switchLocalePath("/nope", "fr")).toBe("/fr/");
    expect(switchLocalePath("/fr/nope", "en")).toBe("/");
  });
});

describe("indexability", () => {
  it("keeps both 404 pages out of the index and nothing else", () => {
    const noindex = PAGES.filter(isNoindex);
    expect(noindex).toEqual(["notFound"]);
  });
});

describe("the sitemap", () => {
  const sitemap = (): string => {
    // Read lazily so the failure message names the file rather than the import.
    const path = resolve(process.cwd(), "public/sitemap.xml");
    expect(existsSync(path), "public/sitemap.xml is missing").toBe(true);
    return readFileSync(path, "utf8");
  };

  const ORIGIN = "https://nixusapp.com";

  function locations(): string[] {
    return Array.from(sitemap().matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
  }

  it("lists every indexable page in both languages, once", () => {
    const expected = PAGES.filter((page) => !isNoindex(page)).flatMap((page) =>
      LOCALES.map((locale: Locale) => `${ORIGIN}${canonicalPath(page, locale)}`),
    );
    expect(locations().sort()).toEqual(expected.sort());
  });

  it("omits the 404 pages", () => {
    for (const locale of LOCALES) {
      expect(locations()).not.toContain(`${ORIGIN}${canonicalPath("notFound", locale)}`);
    }
  });

  it("carries the hreflang cluster on every entry", () => {
    const xml = sitemap();
    const entries = xml.split("<url>").slice(1);
    expect(entries).toHaveLength(locations().length);
    for (const entry of entries) {
      const loc = /<loc>([^<]+)<\/loc>/.exec(entry)?.[1];
      const page = pageFromPath(loc!.slice(ORIGIN.length));
      expect(page, `${loc} is not a known page`).not.toBeNull();
      const alternates = canonicalAlternates(page!);
      expect(entry).toContain(`hreflang="en-CA" href="${ORIGIN}${alternates.en}"`);
      expect(entry).toContain(`hreflang="fr-CA" href="${ORIGIN}${alternates.fr}"`);
      expect(entry).toContain(`hreflang="x-default" href="${ORIGIN}${alternates.en}"`);
    }
  });
});
