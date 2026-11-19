import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SSMClient } from "@aws-sdk/client-ssm";

import {
  assertStripeMode,
  getStripeClient,
  getStripeSecrets,
  isStripeMode,
  resetStripeSecretsForTesting,
  setSsmClientForTesting,
  setStripeClientForTesting,
  STRIPE_API_VERSION,
  verifyStripeEvent,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./stripe.ts";
import { FakeStripe, stripeEvent } from "./testing/fake-stripe.ts";

/*
 * The sole Stripe credential holder (AD-7). Two properties are the whole of what
 * this package implements and both are asserted here: the secrets come from SSM
 * SecureStrings at cold start and never from an environment variable, and the
 * loaded key's MODE must match the configured one or the Lambda refuses to start.
 */

const SECRET_PATH = "/nixus-billing/stripe-secret-key";
const WEBHOOK_PATH = "/nixus-billing/stripe-webhook-secret";

const TEST_KEY = "sk_test_AAAABBBBCCCCDDDD";
const LIVE_KEY = "sk_live_AAAABBBBCCCCDDDD";
const WEBHOOK_SECRET = "whsec_AAAABBBBCCCCDDDD";

interface FakeParameterStore {
  readonly calls: { Name: string; WithDecryption: boolean }[];
  readonly client: SSMClient;
}

function fakeSsm(
  values: Readonly<Record<string, string | undefined>>,
  error?: Error,
): FakeParameterStore {
  const calls: { Name: string; WithDecryption: boolean }[] = [];

  const client = {
    async send(command: {
      input: { Name: string; WithDecryption: boolean };
    }): Promise<{ Parameter?: { Value?: string } }> {
      calls.push(command.input);
      if (error) throw error;
      return { Parameter: { Value: values[command.input.Name] } };
    },
  } as unknown as SSMClient;

  return { calls, client };
}

beforeEach(() => {
  process.env.STRIPE_MODE = "test";
  process.env.STRIPE_SECRET_KEY_PARAMETER_NAME = SECRET_PATH;
  process.env.STRIPE_WEBHOOK_SECRET_PARAMETER_NAME = WEBHOOK_PATH;
  resetStripeSecretsForTesting();
});

afterEach(() => {
  setSsmClientForTesting(undefined);
  setStripeClientForTesting(undefined);
  resetStripeSecretsForTesting();
  delete process.env.STRIPE_MODE;
  delete process.env.STRIPE_SECRET_KEY_PARAMETER_NAME;
  delete process.env.STRIPE_WEBHOOK_SECRET_PARAMETER_NAME;
  vi.restoreAllMocks();
});

describe("assertStripeMode (AD-7)", () => {
  it("accepts a key whose prefix matches the configured mode", () => {
    expect(() => assertStripeMode(TEST_KEY, "test")).not.toThrow();
    expect(() => assertStripeMode(LIVE_KEY, "live")).not.toThrow();
  });

  /* A test key in production and a live key outside production are both STARTUP
   * failures rather than runtime surprises, because the alternative is finding
   * out when a real customer is charged - or when a production entitlement is
   * mutated by a test-mode event. */
  it("refuses a live key in a test-mode stack", () => {
    expect(() => assertStripeMode(LIVE_KEY, "test")).toThrow(
      "is a live-mode key but STRIPE_MODE is test",
    );
  });

  it("refuses a test key in a live-mode stack", () => {
    expect(() => assertStripeMode(TEST_KEY, "live")).toThrow(
      "is a test-mode key but STRIPE_MODE is live",
    );
  });

  it.each([
    ["pk_test_publishable"],
    ["rk_test_restricted"],
    ["whsec_signing_secret"],
    ["sk_AAAABBBB"],
    [""],
    ["  sk_test_leading_space"],
  ])("refuses %s as carrying no recognised mode prefix", (key) => {
    expect(() => assertStripeMode(key, "test")).toThrow(
      "does not carry a recognised mode prefix",
    );
  });

  /* The key is never included in the thrown message - an exception message ends
   * up in a log line (AD-14). */
  it("never names the key in the failure it throws", () => {
    for (const [key, mode] of [
      [LIVE_KEY, "test"],
      [TEST_KEY, "live"],
      ["garbage_AAAABBBB", "test"],
    ] as const) {
      try {
        assertStripeMode(key, mode);
        expect.unreachable("expected a startup failure");
      } catch (error) {
        expect((error as Error).message).not.toContain(key);
        expect((error as Error).message).not.toContain("AAAABBBB");
      }
    }
  });

  it("recognises only the two modes", () => {
    expect(isStripeMode("test")).toBe(true);
    expect(isStripeMode("live")).toBe(true);
    for (const value of ["TEST", "sandbox", "", null, undefined, 1]) {
      expect(isStripeMode(value), String(value)).toBe(false);
    }
  });
});

describe("getStripeSecrets loads both SecureStrings at cold start", () => {
  it("reads each parameter by name with decryption on", async () => {
    const ssm = fakeSsm({
      [SECRET_PATH]: TEST_KEY,
      [WEBHOOK_PATH]: WEBHOOK_SECRET,
    });
    setSsmClientForTesting(ssm.client);

    expect(await getStripeSecrets()).toEqual({
      secretKey: TEST_KEY,
      webhookSigningSecret: WEBHOOK_SECRET,
      mode: "test",
    });

    expect(ssm.calls).toHaveLength(2);
    for (const call of ssm.calls) {
      expect(call.WithDecryption).toBe(true);
    }
    expect(ssm.calls.map((call) => call.Name).sort()).toEqual(
      [SECRET_PATH, WEBHOOK_PATH].sort(),
    );
  });

  /* Memoised at module scope so the two reads happen once per execution
   * environment rather than once per request, and the PROMISE is cached so two
   * concurrent first requests do not produce two reads. */
  it("reads once per execution environment, even under concurrency", async () => {
    const ssm = fakeSsm({
      [SECRET_PATH]: TEST_KEY,
      [WEBHOOK_PATH]: WEBHOOK_SECRET,
    });
    setSsmClientForTesting(ssm.client);

    const [first, second] = await Promise.all([
      getStripeSecrets(),
      getStripeSecrets(),
    ]);
    await getStripeSecrets();

    expect(first).toBe(second);
    expect(ssm.calls).toHaveLength(2);
  });

  /* A rejected load is NOT cached, so a transient Parameter Store failure does
   * not poison the container for its whole lifetime. */
  it("does not cache a failed load", async () => {
    setSsmClientForTesting(
      fakeSsm({}, new Error("Parameter Store unavailable")).client,
    );
    await expect(getStripeSecrets()).rejects.toThrow(
      "Parameter Store unavailable",
    );

    const recovered = fakeSsm({
      [SECRET_PATH]: TEST_KEY,
      [WEBHOOK_PATH]: WEBHOOK_SECRET,
    });
    setSsmClientForTesting(recovered.client);

    expect((await getStripeSecrets()).secretKey).toBe(TEST_KEY);
    expect(recovered.calls).toHaveLength(2);
  });

  it("fails startup when the loaded key's mode disagrees with the stack", async () => {
    process.env.STRIPE_MODE = "live";
    setSsmClientForTesting(
      fakeSsm({
        [SECRET_PATH]: TEST_KEY,
        [WEBHOOK_PATH]: WEBHOOK_SECRET,
      }).client,
    );

    await expect(getStripeSecrets()).rejects.toThrow(
      "is a test-mode key but STRIPE_MODE is live",
    );
  });

  it("fails when a parameter holds no value, naming only the path", async () => {
    setSsmClientForTesting(
      fakeSsm({ [SECRET_PATH]: TEST_KEY, [WEBHOOK_PATH]: undefined }).client,
    );

    await expect(getStripeSecrets()).rejects.toThrow(
      `SSM parameter ${WEBHOOK_PATH} holds no value`,
    );
  });

  it.each([
    ["STRIPE_MODE"],
    ["STRIPE_SECRET_KEY_PARAMETER_NAME"],
    ["STRIPE_WEBHOOK_SECRET_PARAMETER_NAME"],
  ])("refuses to start without %s", async (name) => {
    delete process.env[name];
    setSsmClientForTesting(
      fakeSsm({
        [SECRET_PATH]: TEST_KEY,
        [WEBHOOK_PATH]: WEBHOOK_SECRET,
      }).client,
    );

    await expect(getStripeSecrets()).rejects.toThrow(/not configured/);
  });

  it("refuses an unrecognised configured mode", async () => {
    process.env.STRIPE_MODE = "sandbox";
    setSsmClientForTesting(fakeSsm({}).client);

    await expect(getStripeSecrets()).rejects.toThrow(
      "STRIPE_MODE is not configured as `test` or `live`",
    );
  });

  /* AD-7: the secrets live in Parameter Store and never in an environment
   * variable. A module that read one from the environment would make the SSM read
   * decorative. */
  it("reads no secret from the environment", async () => {
    process.env.STRIPE_SECRET_KEY = LIVE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fromenv";
    setSsmClientForTesting(
      fakeSsm({
        [SECRET_PATH]: TEST_KEY,
        [WEBHOOK_PATH]: WEBHOOK_SECRET,
      }).client,
    );

    const secrets = await getStripeSecrets();

    expect(secrets.secretKey).toBe(TEST_KEY);
    expect(secrets.webhookSigningSecret).toBe(WEBHOOK_SECRET);

    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  /* SUPERSEDED STUB-ERA ASSERTION. This spec previously asserted that the
   * package depended on no `stripe` package and constructed no client, which was
   * the correct statement while the SDK had not been adopted. The dependency and
   * the client are this work package's subject, so the assertion is inverted
   * rather than deleted: the seam it was protecting - exactly ONE place a client
   * can be built, because `getStripeSecrets` is the only way to reach a
   * credential - is what the replacement asserts. */
  it("depends on the pinned Stripe SDK as a runtime dependency", () => {
    // Read as text rather than imported: `resolveJsonModule` is off, so tsc
    // would refuse the import outright.
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../package.json", import.meta.url)),
        "utf8",
      ),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.dependencies.stripe).toBe("^23.1.0");
    // A runtime dependency, not a dev one: the Lambda calls Stripe.
    expect(Object.keys(manifest.devDependencies)).not.toContain("stripe");
  });
});

describe("getStripeClient is the only place a client is built (AD-7)", () => {
  function seedSecrets(): void {
    setSsmClientForTesting(
      fakeSsm({
        [SECRET_PATH]: TEST_KEY,
        [WEBHOOK_PATH]: WEBHOOK_SECRET,
      }).client,
    );
  }

  /* Never floating. A deployed Lambda whose API version drifted would start
   * seeing response shapes its SDK types do not describe. */
  it("pins the API version the installed SDK ships with", async () => {
    seedSecrets();
    expect(STRIPE_API_VERSION).toBe("2026-10-28.endive");
    expect((await getStripeClient()).getApiField("version")).toBe(
      STRIPE_API_VERSION,
    );
  });

  it("constructs the client once per execution environment", async () => {
    seedSecrets();
    const [first, second] = await Promise.all([
      getStripeClient(),
      getStripeClient(),
    ]);
    expect(first).toBe(second);
  });

  /* The secret reaches the constructor and nothing else. A client that exposed
   * it back would make every later "never logged" guarantee a convention. */
  it("never exposes the key through the client it returns", async () => {
    seedSecrets();
    const client = await getStripeClient();

    expect(JSON.stringify(Object.keys(client))).not.toContain(TEST_KEY);
    expect(String(client.getApiField("auth") ?? "")).not.toBe(TEST_KEY);
  });

  /* The tolerance window is Stripe's documented default, passed EXPLICITLY so
   * the replay bound is visible in code rather than inherited silently (AD-5). */
  it("verifies an event through the SDK with an explicit tolerance", async () => {
    seedSecrets();

    const fake = new FakeStripe().seedVerifiedEvent(
      stripeEvent({
        type: "customer.subscription.updated",
        created: 1_795_003_200,
        object: { object: "subscription", id: "sub_x", items: { data: [] } },
      }),
    );
    setStripeClientForTesting(fake.asStripe());

    const event = await verifyStripeEvent({
      rawBody: Buffer.from("{}", "utf8"),
      signatureHeader: "t=1,v1=abc",
    });

    expect(event.type).toBe("customer.subscription.updated");
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    expect(fake.paramsOf("webhooks.constructEvent")).toMatchObject({
      header: "t=1,v1=abc",
      // The SECRET is handed straight to the SDK and never anywhere else.
      secret: WEBHOOK_SECRET,
      tolerance: WEBHOOK_TOLERANCE_SECONDS,
    });
  });

  /* A re-stringified body cannot reproduce the signed bytes, so the raw Buffer
   * has to reach the SDK unchanged. */
  it("hands the SDK the raw bytes rather than a parsed body", async () => {
    seedSecrets();

    const raw = Buffer.from('{"description":"Caf\u00e9 \u2014 Montr\u00e9al"}', "utf8");
    const fake = new FakeStripe().seedVerifiedEvent(
      stripeEvent({
        type: "invoice.paid",
        created: 1,
        object: { object: "invoice", id: "in_x", parent: null },
      }),
    );
    setStripeClientForTesting(fake.asStripe());

    await verifyStripeEvent({ rawBody: raw, signatureHeader: "t=1,v1=abc" });

    const params = fake.paramsOf("webhooks.constructEvent") as {
      payload: Buffer;
    };
    expect(Buffer.isBuffer(params.payload)).toBe(true);
    expect(params.payload.equals(raw)).toBe(true);
  });
});
