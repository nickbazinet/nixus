import { sendJson, startFake, type RunningFake } from "./fake";

/**
 * Minimal DynamoDB-protocol fake for the session table.
 *
 * It exists so the E2E exercises the REAL `dynamo-store.ts` — the AWS SDK client,
 * the conditional delete the single-use pre-auth record depends on, the guarded
 * update the idle extension depends on — rather than an in-memory substitute
 * swapped in by an environment variable. The SDK points here through
 * `AWS_ENDPOINT_URL_DYNAMODB`, so no production code knows this exists.
 *
 * It implements exactly the four operations and the two update expressions this
 * app issues; anything else is an explicit failure rather than a silent pass.
 */

type AttributeValue = Record<string, unknown>;
type Item = Record<string, AttributeValue>;

interface Target {
  readonly operation: string;
}

function target(headers: Record<string, string | string[] | undefined>): Target {
  const raw = headers["x-amz-target"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return { operation: (value ?? "").split(".").pop() ?? "" };
}

function keyOf(key: Item): string {
  const id = key.id?.S;
  if (typeof id !== "string") throw new Error("the session table is keyed by a string `id`");
  return id;
}

function conditionHolds(condition: string | undefined, item: Item | undefined): boolean {
  if (condition === undefined) return true;
  if (condition === "attribute_exists(id)") return item !== undefined;
  if (condition === "attribute_exists(id) AND #type = :session") {
    return item?.type?.S === "session";
  }
  throw new Error(`unsupported ConditionExpression: ${condition}`);
}

/** Only `SET a = :x, b = :y` — the two shapes `dynamo-store.ts` issues. */
function applyUpdate(item: Item, expression: string, values: Item): Item {
  const match = /^SET\s+(.+)$/.exec(expression.trim());
  if (!match?.[1]) throw new Error(`unsupported UpdateExpression: ${expression}`);

  const updated = { ...item };
  for (const assignment of match[1].split(",")) {
    const [rawName, rawValue] = assignment.split("=").map((part) => part.trim());
    if (rawName === undefined || rawValue === undefined) {
      throw new Error(`unsupported assignment: ${assignment}`);
    }
    const placeholder = values[rawValue];
    if (placeholder === undefined) throw new Error(`unknown value ${rawValue}`);
    updated[rawName.replace(/^#/, "")] = placeholder;
  }
  return updated;
}

export interface RunningDynamo extends RunningFake {
  readonly items: Map<string, Item>;
}

export async function startDynamo(): Promise<RunningDynamo> {
  const items = new Map<string, Item>();

  const fake = await startFake("dynamodb", (request, response) => {
    const { operation } = target(request.headers);
    const payload = JSON.parse(request.body || "{}") as {
      Key?: Item;
      Item?: Item;
      ConditionExpression?: string;
      UpdateExpression?: string;
      ExpressionAttributeValues?: Item;
      ExpressionAttributeNames?: Record<string, string>;
      ReturnValues?: string;
    };

    const failCondition = (): true =>
      sendJson(response, 400, {
        __type: "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException",
        message: "The conditional request failed",
      });

    if (operation === "PutItem" && payload.Item) {
      items.set(keyOf(payload.Item), payload.Item);
      return sendJson(response, 200, {});
    }

    if (operation === "GetItem" && payload.Key) {
      const found = items.get(keyOf(payload.Key));
      return sendJson(response, 200, found ? { Item: found } : {});
    }

    if (operation === "DeleteItem" && payload.Key) {
      const id = keyOf(payload.Key);
      const existing = items.get(id);
      if (!conditionHolds(payload.ConditionExpression, existing)) return failCondition();
      items.delete(id);
      return sendJson(
        response,
        200,
        payload.ReturnValues === "ALL_OLD" && existing ? { Attributes: existing } : {},
      );
    }

    if (operation === "UpdateItem" && payload.Key && payload.UpdateExpression) {
      const id = keyOf(payload.Key);
      const existing = items.get(id);
      if (!conditionHolds(payload.ConditionExpression, existing)) return failCondition();
      items.set(
        id,
        applyUpdate(existing ?? {}, payload.UpdateExpression, payload.ExpressionAttributeValues ?? {}),
      );
      return sendJson(response, 200, {});
    }

    throw new Error(`unsupported DynamoDB operation: ${operation}`);
  });

  return { origin: fake.origin, close: fake.close, items };
}
