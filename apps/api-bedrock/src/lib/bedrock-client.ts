import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
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

export interface ConverseStreamArgs {
  readonly system: string;
  readonly messages: readonly PreparedMessage[];
  readonly maxOutputTokens: number;
  readonly abortSignal?: AbortSignal;
}

export interface BedrockPort {
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

export function modelId(): string {
  const id = process.env.BEDROCK_MODEL_ID;
  if (!id) {
    throw new Error("BEDROCK_MODEL_ID is not configured");
  }
  return id;
}

let runtimeClient: BedrockRuntimeClient | undefined;

/* No explicit region: the model is a us-east-1 cross-region inference profile and the
 * Lambda runs in us-east-1, so the SDK's own resolution is correct and one less thing
 * can disagree with the stack. */
function getRuntimeClient(): BedrockRuntimeClient {
  if (!runtimeClient) {
    runtimeClient = new BedrockRuntimeClient({});
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
