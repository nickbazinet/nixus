/**
 * Non-secret runtime configuration for the account BFF (AD-10, AD-14).
 *
 * Two load-bearing properties:
 *
 *  1. The client secret is NOT here. It is an SSM `SecureString` read once at cold
 *     start by `secret.ts`, never an environment variable, a template output or a
 *     log line.
 *
 *  2. `publicOrigin` is configured, never derived from a request. Behind CloudFront
 *     with the managed `AllViewerExceptHostHeader` origin-request policy the viewer's
 *     `Host` is replaced by the Lambda Web Function endpoint's own domain, so a
 *     `Host`-derived origin would both build wrong absolute URLs and compare the
 *     `Origin` header against the wrong value — which is a silent CSRF bypass rather
 *     than a visible failure.
 */

/** Exactly the scopes the web client is configured for (AD-10). Never narrowed. */
export const OAUTH_SCOPES = "openid email profile nixus-api/profile" as const;

export interface AccountConfig {
  /** `https://account.nixusapp.com`, with no trailing slash. */
  readonly publicOrigin: string;
  /** Managed Login origin, e.g. `https://auth.nixusapp.com`. No trailing slash. */
  readonly cognitoDomain: string;
  readonly cognitoClientId: string;
  readonly cognitoUserPoolId: string;
  readonly region: string;
  readonly sessionTableName: string;
  /** `https://api.nixusapp.com/v1/profile`, with no trailing slash (AD-11). */
  readonly profileApiBaseUrl: string;
  /** SSM parameter path holding the confidential client's secret. */
  readonly clientSecretParameterName: string;
  /**
   * OIDC issuer override, and it can only ever be non-null on a loopback origin.
   *
   * The issuer is the trust anchor for the id_token's signature, so an override a
   * deployed function could read would be a one-variable identity-forgery
   * primitive (the shape of adversary H12). It is gated on `publicOrigin` — the
   * value that is already the trust anchor for everything else — so with
   * `https://account.nixusapp.com` configured the override is unreachable, not
   * merely unset. The E2E suite is what needs it.
   */
  readonly issuerOverride: string | null;
}

export interface DerivedEndpoints {
  /** Cognito's OIDC issuer for this pool — the `iss` an id_token must carry. */
  readonly issuer: string;
  readonly jwksUri: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly revokeUrl: string;
  readonly logoutUrl: string;
  /** The sole registered callback (AD-10). */
  readonly redirectUri: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isLoopbackOrigin(origin: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function requireHttpsOrigin(env: NodeJS.ProcessEnv, name: string): string {
  const raw = withoutTrailingSlash(required(env, name));
  const url = new URL(raw);
  if (url.protocol !== "https:" && !isLoopbackOrigin(raw)) {
    throw new Error(`${name} must be an https origin`);
  }
  return raw;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AccountConfig {
  const publicOrigin = requireHttpsOrigin(env, "PUBLIC_ORIGIN");
  return {
    publicOrigin,
    cognitoDomain: requireHttpsOrigin(env, "COGNITO_DOMAIN"),
    cognitoClientId: required(env, "COGNITO_CLIENT_ID"),
    cognitoUserPoolId: required(env, "COGNITO_USER_POOL_ID"),
    region: required(env, "AWS_REGION"),
    sessionTableName: required(env, "SESSION_TABLE_NAME"),
    profileApiBaseUrl: requireHttpsOrigin(env, "PROFILE_API_BASE_URL"),
    clientSecretParameterName: required(env, "CLIENT_SECRET_PARAMETER_NAME"),
    issuerOverride: isLoopbackOrigin(publicOrigin)
      ? (env.OIDC_ISSUER_FOR_LOCAL_RUN?.trim() ?? null)
      : null,
  };
}

export function deriveEndpoints(config: AccountConfig): DerivedEndpoints {
  const issuer =
    config.issuerOverride ??
    `https://cognito-idp.${config.region}.amazonaws.com/${config.cognitoUserPoolId}`;
  return {
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    authorizeUrl: `${config.cognitoDomain}/oauth2/authorize`,
    tokenUrl: `${config.cognitoDomain}/oauth2/token`,
    revokeUrl: `${config.cognitoDomain}/oauth2/revoke`,
    logoutUrl: `${config.cognitoDomain}/logout`,
    redirectUri: `${config.publicOrigin}/auth/callback`,
  };
}

let cached: { config: AccountConfig; endpoints: DerivedEndpoints } | null = null;

/** Cold-start cached config. Throws on the first request if the function is misconfigured. */
export function accountConfig(): { config: AccountConfig; endpoints: DerivedEndpoints } {
  if (cached) return cached;
  const config = readConfig();
  cached = { config, endpoints: deriveEndpoints(config) };
  return cached;
}
