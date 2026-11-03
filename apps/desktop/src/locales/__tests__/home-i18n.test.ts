import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";
import { HOME_COMPONENTS, HOME_SOURCES } from "@/lib/homeSurface";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const homeKeys = (locale: Record<string, string>) =>
  Object.keys(locale).filter((key) => key.startsWith("home.")).sort();

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

  /* FR-7 and FR-11 must read differently: a transient outage is not "you need premium". */
  it("keeps the transient-unavailable copy distinct from the premium lock", () => {
    expect(en["home.unavailable.title"]).not.toEqual(en["home.locked.premiumTitle"]);
    expect(en["home.locked.premiumTitle"]).toContain("premium");
    expect(en["home.unavailable.title"]).not.toContain("premium");
  });
});
