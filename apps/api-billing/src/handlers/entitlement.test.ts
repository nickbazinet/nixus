import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENTITLEMENT_STATEMENT_REFRESH_FRACTION,
  ENTITLEMENT_STATEMENT_TTL_SECONDS,
} from "@nixus/shared";

import { BillingFailureError } from "../lib/errors.ts";
import { setKmsClientForTesting } from "../lib/signing.ts";
import { FakeDynamo } from "../lib/testing/fake-dynamo.ts";
import { FakeKms } from "../lib/testing/fake-kms.ts";
import {
  SUB_A,
  SUB_B,
  TEST_SIGNING_KEY_ID,
  clearBillingEnvironment,
  installBillingEnvironment,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";
import {
  handleEntitlement,
  minimumClientVersion,
  needsRefresh,
  refuseClientBelowMinimum,
  resetFreeStatementLimitForTesting,
} from "./entitlement.ts";

/*
 * AD-9's read path, and AD-16's statement-correctness block: a free account
 * receives a verifiable, non-expired statement with no capabilities; a stored
 * statement is returned verbatim; a half-spent one is refreshed without making
 * this route a second writer of entitlement; and a client below the minimum
 * version is refused rather than served.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const REQUEST_ID = "req-entitlement";

let dynamo: FakeDynamo;
let kms: FakeKms;
let captured: string[];

function partitionKey(sub: string): string {
  return `USER#${sub}`;
}

function seedEntitlement(overrides: Record<string, unknown> = {}): void {
  dynamo.seed({
    pk: partitionKey(SUB_A),
    sk: "ENTITLEMENT",
    tier: "advance",
    capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
    status: "active",
    current_period_end: NOW_SECONDS + 30 * 86_400,
    monthly_request_limit: 1000,
    source: "stripe",
    statement: "NXS1.storedpayload.storedsignature",
    statement_iat: NOW_SECONDS - 3600,
    statement_exp: NOW_SECONDS + ENTITLEMENT_STATEMENT_TTL_SECONDS - 3600,
    version: 7,
    event_watermark: 1_795_000_000,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-18T11:00:00.000Z",
    ...overrides,
  });
}

function call(args: { readonly sub?: string; readonly clientVersion?: string | null } = {}) {
  return handleEntitlement({
    sub: args.sub ?? SUB_A,
    clientVersion: args.clientVersion ?? null,
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
  resetFreeStatementLimitForTesting();

  captured = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  setKmsClientForTesting(undefined);
  resetFreeStatementLimitForTesting();
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("AD-9's revocation floor", () => {
  it("reads the floor from configuration and refuses an absent one", () => {
    expect(minimumClientVersion()).toBe("0.0.0");
    delete process.env.MINIMUM_CLIENT_VERSION;
    expect(() => minimumClientVersion()).toThrow("is not configured");
  });

  /* The default of 0.0.0 refuses NOTHING at launch. A missing or unparseable
   * header must not lock out every client - including the account app, which
   * sends none - while the floor refuses nothing anyway. */
  it.each([[null], [""], ["not-a-version"], ["1.2.3"], ["0.0.0"]])(
    "refuses nothing while the floor is 0.0.0, even for the header %s",
    (clientVersion) => {
      expect(() => refuseClientBelowMinimum(clientVersion)).not.toThrow();
    },
  );

  it("serves a free statement with no client-version header at all", async () => {
    expect((await call({ clientVersion: null })).tier).toBe("free");
  });

  /* Once a REAL floor is configured, an unstated version cannot be shown to meet
   * it - which is the whole point of raising the floor after a key leak. */
  it.each([[null], [""], ["garbage"], ["1"], ["1.2"]])(
    "refuses the unstated or unparseable version %s once a floor exists",
    async (clientVersion) => {
      installBillingEnvironment({ MINIMUM_CLIENT_VERSION: "1.4.0" });

      const failure = await failureOf(call({ clientVersion }));
      expect(failure.failure).toEqual({
        code: "client_too_old",
        minimum_client_version: "1.4.0",
      });
    },
  );

  it.each([
    ["1.3.9", true],
    ["1.4.0", false],
    ["1.4.1", false],
    ["0.9.9", true],
    ["2.0.0", false],
    ["1.4.0-beta.1", false],
  ])("compares %s against the floor numerically", async (version, refused) => {
    installBillingEnvironment({ MINIMUM_CLIENT_VERSION: "1.4.0" });

    if (refused) {
      expect((await failureOf(call({ clientVersion: version }))).failure.code).toBe(
        "client_too_old",
      );
    } else {
      expect((await call({ clientVersion: version })).tier).toBe("free");
    }
  });

  /* A STRING compare would make "10.0.0" < "9.0.0" and lock out every build past
   * the ninth major. */
  it("does not string-compare versions", async () => {
    installBillingEnvironment({ MINIMUM_CLIENT_VERSION: "9.0.0" });
    expect((await call({ clientVersion: "10.0.0" })).tier).toBe("free");

    installBillingEnvironment({ MINIMUM_CLIENT_VERSION: "1.10.0" });
    expect(
      (await failureOf(call({ clientVersion: "1.9.0" }))).failure.code,
    ).toBe("client_too_old");
  });

  /* Refused BEFORE anything is read or signed: a build that cannot be served
   * must not cost a KMS call or a read either. */
  it("refuses before any read and before any signature", async () => {
    installBillingEnvironment({ MINIMUM_CLIENT_VERSION: "1.4.0" });
    seedEntitlement();

    await failureOf(call({ clientVersion: "1.0.0" }));
    expect(dynamo.gets).toHaveLength(0);
    expect(kms.signCount).toBe(0);
  });
});

describe("AD-16: a free account receives a verifiable, non-expired statement", () => {
  it("derives free from an absent record, with no entitlement write", async () => {
    const response = await call();

    expect(response).toMatchObject({
      tier: "free",
      capabilities: [],
      status: "none",
      current_period_end: null,
      monthly_request_limit: null,
      source: "stripe",
      version: null,
    });
    expect(response.statement).toMatch(/^NXS1\./);
    expect(response.statement_exp).toBeGreaterThan(NOW_SECONDS);

    // No record is created to work around the signing cost (AD-9).
    expect(dynamo.puts).toHaveLength(0);
    expect(dynamo.transactions).toHaveLength(0);
    expect(dynamo.itemCount).toBe(0);
  });

  /* A free statement is NEVER born-expired: that is what lets a client tell
   * verified free from could not reach the server. */
  it("gets a full window rather than a born-expired statement", async () => {
    const response = await call();
    expect(response.statement_exp).toBe(
      NOW_SECONDS + ENTITLEMENT_STATEMENT_TTL_SECONDS,
    );
  });

  it("binds the statement to the calling sub and the configured key", async () => {
    const response = await call();
    const claims = JSON.parse(
      Buffer.from(response.statement.split(".")[1]!, "base64url").toString("utf8"),
    ) as { sub: string; key_id: string; capabilities: string[] };

    expect(claims.sub).toBe(SUB_A);
    expect(claims.key_id).toBe(TEST_SIGNING_KEY_ID);
    expect(claims.capabilities).toEqual([]);
  });

  /* AD-9's per-`sub` bound, because there is no record to cache a free statement
   * on and signing is therefore on demand. */
  it("rate-limits free signing per sub, and refuses rather than writing a record", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await call()).tier).toBe("free");
    }

    expect((await failureOf(call())).failure.code).toBe("rate_limited");
    expect(captured.join("\n")).toContain("free_statement_rate_limited");
    expect(dynamo.itemCount).toBe(0);
  });

  it("bounds each sub separately", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) await call();
    await failureOf(call());

    // A different account is unaffected by the first one's burst.
    expect((await call({ sub: SUB_B })).tier).toBe("free");
  });

  it("admits again in the next window", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) await call();
    await failureOf(call());

    const later = new Date(NOW.getTime() + 61_000);
    expect(
      (
        await handleEntitlement({
          sub: SUB_A,
          clientVersion: null,
          now: later,
          requestId: REQUEST_ID,
        })
      ).tier,
    ).toBe("free");
  });
});

describe("a stored statement is returned verbatim", () => {
  it("returns the stored string and signs nothing", async () => {
    seedEntitlement();
    const response = await call();

    expect(response).toMatchObject({
      tier: "advance",
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      status: "active",
      monthly_request_limit: 1000,
      source: "stripe",
      statement: "NXS1.storedpayload.storedsignature",
      version: 7,
    });
    expect(kms.signCount).toBe(0);
    expect(dynamo.puts).toHaveLength(0);
  });

  it("drops a stored capability name this build does not know", async () => {
    seedEntitlement({ capabilities: ["hosted_ai", "teleportation"] });
    expect((await call()).capabilities).toEqual(["hosted_ai"]);
  });
});

describe("the refresh threshold", () => {
  const WINDOW = ENTITLEMENT_STATEMENT_TTL_SECONDS;

  it("refreshes at or below half the window and not above it", () => {
    const record = {
      statement: "NXS1.a.b",
      statement_iat: NOW_SECONDS,
      statement_exp: NOW_SECONDS + WINDOW,
    };

    expect(ENTITLEMENT_STATEMENT_REFRESH_FRACTION).toBe(0.5);
    expect(
      needsRefresh({
        record: { ...record } as never,
        nowSeconds: NOW_SECONDS + WINDOW / 2 - 1,
      }),
    ).toBe(false);
    expect(
      needsRefresh({
        record: { ...record } as never,
        nowSeconds: NOW_SECONDS + WINDOW / 2,
      }),
    ).toBe(true);
    expect(
      needsRefresh({
        record: { ...record } as never,
        nowSeconds: NOW_SECONDS + WINDOW,
      }),
    ).toBe(true);
  });

  it("refreshes a record carrying no statement at all", () => {
    expect(
      needsRefresh({
        record: { statement: "", statement_iat: 0, statement_exp: 0 } as never,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(true);
  });

  /* The write touches the statement-cache attributes ONLY, and never `tier`,
   * `capabilities` or `status` - so AD-2's single-writer authority over
   * entitlement still holds and this read path is not a third writer. */
  it("persists only the statement cache, conditional on an unchanged version", async () => {
    seedEntitlement({ statement_exp: NOW_SECONDS + 60 });
    const response = await call();

    expect(kms.signCount).toBe(1);
    expect(response.statement).toMatch(/^NXS1\./);
    expect(response.statement).not.toBe("NXS1.storedpayload.storedsignature");

    expect(dynamo.puts).toHaveLength(1);
    const put = dynamo.puts[0]!.input as {
      ConditionExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
      Item: Record<string, unknown>;
    };
    expect(put.ConditionExpression).toBe("#v = :expected");
    expect(put.ExpressionAttributeValues[":expected"]).toBe(7);

    const stored = dynamo.stored(partitionKey(SUB_A), "ENTITLEMENT")!;
    expect(stored.tier).toBe("advance");
    expect(stored.status).toBe("active");
    expect(stored.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    // Not a state advance, so the version is NOT bumped: bumping it would
    // invalidate a converging webhook's expected version for no reason.
    expect(stored.version).toBe(7);
    expect(stored.event_watermark).toBe(1_795_000_000);
    expect(stored.statement).toBe(response.statement);
  });

  /* A failed condition is DISCARDED, not retried: the authoritative state
   * changed underneath, and the next read re-derives from it. */
  it("discards a refresh whose condition failed, and still answers", async () => {
    seedEntitlement({ statement_exp: NOW_SECONDS + 60 });
    // Another writer advanced the entitlement between the read and the write.
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      tier: "advance",
      capabilities: ["hosted_ai"],
      status: "active",
      statement: "NXS1.newer.signature",
      statement_iat: NOW_SECONDS,
      statement_exp: NOW_SECONDS + 60,
      version: 9,
    });

    const response = await handleEntitlement({
      sub: SUB_A,
      clientVersion: null,
      now: NOW,
      requestId: REQUEST_ID,
    });

    expect(response.statement).toMatch(/^NXS1\./);
    // The newer record is untouched: the losing refresh is thrown away.
    expect(dynamo.stored(partitionKey(SUB_A), "ENTITLEMENT")!.version).toBe(9);
  });

  it("propagates a signing failure rather than serving a stale statement", async () => {
    seedEntitlement({ statement_exp: NOW_SECONDS + 60 });
    kms.failWith(new Error("KMSInternalException"));

    await expect(call()).rejects.toThrow("KMSInternalException");
    expect(dynamo.puts).toHaveLength(0);
  });
});

describe("AD-2: the read path never rewrites the grant", () => {
  it("returns an admin-sourced entitlement with its source intact", async () => {
    seedEntitlement({ source: "admin", admin_expires_at: NOW_SECONDS + 86_400 });

    expect((await call()).source).toBe("admin");
    expect(dynamo.puts).toHaveLength(0);
  });
});
