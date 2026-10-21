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

  it("states what is not stored and makes no claim about retaining request metadata", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/does not store the prompt, the attached statement/i);
    expect(text).not.toMatch(/does record, and retain/i);
    expect(text).not.toMatch(/request latency|token counts/i);
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

  it("makes no claim in French about retaining request metadata", async () => {
    await withFrench(() => {
      const text = renderText(<PrivacyPage locale="fr" />);

      expect(text).toMatch(/ne stocke ni la requête/i);
      expect(text).not.toMatch(/enregistre et conserve/i);
      expect(text).not.toMatch(/latence de la requête|nombre de jetons/i);
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
 * AD-13 extends to the optional cloud copy: Terms and Privacy are the only disclosure,
 * there is no in-app consent gate. Every claim here is pinned to something the code
 * actually does, because a disclosure that overstates the protection is worse than none.
 * The Privacy Policy states it generally; the Terms carry the behavioural detail.
 */
describe("optional cloud copy disclosure", () => {
  it("states that the cloud copy is opt-in and account-bound without naming a tier", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/off until you turn them on/i);
    expect(text).toMatch(/require a Nixus Cloud account/i);
    // AD-14: no cloud-copy wording may name a tier.
    expect(text).not.toMatch(/premium multi-device|multi-device sync tier/i);
  });

  it("says what is kept and where, in one general sentence each", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/keep a copy of your data in Nixus-operated cloud storage/i);
    expect(text).toMatch(/Amazon Web Services in the United States/i);
  });

  /* The Privacy Policy is deliberately general about this feature: it names the optional
   * cloud copy, not how sync works. The mechanics (merge rules, snapshots, retention windows,
   * the delete grant) were cut by decision, and the Terms keep the behavioural promises. This
   * pins that decision so the detail does not creep back in one well-meant paragraph at a time. */
  it("stays general rather than describing how the feature works", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).not.toMatch(/multi-device|\bsync\b/i);
    expect(text).not.toMatch(/change-log|snapshot|field by field|roster|thumbnail/i);
    expect(text).not.toMatch(/SSE-S3|N\. Virginia|30 days|90 days/i);
  });

  /* Claiming or implying end-to-end encryption would be the one unrecoverable error in this
   * document, so this survives every trim. */
  it("refuses to imply end-to-end encryption and says who could read the copy", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/encrypted in transit and at rest/i);
    expect(text).toMatch(/not end-to-end encrypted/i);
    expect(text).toMatch(/administrator with access to that AWS account/i);
    expect(text).not.toMatch(/end-to-end encrypted\.(?! )/);
    expect(text).not.toMatch(/only you can read/i);
  });

  it("says turning a cloud feature off keeps the copy and that deletion is by email", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/stops transfers but does not delete the copy/i);
    expect(text).toMatch(/email the address at the bottom of this page/i);
    expect(text).toMatch(/handled manually/i);
    expect(text).not.toMatch(/no permission to delete anything/i);
  });

  it("keeps the local-only promise intact in the Privacy Policy", () => {
    const text = renderText(<PrivacyPage locale="en" />);

    expect(text).toMatch(/local-only profile, nothing is uploaded/i);
  });

  /* The Terms say what a reader can rely on about the optional cloud copy, and no more:
   * who it is for, that it is off until turned on, that it is an alpha that can change or be
   * withdrawn, and what happens when an account stops qualifying. The merge rules, the
   * first-link prompt and the version-gating were cut by decision; they are product behaviour
   * the app shows, not terms a reader agrees to. */
  it("describes availability, suspension and eligibility without describing how it works", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).toMatch(/available to eligible Nixus Cloud accounts/i);
    expect(text).toMatch(/off until you turn them on/i);
    expect(text).toMatch(/availability is not guaranteed/i);
    expect(text).toMatch(/changed, interrupted, or withdrawn/i);
    expect(text).toMatch(/Nixus may suspend them for an account/i);
    expect(text).toMatch(/If an account stops being eligible/i);
    expect(text).toMatch(/app keeps working with your local data/i);
    // AD-14: no cloud-copy wording may name a tier.
    expect(text).not.toMatch(/premium multi-device|multi-device sync tier/i);
  });

  it("keeps backups the reader's responsibility without a sync-specific paragraph", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).toMatch(/does not operate a backup service/i);
    expect(text).toMatch(/keeping your own backups is your responsibility/i);
  });

  /* The Terms stay general about the feature, as the Privacy Policy does. This pins that
   * decision so the mechanics do not come back one well-meant paragraph at a time. */
  it("stays general in the Terms rather than naming the feature or its mechanics", () => {
    const text = renderText(<TermsPage locale="en" />);

    expect(text).not.toMatch(/multi-device|\bsync\b/i);
    expect(text).not.toMatch(/field by field|merged as additions|dated backup|relinks?/i);
    expect(text).not.toMatch(/credit card statement import|AI chat|project advice|spending-trends/i);
  });

  it("no longer claims that Nixus never holds a copy", () => {
    for (const page of [<TermsPage locale="en" />, <PrivacyPage locale="en" />]) {
      const text = renderText(page);
      expect(text).not.toMatch(/does not back them up, sync them, or hold a copy/i);
      expect(text).not.toMatch(/no cloud sync/i);
    }
  });

  it("carries the same cloud-copy facts in French", async () => {
    await withFrench(() => {
      const privacy = renderText(<PrivacyPage locale="fr" />);

      expect(privacy).toMatch(/désactivées jusqu'à ce que vous les activiez/i);
      expect(privacy).toMatch(/exigent un compte Nixus Cloud/i);
      expect(privacy).toMatch(/stockage infonuagique exploité par Nixus/i);
      expect(privacy).toMatch(/Amazon Web Services, aux États-Unis/i);
      expect(privacy).toMatch(/chiffrée en transit et au repos/i);
      expect(privacy).toMatch(/n'est pas chiffrée de bout en bout/i);
      expect(privacy).toMatch(/administrateur de Nixus ayant accès à ce compte AWS/i);
      expect(privacy).toMatch(/ne supprime pas la copie/i);
      expect(privacy).toMatch(/au bas de cette page/i);
      expect(privacy).toMatch(/traitées manuellement/i);
      expect(privacy).toMatch(/profil local seulement, rien n'est téléversé/i);
      // Same decision as the English policy: the feature is named generally.
      expect(privacy).not.toMatch(/synchronisation multi-appareils|instantané|champ par champ/i);

      const terms = renderText(<TermsPage locale="fr" />);

      expect(terms).toMatch(/offertes aux comptes Nixus Cloud admissibles/i);
      expect(terms).toMatch(/désactivées jusqu'à ce que vous les activiez/i);
      expect(terms).toMatch(/disponibilité n'est pas garantie/i);
      expect(terms).toMatch(/modifiées, interrompues ou retirées/i);
      expect(terms).toMatch(/Nixus peut les suspendre pour un compte/i);
      expect(terms).toMatch(/Si un compte cesse d'être admissible/i);
      expect(terms).toMatch(/continue de fonctionner avec vos données locales/i);
      expect(terms).toMatch(/il vous incombe de faire vos propres sauvegardes/i);
      expect(terms).not.toMatch(/synchronisation multi-appareils|champ par champ|sauvegarde datée/i);
      expect(terms).not.toMatch(/import de relevés|clavardage IA|conseils de projet|tendances de dépenses/i);
    });
  });

  it("keeps both documents' cloud-copy paragraphs in the rendered section order", () => {
    const termsKeys = TERMS_SECTIONS.flatMap((section) => section.bodyKeys);
    const privacyKeys = PRIVACY_SECTIONS.flatMap((section) => section.bodyKeys);

    expect(termsKeys).toEqual(
      expect.arrayContaining(["termsPage.cloud.body", "termsPage.cloud.availability"])
    );
    expect(privacyKeys).toEqual(
      expect.arrayContaining([
        "privacyPage.cloud.body",
        "privacyPage.cloud.protection",
        "privacyPage.cloud.deletion",
      ])
    );
    // Removed because it was false: it said Nixus retains request latency, status and
    // token counts, but most of that exists only in logs that expire after 14 days.
    expect(privacyKeys).not.toContain("privacyPage.hosted.retained");
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
