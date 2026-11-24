import { randomToken, sha256Hex } from "./crypto.ts";
import { pkceChallenge } from "./crypto.ts";
import {
  isBillingDestination,
  resolvePlanLookupKey,
  type DestinationKey,
} from "./destinations.ts";
import {
  PREAUTH_TTL_SECONDS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  type PreAuthRecord,
  type SessionRecord,
  type SessionStore,
  type SessionTokens,
} from "./store.ts";

/**
 * Session and pre-auth lifecycle (AD-10).
 *
 * Every rule the adversarial review found missing lives here, in code rather than
 * in infrastructure:
 *
 *  - C2 (login CSRF / fixation): the authorization request is bound to the browser
 *    that started it by a single-use `__Host-` pre-auth cookie carrying `state`,
 *    `nonce` and the PKCE verifier. A session id is MINTED at authentication from
 *    fresh CSPRNG — never the pre-auth value, never a value the client presented.
 *  - F4 / L3 (expiry): `idle_expires_at` and `absolute_expires_at` are both checked
 *    on every read, because DynamoDB TTL deletes "within a few days" and a present
 *    expired row would otherwise keep working. Only an `Origin`-verified non-GET
 *    request extends the idle expiry, and it can never pass the absolute one.
 */

export const PREAUTH_COOKIE = "__Host-nixus_preauth";
export const SESSION_COOKIE = "__Host-nixus_session";

export interface SessionDeps {
  readonly store: SessionStore;
  /** Epoch seconds. Injected so expiry is testable without sleeping. */
  readonly now: () => number;
  readonly newToken?: () => string;
}

function token(deps: SessionDeps): string {
  return (deps.newToken ?? randomToken)();
}

export interface StartedPreAuth {
  /** Goes in the `__Host-` cookie. Never stored; only its hash is. */
  readonly cookieValue: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

export async function startPreAuth(
  deps: SessionDeps,
  destination: DestinationKey,
  /** Already narrowed by `beginLogin`; re-narrowed here so the record cannot hold junk. */
  plan: string | null,
): Promise<StartedPreAuth> {
  const cookieValue = token(deps);
  const state = token(deps);
  const nonce = token(deps);
  const codeVerifier = token(deps);

  const record: PreAuthRecord = {
    id: sha256Hex(cookieValue),
    type: "preauth",
    state,
    nonce,
    code_verifier: codeVerifier,
    destination,
    plan: isBillingDestination(destination) ? resolvePlanLookupKey(plan) : null,
    expires_at: deps.now() + PREAUTH_TTL_SECONDS,
  };
  await deps.store.putPreAuth(record);

  return { cookieValue, state, nonce, codeChallenge: pkceChallenge(codeVerifier) };
}

/**
 * Consume the pre-auth record. Single-use and expiry-checked in code.
 *
 * Called BEFORE the token exchange: a replayed callback must fail without Nixus
 * ever presenting the code to Cognito.
 */
export async function takePreAuth(
  deps: SessionDeps,
  cookieValue: string | undefined,
): Promise<PreAuthRecord | null> {
  if (!cookieValue) return null;
  const record = await deps.store.consumePreAuth(sha256Hex(cookieValue));
  if (!record) return null;
  return record.expires_at > deps.now() ? record : null;
}

export interface MintedSession {
  readonly cookieValue: string;
  readonly record: SessionRecord;
}

export async function mintSession(
  deps: SessionDeps,
  identity: { sub: string; email: string | null },
  tokens: SessionTokens,
): Promise<MintedSession> {
  const cookieValue = token(deps);
  const now = deps.now();
  const absolute = now + SESSION_ABSOLUTE_TTL_SECONDS;
  const idle = Math.min(now + SESSION_IDLE_TTL_SECONDS, absolute);

  const record: SessionRecord = {
    id: sha256Hex(cookieValue),
    type: "session",
    sub: identity.sub,
    email: identity.email,
    tokens,
    idle_expires_at: idle,
    absolute_expires_at: absolute,
    expires_at: absolute,
  };
  await deps.store.putSession(record);
  return { cookieValue, record };
}

export type SessionReadResult =
  | { readonly outcome: "none" }
  | { readonly outcome: "expired" }
  | { readonly outcome: "live"; readonly record: SessionRecord };

/**
 * The read every request performs. An expired-but-present row is rejected AND
 * deleted, and the caller clears the cookie — the two halves of AD-15's
 * expired-but-present-session gate.
 */
export async function readSession(
  deps: SessionDeps,
  cookieValue: string | undefined,
): Promise<SessionReadResult> {
  if (!cookieValue) return { outcome: "none" };
  const id = sha256Hex(cookieValue);
  const record = await deps.store.getSession(id);
  if (!record) return { outcome: "none" };

  const now = deps.now();
  if (record.idle_expires_at <= now || record.absolute_expires_at <= now) {
    await deps.store.deleteSession(id);
    return { outcome: "expired" };
  }
  return { outcome: "live", record };
}

/** Idle extension, capped by the absolute expiry which is never moved. */
export async function extendIdle(deps: SessionDeps, record: SessionRecord): Promise<void> {
  const next = Math.min(deps.now() + SESSION_IDLE_TTL_SECONDS, record.absolute_expires_at);
  if (next <= record.idle_expires_at) return;
  await deps.store.extendSession(record.id, next);
}

export async function destroySession(deps: SessionDeps, cookieValue: string): Promise<void> {
  await deps.store.deleteSession(sha256Hex(cookieValue));
}

/**
 * The row behind a cookie, expiry NOT checked.
 *
 * Only sign-out uses it: an expired session still holds the refresh token that has
 * to be revoked, and `readSession` would have deleted the row before the caller
 * could read it.
 */
export async function peekSession(
  deps: SessionDeps,
  cookieValue: string,
): Promise<SessionRecord | null> {
  return deps.store.getSession(sha256Hex(cookieValue));
}

export async function storeRefreshedTokens(
  deps: SessionDeps,
  record: SessionRecord,
  tokens: SessionTokens,
): Promise<void> {
  await deps.store.replaceTokens(record.id, tokens);
}
