import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { AccountConfig, DerivedEndpoints } from "./config.ts";
import { OAUTH_SCOPES } from "./config.ts";
import { secureEquals } from "./crypto.ts";

/**
 * Everything Nixus says to Cognito, and everything it believes back (AD-10).
 *
 * The id_token is verified against the pool's JWKS — signature, `iss`, `aud`,
 * `exp`, `token_use` and `nonce` — before `sub` is read from it. A token exchange
 * that returns a well-formed but unverified id_token is how an attacker's
 * identity gets accepted, so `sub` exists nowhere in this module outside the
 * verified-payload path.
 *
 * Refresh NEVER sends a `scope` parameter: Cognito would narrow the grant, and a
 * narrowed token is how the desktop's hosted-AI scope disappears (adversary C5).
 */

export interface TokenSet {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly id_token: string;
  readonly expires_in: number;
}

export interface RefreshedTokenSet {
  readonly access_token: string;
  readonly expires_in: number;
}

export interface VerifiedIdentity {
  readonly sub: string;
  readonly email: string | null;
}

export class OidcError extends Error {
  constructor(readonly code: string) {
    // Never the provider's body: it can echo the code, and a message is rendered.
    super(code);
    this.name = "OidcError";
  }
}

export interface OidcClient {
  authorizeUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
    language: "en" | "fr";
  }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<RefreshedTokenSet>;
  revoke(refreshToken: string): Promise<void>;
  verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdentity>;
  logoutUrl(): string;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function postForm(
  url: string,
  authorization: string,
  body: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  });
}

function asTokenSet(payload: unknown): TokenSet {
  const record = payload as Partial<Record<keyof TokenSet, unknown>>;
  if (
    typeof record.access_token !== "string" ||
    typeof record.refresh_token !== "string" ||
    typeof record.id_token !== "string" ||
    typeof record.expires_in !== "number"
  ) {
    throw new OidcError("token_response_malformed");
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    id_token: record.id_token,
    expires_in: record.expires_in,
  };
}

export function createOidcClient(
  config: AccountConfig,
  endpoints: DerivedEndpoints,
  clientSecret: () => Promise<string>,
): OidcClient {
  // Cached across invocations on a warm container; jose refetches on key rotation.
  const jwks = createRemoteJWKSet(new URL(endpoints.jwksUri));

  return {
    authorizeUrl({ state, nonce, codeChallenge, language }) {
      const query = new URLSearchParams({
        client_id: config.cognitoClientId,
        response_type: "code",
        scope: OAUTH_SCOPES,
        redirect_uri: endpoints.redirectUri,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        lang: language,
      });
      return `${endpoints.authorizeUrl}?${query.toString()}`;
    },

    async exchangeCode(code, codeVerifier) {
      const response = await postForm(
        endpoints.tokenUrl,
        basicAuth(config.cognitoClientId, await clientSecret()),
        {
          grant_type: "authorization_code",
          client_id: config.cognitoClientId,
          code,
          redirect_uri: endpoints.redirectUri,
          code_verifier: codeVerifier,
        },
      );
      if (!response.ok) throw new OidcError("token_exchange_failed");
      return asTokenSet(await response.json());
    },

    async refresh(refreshToken) {
      const response = await postForm(
        endpoints.tokenUrl,
        basicAuth(config.cognitoClientId, await clientSecret()),
        {
          // No `scope`: Cognito cannot add one on a refresh and WOULD narrow one.
          grant_type: "refresh_token",
          client_id: config.cognitoClientId,
          refresh_token: refreshToken,
        },
      );
      if (!response.ok) throw new OidcError("token_refresh_failed");
      const payload = (await response.json()) as Record<string, unknown>;
      if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
        throw new OidcError("token_response_malformed");
      }
      return { access_token: payload.access_token, expires_in: payload.expires_in };
    },

    /**
     * Revokes ONE session's refresh token on the web client, which cascades to the
     * access and id tokens minted from it. `GlobalSignOut` and
     * `AdminUserGlobalSignOut` are forbidden here: either one would sign the user
     * out of the desktop app from a click on the website (adversary H13).
     */
    async revoke(refreshToken) {
      const response = await postForm(
        endpoints.revokeUrl,
        basicAuth(config.cognitoClientId, await clientSecret()),
        { token: refreshToken, client_id: config.cognitoClientId },
      );
      if (!response.ok) throw new OidcError("token_revoke_failed");
    },

    async verifyIdToken(idToken, expectedNonce) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, jwks, {
          issuer: endpoints.issuer,
          audience: config.cognitoClientId,
        }));
      } catch {
        throw new OidcError("id_token_invalid");
      }
      if (payload.token_use !== "id") throw new OidcError("id_token_wrong_use");
      if (typeof payload.nonce !== "string" || !secureEquals(payload.nonce, expectedNonce)) {
        throw new OidcError("nonce_mismatch");
      }
      if (typeof payload.sub !== "string" || payload.sub === "") {
        throw new OidcError("id_token_no_subject");
      }
      return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : null,
      };
    },

    logoutUrl() {
      const query = new URLSearchParams({
        client_id: config.cognitoClientId,
        logout_uri: `${config.publicOrigin}/`,
      });
      return `${endpoints.logoutUrl}?${query.toString()}`;
    },
  };
}
