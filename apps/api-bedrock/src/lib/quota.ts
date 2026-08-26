import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

import type { CloudAiOperation } from "@nixus/shared";

import {
  type GlobalConfig,
  type UserConfig,
  getDocumentClient,
  globalConfigKey,
  globalUsageKey,
  tableName,
  userConfigKey,
  userUsageKey,
} from "./table.ts";

/*
 * Quota accounting (AD-5 / AD-6). `charged_count` is the sole net authority;
 * every other counter is monotonic observability that never gates a decision.
 *
 * Reserve, refund, and finalize are each exactly one TransactWriteItems call that
 * atomically touches BOTH the user's and the GLOBAL usage item, each carrying its
 * own ClientRequestToken so a retried SDK call cannot double-apply.
 */

export const CHARGED_COUNT = "charged_count";
export const RESERVATION_COUNT = "reservation_count";
export const REFUND_COUNT = "refund_count";
export const COMPLETED_COUNT = "completed_count";
export const FAILED_AFTER_COMMIT_COUNT = "failed_after_commit_count";
export const INPUT_TOKENS = "input_tokens";
export const OUTPUT_TOKENS = "output_tokens";

export function settledCounterName(operation: CloudAiOperation): string {
  return `settled_${operation}_count`;
}

/**
 * Computed exactly once at request start and threaded through every subsequent
 * call. Recomputing any of these mid-request would break idempotency, or - for
 * `periodKey` - charge the wrong month across a UTC boundary.
 */
export interface QuotaRequestContext {
  readonly sub: string;
  readonly periodKey: string;
  readonly reservationId: string;
  readonly reserveToken: string;
  readonly refundToken: string;
  readonly finalizeToken: string;
}

export function createQuotaRequestContext(
  sub: string,
  periodKey: string,
  newId: () => string = randomUUID
): QuotaRequestContext {
  return {
    sub,
    periodKey,
    reservationId: newId(),
    reserveToken: newId(),
    refundToken: newId(),
    finalizeToken: newId(),
  };
}

export type ReserveOutcome =
  | "reserved"
  | "config_changed"
  | "user_quota_exhausted"
  | "global_quota_exhausted";

const CONDITIONAL_CHECK_FAILED = "ConditionalCheckFailed";

interface CancellationReason {
  readonly Code?: string;
}

function cancellationReasons(error: unknown): CancellationReason[] | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    name?: string;
    CancellationReasons?: CancellationReason[];
  };
  if (candidate.name !== "TransactionCanceledException") return undefined;
  return candidate.CancellationReasons ?? [];
}

function failedAt(reasons: CancellationReason[], index: number): boolean {
  return reasons[index]?.Code === CONDITIONAL_CHECK_FAILED;
}

/*
 * TransactItems order is load-bearing: DynamoDB returns CancellationReasons
 * positionally, and that positional mapping is the only way to tell "an admin
 * changed the config mid-request" apart from "this user is out of quota" apart
 * from "the whole service is at its global cap".
 */
const USER_CONFIG_INDEX = 0;
const GLOBAL_CONFIG_INDEX = 1;
const USER_USAGE_INDEX = 2;
const GLOBAL_USAGE_INDEX = 3;

export async function reserveQuotaUnit(args: {
  readonly context: QuotaRequestContext;
  readonly userConfig: UserConfig;
  readonly globalConfig: GlobalConfig;
  readonly now: Date;
}): Promise<ReserveOutcome> {
  const { context, userConfig, globalConfig, now } = args;
  const updatedAt = now.toISOString();

  const reserveUsage = (key: { pk: string; sk: string }, limit: number) => ({
    Update: {
      TableName: tableName(),
      Key: key,
      UpdateExpression:
        "SET #updated_at = :updated_at " +
        `ADD #${CHARGED_COUNT} :one, #${RESERVATION_COUNT} :one`,
      // A first-of-the-month request has no counter yet; anything at or above the
      // limit is refused rather than clamped, so concurrent reservations cannot
      // push charged_count past the configured limit.
      ConditionExpression: `attribute_not_exists(#${CHARGED_COUNT}) OR #${CHARGED_COUNT} < :limit`,
      ExpressionAttributeNames: {
        "#updated_at": "updated_at",
        [`#${CHARGED_COUNT}`]: CHARGED_COUNT,
        [`#${RESERVATION_COUNT}`]: RESERVATION_COUNT,
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":limit": limit,
        ":updated_at": updatedAt,
      },
    },
  });

  try {
    await getDocumentClient().send(
      new TransactWriteCommand({
        ClientRequestToken: context.reserveToken,
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName(),
              Key: userConfigKey(context.sub),
              ConditionExpression:
                "#premium = :premium AND #monthly_request_limit = :monthly_request_limit",
              ExpressionAttributeNames: {
                "#premium": "premium",
                "#monthly_request_limit": "monthly_request_limit",
              },
              ExpressionAttributeValues: {
                ":premium": true,
                ":monthly_request_limit": userConfig.monthly_request_limit,
              },
            },
          },
          {
            ConditionCheck: {
              TableName: tableName(),
              Key: globalConfigKey(),
              ConditionExpression:
                "#enabled = :enabled AND #monthly_request_limit = :monthly_request_limit",
              ExpressionAttributeNames: {
                "#enabled": "enabled",
                "#monthly_request_limit": "monthly_request_limit",
              },
              ExpressionAttributeValues: {
                ":enabled": true,
                ":monthly_request_limit": globalConfig.monthly_request_limit,
              },
            },
          },
          reserveUsage(
            userUsageKey(context.sub, context.periodKey),
            userConfig.monthly_request_limit
          ),
          reserveUsage(
            globalUsageKey(context.periodKey),
            globalConfig.monthly_request_limit
          ),
        ],
      })
    );
    return "reserved";
  } catch (error) {
    const reasons = cancellationReasons(error);
    if (!reasons) throw error;

    if (
      failedAt(reasons, USER_CONFIG_INDEX) ||
      failedAt(reasons, GLOBAL_CONFIG_INDEX)
    ) {
      return "config_changed";
    }
    if (failedAt(reasons, USER_USAGE_INDEX)) return "user_quota_exhausted";
    if (failedAt(reasons, GLOBAL_USAGE_INDEX)) return "global_quota_exhausted";
    throw error;
  }
}

/**
 * Returns false when there was nothing left to refund. A refund is only ever
 * legal before the `messageStart` commit event (AD-7); after it, the unit stays
 * charged forever.
 */
export async function refundQuotaUnit(args: {
  readonly context: QuotaRequestContext;
  readonly now: Date;
}): Promise<boolean> {
  const { context, now } = args;
  const updatedAt = now.toISOString();

  const refundUsage = (key: { pk: string; sk: string }) => ({
    Update: {
      TableName: tableName(),
      Key: key,
      UpdateExpression:
        "SET #updated_at = :updated_at " +
        `ADD #${CHARGED_COUNT} :minus_one, #${REFUND_COUNT} :one`,
      ConditionExpression: `#${CHARGED_COUNT} > :zero`,
      ExpressionAttributeNames: {
        "#updated_at": "updated_at",
        [`#${CHARGED_COUNT}`]: CHARGED_COUNT,
        [`#${REFUND_COUNT}`]: REFUND_COUNT,
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":minus_one": -1,
        ":zero": 0,
        ":updated_at": updatedAt,
      },
    },
  });

  try {
    await getDocumentClient().send(
      new TransactWriteCommand({
        ClientRequestToken: context.refundToken,
        TransactItems: [
          refundUsage(userUsageKey(context.sub, context.periodKey)),
          refundUsage(globalUsageKey(context.periodKey)),
        ],
      })
    );
    return true;
  } catch (error) {
    if (cancellationReasons(error)) return false;
    throw error;
  }
}

export type FinalizeOutcome = "completed" | "failed_after_commit";

/**
 * Settles a committed invocation. Never touches `charged_count`: only reserve and
 * refund move the net authority, so a post-commit failure stays charged (AD-7).
 */
export async function finalizeQuotaUnit(args: {
  readonly context: QuotaRequestContext;
  readonly operation: CloudAiOperation;
  readonly outcome: FinalizeOutcome;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly now: Date;
}): Promise<void> {
  const { context, operation, outcome, inputTokens, outputTokens, now } = args;

  const outcomeCounter =
    outcome === "completed" ? COMPLETED_COUNT : FAILED_AFTER_COMMIT_COUNT;
  const settledCounter = settledCounterName(operation);

  const finalizeUsage = (key: { pk: string; sk: string }) => ({
    Update: {
      TableName: tableName(),
      Key: key,
      UpdateExpression:
        "SET #updated_at = :updated_at " +
        `ADD #outcome_counter :one, #settled_counter :one, ` +
        `#${INPUT_TOKENS} :input_tokens, #${OUTPUT_TOKENS} :output_tokens`,
      ExpressionAttributeNames: {
        "#updated_at": "updated_at",
        "#outcome_counter": outcomeCounter,
        "#settled_counter": settledCounter,
        [`#${INPUT_TOKENS}`]: INPUT_TOKENS,
        [`#${OUTPUT_TOKENS}`]: OUTPUT_TOKENS,
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":input_tokens": inputTokens,
        ":output_tokens": outputTokens,
        ":updated_at": now.toISOString(),
      },
    },
  });

  await getDocumentClient().send(
    new TransactWriteCommand({
      ClientRequestToken: context.finalizeToken,
      TransactItems: [
        finalizeUsage(userUsageKey(context.sub, context.periodKey)),
        finalizeUsage(globalUsageKey(context.periodKey)),
      ],
    })
  );
}
