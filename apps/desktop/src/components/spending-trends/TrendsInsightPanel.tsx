import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Skeleton,
} from "@nixus/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { InsightCallout } from "@/components/shared/InsightCallout";
import type { TrendsInsightResponse } from "@/lib/types";
import type { AiAvailability } from "@/hooks/useAiConfig";
import { useAiErrorPresentation } from "@/hooks/useAiErrorPresentation";

interface TrendsInsightPanelProps {
  gatePassed: boolean;
  availability: AiAvailability;
  insightQuery: UseQueryResult<TrendsInsightResponse, Error>;
}

/** Headline plus two body lines — the shape the resolved insight actually has. */
const INSIGHT_SKELETON_ROWS = 3;

const TONE_VARIANT: Record<
  TrendsInsightResponse["tone"],
  "good" | "caution" | "neutral"
> = {
  positive: "good",
  caution: "caution",
  calm: "neutral",
};

/**
 * The glass "INSIGHT" callout — the one place this surface speaks to the user. Every state keeps
 * the same shape, so the panel never jumps as the answer resolves, and every failure state still
 * names the manual path and leaves the chart and the table either side of it alone.
 */
export function TrendsInsightPanel({
  gatePassed,
  availability,
  insightQuery,
}: TrendsInsightPanelProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch, isFetching, error } = insightQuery;
  const {
    title: insightErrorTitle,
    retryable: insightErrorRetryable,
  } = useAiErrorPresentation(error, "spendingTrends.insightError");

  if (!gatePassed) {
    return (
      <InsightCallout
        icon={LightbulbIcon}
        eyebrow={t("insights.v2.insightEyebrow")}
        title={t("insights.insightGateTitle")}
        actions={
          <Button
            variant="outline"
            size="lg"
            render={<Link to="/spending/budget" />}
            data-testid="trends-insight-budget-link"
          >
            {t("insights.insightGateAction")}
          </Button>
        }
        data-testid="trends-insight-panel"
      >
        {t("spendingTrends.insightGateEmpty")}
      </InsightCallout>
    );
  }

  // Strictly `unavailable`, never "not available yet": while the cloud entitlement is still
  // resolving this offer to configure a personal key is aimed at a premium user who needs none, and
  // the pending window falls through to the skeleton below instead.
  //
  // AI unavailable is inline, non-modal, and recoverable, and it names the manual path. It never
  // blocks the chart or the compare table sitting either side of it.
  if (availability === "unavailable") {
    return (
      <Card flush data-testid="trends-insight-panel">
        <Alert variant="info" icon={<InfoIcon />}>
          <AlertTitle>{t("spendingTrends.insightNotConfigured")}</AlertTitle>
          <AlertDescription>
            {t("insights.insightManualPath")}
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            render={<Link to="/settings" />}
            data-testid="trends-insight-settings-link"
          >
            {t("settings.openSettings")}
          </Button>
        </Alert>
      </Card>
    );
  }

  if (isPending || (isFetching && !data)) {
    return (
      <InsightCallout
        icon={LightbulbIcon}
        eyebrow={t("insights.v2.insightEyebrow")}
        data-testid="trends-insight-panel"
      >
        <p className="mb-3 text-caption text-ink-dim">
          {t("spendingTrends.insightSkeleton")}
        </p>
        <Skeleton
          rows={INSIGHT_SKELETON_ROWS}
          data-testid="trends-insight-skeleton"
        />
      </InsightCallout>
    );
  }

  if (isError) {
    return (
      <Card flush data-testid="trends-insight-error">
        <Alert variant="over" icon={<TriangleAlertIcon />}>
          <AlertTitle>{insightErrorTitle}</AlertTitle>
          <AlertDescription>
            {t("insights.insightManualPath")}
          </AlertDescription>
          {insightErrorRetryable && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => refetch()}
              data-testid="trends-insight-retry"
            >
              {t("spendingTrends.insightRetry")}
            </Button>
          )}
        </Alert>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <InsightCallout
      icon={LightbulbIcon}
      eyebrow={t("insights.v2.insightEyebrow")}
      title={data.headline}
      collapsible={{
        collapseLabel: t("insights.collapseInsight"),
        expandLabel: t("insights.expandInsight"),
      }}
      data-testid="trends-insight-panel"
    >
      <p>{data.body}</p>
      <Badge variant={TONE_VARIANT[data.tone]} className="mt-4">
        {data.window_label}
      </Badge>
    </InsightCallout>
  );
}
