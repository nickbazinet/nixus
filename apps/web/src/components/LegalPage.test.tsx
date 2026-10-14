import { act, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";

import enMessages from "@/locales/en.json";
import frMessages from "@/locales/fr.json";
import { renderWithProviders } from "@/lib/test-utils";
import {
  PRIVACY_SECTIONS,
  PrivacyPage,
  TERMS_SECTIONS,
  TermsPage,
} from "./LegalPage";

/*
 * AD-13 makes these two documents the sole hosted-AI disclosure mechanism, so the
 * specific facts they must state are asserted rather than assumed. AD-9's precedence
 * rule is the one users cannot discover from the app: hosted AI overrides a provider
 * they explicitly configured, and no setting exposes that.
 */

/** Scoped to the rendered tree: `document.body` also contains injected scripts. */
function renderText(ui: Parameters<typeof renderWithProviders>[0]): string {
  const { container } = renderWithProviders(ui);
  return container.textContent ?? "";
}

/**
 * The components read from the i18n singleton, so FR assertions need the language
 * actually switched. Wrapped in `act` and restored in `finally`, because the tree is
 * still mounted when the language is put back (Testing Library unmounts in its own
 * afterEach, after this body).
 */
async function withFrench(run: () => void): Promise<void> {
  await act(async () => {
    await i18n.changeLanguage("fr");
  });
  try {
    run();
  } finally {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  }
}

describe("hosted-AI precedence disclosure", () => {
  it("states in the Terms that hosted AI overrides a configured BYO provider", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).toContain("takes precedence");
    expect(text).toMatch(/even when you have configured your own AI provider/i);
    expect(text).toMatch(/in-app setting to choose between them/i);
  });

  it("states in the Privacy Policy which path a request actually takes", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/even if you have entered your own AWS or OpenAI credentials/i);
    expect(text).toMatch(/no in-app switch/i);
    expect(text).toMatch(
      /only when hosted AI is unavailable, out of quota, or not enabled/i
    );
  });

  it("keeps the precedence paragraph in both documents' section order", () => {
    const termsKeys = TERMS_SECTIONS.flatMap((section) => section.bodyKeys);
    const privacyKeys = PRIVACY_SECTIONS.flatMap((section) => section.bodyKeys);

    expect(termsKeys).toContain("termsPage.aiFeatures.precedence");
    expect(privacyKeys).toContain("privacyPage.hosted.precedence");
  });

  /* Hosted processing runs through a US cross-region inference profile, so the policy
   * must disclose that a request is not confined to one region - naming a single region
   * would be a false disclosure, not merely an imprecise one. */
  it("discloses the AWS non-retention limit and where processing happens", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/does not bind Amazon Web Services/i);
    expect(text).toMatch(/abuse-detection/i);
    expect(text).toMatch(/cross-region/i);
    expect(text).toMatch(/any US AWS region/i);
    expect(text).toMatch(/monthly request quota/i);

    // The superseded London wording described a routing behaviour that no longer happens.
    expect(text).not.toMatch(/Europe \(London\)/);
    expect(text).not.toContain("eu-west-2");
    expect(text).not.toMatch(/United Kingdom/);
  });

  /* The Terms are the other half of AD-13's disclosure mechanism: a reader who accepts
   * the Terms without opening the Privacy Policy must still learn where their statement
   * is processed. */
  it("names the processing scope in the Terms too, not only the Privacy Policy", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).toMatch(/cross-region/i);
    expect(text).toMatch(/any US AWS region/i);
    expect(text).not.toContain("eu-west-2");
  });

  /* Quota is per request, so the Terms must promise a request limit and never imply a
   * token- or usage-metered charge the service does not apply. */
  it("describes the limit as a request count, not a token or usage measure", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).toMatch(/monthly limit on the number of requests/i);
    expect(text).not.toMatch(/token/i);
  });

  /* "outside your own country" is false for a UK reader, and a legal document that
   * states a falsehood about its own scope is worse than one that says nothing. */
  it("qualifies the location claim instead of asserting it absolutely", () => {
    for (const page of [<PrivacyPage locale="en" />, <TermsPage locale="en" />]) {
      const text = renderText(page);
      expect(text).toMatch(/may be outside your country of residence/i);
      expect(text).not.toMatch(/outside your own country/i);
    }
  });
});

describe("contact address", () => {
  it("uses the canonical contact address on legal pages", () => {
    renderWithProviders(<TermsPage locale="en" />);

    expect(screen.getByRole("link", { name: "nixusapp@gmail.com" })).toHaveAttribute(
      "href",
      "mailto:nixusapp@gmail.com",
    );
  });
});

describe("French disclosures carry the same facts", () => {
  it("states the precedence rule and the absence of a toggle in French", async () => {
    await withFrench(() => {
      const text = renderText(<TermsPage locale="fr" />);

      expect(text).toMatch(/a priorité/i);
      expect(text).toMatch(/aucun réglage dans l'application/i);
    });
  });

  it("states the AWS limit and where processing happens in French", async () => {
    await withFrench(() => {
      const text = renderText(<PrivacyPage locale="fr" />);

      expect(text).toMatch(/n'engage pas Amazon Web Services/i);
      expect(text).toMatch(/interrégional/i);
      expect(text).toMatch(/région AWS américaine/i);
      expect(text).toMatch(/quota mensuel/i);

      expect(text).not.toMatch(/Europe \(Londres\)/);
      expect(text).not.toContain("eu-west-2");
    });
  });

  it("names the processing scope in the French Terms as well", async () => {
    await withFrench(() => {
      const text = renderText(<TermsPage locale="fr" />);

      expect(text).toMatch(/interrégional/i);
      expect(text).toMatch(/région AWS américaine/i);
      expect(text).not.toContain("eu-west-2");
    });
  });

  it("describes the French limit as a request count", async () => {
    await withFrench(() => {
      const text = renderText(<TermsPage locale="fr" />);

      expect(text).toMatch(/limite mensuelle sur le nombre de requêtes/i);
      expect(text).not.toMatch(/jeton/i);
    });
  });

  it("qualifies the location claim in both French documents", async () => {
    await withFrench(() => {
      for (const page of [<PrivacyPage locale="fr" />, <TermsPage locale="fr" />]) {
        const text = renderText(page);
        expect(text).toMatch(/peut se trouver à l'extérieur de votre pays de résidence/i);
        expect(text).not.toMatch(/à l'extérieur de votre pays,/i);
      }
    });
  });
});

/*
 * French typography puts a space before `:` `;` `!` `?` `»` and after `«`; when that
 * space is breakable the browser wraps the punctuation onto a line of its own — visual
 * QA caught `privacy-fr-desktop` opening a line with `:` and `terms-fr-mobile` with
 * `»,`. Matching rendered characters rather than wording keeps the guard alive across
 * copy rewrites and new sections, and each match carries the offending word so a
 * failure names it.
 *
 * `[^\S\u00a0\u202f\u2007]` is whitespace MINUS the non-breaking spaces: every
 * character that hands the browser a break opportunity. Stated as a subtraction rather
 * than a list of spaces to reject, because the likely regression is a well-meant
 * U+2009 THIN SPACE, which still breaks.
 */
function breakableFrenchPunctuation(text: string): readonly string[] {
  return [
    ...text.matchAll(/\S+[^\S\u00a0\u202f\u2007][:;!?»]|«[^\S\u00a0\u202f\u2007]\S+/gu),
  ].map((match) => match[0]);
}

describe("French legal copy keeps punctuation on its own word", () => {
  it("never leaves a breakable space around Terms punctuation", async () => {
    await withFrench(() => {
      expect(breakableFrenchPunctuation(renderText(<TermsPage locale="fr" />))).toEqual(
        []
      );
    });
  });

  it("never leaves a breakable space around Privacy Policy punctuation", async () => {
    await withFrench(() => {
      expect(breakableFrenchPunctuation(renderText(<PrivacyPage locale="fr" />))).toEqual(
        []
      );
    });
  });
});

/* EN was narrowed from "data" to "records" when the AI path was disclosed; the FR
 * strings had not been narrowed with it, so they still claimed everything stays
 * local. */
describe("EN and FR locality claims stay in step", () => {
  it("no longer claims in French that all data stays local", async () => {
    const fr = i18n.getFixedT("fr");

    expect(fr("faq.preAlpha.answer")).not.toMatch(/Vos données restent locales/i);
    expect(fr("betaPage.hero.lead")).not.toMatch(/tout sur votre machine/i);
    expect(fr("betaPage.getStarted.firstOpen.body")).not.toMatch(
      /vos données restent sur votre machine/i
    );
  });

  it("keeps the opt-in wording that nothing leaves the device unasked", () => {
    const en = i18n.getFixedT("en");
    const fr = i18n.getFixedT("fr");

    // Narrowed from "only the AI requests you trigger leave your device": sync is a
    // second way records leave the device, so the old absolute claim became false.
    expect(en("features.localFirst.description")).toMatch(
      /nothing leaves it unless you ask/i
    );
    expect(en("features.localFirst.description")).toMatch(/or sync you turn on/i);
    expect(fr("features.localFirst.description")).toMatch(
      /rien ne le quitte sans que vous le demandiez/i
    );
    expect(fr("features.localFirst.description")).toMatch(
      /ou la synchronisation que vous activez/i
    );
  });
});

/*
 * AD-13 extends to sync: Terms and Privacy are the only disclosure, there is no in-app
 * consent gate. Every claim here is pinned to something the code actually does, because
 * a disclosure that overstates the protection is worse than none.
 */
describe("multi-device sync disclosure", () => {
  it("states that sync is opt-in and entitlement-bound without naming a tier", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/off until you turn it on/i);
    expect(text).toMatch(/a Nixus Cloud account that includes multi-device sync/i);
    // AD-14: no sync copy may name a tier.
    expect(text).not.toMatch(/premium multi-device|multi-device sync tier/i);
  });

  it("names what is uploaded, what is stripped, and where it lives", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/uploads a snapshot/i);
    /* Fix F-1 wired the blob upload and the on-demand fetch, so the disclosure now has to say
     * so: thumbnails come first, each full-size image is its own object, and it comes down the
     * first time it is viewed. The protection claim has to travel with it. */
    expect(text).toMatch(/Full-size project images travel separately/i);
    expect(text).toMatch(/uploaded as its own object/i);
    expect(text).toMatch(/downloads one the first time you ask to see it/i);
    expect(text).toMatch(/does not sync continuously/i);
    expect(text).toMatch(/never uploaded/i);
    expect(text).toMatch(/credential store and are never transmitted to Nixus/i);
    expect(text).toMatch(/operated by Nixus on Amazon Web Services/i);
    expect(text).toMatch(/US East \(N\. Virginia\)/);
  });

  /* AD-8 is SSE-S3 only. Claiming or implying end-to-end encryption would be the one
   * unrecoverable error in this document. */
  it("refuses to imply end-to-end encryption and says who could read the copy", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/server-side encryption \(SSE-S3\)/i);
    expect(text).toMatch(/not end-to-end encrypted/i);
    expect(text).toMatch(/administrator with access to that AWS account/i);
    expect(text).toMatch(/reserves a marker for an encryption scheme/i);
    expect(text).not.toMatch(/end-to-end encrypted\.(?! )/);
    expect(text).not.toMatch(/only you can read/i);
  });

  /* The sync role holds no delete permission, so a self-serve deletion promise would be
   * unimplementable; the retention window is the lifecycle rule on the bucket. */
  it("states the 30-day version window and that deletion is a manual request", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/previous versions of each object for 30 days/i);
    expect(text).toMatch(/no way to delete the cloud copy from inside the app/i);
    expect(text).toMatch(/email the address at the bottom of this page/i);
    expect(text).toMatch(/stops transfers but does not delete the copy/i);
  });

  it("keeps the local-only promise intact in the Privacy Policy", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/local-only profile, no sync code runs/i);
  });

  /* No continuous sync and no merge exist in this milestone, so the Terms must describe
   * the choice the user is actually offered instead of promising convergence. */
  it("describes beta availability, the conflict choice and the freeze in the Terms", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).toMatch(/optional feature of eligible Nixus Cloud accounts/i);
    expect(text).toMatch(/availability is not guaranteed/i);
    expect(text).toMatch(/does not merge edits made on two computers at the same time/i);
    expect(text).toMatch(/never silently overwritten/i);
    expect(text).toMatch(/kept as a dated backup/i);
    expect(text).toMatch(/keeping your own backups remains your responsibility/i);
    expect(text).toMatch(/Nixus freezes it/i);
    expect(text).toMatch(/keeps working normally with your local data/i);
  });

  it("no longer claims that Nixus never syncs or holds a copy", () => {
    for (const page of [<TermsPage locale="en" />, <PrivacyPage locale="en" />]) {
      const text = renderText(page);
      expect(text).not.toMatch(/does not back them up, sync them, or hold a copy/i);
      expect(text).not.toMatch(/no cloud sync/i);
    }
  });

  it("carries the same sync facts in French", async () => {
    await withFrench(() => {
      const privacy = renderText(<PrivacyPage locale="fr" />);

      expect(privacy).toMatch(/désactivée jusqu'à ce que vous l'activiez/i);
      expect(privacy).toMatch(/compte Nixus Cloud qui inclut la synchronisation/i);
      expect(privacy).toMatch(/Virginie du Nord/i);
      expect(privacy).toMatch(/n'est pas chiffrée de bout en bout/i);
      expect(privacy).toMatch(/administrateur de Nixus ayant accès à ce compte AWS/i);
      expect(privacy).toMatch(/pendant 30 jours/i);
      expect(privacy).toMatch(/au bas de cette page/i);
      expect(privacy).toMatch(/aucun code de synchronisation ne s'exécute/i);

      const terms = renderText(<TermsPage locale="fr" />);

      expect(terms).toMatch(/comptes Nixus Cloud admissibles/i);
      expect(terms).toMatch(/version bêta/i);
      expect(terms).toMatch(/ne fusionne pas les modifications faites simultanément/i);
      expect(terms).toMatch(/jamais remplacée en silence/i);
      expect(terms).toMatch(/sauvegarde datée/i);
      expect(terms).toMatch(/Nixus la gèle/i);
      expect(terms).not.toMatch(/ne les synchronise pas/i);
    });
  });

  it("keeps both documents' sync paragraphs in the rendered section order", () => {
    const termsKeys = TERMS_SECTIONS.flatMap((section) => section.bodyKeys);
    const privacyKeys = PRIVACY_SECTIONS.flatMap((section) => section.bodyKeys);

    expect(termsKeys).toEqual(
      expect.arrayContaining([
        "termsPage.sync.body",
        "termsPage.sync.conflict",
        "termsPage.sync.backups",
        "termsPage.sync.freeze",
      ])
    );
    expect(privacyKeys).toEqual(
      expect.arrayContaining([
        "privacyPage.sync.body",
        "privacyPage.sync.what",
        "privacyPage.sync.notSynced",
        "privacyPage.sync.where",
        "privacyPage.sync.protection",
        "privacyPage.sync.retention",
        "privacyPage.sync.deletion",
        "privacyPage.sync.localOnly",
      ])
    );
  });
});

/* A key present in one locale and missing in the other renders the English string on a
 * French legal page without failing anything, which is how a disclosure silently stops
 * being a disclosure for half the users. */
describe("locale key parity", () => {
  it("defines exactly the same keys in both locales", () => {
    const en = Object.keys(enMessages).sort();
    const fr = Object.keys(frMessages).sort();

    expect(fr).toEqual(en);
  });

  it("leaves no legal string untranslated", () => {
    const untranslated = Object.keys(enMessages).filter(
      (key) =>
        (key.startsWith("privacyPage.") || key.startsWith("termsPage.")) &&
        !key.endsWith(".meta.title") &&
        enMessages[key as keyof typeof enMessages] ===
          frMessages[key as keyof typeof frMessages]
    );

    expect(untranslated).toEqual([]);
  });
});
