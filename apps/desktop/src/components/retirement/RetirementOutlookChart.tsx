import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUpIcon } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
} from "@nixus/shared";
import { LegendDot } from "@/components/charts/DonutBreakdown";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  SERIES_COLOR,
  insightsLocale,
  makeAxisTickFormatter,
  niceAxisScale,
} from "@/components/spending-trends/insights-chart";
import {
  CURRENT_PACE_TIER_INDEX,
  type RetirementMatrixResult,
} from "@/lib/retirement";

interface RetirementOutlookChartProps {
  matrix: RetirementMatrixResult;
  currentAge: number;
}

interface OutlookPoint {
  age: number;
  label: string;
  projectedCents: number;
  nestEggCents: number;
}

/**
 * The current-pace row of the grid, drawn: what you would have at each age against what retiring at
 * that age needs. The target line slopes DOWN — retiring later needs less, because the money has
 * fewer years to cover — and where the two cross is the age you can stop.
 *
 * Both series are in today's dollars, exactly as the grid shows them, so the chart and the table
 * below it can never disagree.
 */
export function RetirementOutlookChart({
  matrix,
  currentAge,
}: RetirementOutlookChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const gradientId = `${useId().replace(/:/g, "")}-outlook`;

  const { points, maxCents } = useMemo(() => {
    const row = matrix.rows[CURRENT_PACE_TIER_INDEX] ?? [];
    const rows: OutlookPoint[] = row.map((cell, index) => ({
      age: currentAge + cell.years,
      label: t("retirement.columnAge", { age: currentAge + cell.years }),
      projectedCents: cell.projectedValueTodayCents,
      nestEggCents:
        matrix.columnNestEggTodayCents[index] ?? cell.nestEggRequiredCents,
    }));

    return {
      points: rows,
      maxCents: rows.reduce(
        (max, row2) => Math.max(max, row2.projectedCents, row2.nestEggCents),
        0,
      ),
    };
  }, [matrix, currentAge, t]);

  if (points.length === 0) return null;

  const formatTick = makeAxisTickFormatter(maxCents, locale, hidden);
  // Anchored at zero: "what you would have" is an absolute amount, and the crossing with the
  // target line is only readable against a true baseline.
  const scale = niceAxisScale(0, maxCents);
  const last = points[points.length - 1];
  const paceLabel = t("retirement.v2.atYourPace");
  const targetLabel = t("retirement.v2.target");

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={TrendingUpIcon}>
          {t("retirement.v2.outlookTitle")}
        </CardTitle>
        <CardAction>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-dim">
            <span className="flex items-center gap-2">
              <LegendDot color={SERIES_COLOR.projected} />
              {paceLabel}
            </span>
            <span className="flex items-center gap-2">
              <LegendDot color={SERIES_COLOR.target} />
              {targetLabel}
            </span>
          </p>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* The plot is hidden from assistive tech; the list below carries the same numbers. */}
        <div
          className="h-80"
          data-testid="retirement-outlook-chart"
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 8, right: 28, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={SERIES_COLOR.projected}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={SERIES_COLOR.projected}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="label"
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={4}
              />
              <YAxis
                domain={scale.domain}
                ticks={scale.ticks}
                tickFormatter={formatTick}
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <Tooltip
                content={
                  <OutlookTooltip
                    locale={locale}
                    masked={hidden}
                    maskedLabel={maskProps.maskedLabel}
                    paceLabel={paceLabel}
                    targetLabel={targetLabel}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="projectedCents"
                stroke={SERIES_COLOR.projected}
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="nestEggCents"
                stroke={SERIES_COLOR.target}
                strokeWidth={2}
                strokeDasharray="6 5"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
              <ReferenceDot
                x={last.label}
                y={last.projectedCents}
                r={4.5}
                fill={SERIES_COLOR.projected}
                stroke="var(--card)"
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* A list rather than a table: the grid below is the page's only <table>, and the
         * retirement suite reads it positionally. */}
        <ul className="sr-only">
          {points.map((point) => (
            <li key={point.age}>
              {point.label}
              {" \u2014 "}
              {paceLabel}{" "}
              <Money
                cents={point.projectedCents}
                locale={locale}
                {...maskProps}
              />
              {", "}
              {targetLabel}{" "}
              <Money cents={point.nestEggCents} locale={locale} {...maskProps} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function OutlookTooltip({
  active,
  payload,
  locale,
  masked,
  maskedLabel,
  paceLabel,
  targetLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: OutlookPoint }>;
  locale: string;
  masked: boolean;
  maskedLabel: string;
  paceLabel: string;
  targetLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption text-ink shadow-float">
      <p className="text-label text-ink">{point.label}</p>
      <p className="mt-0.5 text-ink-dim">
        {paceLabel}{" "}
        <Money
          cents={point.projectedCents}
          locale={locale}
          masked={masked}
          maskedLabel={maskedLabel}
          className="text-ink"
        />
      </p>
      <p className="mt-0.5 text-ink-dim">
        {targetLabel}{" "}
        <Money
          cents={point.nestEggCents}
          locale={locale}
          masked={masked}
          maskedLabel={maskedLabel}
          className="text-ink"
        />
      </p>
    </div>
  );
}
