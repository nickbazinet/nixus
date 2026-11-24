import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import Stripe from "stripe";

/*
 * THE sole holder of Stripe credentials (AD-7). Both secrets live in SSM
 * Parameter Store as `SecureString`s, are read ONCE at cold start with
 * `WithDecryption: true`, and never become an environment variable, a template
 * value or a log line - only the parameter NAMES cross those boundaries.
 *
 * It is also the ONLY module that constructs the SDK client, and the only one
 * that ever sees the webhook signing secret in use: `verifyStripeEvent` below
 * takes the raw bytes and the signature header and hands back a VERIFIED event,
 * so no handler holds a credential even transiently.
 */

export type StripeMode = "test" | "live";

export interface StripeSecrets {
  readonly secretKey: string;
  readonly webhookSigningSecret: string;
  readonly mode: StripeMode;
}

const TEST_KEY_PREFIXES = ["sk_test_", "rk_test_"] as const;
const LIVE_KEY_PREFIXES = ["sk_live_", "rk_live_"] as const;

export function isStripeMode(value: unknown): value is StripeMode {
  return value === "test" || value === "live";
}

/**
 * Mode safety is ASSERTED, not assumed (AD-7). A test key in a live-mode stack
 * and a live key in a test-mode stack are both startup failures rather than
 * runtime surprises, because the alternative is discovering the mismatch when a
 * real customer is charged - or when a production entitlement is mutated by a
 * test-mode event.
 *
 * The key is never included in the thrown message, and the comparison looks only
 * at the documented mode prefix.
 */
export function assertStripeMode(key: string, mode: StripeMode): void {
  const keyMode: StripeMode | undefined = TEST_KEY_PREFIXES.some((prefix) =>
    key.startsWith(prefix),
  )
    ? "test"
    : LIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
      ? "live"
      : undefined;

  if (keyMode === undefined) {
    throw new Error(
      "the Stripe secret key does not carry a recognised mode prefix",
    );
  }
  if (keyMode !== mode) {
    throw new Error(
      `the Stripe secret key is a ${keyMode}-mode key but STRIPE_MODE is ${mode}`,
    );
  }
}

function configuredMode(): StripeMode {
  const mode = process.env.STRIPE_MODE;
  if (!isStripeMode(mode)) {
    throw new Error("STRIPE_MODE is not configured as `test` or `live`");
  }
  return mode;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

let ssmClient: SSMClient | undefined;

function getSsmClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({});
  }
  return ssmClient;
}

/** Test seam: lets a spec inject a stubbed SSM client without a network stack. */
export function setSsmClientForTesting(client: SSMClient | undefined): void {
  ssmClient = client;
}

let loaded: Promise<StripeSecrets> | undefined;

/** Test seam: clears the cold-start memo between specs. */
export function resetStripeSecretsForTesting(): void {
  loaded = undefined;
}

async function readSecureString(name: string): Promise<string> {
  const result = await getSsmClient().send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (!value) {
    // The parameter NAME is safe to name; the value is what must never appear.
    throw new Error(`SSM parameter ${name} holds no value`);
  }
  return value;
}

/**
 * Memoised at module scope, so the two Parameter Store reads happen once per
 * execution environment rather than once per request. The promise itself is
 * cached: two concurrent first requests must not produce two reads.
 *
 * A rejected load is NOT cached, so a transient Parameter Store failure does not
 * poison the container for its whole lifetime.
 */
export function getStripeSecrets(): Promise<StripeSecrets> {
  if (!loaded) {
    loaded = loadStripeSecrets().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
  }
  return loaded;
}

async function loadStripeSecrets(): Promise<StripeSecrets> {
  const mode = configuredMode();

  const [secretKey, webhookSigningSecret] = await Promise.all([
    readSecureString(requiredEnv("STRIPE_SECRET_KEY_PARAMETER_NAME")),
    readSecureString(requiredEnv("STRIPE_WEBHOOK_SECRET_PARAMETER_NAME")),
  ]);

  assertStripeMode(secretKey, mode);

  return { secretKey, webhookSigningSecret, mode };
}

/**
 * Pinned EXPLICITLY, never floating (AD-15's stack table). This is the version
 * `stripe@23.1.0` itself ships with, so the SDK's own types and the wire format
 * agree; a floating version would let Stripe change a response shape under a
 * deployed Lambda.
 */
export const STRIPE_API_VERSION = "2026-10-28.endive";

/**
 * Stripe's own documented tolerance window default, in SECONDS, passed
 * explicitly so the replay bound is visible in code rather than inherited
 * (AD-5).
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

let stripeClient: Promise<Stripe> | undefined;

/**
 * Memoised per execution environment, so the SDK is constructed once rather than
 * per request. The PROMISE is cached, not the resolved client: two concurrent
 * first requests must not each construct one, exactly as the secret load above.
 * A rejected construction is not cached, so a transient Parameter Store failure
 * does not poison the container for its whole lifetime.
 *
 * The secret reaches the constructor and nothing else: it is never returned from
 * this module to a handler.
 */
export function getStripeClient(): Promise<Stripe> {
  if (!stripeClient) {
    stripeClient = getStripeSecrets()
      .then(
        ({ secretKey }) =>
          new Stripe(secretKey, {
            apiVersion: STRIPE_API_VERSION,
            typescript: true,
          }),
      )
      .catch((error: unknown) => {
        stripeClient = undefined;
        throw error;
      });
  }
  return stripeClient;
}

/** Test seam: lets a spec inject a fake client without a network stack. */
export function setStripeClientForTesting(client: Stripe | undefined): void {
  stripeClient = client === undefined ? undefined : Promise.resolve(client);
}

/**
 * AD-5's first step, and the reason the webhook handler never holds the signing
 * secret: the raw bytes and the signature header go in, a VERIFIED event comes
 * out, and the secret never leaves this module.
 *
 * `constructEvent` is the SYNCHRONOUS form on purpose. `constructEventAsync`
 * exists for runtimes without synchronous crypto (Workers, Deno); Lambda has
 * full Node crypto, so the sync form is correct. The SDK itself performs the
 * timing-safe comparison against every candidate signature in the header and
 * enforces the timestamp window, so no part of that is hand-rolled here.
 *
 * `rawBody` is a Buffer because the signature is over BYTES: a body that has
 * been through `JSON.parse` and back cannot reproduce them.
 */
export async function verifyStripeEvent(args: {
  readonly rawBody: Buffer;
  readonly signatureHeader: string;
}): Promise<Stripe.Event> {
  const { webhookSigningSecret } = await getStripeSecrets();
  const stripe = await getStripeClient();

  return stripe.webhooks.constructEvent(
    args.rawBody,
    args.signatureHeader,
    webhookSigningSecret,
    WEBHOOK_TOLERANCE_SECONDS,
  );
}

/** The configured mode, for AD-5's per-event `livemode` check. */
export async function configuredStripeMode(): Promise<StripeMode> {
  return (await getStripeSecrets()).mode;
}
