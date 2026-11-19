import type { CloudAiStatusResponse } from "@nixus/shared";

import {
  hostedAiServiceability,
  resolveHostedAiEntitlement,
} from "../lib/entitlement.ts";
import {
  getBillingEntitlement,
  getGlobalConfig,
  getUserChargedCount,
} from "../lib/table.ts";

/*
 * GET /v1/ai/status (AD-6).
 *
 * A status read is NOT an enforcement gate. Where `invoke` fails closed with
 * 403/429/503, this route answers 200 with zeroed non-premium fields, so the
 * desktop can distinguish "not premium" from "gateway broken" without treating a
 * cold user record as an error.
 *
 * The wire shape keeps its `premium` boolean (AD-17 step 4, for an older
 * desktop still reading it), sourced entirely from the entitlement authority -
 * `HostedAiTable.premium` is retired (Epic H) and no longer exists anywhere in
 * this decision.
 */

const NON_PREMIUM: Omit<CloudAiStatusResponse, "period"> = {
  premium: false,
  monthly_request_limit: 0,
  charged_count: 0,
};

export async function handleStatus(args: {
  readonly sub: string;
  readonly periodKey: string;
}): Promise<CloudAiStatusResponse> {
  const { sub, periodKey } = args;

  const [globalConfig, entitlement] = await Promise.all([
    getGlobalConfig(),
    getBillingEntitlement(sub),
  ]);

  const hostedAi = resolveHostedAiEntitlement({ entitlement });
  const service = hostedAiServiceability({ hostedAi });

  // The global kill switch hides premium capability from status too: reporting
  // premium:true while every invoke returns 503 would make the desktop cache a
  // capability it cannot use. A grant this release cannot serve is zeroed for
  // exactly the same reason, through the predicate both routes share.
  if (!globalConfig?.enabled || !service.serviceable) {
    return { ...NON_PREMIUM, period: periodKey };
  }

  return {
    premium: true,
    monthly_request_limit: service.monthlyRequestLimit,
    charged_count: await getUserChargedCount(sub, periodKey),
    period: periodKey,
  };
}
