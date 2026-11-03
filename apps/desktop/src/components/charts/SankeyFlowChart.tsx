import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { Money } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  SEGMENT_DIVIDER,
  insightsLocale,
  rampColor,
} from "@/components/spending-trends/insights-chart";
import type { HomeDataset } from "@/lib/types";
import { ChartTableEquivalent } from "./ChartTableEquivalent";

/** The nodes `db::home_surface` names itself: they arrive label-less and are named here instead. */
const APP_NODE_LABELS: Record<string, string> = {
  __income__: "home.flow.income",
  __unspent__: "home.flow.unspent",
  __other__: "home.otherRow",
};

interface FlowLink {
  source: number;
  target: number;
  value: number;
}

function nodeName(key: string, label: string, t: TFunction): string {
  if (label !== "") return label;
  const appLabel = APP_NODE_LABELS[key];
  return appLabel ? t(appLabel) : key;
}

/**
 * The flow rows turned into the node list and index-based link list recharts' Sankey wants. Nodes
 * are collected in first-appearance order, which the resolver already orders meaningfully (income
 * sources, then categories largest first), so colouring by index reads as a ranking.
 */
function toGraph(data: HomeDataset, t: TFunction): { names: string[]; links: FlowLink[] } {
  const column = (name: string) => data.detail_columns.indexOf(name);
  const fromColumn = column("flow_from");
  const toColumn = column("flow_to");
  const fromLabelColumn = column("flow_from_label");
  const toLabelColumn = column("flow_to_label");
  if (fromColumn < 0 || toColumn < 0) return { names: [], links: [] };

  const index = new Map<string, number>();
  const names: string[] = [];
  const indexOf = (key: string, labelColumn: number, details: string[]): number => {
    const found = index.get(key);
    if (found !== undefined) return found;
    const next = names.length;
    index.set(key, next);
    names.push(nodeName(key, labelColumn < 0 ? "" : (details[labelColumn] ?? ""), t));
    return next;
  };

  const links: FlowLink[] = [];
  for (const row of data.rows) {
    const value = row.values[0] ?? 0;
    const from = row.details[fromColumn] ?? "";
    const to = row.details[toColumn] ?? "";
    // A band needs a positive amount and two distinct ends; a self-link would be a cycle, which
    // the layout cannot resolve.
    if (value <= 0 || from === "" || to === "" || from === to) continue;
    links.push({
      source: indexOf(from, fromLabelColumn, row.details),
      target: indexOf(to, toLabelColumn, row.details),
      value,
    });
  }

  return { names, links };
}

const LABEL_GAP = 8;

/**
 * A node's rectangle and its name, placed so it never crosses a ribbon: left of a node money only
 * leaves, right of a node money only reaches, and above a node with ribbons on both sides.
 */
function FlowNodeShape({
  x,
  y,
  width,
  height,
  index,
  payload,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: { name: string; sourceLinks: number[]; targetLinks: number[] };
}) {
  // Named from the node's own side rather than the link's: recharts fills `targetLinks` with the
  // links running TO this node's targets, so those are its outgoing bands, and `sourceLinks` with
  // the ones arriving from its sources.
  const flowsIn = payload.sourceLinks.length > 0;
  const flowsOut = payload.targetLinks.length > 0;
  const isHub = flowsIn && flowsOut;

  return (
    <g>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={isHub ? "var(--ink-dim)" : rampColor(index)}
        stroke={SEGMENT_DIVIDER}
        strokeWidth={1}
        radius={2}
      />
      {isHub ? (
        <text
          x={x + width / 2}
          y={y - LABEL_GAP}
          textAnchor="middle"
          className="fill-ink text-caption"
        >
          {payload.name}
        </text>
      ) : (
        <text
          x={flowsIn ? x + width + LABEL_GAP : x - LABEL_GAP}
          y={y + height / 2}
          textAnchor={flowsIn ? "start" : "end"}
          dominantBaseline="middle"
          className="fill-ink-dim text-caption"
        >
          {payload.name}
        </text>
      )}
    </g>
  );
}

/**
 * Money as it moves: each band's thickness is the amount flowing from one node to the next. Its
 * rows are links rather than standalone values, so this is the one chart that reads the dataset's
 * `details` instead of the rows-and-series props the other charts share.
 */
export function SankeyFlowChart({
  data,
  caption,
  "data-testid": testId,
}: {
  data: HomeDataset;
  caption: string;
  "data-testid"?: string;
}) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const { names, links } = toGraph(data, t);

  if (links.length === 0 || names.length < 2) {
    return (
      <p className="text-caption text-ink-dim" data-testid="home-chart-SankeyChart-empty">
        {t("home.widget.noData")}
      </p>
    );
  }

  const amountKey = data.series[0] ?? "amount";
  const tableRows = links.map((link, position) => ({
    key: `${link.source}>${link.target}>${position}`,
    label: `${names[link.source] ?? ""} \u2192 ${names[link.target] ?? ""}`,
    values: [link.value],
  }));

  return (
    <div>
      <div className="h-72" aria-hidden="true" data-testid={testId}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes: names.map((name) => ({ name })), links }}
            nodeWidth={12}
            nodePadding={18}
            iterations={64}
            margin={{ top: 20, right: 140, bottom: 8, left: 140 }}
            node={(props) => <FlowNodeShape {...props} />}
            // A ribbon is a bezier STROKED at the band's width, so its colour is the stroke and
            // its width is recharts' own `linkWidth`; setting a fill here would draw a lens
            // instead of a band.
            link={{ stroke: "var(--ink)", strokeOpacity: 0.2 }}
          >
            <Tooltip
              content={({ active, payload }) => {
                const band = payload?.[0]?.payload?.payload as
                  | { source?: { name?: string }; target?: { name?: string }; value?: number }
                  | undefined;
                if (!active || !band?.source || !band?.target) return null;
                return (
                  <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption text-ink shadow-float">
                    <p className="text-label text-ink">
                      {band.source.name} {"\u2192"} {band.target.name}
                    </p>
                    <Money cents={band.value ?? 0} locale={locale} {...maskProps} />
                  </div>
                );
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <ChartTableEquivalent
        rows={tableRows}
        series={[{ key: amountKey, label: t(`home.series.${amountKey}`) }]}
        dimensionLabel={t("home.dimension.flow")}
        caption={caption}
      />
    </div>
  );
}
