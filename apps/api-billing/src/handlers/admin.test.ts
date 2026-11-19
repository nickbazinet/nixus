import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTITLEMENT_STATEMENT_TTL_SECONDS } from "@nixus/shared";

import { BillingFailureError } from "../lib/errors.ts";
import { setKmsClientForTesting } from "../lib/signing.ts";
import { FakeDynamo } from "../lib/testing/fake-dynamo.ts";
import { FakeKms } from "../lib/testing/fake-kms.ts";
import {
  SUB_A,
  SUB_B,
  clearBillingEnvironment,
  installBillingEnvironment,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";
import { handleAdminOverride } from "./admin.ts";

/*
 * AD-2's second, ranked writer. It writes the override, is conditional on the
 * expected version like every other write, and is audited server-side with its
 * reason and its ACTOR - who is the caller, never a body member.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const EXPIRES_AT = NOW_SECONDS + 7 * 86_400;
const REQUEST_ID = "req-admin";

let dynamo: FakeDynamo;
let kms: FakeKms;
let captured: string[];

function partitionKey(sub: string): string {
  return `USER#${sub}`;
}

function stored(sub: string): Record<string, unknown> | undefined {
  return dynamo.stored(partitionKey(sub), "ENTITLEMENT");
}

function call(overrides: {
  readonly expectedVersion?: number | null;
  readonly sub?: string;
  readonly actorSub?: string;
  readonly reason?: string;
} = {}) {
  return handleAdminOverride({
    request: {
      sub: overrides.sub ?? SUB_A,
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync"],
      monthlyRequestLimit: 1000,
      adminExpiresAt: EXPIRES_AT,
      reason: overrides.reason ?? "support_grant_ticket_4821",
      expectedVersion:
        overrides.expectedVersion === undefined ? null : overrides.expectedVersion,
    },
    actorSub: overrides.actorSub ?? SUB_B,
    now: NOW,
    requestId: REQUEST_ID,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<BillingFailureError> {
  try {
    await promise;
    expect.unreachable("expected a billing failure");
  } catch (error) {
    if (error instanceof BillingFailureError) return error;
    throw error;
  }
}

beforeEach(() => {
  installBillingEnvironment();
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());
  kms = new FakeKms();
  setKmsClientForTesting(kms.asKmsClient());

  captured = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  setKmsClientForTesting(undefined);
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("the override is written as an override, not as a payment", () => {
  it("records source, expiry, reason and actor", async () => {
    const response = await call();

    expect(response).toMatchObject({
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync"],
      status: "none",
      current_period_end: null,
      monthly_request_limit: 1000,
      source: "admin",
      version: 1,
    });
    expect(response.statement).toMatch(/^NXS1\./);

    expect(stored(SUB_A)).toMatchObject({
      source: "admin",
      admin_expires_at: EXPIRES_AT,
      admin_reason: "support_grant_ticket_4821",
      admin_actor: SUB_B,
    });
  });

  /* Always visible and always time-boxed: the two attributes that make an
   * override distinguishable from a paid entitlement are both mandatory. */
  it("is never indistinguishable from a paid entitlement", async () => {
    await call();
    const item = stored(SUB_A)!;

    expect(item.source).toBe("admin");
    expect(Number(item.admin_expires_at)).toBeGreaterThan(NOW_SECONDS);
  });

  it("writes the subject's own partition, never the actor's", async () => {
    await call({ sub: SUB_A, actorSub: SUB_B });

    expect(stored(SUB_A)).toBeDefined();
    expect(stored(SUB_B)).toBeUndefined();
  });

  it("signs a statement bound to the SUBJECT, not to the administrator", async () => {
    const response = await call({ sub: SUB_A, actorSub: SUB_B });
    const claims = JSON.parse(
      Buffer.from(response.statement.split(".")[1]!, "base64url").toString("utf8"),
    ) as { sub: string; capabilities: string[]; exp: number; iat: number };

    expect(claims.sub).toBe(SUB_A);
    expect(claims.capabilities).toEqual(["hosted_ai", "multi_device_sync"]);
    // No Stripe period, so the statement gets a full window; the GRANT is bounded
    // by admin_expires_at instead.
    expect(claims.exp).toBe(claims.iat + ENTITLEMENT_STATEMENT_TTL_SECONDS);
  });
});

describe("the write is conditional, exactly like every other one (AD-4)", () => {
  it("creates only when no record exists", async () => {
    await call({ expectedVersion: null });
    expect(
      (dynamo.puts[0]!.input as { ConditionExpression: string }).ConditionExpression,
    ).toBe("attribute_not_exists(pk)");
  });

  it("refuses a create against an existing record with version_conflict", async () => {
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      source: "stripe",
      version: 4,
    });

    const failure = await failureOf(call({ expectedVersion: null }));
    expect(failure.failure).toEqual({
      code: "version_conflict",
      resource: "entitlement",
      current_version: 4,
    });
  });

  it("advances a numbered write and reports the stored version on a mismatch", async () => {
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      source: "stripe",
      tier: "classic",
      capabilities: ["multi_device_sync"],
      status: "active",
      version: 4,
    });

    expect((await call({ expectedVersion: 4 })).version).toBe(5);

    expect(
      (await failureOf(call({ expectedVersion: 1 }))).failure,
    ).toMatchObject({ code: "version_conflict", current_version: 5 });
  });

  /* The previously recorded Stripe state is carried forward, so the next
   * convergence after this override expires can restore it (AD-2). */
  it("preserves the recorded Stripe state it did not author", async () => {
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      source: "stripe",
      tier: "classic",
      capabilities: ["multi_device_sync"],
      status: "active",
      version: 4,
      event_watermark: 1_795_000_000,
      created_at: "2026-11-01T00:00:00.000Z",
      stripe_tier: "classic",
      stripe_status: "active",
      stripe_capabilities: ["multi_device_sync"],
    });

    await call({ expectedVersion: 4 });

    expect(stored(SUB_A)).toMatchObject({
      stripe_tier: "classic",
      stripe_status: "active",
      stripe_capabilities: ["multi_device_sync"],
      event_watermark: 1_795_000_000,
      created_at: "2026-11-01T00:00:00.000Z",
    });
  });

  it("writes nothing it could not sign", async () => {
    kms.failWith(new Error("KMSInternalException"));

    await expect(call()).rejects.toThrow("KMSInternalException");
    expect(stored(SUB_A)).toBeUndefined();
    expect(dynamo.puts).toHaveLength(0);
  });
});

describe("the grant is audited server-side (AD-14)", () => {
  it("records the actor, the subject, the reason and the grant", async () => {
    await call();

    const line = JSON.parse(
      captured.find((entry) => entry.includes("billing_admin_override"))!,
    ) as Record<string, unknown>;

    expect(Object.keys(line).sort()).toEqual([
      "actor_sub",
      "admin_expires_at",
      "capabilities",
      "event",
      "reason",
      "request_id",
      "subject_sub",
      "tier",
    ]);
    expect(line.actor_sub).toBe(SUB_B);
    expect(line.subject_sub).toBe(SUB_A);
    expect(line.reason).toBe("support_grant_ticket_4821");
  });

  /* The STATEMENT is never logged, on this route or any other (AD-14). */
  it("never logs the statement it minted", async () => {
    const response = await call();
    expect(captured.join("\n")).not.toContain(response.statement);
  });
});
