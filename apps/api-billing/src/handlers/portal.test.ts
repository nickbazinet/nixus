import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BillingFailureError } from "../lib/errors.ts";
import {
  resetStripeSecretsForTesting,
  setSsmClientForTesting,
  setStripeClientForTesting,
} from "../lib/stripe.ts";
import { FakeDynamo } from "../lib/testing/fake-dynamo.ts";
import { FakeStripe } from "../lib/testing/fake-stripe.ts";
import {
  SUB_A,
  SUB_B,
  TEST_ACCOUNT_APP_ORIGIN,
  clearBillingEnvironment,
  fakeSecretsSsmClient,
  installBillingEnvironment,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";
import { handlePortal } from "./portal.ts";

/*
 * AD-3's cross-account rule on the portal: the customer comes from the CALLER'S
 * OWN record and from nowhere else, so a token can never mint a portal session
 * for someone else's customer.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const PORTAL_URL = "https://billing.stripe.com/p/session/test";

let dynamo: FakeDynamo;
let stripe: FakeStripe;

function seedCustomer(sub: string, customerId: string): void {
  dynamo.seed({
    pk: `USER#${sub}`,
    sk: "BILLING_CUSTOMER",
    stripe_customer_id: customerId,
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
  setSsmClientForTesting(fakeSecretsSsmClient());
  stripe = new FakeStripe();
  setStripeClientForTesting(stripe.asStripe());
  resetStripeSecretsForTesting();
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  setSsmClientForTesting(undefined);
  setStripeClientForTesting(undefined);
  resetStripeSecretsForTesting();
  clearBillingEnvironment();
});

describe("the customer is the caller's own, never a request parameter", () => {
  it("opens a portal session for the caller's recorded customer", async () => {
    seedCustomer(SUB_A, "cus_a");

    expect(await handlePortal({ sub: SUB_A, now: NOW })).toEqual({
      url: PORTAL_URL,
    });
    expect(stripe.paramsOf("billingPortal.sessions.create")).toEqual({
      customer: "cus_a",
      return_url: `${TEST_ACCOUNT_APP_ORIGIN}/billing`,
    });
  });

  /* AD-16's cross-account gate: A's token cannot open B's portal, because the
   * only customer it can reach is the one under its own partition key. */
  it("cannot reach another account's customer", async () => {
    seedCustomer(SUB_B, "cus_b");

    expect((await failureOf(handlePortal({ sub: SUB_A, now: NOW }))).failure.code).toBe(
      "no_subscription",
    );
    expect(stripe.countOf("billingPortal.sessions.create")).toBe(0);

    const read = dynamo.gets[0]!.input as { Key: { pk: string } };
    expect(read.Key.pk).toBe(`USER#${SUB_A}`);
  });

  /* A caller who has never checked out has no portal to open: a CLEAN refusal
   * rather than a 500, and one that does not read as a passing outage - every
   * hand-granted account is permanently in this state. */
  it("refuses cleanly for a caller with no customer record", async () => {
    expect((await failureOf(handlePortal({ sub: SUB_A, now: NOW }))).failure.code).toBe(
      "no_subscription",
    );
  });

  it.each([[""], [null], [42]])(
    "refuses cleanly for a record whose customer id is %s",
    async (value) => {
      dynamo.seed({
        pk: `USER#${SUB_A}`,
        sk: "BILLING_CUSTOMER",
        stripe_customer_id: value,
      });

      expect(
        (await failureOf(handlePortal({ sub: SUB_A, now: NOW }))).failure.code,
      ).toBe("no_subscription");
    },
  );

  it("never names the account or the customer in the refusal", async () => {
    seedCustomer(SUB_B, "cus_ZZQQXX");
    const failure = await failureOf(handlePortal({ sub: SUB_A, now: NOW }));

    expect(failure.message).not.toContain(SUB_A);
    expect(failure.message).not.toContain("cus_ZZQQXX");
  });
});

describe("the return URL is server-side", () => {
  it("comes from the configured origin plus a fixed path", async () => {
    seedCustomer(SUB_A, "cus_a");
    await handlePortal({ sub: SUB_A, now: NOW });

    const params = stripe.paramsOf("billingPortal.sessions.create") as {
      return_url: string;
    };
    expect(params.return_url.startsWith(TEST_ACCOUNT_APP_ORIGIN)).toBe(true);
  });

  /* No extra Managed Payments parameters on a portal session: support is
   * confirmed only indirectly and nothing beyond the documented two is sent. */
  it("sends exactly the customer and the return URL", async () => {
    seedCustomer(SUB_A, "cus_a");
    await handlePortal({ sub: SUB_A, now: NOW });

    expect(
      Object.keys(
        stripe.paramsOf("billingPortal.sessions.create") as Record<string, unknown>,
      ).sort(),
    ).toEqual(["customer", "return_url"]);
  });
});
