import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, Badge } from "@nixus/shared";
import { cn } from "@/lib/utils";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TrendsInsightResponse } from "@/lib/types";

interface TrendsInsightPanelProps {
  gatePassed: boolean;
  aiConfigured: boolean;
  insightQuery: UseQueryResult<TrendsInsightResponse, Error>;
}

function toneAccentClass(tone: string): string {
  switch (tone) {
    case "positive":
      return "border-teal-500/30 bg-teal-500/5";
    case "caution":
      return "border-amber-500/30 bg-amber-500/5";
    default:
      return "border-border bg-card";
  }
}

function InsightSkeleton() {
  return (
    <Card className="shadow-sm rounded-lg" data-testid="trends-insight-skeleton">
      <CardContent className="p-6 space-y-3">
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        <div className="h-3 w-full bg-muted animate-pulse rounded" />
        <div className="h-3 w-5/6 bg-muted animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

export function TrendsInsightPanel({
  gatePassed,
  aiConfigured,
  insightQuery,
}: TrendsInsightPanelProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch, isFetching } = insightQuery;

  if (!gatePassed) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="trends-insight-panel">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            {t("spendingTrends.insightGateEmpty")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!aiConfigured) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="trends-insight-panel">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            {t("spendingTrends.insightNotConfigured")}{" "}
            <Link
              to="/settings"
              className="text-primary underline"
              data-testid="trends-insight-settings-link"
            >
              {t("settings.openSettings")}
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isPending || (isFetching && !data)) {
    return (
      <div data-testid="trends-insight-panel">
        <p className="text-sm text-muted-foreground mb-2">
          {t("spendingTrends.insightSkeleton")}
        </p>
        <InsightSkeleton />
      </div>
    );
  }

  if (isError) {
    const appError = error as Error & { type?: string };
    return (
      <Card
        className="shadow-sm rounded-lg border-destructive/30"
        data-testid="trends-insight-error"
      >
        <CardContent className="p-6">
          <p className="text-sm text-destructive">
            {t("spendingTrends.insightError")}
          </p>
          {appError?.message && (
            <p className="mt-1 text-xs text-muted-foreground">{appError.message}</p>
          )}
          <button
            type="button"
            className="mt-3 text-sm text-primary underline"
            onClick={() => refetch()}
            data-testid="trends-insight-retry"
          >
            {t("spendingTrends.insightRetry")}
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Card
      className={cn("shadow-sm rounded-lg border", toneAccentClass(data.tone))}
      data-testid="trends-insight-panel"
    >
      <CardContent className="p-6 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-medium">{data.headline}</h3>
          <Badge variant="outline" className="shrink-0 text-xs">
            {data.window_label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{data.body}</p>
      </CardContent>
    </Card>
  );
}
