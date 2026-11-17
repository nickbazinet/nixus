import { describe, expect, it } from "vitest";

import {
  accountAppUrl,
  betaPagePath,
  homePath,
  localeFromLanguage,
  localeFromPath,
  localePrefix,
} from "./localePaths";

describe("localeFromPath", () => {
  it("resolves the root and every non-/fr path to English", () => {
    expect(localeFromPath("/")).toBe("en");
    expect(localeFromPath("/beta")).toBe("en");
    expect(localeFromPath("/404")).toBe("en");
  });

  it("resolves /fr on a route boundary to French", () => {
    expect(localeFromPath("/fr")).toBe("fr");
    expect(localeFromPath("/fr/")).toBe("fr");
    expect(localeFromPath("/fr/beta")).toBe("fr");
    expect(localeFromPath("/fr/404")).toBe("fr");
  });

  it("keeps English for paths that merely start with the letters fr", () => {
    // A prefix match on "/fr" would hand these to the French bundle and emit
    // `<html lang="fr">` on an English page.
    expect(localeFromPath("/french-press")).toBe("en");
    expect(localeFromPath("/frobnicate")).toBe("en");
    expect(localeFromPath("/fritz/beta")).toBe("en");
  });
});

describe("locale path helpers", () => {
  it("maps each locale to its prefix, home and beta path", () => {
    expect(localePrefix("en")).toBe("");
    expect(localePrefix("fr")).toBe("/fr");
    expect(homePath("en")).toBe("/");
    expect(homePath("fr")).toBe("/fr/");
    expect(betaPagePath("en")).toBe("/beta");
    expect(betaPagePath("fr")).toBe("/fr/beta");
  });

  it("round-trips every locale path back to its own locale", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(localeFromPath(homePath(locale))).toBe(locale);
      expect(localeFromPath(betaPagePath(locale))).toBe(locale);
    }
  });
});

describe("localeFromLanguage", () => {
  it("treats regional French tags as French and everything else as English", () => {
    expect(localeFromLanguage("fr")).toBe("fr");
    expect(localeFromLanguage("fr-CA")).toBe("fr");
    expect(localeFromLanguage("en")).toBe("en");
    expect(localeFromLanguage("en-US")).toBe("en");
    expect(localeFromLanguage(undefined)).toBe("en");
  });
});

describe("accountAppUrl", () => {
  it("is an absolute https url on the account origin, per locale", () => {
    expect(accountAppUrl("en")).toBe("https://account.nixusapp.com");
    expect(accountAppUrl("fr")).toBe("https://account.nixusapp.com/fr");
  });

  /* A visitor on /fr must land in French, and the account app has no trailing-slash
   * index route - its router normalises /fr/ to /fr with a 307, so linking the
   * slashed form would cost every French visitor an extra redirect. */
  it("never carries a trailing slash", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(accountAppUrl(locale).endsWith("/")).toBe(false);
    }
  });

  it("stays on the account host, not the marketing or api host", () => {
    for (const locale of ["en", "fr"] as const) {
      const { origin, protocol } = new URL(accountAppUrl(locale));
      expect(protocol).toBe("https:");
      expect(origin).toBe("https://account.nixusapp.com");
    }
  });
});
