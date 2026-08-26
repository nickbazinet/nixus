import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONFIG_SORT_KEY,
  GLOBAL_DEFAULT_MONTHLY_REQUEST_LIMIT,
  GLOBAL_PARTITION_KEY,
  chargedCountOf,
  getGlobalChargedCount,
  getGlobalConfig,
  getUserChargedCount,
  getUserConfig,
  globalConfigKey,
  globalUsageKey,
  parseGlobalConfig,
  parseUserConfig,
  periodKeyFor,
  remainingQuota,
  setDocumentClientForTesting,
  tableName,
  userConfigKey,
  userPartitionKey,
  userUsageKey,
} from "./table.ts";
import { FakeDocumentClient } from "./testing/fake-dynamo.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";

describe("key builders", () => {
  it("partitions users by Cognito sub and global state under GLOBAL", () => {
    expect(userPartitionKey(SUB)).toBe(`USER#${SUB}`);
    expect(userConfigKey(SUB)).toEqual({
      pk: `USER#${SUB}`,
      sk: CONFIG_SORT_KEY,
    });
    expect(globalConfigKey()).toEqual({
      pk: GLOBAL_PARTITION_KEY,
      sk: CONFIG_SORT_KEY,
    });
  });

  it("scopes usage items to a UTC month", () => {
    expect(userUsageKey(SUB, "2026-08")).toEqual({
      pk: `USER#${SUB}`,
      sk: "USAGE#2026-08",
    });
    expect(globalUsageKey("2026-08")).toEqual({
      pk: "GLOBAL",
      sk: "USAGE#2026-08",
    });
  });
});

describe("periodKeyFor", () => {
  it("zero-pads the month and uses UTC, not local time", () => {
    expect(periodKeyFor(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
    expect(periodKeyFor(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11");
  });

  it("attributes an instant just before UTC midnight to the ending month", () => {
    expect(periodKeyFor(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08");
    expect(periodKeyFor(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09");
  });

  it("does not shift the period for a local-time offset that crosses the boundary", () => {
    // 2026-09-01T00:30Z is still August in UTC-05:00, but the period key is UTC.
    expect(periodKeyFor(new Date("2026-09-01T00:30:00Z"))).toBe("2026-09");
  });
});

describe("parseUserConfig fails closed", () => {
  it("accepts only an explicitly premium record with a positive integer limit", () => {
    expect(parseUserConfig({ premium: true, monthly_request_limit: 250 })).toEqual(
      { premium: true, monthly_request_limit: 250 }
    );
  });

  it("rejects a missing, non-premium, or truthy-but-not-true record", () => {
    expect(parseUserConfig(undefined)).toBeUndefined();
    expect(parseUserConfig({})).toBeUndefined();
    expect(parseUserConfig({ premium: false, monthly_request_limit: 5 })).toBeUndefined();
    expect(parseUserConfig({ premium: "true", monthly_request_limit: 5 })).toBeUndefined();
    expect(parseUserConfig({ premium: 1, monthly_request_limit: 5 })).toBeUndefined();
  });

  it("rejects a non-positive, fractional, or non-numeric limit", () => {
    expect(parseUserConfig({ premium: true, monthly_request_limit: 0 })).toBeUndefined();
    expect(parseUserConfig({ premium: true, monthly_request_limit: -1 })).toBeUndefined();
    expect(parseUserConfig({ premium: true, monthly_request_limit: 1.5 })).toBeUndefined();
    expect(parseUserConfig({ premium: true, monthly_request_limit: "10" })).toBeUndefined();
    expect(parseUserConfig({ premium: true })).toBeUndefined();
  });
});

describe("parseGlobalConfig", () => {
  it("keeps enabled=false as a valid, parseable kill-switch state", () => {
    expect(parseGlobalConfig({ enabled: false, monthly_request_limit: 1000 })).toEqual(
      { enabled: false, monthly_request_limit: 1000 }
    );
  });

  it("treats a missing or malformed record as unavailable, never as unlimited", () => {
    expect(parseGlobalConfig(undefined)).toBeUndefined();
    expect(parseGlobalConfig({})).toBeUndefined();
    expect(parseGlobalConfig({ enabled: true })).toBeUndefined();
    expect(parseGlobalConfig({ monthly_request_limit: 1000 })).toBeUndefined();
    expect(parseGlobalConfig({ enabled: "true", monthly_request_limit: 1000 })).toBeUndefined();
    expect(parseGlobalConfig({ enabled: true, monthly_request_limit: 0 })).toBeUndefined();
  });

  it("documents the architecture-mandated seed default without creating it", () => {
    expect(GLOBAL_DEFAULT_MONTHLY_REQUEST_LIMIT).toBe(1000);
  });
});

describe("charged_count is the sole net quota authority", () => {
  it("treats an absent counter as zero for a first request of the month", () => {
    expect(chargedCountOf(undefined)).toBe(0);
    expect(chargedCountOf({})).toBe(0);
  });

  it("ignores a negative or non-numeric counter rather than granting extra quota", () => {
    expect(chargedCountOf({ charged_count: -5 })).toBe(0);
    expect(chargedCountOf({ charged_count: "7" })).toBe(0);
    expect(chargedCountOf({ charged_count: Number.NaN })).toBe(0);
    expect(chargedCountOf({ charged_count: 7 })).toBe(7);
  });

  it("never reports negative remaining quota", () => {
    expect(remainingQuota(100, 40)).toBe(60);
    expect(remainingQuota(100, 100)).toBe(0);
    expect(remainingQuota(100, 140)).toBe(0);
  });
});

describe("consistent config reads", () => {
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

  it("reads the user config strongly consistently from the configured table", async () => {
    client.queueItem({ premium: true, monthly_request_limit: 42 });

    await expect(getUserConfig(SUB)).resolves.toEqual({
      premium: true,
      monthly_request_limit: 42,
    });

    expect(client.gets).toHaveLength(1);
    expect(client.gets[0]!.input).toEqual({
      TableName: "nixus-hosted-ai",
      Key: { pk: `USER#${SUB}`, sk: "CONFIG" },
      ConsistentRead: true,
    });
  });

  it("reads the global config strongly consistently", async () => {
    client.queueItem({ enabled: true, monthly_request_limit: 1000 });

    await expect(getGlobalConfig()).resolves.toEqual({
      enabled: true,
      monthly_request_limit: 1000,
    });
    expect(client.gets[0]!.input).toMatchObject({
      Key: { pk: "GLOBAL", sk: "CONFIG" },
      ConsistentRead: true,
    });
  });

  it("reads both charged counters strongly consistently for the request's period", async () => {
    client.queueItem({ charged_count: 11 }).queueItem({ charged_count: 900 });

    await expect(getUserChargedCount(SUB, "2026-08")).resolves.toBe(11);
    await expect(getGlobalChargedCount("2026-08")).resolves.toBe(900);

    expect(client.gets.map((command) => command.input.Key)).toEqual([
      { pk: `USER#${SUB}`, sk: "USAGE#2026-08" },
      { pk: "GLOBAL", sk: "USAGE#2026-08" },
    ]);
    for (const command of client.gets) {
      expect(command.input.ConsistentRead).toBe(true);
    }
  });

  it("reports an absent usage item as zero charged units", async () => {
    client.queueItem(undefined);
    await expect(getUserChargedCount(SUB, "2026-08")).resolves.toBe(0);
  });

  it("refuses to run without a configured table name", () => {
    delete process.env.TABLE_NAME;
    expect(() => tableName()).toThrow(/TABLE_NAME/);
  });
});
