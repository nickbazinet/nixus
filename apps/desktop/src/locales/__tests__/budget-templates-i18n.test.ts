import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const TEMPLATE_PREFIX = "settings.template";
const ONBOARDING_STARTER_PREFIX = "onboarding.starterTemplate";

const REQUIRED_KEYS = [
  "settings.sectionTemplates",
  "settings.templateExportTitle",
  "settings.templateExportBody",
  "settings.templateExportAction",
  "settings.templateExporting",
  "settings.templateSaved",
  "settings.templateSaveFailed",
  "settings.templateImportTitle",
  "settings.templateImportBody",
  "settings.templateImportAction",
  "settings.templateImporting",
  "settings.templateImported",
  "settings.templateImportedSkipped",
  "settings.templateImportAllSkipped",
  "settings.templateImportFailed",
  "settings.templateStarterCanadianName",
  "settings.templateStarterCanadianBody",
  "settings.templateStarterApplyAction",
  "settings.templateStarterApplying",
  "settings.templateStarterLoading",
  "settings.templateStarterUnavailable",
  "settings.templateApplied",
  "settings.templateAppliedSkipped",
  "settings.templateApplyAllSkipped",
  "settings.templateApplyFailed",
  "onboarding.starterTemplateTitle",
  "onboarding.starterTemplateDescription",
  "onboarding.starterTemplateEditableNote",
  "onboarding.starterTemplateTargetLabel",
  "onboarding.starterTemplateLoading",
  "onboarding.starterTemplateUnavailable",
  "onboarding.starterTemplateConfirmAction",
  "onboarding.starterTemplateConfirming",
  "onboarding.starterTemplateApplied",
  "onboarding.starterTemplateAppliedSkipped",
  "onboarding.starterTemplateAllSkipped",
  "onboarding.starterTemplateApplyFailed",
  "onboarding.starterTemplateScratchAction",
  "onboarding.starterTemplateScratchHint",
] as const;

/**
 * Deliberately duplicates two REQUIRED_KEYS entries: these are the keys YourDataSettings.tsx's
 * STARTER_TEMPLATE_COPY map hardcodes, and renaming one there fails nowhere else — it just
 * renders a raw key string in the UI.
 */
const STARTER_TEMPLATE_COPY_KEYS = [
  "settings.templateStarterCanadianName",
  "settings.templateStarterCanadianBody",
] as const;

const PLACEHOLDER_KEYS = [
  ["settings.templateSaved", ["{{path}}"]],
  ["settings.templateImported", ["{{groups}}", "{{categories}}"]],
  [
    "settings.templateImportedSkipped",
    ["{{groups}}", "{{categories}}", "{{skipped}}"],
  ],
  ["settings.templateImportAllSkipped", ["{{skipped}}"]],
  ["settings.templateApplied", ["{{groups}}", "{{categories}}"]],
  [
    "settings.templateAppliedSkipped",
    ["{{groups}}", "{{categories}}", "{{skipped}}"],
  ],
  ["settings.templateApplyAllSkipped", ["{{skipped}}"]],
  ["onboarding.starterTemplateApplied", ["{{groups}}", "{{categories}}"]],
  [
    "onboarding.starterTemplateAppliedSkipped",
    ["{{groups}}", "{{categories}}", "{{skipped}}"],
  ],
  ["onboarding.starterTemplateAllSkipped", ["{{skipped}}"]],
] as const;

/**
 * Pending-state copy uses the single-character ellipsis, not three periods. A mixed
 * convention is invisible in review and permanent once shipped.
 */
const ELLIPSIS_KEYS = [
  "settings.templateExporting",
  "settings.templateImporting",
  "settings.templateStarterApplying",
  "settings.templateStarterLoading",
  "onboarding.starterTemplateLoading",
  "onboarding.starterTemplateConfirming",
] as const;

function templateKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(TEMPLATE_PREFIX));
}

function onboardingStarterKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) =>
    key.startsWith(ONBOARDING_STARTER_PREFIX),
  );
}

describe("budget templates i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no template key present in one locale but not the other", () => {
    const enKeys = templateKeys(en);
    const frKeys = templateKeys(fr);

    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("has no onboarding starter-template key present in one locale but not the other", () => {
    const enKeys = onboardingStarterKeys(en);
    const frKeys = onboardingStarterKeys(fr);

    expect(enKeys.length).toBeGreaterThan(0);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("declares every onboarding starter-template key it ships", () => {
    // The onboarding component is the only consumer, so an orphaned key here is copy the
    // UI can never show — and an undeclared one escapes the parity checks above.
    const declared = REQUIRED_KEYS.filter((key) =>
      key.startsWith(ONBOARDING_STARTER_PREFIX),
    );

    expect(onboardingStarterKeys(en).sort()).toEqual([...declared].sort());
  });

  it.each(ELLIPSIS_KEYS)("spells %s with a single-character ellipsis", (key) => {
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      expect(locale[key], `${key} missing in ${name}`).toBeTruthy();
      expect(locale[key], `${key} uses "..." in ${name}`).not.toContain("...");
      expect(locale[key], `${key} lost its ellipsis in ${name}`).toContain("\u2026");
    }
  });

  it("no longer ships the copy that claimed templates were unavailable", () => {
    expect(en["settings.templatesUnavailableTitle"]).toBeUndefined();
    expect(en["settings.templatesUnavailableBody"]).toBeUndefined();
    expect(fr["settings.templatesUnavailableTitle"]).toBeUndefined();
    expect(fr["settings.templatesUnavailableBody"]).toBeUndefined();
  });

  it.each(PLACEHOLDER_KEYS)(
    "keeps every interpolation placeholder of %s in both locales",
    (key, placeholders) => {
      for (const placeholder of placeholders) {
        expect(en[key], `${key} lost ${placeholder} in en.json`).toContain(
          placeholder,
        );
        expect(fr[key], `${key} lost ${placeholder} in fr.json`).toContain(
          placeholder,
        );
      }
    },
  );

  it.each(STARTER_TEMPLATE_COPY_KEYS)(
    "resolves %s, hardcoded by STARTER_TEMPLATE_COPY, in both locales",
    (key) => {
      expect(en[key], `${key} missing in en.json`).toBeTruthy();
      expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
    },
  );
});
