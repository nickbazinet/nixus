import { grantsCapability, type BillingCapability } from "@nixus/shared";

import type { BillingEntitlement, UserConfig } from "./table.ts";

/*
 * The entitlement decision, and the only place it is made (billing AD-17 step 3).
 *
 * Two shapes carry hosted-AI entitlement during the cutover window: the billing
 * table's `ENTITLEMENT` record, which billing AD-2 makes the sole authority, and
 * `HostedAiTable`'s original `USER#<sub>/CONFIG.premium` boolean, which Epic H
 * retires in a LATER release. Precedence between them is resolved here, once, by
 * a named function - never by an inline fallback in a handler, where the two
 * routes could drift into disagreeing about who is entitled.
 */

/**
 * Hosted AI is granted iff the authority's `capabilities[]` contains this name.
 * Typed against the shared contract's closed union, so renaming or removing the
 * capability there fails compilation here rather than silently denying everyone.
 * No `tier` value is compared anywhere (billing AD-1).
 */
export const HOSTED_AI_CAPABILITY: BillingCapability = "hosted_ai";

/** Which shape decided. Recorded for operations; never branched on by a caller. */
export type EntitlementAuthority =
  | "billing_entitlement"
  | "hosted_ai_premium_attribute";

export type HostedAiEntitlement =
  | {
      readonly granted: true;
      readonly authority: EntitlementAuthority;
      /**
       * `null` when neither shape records a usable limit. A grant with no limit
       * cannot be metered by `quota.ts`, which is a service limitation and never
       * a plan limitation.
       */
      readonly monthlyRequestLimit: number | null;
    }
  | { readonly granted: false; readonly authority: EntitlementAuthority };

/**
 * Precedence, in full:
 *
 * | billing `ENTITLEMENT`        | `CONFIG.premium` | decision            | limit            |
 * |------------------------------|------------------|---------------------|------------------|
 * | present, grants `hosted_ai`  | anything         | GRANTED (authority) | entitlement's, else CONFIG's |
 * | present, grants nothing      | `true`           | DENIED (authority)  | -                |
 * | present, unreadable          | `true`           | DENIED (fail closed)| -                |
 * | absent                       | `true` + limit   | GRANTED (attribute) | CONFIG's         |
 * | absent                       | absent/false/bad | DENIED              | -                |
 *
 * The third and fourth rows are the whole point of the cutover. Row three is why
 * a release can deploy BEFORE the backfill completes - a user the authority has
 * never heard of keeps the access they were hand-granted - and row two is why the
 * backfill can then run with no second deploy: the moment a record exists it
 * decides, including when it decides to deny.
 */
export function resolveHostedAiEntitlement(args: {
  readonly entitlement: BillingEntitlement | undefined;
  readonly userConfig: UserConfig | undefined;
}): HostedAiEntitlement {
  const { entitlement, userConfig } = args;

  if (entitlement !== undefined) {
    const authority = "billing_entitlement" as const;
    if (!grantsCapability(entitlement.capabilities, HOSTED_AI_CAPABILITY)) {
      return { granted: false, authority };
    }
    return {
      granted: true,
      authority,
      // The authority's limit wins; the legacy CONFIG item's is the fallback
      // while both shapes exist. `HostedAiTable` holds no per-user policy once
      // the authority serves every request (billing AD-2).
      monthlyRequestLimit:
        entitlement.monthly_request_limit ??
        userConfig?.monthly_request_limit ??
        null,
    };
  }

  const authority = "hosted_ai_premium_attribute" as const;
  return userConfig === undefined
    ? { granted: false, authority }
    : {
        granted: true,
        authority,
        monthlyRequestLimit: userConfig.monthly_request_limit,
      };
}

export type HostedAiServiceability =
  | {
      readonly serviceable: true;
      readonly monthlyRequestLimit: number;
      /** Carried through because `quota.ts` reserves against this exact item. */
      readonly userConfig: UserConfig;
    }
  | { readonly serviceable: false };

/**
 * Whether a GRANT can actually be served by this release, which is a separate
 * question from whether it was granted.
 *
 * `quota.ts` reserves against the legacy `USER#<sub>/CONFIG` item: its
 * `ConditionCheck` still requires `premium = true` and the item's own limit, and
 * that transaction is deliberately untouched here (Epic H removes it). So an
 * entitlement the authority grants with no parseable CONFIG item behind it, or
 * with no usable limit on either shape, has no reservation to make.
 *
 * Both routes consult THIS function rather than deciding for themselves, so
 * `GET /status` can never advertise a capability every `POST /invoke` refuses.
 */
export function hostedAiServiceability(args: {
  readonly hostedAi: HostedAiEntitlement;
  readonly userConfig: UserConfig | undefined;
}): HostedAiServiceability {
  const { hostedAi, userConfig } = args;

  if (!hostedAi.granted) return { serviceable: false };
  if (hostedAi.monthlyRequestLimit === null) return { serviceable: false };
  if (userConfig === undefined) return { serviceable: false };

  return {
    serviceable: true,
    monthlyRequestLimit: hostedAi.monthlyRequestLimit,
    userConfig,
  };
}
