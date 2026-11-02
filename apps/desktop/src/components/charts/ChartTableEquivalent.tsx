import { useTranslation } from "react-i18next";
import {
  Money,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import type { ChartRow, ChartSeries } from "./SeriesCharts";

/** A chart's table equivalent. Visually hidden, fully in the accessible tree. */
export function ChartTableEquivalent({
  rows,
  series,
  dimensionLabel,
  caption,
}: {
  rows: ChartRow[];
  series: ChartSeries[];
  dimensionLabel: string;
  caption: string;
}) {
  const { i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  return (
    <div className="sr-only">
      <Table>
        <caption>{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{dimensionLabel}</TableHead>
            {series.map((s) => (
              <TableHead key={s.key} numeric>
                {s.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{row.label}</TableCell>
              {series.map((s, index) => (
                <TableCell key={s.key} numeric>
                  <Money cents={row.values[index] ?? 0} locale={locale} {...maskProps} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
