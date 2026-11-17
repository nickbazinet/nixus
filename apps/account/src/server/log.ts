/**
 * The one logging site in the account app (AD-12).
 *
 * Never logged, by construction rather than by care: profile field values, avatar
 * bytes or base64, tokens, cookies or their hashes, the client secret, and the
 * OAuth `code`, `state` or `nonce`. The accepted shape is a closed record of
 * route, status, latency, an error code and byte sizes — plus `sub`, which AD-12
 * explicitly permits.
 *
 * `log()` takes that closed type, so a caller cannot widen it into a free-form
 * object, and the only `console` call in the app lives here (the ESLint config
 * bans `console` everywhere else).
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** Route template, never a URL with a query string. */
  readonly route: string;
  readonly status?: number;
  readonly latency_ms?: number;
  /** A stable code from a closed set, never a message built from input. */
  readonly code?: string;
  readonly bytes?: number;
  /** Cognito subject. Permitted by AD-12; nothing else identifying is. */
  readonly sub?: string;
}

export function log(level: LogLevel, entry: LogEntry): void {
  const line = JSON.stringify({ level, ...entry });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
