import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";
import { HOME_COMPONENTS, HOME_SOURCES } from "@/lib/homeSurface";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const homeKeys = (locale: Record<string, string>) =>
  Object.keys(locale).filter((key) => key.startsWith("home.")).sort();

const billingKeys = (locale: Record<string, string>) =>
  Object.keys(locale).filter((key) => key.startsWith("billing.")).sort();

describe("home i18n", () => {
  it("has the same Home keys in English and French, all non-empty", () => {
    expect(homeKeys(fr)).toEqual(homeKeys(en));
    for (const key of homeKeys(en)) {
      expect(en[key].trim(), key).not.toBe("");
      expect(fr[key].trim(), key).not.toBe("");
    }
    expect(en["sidebar.home"]).toBe("Home");
    expect(fr["sidebar.home"]).toBe("Accueil");
  });

  /* The card and the renderer label every catalog entry and every data source by key: a missing one
   * would render the raw key on a confirmation card. */
  it("labels every catalog component, data source, series and dimension", () => {
    for (const component of HOME_COMPONENTS) expect(en[`home.component.${component}`], component).toBeTruthy();
    for (const source of HOME_SOURCES) expect(en[`home.source.${source}`], source).toBeTruthy();
    for (const series of ["spent", "net_worth", "actual", "budget", "income", "balance", "value"]) {
      expect(en[`home.series.${series}`], series).toBeTruthy();
    }
    for (const dimension of ["month", "category", "account", "asset", "flow"]) {
      expect(en[`home.dimension.${dimension}`], dimension).toBeTruthy();
    }
    for (const node of ["income", "unspent"]) {
      expect(en[`home.flow.${node}`], node).toBeTruthy();
    }
    for (const op of ["add", "modify", "remove"]) {
      for (const kind of ["label", "confirm", "done"]) {
        expect(en[`home.change.${kind}.${op}`], `${kind}.${op}`).toBeTruthy();
      }
    }
  });

  /* FR-7 and FR-11 must read differently: a transient outage is not a plan limitation. */
  it("keeps the transient-unavailable copy distinct from the locked setup prompt", () => {
    expect(en["home.unavailable.title"]).not.toEqual(en["home.locked.setupTitle"]);
    expect(en["home.locked.quotaBody"]).not.toEqual(en["home.locked.premiumBody"]);
  });

  /* Billing AD-12: under two paid tiers, "you need premium" is wrong for a paying Classic
   * subscriber, so no refusal may say it in either language. The copy names the capability and
   * routes to an upgrade instead. Asserted over every Home key rather than the three that read
   * that way today, so a new locked state cannot reintroduce the sentence. */
  it("never tells a subscriber they need premium, and names the capability instead", () => {
    for (const locale of [en, fr]) {
      for (const key of homeKeys(en)) {
        expect(locale[key].toLowerCase(), key).not.toContain("premium");
      }
    }

    for (const locale of [en, fr]) {
      for (const key of [
        "home.locked.premiumBody",
        "home.locked.localBody",
      ]) {
        expect(locale[key], key).toContain("Nixus Cloud AI");
      }
    }

    /* "Nixus Cloud" stays untranslated in French (AD-16). */
    expect(fr["home.locked.premiumBody"]).toContain("Nixus Cloud AI");
  });

  /* "Not entitled" and "out of quota" stay two conversations: one invites an upgrade, the other
   * says to wait. Conflating them sells a plan to someone who already has it. */
  it("keeps the unentitled and out-of-quota refusals distinct", () => {
    for (const locale of [en, fr]) {
      expect(locale["home.locked.premiumBody"]).not.toEqual(
        locale["home.locked.quotaBody"],
      );
      expect(locale["home.locked.quotaTitle"]).not.toEqual(
        locale["home.locked.setupTitle"],
      );
    }
    expect(en["home.locked.premiumBody"].toLowerCase()).toContain("upgrade");
    expect(fr["home.locked.premiumBody"].toLowerCase()).toContain("forfait");
    expect(en["home.locked.quotaBody"].toLowerCase()).not.toContain("upgrade");
    expect(fr["home.locked.quotaBody"].toLowerCase()).not.toContain(
      "passez à un forfait",
    );
  });

  /* Epic F: the refusal copy promises an upgrade, so there has to be a labelled action to
   * click. It names the CAPABILITY, so it cannot read as a tier, and "Nixus Cloud" stays
   * untranslated in French (AD-16). */
  it("labels the upgrade action after the capability rather than a plan", () => {
    for (const locale of [en, fr]) {
      for (const key of ["home.locked.upgradeAction", "settings.readingUpgradeAction"]) {
        expect(locale[key].trim(), key).not.toBe("");
        expect(locale[key], key).toContain("Nixus Cloud AI");
        expect(locale[key].toLowerCase(), key).not.toContain("premium");
        expect(locale[key].toLowerCase(), key).not.toContain("advance");
        expect(locale[key].toLowerCase(), key).not.toContain("classic");
      }
    }

    expect(en["home.locked.upgradeAction"]).not.toEqual(en["home.locked.setupAction"]);
    expect(fr["home.locked.upgradeAction"]).not.toEqual(fr["home.locked.setupAction"]);
  });

  /* The statement-import refusal is the same conversation on another surface, so it carries the
   * same two routes — a plan, or the user's own key — and names neither tier. */
  it("invites an upgrade on the statement-reading surface without naming a tier", () => {
    for (const locale of [en, fr]) {
      for (const key of ["settings.readingUpgradeTitle", "settings.readingUpgradeBody"]) {
        expect(locale[key].trim(), key).not.toBe("");
        expect(locale[key].toLowerCase(), key).not.toContain("premium");
        expect(locale[key].toLowerCase(), key).not.toContain("advance");
      }
      expect(locale["settings.readingUpgradeBody"]).toContain("Nixus Cloud AI");
    }

    /* It must not read like the banner shown to an account that already has it. */
    expect(en["settings.readingUpgradeTitle"]).not.toEqual(
      en["settings.readingPremiumTitle"],
    );
    expect(fr["settings.readingUpgradeTitle"]).not.toEqual(
      fr["settings.readingPremiumTitle"],
    );
  });

  /* Every billing refusal is rendered from `code`, so a key present in one language only is a
   * raw key on screen in the other. No value may name a tier or carry a URL. */
  it("has the same billing keys in English and French, naming no tier and no URL", () => {
    expect(billingKeys(fr)).toEqual(billingKeys(en));
    expect(billingKeys(en).length).toBeGreaterThan(0);

    for (const locale of [en, fr]) {
      for (const key of billingKeys(en)) {
        expect(locale[key].trim(), key).not.toBe("");
        expect(locale[key].toLowerCase(), key).not.toContain("premium");
        expect(locale[key].toLowerCase(), key).not.toContain("advance");
        expect(locale[key].toLowerCase(), key).not.toContain("classic");
        expect(locale[key].toLowerCase(), key).not.toContain("http");
        expect(locale[key].toLowerCase(), key).not.toContain("stripe");
      }
    }
  });
});
