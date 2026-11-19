import { describe, expect, it } from "vitest";

import {
  ADVANCE_CAPABILITIES,
  ADVANCE_TIER,
  BACKFILL_ACTOR,
  BACKFILL_REASON,
  BACKFILL_STATUS,
  DEFAULT_ADMIN_EXPIRY_DAYS,
  ENTITLEMENT_ATTRIBUTE_NAMES,
  ENTITLEMENT_SORT_KEY as SCRIPT_ENTITLEMENT_SORT_KEY,
  HOSTED_AI_CONFIG_SORT_KEY,
  REQUIRED_REGION,
  USER_PARTITION_KEY_PREFIX,
  UUID_PATTERN as SCRIPT_UUID_PATTERN,
  VERSION_ATTRIBUTE as SCRIPT_VERSION_ATTRIBUTE,
  adminExpiresAtFor,
  deriveBackfillItem,
  dispositionOf,
  emptySummary,
  formatSummary,
  isEligibleHostedAiConfig,
  monthlyRequestLimitOf,
  parseAdminExpiryDays,
  subFromUserPartitionKey,
} from "../scripts/backfill-entitlements.ts";
import { ENTITLEMENT_ATTRIBUTES, toEntitlementRecord } from "./lib/entitlement.ts";
import {
  ENTITLEMENT_SORT_KEY,
  UUID_PATTERN,
  VERSION_ATTRIBUTE,
} from "./lib/table.ts";

/*
 * Epic G step 2's operator script, driven through its pure functions only. No
 * AWS client is constructed here and no network call is possible: the AWS path
 * lives behind `main()`, which this file never calls.
 */

const SUB = "b7f1c2d3-7055-4c26-8000-abcdef123456";
const NOW = new Date("2026-11-19T12:00:00Z");

function configItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pk: `USER#${SUB}`,
    sk: "CONFIG",
    premium: true,
    monthly_request_limit: 200,
    updated_at: "2026-08-26T00:00:00Z",
    ...overrides,
  };
}

/*
 * The script re-declares the destination item's literals because it cannot load
 * the `@nixus/shared` barrel in a plain Node process. This is the test that
 * makes that duplication safe: a rename in the storage boundary with no rename
 * in the script fails HERE rather than silently writing an unreadable record.
 */
describe("the script's key and attribute literals are the storage boundary's", () => {
  it("spells the same sort key, version attribute, and sub shape", () => {
    expect(SCRIPT_ENTITLEMENT_SORT_KEY).toBe(ENTITLEMENT_SORT_KEY);
    expect(SCRIPT_VERSION_ATTRIBUTE).toBe(VERSION_ATTRIBUTE);
    expect(SCRIPT_UUID_PATTERN.source).toBe(UUID_PATTERN.source);
    expect(SCRIPT_UUID_PATTERN.flags).toBe(UUID_PATTERN.flags);
  });

  it("spells every entitlement attribute it writes exactly as lib/entitlement.ts does", () => {
    for (const [name, value] of Object.entries(ENTITLEMENT_ATTRIBUTE_NAMES)) {
      expect(
        ENTITLEMENT_ATTRIBUTES[name as keyof typeof ENTITLEMENT_ATTRIBUTES],
        `attribute ${name}`,
      ).toBe(value);
    }
  });

  it("writes no statement-cache or Stripe-state attribute at all", () => {
    const written = Object.keys(
      deriveBackfillItem({
        sub: SUB,
        monthlyRequestLimit: 200,
        now: NOW,
        adminExpiresAt: 1,
      }),
    );

    for (const forbidden of [
      ENTITLEMENT_ATTRIBUTES.statement,
      ENTITLEMENT_ATTRIBUTES.statementIat,
      ENTITLEMENT_ATTRIBUTES.statementExp,
      ENTITLEMENT_ATTRIBUTES.stripeTier,
      ENTITLEMENT_ATTRIBUTES.stripeCapabilities,
      ENTITLEMENT_ATTRIBUTES.stripeStatus,
      "event_watermark",
      "stripe_customer_id",
    ]) {
      expect(written, `must not write ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("the eligibility predicate", () => {
  it("accepts a per-user CONFIG item explicitly carrying premium = true", () => {
    expect(isEligibleHostedAiConfig(configItem())).toBe(true);
  });

  /* `parseUserConfig` in apps/api-bedrock grants on exactly `true`, so a
   * truthy-but-not-true record is NOT entitled today and must not be granted an
   * entitlement by this migration. */
  it("refuses a truthy-but-not-true premium value", () => {
    for (const premium of ["true", 1, {}, [], "yes"]) {
      expect(
        isEligibleHostedAiConfig(configItem({ premium })),
        JSON.stringify(premium),
      ).toBe(false);
    }
  });

  it("refuses a missing, false, GLOBAL, usage, or non-user item", () => {
    expect(isEligibleHostedAiConfig(undefined)).toBe(false);
    expect(isEligibleHostedAiConfig({})).toBe(false);
    expect(isEligibleHostedAiConfig(configItem({ premium: false }))).toBe(false);
    expect(
      isEligibleHostedAiConfig({ pk: "GLOBAL", sk: "CONFIG", enabled: true }),
    ).toBe(false);
    expect(
      isEligibleHostedAiConfig(configItem({ sk: "USAGE#2026-08" })),
    ).toBe(false);
    expect(isEligibleHostedAiConfig(configItem({ pk: "ACCOUNT#x" }))).toBe(false);
  });

  /* A partition key whose suffix is not sub-shaped could never be written to the
   * billing table anyway: its own key builder refuses it. */
  it("refuses a user partition key whose suffix is not sub-shaped", () => {
    expect(isEligibleHostedAiConfig(configItem({ pk: "USER#not-a-sub" }))).toBe(
      false,
    );
    expect(isEligibleHostedAiConfig(configItem({ pk: "USER#" }))).toBe(false);
  });

  it("accepts the pool's real variant nibble rather than only RFC 4122 ones", () => {
    // `…-7055-4c26-…` has a variant nibble outside [89ab]; a stricter pattern
    // would refuse every real user in this pool.
    expect(subFromUserPartitionKey(`USER#${SUB}`)).toBe(SUB);
    expect(subFromUserPartitionKey("USER#not-a-sub")).toBeNull();
    expect(subFromUserPartitionKey(42)).toBeNull();
    expect(subFromUserPartitionKey(`ACCOUNT#${SUB}`)).toBeNull();
  });

  it("names the hosted-AI config sort key and the user prefix it scans for", () => {
    expect(HOSTED_AI_CONFIG_SORT_KEY).toBe("CONFIG");
    expect(USER_PARTITION_KEY_PREFIX).toBe("USER#");
  });
});

describe("the limit is carried over, never fabricated", () => {
  it("keeps a positive integer limit", () => {
    expect(monthlyRequestLimitOf(configItem({ monthly_request_limit: 200 }))).toBe(
      200,
    );
  });

  it("reports null for a limit the hosted-AI service would itself refuse", () => {
    for (const limit of [0, -1, 1.5, "200", null, undefined, Number.NaN]) {
      expect(
        monthlyRequestLimitOf(configItem({ monthly_request_limit: limit })),
        JSON.stringify(limit),
      ).toBeNull();
    }
    expect(monthlyRequestLimitOf(undefined)).toBeNull();
  });
});

describe("the skip rules protect a real paying customer", () => {
  it("migrates only when no record exists", () => {
    expect(dispositionOf(undefined)).toBe("migrate");
  });

  it("reports an existing admin record as already migrated, with no write", () => {
    expect(dispositionOf({ source: "admin" })).toBe("already_migrated");
  });

  /* The two reserved store sources are not Stripe's either, so they are left
   * alone the same way rather than being overwritten. */
  it("leaves an app-store or play record alone", () => {
    expect(dispositionOf({ source: "app_store" })).toBe("already_migrated");
    expect(dispositionOf({ source: "play" })).toBe("already_migrated");
  });

  /* `readSource` in lib/entitlement.ts defaults ANY unrecognised value to
   * `stripe`, so this must too: a partially malformed record belonging to a
   * paying customer is still that customer's. */
  it("treats a stripe, absent, or malformed source as stripe-owned and skips it", () => {
    expect(dispositionOf({ source: "stripe" })).toBe("skip_stripe_owned");
    expect(dispositionOf({})).toBe("skip_stripe_owned");
    expect(dispositionOf({ source: "" })).toBe("skip_stripe_owned");
    expect(dispositionOf({ source: 42 })).toBe("skip_stripe_owned");
    expect(dispositionOf({ source: "ADMIN" })).toBe("skip_stripe_owned");
  });
});

describe("the derived ENTITLEMENT item", () => {
  const item = deriveBackfillItem({
    sub: SUB,
    monthlyRequestLimit: 200,
    now: NOW,
    adminExpiresAt: 1_800_000_000,
  });

  it("is keyed exactly as the billing table expects", () => {
    expect(item.pk).toBe(`USER#${SUB}`);
    expect(item.sk).toBe("ENTITLEMENT");
  });

  /* INVESTIGATION §4: these users were granted HOSTED AI, so they map to
   * Advance. Classic would silently remove the only thing they were given. */
  it("grants the Advance capability set, sorted, with hosted_ai present", () => {
    expect(item[ENTITLEMENT_ATTRIBUTES.capabilities]).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    expect(ADVANCE_CAPABILITIES).toContain("hosted_ai");
    expect([...ADVANCE_CAPABILITIES]).toEqual([...ADVANCE_CAPABILITIES].sort());
    expect(item[ENTITLEMENT_ATTRIBUTES.tier]).toBe("advance");
    expect(ADVANCE_TIER).toBe("advance");
  });

  /* These accounts have no Stripe customer and no subscription, so `none` is the
   * only truthful status. It costs nothing because status is never a gate. */
  it("records status none, source admin, and version 1", () => {
    expect(item[ENTITLEMENT_ATTRIBUTES.status]).toBe("none");
    expect(BACKFILL_STATUS).toBe("none");
    expect(item[ENTITLEMENT_ATTRIBUTES.source]).toBe("admin");
    expect(item[VERSION_ATTRIBUTE]).toBe(1);
  });

  it("carries the limit over and records no Stripe period", () => {
    expect(item[ENTITLEMENT_ATTRIBUTES.monthlyRequestLimit]).toBe(200);
    expect(item[ENTITLEMENT_ATTRIBUTES.currentPeriodEnd]).toBeNull();

    const unlimited = deriveBackfillItem({
      sub: SUB,
      monthlyRequestLimit: null,
      now: NOW,
      adminExpiresAt: 1,
    });
    expect(unlimited[ENTITLEMENT_ATTRIBUTES.monthlyRequestLimit]).toBeNull();
  });

  it("carries AD-2's mandatory override provenance", () => {
    expect(item[ENTITLEMENT_ATTRIBUTES.adminExpiresAt]).toBe(1_800_000_000);
    expect(item[ENTITLEMENT_ATTRIBUTES.adminReason]).toBe(BACKFILL_REASON);
    expect(item[ENTITLEMENT_ATTRIBUTES.adminActor]).toBe(BACKFILL_ACTOR);
  });

  /* AD-14: the reason is recorded for audit and may never carry a personal
   * detail, an email, or a Stripe identifier. */
  it("records a reason that names the migration and no personal detail", () => {
    expect(BACKFILL_REASON).toMatch(/AD-17/);
    expect(BACKFILL_REASON).not.toMatch(/@/);
    expect(BACKFILL_REASON).not.toMatch(/cus_|sub_|price_|sk_|evt_/);
  });

  it("stamps created_at and updated_at from the run's own clock", () => {
    expect(item[ENTITLEMENT_ATTRIBUTES.createdAt]).toBe(NOW.toISOString());
    expect(item[ENTITLEMENT_ATTRIBUTES.updatedAt]).toBe(NOW.toISOString());
  });

  /*
   * The claim the script relies on, asserted rather than assumed: the record it
   * writes reads back through the billing service's own parser as an Advance
   * grant with an EMPTY statement, which is what makes
   * `handlers/entitlement.ts`'s read-path refresh mint one.
   */
  it("reads back through toEntitlementRecord as an unsigned Advance admin grant", () => {
    const record = toEntitlementRecord(item);

    expect(record.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    expect(record.source).toBe("admin");
    expect(record.status).toBe("none");
    expect(record.version).toBe(1);
    expect(record.monthly_request_limit).toBe(200);
    expect(record.admin_expires_at).toBe(1_800_000_000);
    // No statement, which `needsRefresh` reads as "mint one" (AD-9).
    expect(record.statement).toBe("");
    expect(record.statement_exp).toBe(0);
    // Nothing has ever converged over this record, so there is no recorded
    // Stripe state to restore.
    expect(record.stripe_state).toBeNull();
  });
});

describe("the admin expiry horizon", () => {
  /* The single highest-risk call in the migration. 90 days — the admin ROUTE's
   * validation bound — would be a silent revocation timer: nothing in the system
   * sweeps or alarms on admin expiry, so every grandfathered user would lose
   * hosted AI unnoticed, which AD-17's gate forbids. */
  it("defaults to a horizon far beyond the admin route's 90-day request bound", () => {
    expect(DEFAULT_ADMIN_EXPIRY_DAYS).toBe(3650);
    expect(DEFAULT_ADMIN_EXPIRY_DAYS).toBeGreaterThan(90);
  });

  it("is finite and in the future, never null and never already past", () => {
    const expiry = adminExpiresAtFor(NOW, DEFAULT_ADMIN_EXPIRY_DAYS);
    expect(Number.isInteger(expiry)).toBe(true);
    expect(expiry).toBeGreaterThan(Math.floor(NOW.getTime() / 1000));
    expect(expiry).toBe(
      Math.floor(NOW.getTime() / 1000) + 3650 * 24 * 60 * 60,
    );
  });

  it("lets an operator shorten it deliberately and refuses a nonsense horizon", () => {
    expect(parseAdminExpiryDays([])).toBe(DEFAULT_ADMIN_EXPIRY_DAYS);
    expect(parseAdminExpiryDays(["--admin-expires-at-days=30"])).toBe(30);

    for (const bad of ["0", "-5", "1.5", "", "abc"]) {
      expect(() =>
        parseAdminExpiryDays([`--admin-expires-at-days=${bad}`]),
      ).toThrow(/positive whole number/);
    }
  });
});

describe("the run refuses the wrong environment and reports what it did", () => {
  it("names the one region both stacks live in", () => {
    expect(REQUIRED_REGION).toBe("us-east-1");
  });

  it("reports every counter the operator needs, including failures", () => {
    const summary = emptySummary();
    expect(summary).toEqual({
      scanned: 0,
      eligible: 0,
      migrated: 0,
      alreadyMigrated: 0,
      skippedStripeOwned: 0,
      failed: 0,
    });

    const rendered = formatSummary({
      scanned: 9,
      eligible: 3,
      migrated: 1,
      alreadyMigrated: 1,
      skippedStripeOwned: 1,
      failed: 0,
    });

    for (const label of [
      "scanned",
      "eligible",
      "migrated",
      "already migrated",
      "skipped (stripe-owned)",
      "failed",
    ]) {
      expect(rendered, `summary omits ${label}`).toContain(label);
    }
    expect(rendered).toMatch(/scanned\s+9/);
    expect(rendered).toMatch(/skipped \(stripe-owned\)\s+1/);
  });
});
