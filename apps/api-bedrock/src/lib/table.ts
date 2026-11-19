import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

import { toBillingCapabilities, type BillingCapability } from "@nixus/shared";

/*
 * DynamoDB boundary for the hosted-AI quota table. Key builders and config reads
 * live here so `quota.ts` and the handlers never spell a key or an attribute name
 * themselves - AD-5 requires both sides to agree on the exact field names.
 *
 * It is also the READ-ONLY boundary onto the billing table's `ENTITLEMENT`
 * record, which billing AD-2 makes the sole entitlement authority and billing
 * AD-4 makes this service's canonical server-side read. This service holds
 * `dynamodb:GetItem` and `dynamodb:ConditionCheckItem` on that table and no
 * write action of any kind - the second grant lets `quota.ts` re-verify the
 * entitlement's `version` inside its own reservation transaction (Epic H) - and
 * it learns the table's name from a deploy-time parameter rather than a
 * CloudFormation export or a committed physical name (billing AD-17).
 *
 * `HostedAiTable.premium` is RETIRED (Epic H). The billing `ENTITLEMENT` record
 * is the only entitlement authority this service reads; there is no second
 * shape and no fallback. `HostedAiTable` itself keeps counted usage and the
 * GLOBAL kill switch only - no per-user CONFIG item exists here anymore.
 */

export const CONFIG_SORT_KEY = "CONFIG";
export const GLOBAL_PARTITION_KEY = "GLOBAL";

/** The billing table's entitlement sort key (billing AD-4). */
export const BILLING_ENTITLEMENT_SORT_KEY = "ENTITLEMENT";

/** Default GLOBAL limit from AD-6, used only to describe an absent item, never to create one. */
export const GLOBAL_DEFAULT_MONTHLY_REQUEST_LIMIT = 1000;

export interface TableKey {
  readonly pk: string;
  readonly sk: string;
}

export function userPartitionKey(sub: string): string {
  return `USER#${sub}`;
}

export function usageSortKey(periodKey: string): string {
  return `USAGE#${periodKey}`;
}

export function userUsageKey(sub: string, periodKey: string): TableKey {
  return { pk: userPartitionKey(sub), sk: usageSortKey(periodKey) };
}

export function globalConfigKey(): TableKey {
  return { pk: GLOBAL_PARTITION_KEY, sk: CONFIG_SORT_KEY };
}

export function globalUsageKey(periodKey: string): TableKey {
  return { pk: GLOBAL_PARTITION_KEY, sk: usageSortKey(periodKey) };
}

export function billingEntitlementKey(sub: string): TableKey {
  return { pk: userPartitionKey(sub), sk: BILLING_ENTITLEMENT_SORT_KEY };
}

/**
 * UTC `YYYY-MM` period key. Computed once at request start and threaded through
 * refund/finalize: re-deriving it later would operate on the wrong period for a
 * request that straddles a month boundary (AD-5).
 */
export function periodKeyFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

export interface GlobalConfig {
  readonly enabled: boolean;
  readonly monthly_request_limit: number;
}

/**
 * The billing `ENTITLEMENT` record as this service reads it (billing AD-4's
 * canonical server-side read). `tier` is deliberately absent, because no code
 * anywhere may compare one (billing AD-1), and the signed statement is
 * deliberately absent, because a server-side consumer never parses one.
 *
 * `version` is carried because `quota.ts`'s reservation re-verifies it with its
 * own `ConditionCheck` against this same item (Epic H): the limit this service
 * meters against must be the limit that was actually read, not a value that
 * changed underneath the request.
 */
export interface BillingEntitlement {
  readonly capabilities: readonly BillingCapability[];
  readonly monthly_request_limit: number | null;
  readonly version: number | null;
}

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) {
    throw new Error("TABLE_NAME is not configured");
  }
  return name;
}

export function billingTableName(): string {
  const name = process.env.BILLING_TABLE_NAME;
  if (!name) {
    throw new Error("BILLING_TABLE_NAME is not configured");
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * A missing or malformed GLOBAL config is `hosted_unavailable`, not "unlimited":
 * the manual seed step is what makes the service usable at all (AD-6/AD-15).
 */
export function parseGlobalConfig(
  item: Record<string, unknown> | undefined
): GlobalConfig | undefined {
  if (!item) return undefined;
  if (typeof item.enabled !== "boolean") return undefined;
  if (!isPositiveInteger(item.monthly_request_limit)) return undefined;
  return {
    enabled: item.enabled,
    monthly_request_limit: item.monthly_request_limit,
  };
}

export function chargedCountOf(item: Record<string, unknown> | undefined): number {
  const charged = item?.charged_count;
  return typeof charged === "number" && Number.isFinite(charged) && charged > 0
    ? charged
    : 0;
}

export function remainingQuota(limit: number, chargedCount: number): number {
  return Math.max(0, limit - chargedCount);
}

async function getItemConsistently(
  key: TableKey
): Promise<Record<string, unknown> | undefined> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: key,
      // Eventually consistent reads would let a just-refunded or just-reserved
      // unit go missing, which AD-8 step 2 forbids.
      ConsistentRead: true,
    })
  );
  return result.Item;
}

export async function getGlobalConfig(): Promise<GlobalConfig | undefined> {
  return parseGlobalConfig(await getItemConsistently(globalConfigKey()));
}

export async function getUserChargedCount(
  sub: string,
  periodKey: string
): Promise<number> {
  return chargedCountOf(await getItemConsistently(userUsageKey(sub, periodKey)));
}

export async function getGlobalChargedCount(periodKey: string): Promise<number> {
  return chargedCountOf(await getItemConsistently(globalUsageKey(periodKey)));
}

/**
 * Fail-closed: `undefined` means NO RECORD, which this release treats
 * identically to "denied" - there is no second shape to fall back to (Epic H).
 * A record this cannot read is normalised to a record that GRANTS NOTHING,
 * which is indistinguishable from an absent grant on the enforcement path.
 *
 * Unknown capability names are dropped rather than rejected, because
 * `toBillingCapabilities` is the shared contract's own normaliser and billing
 * AD-6 requires a name this build does not know to grant nothing instead of
 * poisoning the whole record. A list of only unknown names therefore parses
 * cleanly into an empty grant, which denies.
 */
export function parseBillingEntitlement(
  item: Record<string, unknown> | undefined
): BillingEntitlement | undefined {
  if (!item) return undefined;

  const capabilities = Array.isArray(item.capabilities)
    ? toBillingCapabilities(item.capabilities)
    : [];
  const limit = item.monthly_request_limit;
  const version = item.version;

  return {
    capabilities,
    monthly_request_limit: isPositiveInteger(limit) ? limit : null,
    version: isPositiveInteger(version) ? version : null,
  };
}

/**
 * ONE `GetItem` against the billing table, strongly consistent for the same
 * reason every other read here is: an entitlement that was just written must
 * not be read back as absent and silently deny a caller whose grant just
 * converged.
 *
 * Deliberately a separate call from `quota.ts`'s reservation transaction, which
 * re-verifies this same item's `version` with its own `ConditionCheck`. That
 * array's `CancellationReasons` are mapped POSITIONALLY, so folding this read
 * into it would shift every later index and make a quota failure report itself
 * as an entitlement change.
 */
export async function getBillingEntitlement(
  sub: string
): Promise<BillingEntitlement | undefined> {
  const result = await getDocumentClient().send(
    new GetCommand({
      TableName: billingTableName(),
      Key: billingEntitlementKey(sub),
      ConsistentRead: true,
    })
  );
  return parseBillingEntitlement(result.Item);
}
