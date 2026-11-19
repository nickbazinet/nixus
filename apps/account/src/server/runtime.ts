import { accountConfig, type AccountConfig, type DerivedEndpoints } from "./config.ts";
import { createBillingApi, type BillingApi } from "./billing-client.ts";
import type { AccessDeps } from "./current-session.ts";
import { createDynamoSessionStore } from "./dynamo-store.ts";
import { createOidcClient, type OidcClient } from "./oidc.ts";
import { createProfileApi, type ProfileApi } from "./profile-client.ts";
import { clientSecret } from "./secret.ts";
import type { FlowDeps } from "./auth-flow.ts";
import type { SessionDeps } from "./sessions.ts";

/**
 * Production wiring. Every other server module takes its collaborators as
 * arguments, which is what lets the security gates run the real logic against an
 * in-memory store and a stubbed Cognito.
 */

export interface AccountRuntime extends FlowDeps, AccessDeps {
  readonly config: AccountConfig;
  readonly endpoints: DerivedEndpoints;
  readonly sessions: SessionDeps;
  readonly oidc: OidcClient;
}

let instance: AccountRuntime | null = null;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function runtime(): AccountRuntime {
  if (instance) return instance;

  const { config, endpoints } = accountConfig();
  const sessions: SessionDeps = {
    store: createDynamoSessionStore(config.sessionTableName, config.region),
    now: nowSeconds,
  };
  const oidc = createOidcClient(config, endpoints, () =>
    clientSecret(config.clientSecretParameterName, config.region),
  );

  instance = { config, endpoints, sessions, oidc };
  return instance;
}

/** A profile client bound to one session's own access token (AD-11). */
export function profileApiFor(accessToken: string): ProfileApi {
  return createProfileApi(runtime().config.profileApiBaseUrl, accessToken);
}

/**
 * A billing client bound to one session's own access token (billing AD-3, AD-7).
 *
 * The same shape as `profileApiFor` for the same reason: the token IS the
 * authorization, so there is no subject or customer parameter a caller could get
 * wrong, and the app holds no Stripe credential on either side of this call.
 */
export function billingApiFor(accessToken: string): BillingApi {
  return createBillingApi(runtime().config.billingApiBaseUrl, accessToken);
}
