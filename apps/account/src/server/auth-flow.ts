import { clearHostCookie, serializeHostCookie } from "./cookies.ts";
import { log } from "./log.ts";
import { secureEquals } from "./crypto.ts";
import {
  DEFAULT_DESTINATION,
  DEFAULT_DESTINATION_FR,
  destinationLocation,
  resolveDestinationKey,
  resolvePlanLookupKey,
} from "./destinations.ts";
import { OidcError, type OidcClient } from "./oidc.ts";
import {
  PREAUTH_COOKIE,
  SESSION_COOKIE,
  destroySession,
  mintSession,
  peekSession,
  startPreAuth,
  takePreAuth,
  type SessionDeps,
} from "./sessions.ts";
import { PREAUTH_TTL_SECONDS, SESSION_ABSOLUTE_TTL_SECONDS } from "./store.ts";

/**
 * Sign-in, callback and sign-out as data (AD-10).
 *
 * Each function returns a description of the response rather than writing one, so
 * the AD-15 gates — login CSRF, session fixation, pre-auth replay, nonce
 * mismatch, open redirect — are exercised against the real logic with no HTTP
 * server and no framework in the way. The route handlers in `src/routes/auth/`
 * are the thin adapters that turn these into `Response`s.
 */

export interface FlowDeps {
  readonly sessions: SessionDeps;
  readonly oidc: OidcClient;
}

export interface FlowRedirect {
  readonly kind: "redirect";
  readonly location: string;
  readonly setCookie: readonly string[];
}

export interface FlowFailure {
  readonly kind: "failure";
  readonly status: number;
  /** A stable code; the UI resolves EN/FR text from it. Never a provider message. */
  readonly code: AuthFailureCode;
  readonly setCookie: readonly string[];
}

export type FlowOutcome = FlowRedirect | FlowFailure;

export const AUTH_FAILURE_CODES = [
  "preauth_missing",
  "state_mismatch",
  "code_missing",
  "provider_error",
  "identity_unverified",
] as const;
export type AuthFailureCode = (typeof AUTH_FAILURE_CODES)[number];

/**
 * `GET /auth/login` — opens an attempt and sends the browser to Managed Login.
 *
 * `next` is a destination KEY and `plan` is a billing lookup key; both are
 * narrowed here, before anything is stored, and neither is ever echoed back to
 * the browser or forwarded to the provider.
 */
export async function beginLogin(
  deps: FlowDeps,
  input: { next: string | null; plan?: string | null; language: "en" | "fr" },
): Promise<FlowRedirect> {
  const destination = resolveDestinationKey(
    input.next,
    input.language === "fr" ? DEFAULT_DESTINATION_FR : DEFAULT_DESTINATION,
  );
  const preAuth = await startPreAuth(
    deps.sessions,
    destination,
    resolvePlanLookupKey(input.plan),
  );
  log("info", { route: "/auth/login", status: 302, code: "login_started" });

  return {
    kind: "redirect",
    location: deps.oidc.authorizeUrl({
      state: preAuth.state,
      nonce: preAuth.nonce,
      codeChallenge: preAuth.codeChallenge,
      language: input.language,
    }),
    setCookie: [
      serializeHostCookie({
        name: PREAUTH_COOKIE,
        value: preAuth.cookieValue,
        maxAgeSeconds: PREAUTH_TTL_SECONDS,
      }),
    ],
  };
}

function refuse(code: AuthFailureCode, status = 400): FlowFailure {
  log("warn", { route: "/auth/callback", status, code });
  // The pre-auth cookie is cleared on every refusal: the record behind it is
  // already consumed, so leaving the cookie would only invite a replay.
  return { kind: "failure", status, code, setCookie: [clearHostCookie(PREAUTH_COOKIE)] };
}

/**
 * `GET /auth/callback`.
 *
 * Order is the security property. The pre-auth record is consumed (single-use,
 * conditional delete) and `state` is compared constant-time BEFORE any token
 * exchange, so a callback forced on a victim's browser with an attacker's `code`
 * never reaches Cognito — which is login CSRF closed at the only place it can be.
 */
export async function completeCallback(
  deps: FlowDeps,
  input: { query: URLSearchParams; preAuthCookie: string | undefined },
): Promise<FlowOutcome> {
  const record = await takePreAuth(deps.sessions, input.preAuthCookie);
  if (!record) return refuse("preauth_missing", 403);

  const state = input.query.get("state");
  if (state === null || !secureEquals(state, record.state)) {
    return refuse("state_mismatch", 403);
  }

  if (input.query.get("error") !== null) return refuse("provider_error", 400);

  const code = input.query.get("code");
  if (code === null || code === "") return refuse("code_missing", 400);

  let tokens;
  let identity;
  try {
    tokens = await deps.oidc.exchangeCode(code, record.code_verifier);
    identity = await deps.oidc.verifyIdToken(tokens.id_token, record.nonce);
  } catch (error: unknown) {
    if (error instanceof OidcError) {
      return refuse(
        error.code === "token_exchange_failed" ? "provider_error" : "identity_unverified",
        403,
      );
    }
    throw error;
  }

  // A NEW cookie value and a NEW row, from fresh CSPRNG. Nothing the client
  // presented — neither a pre-existing session cookie nor the pre-auth value — is
  // reused or upgraded in place, which is session fixation closed.
  const minted = await mintSession(deps.sessions, identity, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_expires_at: deps.sessions.now() + tokens.expires_in,
  });

  log("info", { route: "/auth/callback", status: 302, code: "session_minted", sub: identity.sub });

  return {
    kind: "redirect",
    // A path constant from the server-side map, plus the plan this attempt
    // recorded — a value that passed the contract's shape check on the way in
    // and again on the way out, and that is dropped for any non-billing
    // destination. Nothing from the CALLBACK request is echoed, so there is no
    // open-redirect surface to validate.
    location: destinationLocation(record.destination, record.plan),
    setCookie: [
      serializeHostCookie({
        name: SESSION_COOKIE,
        value: minted.cookieValue,
        maxAgeSeconds: SESSION_ABSOLUTE_TTL_SECONDS,
      }),
      clearHostCookie(PREAUTH_COOKIE),
    ],
  };
}

/**
 * Sign-out. Deletes this session's row, revokes only ITS refresh token on the web
 * client, clears the cookie, and hands the browser to Managed Login's logout so
 * the shared Cognito session is dropped too. The desktop is untouched (AD-10).
 */
export async function signOut(
  deps: FlowDeps,
  input: { sessionCookie: string | undefined },
): Promise<FlowRedirect> {
  if (input.sessionCookie) {
    const read = await peekSession(deps.sessions, input.sessionCookie);
    await destroySession(deps.sessions, input.sessionCookie);
    if (read) {
      try {
        await deps.oidc.revoke(read.tokens.refresh_token);
      } catch (error: unknown) {
        // The row is already gone, so the session is over either way. A provider
        // outage must not leave the user apparently signed in.
        if (!(error instanceof OidcError)) throw error;
      }
    }
  }

  log("info", { route: "/auth/signout", status: 302, code: "signed_out" });

  return {
    kind: "redirect",
    location: deps.oidc.logoutUrl(),
    setCookie: [clearHostCookie(SESSION_COOKIE), clearHostCookie(PREAUTH_COOKIE)],
  };
}
