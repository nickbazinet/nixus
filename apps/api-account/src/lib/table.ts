import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { VersionedResource } from "@nixus/shared";

import { fail, failConflict } from "./errors.ts";

/*
 * DynamoDB boundary for the profile table (AD-4). Key composition lives here and
 * nowhere else, so no handler spells `USER#` or a sort key itself, and the only
 * two sort keys this service can reach are the two literals below - `ENTITLEMENT`
 * and `BILLING_CUSTOMER` are reserved for the billing spine and are unreachable
 * from this module by construction.
 */

export const PROFILE_SORT_KEY = "PROFILE";
export const AVATAR_SORT_KEY = "AVATAR";

export const VERSION_ATTRIBUTE = "version";

/**
 * The claim must look like a Cognito `sub` before it becomes half of a partition
 * key (AD-3). A claim of any other shape is not a user this service has storage
 * for, so it is refused before a key exists at all.
 *
 * The 8-4-4-4-12 hex SHAPE only, deliberately not RFC 4122 version/variant bits:
 * this pool issues subs such as `…-7055-4c26-…`, whose variant nibble is outside
 * `[89ab]`, so a stricter pattern refuses every real user.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function userPartitionKey(sub: string): string {
  if (!isUuidShaped(sub)) {
    // Not a validation error: the identity itself is unusable, and the value is
    // never echoed (AD-12).
    fail("unauthorized");
  }
  return `USER#${sub}`;
}

export interface TableKey {
  readonly pk: string;
  readonly sk: string;
}

export function profileKey(sub: string): TableKey {
  return { pk: userPartitionKey(sub), sk: PROFILE_SORT_KEY };
}

export function avatarKey(sub: string): TableKey {
  return { pk: userPartitionKey(sub), sk: AVATAR_SORT_KEY };
}

export function tableName(): string {
  const name = process.env.PROFILE_TABLE_NAME;
  if (!name) {
    throw new Error("PROFILE_TABLE_NAME is not configured");
  }
  return name;
}

let documentClient: DynamoDBDocumentClient | undefined;

export function getDocumentClient(): DynamoDBDocumentClient {
  if (!documentClient) {
    documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return documentClient;
}

/** Test seam: lets a spec inject a stubbed document client without a network stack. */
export function setDocumentClientForTesting(
  client: DynamoDBDocumentClient | undefined
): void {
  documentClient = client;
}

export async function getItem(
  key: TableKey,
  projection?: { readonly expression: string; readonly names: Record<string, string> }
): Promise<Record<string, unknown> | undefined> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: key,
      // A client that just wrote and immediately re-reads must not see the
      // pre-write item: the version it carries is what its next write is
      // conditional on.
      ConsistentRead: true,
      ProjectionExpression: projection?.expression,
      ExpressionAttributeNames: projection?.names,
    })
  );
  return result.Item;
}

/**
 * `version` is a DynamoDB reserved word, so every expression that names it goes
 * through this alias.
 */
const VERSION_NAMES = { "#v": VERSION_ATTRIBUTE } as const;

export const VERSION_PROJECTION = {
  expression: "#v",
  names: VERSION_NAMES as Record<string, string>,
} as const;

interface ConditionFailure {
  readonly name?: string;
  readonly Item?: Record<string, { readonly N?: string }>;
}

/**
 * The failed condition's own item, read back through
 * `ReturnValuesOnConditionCheckFailure: ALL_OLD`, so a conflict carries the
 * current version without a second read (AD-4). The document client does not
 * unmarshall an exception's `Item`, so this reads the raw attribute value.
 */
export function currentVersionFromConditionFailure(
  error: unknown
): number | null {
  const failure = error as ConditionFailure | null;
  const raw = failure?.Item?.[VERSION_ATTRIBUTE]?.N;
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof Error && error.name === "ConditionalCheckFailedException"
  );
}

/**
 * The single write path (AD-4). `expectedVersion: null` is create-only and
 * conditional on `attribute_not_exists(pk)`; a number is conditional on the
 * stored `version` being exactly that. A failed condition is always a
 * `version_conflict` and never an overwrite, and profile and avatar are separate
 * calls because they are never written in one operation.
 */
export async function putVersionedItem(args: {
  readonly item: Record<string, unknown>;
  readonly expectedVersion: number | null;
  readonly resource: VersionedResource;
}): Promise<void> {
  const { item, expectedVersion, resource } = args;

  const condition =
    expectedVersion === null
      ? { ConditionExpression: "attribute_not_exists(pk)" }
      : {
          ConditionExpression: "#v = :expected",
          ExpressionAttributeNames: { ...VERSION_NAMES },
          ExpressionAttributeValues: { ":expected": expectedVersion },
        };

  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName(),
        Item: item,
        ...condition,
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      })
    );
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      failConflict(resource, currentVersionFromConditionFailure(error));
    }
    throw error;
  }
}
