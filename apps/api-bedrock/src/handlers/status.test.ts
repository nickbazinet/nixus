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
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  delete process.env.TABLE_NAME;
});

/* getUserConfig and getGlobalConfig are issued concurrently, so the fake's queue
 * order is user-config then global-config. */
function queueConfigs(
  user: Record<string, unknown> | undefined,
  global: Record<string, unknown> | undefined
): void {
  client.queueItem(user).queueItem(global);
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
    expect(client.gets).toHaveLength(3);
    for (const command of client.gets) {
      expect(command.input.ConsistentRead).toBe(true);
    }
  });

  it("skips the usage read entirely for an ineligible caller", async () => {
    queueConfigs(undefined, { enabled: true, monthly_request_limit: 1000 });

    await handleStatus({ sub: SUB, periodKey: PERIOD });

    expect(client.gets).toHaveLength(2);
    expect(client.transactions).toHaveLength(0);
  });

  it("echoes back the period key it was handed rather than deriving its own", async () => {
    queueConfigs(undefined, { enabled: true, monthly_request_limit: 1000 });

    await expect(
      handleStatus({ sub: SUB, periodKey: "2019-01" })
    ).resolves.toMatchObject({ period: "2019-01" });
  });
});
