import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_ANOMALIES,
  logAdminOverride,
  logBillingAnomaly,
  logDroppedCapability,
  logRequest,
  logUnhandled,
  type RequestLogFields,
} from "./logging.ts";

/*
 * AD-14's and AD-16's gate: a payload carrying EVERY forbidden field emits none
 * of them.
 *
 * The values below are distinctive enough that a substring search over the
 * captured console output is conclusive - a partial redaction that kept, say,
 * the last four characters of a customer id would still fail.
 *
 * The cast is the point of the test rather than a loophole: the serializer's own
 * signature already makes every one of these a compile error (`NeverLogged`
 * types each as `never`), so the ONLY way a forbidden field can reach it is to
 * defeat the types deliberately - which is what this does, to prove the runtime
 * half holds too.
 */

const FORBIDDEN = {
  stripe_secret_key: "sk_live_ZZQQXXWWVVUUTTSSRR",
  stripe_webhook_secret: "whsec_ZZQQXXWWVVUUTTSSRR",
  stripe_signature: "t=1700000000,v1=deadbeefZZQQXX",
  raw_body: '{"id":"evt_ZZQQXX","object":"event"}',
  body: '{"plan_lookup_key":"classic_monthly_cad"}',
  stripe_customer_id: "cus_ZZQQXXWWVVUU",
  stripe_subscription_id: "sub_ZZQQXXWWVVUU",
  promotion_code: "ZZQQXXPROMO",
  statement: "NXS1.ZZQQXXeyJzdWIiOiJ4In0.ZZQQXXsignature",
  token: "eyJhbGciOiJSUzI1NiZZQQXX",
  access_token: "eyJhbGciOiJSUzI1NiZZQQXXaccess",
  refresh_token: "ZZQQXXrefresh",
  id_token: "ZZQQXXidtoken",
  authorization: "Bearer ZZQQXXbearer",
  cookie: "__Host-nixus_session=ZZQQXXcookie",
  card: "4242424242424242",
  card_number: "4000056655665556",
  cvv: "737",
  payment_method: "pm_ZZQQXXWWVVUU",
} as const;

const LOGGABLE = {
  request_id: "req-logging",
  route: "/entitlement",
  method: "GET",
  status: 200,
  latency_ms: 12,
  sub: "11111111-2222-4333-8444-555555555555",
  stripe_event_type: "customer.subscription.updated",
  stripe_event_id: "evt_loggable",
  tier: "classic",
  capabilities: ["hosted_ai", "multi_device_sync"],
} as const;

let captured: string[];

beforeEach(() => {
  captured = [];
  const capture = (...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function assertNothingForbidden(): void {
  const haystack = captured.join("\n");

  for (const [name, value] of Object.entries(FORBIDDEN)) {
    expect(haystack, `${name} leaked its VALUE`).not.toContain(value);
    expect(haystack, `${name} leaked its NAME`).not.toContain(name);
  }
}

describe("the serializer emits no forbidden field (AD-14, AD-16)", () => {
  it("drops every one of them from a payload that carries them all", () => {
    logRequest({
      ...LOGGABLE,
      ...FORBIDDEN,
    } as unknown as RequestLogFields);

    expect(captured).toHaveLength(1);
    assertNothingForbidden();
  });

  it("still emits the allow-listed fields from that same payload", () => {
    logRequest({
      ...LOGGABLE,
      ...FORBIDDEN,
    } as unknown as RequestLogFields);

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;

    expect(Object.keys(line).sort()).toEqual([
      "capabilities",
      "error_code",
      "event",
      "latency_ms",
      "method",
      "request_id",
      "route",
      "status",
      "stripe_event_id",
      "stripe_event_type",
      "sub",
      "tier",
    ]);
    expect(line.sub).toBe(LOGGABLE.sub);
    expect(line.route).toBe("/entitlement");
    expect(line.status).toBe(200);
    expect(line.tier).toBe("classic");
    expect(line.capabilities).toEqual(["hosted_ai", "multi_device_sync"]);
  });

  /* The emitted object is constructed member by member rather than spread, which
   * is what makes the field set fixed: a key count that grew with the payload
   * would mean the serializer forwards whatever it is handed. */
  it("emits the same key set whether or not forbidden fields were passed", () => {
    logRequest(LOGGABLE);
    logRequest({ ...LOGGABLE, ...FORBIDDEN } as unknown as RequestLogFields);

    const [clean, dirty] = captured.map(
      (line) => Object.keys(JSON.parse(line)).sort().join(","),
    );
    expect(dirty).toBe(clean);
  });

  it("nulls an absent allow-listed field rather than omitting it", () => {
    logRequest({
      request_id: "req-minimal",
      route: "/plans",
      method: "GET",
      status: 200,
      latency_ms: 3,
    });

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;

    // A stable key set is what makes a CloudWatch Insights query over these
    // lines possible at all.
    expect(line.sub).toBeNull();
    expect(line.tier).toBeNull();
    expect(line.capabilities).toBeNull();
    expect(line.stripe_event_id).toBeNull();
    expect(line.error_code).toBeNull();
  });
});

describe("severity follows the status, not the caller", () => {
  it("writes a 5xx to console.error and everything else to console.log", () => {
    const error = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");

    logRequest({ ...LOGGABLE, status: 503 });
    expect(error).toHaveBeenCalledTimes(1);

    logRequest({ ...LOGGABLE, status: 409 });
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("an unhandled throw records a class name and nothing else", () => {
  /* An exception message can carry a Stripe key, a raw webhook body, or a
   * customer identifier, so only the error's class name is recorded. */
  it("never emits the message of the error it was given", () => {
    logUnhandled(
      "req-unhandled",
      new Error(
        `cannot read USER#${LOGGABLE.sub} with ${FORBIDDEN.stripe_secret_key}`,
      ),
    );

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;

    expect(line.event).toBe("billing_unhandled_error");
    expect(line.error_name).toBe("Error");
    expect(captured.join("\n")).not.toContain("cannot read");
    assertNothingForbidden();
  });

  it("reports a non-Error throw as unknown rather than stringifying it", () => {
    logUnhandled("req-unhandled", { secret: FORBIDDEN.stripe_secret_key });

    expect(
      (JSON.parse(captured[0]!) as Record<string, unknown>).error_name,
    ).toBe("unknown");
    assertNothingForbidden();
  });
});

describe("AD-6's dropped-capability warning", () => {
  /* The capability NAME is operator-authored Stripe Product metadata, not user
   * data, so it is loggable - and it has to be, because it is the only way an
   * operator learns which metadata key they mistyped. Nothing else of the
   * Product is. */
  it("names the dropped capability and carries no Product data", () => {
    logDroppedCapability({
      request_id: "req-capability",
      dropped_capability: "househould_net_worth",
    });

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;

    expect(Object.keys(line).sort()).toEqual([
      "dropped_capability",
      "event",
      "request_id",
    ]);
    expect(line.dropped_capability).toBe("househould_net_worth");
  });
});

describe("the anomaly channel is closed and allow-listed", () => {
  /* The anomaly NAME is a closed union for the same reason the request
   * serializer's field list is: a caller-supplied name would be a free-text
   * channel into CloudWatch, and a free-text channel is how a customer
   * identifier gets logged (AD-14). */
  it("names every condition an operator has to be able to find", () => {
    expect([...BILLING_ANOMALIES].sort()).toEqual([
      "admin_override_precedence",
      "converged_by_newer_event",
      "duplicate_live_subscription",
      "free_statement_rate_limited",
      "livemode_mismatch",
      "signature_rejected",
      "unknown_subscription_status",
      "unrecognised_event_type",
    ]);
  });

  it("emits a fixed key set and nothing from the payload", () => {
    logBillingAnomaly({
      request_id: "req-anomaly",
      anomaly: "livemode_mismatch",
      sub: LOGGABLE.sub,
      stripe_event_type: "customer.subscription.updated",
      stripe_event_id: "evt_anomaly",
      ...FORBIDDEN,
    } as never);

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;

    expect(Object.keys(line).sort()).toEqual([
      "anomaly",
      "event",
      "request_id",
      "stripe_event_id",
      "stripe_event_type",
      "sub",
    ]);
    expect(line.anomaly).toBe("livemode_mismatch");
    assertNothingForbidden();
  });

  it("nulls the optional members rather than omitting them", () => {
    logBillingAnomaly({
      request_id: "req-anomaly",
      anomaly: "free_statement_rate_limited",
    });

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(line.sub).toBeNull();
    expect(line.stripe_event_id).toBeNull();
  });
});

describe("AD-2's administrative audit", () => {
  /* AD-14 names the reason and the actor as the two things an administrative
   * grant MUST be auditable by, so both are emitted - and nothing else is. */
  it("records the actor, the subject, the reason and the grant", () => {
    logAdminOverride({
      request_id: "req-admin",
      actor_sub: "22222222-3333-4444-8555-666666666666",
      subject_sub: LOGGABLE.sub,
      reason: "support_grant_ticket_4821",
      tier: "advance",
      capabilities: ["hosted_ai"],
      admin_expires_at: 1_797_595_200,
      ...FORBIDDEN,
    } as never);

    const line = JSON.parse(captured[0]!) as Record<string, unknown>;

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
    expect(line.reason).toBe("support_grant_ticket_4821");
    expect(line.actor_sub).toBe("22222222-3333-4444-8555-666666666666");
    assertNothingForbidden();
  });

  /* The STATEMENT is a forbidden field on every serializer, including this one:
   * an audit row carrying one would put a signed capability grant into
   * CloudWatch. */
  it("emits no statement even when handed one", () => {
    logAdminOverride({
      request_id: "req-admin",
      actor_sub: LOGGABLE.sub,
      subject_sub: LOGGABLE.sub,
      reason: "ticket",
      tier: "advance",
      capabilities: [],
      admin_expires_at: 1,
      statement: FORBIDDEN.statement,
    } as never);

    expect(captured.join("\n")).not.toContain(FORBIDDEN.statement);
  });
});
