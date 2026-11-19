import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/*
 * In-memory stand-in for the DynamoDB document client. Unlike a pure command
 * recorder it actually stores items and evaluates the condition expressions this
 * service builds, because the behaviour under test IS the concurrency contract:
 * a failed condition must be a conflict carrying the stored version, a replayed
 * event must be a no-op, and an older event must never win. It also keeps every
 * item under its real `pk`/`sk`, so cross-account isolation is a property of the
 * store rather than of the assertion.
 *
 * Any expression the service does not build throws rather than being guessed at,
 * which is what keeps the fake from quietly accepting a condition DynamoDB would
 * reject.
 */

export type CapturedCommandKind = "Get" | "Put" | "Query" | "Transact" | "Unknown";

export interface CapturedCommand {
  readonly kind: CapturedCommandKind;
  readonly input: Record<string, unknown>;
}

interface AttributeValue {
  readonly S?: string;
  readonly N?: string;
  readonly NULL?: boolean;
}

export class ConditionalCheckFailed extends Error {
  readonly Item?: Record<string, AttributeValue>;

  constructor(item?: Record<string, AttributeValue>) {
    super("The conditional request failed");
    this.name = "ConditionalCheckFailedException";
    this.Item = item;
  }
}

export interface CancellationReason {
  readonly Code?: string;
  readonly Item?: Record<string, AttributeValue>;
}

export class TransactionCanceled extends Error {
  readonly CancellationReasons: CancellationReason[];

  constructor(reasons: CancellationReason[]) {
    super("Transaction cancelled");
    this.name = "TransactionCanceledException";
    this.CancellationReasons = reasons;
  }
}

export function throttlingError(): Error {
  const error = new Error("Throughput exceeded");
  error.name = "ProvisionedThroughputExceededException";
  return error;
}

/** Mirrors how the real service returns ALL_OLD: raw attribute values, not documents. */
function marshall(
  item: Record<string, unknown>,
): Record<string, AttributeValue> {
  const marshalled: Record<string, AttributeValue> = {};
  for (const [name, value] of Object.entries(item)) {
    if (typeof value === "string") marshalled[name] = { S: value };
    else if (typeof value === "number") marshalled[name] = { N: String(value) };
    else marshalled[name] = { NULL: true };
  }
  return marshalled;
}

function keyOf(key: { pk: unknown; sk: unknown }): string {
  return `${String(key.pk)}|${String(key.sk)}`;
}

const NO_ITEM_CONDITION = "attribute_not_exists(pk)";
const VERSION_CONDITION = "#v = :expected";
const VERSION_AND_WATERMARK_CONDITION =
  "#v = :expected AND (attribute_not_exists(#w) OR #w < :watermark)";
/** AD-18's checkout lock: acquirable when absent or lapsed (src/lib/table.ts). */
const CHECKOUT_LOCK_ACQUIRE_CONDITION =
  "attribute_not_exists(pk) OR attribute_not_exists(#l) OR #l <= :now";

interface WriteRequest {
  readonly Item: Record<string, unknown>;
  readonly ConditionExpression?: string;
  readonly ExpressionAttributeValues?: Record<string, unknown>;
  readonly ReturnValuesOnConditionCheckFailure?: string;
}

export class FakeDynamo {
  readonly sent: CapturedCommand[] = [];
  private readonly items = new Map<string, Record<string, unknown>>();
  private readonly errors: Error[] = [];
  private queryResult: Record<string, unknown>[] = [];

  seed(item: Record<string, unknown>): this {
    this.items.set(
      keyOf(item as { pk: unknown; sk: unknown }),
      structuredClone(item),
    );
    return this;
  }

  stored(pk: string, sk: string): Record<string, unknown> | undefined {
    return this.items.get(`${pk}|${sk}`);
  }

  get itemCount(): number {
    return this.items.size;
  }

  queueError(error: Error): this {
    this.errors.push(error);
    return this;
  }

  /** The GSI is KEYS_ONLY, so a seeded query answer is a list of keys. */
  seedQueryResult(items: Record<string, unknown>[]): this {
    this.queryResult = items;
    return this;
  }

  get gets(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Get");
  }

  get puts(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Put");
  }

  get transactions(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Transact");
  }

  get queries(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Query");
  }

  async send(command: {
    input: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const { input } = command;
    const kind: CapturedCommandKind =
      "TransactItems" in input
        ? "Transact"
        : "Item" in input
          ? "Put"
          : "KeyConditionExpression" in input
            ? "Query"
            : "Key" in input
              ? "Get"
              : "Unknown";
    this.sent.push({ kind, input });

    const queued = this.errors.shift();
    if (queued) throw queued;

    if (kind === "Get") return this.get(input);
    if (kind === "Put") return this.put(input as unknown as WriteRequest);
    if (kind === "Query") return { Items: structuredClone(this.queryResult) };
    if (kind === "Transact") return this.transact(input);
    throw new Error("FakeDynamo received an unsupported command");
  }

  private get(input: Record<string, unknown>): Record<string, unknown> {
    const key = input.Key as { pk: string; sk: string };
    const item = this.items.get(keyOf(key));
    if (!item) return {};

    if (input.ProjectionExpression === "#v") {
      const projected =
        item.version === undefined ? {} : { version: item.version };
      return { Item: projected };
    }
    return { Item: structuredClone(item) };
  }

  /** `undefined` when the condition held, the stored item when it did not. */
  private evaluate(request: WriteRequest): {
    readonly satisfied: boolean;
    readonly existing: Record<string, unknown> | undefined;
  } {
    const existing = this.items.get(
      keyOf(request.Item as { pk: unknown; sk: unknown }),
    );
    const condition = request.ConditionExpression;
    const values = request.ExpressionAttributeValues ?? {};

    if (condition === NO_ITEM_CONDITION) {
      return { satisfied: existing === undefined, existing };
    }
    if (condition === VERSION_CONDITION) {
      return {
        satisfied: existing !== undefined && existing.version === values[":expected"],
        existing,
      };
    }
    if (condition === VERSION_AND_WATERMARK_CONDITION) {
      const storedWatermark = existing?.event_watermark;
      const watermarkAdvances =
        storedWatermark === undefined ||
        (typeof storedWatermark === "number" &&
          storedWatermark < Number(values[":watermark"]));
      return {
        satisfied:
          existing !== undefined &&
          existing.version === values[":expected"] &&
          watermarkAdvances,
        existing,
      };
    }
    if (condition === CHECKOUT_LOCK_ACQUIRE_CONDITION) {
      const storedLock = existing?.checkout_lock;
      return {
        satisfied:
          existing === undefined ||
          storedLock === undefined ||
          (typeof storedLock === "number" &&
            storedLock <= Number(values[":now"])),
        existing,
      };
    }
    throw new Error(`unexpected condition: ${String(condition)}`);
  }

  private put(request: WriteRequest): Record<string, unknown> {
    const { satisfied, existing } = this.evaluate(request);

    if (!satisfied) {
      throw new ConditionalCheckFailed(
        request.ReturnValuesOnConditionCheckFailure === "ALL_OLD" && existing
          ? marshall(existing)
          : undefined,
      );
    }

    this.items.set(
      keyOf(request.Item as { pk: unknown; sk: unknown }),
      structuredClone(request.Item),
    );
    return {};
  }

  /**
   * All-or-nothing, and the reasons are returned POSITIONALLY - which is the
   * property src/lib/table.ts's named index constants depend on.
   */
  private transact(input: Record<string, unknown>): Record<string, unknown> {
    const requests = (input.TransactItems as { Put: WriteRequest }[]).map(
      (entry) => entry.Put,
    );

    const outcomes = requests.map((request) => this.evaluate(request));

    if (outcomes.some((outcome) => !outcome.satisfied)) {
      throw new TransactionCanceled(
        outcomes.map((outcome, index) =>
          outcome.satisfied
            ? { Code: "None" }
            : {
                Code: "ConditionalCheckFailed",
                Item:
                  requests[index]?.ReturnValuesOnConditionCheckFailure ===
                    "ALL_OLD" && outcome.existing
                    ? marshall(outcome.existing)
                    : undefined,
              },
        ),
      );
    }

    for (const request of requests) {
      this.items.set(
        keyOf(request.Item as { pk: unknown; sk: unknown }),
        structuredClone(request.Item),
      );
    }
    return {};
  }

  asDocumentClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}
