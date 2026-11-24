import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LOCALES, type Locale } from "@/lib/locale";
import { PAGES, PAGE_PATH, type PageId } from "@/lib/routes";

/*
 * Twenty route files that differ only in a page id and a two-letter locale are
 * exactly the shape a copy-paste slip hides in: a French route that renders the
 * English page still compiles, still prerenders, and only shows up as English
 * copy under a `/fr` URL. So the files are read and checked against the table.
 */

// Vitest roots at apps/web.
const ROUTES_DIR = resolve(process.cwd(), "src/routes");

/** The file on disk, and the route path TanStack generates from it. */
function routeFileFor(page: PageId, locale: Locale): { file: string; routePath: string } {
  const path = PAGE_PATH[page][locale];
  if (path === "/") return { file: "index.tsx", routePath: "/" };
  if (path === "/fr") return { file: "fr/index.tsx", routePath: "/fr/" };
  return { file: `${path.slice(1)}.tsx`, routePath: path };
}

function source(file: string): string {
  return readFileSync(resolve(ROUTES_DIR, file), "utf8");
}

describe("the route files", () => {
  it("register the route path the page table expects", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const { file, routePath } = routeFileFor(page, locale);
        expect(source(file), file).toContain(`createFileRoute("${routePath}")`);
      }
    }
  });

  it("build their head from their own page and locale", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const { file } = routeFileFor(page, locale);
        expect(source(file), file).toContain(
          `buildMeta({ page: "${page}", locale: "${locale}" })`,
        );
      }
    }
  });

  it("hand their own locale to the page component", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const { file } = routeFileFor(page, locale);
        expect(source(file), file).toContain(`locale="${locale}"`);
      }
    }
  });

  it("never mention the other locale", () => {
    for (const page of PAGES) {
      for (const locale of LOCALES) {
        const { file } = routeFileFor(page, locale);
        const other = locale === "en" ? "fr" : "en";
        expect(source(file), file).not.toContain(`locale="${other}"`);
        expect(source(file), file).not.toContain(`locale: "${other}"`);
      }
    }
  });

  it("read the legal documents for their own language", () => {
    for (const [page, accessor] of [
      ["terms", "termsFor"],
      ["privacyPolicy", "privacyPolicyFor"],
    ] as const) {
      for (const locale of LOCALES) {
        const { file } = routeFileFor(page, locale);
        expect(source(file), file).toContain(`${accessor}("${locale}")`);
      }
    }
  });
});
