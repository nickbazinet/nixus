import { describe, expect, it } from "vitest";

import en from "./en.json" with { type: "json" };
import fr from "./fr.json" with { type: "json" };

/*
 * Copied from `apps/web`'s locale-parity spec (Consistency Conventions): a missing
 * FR key renders the English sentence silently, which is the one i18n defect no
 * reviewer catches by reading a diff.
 *
 * AD-16 also fixes one term: "Nixus Cloud" stays untranslated in French on every
 * surface.
 */

const EN: Record<string, string> = en;
const FR: Record<string, string> = fr;

describe("locale parity", () => {
  it("declares exactly the same keys in both locales", () => {
    expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
  });

  it.each(Object.keys(EN))("translates %s rather than copying it", (key) => {
    expect(FR[key], `${key} is missing from fr.json`).toBeDefined();
    expect(FR[key]?.trim()).not.toBe("");
  });

  it("leaves no empty English string either", () => {
    for (const [key, value] of Object.entries(EN)) {
      expect(value.trim(), `${key} is blank`).not.toBe("");
    }
  });
});

describe("AD-16 brand term", () => {
  const FRENCH_CLOUD_KEYS = Object.entries(FR).filter(([, value]) =>
    /Nixus\s+\S*loud/i.test(value),
  );

  it("mentions Nixus Cloud in the French copy at all", () => {
    expect(FRENCH_CLOUD_KEYS.length).toBeGreaterThan(0);
  });

  it.each(FRENCH_CLOUD_KEYS)("keeps %s untranslated as 'Nixus Cloud'", (_key, value) => {
    expect(value).toContain("Nixus Cloud");
    expect(value).not.toMatch(/Nixus\s+Nuage/i);
    expect(value).not.toMatch(/nuage\s+Nixus/i);
  });
});

describe("AD-16 point-of-collection notice", () => {
  it("states in both locales that the profile lives in the Nixus Cloud account", () => {
    expect(EN["profile.notice"]).toContain("Nixus Cloud account");
    expect(FR["profile.notice"]).toContain("Nixus Cloud");
  });

  it("names no provider or region, on either side", () => {
    for (const notice of [EN["profile.notice"], FR["profile.notice"]]) {
      for (const forbidden of ["AWS", "Amazon", "us-east-1", "DynamoDB", "Virginia", "Virginie"]) {
        expect(notice, `the notice names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("validation copy", () => {
  it("carries a sentence for every closed-union error code", () => {
    for (const code of [
      "unauthorized",
      "reauthentication_required",
      "validation",
      "version_conflict",
      "payload_too_large",
      "unsupported_media",
      "rate_limited",
      "unavailable",
    ]) {
      expect(EN[`error.${code}`], `error.${code}`).toBeDefined();
      expect(FR[`error.${code}`], `error.${code}`).toBeDefined();
    }
  });

  it("carries a sentence for every validation reason", () => {
    for (const reason of [
      "invalid_type",
      "invalid_format",
      "required",
      "not_allowed",
      "in_future",
      "too_young",
      "too_old",
      "requires_country",
      "no_subdivisions",
      "dimensions_exceeded",
      "unknown_field",
    ]) {
      expect(EN[`reason.${reason}`], `reason.${reason}`).toBeDefined();
      expect(FR[`reason.${reason}`], `reason.${reason}`).toBeDefined();
    }
  });

  it("never renders a server message, so no copy key echoes one", () => {
    for (const value of [...Object.values(EN), ...Object.values(FR)]) {
      expect(value).not.toContain("{{message}}");
    }
  });
});
