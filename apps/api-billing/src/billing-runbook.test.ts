import { describe, expect, it } from "vitest";

import {
  CATALOG_CAPABILITIES_METADATA_KEY,
  CATALOG_DISPLAY_ORDER_METADATA_KEY,
  CATALOG_MONTHLY_REQUEST_LIMIT_METADATA_KEY,
  CATALOG_TIER_METADATA_KEY,
} from "./lib/catalog.ts";
import { BILLING_METRIC_NAMES } from "./lib/metrics.ts";
import { loadTemplate, readRepoFile } from "./lib/testing/cfn.ts";

/*
 * The billing operations runbook is the operator's only account of how to run this
 * deployed stack. It carries the admin-override replacement for the manual `put-item`
 * grant (AD-2), the price-change procedure (AD-6), the rotation sequence for a signing
 * key an installed binary trusts offline (AD-9), and the alarm triage that tells an
 * operator a paying customer may currently be granted nothing (AD-6's malformed case).
 * A silent edit that reintroduces a hand-written entitlement, drops a rotation step, or
 * lets a real secret slip in would undo exactly what those architecture decisions exist
 * to prevent. Hence assertions on its content, mirroring
 * apps/api-bedrock/src/rollout-runbook.test.ts.
 */

const RUNBOOK = readRepoFile("docs/runbooks/billing-operations.md");
const TEMPLATE = loadTemplate("apps/api-billing/template.yaml");

/** Prose, with hard line-wraps collapsed to a single space, for assertions
 * about a phrase that may be wrapped across lines in the committed Markdown.
 * Code blocks and exact structural checks use RUNBOOK itself. */
const PROSE = RUNBOOK.replace(/\s+/g, " ");

function sectionOf(heading: string, terminator?: string): string {
  const start = RUNBOOK.indexOf(heading);
  expect(start, `section ${heading} is missing`).toBeGreaterThan(-1);
  const end =
    terminator === undefined || terminator.length === 0
      ? -1
      : RUNBOOK.indexOf(terminator, start + heading.length);
  return RUNBOOK.slice(start, end === -1 ? undefined : end);
}

function proseOf(section: string): string {
  return section.replace(/\s+/g, " ");
}

describe("every multi-step bash block fails fast", () => {
  it("sets -euo pipefail in every bash block that uses a variable", () => {
    const blocks = [...RUNBOOK.matchAll(/```bash\n([\s\S]*?)```/g)].map(
      (match) => match[1]!,
    );
    expect(blocks.length).toBeGreaterThanOrEqual(5);

    // Every bash block in this runbook reads a required variable or chains
    // dependent commands, so none of them is exempt the way a bare `git rm` or
    // `cd …` one-liner was in the bedrock runbook.
    const unguarded = blocks
      .filter((block) => !/^\s*set -[eu]/m.test(block))
      .map((block) => block.trim().split("\n")[0]);

    expect(unguarded).toEqual([]);
  });
});

describe("the admin override replaces the manual put-item grant", () => {
  it("states that AD-2 replaced the manual put-item path and forbids it", () => {
    expect(PROSE).toMatch(/REPLACES the manual `put-item` grant/i);
    expect(PROSE).toMatch(
      /Do not `put-item` against `BillingTable` under any circumstance/i,
    );
    expect(PROSE).toMatch(/exactly two writers of the entitlement record/i);
  });

  it("requires the nixus-billing-admin group claim and a mandatory expiry and reason", () => {
    const section = sectionOf(
      "## 5. The admin override",
      "## 6. Alarm response",
    );
    expect(section).toContain("nixus-billing-admin");
    expect(section).toContain("admin_expires_at");
    expect(section).toContain("ADMIN_OVERRIDE_MAX_DURATION_SECONDS");
    expect(section).toMatch(/never open-ended/i);
    expect(section).toMatch(/outranks a converging webhook/i);
  });

  it("parameterises the admin-override command with no literal account id, pool id, or sub", () => {
    const section = sectionOf(
      "Worked example",
      "No account id, pool id, or `sub` is written literally",
    );

    // No literal 12-digit AWS account id.
    expect(section).not.toMatch(/\b\d{12}\b/);
    // No literal Cognito pool id shape (region_alphanumeric).
    expect(section).not.toMatch(/\bus-east-1_[0-9a-zA-Z]+\b/);
    // No literal UUID-shaped sub.
    expect(section).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    );
    // Every identifier is a shell variable, guarded with the carried-over-variable
    // convention, never a pasted value.
    expect(section).toContain('"${TARGET_SUB:?');
    expect(section).toContain('"${BILLING_API_ENDPOINT:?');
    expect(section).toContain('"${ADMIN_ACCESS_TOKEN:?');
  });

  it("never instructs an operator to put-item an entitlement by hand", () => {
    expect(RUNBOOK).not.toMatch(/aws dynamodb put-item.*ENTITLEMENT/is);
    expect(RUNBOOK).not.toMatch(/aws dynamodb put-item.*entitlement/is);
  });
});

describe("the three custom metrics and three metadata keys are named off the exported constants", () => {
  it("names every metric BILLING_METRIC_NAMES exports", () => {
    expect(BILLING_METRIC_NAMES.length).toBe(3);
    for (const name of BILLING_METRIC_NAMES) {
      expect(RUNBOOK, `metric ${name} must be documented`).toContain(name);
    }
  });

  it("gives a response subsection for each of the three alarm metrics", () => {
    const section = sectionOf(
      "## 6. Alarm response",
      "## 7. Duplicate-subscription",
    );
    for (const name of BILLING_METRIC_NAMES) {
      expect(section, `alarm response section for ${name}`).toContain(
        `\`${name}\``,
      );
    }
  });

  it("names every metadata key the catalog parser reads", () => {
    for (const key of [
      CATALOG_TIER_METADATA_KEY,
      CATALOG_CAPABILITIES_METADATA_KEY,
      CATALOG_MONTHLY_REQUEST_LIMIT_METADATA_KEY,
      CATALOG_DISPLAY_ORDER_METADATA_KEY,
    ]) {
      expect(RUNBOOK, `metadata key ${key} must be documented`).toContain(key);
    }
  });

  it("states the CatalogMetadataMalformed consequence as paid-but-capability-less", () => {
    const section = sectionOf(
      "### `CatalogMetadataMalformed`",
      "### `WebhookFailure`",
    );
    expect(section).toMatch(/no capability was granted/i);
    expect(proseOf(section)).toMatch(/a paying customer is right now granted nothing/i);
    expect(section).toMatch(/Dashboard/i);
    expect(proseOf(section)).toMatch(/never a code\s*or deploy fix/i);
  });

  it("states WebhookFailure as Stripe retrying and DuplicateSubscription as a grant-the-union defect", () => {
    const webhookSection = sectionOf(
      "### `WebhookFailure`",
      "### `DuplicateSubscription`",
    );
    expect(webhookSection).toMatch(/Stripe is retrying/i);

    const duplicateSection = sectionOf(
      "### `DuplicateSubscription`",
      "## 7. Duplicate-subscription",
    );
    expect(duplicateSection).toMatch(/defect/i);
    expect(duplicateSection).toMatch(/grants the \*\*union\*\*/i);
    expect(duplicateSection).toMatch(/operator reconciles|reconcile by hand/i);
  });
});

describe("the status-is-not-a-subscription pitfall stays recorded", () => {
  it("names stripe_state and keeps the four questions distinct", () => {
    const section = sectionOf("## 13. Known pitfalls", "## 14.");
    const prose = proseOf(section);

    expect(prose).toMatch(/effective `status` is not evidence/i);
    expect(prose).toMatch(/`stripe_state`/);
    // The distinction the defect collapsed: capabilities grant, stripe_state proves.
    expect(prose).toMatch(/capabilities\[\]/);
    expect(prose).toMatch(/commercial relationship/i);
    expect(prose).toMatch(/money \*\*flowing now\*\*|flowing now/i);
    // And the bound on the fix, so nobody reads it as airtight.
    expect(prose).toMatch(/[Rr]esidual risk/);
    expect(prose).toMatch(/checkout_lock/);
  });

  it("records that nothing writes the subscription id AD-4 describes", () => {
    const section = sectionOf(
      "## 7. Duplicate-subscription",
      "## 8. The entitlement backfill",
    );
    const prose = proseOf(section);

    expect(prose).toMatch(/AD-4 describes a field that nothing writes/i);
    expect(prose).toMatch(/ONLY recorded evidence/);
    // The wrong substitute an operator would otherwise reach for.
    expect(prose).toMatch(/price_lookup_key/);
    expect(prose).toMatch(/last checkout \*\*attempt\*\*|checkout \*\*attempt\*\*/);
  });
});

describe("both SSM paths are named and no secret-like value appears", () => {
  it("names both SSM SecureString paths", () => {
    expect(RUNBOOK).toContain("/nixus-billing/stripe-secret-key");
    expect(RUNBOOK).toContain("/nixus-billing/stripe-webhook-secret");
  });

  it("carries no value that looks like a Stripe key or a bearer token", () => {
    expect(RUNBOOK).not.toMatch(/sk_test_[A-Za-z0-9]/);
    expect(RUNBOOK).not.toMatch(/sk_live_[A-Za-z0-9]/);
    expect(RUNBOOK).not.toMatch(/whsec_[A-Za-z0-9]/);
    expect(RUNBOOK).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
  });

  it("states secrets are read at cold start and never become environment variables", () => {
    expect(PROSE).toMatch(/read by the Lambda at \*\*cold start only\*\*/i);
    expect(PROSE).toMatch(/neither ever becomes an environment variable/i);
  });

  it("states the startup mode assertion and forbids printing or comparing key material in CI", () => {
    expect(PROSE).toMatch(/refuses to start if the loaded secret key's own mode/i);
    expect(RUNBOOK).toMatch(/No CI step may print or compare key material/i);
  });
});

describe("the catalog TTL matches the template default, read rather than hard-coded", () => {
  it("states the same TTL the template's CatalogCacheTtlSeconds parameter declares", () => {
    const templateDefault = TEMPLATE.parameters.CatalogCacheTtlSeconds?.Default;
    expect(templateDefault).toBe(300);
    expect(PROSE).toContain(`${templateDefault}-second TTL`);
    expect(PROSE).toContain(`**${templateDefault} seconds**`);
  });

  it("states the measured propagation time against that TTL", () => {
    expect(RUNBOOK).toMatch(/\*\*Measured:\*\* a price change propagated/i);
    expect(RUNBOOK).toContain("270 seconds");
  });
});

describe("signing-key rotation is documented as three ordered releases", () => {
  it("lists the three releases in order", () => {
    const section = sectionOf(
      "## 9. Signing-key rotation",
      "## 10. Secrets",
    );
    const addIndex = section.indexOf("Add the new key to the desktop's trusted set");
    const signIndex = section.indexOf("Switch the server to sign with the new key");
    const stopIndex = section.indexOf("Stop trusting the old key");

    expect(addIndex).toBeGreaterThan(-1);
    expect(signIndex).toBeGreaterThan(addIndex);
    expect(stopIndex).toBeGreaterThan(signIndex);
  });

  it("explains why the order cannot be compressed", () => {
    const section = sectionOf(
      "## 9. Signing-key rotation",
      "## 10. Secrets",
    );
    expect(proseOf(section)).toMatch(
      /a key an installed binary does not know\s*\*\*grants nothing\*\*/i,
    );
  });

  it("names the not_after and MinimumClientVersion revocation path", () => {
    const section = sectionOf(
      "## 9. Signing-key rotation",
      "## 10. Secrets",
    );
    expect(section).toContain("not_after");
    expect(section).toContain("MinimumClientVersion");
    expect(section).toMatch(/revocation path/i);
  });

  it("reads the public key with kms:GetPublicKey and expects 91-byte SPKI DER", () => {
    const section = sectionOf(
      "## 9. Signing-key rotation",
      "## 10. Secrets",
    );
    expect(section).toContain("aws kms get-public-key");
    expect(section).toMatch(/91-byte SPKI DER/i);
  });

  it("states the billing Lambda's own grant is sign-only", () => {
    const section = sectionOf(
      "## 9. Signing-key rotation",
      "## 10. Secrets",
    );
    expect(section).toMatch(/sign-only/i);
    expect(section).toMatch(/not `kms:Verify`/i);
    expect(section).toMatch(/not `kms:GetPublicKey`/i);
  });
});

describe("the portal status and the tax finding are both stated with evidence", () => {
  const portal = () =>
    sectionOf("## 1. Stripe Customer Portal", "## 2. Changing a price");

  /*
   * Pins the INVARIANT, not a status word. Read-backs on 2026-11-19 moved this
   * twice: cancel and payment-method update turned out to be on by Stripe
   * default, and then the feature itself was enabled by script - so "UNDONE"
   * and then "DISABLED" each became inaccurate in turn. What must never drift
   * is that the switchable-PRODUCT list is still owed as a Dashboard action and
   * that nothing here reads as "the portal is finished".
   */
  it("still owes the switchable-product list and never claims the portal is finished", () => {
    expect(portal()).toMatch(/plan switching/i);
    expect(portal()).toMatch(/Dashboard only|OWNER ACTION/i);
    expect(portal()).toMatch(/NOT SET|cannot be set by API/i);
    expect(portal()).not.toMatch(/portal is (now |fully )?configured/i);
    expect(portal()).not.toMatch(/\*\*Status: (DONE|COMPLETE)\b/i);
  });

  /*
   * The `products` field is accepted and silently dropped by Stripe. Recording
   * it is what stops the next operator spending an afternoon on an API call
   * that reports success and changes nothing, and what justifies the setup
   * script not checking that field for idempotency.
   */
  it("records that the switchable-product list is silently dropped by the API", () => {
    expect(portal()).toMatch(/silently dropped/i);
    expect(portal()).toMatch(/not `\[\]`, not `null`/i);
  });

  /*
   * AD-16's open question is now closed, but only a claim backed by the measured
   * numbers may stand - an unevidenced "verified" is exactly what the earlier
   * version of this test existed to prevent.
   */
  it("closes AD-16's tax question with the measured figures, not an assertion", () => {
    expect(portal()).toMatch(/VERIFIED 2026-11-19/);
    // Wrap-tolerant: markdown hard-wraps this phrase across a blockquote marker.
    expect(portal()).toMatch(/never affirmatively[\s>]+confirms/i);
    for (const figure of ["999", "150", "1149", "2999", "449", "3448"]) {
      expect(portal(), `tax evidence omits ${figure}`).toContain(figure);
    }
    expect(portal()).toMatch(/Tax \*\*is\*\* recalculated/);
  });

  it("states portal session creation was confirmed separately from the tax question", () => {
    expect(portal()).toMatch(/session creation\*\* was separately confirmed/i);
  });

  it("never claims live mode is enabled", () => {
    expect(RUNBOOK).toMatch(/\*\*Live mode is NOT enabled\.\*\*/);
    expect(RUNBOOK).not.toMatch(/live mode is (now |already )?enabled/i);
  });
});

describe("the capability-union closedness is explained for adding a tier vs a capability", () => {
  it("states that reusing existing capabilities is Dashboard-only and a new capability is a release", () => {
    const section = sectionOf(
      "## 3. Adding a tier with no deploy",
      "## 4. Discount codes",
    );
    expect(section).toMatch(/Dashboard-only/i);
    expect(section).toMatch(/is a release, in both/i);
    expect(section).toContain("entitlements.rs");
    expect(section).toMatch(/closed at compile time on purpose/i);
  });
});

describe("retained resources and rollback are stated plainly", () => {
  it("states the billing table and the KMS key are Retain and undeletable by the pipeline", () => {
    const section = sectionOf(
      "## 12. If something goes wrong",
      "## 13. Known pitfalls",
    );
    expect(section).toMatch(/DeletionPolicy: Retain.*UpdateReplacePolicy: Retain/is);
    expect(section).toMatch(/PITR on the table/i);
    expect(section).toMatch(/not granted\s*\n?`dynamodb:DeleteTable`/i);
  });

  it("states that no entitlement record is ever deleted, only versioned forward", () => {
    const section = sectionOf(
      "## 12. If something goes wrong",
      "## 13. Known pitfalls",
    );
    expect(section).toMatch(/There is no delete path for an\s*\n?entitlement record/i);
  });
});

describe("known pitfalls name the expand-depth rule and the /plans CORS requirement", () => {
  it("documents the four-level expand depth and the LIST data. prefix trap", () => {
    const section = sectionOf(
      "## 13. Known pitfalls",
      "## 14. Closing table",
    );
    expect(section).toMatch(/deeper than \*\*four\*\* levels/i);
    expect(section).toMatch(/prefixes every expand path with `data\.`/i);
    expect(section).toMatch(/one level too deep/i);
    expect(section).toMatch(/symptom an operator would observe/i);
  });

  it("documents the /plans CORS requirement and its silent-fallback symptom", () => {
    const section = sectionOf(
      "## 13. Known pitfalls",
      "## 14. Closing table",
    );
    expect(section).toContain("Access-Control-Allow-Origin");
    expect(section).toMatch(/GET \/plans/);
    expect(section).toMatch(/falls back to its baked-in prices forever/i);
  });
});

describe("the backfill section states ordering, idempotency, and the tier mapping", () => {
  it("names the backfill script and its dry-run default", () => {
    const section = sectionOf(
      "## 8. The entitlement backfill",
      "## 9. Signing-key rotation",
    );
    expect(section).toContain("scripts/backfill-entitlements.ts");
    expect(section).toMatch(/Dry-run by default/i);
    expect(section).toMatch(/Idempotent and re-runnable/i);
  });

  it("maps hand-granted premium users to Advance, not Classic", () => {
    const section = sectionOf(
      "## 8. The entitlement backfill",
      "## 9. Signing-key rotation",
    );
    expect(section).toMatch(/map to Advance/i);
    expect(section).toContain('tier: "advance"');
    expect(section).not.toMatch(/map to Classic/i);
  });

  it("states a record whose source is stripe is never overwritten", () => {
    const section = sectionOf(
      "## 8. The entitlement backfill",
      "## 9. Signing-key rotation",
    );
    expect(section).toMatch(/source` is already `stripe` is never overwritten/i);
  });

  it("states the backfill must run before premium is retired", () => {
    const section = sectionOf(
      "## 8. The entitlement backfill",
      "## 9. Signing-key rotation",
    );
    expect(section).toMatch(/must run BEFORE `premium` is retired/i);
    expect(section).toMatch(/fixed deploy order/i);
  });
});

describe("runbook structure", () => {
  it("has all fifteen numbered top-level sections", () => {
    for (let n = 0; n <= 14; n++) {
      expect(RUNBOOK, `section ${n} is missing`).toMatch(
        new RegExp(`^## ${n}\\. `, "m"),
      );
    }
  });

  it("the closing table names the two SSM paths and the three custom metrics", () => {
    const section = sectionOf("## 14. Closing table");
    expect(section).toContain("/nixus-billing/stripe-secret-key");
    expect(section).toContain("/nixus-billing/stripe-webhook-secret");
    for (const name of BILLING_METRIC_NAMES) {
      expect(section).toContain(name);
    }
  });
});
