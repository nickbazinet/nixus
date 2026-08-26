import type { CloudAiStatusResponse } from "@nixus/shared";

import {
  getGlobalConfig,
  getUserChargedCount,
  getUserConfig,
} from "../lib/table.ts";

/*
 * GET /v1/ai/status (AD-6).
 *
 * A status read is NOT an enforcement gate. Where `invoke` fails closed with
 * 403/429/503, this route answers 200 with zeroed non-premium fields, so the
 * desktop can distinguish "not premium" from "gateway broken" without treating a
 * cold user record as an error.
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

  const [userConfig, globalConfig] = await Promise.all([
    getUserConfig(sub),
    getGlobalConfig(),
  ]);

  // The global kill switch hides premium capability from status too: reporting
  // premium:true while every invoke returns 503 would make the desktop cache a
  // capability it cannot use.
  if (!userConfig || !globalConfig?.enabled) {
    return { ...NON_PREMIUM, period: periodKey };
  }

  return {
    premium: true,
    monthly_request_limit: userConfig.monthly_request_limit,
    charged_count: await getUserChargedCount(sub, periodKey),
    period: periodKey,
  };
}
