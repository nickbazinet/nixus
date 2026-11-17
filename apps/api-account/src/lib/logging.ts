import type { AccountErrorCode } from "@nixus/shared";

/*
 * The only logging transport of this service (AD-12). The field set is an
 * allow-list, not a convention: `sub`, route, method, status, latency, error code
 * and byte sizes are the whole of it. A profile field value, an avatar byte, a
 * base64 string, a token or a header never reaches a log line, which is why this
 * module takes a typed record and never an arbitrary object.
 */

export interface RequestLogFields {
  readonly request_id: string;
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly latency_ms: number;
  readonly request_bytes: number;
  readonly response_bytes: number;
  /** Absent until the authorizer's claim has been accepted. */
  readonly sub?: string;
  readonly code?: AccountErrorCode;
}

export function logRequest(fields: RequestLogFields): void {
  const line = {
    event: "account_request",
    request_id: fields.request_id,
    sub: fields.sub ?? null,
    route: fields.route,
    method: fields.method,
    status: fields.status,
    latency_ms: fields.latency_ms,
    request_bytes: fields.request_bytes,
    response_bytes: fields.response_bytes,
    code: fields.code ?? null,
  };

  if (fields.status >= 500) {
    console.error(JSON.stringify(line));
    return;
  }
  console.log(JSON.stringify(line));
}

/**
 * A throw that escaped the router's own classification. Only the error's class
 * name is recorded: an exception message can carry a key, an attribute value, or
 * a fragment of the submitted body.
 */
export function logUnhandled(requestId: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event: "account_unhandled_error",
      request_id: requestId,
      error_name: error instanceof Error ? error.name : "unknown",
    })
  );
}
