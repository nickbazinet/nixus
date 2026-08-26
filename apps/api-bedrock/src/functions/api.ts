import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import type { Writable } from "node:stream";

import type { CloudAiErrorResponse } from "@nixus/shared";

import { createBedrockPort } from "../lib/bedrock-client.ts";
import { periodKeyFor } from "../lib/table.ts";
import type { PreOutputFailure } from "../lib/validation.ts";
import { handleStatus } from "../handlers/status.ts";
import {
  JSON_CONTENT_TYPE,
  canonicalErrorBody,
  handleInvoke,
  type ResponseSink,
} from "../handlers/invoke.ts";

/*
 * The sole Lambda entry point (AD-4). Both routes are served from here; there is
 * never a Lambda per route or per operation. `invoke` dispatches on the closed
 * operation enum inside handlers/invoke.ts.
 */

/**
 * API Gateway's response-streaming contract: the metadata JSON, then exactly this
 * many NUL bytes, then the body. A missing or malformed prelude is a 500, not a
 * silently broken stream (AD-7).
 */
export const PRELUDE_NUL_BYTE_COUNT = 8;

const PRELUDE_SEPARATOR = Buffer.alloc(PRELUDE_NUL_BYTE_COUNT, 0);

export function encodePreludeMetadata(
  status: number,
  contentType: string
): string {
  return JSON.stringify({
    statusCode: status,
    headers: { "Content-Type": contentType },
  });
}

const UNAUTHORIZED: PreOutputFailure = {
  code: "unauthorized",
  status: 401,
  message: "Authentication required.",
};

const UNKNOWN_ROUTE: PreOutputFailure = {
  code: "validation",
  status: 400,
  message: "Unknown route.",
};

const INTERNAL: PreOutputFailure = {
  code: "hosted_unavailable",
  status: 500,
  message: "Hosted AI failed to produce a response.",
};

/** Minimal surface of a Node writable the sink needs, so specs can supply a buffer. */
export interface ByteSink {
  write(chunk: Uint8Array | string): unknown;
  end(callback?: () => void): unknown;
}

export function createResponseSink(stream: ByteSink): ResponseSink {
  let begun = false;
  let ended = false;

  const begin = (status: number, contentType: string): void => {
    if (begun) {
      throw new Error("streaming prelude was already written");
    }
    begun = true;
    stream.write(encodePreludeMetadata(status, contentType));
    stream.write(PRELUDE_SEPARATOR);
  };

  return {
    begin,
    write(chunk) {
      if (!begun) {
        throw new Error("cannot write a body before the streaming prelude");
      }
      stream.write(chunk);
    },
    async end() {
      if (ended) return;
      ended = true;
      if (!begun) {
        // Nothing ever committed a status. Emitting a valid 500 prelude keeps the
        // response well-formed instead of closing a bodiless, statusless stream.
        begin(INTERNAL.status, JSON_CONTENT_TYPE);
        stream.write(JSON.stringify(canonicalErrorBody(INTERNAL, "unknown")));
      }
      await new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
    },
  };
}

function subFromAuthorizer(event: APIGatewayProxyEvent): string | undefined {
  // Derived exclusively from the authorizer-verified context. A body-supplied
  // identifier is never consulted (AD-3).
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, unknown>
    | undefined;
  const sub = claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : undefined;
}

function decodeBody(event: APIGatewayProxyEvent): string | undefined {
  if (event.body === null || event.body === undefined) return undefined;
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

function writeJson(
  sink: ResponseSink,
  status: number,
  payload: unknown
): void {
  sink.begin(status, JSON_CONTENT_TYPE);
  sink.write(JSON.stringify(payload));
}

function writeFailure(
  sink: ResponseSink,
  failure: PreOutputFailure,
  requestId: string
): void {
  const body: CloudAiErrorResponse = canonicalErrorBody(failure, requestId);
  writeJson(sink, failure.status, body);
}

export async function dispatch(
  event: APIGatewayProxyEvent,
  sink: ResponseSink,
  context: Pick<Context, "getRemainingTimeInMillis">
): Promise<void> {
  const requestId = event.requestContext.requestId;
  // Computed once at request start and threaded through every quota call (AD-5).
  const periodKey = periodKeyFor(new Date());

  const sub = subFromAuthorizer(event);
  if (!sub) {
    console.error(
      JSON.stringify({
        event: "request_rejected",
        request_id: requestId,
        status: 401,
        code: "unauthorized",
      })
    );
    writeFailure(sink, UNAUTHORIZED, requestId);
    await sink.end();
    return;
  }

  const method = event.httpMethod.toUpperCase();
  const path = event.resource || event.path;

  if (method === "GET" && path === "/v1/ai/status") {
    const status = await handleStatus({ sub, periodKey });
    writeJson(sink, 200, status);
    console.log(
      JSON.stringify({
        event: "status_read",
        request_id: requestId,
        sub,
        status: 200,
        premium: status.premium,
      })
    );
    await sink.end();
    return;
  }

  if (method === "POST" && path === "/v1/ai/invoke") {
    await handleInvoke(
      {
        sub,
        requestId,
        periodKey,
        headers: event.headers as Record<string, string | undefined> | undefined,
        body: decodeBody(event),
      },
      {
        bedrock: createBedrockPort(),
        now: () => new Date(),
        remainingTimeMillis: () => context.getRemainingTimeInMillis(),
      },
      sink
    );
    return;
  }

  console.error(
    JSON.stringify({
      event: "request_rejected",
      request_id: requestId,
      status: UNKNOWN_ROUTE.status,
      code: UNKNOWN_ROUTE.code,
      method,
    })
  );
  writeFailure(sink, UNKNOWN_ROUTE, requestId);
  await sink.end();
}

export async function streamingHandler(
  event: APIGatewayProxyEvent,
  responseStream: Writable,
  context: Context
): Promise<void> {
  const sink = createResponseSink(responseStream);
  try {
    await dispatch(event, sink, context);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        request_id: event.requestContext.requestId,
        status: 500,
        error_name: error instanceof Error ? error.name : "unknown",
      })
    );
  } finally {
    // Guarantees a well-formed prelude even if a handler threw before committing.
    await sink.end();
  }
}

/*
 * The guard checks for the FUNCTION, not for the `awslambda` global: importing
 * @aws-sdk/client-bedrock-runtime already defines `globalThis.awslambda` as an
 * empty object, so a `typeof awslambda === "undefined"` check passes outside
 * Lambda and then throws on the missing method. Only the real Lambda runtime
 * supplies `streamifyResponse`.
 */
const streamifyResponse = (
  globalThis as {
    awslambda?: { streamifyResponse?: typeof awslambda.streamifyResponse };
  }
).awslambda?.streamifyResponse;

export const handler =
  typeof streamifyResponse === "function"
    ? streamifyResponse(streamingHandler)
    : streamingHandler;
