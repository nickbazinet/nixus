import type { AdminOverrideResponse } from "@nixus/shared";

import {
  ENTITLEMENT_ATTRIBUTES,
  toEntitlementRecord,
  toEntitlementResponse,
} from "../lib/entitlement.ts";
import { logAdminOverride } from "../lib/logging.ts";
import { signStatement } from "../lib/signing.ts";
import { entitlementKey, getItem, putVersionedItem } from "../lib/table.ts";
import type { ValidatedAdminOverrideRequest } from "../lib/validation.ts";

/*
 * `POST /admin/override` (AD-2).
 *
 * The authenticated administrative grant that replaces the manual `put-item`
 * runbook, so it is subject to the same conditional write, the same contract and
 * the same logging as every other route. The ADMINISTRATIVE claim that
 * authorizes the call is checked in the dispatcher before this is reached; the
 * subject being granted arrives in the validated body, which is the one route on
 * which that is true.
 *
 * The override is ranked ABOVE a converging webhook: it carries
 * `source = admin`, a mandatory `admin_expires_at` and a reason, and
 * `handlers/webhook.ts` records Stripe-derived state in separate attributes
 * while it is live. It is therefore always visible, always time-boxed, and never
 * indistinguishable from a paid entitlement.
 */
export async function handleAdminOverride(args: {
  readonly request: ValidatedAdminOverrideRequest;
  readonly actorSub: string;
  readonly now: Date;
  readonly requestId: string;
}): Promise<AdminOverrideResponse> {
  const { request, actorSub, now, requestId } = args;

  const stored = await getItem(entitlementKey(request.sub));
  const record = stored === undefined ? undefined : toEntitlementRecord(stored);

  // An administrative grant carries no Stripe period, so the statement gets a
  // full window; `admin_expires_at` is what bounds the grant itself (AD-2).
  const state = {
    tier: request.tier,
    capabilities: request.capabilities,
    status: "none" as const,
    current_period_end: null,
    monthly_request_limit: request.monthlyRequestLimit,
    malformed: false,
  };

  const signed = await signStatement({
    sub: request.sub,
    tier: state.tier,
    capabilities: state.capabilities,
    monthlyRequestLimit: state.monthly_request_limit,
    currentPeriodEnd: state.current_period_end,
    now,
  });

  const version = (record?.version ?? 0) + 1;
  const timestamp = now.toISOString();
  const attribute = ENTITLEMENT_ATTRIBUTES;

  await putVersionedItem({
    resource: "entitlement",
    expectedVersion: request.expectedVersion,
    item: {
      // The previously recorded Stripe state is carried forward unchanged, so
      // the next convergence after this override expires can restore it.
      ...stored,
      ...entitlementKey(request.sub),
      [attribute.tier]: state.tier,
      [attribute.capabilities]: [...state.capabilities],
      [attribute.status]: state.status,
      [attribute.currentPeriodEnd]: state.current_period_end,
      [attribute.monthlyRequestLimit]: state.monthly_request_limit,
      [attribute.source]: "admin",
      [attribute.statement]: signed.statement,
      [attribute.statementIat]: signed.claims.iat,
      [attribute.statementExp]: signed.claims.exp,
      version,
      [attribute.createdAt]:
        typeof stored?.[attribute.createdAt] === "string"
          ? stored[attribute.createdAt]
          : timestamp,
      [attribute.updatedAt]: timestamp,
      [attribute.adminExpiresAt]: request.adminExpiresAt,
      [attribute.adminReason]: request.reason,
      [attribute.adminActor]: actorSub,
    },
  });

  logAdminOverride({
    request_id: requestId,
    actor_sub: actorSub,
    subject_sub: request.sub,
    reason: request.reason,
    tier: state.tier,
    capabilities: state.capabilities,
    admin_expires_at: request.adminExpiresAt,
  });

  return toEntitlementResponse({
    state,
    source: "admin",
    statement: signed.statement,
    statementExp: signed.claims.exp,
    version,
  });
}
