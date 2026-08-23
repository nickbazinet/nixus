import { describe, expect, it } from "vitest";

import {
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
