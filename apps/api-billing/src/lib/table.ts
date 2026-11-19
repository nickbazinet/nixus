import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { BillingVersionedResource } from "@nixus/shared";

import { fail, failConflict } from "./errors.ts";

/*
 * THE storage boundary for the billing table (AD-4). Key composition lives here
 * and nowhere else: no handler spells `USER#`, `ENTITLEMENT`, `BILLING_CUSTOMER`
 * or `EVENT#` itself, and src/iam-isolation.test.ts asserts that this is the only
 * runtime module that does.
 */

export const ENTITLEMENT_SORT_KEY = "ENTITLEMENT";
export const BILLING_CUSTOMER_SORT_KEY = "BILLING_CUSTOMER";
const EVENT_SORT_KEY_PREFIX = "EVENT#";
const USER_PARTITION_KEY_PREFIX = "USER#";

export const VERSION_ATTRIBUTE = "version";
/** Strictly advancing, so an out-of-order Stripe event cannot downgrade (AD-5). */
export const EVENT_WATERMARK_ATTRIBUTE = "event_watermark";
/** The table's TTL attribute, carried by the EVENT# dedupe markers only. */
export const EXPIRES_AT_ATTRIBUTE = "expires_at";

/**
 * The claim must look like a Cognito `sub` before it becomes half of a partition
 * key (AD-3). A claim of any other shape is not an account this service has
 * storage for, so it is refused before a key exists at all.
 *
 * The 8-4-4-4-12 hex SHAPE only, deliberately not RFC 4122 version/variant bits:
 * this pool issues subs such as `…-7055-4c26-…`, whose variant nibble is outside
 * `[89ab]`, so a stricter pattern refuses every real user. Copied verbatim from
 * apps/api-account/src/lib/table.ts, which authorizes against the same pool.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function userPartitionKey(sub: string): string {
  if (!isUuidShaped(sub)) {
    // Not a validation error: the identity itself is unusable, and the value is
    // never echoed (AD-14).
    fail("unauthorized");
  }
  return `${USER_PARTITION_KEY_PREFIX}${sub}`;
}

/**
 * A Stripe event id is opaque (`evt_…`) and arrives from a request body, so it is
 * shape-checked before it becomes half of a sort key. The id itself is loggable
 * (AD-14 lists it) but it is never interpolated unvalidated.
 */
const STRIPE_EVENT_ID_PATTERN = /^[A-Za-z0-9_]{1,128}$/;

export function eventSortKey(eventId: string): string {
  if (!STRIPE_EVENT_ID_PATTERN.test(eventId)) {
    fail("unavailable");
  }
  return `${EVENT_SORT_KEY_PREFIX}${eventId}`;
}

export interface TableKey {
  readonly pk: string;
  readonly sk: string;
}

export function entitlementKey(sub: string): TableKey {
  return { pk: userPartitionKey(sub), sk: ENTITLEMENT_SORT_KEY };
}

export function billingCustomerKey(sub: string): TableKey {
  return { pk: userPartitionKey(sub), sk: BILLING_CUSTOMER_SORT_KEY };
}

export function eventMarkerKey(sub: string, eventId: string): TableKey {
  return { pk: userPartitionKey(sub), sk: eventSortKey(eventId) };
}

export function tableName(): string {
  const name = process.env.BILLING_TABLE_NAME;
  if (!name) {
    throw new Error("BILLING_TABLE_NAME is not configured");
  }
  return name;
}

export function customerIndexName(): string {
  const name = process.env.BILLING_TABLE_CUSTOMER_INDEX_NAME;
  if (!name) {
    throw new Error("BILLING_TABLE_CUSTOMER_INDEX_NAME is not configured");
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
  client: DynamoDBDocumentClient | undefined,
): void {
  documentClient = client;
}

export async function getItem(
  key: TableKey,
  projection?: {
    readonly expression: string;
    readonly names: Record<string, string>;
  },
): Promise<Record<string, unknown> | undefined> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: key,
      // A webhook that just wrote and a read path that immediately re-reads must
      // not see the pre-write item: the version it carries is what the next
      // conditional write depends on.
      ConsistentRead: true,
      ProjectionExpression: projection?.expression,
      ExpressionAttributeNames: projection?.names,
    }),
  );
  return result.Item;
}

/**
 * `version` is a DynamoDB reserved word, so every expression that names it goes
 * through this alias.
 */
const VERSION_NAMES = { "#v": VERSION_ATTRIBUTE } as const;
const WATERMARK_NAMES = { "#w": EVENT_WATERMARK_ATTRIBUTE } as const;

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
  error: unknown,
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

const CONDITIONAL_CHECK_FAILED = "ConditionalCheckFailed";

interface CancellationReason {
  readonly Code?: string;
  readonly Item?: Record<string, { readonly N?: string }>;
}

function cancellationReasons(error: unknown): CancellationReason[] | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    name?: string;
    CancellationReasons?: CancellationReason[];
  };
  if (candidate.name !== "TransactionCanceledException") return undefined;
  return candidate.CancellationReasons ?? [];
}

/*
 * TransactItems order is load-bearing: DynamoDB returns CancellationReasons
 * POSITIONALLY, and that positional mapping is the only way to tell "another
 * writer advanced the entitlement underneath us" apart from "this Stripe event
 * was already applied". Inserting an item shifts every later index, so these
 * constants and the array below are edited together or not at all - exactly as
 * apps/api-bedrock/src/lib/quota.ts does it.
 */
export const ENTITLEMENT_TRANSACT_INDEX = 0;
export const EVENT_MARKER_TRANSACT_INDEX = 1;

function failedAt(reasons: CancellationReason[], index: number): boolean {
  return reasons[index]?.Code === CONDITIONAL_CHECK_FAILED;
}

/**
 * The single non-transactional write path (AD-4). `expectedVersion: null` is
 * create-only and conditional on `attribute_not_exists(pk)`; a number is
 * conditional on the stored `version` being exactly that. A failed condition is
 * always a `version_conflict` and never an overwrite.
 *
 * This is the read-path refresh's write (AD-9), which touches the statement-cache
 * attributes only. A STATE-advancing write goes through
 * `writeEntitlementStateAdvance` instead, because it needs both guards in one
 * expression and the dedupe marker in the same transaction.
 */
export async function putVersionedItem(args: {
  readonly item: Record<string, unknown>;
  readonly expectedVersion: number | null;
  readonly resource: BillingVersionedResource;
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
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      failConflict(resource, currentVersionFromConditionFailure(error));
    }
    throw error;
  }
}

export type EntitlementAdvanceOutcome =
  /** The entitlement advanced and the dedupe marker is durable. */
  | "written"
  /** The `EVENT#` marker already existed: a replay, acknowledged as a no-op. */
  | "duplicate_event";

/**
 * AD-4's and AD-5's state-advancing write, as ONE `TransactWriteItems`.
 *
 * Two properties are the whole point and neither survives being split into two
 * sequential conditional writes:
 *
 *   1. the `ENTITLEMENT` write carries a SINGLE `ConditionExpression` combining
 *      BOTH guards - the expected `version` AND a strictly advancing
 *      `event_watermark` - so an older event can never downgrade a newer
 *      entitlement, and
 *   2. the `EVENT#` dedupe marker is written in the SAME transaction, so the
 *      marker is never durable before the work it guards and a crash between the
 *      two cannot lose an event.
 *
 * The derived item is an input: deriving it from Stripe is `handlers/webhook.ts`
 * and `lib/entitlement.ts`'s job, and this boundary has no business knowing how.
 */
export async function writeEntitlementStateAdvance(args: {
  readonly sub: string;
  readonly entitlementItem: Record<string, unknown>;
  readonly expectedVersion: number | null;
  readonly eventId: string;
  readonly eventWatermark: number;
  readonly eventMarkerExpiresAt: number;
}): Promise<EntitlementAdvanceOutcome> {
  const {
    sub,
    entitlementItem,
    expectedVersion,
    eventId,
    eventWatermark,
    eventMarkerExpiresAt,
  } = args;

  // One expression, both guards. On a create there is no stored version and no
  // stored watermark, so absence of the item is the whole condition.
  const entitlementCondition =
    expectedVersion === null
      ? {
          ConditionExpression: "attribute_not_exists(pk)",
        }
      : {
          ConditionExpression:
            "#v = :expected AND (attribute_not_exists(#w) OR #w < :watermark)",
          ExpressionAttributeNames: { ...VERSION_NAMES, ...WATERMARK_NAMES },
          ExpressionAttributeValues: {
            ":expected": expectedVersion,
            ":watermark": eventWatermark,
          },
        };

  const transactItems = [
    {
      Put: {
        TableName: tableName(),
        Item: entitlementItem,
        ...entitlementCondition,
        ReturnValuesOnConditionCheckFailure: "ALL_OLD" as const,
      },
    },
    {
      Put: {
        TableName: tableName(),
        Item: {
          ...eventMarkerKey(sub, eventId),
          [EXPIRES_AT_ATTRIBUTE]: eventMarkerExpiresAt,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      },
    },
  ];

  try {
    await getDocumentClient().send(
      new TransactWriteCommand({ TransactItems: transactItems }),
    );
    return "written";
  } catch (error) {
    const reasons = cancellationReasons(error);
    if (reasons === undefined) throw error;

    // Checked in index order so a transaction that failed BOTH guards is reported
    // as the entitlement conflict, which is the actionable half.
    if (failedAt(reasons, ENTITLEMENT_TRANSACT_INDEX)) {
      failConflict(
        "entitlement",
        currentVersionFromConditionFailure(
          reasons[ENTITLEMENT_TRANSACT_INDEX] ?? null,
        ),
      );
    }
    if (failedAt(reasons, EVENT_MARKER_TRANSACT_INDEX)) {
      return "duplicate_event";
    }
    throw error;
  }
}

/*
 * The `BILLING_CUSTOMER` record's own write path (AD-18). It is NOT a versioned
 * resource in the contract - the error union's only `version_conflict` resource
 * is the entitlement - so it carries no `version`, and the one thing it has to
 * serialise is the short-lived checkout lock.
 *
 * `checkout_lock` holds the epoch second at which the lock LAPSES, not a boolean
 * and not a DynamoDB TTL attribute: a boolean would strand the account forever if
 * a request crashed between taking the lock and releasing it, and a table TTL
 * would delete the record that carries the Stripe customer id.
 */

export const CHECKOUT_LOCK_ATTRIBUTE = "checkout_lock";
export const STRIPE_CUSTOMER_ID_ATTRIBUTE = "stripe_customer_id";

const LOCK_NAMES = { "#l": CHECKOUT_LOCK_ATTRIBUTE } as const;

/** Acquirable when no record exists, when no lock was ever taken, or when the
 * previous lock has lapsed. Those three cases are one expression on purpose: a
 * read-then-write would be exactly the race the lock exists to close. */
const CHECKOUT_LOCK_ACQUIRE_CONDITION =
  "attribute_not_exists(pk) OR attribute_not_exists(#l) OR #l <= :now";

export type CheckoutLockOutcome = "acquired" | "already_locked";

export async function acquireCheckoutLock(args: {
  readonly item: Record<string, unknown>;
  readonly nowSeconds: number;
}): Promise<CheckoutLockOutcome> {
  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName(),
        Item: args.item,
        ConditionExpression: CHECKOUT_LOCK_ACQUIRE_CONDITION,
        ExpressionAttributeNames: { ...LOCK_NAMES },
        ExpressionAttributeValues: { ":now": args.nowSeconds },
      }),
    );
    return "acquired";
  } catch (error) {
    if (isConditionalCheckFailure(error)) return "already_locked";
    throw error;
  }
}

/**
 * The GSI lookup, and the only way back from a Stripe customer to an account: a
 * webhook arrives keyed by Stripe customer and never by `sub` (AD-4). The index
 * is KEYS_ONLY, so the answer is a key and the caller re-reads the item it needs
 * strongly consistent.
 *
 * `null` when the customer is unknown to this service, which is an ordinary
 * answer for a customer created outside it - not an error.
 */
export async function subForStripeCustomerId(
  stripeCustomerId: string,
): Promise<string | null> {
  const result = await getDocumentClient().send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: customerIndexName(),
      KeyConditionExpression: "#c = :customer",
      ExpressionAttributeNames: { "#c": STRIPE_CUSTOMER_ID_ATTRIBUTE },
      ExpressionAttributeValues: { ":customer": stripeCustomerId },
      Limit: 1,
    }),
  );

  const pk = result.Items?.[0]?.pk;
  if (typeof pk !== "string" || !pk.startsWith(USER_PARTITION_KEY_PREFIX)) {
    return null;
  }

  const sub = pk.slice(USER_PARTITION_KEY_PREFIX.length);
  return isUuidShaped(sub) ? sub : null;
}
