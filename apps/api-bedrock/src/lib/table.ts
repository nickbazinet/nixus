import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

/*
 * DynamoDB boundary for the hosted-AI quota table. Key builders and config reads
 * live here so `quota.ts` and the handlers never spell a key or an attribute name
 * themselves - AD-5 requires both sides to agree on the exact field names.
 */

export const CONFIG_SORT_KEY = "CONFIG";
export const GLOBAL_PARTITION_KEY = "GLOBAL";

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

export function userConfigKey(sub: string): TableKey {
  return { pk: userPartitionKey(sub), sk: CONFIG_SORT_KEY };
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

export interface UserConfig {
  readonly premium: boolean;
  readonly monthly_request_limit: number;
}

export interface GlobalConfig {
  readonly enabled: boolean;
  readonly monthly_request_limit: number;
}

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) {
    throw new Error("TABLE_NAME is not configured");
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
 * A malformed record is indistinguishable from an absent one on the enforcement
 * path: both mean "not entitled" (AD-6 fail-closed), so this returns undefined
 * rather than throwing and never treats a partial item as premium.
 */
export function parseUserConfig(
  item: Record<string, unknown> | undefined
): UserConfig | undefined {
  if (!item) return undefined;
  if (item.premium !== true) return undefined;
  if (!isPositiveInteger(item.monthly_request_limit)) return undefined;
  return { premium: true, monthly_request_limit: item.monthly_request_limit };
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

export async function getUserConfig(sub: string): Promise<UserConfig | undefined> {
  return parseUserConfig(await getItemConsistently(userConfigKey(sub)));
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
