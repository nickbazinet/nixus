/**
 * Epic G step 2 (AD-17) — idempotent entitlement backfill.
 *
 * Migrates every hand-granted hosted-AI user out of `HostedAiTable`'s one-bit
 * `premium` attribute and into the billing table's `ENTITLEMENT` record, which
 * AD-2 makes the sole entitlement authority. Epic H has since removed every
 * read of `premium` from `apps/api-bedrock`, so the source attribute is dead
 * weight the moment this script confirms the destination record exists -
 * `--delete-source` retires it.
 *
 * Per INVESTIGATION §4 the existing hand-granted users were granted **hosted
 * AI**, so they map to the **Advance** capability set with `source = admin` and
 * no Stripe customer. Mapping them to Classic would silently remove the only
 * thing they were ever given.
 *
 * Nothing here runs in a Lambda and nothing here is deployed. It is an operator
 * tool, run by hand, and it is the ONLY path that writes an `ENTITLEMENT` record
 * outside AD-2's two ranked writers — which is why it is create-only,
 * conditional, and refuses to touch a record a real paying customer owns.
 *
 * Run (Node 24+ strips the types natively):
 *
 *   AWS_REGION=us-east-1 AWS_PROFILE=... \
 *     node --experimental-strip-types apps/api-billing/scripts/backfill-entitlements.ts
 *
 *   Add --apply to write. Without it the script is a DRY RUN: it reads, prints
 *   exactly what it would do, and performs ZERO writes.
 *
 *   Add --delete-source (with --apply) to also delete the source `CONFIG` item
 *   once its grant is confirmed present in the billing table - for a freshly
 *   migrated record, an already-migrated one, or one Stripe already owns.
 *   Off by default: it is cleanup, never a prerequisite for the migration, and
 *   the three `skippedUnusableKey` shapes documented in
 *   docs/runbooks/billing-operations.md §8 are never touched by it, migration
 *   or deletion alike - they need a deliberate per-account decision instead.
 *
 *   --admin-expires-at-days=<n> shortens the recorded override horizon. See
 *   DEFAULT_ADMIN_EXPIRY_DAYS below for why the default is what it is.
 *
 * Both table names are READ BACK from the deployed stacks by output key, never
 * pasted, exactly as docs/runbooks/hosted-ai-rollout.md does it — a pasted name
 * is how a migration lands on a stale table.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

// Imported by path, not through the `@nixus/shared` barrel: that barrel re-exports the React
// UI surface, which cannot load in a plain Node process running this script.
import {
  toBillingCapabilities,
  type BillingCapability,
} from "../../../packages/shared/src/types/billing.ts";

/* -------------------------------------------------------------------------- */
/* Environment and stack identity                                             */
/* -------------------------------------------------------------------------- */

/** Both stacks live here and nowhere else. A run pointed elsewhere is refused. */
export const REQUIRED_REGION = "us-east-1";

export const BILLING_STACK_NAME = "nixus-billing";
export const BILLING_TABLE_OUTPUT_KEY = "BillingTableName";

export const HOSTED_AI_STACK_NAME = "nixus-bedrock-api";
export const HOSTED_AI_TABLE_OUTPUT_KEY = "TableName";

/* -------------------------------------------------------------------------- */
/* The two item shapes this script spans                                      */
/* -------------------------------------------------------------------------- */

/*
 * The source shape, from `apps/api-bedrock/src/lib/table.ts`. Only the three
 * attributes the migration actually reads are named.
 */
export const HOSTED_AI_CONFIG_SORT_KEY = "CONFIG";
export const HOSTED_AI_PREMIUM_ATTRIBUTE = "premium";
export const HOSTED_AI_MONTHLY_REQUEST_LIMIT_ATTRIBUTE = "monthly_request_limit";

/*
 * The destination shape, from `apps/api-billing/src/lib/table.ts` and
 * `src/lib/entitlement.ts`. Re-declared here rather than imported because those
 * modules import the `@nixus/shared` barrel, which cannot load in a plain Node
 * process — and `src/backfill-script.test.ts` asserts, in the Vitest
 * environment where the barrel DOES load, that every literal below is identical
 * to the storage boundary's. A rename there with no rename here fails that test
 * rather than silently writing an unreadable record.
 */
export const USER_PARTITION_KEY_PREFIX = "USER#";
export const ENTITLEMENT_SORT_KEY = "ENTITLEMENT";

export const ENTITLEMENT_ATTRIBUTE_NAMES = {
  tier: "tier",
  capabilities: "capabilities",
  status: "status",
  currentPeriodEnd: "current_period_end",
  monthlyRequestLimit: "monthly_request_limit",
  source: "source",
  createdAt: "created_at",
  updatedAt: "updated_at",
  adminExpiresAt: "admin_expires_at",
  adminReason: "admin_reason",
  adminActor: "admin_actor",
} as const;

export const VERSION_ATTRIBUTE = "version";

/**
 * The 8-4-4-4-12 hex SHAPE only, copied verbatim from
 * `apps/api-billing/src/lib/table.ts`: this pool issues subs whose variant
 * nibble falls outside RFC 4122's `[89ab]`, so a stricter pattern refuses every
 * real user.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* The grant these users receive                                              */
/* -------------------------------------------------------------------------- */

/**
 * The **Advance** capability set, normalised through the shared contract's own
 * `toBillingCapabilities` so it is sorted, de-duplicated, and provably a subset
 * of the closed compile-time union (AD-1, AD-6).
 */
export const ADVANCE_CAPABILITIES: readonly BillingCapability[] =
  toBillingCapabilities(["hosted_ai", "household_net_worth", "multi_device_sync"]);

/** Opaque display label. Never compared in a gate anywhere (AD-1). */
export const ADVANCE_TIER = "advance";

/**
 * `none` — "signed in with no subscription record" — is the TRUTH about these
 * accounts: they have no Stripe customer and no subscription, so every other
 * member of the status union would be a fabricated claim about Stripe state.
 *
 * It costs nothing, because status is never a gate: the bedrock read path grants
 * hosted AI iff `capabilities[]` contains `hosted_ai` (AD-1/AD-12), and
 * `grantsCapabilities(status)` in `src/lib/entitlement.ts` is only ever applied
 * to a state DERIVED FROM STRIPE, never to a stored admin record. Writing
 * `active` would additionally make the record indistinguishable from a paid
 * entitlement, which AD-2 explicitly forbids.
 */
export const BACKFILL_STATUS = "none";

/** AD-2 requires a reason on every `source = admin` record. Never a personal detail (AD-14). */
export const BACKFILL_REASON =
  "AD-17 Epic G backfill of a hand-granted hosted-AI user";

/** Recorded in `admin_actor`, because no authenticated administrator made this call. */
export const BACKFILL_ACTOR = "backfill-entitlements-script";

/**
 * THE highest-risk design call in this migration, stated in full.
 *
 * AD-2 requires an `admin_expires_at` on every `source = admin` record and
 * says an override is "always time-boxed". The contract's
 * `ADMIN_OVERRIDE_MAX_DURATION_SECONDS` caps that at 90 days — but that cap is
 * a VALIDATION BOUND on `POST /admin/override` request bodies, not a property of
 * the stored record, and this script is not that route.
 *
 * A 90-day horizon here would be a silent revocation timer: there is no expiry
 * sweep, no scheduled restore and no alarm on admin expiry anywhere in the
 * system today, so nothing would notice, and every grandfathered user would
 * lose hosted AI 90 days after the migration. AD-17's gate — "every hand-granted
 * premium user retains hosted AI" — forbids exactly that.
 *
 * `null` is worse, not better: `isAdminOverrideLive` in
 * `src/lib/entitlement.ts` treats a null expiry as NOT LIVE, so a converging
 * webhook would be free to overwrite `tier`/`capabilities[]` on a grandfathered
 * record. A non-expiring provenance would therefore have to be taught to that
 * predicate, which is an AD-2 change this work package does not own.
 *
 * So the horizon is finite, explicit, and far beyond the planning window: ten
 * years. The record keeps every property AD-2 actually asks for — it is
 * visible, it carries a reason and an actor, it is distinguishable from a paid
 * entitlement by `source = admin`, and it is revocable at any moment through
 * the admin route — while never becoming a timer nobody is watching.
 * `--admin-expires-at-days=<n>` lets an operator shorten it deliberately.
 */
export const DEFAULT_ADMIN_EXPIRY_DAYS = 3650;

const SECONDS_PER_DAY = 24 * 60 * 60;

/* -------------------------------------------------------------------------- */
/* Pure derivation and classification                                         */
/* -------------------------------------------------------------------------- */

/**
 * The eligibility predicate, and deliberately the only one. An item qualifies
 * iff it is a per-user hosted-AI CONFIG item explicitly carrying `premium = true`.
 *
 * `=== true` and not a truthiness test: `parseUserConfig` in
 * `apps/api-bedrock/src/lib/table.ts` granted on exactly that value before
 * Epic H retired it, so a record with `premium: "true"` or `premium: 1` was
 * NOT entitled and must not be granted an entitlement by this migration either
 * - matching that historical rule is what makes "eligible" here mean the same
 * thing it meant when the attribute still did something.
 */
export function isEligibleHostedAiConfig(
  item: Record<string, unknown> | undefined,
): boolean {
  if (!item) return false;
  if (item.sk !== HOSTED_AI_CONFIG_SORT_KEY) return false;
  if (typeof item.pk !== "string") return false;
  if (!item.pk.startsWith(USER_PARTITION_KEY_PREFIX)) return false;
  if (item[HOSTED_AI_PREMIUM_ATTRIBUTE] !== true) return false;
  return subFromUserPartitionKey(item.pk) !== null;
}

/**
 * `null` when the partition key does not carry a usable Cognito `sub`. The same
 * shape check the billing table's own key builder applies, so this migration can
 * never compose a partition key that service would refuse.
 */
export function subFromUserPartitionKey(pk: unknown): string | null {
  if (typeof pk !== "string") return null;
  if (!pk.startsWith(USER_PARTITION_KEY_PREFIX)) return null;
  const sub = pk.slice(USER_PARTITION_KEY_PREFIX.length);
  return UUID_PATTERN.test(sub) ? sub : null;
}

/**
 * Carries the limit over only when it is the positive integer the hosted-AI
 * service would itself have honoured; anything else becomes `null`, which the
 * contract defines as "no per-tier limit recorded". A fabricated number would be
 * a policy decision this migration has no authority to make.
 */
export function monthlyRequestLimitOf(
  item: Record<string, unknown> | undefined,
): number | null {
  const value = item?.[HOSTED_AI_MONTHLY_REQUEST_LIMIT_ATTRIBUTE];
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export type ExistingRecordDisposition =
  /** No `ENTITLEMENT` record exists: this migration may create one. */
  | "migrate"
  /** A record already exists and this migration produced it. A re-run is a no-op. */
  | "already_migrated"
  /** A record exists that STRIPE owns. Never overwritten, always reported. */
  | "skip_stripe_owned";

/**
 * The skip rules. `source` is read exactly as `readSource` in
 * `src/lib/entitlement.ts` reads it — anything that is not one of the three
 * non-Stripe sources IS Stripe, including an absent or malformed value — so a
 * real paying customer can never be overwritten by a backfill, not even one
 * whose record is partially malformed.
 */
export function dispositionOf(
  existing: Record<string, unknown> | undefined,
): ExistingRecordDisposition {
  if (existing === undefined) return "migrate";

  const source = existing[ENTITLEMENT_ATTRIBUTE_NAMES.source];
  const nonStripe =
    source === "admin" || source === "app_store" || source === "play";
  return nonStripe ? "already_migrated" : "skip_stripe_owned";
}

export interface DerivedBackfillItem {
  readonly pk: string;
  readonly sk: string;
  readonly [attribute: string]: unknown;
}

/**
 * The `ENTITLEMENT` item this migration writes, derived purely from the source
 * CONFIG item plus the run's own clock and horizon.
 *
 * A SIGNED STATEMENT IS DELIBERATELY NOT WRITTEN. This script holds no KMS
 * grant — AD-9 makes the billing role's `kms:Sign` the only signing path, and
 * minting a second one here would make the script a third signer of statements.
 * It does not need to: `GET /entitlement` mints one on read. Verified against
 * `apps/api-billing/src/handlers/entitlement.ts` — `toEntitlementRecord` reads
 * an absent `statement` as `""`, `needsRefresh` returns `true` for a
 * zero-length statement, and the handler then signs a fresh statement and
 * persists it with a write conditional on the unchanged `version`. A
 * statement-less record is therefore an ordinary refresh on the read path, not a
 * broken one.
 *
 * `version` is 1 because this is a create. A re-run never reaches here for an
 * existing record, so no version is ever bumped by a second run.
 */
export function deriveBackfillItem(args: {
  readonly sub: string;
  readonly monthlyRequestLimit: number | null;
  readonly now: Date;
  readonly adminExpiresAt: number;
}): DerivedBackfillItem {
  const timestamp = args.now.toISOString();
  const attribute = ENTITLEMENT_ATTRIBUTE_NAMES;

  return {
    pk: `${USER_PARTITION_KEY_PREFIX}${args.sub}`,
    sk: ENTITLEMENT_SORT_KEY,
    [attribute.tier]: ADVANCE_TIER,
    [attribute.capabilities]: [...ADVANCE_CAPABILITIES],
    [attribute.status]: BACKFILL_STATUS,
    // No Stripe subscription, so no period. A statement minted from this record
    // gets a full window rather than a born-expired one (AD-9).
    [attribute.currentPeriodEnd]: null,
    [attribute.monthlyRequestLimit]: args.monthlyRequestLimit,
    [attribute.source]: "admin",
    [attribute.createdAt]: timestamp,
    [attribute.updatedAt]: timestamp,
    [attribute.adminExpiresAt]: args.adminExpiresAt,
    [attribute.adminReason]: BACKFILL_REASON,
    [attribute.adminActor]: BACKFILL_ACTOR,
    [VERSION_ATTRIBUTE]: 1,
  };
}

export function adminExpiresAtFor(now: Date, days: number): number {
  return Math.floor(now.getTime() / 1000) + days * SECONDS_PER_DAY;
}

/** Positive whole days only: a zero or negative horizon would write a record born expired. */
export function parseAdminExpiryDays(argv: readonly string[]): number {
  const flag = argv.find((entry) =>
    entry.startsWith("--admin-expires-at-days="),
  );
  if (flag === undefined) return DEFAULT_ADMIN_EXPIRY_DAYS;

  const raw = flag.slice("--admin-expires-at-days=".length);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--admin-expires-at-days must be a positive whole number");
  }
  return parsed;
}

export interface BackfillSummary {
  scanned: number;
  /** Matched the premium filter, whether or not the key was usable. */
  matched: number;
  eligible: number;
  migrated: number;
  alreadyMigrated: number;
  skippedStripeOwned: number;
  /**
   * Matched the premium filter but carried a partition key the billing table
   * cannot compose. Reported as its own number because the first production run
   * skipped three such records while printing `failed 0`, which reads as a clean
   * migration. A grandfathered user silently left behind is exactly what AD-17's
   * gate exists to catch, so this can never be inferred from a difference again.
   */
  skippedUnusableKey: number;
  failed: number;
  /**
   * The source `HostedAiTable` `CONFIG` item deleted after its grant was
   * confirmed present in the billing table - only ever incremented when
   * `--delete-source` was passed. Retiring the attribute (Epic H) makes the
   * source item dead weight; this is cleanup, never a prerequisite for the
   * migration itself, which is why it defaults to off.
   */
  deletedSource: number;
}

export function emptySummary(): BackfillSummary {
  return {
    scanned: 0,
    matched: 0,
    eligible: 0,
    migrated: 0,
    alreadyMigrated: 0,
    skippedStripeOwned: 0,
    skippedUnusableKey: 0,
    failed: 0,
    deletedSource: 0,
  };
}

export function formatSummary(summary: BackfillSummary): string {
  return [
    "",
    "Summary",
    `  scanned                 ${summary.scanned}`,
    `  matched premium filter  ${summary.matched}`,
    `  eligible                ${summary.eligible}`,
    `  migrated                ${summary.migrated}`,
    `  already migrated        ${summary.alreadyMigrated}`,
    `  skipped (stripe-owned)  ${summary.skippedStripeOwned}`,
    `  skipped (unusable key)  ${summary.skippedUnusableKey}`,
    `  failed                  ${summary.failed}`,
    `  deleted source CONFIG   ${summary.deletedSource}`,
    "",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* AWS plumbing                                                               */
/* -------------------------------------------------------------------------- */

const APPLY = process.argv.includes("--apply");
/**
 * Epic H cleanup, off by default and meaningless without `--apply`. Deletes
 * the source `HostedAiTable` `CONFIG` item once its grant is confirmed present
 * in the billing table - never for a `skippedUnusableKey` record, which this
 * migration never touched in the first place and which `billing-operations.md`
 * §8 says needs a deliberate per-account decision instead.
 */
const DELETE_SOURCE = process.argv.includes("--delete-source");

function log(action: "would" | "did" | "note", what: string): void {
  const prefix =
    action === "would" ? "[dry-run]" : action === "did" ? "[applied]" : "[note]  ";
  process.stdout.write(`${prefix} ${what}\n`);
}

function requireRegion(): string {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error("AWS_REGION is not set");
  }
  if (region !== REQUIRED_REGION) {
    throw new Error(
      `refusing to run: both stacks live in ${REQUIRED_REGION}, not ${region}`,
    );
  }
  return region;
}

async function stackOutput(
  cloudformation: CloudFormationClient,
  stackName: string,
  outputKey: string,
): Promise<string> {
  const described = await cloudformation.send(
    new DescribeStacksCommand({ StackName: stackName }),
  );
  const outputs = described.Stacks?.[0]?.Outputs ?? [];
  const value = outputs.find((output) => output.OutputKey === outputKey)
    ?.OutputValue;

  if (!value) {
    throw new Error(`${stackName} has no ${outputKey} output`);
  }
  return value;
}

interface EligibleUser {
  readonly sub: string;
  readonly monthlyRequestLimit: number | null;
}

/**
 * A `Scan` with a filter, which is correct here and only here: this is a
 * one-off operator action over a table holding one item per premium user, not a
 * request path. The billing role deliberately holds no `dynamodb:Scan` grant at
 * all — the scan runs against the HOSTED-AI table under the operator's own
 * credentials.
 */
async function scanEligibleUsers(
  documents: DynamoDBDocumentClient,
  hostedAiTableName: string,
  summary: BackfillSummary,
): Promise<EligibleUser[]> {
  const eligible: EligibleUser[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await documents.send(
      new ScanCommand({
        TableName: hostedAiTableName,
        FilterExpression:
          "#sk = :config AND begins_with(#pk, :user_prefix) AND #premium = :granted",
        ExpressionAttributeNames: {
          "#pk": "pk",
          "#sk": "sk",
          [`#${HOSTED_AI_PREMIUM_ATTRIBUTE}`]: HOSTED_AI_PREMIUM_ATTRIBUTE,
        },
        ExpressionAttributeValues: {
          ":config": HOSTED_AI_CONFIG_SORT_KEY,
          ":user_prefix": USER_PARTITION_KEY_PREFIX,
          ":granted": true,
        },
        ExclusiveStartKey: startKey,
      }),
    );

    summary.scanned += page.ScannedCount ?? 0;

    for (const item of page.Items ?? []) {
      summary.matched += 1;
      const sub = subFromUserPartitionKey(item.pk);
      if (sub === null || !isEligibleHostedAiConfig(item)) {
        // Loud, not silent. The key is printed quoted so a trailing space or a
        // non-UUID federated identity is visible rather than inferred - both
        // occurred in production, and the service composes `USER#<sub>` from the
        // token, so neither record was ever being read in the first place.
        summary.skippedUnusableKey += 1;
        log(
          "note",
          `SKIPPED, unusable partition key: ${JSON.stringify(item.pk)} - the billing table cannot compose it, so this record is NOT migrated. Reconcile it by hand.`,
        );
        continue;
      }
      eligible.push({ sub, monthlyRequestLimit: monthlyRequestLimitOf(item) });
    }

    startKey = page.LastEvaluatedKey;
  } while (startKey !== undefined);

  summary.eligible = eligible.length;
  return eligible;
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    error instanceof Error && error.name === "ConditionalCheckFailedException"
  );
}

/**
 * Epic H cleanup. Deletes the source `CONFIG` item once its grant is
 * confirmed present in the billing table, under `--delete-source --apply`
 * only. A failure here is reported but never escalated to `summary.failed`:
 * the migration itself already succeeded, and the dead attribute surviving a
 * little longer is harmless - unlike the migration's own write, there is
 * nothing to retry safely, since a second run would just see "already
 * migrated" and skip the delete too.
 */
async function deleteSourceConfigIfRequested(args: {
  readonly documents: DynamoDBDocumentClient;
  readonly hostedAiTableName: string;
  readonly sub: string;
  readonly summary: BackfillSummary;
}): Promise<void> {
  const { documents, hostedAiTableName, sub, summary } = args;
  if (!DELETE_SOURCE) return;

  if (!APPLY) {
    log("would", `delete source CONFIG item for ${sub}`);
    return;
  }

  try {
    await documents.send(
      new DeleteCommand({
        TableName: hostedAiTableName,
        Key: { pk: `${USER_PARTITION_KEY_PREFIX}${sub}`, sk: HOSTED_AI_CONFIG_SORT_KEY },
      }),
    );
    summary.deletedSource += 1;
    log("did", `deleted source CONFIG item for ${sub}`);
  } catch (error) {
    log(
      "note",
      `FAILED to delete source CONFIG item for ${sub}: ${error instanceof Error ? error.name : "unknown error"}`,
    );
  }
}

async function migrateOne(args: {
  readonly documents: DynamoDBDocumentClient;
  readonly billingTableName: string;
  readonly hostedAiTableName: string;
  readonly user: EligibleUser;
  readonly now: Date;
  readonly adminExpiresAt: number;
  readonly summary: BackfillSummary;
}): Promise<void> {
  const {
    documents,
    billingTableName,
    hostedAiTableName,
    user,
    now,
    adminExpiresAt,
    summary,
  } = args;

  const existing = await documents.send(
    new GetCommand({
      TableName: billingTableName,
      Key: {
        pk: `${USER_PARTITION_KEY_PREFIX}${user.sub}`,
        sk: ENTITLEMENT_SORT_KEY,
      },
      // The conditional write below depends on this read not being stale.
      ConsistentRead: true,
    }),
  );

  const disposition = dispositionOf(existing.Item);

  if (disposition === "skip_stripe_owned") {
    summary.skippedStripeOwned += 1;
    log(
      "note",
      `SKIPPED ${user.sub}: a stripe-sourced entitlement already exists and a backfill never overwrites a paying customer`,
    );
    // The Stripe-sourced record already supersedes the legacy grant, so the
    // dead CONFIG item behind it is just as safe to retire as a migrated one.
    await deleteSourceConfigIfRequested({ documents, hostedAiTableName, sub: user.sub, summary });
    return;
  }

  if (disposition === "already_migrated") {
    summary.alreadyMigrated += 1;
    log("note", `already migrated ${user.sub}: left exactly as it is`);
    await deleteSourceConfigIfRequested({ documents, hostedAiTableName, sub: user.sub, summary });
    return;
  }

  const item = deriveBackfillItem({
    sub: user.sub,
    monthlyRequestLimit: user.monthlyRequestLimit,
    now,
    adminExpiresAt,
  });

  if (!APPLY) {
    log(
      "would",
      `create ENTITLEMENT for ${user.sub}: tier=${ADVANCE_TIER} capabilities=${ADVANCE_CAPABILITIES.join(",")} ` +
        `status=${BACKFILL_STATUS} source=admin monthly_request_limit=${String(user.monthlyRequestLimit)} ` +
        `admin_expires_at=${adminExpiresAt} version=1 statement=absent (minted on read)`,
    );
    await deleteSourceConfigIfRequested({ documents, hostedAiTableName, sub: user.sub, summary });
    return;
  }

  try {
    await documents.send(
      new PutCommand({
        TableName: billingTableName,
        Item: item,
        // Create-only. A concurrent run, or a second run racing the first,
        // cannot duplicate the record, bump its version, or reset its grant.
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    summary.migrated += 1;
    log("did", `created ENTITLEMENT for ${user.sub}`);
    await deleteSourceConfigIfRequested({ documents, hostedAiTableName, sub: user.sub, summary });
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      // Another writer got there between the read and the write. Reporting it as
      // already-migrated is the truth, and re-running with the condition removed
      // would be the one thing this script must never do.
      summary.alreadyMigrated += 1;
      log("note", `already migrated ${user.sub}: a concurrent writer won the race`);
      await deleteSourceConfigIfRequested({ documents, hostedAiTableName, sub: user.sub, summary });
      return;
    }
    summary.failed += 1;
    // Never the error object wholesale: a DynamoDB error echoes the item and its
    // expression attribute values, and the item is keyed by `sub` (AD-14).
    log(
      "note",
      `FAILED ${user.sub}: ${error instanceof Error ? error.name : "unknown error"}`,
    );
  }
}

async function main(): Promise<void> {
  const region = requireRegion();
  const adminExpiryDays = parseAdminExpiryDays(process.argv);
  const now = new Date();
  const adminExpiresAt = adminExpiresAtFor(now, adminExpiryDays);

  const cloudformation = new CloudFormationClient({ region });
  const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const [billingTableName, hostedAiTableName] = await Promise.all([
    stackOutput(cloudformation, BILLING_STACK_NAME, BILLING_TABLE_OUTPUT_KEY),
    stackOutput(cloudformation, HOSTED_AI_STACK_NAME, HOSTED_AI_TABLE_OUTPUT_KEY),
  ]);

  process.stdout.write(
    [
      `Entitlement backfill (AD-17 Epic G step 2) — region=${region} ` +
        `${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`,
      `  source      ${HOSTED_AI_STACK_NAME}.${HOSTED_AI_TABLE_OUTPUT_KEY} = ${hostedAiTableName}`,
      `  destination ${BILLING_STACK_NAME}.${BILLING_TABLE_OUTPUT_KEY} = ${billingTableName}`,
      `  grant       tier=${ADVANCE_TIER} capabilities=${ADVANCE_CAPABILITIES.join(",")} source=admin status=${BACKFILL_STATUS}`,
      `  horizon     admin_expires_at=${adminExpiresAt} (+${adminExpiryDays} days)`,
      `  delete-source ${DELETE_SOURCE ? "ON - the source CONFIG item is removed once its grant is confirmed" : "off (pass --delete-source to retire the source item too)"}`,
      "",
    ].join("\n"),
  );

  const summary = emptySummary();
  const eligible = await scanEligibleUsers(
    documents,
    hostedAiTableName,
    summary,
  );

  for (const user of eligible) {
    await migrateOne({
      documents,
      billingTableName,
      hostedAiTableName,
      user,
      now,
      adminExpiresAt,
      summary,
    });
  }

  process.stdout.write(formatSummary(summary));

  if (summary.skippedStripeOwned > 0) {
    process.stdout.write(
      "A stripe-owned entitlement was skipped. Reconcile it by hand before Epic H:\n" +
        "that account is a paying customer and its grant is Stripe's to decide.\n\n",
    );
  }
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

/* The module is imported by src/backfill-script.test.ts for its pure functions;
 * only a direct `node` run executes the AWS path. */
if (process.argv[1]?.endsWith("backfill-entitlements.ts") === true) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `backfill-entitlements failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
