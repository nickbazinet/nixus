import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  CountTokensCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ContentBlock,
  Message,
  SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

import type { CloudAiStopReason } from "@nixus/shared";

import {
  FIXED_DOCUMENT_NAME,
  type PreparedContent,
  type PreparedMessage,
} from "./validation.ts";

/*
 * Bedrock adapter. Translates the snake_case public wire union into the SDK's
 * Converse-shaped types - the SDK's own field naming is never part of the public
 * contract - and normalizes the stream into the four events the handler needs.
 */

export type BedrockStreamEvent =
  /** The exact commit event (AD-7). Nothing may be written to the response before this. */
  | { readonly kind: "message_start" }
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "stop"; readonly stopReason: CloudAiStopReason }
  | {
      readonly kind: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
    };

export interface CountTokensArgs {
  readonly system: string;
  readonly messages: readonly PreparedMessage[];
  readonly abortSignal?: AbortSignal;
}

export interface ConverseStreamArgs extends CountTokensArgs {
  readonly maxOutputTokens: number;
}

export interface BedrockPort {
  countInputTokens(args: CountTokensArgs): Promise<number>;
  converseStream(args: ConverseStreamArgs): AsyncIterable<BedrockStreamEvent>;
}

/*
 * Every Converse stopReason AWS can return, mapped into the closed client union.
 * Anything unlisted becomes `other` so a new AWS literal can never reach the
 * desktop as an unrecognized string.
 */
/*
 * A Map, not an object literal: a plain-object lookup inherits from
 * Object.prototype, so a `stopReason` of "constructor" or "toString" would resolve
 * to an inherited function instead of `undefined`, defeat the `?? "other"` guard,
 * and hand a non-`CloudAiStopReason` value to the desktop.
 */
const STOP_REASONS: ReadonlyMap<string, CloudAiStopReason> = new Map([
  ["end_turn", "end_turn"],
  ["max_tokens", "max_tokens"],
  ["stop_sequence", "stop_sequence"],
  ["content_filtered", "content_filtered"],
  ["guardrail_intervened", "guardrail_intervened"],
  ["model_context_window_exceeded", "model_context_window_exceeded"],
] satisfies readonly (readonly [string, CloudAiStopReason])[]);

export function normalizeStopReason(
  reason: string | undefined
): CloudAiStopReason {
  if (reason === undefined) return "other";
  return STOP_REASONS.get(reason) ?? "other";
}

export function toConverseSystem(
  system: string
): SystemContentBlock[] | undefined {
  // Bedrock rejects an empty system block; the contract permits an empty string,
  // so an empty prompt means "no system block" rather than a malformed call.
  return system.length === 0 ? undefined : [{ text: system }];
}

function toConverseContent(block: PreparedContent): ContentBlock {
  switch (block.type) {
    case "text":
      return { text: block.text };
    case "image":
      return {
        image: { format: block.format, source: { bytes: block.bytes } },
      };
    case "document":
      return {
        document: {
          format: block.format,
          // Never a client-supplied file name (AD-8): a caller-controlled name is
          // both a prompt-injection vector and a path leak.
          name: FIXED_DOCUMENT_NAME,
          source: { bytes: block.bytes },
        },
      };
  }
}

export function toConverseMessages(
  messages: readonly PreparedMessage[]
): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map(toConverseContent),
  }));
}

/*
 * A profile-shaped id (`us.`, `eu.`, `apac.`, `global.`) is the one wrong value that
 * looks right: it is accepted by the SDK and then rejects CountTokens at runtime, which
 * classifies as `503 hosted_unavailable` and reads as a Bedrock outage rather than a
 * misconfiguration. Refusing it here names the real fault instead.
 */
const INFERENCE_PROFILE_PREFIX = /^(us|eu|apac|global)\./;

export function modelId(): string {
  const id = process.env.BEDROCK_MODEL_ID?.trim();
  if (!id) {
    throw new Error("BEDROCK_MODEL_ID is not configured");
  }
  if (INFERENCE_PROFILE_PREFIX.test(id)) {
    throw new Error(
      `BEDROCK_MODEL_ID must be a direct foundation model, not an inference profile: ${id}`
    );
  }
  return id;
}

/*
 * The Bedrock region is owned explicitly, never inherited from the Lambda's own
 * region: the API stack runs in `us-east-1` while the selected direct model is
 * only reachable in `eu-west-2`. An inherited region would send both CountTokens
 * and ConverseStream to a region where the model does not exist, which surfaces as
 * a generic validation failure rather than a configuration error.
 *
 * The shape is checked because a whitespace-padded or malformed value is accepted by
 * the SDK's client config and only fails at endpoint resolution, far from its cause.
 */
const AWS_REGION_SHAPE = /^[a-z]{2}(-[a-z]+)+-\d$/;

export function modelRegion(): string {
  const region = process.env.BEDROCK_REGION?.trim();
  if (!region) {
    throw new Error("BEDROCK_REGION is not configured");
  }
  if (!AWS_REGION_SHAPE.test(region)) {
    throw new Error(`BEDROCK_REGION is not a valid AWS region: ${region}`);
  }
  return region;
}

let runtimeClient: BedrockRuntimeClient | undefined;

/* One client for both commands, so CountTokens and ConverseStream can never drift
 * onto different regions. */
function getRuntimeClient(): BedrockRuntimeClient {
  if (!runtimeClient) {
    runtimeClient = new BedrockRuntimeClient({ region: modelRegion() });
  }
  return runtimeClient;
}

export function setRuntimeClientForTesting(
  client: BedrockRuntimeClient | undefined
): void {
  runtimeClient = client;
}

export function createBedrockPort(): BedrockPort {
  return {
    async countInputTokens({ system, messages, abortSignal }) {
      const response = await getRuntimeClient().send(
        new CountTokensCommand({
          modelId: modelId(),
          input: {
            converse: {
              system: toConverseSystem(system),
              messages: toConverseMessages(messages),
            },
          },
        }),
        { abortSignal }
      );

      const inputTokens = response.inputTokens;
      if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens)) {
        throw new Error("CountTokens returned no input token count");
      }
      return inputTokens;
    },

    converseStream({ system, messages, maxOutputTokens, abortSignal }) {
      return streamConverse({ system, messages, maxOutputTokens, abortSignal });
    },
  };
}

async function* streamConverse(
  args: ConverseStreamArgs
): AsyncGenerator<BedrockStreamEvent> {
  const { system, messages, maxOutputTokens, abortSignal } = args;

  const response = await getRuntimeClient().send(
    new ConverseStreamCommand({
      modelId: modelId(),
      system: toConverseSystem(system),
      messages: toConverseMessages(messages),
      // Output ceilings are enforced by the Converse call itself, never by the
      // client, and a max_tokens stop is reported explicitly in the end frame.
      inferenceConfig: { maxTokens: maxOutputTokens },
    }),
    { abortSignal }
  );

  const stream = response.stream;
  if (!stream) {
    throw new Error("ConverseStream returned no event stream");
  }

  yield* normalizeConverseStream(stream);
}

/* Exported so the handler's specs can drive the exact AWS event shapes without a
 * live Bedrock call. The parameter is `unknown` because the SDK's own
 * ConverseStreamOutput union members carry `never`-typed sibling keys that no
 * structural type can describe; narrowing here is the honest boundary. */
export async function* normalizeConverseStream(
  stream: AsyncIterable<unknown>
): AsyncGenerator<BedrockStreamEvent> {
  for await (const event of stream) {
    for (const [field, message] of STREAM_EXCEPTIONS) {
      if (fieldOf(event, field) !== undefined) {
        throw new Error(message);
      }
    }

    if (fieldOf(event, "messageStart") !== undefined) {
      yield { kind: "message_start" };
      continue;
    }

    const contentBlockDelta = fieldOf(event, "contentBlockDelta");
    if (contentBlockDelta !== undefined) {
      const text = fieldOf(fieldOf(contentBlockDelta, "delta"), "text");
      // Tool-use and reasoning deltas carry no text: the desktop owns tool calls,
      // so anything that is not text is not part of this wire contract.
      if (typeof text === "string" && text.length > 0) {
        yield { kind: "delta", text };
      }
      continue;
    }

    const messageStop = fieldOf(event, "messageStop");
    if (messageStop !== undefined) {
      const stopReason = fieldOf(messageStop, "stopReason");
      yield {
        kind: "stop",
        stopReason: normalizeStopReason(
          typeof stopReason === "string" ? stopReason : undefined
        ),
      };
      continue;
    }

    const metadata = fieldOf(event, "metadata");
    if (metadata !== undefined) {
      const usage = fieldOf(metadata, "usage");
      yield {
        kind: "usage",
        inputTokens: finiteOrZero(fieldOf(usage, "inputTokens")),
        outputTokens: finiteOrZero(fieldOf(usage, "outputTokens")),
      };
    }
  }
}

const STREAM_EXCEPTIONS: readonly (readonly [string, string])[] = [
  ["internalServerException", "Bedrock internal server exception"],
  ["modelStreamErrorException", "Bedrock model stream error"],
  ["validationException", "Bedrock validation exception"],
  ["throttlingException", "Bedrock throttling exception"],
  ["serviceUnavailableException", "Bedrock service unavailable"],
];

function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[name];
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
