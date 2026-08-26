import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHARGED_COUNT,
  COMPLETED_COUNT,
  FAILED_AFTER_COMMIT_COUNT,
  REFUND_COUNT,
  RESERVATION_COUNT,
  createQuotaRequestContext,
  finalizeQuotaUnit,
  refundQuotaUnit,
  reserveQuotaUnit,
  settledCounterName,
  type QuotaRequestContext,
} from "./quota.ts";
import { setDocumentClientForTesting } from "./table.ts";
import { FakeDocumentClient, transactionCanceled } from "./testing/fake-dynamo.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";
const NOW = new Date("2026-08-26T10:00:00Z");
const USER_CONFIG = { premium: true as const, monthly_request_limit: 100 };
const GLOBAL_CONFIG = { enabled: true, monthly_request_limit: 1000 };

let client: FakeDocumentClient;
let context: QuotaRequestContext;

function sequentialIds(): () => string {
  let index = 0;
  return () => `id-${++index}`;
}

beforeEach(() => {
  client = new FakeDocumentClient();
  setDocumentClientForTesting(client.asDocumentClient());
  process.env.TABLE_NAME = "nixus-hosted-ai";
  context = createQuotaRequestContext(SUB, "2026-08", sequentialIds());
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  delete process.env.TABLE_NAME;
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function transactItems(index = 0): any[] {
  return client.transactions[index]!.input.TransactItems as any[];
}

function updateFor(items: any[], sk: string): any {
  return items.find((item) => item.Update?.Key.sk === sk)?.Update;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("request context is computed once", () => {
  it("issues a reservation id and three distinct idempotency tokens", () => {
    expect(context).toEqual({
      sub: SUB,
      periodKey: "2026-08",
      reservationId: "id-1",
      reserveToken: "id-2",
      refundToken: "id-3",
      finalizeToken: "id-4",
    });

    const tokens = new Set([
      context.reserveToken,
      context.refundToken,
      context.finalizeToken,
    ]);
    expect(tokens.size).toBe(3);
  });

  it("produces real distinct UUIDs by default", () => {
    const real = createQuotaRequestContext(SUB, "2026-08");
    const tokens = new Set([
      real.reservationId,
      real.reserveToken,
      real.refundToken,
      real.finalizeToken,
    ]);
    expect(tokens.size).toBe(4);
    for (const token of tokens) {
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(token.length).toBeLessThanOrEqual(36);
    }
  });
});

describe("reserve is one atomic transaction over user and GLOBAL", () => {
  it("issues exactly one TransactWriteItems call carrying the reserve token", async () => {
    client.queueOk();

    await expect(
      reserveQuotaUnit({ context, userConfig: USER_CONFIG, globalConfig: GLOBAL_CONFIG, now: NOW })
    ).resolves.toBe("reserved");

    expect(client.transactions).toHaveLength(1);
    expect(client.transactions[0]!.input.ClientRequestToken).toBe(
      context.reserveToken
    );
  });

  it("condition-checks both configs and updates both usage items in that one call", async () => {
    client.queueOk();
    await reserveQuotaUnit({ context, userConfig: USER_CONFIG, globalConfig: GLOBAL_CONFIG, now: NOW });

    const items = transactItems();
    expect(items).toHaveLength(4);

    expect(items[0].ConditionCheck.Key).toEqual({ pk: `USER#${SUB}`, sk: "CONFIG" });
    expect(items[0].ConditionCheck.ExpressionAttributeValues).toEqual({
      ":premium": true,
      ":monthly_request_limit": 100,
    });

    expect(items[1].ConditionCheck.Key).toEqual({ pk: "GLOBAL", sk: "CONFIG" });
    expect(items[1].ConditionCheck.ExpressionAttributeValues).toEqual({
      ":enabled": true,
      ":monthly_request_limit": 1000,
    });

    expect(items[2].Update.Key).toEqual({ pk: `USER#${SUB}`, sk: "USAGE#2026-08" });
    expect(items[3].Update.Key).toEqual({ pk: "GLOBAL", sk: "USAGE#2026-08" });
  });

  it("gates each usage item against its own configured limit", async () => {
    client.queueOk();
    await reserveQuotaUnit({ context, userConfig: USER_CONFIG, globalConfig: GLOBAL_CONFIG, now: NOW });

    const items = transactItems();
    const userUsage = updateFor(items, "USAGE#2026-08");
    expect(userUsage.ConditionExpression).toBe(
      `attribute_not_exists(#${CHARGED_COUNT}) OR #${CHARGED_COUNT} < :limit`
    );
    expect(items[2].Update.ExpressionAttributeValues[":limit"]).toBe(100);
    expect(items[3].Update.ExpressionAttributeValues[":limit"]).toBe(1000);
  });

  it("increments charged_count and reservation_count together, and nothing else", async () => {
    client.queueOk();
    await reserveQuotaUnit({ context, userConfig: USER_CONFIG, globalConfig: GLOBAL_CONFIG, now: NOW });

    for (const item of transactItems().slice(2)) {
      expect(item.Update.UpdateExpression).toContain(`ADD #${CHARGED_COUNT} :one`);
      expect(item.Update.UpdateExpression).toContain(`#${RESERVATION_COUNT} :one`);
      expect(item.Update.UpdateExpression).not.toContain(COMPLETED_COUNT);
      expect(item.Update.UpdateExpression).not.toContain(REFUND_COUNT);
      expect(item.Update.ExpressionAttributeValues[":one"]).toBe(1);
    }
  });
});

describe("reserve classifies a cancelled transaction by position", () => {
  const reserve = () =>
    reserveQuotaUnit({ context, userConfig: USER_CONFIG, globalConfig: GLOBAL_CONFIG, now: NOW });

  it("reports a changed user config so the caller can reread once", async () => {
    client.queueError(
      transactionCanceled("ConditionalCheckFailed", "None", "None", "None")
    );
    await expect(reserve()).resolves.toBe("config_changed");
  });

  it("reports a changed global config the same way", async () => {
    client.queueError(
      transactionCanceled("None", "ConditionalCheckFailed", "None", "None")
    );
    await expect(reserve()).resolves.toBe("config_changed");
  });

  it("reports user quota exhaustion when only the user usage gate fails", async () => {
    client.queueError(
      transactionCanceled("None", "None", "ConditionalCheckFailed", "None")
    );
    await expect(reserve()).resolves.toBe("user_quota_exhausted");
  });

  it("reports global exhaustion when only the global usage gate fails", async () => {
    client.queueError(
      transactionCanceled("None", "None", "None", "ConditionalCheckFailed")
    );
    await expect(reserve()).resolves.toBe("global_quota_exhausted");
  });

  it("prefers the config-changed classification when both a config and a usage gate fail", async () => {
    client.queueError(
      transactionCanceled("ConditionalCheckFailed", "None", "ConditionalCheckFailed", "None")
    );
    await expect(reserve()).resolves.toBe("config_changed");
  });

  it("never swallows a non-cancellation failure as an eligibility decision", async () => {
    client.queueError(new Error("throughput exceeded"));
    await expect(reserve()).rejects.toThrow("throughput exceeded");
  });

  it("rethrows a cancellation with no conditional failure rather than inventing an outcome", async () => {
    client.queueError(transactionCanceled("None", "None", "None", "None"));
    await expect(reserve()).rejects.toThrow(/Transaction cancelled/);
  });
});

describe("refund is idempotent and cannot go negative", () => {
  it("decrements charged_count and increments refund_count on both items in one call", async () => {
    client.queueOk();

    await expect(refundQuotaUnit({ context, now: NOW })).resolves.toBe(true);

    expect(client.transactions).toHaveLength(1);
    expect(client.transactions[0]!.input.ClientRequestToken).toBe(
      context.refundToken
    );

    const items = transactItems();
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.Update.Key)).toEqual([
      { pk: `USER#${SUB}`, sk: "USAGE#2026-08" },
      { pk: "GLOBAL", sk: "USAGE#2026-08" },
    ]);

    for (const item of items) {
      expect(item.Update.UpdateExpression).toContain(
        `ADD #${CHARGED_COUNT} :minus_one`
      );
      expect(item.Update.UpdateExpression).toContain(`#${REFUND_COUNT} :one`);
      expect(item.Update.ExpressionAttributeValues[":minus_one"]).toBe(-1);
      expect(item.Update.ConditionExpression).toBe(
        `#${CHARGED_COUNT} > :zero`
      );
    }
  });

  it("uses a token distinct from reserve so a retry cannot collide across kinds", async () => {
    client.queueOk().queueOk();
    await reserveQuotaUnit({ context, userConfig: USER_CONFIG, globalConfig: GLOBAL_CONFIG, now: NOW });
    await refundQuotaUnit({ context, now: NOW });

    const tokens = client.transactions.map(
      (command) => command.input.ClientRequestToken
    );
    expect(new Set(tokens).size).toBe(2);
  });

  it("reports no-op instead of throwing when there is nothing left to refund", async () => {
    client.queueError(
      transactionCanceled("ConditionalCheckFailed", "ConditionalCheckFailed")
    );
    await expect(refundQuotaUnit({ context, now: NOW })).resolves.toBe(false);
  });

  it("still surfaces an infrastructure failure", async () => {
    client.queueError(new Error("network down"));
    await expect(refundQuotaUnit({ context, now: NOW })).rejects.toThrow(
      "network down"
    );
  });
});

describe("finalize records the outcome without moving the net authority", () => {
  it("increments completed_count, the per-operation counter, and token aggregates", async () => {
    client.queueOk();

    await finalizeQuotaUnit({
      context,
      operation: "chat",
      outcome: "completed",
      inputTokens: 120,
      outputTokens: 45,
      now: NOW,
    });

    expect(client.transactions[0]!.input.ClientRequestToken).toBe(
      context.finalizeToken
    );

    const items = transactItems();
    expect(items).toHaveLength(2);

    for (const item of items) {
      const names = item.Update.ExpressionAttributeNames;
      expect(names["#outcome_counter"]).toBe(COMPLETED_COUNT);
      expect(names["#settled_counter"]).toBe("settled_chat_count");
      expect(item.Update.ExpressionAttributeValues[":input_tokens"]).toBe(120);
      expect(item.Update.ExpressionAttributeValues[":output_tokens"]).toBe(45);
    }
  });

  it("never touches charged_count on either outcome", async () => {
    client.queueOk().queueOk();

    await finalizeQuotaUnit({
      context,
      operation: "chat",
      outcome: "completed",
      inputTokens: 1,
      outputTokens: 1,
      now: NOW,
    });
    await finalizeQuotaUnit({
      context,
      operation: "statement_import",
      outcome: "failed_after_commit",
      inputTokens: 1,
      outputTokens: 0,
      now: NOW,
    });

    for (const transaction of client.transactions) {
      const items = transaction.input.TransactItems as {
        Update: { UpdateExpression: string; ConditionExpression?: string };
      }[];
      for (const item of items) {
        expect(item.Update.UpdateExpression).not.toContain(CHARGED_COUNT);
        expect(item.Update.ConditionExpression).toBeUndefined();
      }
    }
  });

  it("routes a post-commit failure to failed_after_commit_count", async () => {
    client.queueOk();

    await finalizeQuotaUnit({
      context,
      operation: "trends_insight",
      outcome: "failed_after_commit",
      inputTokens: 90,
      outputTokens: 12,
      now: NOW,
    });

    for (const item of transactItems()) {
      expect(item.Update.ExpressionAttributeNames["#outcome_counter"]).toBe(
        FAILED_AFTER_COMMIT_COUNT
      );
      expect(item.Update.ExpressionAttributeNames["#settled_counter"]).toBe(
        "settled_trends_insight_count"
      );
    }
  });

  it("names a distinct settled counter per operation in the closed set", () => {
    expect(
      (
        ["chat", "statement_import", "project_advice", "trends_insight"] as const
      ).map(settledCounterName)
    ).toEqual([
      "settled_chat_count",
      "settled_statement_import_count",
      "settled_project_advice_count",
      "settled_trends_insight_count",
    ]);
  });
});

describe("all three transaction kinds address the same period", () => {
  it("uses the context period key everywhere, never a freshly derived month", async () => {
    const boundaryContext = createQuotaRequestContext(SUB, "2026-08", sequentialIds());
    client.queueOk().queueOk().queueOk();

    await reserveQuotaUnit({
      context: boundaryContext,
      userConfig: USER_CONFIG,
      globalConfig: GLOBAL_CONFIG,
      now: new Date("2026-09-01T00:00:01Z"),
    });
    await refundQuotaUnit({
      context: boundaryContext,
      now: new Date("2026-09-01T00:00:02Z"),
    });
    await finalizeQuotaUnit({
      context: boundaryContext,
      operation: "chat",
      outcome: "completed",
      inputTokens: 1,
      outputTokens: 1,
      now: new Date("2026-09-01T00:00:03Z"),
    });

    const usageKeys = client.transactions
      .flatMap(
        (command) =>
          command.input.TransactItems as {
            Update?: { Key: { sk: string } };
          }[]
      )
      .map((item) => item.Update?.Key.sk)
      .filter((sk): sk is string => sk !== undefined);

    expect(usageKeys.length).toBeGreaterThan(0);
    for (const sk of usageKeys) {
      expect(sk).toBe("USAGE#2026-08");
    }
  });
});
