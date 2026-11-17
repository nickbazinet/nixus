import type { DestinationKey } from "./destinations.ts";

/**
 * The session table's two item shapes (AD-10).
 *
 * Both are keyed by `id = SHA-256(cookie value)`, so the table never holds a
 * usable cookie. `expires_at` is the DynamoDB TTL attribute and reclaims storage
 * only: DynamoDB deletes expired items "within a few days", so an expired row
 * stays readable and `sessions.ts` checks both expiries in code on every read.
 */

export const PREAUTH_TTL_SECONDS = 10 * 60;
export const SESSION_IDLE_TTL_SECONDS = 24 * 60 * 60;
export const SESSION_ABSOLUTE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface PreAuthRecord {
  readonly id: string;
  readonly type: "preauth";
  readonly state: string;
  readonly nonce: string;
  readonly code_verifier: string;
  readonly destination: DestinationKey;
  /** Epoch seconds. Checked in code; the TTL attribute is the same value. */
  readonly expires_at: number;
}

export interface SessionTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  /** Epoch seconds at which `access_token` stops being usable. */
  readonly access_expires_at: number;
}

export interface SessionRecord {
  readonly id: string;
  readonly type: "session";
  readonly sub: string;
  readonly email: string | null;
  readonly tokens: SessionTokens;
  readonly idle_expires_at: number;
  readonly absolute_expires_at: number;
  /** TTL attribute: the later of the two expiries cannot outlive the absolute one. */
  readonly expires_at: number;
}

export interface SessionStore {
  putPreAuth(record: PreAuthRecord): Promise<void>;
  /** Single-use: deletes and returns the record in one conditional operation. */
  consumePreAuth(id: string): Promise<PreAuthRecord | null>;
  putSession(record: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
  /** Extends the idle expiry only. Never touches `absolute_expires_at`. */
  extendSession(id: string, idleExpiresAt: number): Promise<void>;
  replaceTokens(id: string, tokens: SessionTokens): Promise<void>;
}
