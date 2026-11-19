import type { SSMClient } from "@aws-sdk/client-ssm";
import type { APIGatewayProxyEvent } from "aws-lambda";

/*
 * Request builders shared by the route specs. Three shapes matter and each exists
 * because a route class depends on it:
 *
 *   - an authorized event, carrying a verified `sub` claim;
 *   - an UNAUTHENTICATED event with no authorizer at all, which is what API
 *     Gateway hands an `Auth: {Authorizer: NONE}` route (AD-3); and
 *   - an authorized event carrying `cognito:groups`, for the administrative
 *     claim on `POST /admin/override` (AD-2).
 */

export const SUB_A = "11111111-2222-4333-8444-555555555555";
export const SUB_B = "99999999-8888-4777-8666-555555555555";

export function apiEvent(args: {
  readonly route: string;
  readonly method: string;
  /** Absent produces an event with NO authorizer, as an unauthenticated route gets. */
  readonly sub?: string;
  /** Flattened by the REST authorizer into `[a b]`, which is what this mirrors. */
  readonly groups?: readonly string[];
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly isBase64Encoded?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestId?: string;
}): APIGatewayProxyEvent {
  const body =
    args.rawBody ??
    (args.body === undefined ? null : JSON.stringify(args.body));

  const claims =
    args.sub === undefined
      ? undefined
      : {
          sub: args.sub,
          ...(args.groups === undefined
            ? {}
            : { "cognito:groups": `[${args.groups.join(" ")}]` }),
        };

  return {
    resource: args.route,
    path: args.route,
    httpMethod: args.method,
    body,
    isBase64Encoded: args.isBase64Encoded ?? false,
    headers: args.headers ?? {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: args.requestId ?? "req-test",
      authorizer: claims === undefined ? null : { claims },
    },
  } as unknown as APIGatewayProxyEvent;
}

/**
 * An event for one of AD-3's two unauthenticated routes: no authorizer, no
 * claims, nothing to derive an identity from. Named rather than expressed as
 * `apiEvent` without a `sub`, so a spec asserting the unauthenticated path reads
 * as deliberate instead of as a forgotten argument.
 */
export function unauthenticatedApiEvent(args: {
  readonly route: string;
  readonly method: string;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly isBase64Encoded?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestId?: string;
}): APIGatewayProxyEvent {
  return apiEvent(args);
}

/** An authorized event carrying the administrative group (AD-2). */
export function administrativeApiEvent(args: {
  readonly route: string;
  readonly method: string;
  readonly sub?: string;
  readonly body?: unknown;
  readonly requestId?: string;
}): APIGatewayProxyEvent {
  return apiEvent({
    ...args,
    sub: args.sub ?? SUB_A,
    groups: ["nixus-billing-admin"],
  });
}

/*
 * The configured environment a route spec needs, in one place. Every value is a
 * test value: the Stripe "secret" below is a test-mode-prefixed placeholder that
 * reaches nothing, because no spec in this package makes a network call.
 */

const SECRET_PARAMETER = "/nixus-billing/stripe-secret-key";
const WEBHOOK_PARAMETER = "/nixus-billing/stripe-webhook-secret";

export const TEST_SECRET_KEY = "sk_test_FAKEFAKEFAKEFAKE";
export const TEST_WEBHOOK_SECRET = "whsec_FAKEFAKEFAKEFAKE";
export const TEST_SIGNING_KEY_ID = "nxs-statement-key-1";
export const TEST_SIGNING_KEY_ARN =
  "arn:aws:kms:us-east-1:000000000000:key/nxs-statement-key-1";
export const TEST_CATALOG_TTL_SECONDS = 300;
export const TEST_LOOKUP_KEYS = "classic_monthly_cad,advance_monthly_cad";
export const TEST_ACCOUNT_APP_ORIGIN = "https://account.nixusapp.com";

export function installBillingEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): void {
  const values: Record<string, string> = {
    BILLING_TABLE_NAME: "nixus-billing-billing",
    BILLING_TABLE_CUSTOMER_INDEX_NAME: "stripe-customer-index",
    CATALOG_CACHE_TTL_SECONDS: String(TEST_CATALOG_TTL_SECONDS),
    CATALOG_LOOKUP_KEYS: TEST_LOOKUP_KEYS,
    ACCOUNT_APP_ORIGIN: TEST_ACCOUNT_APP_ORIGIN,
    MINIMUM_CLIENT_VERSION: "0.0.0",
    METRIC_NAMESPACE: "Nixus/Billing",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY_PARAMETER_NAME: SECRET_PARAMETER,
    STRIPE_WEBHOOK_SECRET_PARAMETER_NAME: WEBHOOK_PARAMETER,
    STATEMENT_SIGNING_KEY_ID: TEST_SIGNING_KEY_ID,
    STATEMENT_SIGNING_KEY_ARN: TEST_SIGNING_KEY_ARN,
    ...overrides,
  };

  for (const [name, value] of Object.entries(values)) {
    process.env[name] = value;
  }
}

export const BILLING_ENVIRONMENT_NAMES: readonly string[] = [
  "BILLING_TABLE_NAME",
  "BILLING_TABLE_CUSTOMER_INDEX_NAME",
  "CATALOG_CACHE_TTL_SECONDS",
  "CATALOG_LOOKUP_KEYS",
  "ACCOUNT_APP_ORIGIN",
  "MINIMUM_CLIENT_VERSION",
  "METRIC_NAMESPACE",
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY_PARAMETER_NAME",
  "STRIPE_WEBHOOK_SECRET_PARAMETER_NAME",
  "STATEMENT_SIGNING_KEY_ID",
  "STATEMENT_SIGNING_KEY_ARN",
];

export function clearBillingEnvironment(): void {
  for (const name of BILLING_ENVIRONMENT_NAMES) {
    delete process.env[name];
  }
}

/** An SSM stand-in holding the two placeholder SecureStrings, so the cold-start
 * load and its mode assertion run exactly as they do in production. */
export function fakeSecretsSsmClient(): SSMClient {
  return {
    async send(command: {
      input: { Name: string };
    }): Promise<{ Parameter: { Value: string } }> {
      return {
        Parameter: {
          Value:
            command.input.Name === SECRET_PARAMETER
              ? TEST_SECRET_KEY
              : TEST_WEBHOOK_SECRET,
        },
      };
    },
  } as unknown as SSMClient;
}
