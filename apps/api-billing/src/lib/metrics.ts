import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

/*
 * The two custom metrics AD-15's dedicated alarms read. Both are counters: the
 * alarm threshold is 1, so the first occurrence is the signal.
 *
 * The namespace comes from configuration and matches the one the execution role's
 * `cloudwatch:namespace` condition permits and the one the two alarms watch, so a
 * typo here is a metric nothing alarms on rather than a silent permission
 * failure - which is why src/template-scaffold.test.ts asserts all three agree.
 */

export const BILLING_METRIC_NAMES = [
  /** A Stripe webhook event failed to converge (AD-5). */
  "WebhookFailure",
  /** Stripe Product metadata could not be parsed into a tier (AD-6). */
  "CatalogMetadataMalformed",
  /**
   * One `sub` holds more than one LIVE Stripe subscription (AD-18). The
   * authority grants the union and never silently picks one, so this is the
   * only way an operator learns a reconciliation is owed.
   */
  "DuplicateSubscription",
] as const;
export type BillingMetricName = (typeof BILLING_METRIC_NAMES)[number];

export function metricNamespace(): string {
  const namespace = process.env.METRIC_NAMESPACE;
  if (!namespace) {
    throw new Error("METRIC_NAMESPACE is not configured");
  }
  return namespace;
}

let cloudWatchClient: CloudWatchClient | undefined;

function getCloudWatchClient(): CloudWatchClient {
  if (!cloudWatchClient) {
    cloudWatchClient = new CloudWatchClient({});
  }
  return cloudWatchClient;
}

/** Test seam: lets a spec observe emissions without a network stack. */
export function setCloudWatchClientForTesting(
  client: CloudWatchClient | undefined,
): void {
  cloudWatchClient = client;
}

/**
 * Emits one count. No dimensions: both metrics are stack-wide signals an operator
 * acts on immediately, and a per-`sub` dimension would put an account identifier
 * into a metric name space that is neither the log serializer nor subject to its
 * allow-list (AD-14).
 *
 * A failure to publish must never fail the request that was otherwise fine, so the
 * caller decides - the function returns whether the emission landed instead of
 * throwing its own class of error at a webhook that already succeeded.
 */
export async function emitBillingMetric(
  name: BillingMetricName,
  count = 1,
): Promise<boolean> {
  try {
    await getCloudWatchClient().send(
      new PutMetricDataCommand({
        Namespace: metricNamespace(),
        MetricData: [{ MetricName: name, Unit: "Count", Value: count }],
      }),
    );
    return true;
  } catch {
    return false;
  }
}
