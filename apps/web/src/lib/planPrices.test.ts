import { describe, expect, it } from "vitest";

import { ADVANCE_TRIAL, PLANS, PRICING_FAQ } from "@/content/pricing";
import type { LivePlanPrice, LivePlanPrices } from "@/lib/planCatalog";
import { billingPlanUrl } from "@/lib/links";
import { resolveDisplayPrice, trialMicrocopy } from "@/lib/planPrices";

/*
 * The trial disclosure has to state the price AFTER the trial, and that price is
 * the live one. Writing the amount into the copy would make a Stripe Dashboard
 * price change leave a stale "then $19.99" under a button showing a new number —
 * the one defect this whole baked-then-hydrated arrangement exists to prevent
 * (AD-6).
 */

const ADVANCE = PLANS.find((plan) => plan.id === "advance")!;

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
    const price = resolveDisplayPrice(ADVANCE, new Map());
    const text = trialMicrocopy(ADVANCE_TRIAL, price);

    expect(text).toContain("$19.99/month");
    expect(text).not.toContain("{price}");
  });

  it("follows the live price once the catalog answers", () => {
    const price = resolveDisplayPrice(
      ADVANCE,
      live({ amountCents: 2499, currency: "CAD", interval: "month" }),
    );
    const text = trialMicrocopy(ADVANCE_TRIAL, price);

    expect(text).toContain("$24.99/month");
    expect(text).not.toContain("19.99");
  });

  it("states the card, the conversion and the way out", () => {
    const text = trialMicrocopy(
      ADVANCE_TRIAL,
      resolveDisplayPrice(ADVANCE, new Map()),
    );

    expect(text).toMatch(/7 days free/);
    expect(text).toMatch(/card is required/i);
    expect(text).toMatch(/cancel anytime before the trial ends/i);
    expect(text).toMatch(/won't be charged/i);
  });
});

describe("the Advance trial offer", () => {
  /* The trial is a SECOND Stripe Price on the Advance Product, so the two
   * buttons must not send a visitor to the same checkout. */
  it("links to its own lookup key, distinct from the plan's", () => {
    expect(ADVANCE.trial).toBe(ADVANCE_TRIAL);
    expect(ADVANCE_TRIAL.lookupKey).not.toBe(ADVANCE.lookupKey);
    expect(billingPlanUrl(ADVANCE_TRIAL.lookupKey)).toBe(
      "https://account.nixusapp.com/billing?plan=advance_trial",
    );
  });

  it("is offered on Advance alone, and on nothing free", () => {
    expect(PLANS.filter((plan) => plan.trial !== undefined)).toEqual([ADVANCE]);
    for (const plan of PLANS) {
      if (plan.trial === undefined) continue;
      expect(plan.lookupKey).not.toBeNull();
      expect(plan.monthly).toBe(true);
    }
  });

  it("names no amount in the copy, only the placeholder", () => {
    for (const value of Object.values(ADVANCE_TRIAL)) {
      if (typeof value !== "string") continue;
      expect(value).not.toMatch(/\d+[.,]\d\d/);
      expect(value).not.toMatch(/\$/);
    }
    expect(ADVANCE_TRIAL.microcopy).toContain("{price}");
  });
});

describe("the pricing FAQ", () => {
  function answerTo(fragment: string): string {
    const found = PRICING_FAQ.find((item) => item.question.includes(fragment));
    expect(found, `no FAQ question mentioning ${fragment}`).toBeDefined();
    return found!.answer;
  }

  /* Free has no trial and no time limit, and the Advance trial must not make
   * that read as a contradiction. */
  it("keeps Free unlimited without denying the Advance trial exists", () => {
    const free = answerTo("really free");
    expect(free).toMatch(/no time limit/i);
    expect(free).not.toMatch(/no trial/i);
    expect(free).toMatch(/7-day free trial/);
  });

  it("answers what the trial costs, what it becomes and how to stop it", () => {
    expect(answerTo("How does the free trial work")).toMatch(/card/i);
    expect(answerTo("Will I be charged during the trial")).toMatch(/^No\./);
    expect(answerTo("What happens when the trial ends")).toMatch(
      /continues automatically/i,
    );

    const cancel = answerTo("cancel during the trial");
    expect(cancel).toMatch(/account\.nixusapp\.com/);
    expect(cancel).toMatch(/Manage plan/);
    expect(cancel).toMatch(/not be charged/i);
    // Local data is never at stake, which is the fear this answer has to settle.
    expect(cancel).toMatch(/your own machine/i);
  });

  /* The amount lives in the plan's baked price and in Stripe. An amount typed
   * into an answer is a second place a price change has to reach. */
  it("names no amount in any answer", () => {
    for (const item of PRICING_FAQ) {
      expect(item.answer, item.question).not.toMatch(/\d+[.,]\d\d/);
    }
  });
});
