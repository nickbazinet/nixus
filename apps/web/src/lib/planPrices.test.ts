import { describe, expect, it } from "vitest";

import {
  ADVANCE_TRIAL_SPEC,
  advanceTrialFor,
  plansFor,
  pricingFaqFor,
  type Plan,
} from "@/content/pricing";
import type { LivePlanPrice, LivePlanPrices } from "@/lib/planCatalog";
import { billingPlanUrl } from "@/lib/links";
import { LOCALES, type Locale } from "@/lib/locale";
import { resolveDisplayPrice, trialMicrocopy } from "@/lib/planPrices";

/*
 * The trial disclosure has to state the price AFTER the trial, and that price is
 * the live one. Writing the amount into the copy would make a Stripe Dashboard
 * price change leave a stale "then $19.99" under a button showing a new number —
 * the one defect this whole baked-then-hydrated arrangement exists to prevent
 * (AD-6).
 */

function advanceOf(locale: Locale): Plan {
  return plansFor(locale).find((plan) => plan.id === "advance")!;
}

const ADVANCE = advanceOf("en");

function live(entry: Partial<LivePlanPrice>): LivePlanPrices {
  return new Map([
    [
      ADVANCE.lookupKey!,
      { amountCents: null, currency: null, interval: null, ...entry },
    ],
  ]);
}

describe("trialMicrocopy", () => {
  it("fills in the baked price when the catalog has not answered", () => {
    const price = resolveDisplayPrice(ADVANCE, new Map(), "en");
    const text = trialMicrocopy(advanceTrialFor("en"), price);

    expect(text).toContain("$19.99/month");
    expect(text).not.toContain("{price}");
  });

  it("follows the live price once the catalog answers", () => {
    const price = resolveDisplayPrice(
      ADVANCE,
      live({ amountCents: 2499, currency: "CAD", interval: "month" }),
      "en",
    );
    const text = trialMicrocopy(advanceTrialFor("en"), price);

    expect(text).toContain("$24.99/month");
    expect(text).not.toContain("19.99");
  });

  it("states the card, the conversion and the way out", () => {
    const text = trialMicrocopy(
      advanceTrialFor("en"),
      resolveDisplayPrice(ADVANCE, new Map(), "en"),
    );

    expect(text).toMatch(/7 days free/);
    expect(text).toMatch(/card is required/i);
    expect(text).toMatch(/cancel anytime before the trial ends/i);
    expect(text).toMatch(/won't be charged/i);
  });

  /* The French disclosure is a translation, not a looser paraphrase: the same
   * three facts have to survive, and the price has to be the French one. */
  it("states the same three facts in French, with a French price", () => {
    const price = resolveDisplayPrice(advanceOf("fr"), new Map(), "fr");
    const text = trialMicrocopy(advanceTrialFor("fr"), price);

    expect(text).toContain("19,99\u00A0$/mois");
    expect(text).not.toContain("{price}");
    expect(text).toMatch(/7 jours gratuits/);
    expect(text).toMatch(/carte est exigée/i);
    expect(text).toMatch(/avant la fin de l'essai/i);
    expect(text).toMatch(/ne serez pas facturé/i);
  });
});

describe("price formatting", () => {
  it("writes CAD the way each locale writes it", () => {
    const advance = advanceOf("en");
    expect(resolveDisplayPrice(advance, new Map(), "en")).toEqual({
      amount: "$19.99",
      interval: "/month",
    });
    expect(resolveDisplayPrice(advance, new Map(), "fr")).toEqual({
      // Comma decimal, symbol last, non-breaking space before it.
      amount: "19,99\u00A0$",
      interval: "/mois",
    });
  });

  it("translates a yearly interval published by the live catalog", () => {
    const advance = advanceOf("en");
    const yearly = live({ amountCents: 19999, currency: "CAD", interval: "year" });
    expect(resolveDisplayPrice(advance, yearly, "en").interval).toBe("/year");
    expect(resolveDisplayPrice(advance, yearly, "fr").interval).toBe("/an");
  });

  it("leaves the free plan with no interval in either language", () => {
    for (const locale of LOCALES) {
      const free = plansFor(locale).find((plan) => plan.id === "free")!;
      expect(resolveDisplayPrice(free, new Map(), locale).interval).toBe("");
    }
  });
});

describe("the Advance trial offer", () => {
  /* The trial is a SECOND Stripe Price on the Advance Product, so the two
   * buttons must not send a visitor to the same checkout. */
  it("links to its own lookup key, distinct from the plan's", () => {
    expect(ADVANCE.trial?.lookupKey).toBe(ADVANCE_TRIAL_SPEC.lookupKey);
    expect(ADVANCE_TRIAL_SPEC.lookupKey).not.toBe(ADVANCE.lookupKey);
    expect(billingPlanUrl("en", ADVANCE_TRIAL_SPEC.lookupKey)).toBe(
      "https://account.nixusapp.com/billing?plan=advance_trial",
    );
  });

  /* A French visitor must land on the French checkout, or the language is lost
   * at the origin boundary. `apps/account` serves that page at `/fr/billing`. */
  it("carries the language across to the account app", () => {
    expect(billingPlanUrl("fr", ADVANCE_TRIAL_SPEC.lookupKey)).toBe(
      "https://account.nixusapp.com/fr/billing?plan=advance_trial",
    );
    expect(billingPlanUrl("fr", "advance_monthly_cad")).toBe(
      "https://account.nixusapp.com/fr/billing?plan=advance_monthly_cad",
    );
  });

  it("is offered on Advance alone, and on nothing free, in both languages", () => {
    for (const locale of LOCALES) {
      const plans = plansFor(locale);
      expect(plans.filter((plan) => plan.trial !== undefined).map((plan) => plan.id)).toEqual([
        "advance",
      ]);
      for (const plan of plans) {
        if (plan.trial === undefined) continue;
        expect(plan.lookupKey).not.toBeNull();
        expect(plan.monthly).toBe(true);
      }
    }
  });

  it("names no amount in the copy, only the placeholder", () => {
    for (const locale of LOCALES) {
      const trial = advanceTrialFor(locale);
      for (const value of Object.values(trial)) {
        if (typeof value !== "string") continue;
        expect(value).not.toMatch(/\d+[.,]\d\d/);
        expect(value).not.toMatch(/\$/);
      }
      expect(trial.microcopy).toContain("{price}");
    }
  });
});

describe("the pricing FAQ", () => {
  function answerTo(locale: Locale, fragment: string): string {
    const found = pricingFaqFor(locale).find((item) => item.question.includes(fragment));
    expect(found, `no ${locale} FAQ question mentioning ${fragment}`).toBeDefined();
    return found!.answer;
  }

  /* Free has no trial and no time limit, and the Advance trial must not make
   * that read as a contradiction. */
  it("keeps Free unlimited without denying the Advance trial exists", () => {
    const free = answerTo("en", "really free");
    expect(free).toMatch(/no time limit/i);
    expect(free).not.toMatch(/no trial/i);
    expect(free).toMatch(/7-day free trial/);

    const libre = answerTo("fr", "vraiment gratuit");
    expect(libre).toMatch(/sans limite de temps/i);
    expect(libre).toMatch(/essai gratuit de 7 jours/);
  });

  it("answers what the trial costs, what it becomes and how to stop it", () => {
    expect(answerTo("en", "How does the free trial work")).toMatch(/card/i);
    expect(answerTo("en", "Will I be charged during the trial")).toMatch(/^No\./);
    expect(answerTo("en", "What happens when the trial ends")).toMatch(
      /continues automatically/i,
    );

    const cancel = answerTo("en", "cancel during the trial");
    expect(cancel).toMatch(/account\.nixusapp\.com/);
    expect(cancel).toMatch(/Manage plan/);
    expect(cancel).toMatch(/not be charged/i);
    // Local data is never at stake, which is the fear this answer has to settle.
    expect(cancel).toMatch(/your own machine/i);
  });

  it("answers the same four trial questions in French", () => {
    expect(answerTo("fr", "Comment fonctionne l'essai gratuit")).toMatch(/carte/i);
    expect(answerTo("fr", "Serai-je facturé pendant l'essai")).toMatch(/^Non\./);
    expect(answerTo("fr", "à la fin de l'essai")).toMatch(/se poursuit automatiquement/i);

    const annuler = answerTo("fr", "annuler pendant l'essai");
    expect(annuler).toMatch(/account\.nixusapp\.com/);
    // The account app calls this surface "Gérer le forfait"; the answer must
    // name what the visitor will actually see there.
    expect(annuler).toMatch(/Gérer le forfait/);
    expect(annuler).toMatch(/ne serez pas facturé/i);
    expect(annuler).toMatch(/votre propre machine/i);
  });

  /* The amount lives in the plan's baked price and in Stripe. An amount typed
   * into an answer is a second place a price change has to reach. */
  it("names no amount in any answer, in either language", () => {
    for (const locale of LOCALES) {
      for (const item of pricingFaqFor(locale)) {
        expect(item.answer, item.question).not.toMatch(/\d+[.,]\d\d/);
      }
    }
  });
});
