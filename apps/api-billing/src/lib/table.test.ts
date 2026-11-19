import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BILLING_CUSTOMER_SORT_KEY,
  ENTITLEMENT_SORT_KEY,
  ENTITLEMENT_TRANSACT_INDEX,
  EVENT_MARKER_TRANSACT_INDEX,
  billingCustomerKey,
  currentVersionFromConditionFailure,
  customerIndexName,
  entitlementKey,
  eventMarkerKey,
  eventSortKey,
  getItem,
  isUuidShaped,
  putVersionedItem,
  setDocumentClientForTesting,
  tableName,
  userPartitionKey,
  writeEntitlementStateAdvance,
} from "./table.ts";
import { BillingFailureError } from "./errors.ts";
import { FakeDynamo, throttlingError } from "./testing/fake-dynamo.ts";
import { SUB_A, SUB_B } from "./testing/fixtures.ts";

/*
 * The storage boundary (AD-4). The DynamoDB client is a real in-memory store, so
 * the concurrency contract is an observed property of the stored items rather
 * than of a mock's expectations: a failed condition must be a conflict carrying
 * the stored version, a replayed event must be a no-op, and an older event must
 * never win.
 */

const TABLE = "nixus-billing-billing";
const INDEX = "stripe-customer-index";

let dynamo: FakeDynamo;

function entitlementItem(args: {
  readonly sub: string;
  readonly version: number;
  readonly watermark?: number;
  readonly tier?: string;
}): Record<string, unknown> {
  return {
    ...entitlementKey(args.sub),
    version: args.version,
    tier: args.tier ?? "classic",
    ...(args.watermark === undefined
      ? {}
      : { event_watermark: args.watermark }),
  };
}

beforeEach(() => {
  process.env.BILLING_TABLE_NAME = TABLE;
  process.env.BILLING_TABLE_CUSTOMER_INDEX_NAME = INDEX;
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  delete process.env.BILLING_TABLE_NAME;
  delete process.env.BILLING_TABLE_CUSTOMER_INDEX_NAME;
});

describe("identity is shape-checked before a key exists (AD-3)", () => {
  it("accepts the 8-4-4-4-12 hex shape this pool actually issues", () => {
    expect(isUuidShaped(SUB_A)).toBe(true);
    // The variant nibble is deliberately NOT checked: this pool issues subs
    // whose variant is outside [89ab], so a strict RFC 4122 pattern would refuse
    // every real user.
    expect(isUuidShaped("11111111-2222-4333-c444-555555555555")).toBe(true);
    expect(isUuidShaped(SUB_A.toUpperCase())).toBe(true);
  });

  it.each([
    ["not-a-uuid"],
    [""],
    ["11111111-2222-4333-8444-55555555555"],
    ["11111111-2222-4333-8444-5555555555555"],
    ["11111111_2222_4333_8444_555555555555"],
    ["g1111111-2222-4333-8444-555555555555"],
  ])("refuses %s as unauthorized before composing a key", (candidate) => {
    expect(isUuidShaped(candidate)).toBe(false);
    expect(() => userPartitionKey(candidate)).toThrow(BillingFailureError);
    // Not a validation error: the identity itself is unusable, and the value is
    // never echoed back.
    try {
      userPartitionKey(candidate);
    } catch (error) {
      expect((error as BillingFailureError).failure.code).toBe("unauthorized");
      if (candidate.length > 0) {
        expect(
          JSON.stringify((error as BillingFailureError).failure),
        ).not.toContain(candidate);
      }
    }
  });
});

describe("key composition lives here and nowhere else (AD-4)", () => {
  it("composes the three sort keys under one partition per account", () => {
    expect(entitlementKey(SUB_A)).toEqual({
      pk: `USER#${SUB_A}`,
      sk: ENTITLEMENT_SORT_KEY,
    });
    expect(billingCustomerKey(SUB_A)).toEqual({
      pk: `USER#${SUB_A}`,
      sk: BILLING_CUSTOMER_SORT_KEY,
    });
    expect(eventMarkerKey(SUB_A, "evt_abc123")).toEqual({
      pk: `USER#${SUB_A}`,
      sk: "EVENT#evt_abc123",
    });
  });

  it("keeps two accounts in two partitions", () => {
    expect(entitlementKey(SUB_A).pk).not.toBe(entitlementKey(SUB_B).pk);
  });

  /* A Stripe event id arrives from a request body, so it is shape-checked before
   * it becomes half of a sort key - an id carrying a `#` would compose a key that
   * collided with another marker. */
  it.each([["evt_abc"], ["evt_1PzXyZ0000000000000000"], ["A".repeat(128)]])(
    "accepts the opaque event id %s",
    (eventId) => {
      expect(eventSortKey(eventId)).toBe(`EVENT#${eventId}`);
    },
  );

  it.each([[""], ["evt#abc"], ["evt abc"], ["evt/abc"], ["A".repeat(129)]])(
    "refuses the malformed event id %s",
    (eventId) => {
      expect(() => eventSortKey(eventId)).toThrow(BillingFailureError);
    },
  );
});

describe("configuration is required, never defaulted", () => {
  it("throws rather than reading from an unnamed table", () => {
    expect(tableName()).toBe(TABLE);
    expect(customerIndexName()).toBe(INDEX);

    delete process.env.BILLING_TABLE_NAME;
    delete process.env.BILLING_TABLE_CUSTOMER_INDEX_NAME;
    expect(() => tableName()).toThrow("BILLING_TABLE_NAME");
    expect(() => customerIndexName()).toThrow(
      "BILLING_TABLE_CUSTOMER_INDEX_NAME",
    );
  });
});

describe("reads are strongly consistent (AD-4)", () => {
  /* A webhook that just wrote and a read path that immediately re-reads must not
   * see the pre-write item: the version it carries is what the next conditional
   * write depends on. */
  it("sets ConsistentRead on every get", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 3 }));

    const item = await getItem(entitlementKey(SUB_A));

    expect(item).toMatchObject({ version: 3 });
    expect(dynamo.gets[0]!.input.ConsistentRead).toBe(true);
    expect(dynamo.gets[0]!.input.TableName).toBe(TABLE);
  });

  it("returns undefined for an absent item rather than throwing", async () => {
    expect(await getItem(entitlementKey(SUB_A))).toBeUndefined();
  });
});

describe("putVersionedItem is the read-path refresh's write (AD-9)", () => {
  it("creates only when nothing exists", async () => {
    await putVersionedItem({
      item: entitlementItem({ sub: SUB_A, version: 1 }),
      expectedVersion: null,
      resource: "entitlement",
    });

    expect(dynamo.stored(`USER#${SUB_A}`, ENTITLEMENT_SORT_KEY)).toMatchObject({
      version: 1,
    });
    expect(dynamo.puts[0]!.input.ConditionExpression).toBe(
      "attribute_not_exists(pk)",
    );
  });

  it("refuses a create over an existing item as a conflict, never an overwrite", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 7, tier: "advance" }));

    await expect(
      putVersionedItem({
        item: entitlementItem({ sub: SUB_A, version: 1 }),
        expectedVersion: null,
        resource: "entitlement",
      }),
    ).rejects.toThrow(BillingFailureError);

    // The stored item is untouched: a failed condition is never an overwrite.
    expect(dynamo.stored(`USER#${SUB_A}`, ENTITLEMENT_SORT_KEY)).toMatchObject({
      version: 7,
      tier: "advance",
    });
  });

  /* `ReturnValuesOnConditionCheckFailure: ALL_OLD` is what lets a conflict carry
   * the current version without a second read. */
  it("carries the stored version on a numbered conflict", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 4 }));

    try {
      await putVersionedItem({
        item: entitlementItem({ sub: SUB_A, version: 3 }),
        expectedVersion: 2,
        resource: "entitlement",
      });
      expect.unreachable("the conditional write should have failed");
    } catch (error) {
      const failure = (error as BillingFailureError).failure;
      expect(failure).toEqual({
        code: "version_conflict",
        resource: "entitlement",
        current_version: 4,
      });
    }
  });

  it("advances on a matching version", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 2 }));

    await putVersionedItem({
      item: entitlementItem({ sub: SUB_A, version: 3 }),
      expectedVersion: 2,
      resource: "entitlement",
    });

    expect(dynamo.stored(`USER#${SUB_A}`, ENTITLEMENT_SORT_KEY)).toMatchObject({
      version: 3,
    });
  });

  it("lets a throttle through as itself rather than as a conflict", async () => {
    dynamo.queueError(throttlingError());

    await expect(
      putVersionedItem({
        item: entitlementItem({ sub: SUB_A, version: 1 }),
        expectedVersion: null,
        resource: "entitlement",
      }),
    ).rejects.toThrow("Throughput exceeded");
  });
});

describe("writeEntitlementStateAdvance is ONE transaction (AD-4, AD-5)", () => {
  async function advance(args: {
    readonly expectedVersion: number | null;
    readonly version: number;
    readonly watermark: number;
    readonly eventId?: string;
  }) {
    return writeEntitlementStateAdvance({
      sub: SUB_A,
      entitlementItem: entitlementItem({
        sub: SUB_A,
        version: args.version,
        watermark: args.watermark,
      }),
      expectedVersion: args.expectedVersion,
      eventId: args.eventId ?? "evt_first",
      eventWatermark: args.watermark,
      eventMarkerExpiresAt: 1_800_000_000,
    });
  }

  it("writes the entitlement and the dedupe marker in one call", async () => {
    expect(
      await advance({ expectedVersion: null, version: 1, watermark: 100 }),
    ).toBe("written");

    // ONE command, not two sequential conditional writes: the marker is
    // therefore never durable before the work it guards.
    expect(dynamo.sent).toHaveLength(1);
    expect(dynamo.transactions).toHaveLength(1);
    expect(dynamo.puts).toHaveLength(0);

    expect(dynamo.stored(`USER#${SUB_A}`, ENTITLEMENT_SORT_KEY)).toMatchObject({
      version: 1,
      event_watermark: 100,
    });
    expect(dynamo.stored(`USER#${SUB_A}`, "EVENT#evt_first")).toEqual({
      pk: `USER#${SUB_A}`,
      sk: "EVENT#evt_first",
      expires_at: 1_800_000_000,
    });
  });

  /* The entitlement write carries ONE ConditionExpression combining BOTH guards.
   * Two sequential conditional writes would leave a window in which the version
   * held and the watermark did not. */
  it("combines the version and watermark guards in a single expression", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 1, watermark: 100 }));

    await advance({
      expectedVersion: 1,
      version: 2,
      watermark: 200,
      eventId: "evt_second",
    });

    const items = dynamo.transactions[0]!.input.TransactItems as {
      Put: { ConditionExpression: string };
    }[];
    const condition = items[ENTITLEMENT_TRANSACT_INDEX]!.Put.ConditionExpression;

    expect(condition).toBe(
      "#v = :expected AND (attribute_not_exists(#w) OR #w < :watermark)",
    );
    expect(condition.match(/ConditionExpression/g)).toBeNull();
    expect(items).toHaveLength(2);
  });

  /* AD-5: an out-of-order delivery must never downgrade a live entitlement. The
   * version still matches here - only the watermark does not advance. */
  it("refuses an older event even when the version matches", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 1, watermark: 500 }));

    await expect(
      advance({
        expectedVersion: 1,
        version: 2,
        watermark: 400,
        eventId: "evt_stale",
      }),
    ).rejects.toThrow(BillingFailureError);

    expect(dynamo.stored(`USER#${SUB_A}`, ENTITLEMENT_SORT_KEY)).toMatchObject({
      version: 1,
      event_watermark: 500,
    });
    // All-or-nothing: the marker for the stale event is not durable either.
    expect(dynamo.stored(`USER#${SUB_A}`, "EVENT#evt_stale")).toBeUndefined();
  });

  it("refuses an equal watermark, because advancing is strict", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 1, watermark: 500 }));

    await expect(
      advance({ expectedVersion: 1, version: 2, watermark: 500 }),
    ).rejects.toThrow(BillingFailureError);
  });

  /* A replayed event is acknowledged as a no-op (AD-5), which is a different
   * outcome from a conflict - Stripe must get a 2xx rather than a retry. */
  it("reports a replayed event as a duplicate, not a conflict", async () => {
    await advance({ expectedVersion: null, version: 1, watermark: 100 });
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 1, watermark: 100 }));

    expect(
      await advance({
        expectedVersion: 1,
        version: 2,
        watermark: 200,
        eventId: "evt_first",
      }),
    ).toBe("duplicate_event");
  });

  /* DynamoDB returns CancellationReasons POSITIONALLY, so a transaction that
   * failed BOTH guards is reported as the entitlement conflict - the actionable
   * half. The index constants and the TransactItems array are edited together or
   * not at all. */
  it("maps a both-guards failure to the entitlement conflict by index", async () => {
    dynamo.seed(entitlementItem({ sub: SUB_A, version: 9, watermark: 900 }));
    dynamo.seed({ ...eventMarkerKey(SUB_A, "evt_both") });

    try {
      await advance({
        expectedVersion: 1,
        version: 2,
        watermark: 100,
        eventId: "evt_both",
      });
      expect.unreachable("both guards should have failed");
    } catch (error) {
      expect((error as BillingFailureError).failure).toEqual({
        code: "version_conflict",
        resource: "entitlement",
        current_version: 9,
      });
    }

    expect(ENTITLEMENT_TRANSACT_INDEX).toBe(0);
    expect(EVENT_MARKER_TRANSACT_INDEX).toBe(1);
  });

  it("lets an error that is not a cancellation through untouched", async () => {
    dynamo.queueError(throttlingError());

    await expect(
      advance({ expectedVersion: null, version: 1, watermark: 100 }),
    ).rejects.toThrow("Throughput exceeded");
  });
});

describe("currentVersionFromConditionFailure", () => {
  /* The document client does not unmarshall an exception's `Item`, so this reads
   * the raw attribute value. */
  it("reads the raw N attribute and rejects anything else", () => {
    expect(
      currentVersionFromConditionFailure({ Item: { version: { N: "12" } } }),
    ).toBe(12);
    expect(currentVersionFromConditionFailure({ Item: {} })).toBeNull();
    expect(currentVersionFromConditionFailure(null)).toBeNull();
    expect(
      currentVersionFromConditionFailure({ Item: { version: { N: "0" } } }),
    ).toBeNull();
    expect(
      currentVersionFromConditionFailure({ Item: { version: { N: "1.5" } } }),
    ).toBeNull();
  });
});
