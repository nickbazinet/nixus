import {
  ENTITLEMENT_STATEMENT_REFRESH_FRACTION,
  ENTITLEMENT_STATEMENT_TTL_SECONDS,
  type EntitlementResponse,
} from "@nixus/shared";

import {
  ENTITLEMENT_ATTRIBUTES,
  FREE_ENTITLEMENT,
  toEntitlementRecord,
  toEntitlementResponse,
  type EntitlementRecord,
} from "../lib/entitlement.ts";
import { BillingFailureError, fail, failClientTooOld } from "../lib/errors.ts";
import { logBillingAnomaly } from "../lib/logging.ts";
import { signStatement } from "../lib/signing.ts";
import { entitlementKey, getItem, putVersionedItem } from "../lib/table.ts";

/*
 * `GET /entitlement` (AD-9).
 *
 * Normally this route is a READ: the stored statement is returned verbatim,
 * because AD-5's transaction already signed it. The two departures are explicit
 * and bounded - a refresh when the stored statement is more than half-spent, and
 * a signed FREE statement when there is no record at all.
 */

/**
 * The server-side floor below which no statement is served. Read here rather
 * than in the dispatcher because it is AD-9's policy and not a routing concern.
 */
export function minimumClientVersion(): string {
  const configured = process.env.MINIMUM_CLIENT_VERSION;
  if (!configured) {
    throw new Error("MINIMUM_CLIENT_VERSION is not configured");
  }
  return configured;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)/;

/** A numeric triple compare, never a string compare: `"10.0.0" < "9.0.0"`
 * lexicographically, which would lock out every build past the ninth minor. */
function parseVersion(value: string): readonly [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) return null;

  const parts = [match[1], match[2], match[3]].map(Number);
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0)
    ? [parts[0]!, parts[1]!, parts[2]!]
    : null;
}

function isBelow(
  candidate: readonly [number, number, number],
  floor: readonly [number, number, number],
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index]! !== floor[index]!) {
      return candidate[index]! < floor[index]!;
    }
  }
  return false;
}

const NO_FLOOR: readonly [number, number, number] = [0, 0, 0];

/**
 * AD-9's revocation floor. A missing or unparseable header is NOT refused while
 * the floor is `0.0.0`, because that default refuses nothing at launch and
 * locking out every client - including the account app, which sends no such
 * header - would be a self-inflicted outage. Once a real floor is configured an
 * unstated version cannot be shown to meet it, so it IS refused: that is the
 * whole point of raising the floor after a key leak.
 */
export function refuseClientBelowMinimum(clientVersion: string | null): void {
  const floor = parseVersion(minimumClientVersion());
  if (floor === null) {
    throw new Error("MINIMUM_CLIENT_VERSION is not configured");
  }
  if (!isBelow(NO_FLOOR, floor)) return;

  const candidate = clientVersion === null ? null : parseVersion(clientVersion);
  if (candidate === null || isBelow(candidate, floor)) {
    failClientTooOld(minimumClientVersion());
  }
}

/*
 * AD-9's per-`sub` bound on free-statement signing.
 *
 * A free entitlement has no record to cache a statement on, so each request
 * signs on demand and no record is created to work around that. The bound is a
 * FIXED WINDOW counter held at module scope, so it is per execution environment:
 * with the stack's reserved concurrency of 10 the worst-case aggregate is ten
 * times the limit below, which is still four orders of magnitude under anything
 * that matters at KMS prices, and the alternative - a DynamoDB counter - would
 * be the very write AD-9 forbids.
 *
 * The map is bounded too: a flood of distinct `sub`s would otherwise grow it
 * without limit inside a long-lived container.
 */
const FREE_STATEMENT_WINDOW_SECONDS = 60;
const FREE_STATEMENT_LIMIT_PER_WINDOW = 10;
const FREE_STATEMENT_TRACKED_SUBS = 1000;

interface SigningWindow {
  windowStartedAt: number;
  count: number;
}

const freeStatementWindows = new Map<string, SigningWindow>();

/** Test seam: clears the in-process window between specs. */
export function resetFreeStatementLimitForTesting(): void {
  freeStatementWindows.clear();
}

function admitFreeStatement(sub: string, nowSeconds: number): boolean {
  const windowStart =
    Math.floor(nowSeconds / FREE_STATEMENT_WINDOW_SECONDS) *
    FREE_STATEMENT_WINDOW_SECONDS;

  const tracked = freeStatementWindows.get(sub);
  if (tracked === undefined || tracked.windowStartedAt !== windowStart) {
    if (freeStatementWindows.size >= FREE_STATEMENT_TRACKED_SUBS) {
      // Insertion-ordered, so the oldest tracked window is evicted first.
      const oldest = freeStatementWindows.keys().next();
      if (!oldest.done) freeStatementWindows.delete(oldest.value);
    }
    freeStatementWindows.set(sub, { windowStartedAt: windowStart, count: 1 });
    return true;
  }

  if (tracked.count >= FREE_STATEMENT_LIMIT_PER_WINDOW) return false;
  tracked.count += 1;
  return true;
}

/**
 * Half the window, per the contract's `ENTITLEMENT_STATEMENT_REFRESH_FRACTION`:
 * a device that revalidates on start and on sign-in is then never served
 * something close to expiry.
 *
 * The stored `iat` is the window's true start. A record written before it was
 * recorded falls back to the nominal TTL, which errs toward refreshing.
 */
export function needsRefresh(args: {
  readonly record: EntitlementRecord;
  readonly nowSeconds: number;
}): boolean {
  const { record, nowSeconds } = args;
  if (record.statement.length === 0) return true;

  const window =
    record.statement_iat > 0
      ? record.statement_exp - record.statement_iat
      : ENTITLEMENT_STATEMENT_TTL_SECONDS;
  if (window <= 0) return true;

  const remaining = record.statement_exp - nowSeconds;
  return remaining <= window * ENTITLEMENT_STATEMENT_REFRESH_FRACTION;
}

/**
 * A free account receives a NORMAL, verifiable statement with an empty
 * capability list and no entitlement write. That is what lets a client tell
 * *verified free* from *could not reach the server* (AD-9).
 */
async function freeStatementResponse(args: {
  readonly sub: string;
  readonly now: Date;
  readonly requestId: string;
}): Promise<EntitlementResponse> {
  const { sub, now, requestId } = args;

  if (!admitFreeStatement(sub, Math.floor(now.getTime() / 1000))) {
    logBillingAnomaly({
      request_id: requestId,
      anomaly: "free_statement_rate_limited",
      sub,
    });
    fail("rate_limited");
  }

  const signed = await signStatement({
    sub,
    tier: FREE_ENTITLEMENT.tier,
    capabilities: FREE_ENTITLEMENT.capabilities,
    monthlyRequestLimit: FREE_ENTITLEMENT.monthly_request_limit,
    // No period end, so the statement gets a full window and is never
    // born-expired (AD-9).
    currentPeriodEnd: FREE_ENTITLEMENT.current_period_end,
    now,
  });

  return toEntitlementResponse({
    state: FREE_ENTITLEMENT,
    source: "stripe",
    statement: signed.statement,
    statementExp: signed.claims.exp,
    // `null` because no record exists, which is itself the information.
    version: null,
  });
}

/**
 * The read-path refresh, and the reason it does not make this route a third
 * writer of entitlement (AD-2, AD-9): the item it writes differs from the one it
 * read in the statement-cache attributes ONLY, and the write is conditional on
 * the entitlement's `version` being unchanged. `version` is deliberately NOT
 * advanced - a cache refresh is not a state advance, and advancing it would
 * invalidate a webhook's expected version for no reason.
 *
 * A failed condition is DISCARDED rather than retried: the authoritative state
 * changed underneath, so the next read re-derives from it.
 */
async function persistRefreshedStatement(args: {
  readonly sub: string;
  readonly stored: Record<string, unknown>;
  readonly statement: string;
  readonly statementIat: number;
  readonly statementExp: number;
  readonly expectedVersion: number;
}): Promise<void> {
  const item = {
    ...args.stored,
    [ENTITLEMENT_ATTRIBUTES.statement]: args.statement,
    [ENTITLEMENT_ATTRIBUTES.statementIat]: args.statementIat,
    [ENTITLEMENT_ATTRIBUTES.statementExp]: args.statementExp,
  };

  try {
    await putVersionedItem({
      item,
      expectedVersion: args.expectedVersion,
      resource: "entitlement",
    });
  } catch (error) {
    if (
      error instanceof BillingFailureError &&
      error.failure.code === "version_conflict"
    ) {
      return;
    }
    throw error;
  }
}

export async function handleEntitlement(args: {
  readonly sub: string;
  readonly clientVersion: string | null;
  readonly now: Date;
  readonly requestId: string;
}): Promise<EntitlementResponse> {
  const { sub, clientVersion, now, requestId } = args;

  // Before anything is read or signed: a build below the floor is refused a
  // statement rather than served one.
  refuseClientBelowMinimum(clientVersion);

  const stored = await getItem(entitlementKey(sub));
  if (stored === undefined) {
    return freeStatementResponse({ sub, now, requestId });
  }

  const record = toEntitlementRecord(stored);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const state = {
    tier: record.tier,
    capabilities: record.capabilities,
    status: record.status,
    current_period_end: record.current_period_end,
    monthly_request_limit: record.monthly_request_limit,
    malformed: false,
  };

  if (!needsRefresh({ record, nowSeconds })) {
    return toEntitlementResponse({
      state,
      source: record.source,
      statement: record.statement,
      statementExp: record.statement_exp,
      version: record.version,
    });
  }

  const signed = await signStatement({
    sub,
    tier: record.tier,
    capabilities: record.capabilities,
    monthlyRequestLimit: record.monthly_request_limit,
    currentPeriodEnd: record.current_period_end,
    now,
  });

  await persistRefreshedStatement({
    sub,
    stored,
    statement: signed.statement,
    statementIat: signed.claims.iat,
    statementExp: signed.claims.exp,
    expectedVersion: record.version,
  });

  return toEntitlementResponse({
    state,
    source: record.source,
    statement: signed.statement,
    statementExp: signed.claims.exp,
    version: record.version,
  });
}
