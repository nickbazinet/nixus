import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

/*
 * AD-16's release-blocking in-app copy. A Nixus Cloud profile now lives in the
 * user's Nixus Cloud account, so the strings that used to promise it never left
 * the machine must say where it is, and the delete-all confirmation must say the
 * Nixus Cloud profile survives it. In-app copy names no provider or region, and
 * "Nixus Cloud" is never translated.
 */
describe("Nixus Cloud profile disclosure (AD-16)", () => {
  const RELEASE_BLOCKING = [
    "profile.signInRequiredBody",
    "profile.avatar.hint",
    "settings.dangerZoneKeptList",
    "settings.dangerZoneDialogDescription",
  ];

  it.each(RELEASE_BLOCKING)("%s names the Nixus Cloud account in both locales", (key) => {
    expect(en[key]).toContain("Nixus Cloud");
    expect(fr[key]).toContain("Nixus Cloud");
    expect(fr[key]).not.toMatch(/[Nn]uage Nixus/);
  });

  it("no longer claims the profile stays on this machine", () => {
    expect(en["profile.signInRequiredBody"]).not.toMatch(/no profile data leaves/i);
    expect(en["profile.avatar.hint"]).not.toMatch(/kept on this machine/i);
    expect(fr["profile.signInRequiredBody"]).not.toMatch(/ne quitte cet appareil/i);
    expect(fr["profile.avatar.hint"]).not.toMatch(/sur cet appareil/i);
  });

  it("tells the user delete-all keeps the Nixus Cloud profile", () => {
    for (const key of ["settings.dangerZoneKeptList", "settings.dangerZoneDialogDescription"]) {
      expect(en[key]).toMatch(/Nixus Cloud profile is not deleted/);
      expect(fr[key]).toMatch(/profil Nixus Cloud n'est pas supprim\u00e9/);
    }
  });

  it("names no provider or region in-app", () => {
    for (const key of RELEASE_BLOCKING) {
      for (const text of [en[key], fr[key]]) {
        expect(text).not.toMatch(/\bAWS\b|Amazon|Virginia|Virginie|us-east/i);
      }
    }
  });
});
