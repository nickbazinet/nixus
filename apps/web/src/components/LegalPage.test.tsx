import { act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";

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

  it("keeps the opt-in wording that only triggered AI requests leave the device", () => {
    const en = i18n.getFixedT("en");
    const fr = i18n.getFixedT("fr");

    expect(en("features.localFirst.description")).toMatch(
      /only the AI requests you trigger leave your device/i
    );
    expect(fr("features.localFirst.description")).toMatch(
      /seules les requêtes IA que vous lancez quittent votre appareil/i
    );
  });
});
