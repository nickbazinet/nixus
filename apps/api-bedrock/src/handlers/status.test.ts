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

/* handleStatus issues its two reads concurrently: the global kill switch, then
 * the billing ENTITLEMENT record. `HostedAiTable.premium` is retired (Epic H):
 * there is no second shape to queue. */
function queueConfigs(
  global: Record<string, unknown> | undefined,
  entitlement?: Record<string, unknown> | undefined
): void {
  client.queueItem(global).queueItem(entitlement);
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

/*
 * AD-17 step 4: the wire shape keeps its `premium` boolean for an older
 * desktop still reading it, but it is now sourced entirely from the
 * entitlement authority - `HostedAiTable.premium` no longer exists.
 */
describe("premium is sourced from the entitlement authority", () => {
  it("reports the authority's limit and the period's charged count", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 }, advanceEntitlement());
    client.queueItem({ charged_count: 37 });

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: true,
      monthly_request_limit: 1000,
      charged_count: 37,
      period: PERIOD,
    });
  });

  it("reports zero charged units before the first request of the month", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 }, advanceEntitlement());
    client.queueItem(undefined);

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: true,
      monthly_request_limit: 1000,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("still reports premium once the user has exhausted their own quota", async () => {
    queueConfigs(
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ monthly_request_limit: 10 })
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
  it("answers 200-shaped zeroed fields for a caller with no entitlement record", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 });

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: PERIOD,
    });
  });

  /* The cutover's defining case: a Classic subscriber's record grants no
   * hosted AI, and there is no legacy attribute left to resurrect it. */
  it("zeroes the fields for a record that excludes hosted_ai", async () => {
    queueConfigs(
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({
        tier: "classic",
        capabilities: ["household_net_worth", "multi_device_sync"],
      })
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
      monthly_request_limit: 0,
    });
  });

  it("zeroes the fields for a malformed record rather than leaking a partial limit", async () => {
    queueConfigs(
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ capabilities: "hosted_ai" })
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
    });
  });

  /* A grant with no usable limit, or no usable version, has nothing
   * `quota.ts` can meter, so status must not advertise it. */
  it("zeroes a grant with no usable limit", async () => {
    queueConfigs(
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ monthly_request_limit: null })
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
      monthly_request_limit: 0,
    });
  });

  it("zeroes a grant with no usable version", async () => {
    queueConfigs(
      { enabled: true, monthly_request_limit: 1000 },
      advanceEntitlement({ version: 0 })
    );

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
      monthly_request_limit: 0,
    });
  });

  it("reports non-premium while the global kill switch is off, even for an entitled user", async () => {
    queueConfigs({ enabled: false, monthly_request_limit: 1000 }, advanceEntitlement());

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toEqual({
      premium: false,
      monthly_request_limit: 0,
      charged_count: 0,
      period: PERIOD,
    });
  });

  it("reports non-premium when the GLOBAL config has never been seeded", async () => {
    queueConfigs(undefined, advanceEntitlement());

    await expect(handleStatus({ sub: SUB, periodKey: PERIOD })).resolves.toMatchObject({
      premium: false,
    });
  });
});

describe("status consumes no quota and no Bedrock budget", () => {
  it("issues only consistent reads and never a write transaction", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 }, advanceEntitlement());
    client.queueItem({ charged_count: 1 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.transactions).toHaveLength(0);
    expect(client.gets).toHaveLength(3);
    for (const command of client.gets) {
      expect(command.input.ConsistentRead).toBe(true);
    }
  });

  it("skips the usage read entirely for an ineligible caller", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.gets).toHaveLength(2);
    expect(client.transactions).toHaveLength(0);
  });

  it("echoes back the period key it was handed rather than deriving its own", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 });

    await expect(
      handleStatus({ sub: SUB, periodKey: "2019-01" })
    ).resolves.toMatchObject({ period: "2019-01" });
  });

  it("reads the entitlement under the caller's own sub, never a parameter", async () => {
    queueConfigs({ enabled: true, monthly_request_limit: 1000 }, advanceEntitlement());
    client.queueItem({ charged_count: 0 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.gets.map((command) => command.input.Key)).toContainEqual({
      pk: `USER#${SUB}`,
      sk: "ENTITLEMENT",
    });
  });
});
