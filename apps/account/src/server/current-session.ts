import { parseCookies } from "./cookies.ts";
import { checkOrigin } from "./origin.ts";
import type { OidcClient } from "./oidc.ts";
import {
  SESSION_COOKIE,
  extendIdle,
  readSession,
  storeRefreshedTokens,
  type SessionDeps,
} from "./sessions.ts";
import type { SessionRecord } from "./store.ts";

/**
 * The per-request session gate (AD-10).
 *
 * One function, used by every loader and every server function, so there is no
 * second place where "is this session still valid" could be answered differently:
 *
 *  - both expiries are checked in code, and an expired-but-present row is deleted;
 *  - a mutating request must carry an `Origin` equal to the configured public
 *    origin, and a missing header is a refusal;
 *  - only an `Origin`-verified mutating request extends the idle expiry, so a
 *    third-party page embedding a `GET` cannot keep a victim's session alive
 *    (adversary L3);
 *  - the access token is refreshed server-side when it has expired, never narrowed.
 */

/** Refreshed this far before expiry so a call in flight cannot straddle it. */
const ACCESS_TOKEN_SKEW_SECONDS = 60;

export interface SessionAccess {
  readonly cookieHeader: string | null;
  readonly originHeader: string | null;
  /** True for every state-changing operation: save, avatar upload, sign out. */
  readonly mutating: boolean;
  readonly publicOrigin: string;
}

export type SessionOutcome =
  | { readonly status: "live"; readonly record: SessionRecord; readonly accessToken: string }
  | { readonly status: "anonymous" }
  /** A cookie was presented and is no longer honoured. The caller clears it. */
  | { readonly status: "expired" }
  | { readonly status: "forbidden"; readonly code: "origin_missing" | "origin_mismatch" };

export interface AccessDeps {
  readonly sessions: SessionDeps;
  readonly oidc: OidcClient;
}

export function sessionCookieValue(cookieHeader: string | null): string | undefined {
  return parseCookies(cookieHeader)[SESSION_COOKIE];
}

async function freshAccessToken(
  deps: AccessDeps,
  record: SessionRecord,
): Promise<string | null> {
  if (record.tokens.access_expires_at > deps.sessions.now() + ACCESS_TOKEN_SKEW_SECONDS) {
    return record.tokens.access_token;
  }
  try {
    const refreshed = await deps.oidc.refresh(record.tokens.refresh_token);
    await storeRefreshedTokens(deps.sessions, record, {
      access_token: refreshed.access_token,
      refresh_token: record.tokens.refresh_token,
      access_expires_at: deps.sessions.now() + refreshed.expires_in,
    });
    return refreshed.access_token;
  } catch {
    return null;
  }
}

export async function resolveSession(
  deps: AccessDeps,
  access: SessionAccess,
): Promise<SessionOutcome> {
  if (access.mutating) {
    const origin = checkOrigin(access.originHeader, access.publicOrigin);
    if (origin !== "ok") {
      return { status: "forbidden", code: origin === "missing" ? "origin_missing" : "origin_mismatch" };
    }
  }

  const cookie = sessionCookieValue(access.cookieHeader);
  const read = await readSession(deps.sessions, cookie);
  if (read.outcome === "none") return { status: "anonymous" };
  if (read.outcome === "expired") return { status: "expired" };

  const accessToken = await freshAccessToken(deps, read.record);
  if (accessToken === null) {
    // A refresh that cannot succeed means the grant is gone; the session with it.
    await deps.sessions.store.deleteSession(read.record.id);
    return { status: "expired" };
  }

  if (access.mutating) await extendIdle(deps.sessions, read.record);

  return { status: "live", record: read.record, accessToken };
}
