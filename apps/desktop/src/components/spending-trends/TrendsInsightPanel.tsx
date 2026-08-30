import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  EmptyState,
  Skeleton,
} from "@nixus/shared";
import type { UseQueryResult } from "@tanstack/react-query";
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
      <Card data-testid="trends-insight-panel">
        <EmptyState
          title={t("insights.insightGateTitle")}
          description={t("spendingTrends.insightGateEmpty")}
          action={
            <Button
              variant="outline"
              render={<Link to="/spending/budget" />}
              data-testid="trends-insight-budget-link"
            >
              {t("insights.insightGateAction")}
            </Button>
          }
        />
      </Card>
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
            className="mt-2"
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
      <Card data-testid="trends-insight-panel">
        <CardContent>
          <p className="mb-3 text-caption text-ink-dim">
            {t("spendingTrends.insightSkeleton")}
          </p>
          <Skeleton
            rows={INSIGHT_SKELETON_ROWS}
            data-testid="trends-insight-skeleton"
          />
        </CardContent>
      </Card>
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
              className="mt-2"
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
    <Card data-testid="trends-insight-panel">
      <CardHeader>
        <h2 className="text-h2 text-ink">{data.headline}</h2>
        <CardAction>
          <Badge variant={TONE_VARIANT[data.tone]}>{data.window_label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-body text-ink-dim">{data.body}</p>
      </CardContent>
    </Card>
  );
}
