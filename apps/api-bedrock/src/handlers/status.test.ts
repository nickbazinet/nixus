import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDocumentClientForTesting } from "../lib/table.ts";
import { FakeDocumentClient } from "../lib/testing/fake-dynamo.ts";
import { handleStatus } from "./status.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";
const PERIOD = "2026-08";

let client: FakeDocumentClient;

beforeEach(() => {
  client = new FakeDocumentClient();
  setDocumentClientForTesting(client.asDocumentClient());
  process.env.TABLE_NAME = "nixus-hosted-ai";
  process.env.BILLING_TABLE_NAME = "nixus-billing-billing";
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  delete process.env.TABLE_NAME;
  delete process.env.BILLING_TABLE_NAME;
});

/* handleStatus issues its three reads concurrently, so the fake's queue order is
 * user-config, then global-config, then the billing ENTITLEMENT record. A
 * `queueConfigs` with no entitlement argument models the pre-backfill state: no
 * record exists, so the legacy `premium` attribute still decides (AD-17). */
function queueConfigs(
  user: Record<string, unknown> | undefined,
  global: Record<string, unknown> | undefined,
  entitlement?: Record<string, unknown> | undefined
): void {
  client.queueItem(user).queueItem(global).queueItem(entitlement);
}

function advanceEntitlement(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    pk: `USER#${SUB}`,
    sk: "ENTITLEMENT",
    tier: "advance",
    capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
    status: "none",
    monthly_request_limit: 1000,
    source: "admin",
    version: 1,
    ...overrides,
  };
}

describe("premium status read", () => {
  it("reports the configured limit and the period's charged count", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 }
    );
    client.queueItem({ charged_count: 37 });

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: true,
      monthly_request_limit: 250,
      charged_count: 37,
      period: PERIOD,
    });
  });

  it("reports zero charged units before the first request of the month", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 }
    );
    client.queueItem(undefined);

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: true,
      monthly_request_limit: 250,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("still reports premium once the user has exhausted their own quota", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 10 },
      { enabled: true, monthly_request_limit: 1000 }
    );
    client.queueItem({ charged_count: 10 });

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: true,
      monthly_request_limit: 10,
      charged_count: 10,
    });
  });
});

describe("a status read never becomes an enforcement gate", () => {
  it("answers 200-shaped zeroed fields for a user who was never made premium", async () => {
    queueConfigs(undefined, { enabled: true, monthly_request_limit: 1000 });

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("zeroes the fields for an explicitly non-premium record", async () => {
    queueConfigs(
      { premium: false, monthly_request_limit: 100 },
      { enabled: true, monthly_request_limit: 1000 }
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
      monthly_request_limit: 0,
    });
  });

  it("zeroes the fields for a malformed record rather than leaking a partial limit", async () => {
    queueConfigs(
      { premium: true },
      { enabled: true, monthly_request_limit: 1000 }
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
    });
  });

  it("reports non-premium while the global kill switch is off, even for a premium user", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: false, monthly_request_limit: 1000 }
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("reports non-premium when the GLOBAL config has never been seeded", async () => {
    queueConfigs({ premium: true, monthly_request_limit: 250 }, undefined);

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
    });
  });
});

describe("status consumes no quota and no Bedrock budget", () => {
  it("issues only consistent reads and never a write transaction", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 }
    );
    client.queueItem({ charged_count: 1 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.transactions).toHaveLength(0);
    expect(client.gets).toHaveLength(4);
    for (const command of client.gets) {
      expect(command.input.ConsistentRead).toBe(true);
    }
  });

  it("skips the usage read entirely for an ineligible caller", async () => {
    queueConfigs(undefined, { enabled: true, monthly_request_limit: 1000 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.gets).toHaveLength(3);
    expect(client.transactions).toHaveLength(0);
  });

  it("echoes back the period key it was handed rather than deriving its own", async () => {
    queueConfigs(undefined, { enabled: true, monthly_request_limit: 1000 });

    await expect(
      handleStatus({ sub: SUB, periodKey: "2019-01" })
    ).resolves.toMatchObject({ period: "2019-01" });
  });
});

/*
 * AD-17 step 4: the wire shape keeps its `premium` boolean for one deprecation
 * window, so an older desktop keeps working - but the boolean is now derived
 * from the entitlement authority, not from `HostedAiTable.premium`.
 */
describe("premium is sourced from the entitlement authority", () => {
  it("reports premium:true and the authority's limit when the record grants hosted_ai", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement()
    );
    client.queueItem({ charged_count: 4 });

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: true,
      // The authority's limit, not the legacy CONFIG item's 250.
      monthly_request_limit: 1000,
      charged_count: 4,
      period: PERIOD,
    });
  });

  /* Status and invoke share one serviceability rule, so status can never
   * advertise a capability every invoke refuses: with no legacy CONFIG item
   * there is nothing for `quota.ts` to reserve against until Epic H, and invoke
   * answers 503. */
  it("zeroes an authority-only grant the legacy item cannot yet meter", async () => {
    queueConfigs(
      undefined,
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement()
    );

    await expect(
      handleStatus({ sub: SUB, periodKey: PERIOD })
    ).resolves.toMatchObject({ premium: false, monthly_request_limit: 0 });
  });

  /* The cutover's defining case: a Classic subscriber's record grants no hosted
   * AI, and the legacy attribute may not resurrect it. */
  it("reports the zeroed non-premium shape when the record excludes hosted_ai", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({
        tier: "classic",
        capabilities: ["household_net_worth", "multi_device_sync"],
      })
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("zeroes the fields for a malformed record rather than falling back", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ capabilities: "hosted_ai" })
    );

    await expect(
      handleStatus({ sub: SUB, periodKey: PERIOD })
    ).resolves.toMatchObject({ premium: false, monthly_request_limit: 0 });
  });

  /* A grant with no limit on either shape cannot be metered by `quota.ts`, and
   * every invoke answers 503 for it - so status must not advertise it. */
  it("zeroes a grant neither shape records a usable limit for", async () => {
    queueConfigs(
      undefined,
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ monthly_request_limit: null })
    );

    await expect(
      handleStatus({ sub: SUB, periodKey: PERIOD })
    ).resolves.toMatchObject({ premium: false, monthly_request_limit: 0 });
  });

  it("falls back to the CONFIG item's limit when the record records none", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ monthly_request_limit: null })
    );
    client.queueItem({ charged_count: 7 });

    await expect(
      handleStatus({ sub: SUB, periodKey: PERIOD })
    ).resolves.toMatchObject({ premium: true, monthly_request_limit: 250 });
  });

  it("still hides an authority-granted capability while the kill switch is off", async () => {
    queueConfigs(
      { premium: true, monthly_request_limit: 250 },
      { enabled: false, monthly_request_limit: 1000 },
      advanceEntitlement()
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("hides it just as thoroughly when GLOBAL was never seeded", async () => {
    queueConfigs(undefined, undefined, advanceEntitlement());

    await expect(
      handleStatus({ sub: SUB, periodKey: PERIOD })
    ).resolves.toMatchObject({ premium: false });
  });

  it("reads the entitlement under the caller's own sub, never a parameter", async () => {
    queueConfigs(
      undefined,
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement()
    );
    client.queueItem({ charged_count: 0 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.gets.map((command) => command.input.Key)).toContainEqual({
      pk: `USER#${SUB}`,
      sk: "ENTITLEMENT",
    });
  });
});
