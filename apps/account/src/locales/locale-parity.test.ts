import { describe, expect, it } from "vitest";
import {
  BILLING_CAPABILITIES,
  BILLING_ERROR_CODES,
  BILLING_VALIDATION_FIELDS,
  BILLING_VALIDATION_REASONS,
  ENTITLEMENT_STATUSES,
} from "@nixus/shared";

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

describe("copy the owner removed from the web form", () => {
  /* 2026-11-18, owner decision: no lead line, storage notice or picture hint on
   * the web profile form; the Privacy Policy carries the disclosure. */
  it("carries neither the lead line, the storage notice nor the picture hint", () => {
    for (const locale of [EN, FR]) {
      expect(locale["profile.lead"]).toBeUndefined();
      expect(locale["profile.notice"]).toBeUndefined();
      expect(locale["profile.avatar.hint"]).toBeUndefined();
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

/*
 * The billing contract's copy (billing AD-12, AD-13, AD-16).
 *
 * Driven off the EXPORTED constants rather than a hand-copied list, which is the
 * whole point: a union member added in `packages/shared/src/types/billing.ts`
 * fails here on arrival instead of rendering a raw key to a paying customer.
 */
describe("billing contract copy", () => {
  it.each([...BILLING_ERROR_CODES])("carries a sentence for the error code %s", (code) => {
    expect(EN[`error.${code}`], `error.${code} is missing from en.json`).toBeDefined();
    expect(FR[`error.${code}`], `error.${code} is missing from fr.json`).toBeDefined();
  });

  it.each([...BILLING_VALIDATION_REASONS])(
    "carries a sentence for the validation reason %s",
    (reason) => {
      expect(EN[`reason.${reason}`], `reason.${reason} is missing from en.json`).toBeDefined();
      expect(FR[`reason.${reason}`], `reason.${reason} is missing from fr.json`).toBeDefined();
    },
  );

  it.each([...BILLING_VALIDATION_FIELDS])("names the validation field %s", (field) => {
    expect(EN[`field.${field}`], `field.${field} is missing from en.json`).toBeDefined();
    expect(FR[`field.${field}`], `field.${field} is missing from fr.json`).toBeDefined();
  });

  it.each([...BILLING_CAPABILITIES])("labels the capability %s", (capability) => {
    expect(EN[`billing.capability.${capability}`], capability).toBeDefined();
    expect(FR[`billing.capability.${capability}`], capability).toBeDefined();
  });

  it.each([...ENTITLEMENT_STATUSES])("labels the entitlement status %s", (status) => {
    expect(EN[`billing.status.${status}`], status).toBeDefined();
    expect(FR[`billing.status.${status}`], status).toBeDefined();
  });

  /* A tier is an opaque string that may arrive from the Stripe Dashboard with no
   * deploy (AD-6), so the fallback sentence is not optional. */
  it("carries a fallback sentence for a tier code it has never seen", () => {
    expect(EN["billing.tier.unknown"]).toBeDefined();
    expect(FR["billing.tier.unknown"]).toBeDefined();
  });
});

/*
 * AD-12's whole reason for existing: under two paid tiers, "you are not a
 * premium user" lies to a paying subscriber. A Classic subscriber denied an AI
 * surface must be told which capability their plan lacks and routed to a plan
 * that has it — never told they need premium, and never told a tier name.
 */
describe("a refusal names the capability, never a tier", () => {
  const TIER_WORDS = [/\bpremium\b/i, /\bclassique?\b/i, /\badvance[dr]?\b/i];

  function refusalCopy(locale: Record<string, string>): [string, string][] {
    return Object.entries(locale).filter(
      ([key]) =>
        key.startsWith("error.") ||
        key.startsWith("reason.") ||
        key === "billing.capabilityMissing" ||
        key === "billing.upgradeToGet" ||
        key === "billing.includedNone",
    );
  }

  it.each([...refusalCopy(EN), ...refusalCopy(FR)])(
    "keeps %s free of the word premium and of any tier name",
    (key, value) => {
      for (const forbidden of TIER_WORDS) {
        expect(value, `${key} names a tier`).not.toMatch(forbidden);
      }
    },
  );

  it("routes a missing capability to an upgrade, naming the capability", () => {
    for (const locale of [EN, FR]) {
      expect(locale["billing.capabilityMissing"]).toContain("{{capability}}");
      expect(locale["billing.upgradeToGet"]).toContain("{{capability}}");
    }
  });

  it("does not describe a free account as an error", () => {
    for (const locale of [EN, FR]) {
      expect(locale["billing.status.none"]).toBeDefined();
      expect(locale["billing.status.none"]).not.toMatch(/\berror|erreur\b/i);
    }
  });
});

/*
 * AD-16's pricing rule, before the first live charge: a CAD list price, the
 * visitor's own currency at checkout, TAX INCLUDED. Adaptive Pricing is always
 * on and Stripe adds tax as merchant of record, so "taxes extra" — or any
 * French equivalent — would be false on the invoice.
 */
describe("price copy never says tax is extra", () => {
  const FORBIDDEN = [
    /taxes?\s+extra/i,
    /plus\s+tax/i,
    /tax(es)?\s+not\s+included/i,
    /before\s+tax/i,
    /excluding\s+tax/i,
    /taxes?\s+en\s+sus/i,
    /plus\s+taxes/i,
    /taxes?\s+non\s+inclus/i,
    /hors\s+taxes?/i,
    /avant\s+taxes?/i,
    /taxes?\s+en\s+plus/i,
  ];

  it.each([...Object.entries(EN), ...Object.entries(FR)])(
    "keeps %s free of a taxes-extra claim",
    (key, value) => {
      for (const forbidden of FORBIDDEN) {
        expect(value, `${key} claims tax is extra`).not.toMatch(forbidden);
      }
    },
  );

  it("states the CAD list price, the visitor's currency and tax inclusion", () => {
    expect(EN["billing.taxIncluded"]).toMatch(/canadian dollars/i);
    expect(EN["billing.taxIncluded"]).toMatch(/your own currency/i);
    expect(EN["billing.taxIncluded"]).toMatch(/tax included/i);

    expect(FR["billing.taxIncluded"]).toMatch(/dollars canadiens/i);
    expect(FR["billing.taxIncluded"]).toMatch(/votre propre devise/i);
    expect(FR["billing.taxIncluded"]).toMatch(/taxes incluses/i);
  });
});

/*
 * AD-8: commerce UI is Stripe-hosted without exception, and this app renders no
 * card field on any surface.
 *
 * The bans below are PROMPT-shaped rather than mention-shaped on purpose. The
 * hosted-payment notice has to be able to say "Nixus never asks for a card
 * number", which is the disclosure itself; what may never appear is copy that
 * labels or solicits one. The absence of an actual card INPUT is asserted
 * against the rendered DOM in `tests/e2e/billing.spec.ts`, which is where a
 * structural claim belongs.
 */
describe("no surface prompts for a card", () => {
  const CARD_PROMPTS = [
    /enter\s+your\s+card/i,
    /card\s+number\s*[:*]/i,
    /card\s+details\s*[:*]/i,
    /\bcvv\b/i,
    /\bcvc\b/i,
    /expiry\s+date/i,
    /entrez\s+votre\s+carte/i,
    /num[ée]ro\s+de\s+carte\s*[:*]/i,
    /date\s+d'expiration/i,
  ];

  it.each([...Object.entries(EN), ...Object.entries(FR)])(
    "keeps %s free of a card-entry prompt",
    (key, value) => {
      for (const forbidden of CARD_PROMPTS) {
        expect(value, `${key} prompts for card data`).not.toMatch(forbidden);
      }
    },
  );

  it("says plainly that payment happens on the processor's own pages", () => {
    expect(EN["billing.hostedNotice"]).toMatch(/Stripe/);
    expect(FR["billing.hostedNotice"]).toMatch(/Stripe/);
  });

  it("states that Nixus never asks for a card", () => {
    expect(EN["billing.hostedNotice"]).toMatch(/never asks/i);
    expect(FR["billing.hostedNotice"]).toMatch(/ne demande jamais/i);
  });
});

/*
 * AD-5: Stripe returns the visitor before the webhook has converged, so the
 * landing page's bounded wait must never be phrased as a failure.
 */
describe("the checkout landing copy is never a failure", () => {
  it.each(["checkout.updating", "checkout.pending", "checkout.unavailable"])(
    "%s says the payment went through",
    (key) => {
      expect(EN[key]).toMatch(/went through/i);
      expect(FR[key]).toMatch(/a été accepté/i);
    },
  );

  it.each(["checkout.updating", "checkout.pending", "checkout.unavailable", "checkout.settled"])(
    "%s never claims the payment failed",
    (key) => {
      expect(EN[key]).not.toMatch(/\bfailed\b|\bunsuccessful\b|\bdeclined\b/i);
      expect(FR[key]).not.toMatch(/\béchou|\brefus|\bannul/i);
    },
  );
});
