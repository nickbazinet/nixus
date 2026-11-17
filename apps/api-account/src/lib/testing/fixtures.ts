import type { APIGatewayProxyEvent } from "aws-lambda";

/*
 * Request and image builders shared by the route specs. The images are
 * hand-assembled headers rather than real encodes: the server reads dimensions
 * from the container header and never decodes, so a header is the whole of what
 * the contract inspects.
 */

export const SUB_A = "11111111-2222-4333-8444-555555555555";
export const SUB_B = "99999999-8888-4777-8666-555555555555";

export function pngBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
}

export function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  bytes.writeUInt16BE(17, 4);
  bytes.writeUInt8(8, 6);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return new Uint8Array(bytes);
}

export function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function apiEvent(args: {
  readonly route: string;
  readonly method: string;
  readonly sub?: string;
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly requestId?: string;
}): APIGatewayProxyEvent {
  const body =
    args.rawBody ??
    (args.body === undefined ? null : JSON.stringify(args.body));

  return {
    resource: args.route,
    path: args.route,
    httpMethod: args.method,
    body,
    isBase64Encoded: false,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: args.requestId ?? "req-test",
      authorizer:
        args.sub === undefined ? null : { claims: { sub: args.sub } },
    },
  } as unknown as APIGatewayProxyEvent;
}
