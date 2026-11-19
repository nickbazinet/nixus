import { grantsCapability, type BillingCapability } from "@nixus/shared";

import type { BillingEntitlement } from "./table.ts";

/*
 * The entitlement decision, and the only place it is made (billing AD-17 step
 * 3). The billing table's `ENTITLEMENT` record, which billing AD-2 makes the
 * sole authority, is the ONLY shape consulted here. `HostedAiTable.premium`
 * and its `CONFIG` item are retired (Epic H): there is no second shape and no
 * fallback, so a caller the authority has never heard of is denied, not
 * grandfathered.
 */

/**
 * Hosted AI is granted iff the authority's `capabilities[]` contains this name.
 * Typed against the shared contract's closed union, so renaming or removing the
 * capability there fails compilation here rather than silently denying everyone.
 * No `tier` value is compared anywhere (billing AD-1).
 */
export const HOSTED_AI_CAPABILITY: BillingCapability = "hosted_ai";

export type HostedAiEntitlement =
  | {
      readonly granted: true;
      /**
       * `null` when the record carries no usable limit. A grant with no limit
       * cannot be metered by `quota.ts`, which is a service limitation and
       * never a plan limitation.
       */
      readonly monthlyRequestLimit: number | null;
      /**
       * The record's own optimistic-concurrency token, carried through so
       * `quota.ts` can re-verify it inside the reservation transaction.
       * `null` only when the record itself is unreadable, which already
       * denies above - see `hostedAiServiceability`.
       */
      readonly version: number | null;
    }
  | { readonly granted: false };

/**
 * No record, or a record that does not grant `hosted_ai`, is DENIED. There is
 * no second shape to consult: an absent `ENTITLEMENT` means this account has
 * never converged a Stripe subscription or an admin grant, full stop.
 */
export function resolveHostedAiEntitlement(args: {
  readonly entitlement: BillingEntitlement | undefined;
}): HostedAiEntitlement {
  const { entitlement } = args;

  if (entitlement === undefined) {
    return { granted: false };
  }
  if (!grantsCapability(entitlement.capabilities, HOSTED_AI_CAPABILITY)) {
    return { granted: false };
  }
  return {
    granted: true,
    monthlyRequestLimit: entitlement.monthly_request_limit,
    version: entitlement.version,
  };
}

export type HostedAiServiceability =
  | {
      readonly serviceable: true;
      readonly monthlyRequestLimit: number;
      /** Carried through because `quota.ts` reserves against this exact version. */
      readonly entitlementVersion: number;
    }
  | { readonly serviceable: false };

/**
 * Whether a GRANT can actually be served by this release, which is a separate
 * question from whether it was granted. A record with no usable limit, or no
 * usable version, has no reservation `quota.ts` can make - a service
 * limitation, never a plan limitation.
 *
 * Both routes consult THIS function rather than deciding for themselves, so
 * `GET /status` can never advertise a capability every `POST /invoke` refuses.
 */
export function hostedAiServiceability(args: {
  readonly hostedAi: HostedAiEntitlement;
}): HostedAiServiceability {
  const { hostedAi } = args;

  if (!hostedAi.granted) return { serviceable: false };
  if (hostedAi.monthlyRequestLimit === null) return { serviceable: false };
  if (hostedAi.version === null) return { serviceable: false };

  return {
    serviceable: true,
    monthlyRequestLimit: hostedAi.monthlyRequestLimit,
    entitlementVersion: hostedAi.version,
  };
}
