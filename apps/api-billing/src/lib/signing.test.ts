import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENTITLEMENT_STATEMENT_PREFIX,
  ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM,
  ENTITLEMENT_STATEMENT_TTL_SECONDS,
  type EntitlementStatementClaims,
} from "@nixus/shared";

import {
  setKmsClientForTesting,
  signStatement,
  statementExpiry,
  statementSigningKeyArn,
  statementSigningKeyId,
} from "./signing.ts";
import { FakeKms } from "./testing/fake-kms.ts";
import {
  SUB_A,
  TEST_SIGNING_KEY_ARN,
  TEST_SIGNING_KEY_ID,
  clearBillingEnvironment,
  installBillingEnvironment,
} from "./testing/fixtures.ts";

/*
 * AD-9's signing half. The VERIFYING half lives in the desktop's Rust and the
 * billing role holds no `kms:Verify` grant, so what is asserted here is
 * everything this side owns: the exact format, the exact signing input, the
 * claim ORDER (the bytes are what gets signed), the algorithm and key, the `exp`
 * policy including its clamp boundary, and that a KMS failure propagates.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

let kms: FakeKms;

function decodeClaims(statement: string): EntitlementStatementClaims {
  const payload = statement.split(".")[1]!;
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as EntitlementStatementClaims;
}

function rawPayload(statement: string): string {
  return Buffer.from(statement.split(".")[1]!, "base64url").toString("utf8");
}

beforeEach(() => {
  installBillingEnvironment();
  kms = new FakeKms();
  setKmsClientForTesting(kms.asKmsClient());
});

afterEach(() => {
  setKmsClientForTesting(undefined);
  clearBillingEnvironment();
});

describe("the configured key reaches KMS and nothing else does", () => {
  it("reads the key id and ARN from configuration, refusing an absent one", () => {
    expect(statementSigningKeyId()).toBe(TEST_SIGNING_KEY_ID);
    expect(statementSigningKeyArn()).toBe(TEST_SIGNING_KEY_ARN);

    delete process.env.STATEMENT_SIGNING_KEY_ID;
    delete process.env.STATEMENT_SIGNING_KEY_ARN;
    expect(() => statementSigningKeyId()).toThrow("is not configured");
    expect(() => statementSigningKeyArn()).toThrow("is not configured");
  });

  it("signs with ECDSA_SHA_256 over RAW bytes of the configured key", async () => {
    await signStatement({
      sub: SUB_A,
      tier: "advance",
      capabilities: ["hosted_ai"],
      monthlyRequestLimit: 1000,
      currentPeriodEnd: null,
      now: NOW,
    });

    expect(kms.signed).toHaveLength(1);
    expect(kms.signed[0]).toMatchObject({
      KeyId: TEST_SIGNING_KEY_ARN,
      MessageType: "RAW",
      SigningAlgorithm: ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM,
    });
    expect(ENTITLEMENT_STATEMENT_SIGNING_ALGORITHM).toBe("ECDSA_SHA_256");
  });
});

describe("the statement format is exactly what the contract declares", () => {
  it("is NXS1.<payload>.<signature>, all base64url and unpadded", async () => {
    const { statement } = await signStatement({
      sub: SUB_A,
      tier: "classic",
      capabilities: ["multi_device_sync"],
      monthlyRequestLimit: null,
      currentPeriodEnd: null,
      now: NOW,
    });

    const parts = statement.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(ENTITLEMENT_STATEMENT_PREFIX);
    // base64url, and NEVER padded: a `=` would be rejected by the verifier.
    for (const part of [parts[1]!, parts[2]!]) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(part).not.toContain("=");
    }
  });

  /* The signing input is the FIRST TWO PARTS joined by a dot, with no trailing
   * dot. A signature taken over the whole three-part string, or over the payload
   * alone, verifies nowhere. */
  it("signs the first two parts joined by a dot, with no trailing dot", async () => {
    const { statement } = await signStatement({
      sub: SUB_A,
      tier: "classic",
      capabilities: [],
      monthlyRequestLimit: null,
      currentPeriodEnd: null,
      now: NOW,
    });

    const [prefix, payload] = statement.split(".");
    expect(kms.lastSigningInput()).toBe(`${prefix}.${payload}`);
    expect(kms.lastSigningInput()).not.toMatch(/\.$/);
    expect(kms.lastSigningInput().split(".")).toHaveLength(2);
  });

  /* Key ORDER is load-bearing: a re-serialised payload whose members moved would
   * not verify against the same signature. */
  it("serialises the claims in the declared order", async () => {
    const { statement } = await signStatement({
      sub: SUB_A,
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync"],
      monthlyRequestLimit: 1000,
      currentPeriodEnd: NOW_SECONDS + 86_400 * 30,
      now: NOW,
    });

    expect(Object.keys(decodeClaims(statement))).toEqual([
      "sub",
      "tier",
      "capabilities",
      "monthly_request_limit",
      "iat",
      "exp",
      "key_id",
    ]);
    expect(rawPayload(statement).indexOf('"sub"')).toBeLessThan(
      rawPayload(statement).indexOf('"tier"'),
    );
  });

  it("carries the configured key id so rotation needs no format change", async () => {
    const { claims } = await signStatement({
      sub: SUB_A,
      tier: "free",
      capabilities: [],
      monthlyRequestLimit: null,
      currentPeriodEnd: null,
      now: NOW,
    });

    expect(claims.key_id).toBe(TEST_SIGNING_KEY_ID);
    expect(claims.sub).toBe(SUB_A);
  });

  /* Sorted and deduplicated, so two representations of one grant are
   * byte-identical (AD-1). */
  it("sorts and deduplicates the capability list", async () => {
    const { claims } = await signStatement({
      sub: SUB_A,
      tier: "advance",
      capabilities: [
        "multi_device_sync",
        "hosted_ai",
        "multi_device_sync",
        "household_net_worth",
      ],
      monthlyRequestLimit: null,
      currentPeriodEnd: null,
      now: NOW,
    });

    expect(claims.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
  });
});

describe("AD-9's exp policy", () => {
  it("is iat + the contract TTL when there is no period end", () => {
    expect(statementExpiry({ iat: NOW_SECONDS, currentPeriodEnd: null })).toBe(
      NOW_SECONDS + ENTITLEMENT_STATEMENT_TTL_SECONDS,
    );
  });

  it("clamps to a period end that falls inside the window", () => {
    const periodEnd = NOW_SECONDS + 3600;
    expect(
      statementExpiry({ iat: NOW_SECONDS, currentPeriodEnd: periodEnd }),
    ).toBe(periodEnd);
  });

  it("keeps the full window when the period end is beyond it", () => {
    expect(
      statementExpiry({
        iat: NOW_SECONDS,
        currentPeriodEnd: NOW_SECONDS + ENTITLEMENT_STATEMENT_TTL_SECONDS * 30,
      }),
    ).toBe(NOW_SECONDS + ENTITLEMENT_STATEMENT_TTL_SECONDS);
  });

  /* The boundary itself: a period end exactly one window away is the point at
   * which the two bounds coincide, and neither may win by a second. */
  it("is identical at the clamp boundary", () => {
    const boundary = NOW_SECONDS + ENTITLEMENT_STATEMENT_TTL_SECONDS;
    expect(
      statementExpiry({ iat: NOW_SECONDS, currentPeriodEnd: boundary }),
    ).toBe(boundary);
    expect(
      statementExpiry({ iat: NOW_SECONDS, currentPeriodEnd: boundary - 1 }),
    ).toBe(boundary - 1);
    expect(
      statementExpiry({ iat: NOW_SECONDS, currentPeriodEnd: boundary + 1 }),
    ).toBe(boundary);
  });

  /* A FREE entitlement has no period end and must never receive a born-expired
   * statement: that is what lets a client tell verified free from unreachable. */
  it("never mints a born-expired statement for a free entitlement", async () => {
    const { claims } = await signStatement({
      sub: SUB_A,
      tier: "free",
      capabilities: [],
      monthlyRequestLimit: null,
      currentPeriodEnd: null,
      now: NOW,
    });

    expect(claims.exp).toBe(claims.iat + ENTITLEMENT_STATEMENT_TTL_SECONDS);
    expect(claims.exp).toBeGreaterThan(NOW_SECONDS);
  });

  /* A period end already in the PAST is not clamped to either. The subscription
   * is by then in a status that grants nothing, so the statement carries an empty
   * capability list; emitting it already-expired would make a verified
   * no-capability answer indistinguishable from an unreachable server. */
  it("does not clamp to a period end that has already passed", async () => {
    const { claims } = await signStatement({
      sub: SUB_A,
      tier: "classic",
      capabilities: [],
      monthlyRequestLimit: null,
      currentPeriodEnd: NOW_SECONDS - 86_400,
      now: NOW,
    });

    expect(claims.exp).toBeGreaterThan(NOW_SECONDS);
    expect(claims.exp).toBe(claims.iat + ENTITLEMENT_STATEMENT_TTL_SECONDS);
  });
});

describe("a KMS failure is a failure, never a partial statement", () => {
  it("propagates the failure rather than returning an unsigned statement", async () => {
    kms.failWith(new Error("KMSInternalException"));

    await expect(
      signStatement({
        sub: SUB_A,
        tier: "advance",
        capabilities: ["hosted_ai"],
        monthlyRequestLimit: 1000,
        currentPeriodEnd: null,
        now: NOW,
      }),
    ).rejects.toThrow("KMSInternalException");
  });

  it("refuses a response that carries no signature", async () => {
    kms.returnNoSignature();

    await expect(
      signStatement({
        sub: SUB_A,
        tier: "advance",
        capabilities: [],
        monthlyRequestLimit: null,
        currentPeriodEnd: null,
        now: NOW,
      }),
    ).rejects.toThrow("no signature");
  });
});
