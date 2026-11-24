import { describe, expect, it } from "vitest";

import { SITE_COPY, copyFor, fill } from "@/content/index";
import { LOCALES, type Locale } from "@/lib/locale";
import { PAGES } from "@/lib/routes";

/*
 * `SiteCopy` already forces every English key to exist in French, so these tests
 * cover the three things a type cannot:
 *
 *   1. structure — an array that gained an item in one language only silently
 *      drops a card, because the icons and visuals in code are matched by index;
 *   2. translation — a French string identical to its English counterpart is
 *      almost always a line that was copied and never translated;
 *   3. typography — French needs a non-breaking space before `: ; ! ?` and `%`,
 *      inside guillemets, and before the dollar sign, and a regular space there
 *      is invisible in review.
 */

type Node = unknown;

function describePath(path: readonly string[]): string {
  return path.length === 0 ? "<root>" : path.join(".");
}

/** Every leaf string in the tree, keyed by its dotted path. */
function leaves(node: Node, path: string[] = [], into = new Map<string, string>()) {
  if (typeof node === "string") {
    into.set(describePath(path), node);
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => leaves(item, [...path, String(index)], into));
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      leaves(value, [...path, key], into);
    }
  }
  return into;
}

/** Structural differences between two trees, as human-readable complaints. */
function structuralDiff(a: Node, b: Node, path: string[] = []): string[] {
  const where = describePath(path);

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${where}: array on one side only`];
    if (a.length !== b.length) {
      return [`${where}: ${a.length} items in en, ${b.length} in fr`];
    }
    return a.flatMap((item, index) => structuralDiff(item, b[index], [...path, String(index)]));
  }

  if (typeof a === "object" && a !== null) {
    if (typeof b !== "object" || b === null) return [`${where}: object on one side only`];
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    const missing = keysA.filter((key) => !keysB.includes(key));
    const extra = keysB.filter((key) => !keysA.includes(key));
    if (missing.length || extra.length) {
      return [
        `${where}: missing in fr [${missing.join(", ")}], extra in fr [${extra.join(", ")}]`,
      ];
    }
    return keysA.flatMap((key) =>
      structuralDiff(
        (a as Record<string, Node>)[key],
        (b as Record<string, Node>)[key],
        [...path, key],
      ),
    );
  }

  if (typeof a !== typeof b) return [`${where}: ${typeof a} in en, ${typeof b} in fr`];
  if (typeof a === "boolean" && a !== b) {
    // A comparison-table tick that differs by language would advertise a
    // different product in French.
    return [`${where}: ${String(a)} in en, ${String(b)} in fr`];
  }
  return [];
}

/**
 * Strings that are legitimately the same in both languages: brand and product
 * names, platform names, the founder's first name, the language codes, and the
 * handful of words French and English spell identically.
 */
const IDENTICAL_BY_DESIGN = new Set([
  "Nixus",
  "Nixus Gratuit",
  "NixusCloud Classic",
  "NixusCloud Advance",
  "Classic",
  "Advance",
  "GitHub",
  "Instagram",
  "Facebook",
  "macOS",
  "Windows",
  "Nick",
  "Transport",
  "EN",
  "FR",
  "Situation",
  "Nom",
  "{price}",
]);

describe("the copy dictionary", () => {
  it("has the same structure in both languages", () => {
    expect(structuralDiff(copyFor("en"), copyFor("fr"))).toEqual([]);
  });

  it("has no untranslated French string", () => {
    const en = leaves(copyFor("en"));
    const fr = leaves(copyFor("fr"));
    const untranslated = [...en].filter(
      ([path, value]) =>
        fr.get(path) === value &&
        // Punctuation-only fragments (a heading's trailing ".") carry no language.
        /\p{L}/u.test(value) &&
        !IDENTICAL_BY_DESIGN.has(value),
    );
    expect(untranslated.map(([path, value]) => `${path} = ${JSON.stringify(value)}`)).toEqual([]);
  });

  it("covers every page in `meta`, in both languages", () => {
    for (const locale of LOCALES) {
      const pages = copyFor(locale).meta.pages;
      expect(Object.keys(pages).sort()).toEqual([...PAGES].sort());
      for (const page of PAGES) {
        expect(pages[page].title, `${locale} ${page} title`).not.toBe("");
        expect(pages[page].description, `${locale} ${page} description`).not.toBe("");
      }
    }
  });

  it("exposes exactly the declared locales", () => {
    expect(Object.keys(SITE_COPY).sort()).toEqual([...LOCALES].sort());
  });
});

const NBSP = "\u00A0";
const frenchStrings = () => [...leaves(copyFor("fr"))];

describe("French typography", () => {

  it("uses a non-breaking space before : ; ! ? and before % and $", () => {
    const offenders = frenchStrings().filter(([, value]) => / [:;!?%$]/.test(value));
    expect(offenders.map(([path, value]) => `${path} = ${JSON.stringify(value)}`)).toEqual([]);
  });

  it("uses a non-breaking space inside guillemets", () => {
    const offenders = frenchStrings().filter(
      ([, value]) => /« /.test(value) || / »/.test(value),
    );
    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it("does actually carry non-breaking spaces, so the checks above mean something", () => {
    const withNbsp = frenchStrings().filter(([, value]) => value.includes(NBSP));
    expect(withNbsp.length).toBeGreaterThan(20);
  });
});

describe("the French product vocabulary", () => {
  /**
   * The desktop app and the account app already speak French. The marketing
   * site has to use the same words, or a visitor reads one product on the site
   * and finds another one after install.
   */
  const frenchText = () => [...leaves(copyFor("fr")).values()].join("\n");

  it("has no English word left behind in a French string", () => {
    /**
     * Common English words that have no French homograph and appear nowhere in
     * a brand name, a URL or an acronym this site uses. Unicode-aware
     * boundaries, so a word inside "pour" or "relevé" is not a hit.
     *
     * Deliberately excludes words that are also French ("plan", "transport"),
     * and words that appear inside `account.nixusapp.com`.
     */
    const english =
      /(?<![\p{L}'’])(the|your|and|with|you|from|our|free|month|year|days|computer|statement|spreadsheet|privacy|pricing|download)(?![\p{L}])/iu;
    const offenders = frenchStrings().filter(([, value]) => english.test(value));
    expect(
      offenders.map(([path, value]) => `${path}: ${english.exec(value)?.[1]} in ${JSON.stringify(value)}`),
    ).toEqual([]);
  });

  it("uses the Canadian registered-account names", () => {
    const text = frenchText();
    for (const term of ["CELI", "REER", "CELIAPP"]) {
      expect(text).toContain(term);
    }
    // The English acronyms must not survive anywhere in the French copy.
    for (const term of ["TFSA", "RRSP", "FHSA"]) {
      expect(text).not.toContain(term);
    }
  });

  it("says `valeur nette`, the term the desktop app uses for net worth", () => {
    expect(frenchText()).toContain("valeur nette");
    expect(frenchText()).not.toContain("avoir net");
  });

  it("reuses the account app's trial wording", () => {
    const pricing = copyFor("fr").pricing;
    expect(pricing.trial.cta).toBe("Commencer l'essai gratuit de 7 jours");
    expect(pricing.trial.badge).toBe("7 jours gratuits");
  });

  it("says `forfait`, not `plan`, for a subscription tier", () => {
    const text = frenchText();
    expect(text).toContain("forfait");
    expect(text).not.toMatch(/\bles plans\b/i);
  });

  it("keeps the subtraction motif that the brand name is built on", () => {
    const home = copyFor("fr").home;
    expect(home.hero.heading.lead + home.hero.heading.accent).toBe("Moins la paperasse");
    expect(home.closing.kicker).toBe("On soustrait. Vous additionnez.");
    expect(home.closing.subtractTitle).toBe("On soustrait");
    expect(home.closing.addTitle).toBe("Vous additionnez");
    expect(copyFor("fr").shell.footer.tagline).toContain("Moins la paperasse");
  });

  it("addresses the reader as `vous`, never `tu`", () => {
    // Unicode-aware boundaries, not `\b`: `\b` is ASCII, so `\btes\b` matches
    // inside "êtes" and the whole check would be noise.
    const familiar = /(?<![\p{L}'’])(tu|ton|ta|tes|toi)(?![\p{L}])/iu;
    const offenders = [...leaves(copyFor("fr"))].filter(([, value]) => familiar.test(value));
    expect(offenders.map(([path]) => path)).toEqual([]);
  });
});

describe("fill", () => {
  it("substitutes a named placeholder", () => {
    expect(fill("Choisir {plan}", { plan: "Classic" })).toBe("Choisir Classic");
  });

  it("leaves an unknown placeholder alone rather than emitting `undefined`", () => {
    expect(fill("Choisir {plan}", {})).toBe("Choisir {plan}");
  });

  it("substitutes every occurrence", () => {
    expect(fill("{a} et {a}", { a: "x" })).toBe("x et x");
  });
});

describe("placeholders", () => {
  /** A placeholder dropped in translation would print a literal `{price}`. */
  const PLACEHOLDERS: ReadonlyArray<[(locale: Locale) => string, string]> = [
    [(locale) => copyFor(locale).pricing.trial.microcopy, "{price}"],
    [(locale) => copyFor(locale).pricing.choosePlan, "{plan}"],
    [(locale) => copyFor(locale).shell.language.switchTo, "{language}"],
    [(locale) => copyFor(locale).foundingUsers.form.sentNote, "{email}"],
    [(locale) => copyFor(locale).foundingUsers.form.mailSubject, "{name}"],
  ];

  it("survive translation", () => {
    for (const locale of LOCALES) {
      for (const [read, token] of PLACEHOLDERS) {
        expect(read(locale), `${locale} ${token}`).toContain(token);
      }
    }
  });
});
