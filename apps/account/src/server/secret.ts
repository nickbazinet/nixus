/**
 * The confidential client's secret (AD-10).
 *
 * Read ONCE at cold start from SSM Parameter Store with decryption, held in
 * module scope, and never placed in an environment variable, a CloudFormation
 * output, an error message or a log line. The owner creates the `SecureString`
 * by hand after the first deploy; the pipeline never writes it.
 */

import { log } from "./log.ts";

export type SecretReader = () => Promise<string>;

let pending: Promise<string> | null = null;

async function fetchFromSsm(parameterName: string, region: string): Promise<string> {
  const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
  const client = new SSMClient({ region });
  const result = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (value === undefined || value === "") {
    // The parameter name is configuration, not a secret; the value is never named.
    throw new Error("The web client secret parameter is empty or absent");
  }
  log("info", { route: "cold-start", code: "client_secret_loaded" });
  return value;
}

/**
 * Memoized on the PROMISE, not on the resolved value: two concurrent first
 * requests on one cold container would otherwise each issue a `GetParameter`.
 */
export function clientSecret(parameterName: string, region: string): Promise<string> {
  pending ??= fetchFromSsm(parameterName, region).catch((error: unknown) => {
    // A failed read must not be memoized, or one throttled call would poison the
    // container for its whole lifetime.
    pending = null;
    throw error;
  });
  return pending;
}

/** Test seam. Never called by runtime code. */
export function __setClientSecretForTests(value: string | null): void {
  pending = value === null ? null : Promise.resolve(value);
}
