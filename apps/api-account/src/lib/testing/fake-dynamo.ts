import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/*
 * In-memory stand-in for the DynamoDB document client. Unlike a pure command
 * recorder it actually stores items and evaluates the two condition expressions
 * this service builds, because the behaviour under test is the optimistic
 * concurrency contract: a failed condition must be a conflict carrying the
 * stored version, never an overwrite. It also keeps every item under its real
 * `pk`/`sk`, so cross-account isolation is a property of the store rather than
 * of the assertion.
 */

export type CapturedCommandKind = "Get" | "Put" | "Unknown";

export interface CapturedCommand {
  readonly kind: CapturedCommandKind;
  readonly input: Record<string, unknown>;
}

interface AttributeValue {
  readonly S?: string;
  readonly N?: string;
  readonly B?: Uint8Array;
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

export function throttlingError(): Error {
  const error = new Error("Throughput exceeded");
  error.name = "ProvisionedThroughputExceededException";
  return error;
}

/** Mirrors how the real service returns ALL_OLD: raw attribute values, not documents. */
function marshall(
  item: Record<string, unknown>
): Record<string, AttributeValue> {
  const marshalled: Record<string, AttributeValue> = {};
  for (const [name, value] of Object.entries(item)) {
    if (typeof value === "string") marshalled[name] = { S: value };
    else if (typeof value === "number") marshalled[name] = { N: String(value) };
    else if (value instanceof Uint8Array) marshalled[name] = { B: value };
    else marshalled[name] = { NULL: true };
  }
  return marshalled;
}

function keyOf(key: { pk: unknown; sk: unknown }): string {
  return `${String(key.pk)}|${String(key.sk)}`;
}

export class FakeDynamo {
  readonly sent: CapturedCommand[] = [];
  private readonly items = new Map<string, Record<string, unknown>>();
  private readonly errors: Error[] = [];

  seed(item: Record<string, unknown>): this {
    this.items.set(
      keyOf(item as { pk: unknown; sk: unknown }),
      structuredClone(item)
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

  get gets(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Get");
  }

  get puts(): CapturedCommand[] {
    return this.sent.filter((command) => command.kind === "Put");
  }

  async send(command: {
    input: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const { input } = command;
    const kind: CapturedCommandKind =
      "Item" in input ? "Put" : "Key" in input ? "Get" : "Unknown";
    this.sent.push({ kind, input });

    const queued = this.errors.shift();
    if (queued) throw queued;

    if (kind === "Get") return this.get(input);
    if (kind === "Put") return this.put(input);
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

  private put(input: Record<string, unknown>): Record<string, unknown> {
    const item = input.Item as Record<string, unknown>;
    const storageKey = keyOf(item as { pk: unknown; sk: unknown });
    const existing = this.items.get(storageKey);
    const condition = input.ConditionExpression as string | undefined;
    const returnValues = input.ReturnValuesOnConditionCheckFailure;

    const expected = (
      input.ExpressionAttributeValues as Record<string, unknown> | undefined
    )?.[":expected"];

    const satisfied =
      condition === "attribute_not_exists(pk)"
        ? existing === undefined
        : condition === "#v = :expected"
          ? existing !== undefined && existing.version === expected
          : (() => {
              throw new Error(`unexpected condition: ${String(condition)}`);
            })();

    if (!satisfied) {
      throw new ConditionalCheckFailed(
        returnValues === "ALL_OLD" && existing ? marshall(existing) : undefined
      );
    }

    this.items.set(storageKey, structuredClone(item));
    return {};
  }

  asDocumentClient(): DynamoDBDocumentClient {
    return this as unknown as DynamoDBDocumentClient;
  }
}
