import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BILLING_CAPABILITIES, type BillingCapability } from "@nixus/shared";

import {
  HOSTED_AI_CAPABILITY,
  hostedAiServiceability,
  resolveHostedAiEntitlement,
} from "./entitlement.ts";
import {
  type BillingEntitlement,
  billingEntitlementKey,
  billingTableName,
  getBillingEntitlement,
  parseBillingEntitlement,
  setDocumentClientForTesting,
} from "./table.ts";
import { FakeDocumentClient } from "./testing/fake-dynamo.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";

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
  it("reports an absent item as NO RECORD, which this release treats as denied", () => {
    expect(parseBillingEntitlement(undefined)).toBeUndefined();
  });

  it("reads a well-formed Advance record", () => {
    expect(parseBillingEntitlement(entitlementItem())).toEqual({
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthly_request_limit: 1000,
      version: 1,
    });
  });

  /* A record that exists but cannot be read is normalised to a record granting
   * NOTHING - present, so it is still distinguishable from an absent record,
   * and empty, so it denies. */
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
      ).toEqual({ capabilities: [], monthly_request_limit: 1000, version: 1 });
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

  /* `version` gates `quota.ts`'s reservation (Epic H): a record this release
   * cannot read a usable version from must not be reserved against, so it
   * normalises the same way an unusable limit does. */
  it("reports a non-integer or non-positive version as no usable version", () => {
    for (const version of [0, -1, 1.5, "1", null, undefined, Number.NaN]) {
      expect(
        parseBillingEntitlement(entitlementItem({ version }))?.version,
        JSON.stringify(version ?? null)
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
      "version",
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
      version: 1,
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
 * The whole AD-17/Epic H cutover turns on this one function: the billing
 * `ENTITLEMENT` record is the only shape, and an absent record is denied, full
 * stop - there is no second shape left to fall back to.
 */
describe("resolveHostedAiEntitlement: the authority is the only shape", () => {
  function resolve(entitlement: BillingEntitlement | undefined) {
    return resolveHostedAiEntitlement({ entitlement });
  }

  it("grants when the record's capabilities contain hosted_ai", () => {
    expect(
      resolve({ capabilities: ADVANCE, monthly_request_limit: 1000, version: 1 })
    ).toEqual({
      granted: true,
      monthlyRequestLimit: 1000,
      version: 1,
    });
  });

  /* The whole point of the cutover: a Classic subscriber holds a real, paid
   * entitlement that does NOT include hosted AI. */
  it("DENIES when the record grants nothing", () => {
    expect(
      resolve({ capabilities: [], monthly_request_limit: null, version: 1 })
    ).toEqual({ granted: false });

    expect(
      resolve({ capabilities: CLASSIC, monthly_request_limit: null, version: 1 })
    ).toEqual({ granted: false });
  });

  /* A malformed record parses into a present-but-empty grant, so it reaches this
   * function as a denial rather than as an absent record. */
  it("fails closed on a malformed record", () => {
    const malformed = parseBillingEntitlement(
      entitlementItem({ capabilities: "hosted_ai" })
    );

    expect(malformed).toBeDefined();
    expect(resolve(malformed)).toEqual({ granted: false });
  });

  it("denies when no record exists at all", () => {
    expect(resolve(undefined)).toEqual({ granted: false });
  });

  it("reports no limit when the record records none", () => {
    expect(
      resolve({ capabilities: ADVANCE, monthly_request_limit: null, version: 1 })
    ).toEqual({ granted: true, monthlyRequestLimit: null, version: 1 });
  });

  /* A limit the stored record spells badly is discarded by the parse, so a
   * grant with a garbage limit reaches this function as "granted, no limit" -
   * never a resurrected old value. */
  it("never honours a malformed stored limit", () => {
    const parsed = parseBillingEntitlement(
      entitlementItem({ monthly_request_limit: 1.5 })
    );

    expect(resolve(parsed)).toMatchObject({ granted: true, monthlyRequestLimit: null });
  });
});

/*
 * "Granted" and "serviceable" are deliberately two questions: a record with no
 * usable limit or no usable version has nothing `quota.ts` can reserve
 * against. Both routes ask this one function, so status cannot advertise what
 * invoke refuses.
 */
describe("hostedAiServiceability separates the grant from what can be reserved", () => {
  const granted: BillingEntitlement = {
    capabilities: ADVANCE,
    monthly_request_limit: 1000,
    version: 7,
  };

  function serviceability(entitlement: BillingEntitlement | undefined) {
    return hostedAiServiceability({
      hostedAi: resolveHostedAiEntitlement({ entitlement }),
    });
  }

  it("serves a grant with a usable limit and version", () => {
    expect(serviceability(granted)).toEqual({
      serviceable: true,
      monthlyRequestLimit: 1000,
      entitlementVersion: 7,
    });
  });

  it("refuses to serve a grant with no usable limit", () => {
    expect(
      serviceability({ capabilities: ADVANCE, monthly_request_limit: null, version: 7 })
    ).toEqual({ serviceable: false });
  });

  it("refuses to serve a grant with no usable version", () => {
    expect(
      serviceability({ capabilities: ADVANCE, monthly_request_limit: 1000, version: null })
    ).toEqual({ serviceable: false });
  });

  it("refuses to serve anything that was never granted", () => {
    expect(
      serviceability({ capabilities: CLASSIC, monthly_request_limit: 1000, version: 1 })
    ).toEqual({ serviceable: false });
    expect(serviceability(undefined)).toEqual({ serviceable: false });
  });
});
