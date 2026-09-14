import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

// Keys the Import category selector and its proposal alert read directly, each with the
// placeholders the component interpolates. A locale that drops a placeholder renders a sentence
// with a hole in it, which prefix-only parity checks cannot see.
const REQUIRED_KEYS = [
  ["import.categoryInGroup", ["group"]],
  ["import.proposedCategory", ["name"]],
  ["import.proposedCategoryInGroup", ["group", "name"]],
  ["import.proposedCategoryNewGroup", ["group", "name"]],
] as const satisfies readonly (readonly [
  keyof typeof enLocale & keyof typeof frLocale,
  readonly string[],
])[];

function placeholdersOf(value: string): string[] {
  return [...value.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).sort();
}

describe("import category group i18n", () => {
  it("defines every key the Import category surfaces render in both locales", () => {
    for (const [key] of REQUIRED_KEYS) {
      expect(enLocale[key], `Missing EN key ${key}`).toBeTruthy();
      expect(frLocale[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("keeps the documented interpolation placeholders in both locales", () => {
    for (const [key, expected] of REQUIRED_KEYS) {
      expect(placeholdersOf(enLocale[key]), `EN ${key}`).toEqual([...expected]);
      expect(placeholdersOf(frLocale[key]), `FR ${key}`).toEqual([...expected]);
    }
  });

  it("keeps the group-bearing proposal lines distinct from the group-less fallback", () => {
    for (const key of [
      "import.proposedCategoryInGroup",
      "import.proposedCategoryNewGroup",
    ] as const) {
      expect(enLocale[key], `EN ${key}`).not.toBe(enLocale["import.proposedCategory"]);
      expect(frLocale[key], `FR ${key}`).not.toBe(frLocale["import.proposedCategory"]);
    }
  });
});
