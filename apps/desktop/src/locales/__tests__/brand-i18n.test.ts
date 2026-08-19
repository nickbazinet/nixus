import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

// NFR8 reserves "Nixus Cloud" and forbids these synonyms. The sweep is case-sensitive on these
// exact brand-cased forms; a case-insensitive sweep would also flag profile.signInRequiredBody's
// lowercase "Nixus account", which is prose rather than a competing product name.
const FORBIDDEN_SYNONYMS = ["Nixus Sync", "Nixus Account", "Nixus Online"] as const;

describe("brand i18n", () => {
  it.each(FORBIDDEN_SYNONYMS)(
    "never uses the forbidden synonym %s in en.json",
    (synonym) => {
      for (const [key, value] of Object.entries(en)) {
        expect(value, `${key} contains forbidden synonym "${synonym}"`).not.toContain(synonym);
      }
    },
  );

  it.each(FORBIDDEN_SYNONYMS)(
    "never uses the forbidden synonym %s in fr.json",
    (synonym) => {
      for (const [key, value] of Object.entries(fr)) {
        expect(value, `${key} contains forbidden synonym "${synonym}"`).not.toContain(synonym);
      }
    },
  );
});
