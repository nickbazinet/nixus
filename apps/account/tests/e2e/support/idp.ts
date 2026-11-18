import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyObject } from "jose";

import { sendJson, startFake, type RunningFake } from "./fake";

/**
 * Stub identity provider.
 *
 * It signs real RS256 id_tokens with a real keypair and serves a real JWKS, so the
 * account app's `jose` verification — signature, `iss`, `aud`, `exp`, `token_use`
 * and `nonce` — runs for real in the E2E. A fake that handed back an unverified
 * token would leave the one check that matters untested.
 */

export interface RunningIdp extends RunningFake {
  readonly issuer: string;
  readonly revoked: string[];
  readonly clientSecrets: string[];
  /** Set to make the next id_token carry a nonce the app did not ask for. */
  forgeNonce: string | null;
}

export interface IdpOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sub: string;
  readonly email: string;
}

interface Attempt {
  readonly nonce: string;
  readonly redirectUri: string;
}

export async function startIdp(options: IdpOptions): Promise<RunningIdp> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey as KeyObject)), kid: "stub-key", alg: "RS256" };

  const attempts = new Map<string, Attempt>();
  const revoked: string[] = [];
  const clientSecrets: string[] = [];
  const state = { issuer: "", forgeNonce: null as string | null, authenticated: false };

  function presentedSecret(authorization: string | undefined): string | null {
    if (!authorization?.startsWith("Basic ")) return null;
    const [id, secret] = Buffer.from(authorization.slice(6), "base64").toString().split(":");
    return id === options.clientId ? (secret ?? null) : null;
  }

  async function idToken(nonce: string): Promise<string> {
    return new SignJWT({
      token_use: "id",
      nonce,
      email: options.email,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "stub-key" })
      .setIssuer(state.issuer)
      .setAudience(options.clientId)
      .setSubject(options.sub)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(privateKey);
  }

  const fake = await startFake("idp", async (request, response) => {
    const { pathname } = request.url;

    // The SSM client is pointed here too, so the one secret this fake owns is the
    // one the app reads at cold start — rather than an env var the app must not use.
    if (pathname.startsWith("/ssm")) {
      return sendJson(response, 200, {
        Parameter: { Name: "/nixus-account/web-client-secret", Type: "SecureString", Value: options.clientSecret },
      });
    }

    if (pathname === "/issuer/.well-known/jwks.json") {
      return sendJson(response, 200, { keys: [jwk] });
    }

    if (pathname === "/oauth2/authorize") {
      const query = request.url.searchParams;

      // Managed Login never grants silently to a browser with no provider
      // session, and modelling that is what keeps the sign-out assertions from
      // being vacuous: a fake that auto-granted would mint a fresh session the
      // instant a signed-out visitor reached `/auth/login`.
      if (!state.authenticated && query.get("stub_authenticated") !== "1") {
        // Relative, because the fake does not know its own port in here.
        const granted = `${request.url.pathname}${request.url.search}&stub_authenticated=1`;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Stub Managed Login</title></head><body><h1>Stub Managed Login</h1><a data-testid="stub-idp-sign-in" href="${granted.replace(
            /&/g,
            "&amp;",
          )}">Sign in</a></body></html>`,
        );
        return true;
      }
      state.authenticated = true;

      const code = `code-${attempts.size + 1}`;
      attempts.set(code, {
        nonce: query.get("nonce") ?? "",
        redirectUri: query.get("redirect_uri") ?? "",
      });
      const back = new URL(attempts.get(code)!.redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", query.get("state") ?? "");
      response.writeHead(302, { location: back.toString() });
      response.end();
      return true;
    }

    if (pathname === "/oauth2/token" && request.method === "POST") {
      const secret = presentedSecret(request.headers.authorization);
      if (secret === null) return sendJson(response, 401, { error: "invalid_client" });
      clientSecrets.push(secret);

      const form = new URLSearchParams(request.body);
      if (form.get("grant_type") === "refresh_token") {
        return sendJson(response, 200, {
          access_token: `access-refreshed-${form.get("refresh_token")}`,
          expires_in: 900,
          token_type: "Bearer",
        });
      }

      const attempt = attempts.get(form.get("code") ?? "");
      if (!attempt) return sendJson(response, 400, { error: "invalid_grant" });
      if (form.get("code_verifier") === null) {
        return sendJson(response, 400, { error: "invalid_request" });
      }

      return sendJson(response, 200, {
        access_token: `access-${form.get("code")}`,
        refresh_token: `refresh-${form.get("code")}`,
        id_token: await idToken(state.forgeNonce ?? attempt.nonce),
        expires_in: 900,
        token_type: "Bearer",
      });
    }

    if (pathname === "/oauth2/revoke" && request.method === "POST") {
      if (presentedSecret(request.headers.authorization) === null) {
        return sendJson(response, 401, { error: "invalid_client" });
      }
      revoked.push(new URLSearchParams(request.body).get("token") ?? "");
      return sendJson(response, 200, {});
    }

    if (pathname === "/logout") {
      state.authenticated = false;
      const back = request.url.searchParams.get("logout_uri") ?? "/";
      response.writeHead(302, { location: back });
      response.end();
      return true;
    }

    return false;
  });

  state.issuer = `${fake.origin}/issuer`;

  return {
    origin: fake.origin,
    close: fake.close,
    issuer: state.issuer,
    revoked,
    clientSecrets,
    get forgeNonce() {
      return state.forgeNonce;
    },
    set forgeNonce(value: string | null) {
      state.forgeNonce = value;
    },
  };
}
