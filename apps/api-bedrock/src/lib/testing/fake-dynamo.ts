import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/*
 * In-memory stand-in for the DynamoDB document client. The specs assert on the
 * exact command inputs the service builds - condition expressions, update
 * expressions, and ClientRequestToken values are the quota contract, so they are
 * verified structurally rather than through a live table.
 */

export type CapturedCommandKind = "Get" | "TransactWrite" | "Unknown";

export interface CapturedCommand {
  readonly kind: CapturedCommandKind;
  readonly input: Record<string, unknown>;
}

type QueuedResponse =
  | { readonly ok: Record<string, unknown> }
  | { readonly err: Error };

/* Command classes are detected by input shape rather than constructor name so a
 * minified or re-exported SDK build cannot silently reclassify a command. */
function classify(input: Record<string, unknown>): CapturedCommandKind {
  if ("TransactItems" in input) return "TransactWrite";
  if ("Key" in input) return "Get";
  return "Unknown";
}

export class FakeDocumentClient {
  readonly sent: CapturedCommand[] = [];
  private readonly queued: QueuedResponse[] = [];

  queueItem(item: Record<string, unknown> | undefined): this {
    this.queued.push({ ok: item ? { Item: item } : {} });
    return this;
  }

  queueOk(response: Record<string, unknown> = {}): this {
    this.queued.push({ ok: response });
    return this;
  }

  queueError(error: Error): this {
    this.queued.push({ err: error });
    return this;
  }

  get gets(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Get");
  }

  get transactions(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "TransactWrite");
  }

  async send(command: {
    input: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    this.sent.push({ kind: classify(command.input), input: command.input });

    const next = this.queued.shift();
    if (!next) {
      throw new Error(
        `FakeDocumentClient received an unexpected call #${this.sent.length}`
      );
    }
    if ("err" in next) throw next.err;
    return next.ok;
  }

  asDocumentClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}

/** Mirrors a DynamoDB `TransactionCanceledException` closely enough for the reserve/refund paths. */
export function transactionCanceled(
  ...reasons: (string | undefined)[]
): Error & { name: string; CancellationReasons: { Code?: string }[] } {
  const error = new Error("Transaction cancelled") as Error & {
    name: string;
    CancellationReasons: { Code?: string }[];
  };
  error.name = "TransactionCanceledException";
  error.CancellationReasons = reasons.map((code) =>
    code ? { Code: code } : {}
  );
  return error;
}
