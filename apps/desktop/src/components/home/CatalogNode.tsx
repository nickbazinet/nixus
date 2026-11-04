import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
  SubStat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  AreaSeriesChart,
  BarSeriesChart,
  LineSeriesChart,
  type ChartRow,
  type ChartSeries,
  type SeriesChartProps,
} from "@/components/charts/SeriesCharts";
import { PieShareChart } from "@/components/charts/PieShareChart";
import { SankeyFlowChart } from "@/components/charts/SankeyFlowChart";
import { formatMonthKey, insightsLocale } from "@/components/spending-trends/insights-chart";
import type { HomeDataset, HomeRenderNode } from "@/lib/types";

const OTHER_ROW_KEY = "__other__";

function rowsOf(data: HomeDataset, t: TFunction, locale: string): ChartRow[] {
  return data.rows.map((row) => ({
    key: row.key,
    label:
      row.key === OTHER_ROW_KEY
        ? t("home.otherRow")
        : data.dimension === "month"
          ? formatMonthKey(row.key, locale)
          : row.label,
    values: row.values,
  }));
}

function seriesOf(data: HomeDataset, t: TFunction): ChartSeries[] {
  return data.series.map((key) => ({ key, label: t(`home.series.${key}`) }));
}

function MetricView({ data, label }: { data: HomeDataset; label: string }) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const first = (index: number) => data.rows[index]?.values[0] ?? 0;

  if (data.dimension === "month") {
    const last = data.rows.length - 1;
    const caption =
      last >= 1
        ? t("home.metric.change", {
            change: formatMoney({ cents: first(last) - first(last - 1), locale, sign: "always" }),
            month: formatMonthKey(data.rows[last - 1].key, locale),
          })
        : undefined;
    return (
      <SubStat
        label={label}
        value={formatMoney({ cents: first(last), locale })}
        caption={maskProps.masked ? undefined : caption}
        {...maskProps}
        data-testid="home-metric"
      />
    );
  }

  const total = data.rows.reduce((sum, row) => sum + (row.values[0] ?? 0), 0);
  return (
    <SubStat
      label={label}
      value={formatMoney({ cents: total, locale })}
      caption={t("home.metric.total")}
      {...maskProps}
      data-testid="home-metric"
    />
  );
}

function formatDetail(column: string, value: string, locale: string): string {
  if (column !== "date") return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function TableView({ data }: { data: HomeDataset }) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const series = seriesOf(data, t);
  const rows = rowsOf(data, t, locale);
  // A date reads first in a ledger; every other text column follows the row's label.
  const columns = data.detail_columns.map((column, index) => ({ column, index }));
  const leading = columns.filter(({ column }) => column === "date");
  const trailing = columns.filter(({ column }) => column !== "date");
  const detailCell = (rowIndex: number, { column, index }: { column: string; index: number }) => (
    <TableCell key={column} dim={column === "date"}>
      {formatDetail(column, data.rows[rowIndex]?.details[index] ?? "", locale)}
    </TableCell>
  );

  return (
    <Table data-testid="home-table">
      <TableHeader>
        <TableRow>
          {leading.map(({ column }) => (
            <TableHead key={column}>{t(`home.detail.${column}`)}</TableHead>
          ))}
          <TableHead>{t(`home.dimension.${data.dimension}`)}</TableHead>
          {trailing.map(({ column }) => (
            <TableHead key={column}>{t(`home.detail.${column}`)}</TableHead>
          ))}
          {series.map((s) => (
            <TableHead key={s.key} numeric>
              {s.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rowIndex) => (
          <TableRow key={row.key}>
            {leading.map((detail) => detailCell(rowIndex, detail))}
            <TableCell>{row.label}</TableCell>
            {trailing.map((detail) => detailCell(rowIndex, detail))}
            {series.map((s, index) => (
              <TableCell key={s.key} numeric>
                <Money cents={row.values[index] ?? 0} locale={locale} {...maskProps} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The renderer's half of the closed catalog: a name maps to a trusted component or to nothing. */
const CHARTS: Record<string, (props: SeriesChartProps) => React.ReactNode> = {
  LineChart: LineSeriesChart,
  BarChart: BarSeriesChart,
  AreaChart: AreaSeriesChart,
  PieChart: PieShareChart,
};

function DisplayNode({
  node,
  label,
  accent,
}: {
  node: HomeRenderNode;
  label: string;
  accent?: number;
}) {
  const { t, i18n } = useTranslation();
  const data = node.data;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <p className="text-caption text-ink-dim" data-testid="home-node-empty">
        {t("home.widget.noData")}
      </p>
    );
  }

  if (node.component === "Metric") {
    return <MetricView data={data} label={node.title ?? t(`home.series.${data.series[0]}`)} />;
  }
  if (node.component === "Table") return <TableView data={data} />;
  // A flow dataset's rows are links, not values, so this chart takes the dataset itself.
  if (node.component === "SankeyChart") {
    return (
      <SankeyFlowChart
        data={data}
        caption={label}
        accent={accent}
        data-testid="home-chart-SankeyChart"
      />
    );
  }

  const Chart = CHARTS[node.component];
  if (!Chart) return null;
  return (
    <Chart
      rows={rowsOf(data, t, insightsLocale(i18n.language))}
      series={seriesOf(data, t)}
      dimensionLabel={t(`home.dimension.${data.dimension}`)}
      caption={label}
      accent={accent}
      data-testid={`home-chart-${node.component}`}
    />
  );
}

export function CatalogNode({
  node,
  fallbackLabel,
  showTitle = true,
  accent,
}: {
  node: HomeRenderNode;
  fallbackLabel: string;
  showTitle?: boolean;
  /** The owning widget's accent offset. Applies to the whole subtree. */
  accent?: number;
}) {
  const { t } = useTranslation();
  const label = node.title ?? fallbackLabel;

  // A node this build does not know (open question §8 #3): kept and named, never guessed at.
  if (node.unsupported) {
    return (
      <p className="text-caption text-ink-dim" data-testid="home-node-unsupported">
        {t("home.widget.unsupported")}
      </p>
    );
  }

  const heading = showTitle && node.title ? (
    <h3 className="text-label text-ink">{node.title}</h3>
  ) : null;
  const children = node.children.map((child, index) => (
    <CatalogNode key={index} node={child} fallbackLabel={label} accent={accent} />
  ));

  switch (node.component) {
    case "Card":
      return (
        <Card size="sm" data-testid="home-layout-Card">
          {node.title && showTitle ? (
            <CardHeader>
              <CardTitle>{node.title}</CardTitle>
            </CardHeader>
          ) : null}
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
      );
    case "Row":
      return (
        <div className="flex flex-col gap-2" data-testid="home-layout-Row">
          {heading}
          <div className="flex flex-col gap-4 md:flex-row [&>*]:min-w-0 [&>*]:flex-1">{children}</div>
        </div>
      );
    case "Column":
      return (
        <div className="flex flex-col gap-4" data-testid="home-layout-Column">
          {heading}
          {children}
        </div>
      );
    case "Grid":
      return (
        <div className="flex flex-col gap-2" data-testid="home-layout-Grid">
          {heading}
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${node.columns ?? 2}, minmax(0, 1fr))` }}
          >
            {children}
          </div>
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-2" data-testid={`home-node-${node.component}`}>
          {node.component !== "Metric" ? heading : null}
          <DisplayNode node={node} label={label} accent={accent} />
        </div>
      );
  }
}
