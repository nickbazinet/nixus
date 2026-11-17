import { getRequest } from "@tanstack/react-start/server";
import type { AccountErrorCode, AvatarMimeType, ProfileFields } from "@nixus/shared";

import { resolveSession, type SessionOutcome } from "@/server/current-session";
import { log } from "@/server/log";
import { runtime } from "@/server/runtime";

/**
 * The server half of every page interaction (AD-10, AD-11).
 *
 * `gate()` is the single entry point: it resolves the session, verifies `Origin`
 * on mutations and throws a bare 403 when that fails. A refusal is a status code
 * and nothing else — no body, no echoed header, no reason.
 */

export interface GateOk {
  readonly accessToken: string;
  readonly sub: string;
  readonly email: string | null;
}

export type GateResult =
  | { readonly state: "ok"; readonly session: GateOk }
  | { readonly state: "anonymous" }
  | { readonly state: "expired" };

export async function gate(mutating: boolean): Promise<GateResult> {
  const deps = runtime();
  const request = getRequest();
  const outcome: SessionOutcome = await resolveSession(deps, {
    cookieHeader: request.headers.get("cookie"),
    originHeader: request.headers.get("origin"),
    mutating,
    publicOrigin: deps.config.publicOrigin,
  });

  if (outcome.status === "forbidden") {
    log("warn", { route: "server-fn", status: 403, code: outcome.code });
    throw new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  if (outcome.status === "anonymous") return { state: "anonymous" };
  if (outcome.status === "expired") return { state: "expired" };

  return {
    state: "ok",
    session: {
      accessToken: outcome.accessToken,
      sub: outcome.record.sub,
      email: outcome.record.email,
    },
  };
}

export interface ProfileSnapshot {
  readonly fields: ProfileFields;
  readonly version: number;
  readonly avatar_version: number | null;
}

export interface AccountView {
  readonly signedIn: boolean;
  /** Only ever from the verified id_token's claims. */
  readonly email: string | null;
  readonly profile: ProfileSnapshot | null;
  readonly avatar: { readonly mime_type: AvatarMimeType; readonly data: string } | null;
  readonly countries: readonly { readonly code: string; readonly name: string }[];
  readonly subdivisions: readonly { readonly code: string; readonly name: string }[];
  readonly error: AccountErrorCode | null;
}

export const ANONYMOUS_VIEW: AccountView = {
  signedIn: false,
  email: null,
  profile: null,
  avatar: null,
  countries: [],
  subdivisions: [],
  error: null,
};

export const EXPIRED_VIEW: AccountView = { ...ANONYMOUS_VIEW, error: "unauthorized" };
