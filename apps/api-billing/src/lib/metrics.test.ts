import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CloudWatchClient } from "@aws-sdk/client-cloudwatch";

import {
  BILLING_METRIC_NAMES,
  emitBillingMetric,
  metricNamespace,
  setCloudWatchClientForTesting,
} from "./metrics.ts";

/*
 * The two custom metrics AD-15's dedicated alarms read. The namespace must match
 * the one the execution role's `cloudwatch:namespace` condition permits and the
 * one the two alarms watch; src/template-scaffold.test.ts asserts all three
 * agree, and this file asserts the emitter uses the configured value rather than
 * a literal of its own.
 */

const NAMESPACE = "Nixus/Billing";

interface FakeCloudWatch {
  readonly calls: Record<string, unknown>[];
  readonly client: CloudWatchClient;
}

function fakeCloudWatch(error?: Error): FakeCloudWatch {
  const calls: Record<string, unknown>[] = [];

  const client = {
    async send(command: { input: Record<string, unknown> }): Promise<unknown> {
      calls.push(command.input);
      if (error) throw error;
      return {};
    },
  } as unknown as CloudWatchClient;

  return { calls, client };
}

beforeEach(() => {
  process.env.METRIC_NAMESPACE = NAMESPACE;
});

afterEach(() => {
  setCloudWatchClientForTesting(undefined);
  delete process.env.METRIC_NAMESPACE;
});

describe("the metric set is closed", () => {
  it("carries exactly the three metrics the alarms watch", () => {
    expect([...BILLING_METRIC_NAMES]).toEqual([
      "WebhookFailure",
      "CatalogMetadataMalformed",
      "DuplicateSubscription",
    ]);
  });
});

describe("metricNamespace comes from configuration", () => {
  it("returns the configured namespace and refuses an absent one", () => {
    expect(metricNamespace()).toBe(NAMESPACE);

    delete process.env.METRIC_NAMESPACE;
    expect(() => metricNamespace()).toThrow("METRIC_NAMESPACE is not configured");
  });
});

describe("emitBillingMetric", () => {
  it("publishes one count into the configured namespace", async () => {
    const cloudwatch = fakeCloudWatch();
    setCloudWatchClientForTesting(cloudwatch.client);

    expect(await emitBillingMetric("WebhookFailure")).toBe(true);

    expect(cloudwatch.calls).toHaveLength(1);
    expect(cloudwatch.calls[0]).toEqual({
      Namespace: NAMESPACE,
      MetricData: [{ MetricName: "WebhookFailure", Unit: "Count", Value: 1 }],
    });
  });

  it("accepts an explicit count", async () => {
    const cloudwatch = fakeCloudWatch();
    setCloudWatchClientForTesting(cloudwatch.client);

    await emitBillingMetric("CatalogMetadataMalformed", 3);

    expect(
      (cloudwatch.calls[0]!.MetricData as { Value: number }[])[0]!.Value,
    ).toBe(3);
  });

  /* No dimensions: both metrics are stack-wide signals an operator acts on
   * immediately, and a per-`sub` dimension would put an account identifier into a
   * namespace that is neither the log serializer nor subject to its allow-list
   * (AD-14). */
  it("attaches no dimension, so no identifier reaches a metric", async () => {
    const cloudwatch = fakeCloudWatch();
    setCloudWatchClientForTesting(cloudwatch.client);

    await emitBillingMetric("WebhookFailure");

    const data = cloudwatch.calls[0]!.MetricData as Record<string, unknown>[];
    expect(data[0]).not.toHaveProperty("Dimensions");
  });

  /* A failure to publish must never fail the request that was otherwise fine, so
   * the caller is told it did not land rather than being handed an error class of
   * its own to classify. */
  it("reports a publish failure rather than throwing it", async () => {
    setCloudWatchClientForTesting(
      fakeCloudWatch(new Error("CloudWatch unavailable")).client,
    );

    expect(await emitBillingMetric("WebhookFailure")).toBe(false);
  });

  it("reports an unconfigured namespace as a failed emission", async () => {
    delete process.env.METRIC_NAMESPACE;
    setCloudWatchClientForTesting(fakeCloudWatch().client);

    expect(await emitBillingMetric("WebhookFailure")).toBe(false);
  });
});
