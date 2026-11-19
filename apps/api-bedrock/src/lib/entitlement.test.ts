import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BILLING_CAPABILITIES, type BillingCapability } from "@nixus/shared";

import {
  HOSTED_AI_CAPABILITY,
  hostedAiServiceability,
  resolveHostedAiEntitlement,
} from "./entitlement.ts";
import {
  type BillingEntitlement,
  type UserConfig,
  billingEntitlementKey,
  billingTableName,
  getBillingEntitlement,
  parseBillingEntitlement,
  setDocumentClientForTesting,
} from "./table.ts";
import { FakeDocumentClient } from "./testing/fake-dynamo.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";

const PREMIUM_CONFIG: UserConfig = { premium: true, monthly_request_limit: 200 };

const ADVANCE: readonly BillingCapability[] = [
  "hosted_ai",
  "household_net_worth",
  "multi_device_sync",
];

const CLASSIC: readonly BillingCapability[] = [
  "household_net_worth",
  "multi_device_sync",
];

function entitlementItem(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    pk: `USER#${SUB}`,
    sk: "ENTITLEMENT",
    tier: "advance",
    capabilities: [...ADVANCE],
    status: "none",
    monthly_request_limit: 1000,
    source: "admin",
    version: 1,
    ...overrides,
  };
}

describe("the capability name is the contract's, not a second literal", () => {
  it("is a member of the shared closed union", () => {
    expect(BILLING_CAPABILITIES).toContain(HOSTED_AI_CAPABILITY);
    expect(HOSTED_AI_CAPABILITY).toBe("hosted_ai");
  });
});

describe("parseBillingEntitlement fails closed", () => {
  it("reports an absent item as NO RECORD, which is what keeps the fallback alive", () => {
    expect(parseBillingEntitlement(undefined)).toBeUndefined();
  });

  it("reads a well-formed Advance record", () => {
    expect(parseBillingEntitlement(entitlementItem())).toEqual({
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthly_request_limit: 1000,
    });
  });

  /* A record that exists but cannot be read is normalised to a record granting
   * NOTHING - present, so it still outranks the legacy attribute, and empty, so
   * it denies. */
  it("grants nothing when capabilities are missing or not an array", () => {
    for (const capabilities of [
      undefined,
      null,
      "hosted_ai",
      42,
      { hosted_ai: true },
      true,
    ]) {
      expect(
        parseBillingEntitlement(entitlementItem({ capabilities })),
        JSON.stringify(capabilities ?? null)
      ).toEqual({ capabilities: [], monthly_request_limit: 1000 });
    }
  });

  /* An unknown name is DROPPED rather than poisoning the record (billing AD-6),
   * so a list of only unknown names parses cleanly into an empty grant - which
   * denies. */
  it("drops an unknown capability name and keeps the recognised ones", () => {
    expect(
      parseBillingEntitlement(
        entitlementItem({ capabilities: ["hosted_ai", "teleportation"] })
      )?.capabilities
    ).toEqual(["hosted_ai"]);

    expect(
      parseBillingEntitlement(
        entitlementItem({ capabilities: ["custom_dashboards", "teleportation"] })
      )?.capabilities
    ).toEqual([]);
  });

  it("sorts and de-duplicates the grant so two representations are identical", () => {
    expect(
      parseBillingEntitlement(
        entitlementItem({
          capabilities: ["multi_device_sync", "hosted_ai", "hosted_ai"],
        })
      )?.capabilities
    ).toEqual(["hosted_ai", "multi_device_sync"]);
  });

  it("reports a non-integer or non-positive limit as no recorded limit", () => {
    for (const limit of [0, -1, 1.5, "1000", null, undefined, Number.NaN]) {
      expect(
        parseBillingEntitlement(
          entitlementItem({ monthly_request_limit: limit })
        )?.monthly_request_limit,
        JSON.stringify(limit ?? null)
      ).toBeNull();
    }
  });

  /* `tier` is an opaque display string no gate may compare (billing AD-1), and a
   * server-side consumer never parses the stored statement (billing AD-4). */
  it("carries neither the tier nor the signed statement into the decision", () => {
    const parsed = parseBillingEntitlement(
      entitlementItem({ statement: "NXS1.payload.signature" })
    );

    expect(parsed).not.toHaveProperty("tier");
    expect(parsed).not.toHaveProperty("statement");
    expect(Object.keys(parsed!).sort()).toEqual([
      "capabilities",
      "monthly_request_limit",
    ]);
  });
});

describe("the billing entitlement read", () => {
  let client: FakeDocumentClient;

  beforeEach(() => {
    client = new FakeDocumentClient();
    setDocumentClientForTesting(client.asDocumentClient());
    process.env.BILLING_TABLE_NAME = "nixus-billing-billing";
  });

  afterEach(() => {
    setDocumentClientForTesting(undefined);
    delete process.env.BILLING_TABLE_NAME;
  });

  it("issues exactly one strongly consistent GetItem against the billing table", async () => {
    client.queueItem(entitlementItem());

    await expect(getBillingEntitlement(SUB)).resolves.toEqual({
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthly_request_limit: 1000,
    });

    expect(client.sent).toHaveLength(1);
    expect(client.transactions).toHaveLength(0);
    expect(client.gets[0]!.input).toEqual({
      TableName: "nixus-billing-billing",
      Key: { pk: `USER#${SUB}`, sk: "ENTITLEMENT" },
      ConsistentRead: true,
    });
  });

  it("keys the record under the same USER# partition as the quota table", () => {
    expect(billingEntitlementKey(SUB)).toEqual({
      pk: `USER#${SUB}`,
      sk: "ENTITLEMENT",
    });
  });

  it("reports an absent record rather than inventing an empty grant", async () => {
    client.queueItem(undefined);
    await expect(getBillingEntitlement(SUB)).resolves.toBeUndefined();
  });

  /* Mirrors tableName()'s throw-if-unset: a read against an unnamed table would
   * otherwise look exactly like "this user has no entitlement". */
  it("refuses to read without a configured billing table name", () => {
    delete process.env.BILLING_TABLE_NAME;
    expect(() => billingTableName()).toThrow(/BILLING_TABLE_NAME/);
  });
});

/*
 * The precedence truth table from resolveHostedAiEntitlement's own docstring,
 * row by row. This is the single function the whole AD-17 cutover turns on.
 */
describe("resolveHostedAiEntitlement: the authority decides when a record exists", () => {
  function resolve(
    entitlement: BillingEntitlement | undefined,
    userConfig: UserConfig | undefined
  ) {
    return resolveHostedAiEntitlement({ entitlement, userConfig });
  }

  it("grants when the record's capabilities contain hosted_ai", () => {
    expect(
      resolve({ capabilities: ADVANCE, monthly_request_limit: 1000 }, undefined)
    ).toEqual({
      granted: true,
      authority: "billing_entitlement",
      monthlyRequestLimit: 1000,
    });
  });

  /* The whole point of the cutover: a Classic subscriber holds a real, paid
   * entitlement that does NOT include hosted AI, and the legacy attribute may
   * not resurrect it. */
  it("DENIES when the record grants nothing, even with premium = true still set", () => {
    expect(
      resolve({ capabilities: [], monthly_request_limit: null }, PREMIUM_CONFIG)
    ).toEqual({ granted: false, authority: "billing_entitlement" });

    expect(
      resolve({ capabilities: CLASSIC, monthly_request_limit: null }, PREMIUM_CONFIG)
    ).toEqual({ granted: false, authority: "billing_entitlement" });
  });

  /* A malformed record parses into a present-but-empty grant, so it reaches this
   * function as a denial rather than as an absent record. */
  it("fails closed on a malformed record even with premium = true still set", () => {
    const malformed = parseBillingEntitlement(
      entitlementItem({ capabilities: "hosted_ai" })
    );

    expect(malformed).toBeDefined();
    expect(resolve(malformed, PREMIUM_CONFIG)).toEqual({
      granted: false,
      authority: "billing_entitlement",
    });
  });

  it("falls back to the legacy premium attribute when no record exists", () => {
    expect(resolve(undefined, PREMIUM_CONFIG)).toEqual({
      granted: true,
      authority: "hosted_ai_premium_attribute",
      monthlyRequestLimit: 200,
    });
  });

  it("denies when neither shape grants anything", () => {
    expect(resolve(undefined, undefined)).toEqual({
      granted: false,
      authority: "hosted_ai_premium_attribute",
    });
  });
});

describe("resolveHostedAiEntitlement: which monthly_request_limit wins", () => {
  it("prefers the authority's limit over the legacy CONFIG item's", () => {
    expect(
      resolveHostedAiEntitlement({
        entitlement: { capabilities: ADVANCE, monthly_request_limit: 1000 },
        userConfig: PREMIUM_CONFIG,
      })
    ).toMatchObject({ monthlyRequestLimit: 1000 });
  });

  /* The authority is allowed to record no limit - a tier may grant hosted AI
   * with no per-tier cap - so the legacy item's limit is the fallback while both
   * shapes exist. */
  it("falls back to the CONFIG item's limit when the record records none", () => {
    expect(
      resolveHostedAiEntitlement({
        entitlement: { capabilities: ADVANCE, monthly_request_limit: null },
        userConfig: PREMIUM_CONFIG,
      })
    ).toMatchObject({ monthlyRequestLimit: 200 });
  });

  it("reports no limit at all when neither shape records a usable one", () => {
    expect(
      resolveHostedAiEntitlement({
        entitlement: { capabilities: ADVANCE, monthly_request_limit: null },
        userConfig: undefined,
      })
    ).toEqual({
      granted: true,
      authority: "billing_entitlement",
      monthlyRequestLimit: null,
    });
  });

  /* A limit the stored record spells badly is discarded by the parse, so the
   * fallback - never the garbage value - is what reaches the gate. */
  it("never honours a malformed stored limit", () => {
    const parsed = parseBillingEntitlement(
      entitlementItem({ monthly_request_limit: 1.5 })
    );

    expect(
      resolveHostedAiEntitlement({
        entitlement: parsed,
        userConfig: PREMIUM_CONFIG,
      })
    ).toMatchObject({ granted: true, monthlyRequestLimit: 200 });
  });
});

/*
 * "Granted" and "serviceable" are deliberately two questions during the AD-17
 * window, because `quota.ts` still reserves against the legacy CONFIG item. Both
 * routes ask this one function, so status cannot advertise what invoke refuses.
 */
describe("hostedAiServiceability separates the grant from what this release can serve", () => {
  const granted = { capabilities: ADVANCE, monthly_request_limit: 1000 };

  function serviceability(
    entitlement: BillingEntitlement | undefined,
    userConfig: UserConfig | undefined
  ) {
    return hostedAiServiceability({
      hostedAi: resolveHostedAiEntitlement({ entitlement, userConfig }),
      userConfig,
    });
  }

  it("serves a grant with a limit and a legacy item behind it", () => {
    expect(serviceability(granted, PREMIUM_CONFIG)).toEqual({
      serviceable: true,
      monthlyRequestLimit: 1000,
      // Carried through so the reservation condition-checks the same item.
      userConfig: PREMIUM_CONFIG,
    });
  });

  it("refuses to serve a grant with no legacy item for quota.ts to reserve against", () => {
    expect(serviceability(granted, undefined)).toEqual({ serviceable: false });
  });

  it("refuses to serve a grant neither shape records a usable limit for", () => {
    expect(
      serviceability({ capabilities: ADVANCE, monthly_request_limit: null }, undefined)
    ).toEqual({ serviceable: false });
  });

  it("refuses to serve anything that was never granted", () => {
    expect(
      serviceability({ capabilities: CLASSIC, monthly_request_limit: 1000 }, PREMIUM_CONFIG)
    ).toEqual({ serviceable: false });
    expect(serviceability(undefined, undefined)).toEqual({ serviceable: false });
  });

  it("serves the legacy fallback at the legacy item's own limit", () => {
    expect(serviceability(undefined, PREMIUM_CONFIG)).toEqual({
      serviceable: true,
      monthlyRequestLimit: 200,
      userConfig: PREMIUM_CONFIG,
    });
  });
});
