import type {
  CloudAiErrorResponse,
  CloudAiFrame,
  CloudAiOperation,
  CloudAiStopReason,
} from "@nixus/shared";

import type { BedrockPort } from "../lib/bedrock-client.ts";
import {
  createQuotaRequestContext,
  finalizeQuotaUnit,
  refundQuotaUnit,
  reserveQuotaUnit,
} from "../lib/quota.ts";
import {
  type GlobalConfig,
  type UserConfig,
  getGlobalChargedCount,
  getGlobalConfig,
  getUserChargedCount,
  getUserConfig,
} from "../lib/table.ts";
import {
  type PreOutputFailure,
  type PreparedInvokeRequest,
  checkContentEncoding,
  validateInvokeRequest,
} from "../lib/validation.ts";

/*
 * POST /v1/ai/invoke (AD-7 / AD-8).
 *
 * Quota is per REQUEST: one `charged_count` unit per actual `ConverseStream` call.
 * Token counts are recorded from the stream's own metadata for observability and never
 * gate or bill anything, so there is no pre-flight token call to make.
 *
 * `messageStart` is the exact commit event. Before it, a failure is pre-output:
 * refund the reservation and answer a real HTTP status with no NDJSON body, which
 * is the only situation where desktop fallback is legal. After it, a failure is
 * in-band, charged, finalized, and never retried or refunded.
 */

/** AbortController fires with this much execution time left, so finalize accounting still fits. */
export const SOFT_DEADLINE_MS = 10_000;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";
export const JSON_CONTENT_TYPE = "application/json";

/**
 * Owns API Gateway's required streaming prelude so the handler only decides *when*
 * to commit, never how to frame the HTTP response.
 */
export interface ResponseSink {
  begin(status: number, contentType: string): void;
  write(chunk: string): void;
  end(): Promise<void>;
}

export interface InvokeDependencies {
  readonly bedrock: BedrockPort;
  readonly now: () => Date;
  readonly remainingTimeMillis: () => number;
  readonly newId?: () => string;
}

export interface InvokeInput {
  readonly sub: string;
  readonly requestId: string;
  readonly periodKey: string;
  readonly headers: Readonly<Record<string, string | undefined>> | undefined;
  readonly body: string | undefined;
}

type Eligibility =
  | {
      readonly ok: true;
      readonly userConfig: UserConfig;
      readonly globalConfig: GlobalConfig;
    }
  | { readonly ok: false; readonly failure: PreOutputFailure };

const HOSTED_UNAVAILABLE: PreOutputFailure = {
  code: "hosted_unavailable",
  status: 503,
  message: "Hosted AI is unavailable.",
};

const PREMIUM_REQUIRED: PreOutputFailure = {
  code: "premium_required",
  status: 403,
  message: "Hosted AI requires an active premium capability.",
};

const QUOTA_EXHAUSTED: PreOutputFailure = {
  code: "quota_exhausted",
  status: 429,
  message: "Monthly hosted AI request limit reached.",
};

export function canonicalErrorBody(
  failure: PreOutputFailure,
  requestId: string
): CloudAiErrorResponse {
  return {
    error: {
      code: failure.code,
      message: failure.message,
      request_id: requestId,
    },
  };
}

/*
 * Only shapes, counts, and outcomes are ever logged - never `system`, `messages`,
 * any content block, any Bedrock response text, or a file name (AD-11).
 */
type LogFields = Record<string, string | number | boolean>;

function writePreOutputError(
  sink: ResponseSink,
  failure: PreOutputFailure,
  requestId: string,
  fields: LogFields
): void {
  console.error(
    JSON.stringify({
      event: "invoke_rejected",
      request_id: requestId,
      status: failure.status,
      code: failure.code,
      ...fields,
    })
  );
  sink.begin(failure.status, JSON_CONTENT_TYPE);
  sink.write(JSON.stringify(canonicalErrorBody(failure, requestId)));
}

function writeFrame(sink: ResponseSink, frame: CloudAiFrame): void {
  sink.write(`${JSON.stringify(frame)}\n`);
}

/**
 * Records a quota-accounting failure. Only the error's constructor name is kept: a
 * DynamoDB SDK error's message and its `$metadata` can echo the item and expression
 * attribute values back, and the item is keyed by `sub` (AD-11).
 *
 * These two events are the only signal that a counter drifted, since the accepted
 * v1 risk has no reconciler - so they are emitted as their own event names rather
 * than folded into a generic failure log.
 */
function logAccountingFailure(
  event: "refund_failed" | "finalize_failed",
  error: unknown,
  fields: LogFields
): void {
  console.error(
    JSON.stringify({
      event,
      error_name: error instanceof Error ? error.name : "unknown",
      ...fields,
    })
  );
}

async function classifyEligibility(
  sub: string,
  periodKey: string
): Promise<Eligibility> {
  const [userConfig, globalConfig, userCharged, globalCharged] = await Promise.all(
    [
      getUserConfig(sub),
      getGlobalConfig(),
      getUserChargedCount(sub, periodKey),
      getGlobalChargedCount(periodKey),
    ]
  );

  // GLOBAL is evaluated first: the kill switch must block every new hosted call
  // regardless of who is asking, and 503 is also what tells the desktop to back
  // off briefly rather than conclude the user lost premium.
  if (!globalConfig || !globalConfig.enabled) {
    return { ok: false, failure: HOSTED_UNAVAILABLE };
  }
  if (globalCharged >= globalConfig.monthly_request_limit) {
    return { ok: false, failure: HOSTED_UNAVAILABLE };
  }
  if (!userConfig) {
    return { ok: false, failure: PREMIUM_REQUIRED };
  }
  if (userCharged >= userConfig.monthly_request_limit) {
    return { ok: false, failure: QUOTA_EXHAUSTED };
  }
  return { ok: true, userConfig, globalConfig };
}

function reserveFailure(
  outcome: "config_changed" | "user_quota_exhausted" | "global_quota_exhausted"
): PreOutputFailure {
  switch (outcome) {
    case "user_quota_exhausted":
      return QUOTA_EXHAUSTED;
    case "global_quota_exhausted":
      return HOSTED_UNAVAILABLE;
    case "config_changed":
      // A second mismatch means an admin is actively editing config; fail closed
      // rather than loop (AD-6).
      return PREMIUM_REQUIRED;
  }
}

export async function handleInvoke(
  input: InvokeInput,
  deps: InvokeDependencies,
  sink: ResponseSink
): Promise<void> {
  const { sub, requestId, periodKey, headers, body } = input;
  const { bedrock, now, remainingTimeMillis, newId } = deps;

  const encodingFailure = checkContentEncoding(headers);
  if (encodingFailure) {
    writePreOutputError(sink, encodingFailure, requestId, {
      sub,
      stage: "transport",
    });
    await sink.end();
    return;
  }

  const validation = validateInvokeRequest(body);
  if (!validation.ok) {
    writePreOutputError(sink, validation.failure, requestId, {
      sub,
      stage: "schema",
    });
    await sink.end();
    return;
  }
  const request: PreparedInvokeRequest = validation.value;
  const operation: CloudAiOperation = request.operation;

  const remaining = remainingTimeMillis();
  if (remaining <= SOFT_DEADLINE_MS) {
    // Already inside the soft-deadline margin. Starting upstream work now would
    // spend a quota unit on an invocation that cannot finish, so refuse before
    // touching DynamoDB or Bedrock at all.
    writePreOutputError(sink, HOSTED_UNAVAILABLE, requestId, {
      sub,
      operation,
      stage: "soft_deadline",
      remaining_ms: remaining,
    });
    await sink.end();
    return;
  }

  const context = createQuotaRequestContext(sub, periodKey, newId);

  const controller = new AbortController();
  const deadlineTimer = setTimeout(
    () => controller.abort(),
    remaining - SOFT_DEADLINE_MS
  );
  // Must not hold the Lambda's event loop open past a fast response.
  deadlineTimer.unref();

  let reserved = false;
  let committed = false;
  let endWritten = false;
  let stopReason: CloudAiStopReason = "other";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let attempt = 0; attempt < 2 && !reserved; attempt += 1) {
      const eligibility = await classifyEligibility(sub, periodKey);
      if (!eligibility.ok) {
        writePreOutputError(sink, eligibility.failure, requestId, {
          sub,
          operation,
          stage: "eligibility",
        });
        return;
      }

      const outcome = await reserveQuotaUnit({
        context,
        userConfig: eligibility.userConfig,
        globalConfig: eligibility.globalConfig,
        now: now(),
      });

      if (outcome === "reserved") {
        reserved = true;
        break;
      }
      if (outcome === "config_changed" && attempt === 0) {
        continue;
      }

      writePreOutputError(sink, reserveFailure(outcome), requestId, {
        sub,
        operation,
        stage: "reserve",
      });
      return;
    }

    const stream = bedrock.converseStream({
      system: request.system,
      messages: request.messages,
      maxOutputTokens: request.limits.outputTokens,
      abortSignal: controller.signal,
    });

    for await (const event of stream) {
      switch (event.kind) {
        case "message_start":
          // The single commit point: the prelude and the meta frame are written
          // here and nowhere earlier - not after reservation, not on "first byte".
          committed = true;
          sink.begin(200, NDJSON_CONTENT_TYPE);
          writeFrame(sink, { type: "meta", operation, request_id: requestId });
          break;
        case "delta":
          writeFrame(sink, { type: "delta", text: event.text });
          break;
        case "stop":
          stopReason = event.stopReason;
          break;
        case "usage":
          if (event.inputTokens > 0) inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
          break;
      }
    }

    if (!committed) {
      // The stream ended without ever reaching messageStart, so nothing was
      // committed and this is still a refundable pre-output failure.
      throw new Error("ConverseStream ended before messageStart");
    }

    writeFrame(sink, {
      type: "end",
      stop_reason: stopReason,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
    endWritten = true;
    console.log(
      JSON.stringify({
        event: "invoke_completed",
        request_id: requestId,
        sub,
        operation,
        status: 200,
        stop_reason: stopReason,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      })
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";

    if (committed) {
      writeFrame(sink, {
        type: "error",
        code: "hosted_unavailable",
        message: "The hosted AI stream failed after output began.",
      });
      console.error(
        JSON.stringify({
          event: "invoke_failed_after_commit",
          request_id: requestId,
          sub,
          operation,
          status: 200,
          code: "hosted_unavailable",
          error_name: errorName,
        })
      );
    } else {
      if (reserved) {
        // A refund that itself fails must not replace the response the caller is
        // owed, nor abort before the sink is closed. The unit stays charged and the
        // event is what an operator reconciles from - there is no reconciler (AD-7).
        try {
          await refundQuotaUnit({ context, now: now() });
        } catch (refundError) {
          logAccountingFailure("refund_failed", refundError, {
            request_id: requestId,
            sub,
            operation,
            reservation_id: context.reservationId,
            period: context.periodKey,
          });
        }
      }
      writePreOutputError(sink, HOSTED_UNAVAILABLE, requestId, {
        sub,
        operation,
        stage: "converse_stream",
        error_name: errorName,
      });
    }
  } finally {
    clearTimeout(deadlineTimer);
    // AD-7: idempotent settle accounting runs here, so an abort at the soft
    // deadline still records the outcome of a committed invocation.
    if (committed) {
      try {
        await finalizeQuotaUnit({
          context,
          operation,
          outcome: endWritten ? "completed" : "failed_after_commit",
          inputTokens,
          outputTokens,
          now: now(),
        });
      } catch (finalizeError) {
        // The response is already committed and partly delivered. Throwing here
        // would abandon the stream unterminated and turn a metrics failure into a
        // broken response, so it is recorded and swallowed. `charged_count` is
        // untouched either way: only reserve and refund move it.
        logAccountingFailure("finalize_failed", finalizeError, {
          request_id: requestId,
          sub,
          operation,
          reservation_id: context.reservationId,
          period: context.periodKey,
          outcome: endWritten ? "completed" : "failed_after_commit",
        });
      }
    }
    // Unconditionally last: every path above must leave the stream terminated.
    await sink.end();
  }
}
