import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Money,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import type { NetWorthBreakdownCategory } from "@/lib/types";

interface NetWorthBreakdownBarProps {
  breakdown: NetWorthBreakdownCategory[];
  isLoading?: boolean;
  titleKey?: string;
}

/**
 * The eight-step ramp exists because this bar carries seven real segments (RRSP, TFSA,
 * Non-Registered, Savings, FHSA, Chequing, Crypto) and the previous five-colour ramp wrapped,
 * producing two indistinguishable purples and two indistinguishable greens.
 */
const RAMP_STEPS = 8;

/**
 * Bare registered-account acronyms arrive here from three separate builders, one of which hardcodes
 * English labels in a file this component cannot reach. Routing every label through the shared type
 * keys is the only place that covers all three paths — a bar reading `RRSP · TFSA · FHSA` with no
 * expansion anywhere is exactly the acronym wall the expansion rule exists to prevent.
 */
const ACRONYM_LABEL_KEYS: Record<string, string> = {
  TFSA: "accounts.typeTFSA",
  RRSP: "accounts.typeRRSP",
  FHSA: "accounts.typeFHSA",
  CELI: "accounts.typeTFSA",
  REER: "accounts.typeRRSP",
  CELIAPP: "accounts.typeFHSA",
};

interface RankedSegment {
  name: string;
  cents: number;
  share: number;
  step: number;
}

export function NetWorthBreakdownBar({
  breakdown,
  isLoading,
  titleKey = "netWorth.breakdown",
}: NetWorthBreakdownBarProps) {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();

  const formatShare = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: "percent",
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );

  const segments = useMemo<RankedSegment[]>(() => {
    const magnitudeTotal = breakdown.reduce(
      (sum, category) => sum + Math.abs(category.cents),
      0
    );
    if (magnitudeTotal === 0) return [];

    // Rank order — largest first — is half of what makes adjacency safe: paired with the ramp's
    // alternating luminance it guarantees neighbours separate by lightness, not hue alone. The
    // incoming `color` field is deliberately discarded, because a colour pinned to a category
    // identity is what put two same-luminance purples beside each other in the first place.
    return [...breakdown]
      .sort((first, second) => Math.abs(second.cents) - Math.abs(first.cents))
      .map((category, rank) => ({
        name: category.name,
        cents: category.cents,
        share: (Math.abs(category.cents) / magnitudeTotal) * 100,
        // Past eight segments the long tail reuses the warm neutral rather than wrapping the ramp:
        // more than eight steps reintroduces indistinguishable neighbours.
        step: Math.min(rank + 1, RAMP_STEPS),
      }));
  }, [breakdown]);

  const expandLabel = (name: string) => {
    const key = ACRONYM_LABEL_KEYS[name.toUpperCase()];
    return key ? t(key) : name;
  };

  const hasRegisteredAccount = segments.some(
    (segment) => ACRONYM_LABEL_KEYS[segment.name.toUpperCase()] !== undefined
  );

  if (isLoading) {
    return (
      <Card data-testid="breakdown-bar-card">
        <CardHeader>
          <CardTitle>{t(titleKey)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton rows={1} />
        </CardContent>
      </Card>
    );
  }

  if (segments.length === 0) return null;

  return (
    <Card data-testid="breakdown-bar-card">
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardDescription>{t("netWorth.breakdown.orderNote")}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Presentational: the bar carries proportion, the table below carries every label, figure
         * and share. Above five segments a colour key the user has to cross-reference is a failure,
         * so there is no key — the table is the direct label, in the same order as the bands. */}
        <div
          className="flex h-6 overflow-hidden rounded-sm bg-track"
          aria-hidden="true"
          data-testid="breakdown-bar"
        >
          {segments.map((segment, index) => (
            <div
              key={segment.name}
              data-chart-segment=""
              data-testid="breakdown-segment"
              style={{
                flexGrow: segment.share,
                flexBasis: 0,
                minWidth: 2,
                backgroundColor: `var(--chart-${segment.step})`,
                // The 1px card divider is load-bearing, not decoration: chart-3 and chart-7 sit at
                // exactly 1.00:1 to each other, so this is the only thing guaranteeing a
                // perceivable boundary when those two land side by side.
                borderLeft: index > 0 ? "1px solid var(--card)" : undefined,
              }}
            />
          ))}
        </div>

        <Table className="mt-4" data-testid="breakdown-legend">
          <caption className="sr-only">
            {t("netWorth.breakdown.tableCaption")}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("netWorth.breakdown.colType")}</TableHead>
              <TableHead numeric>{t("netWorth.breakdown.colAmount")}</TableHead>
              <TableHead numeric>{t("netWorth.breakdown.colShare")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {segments.map((segment) => (
              <TableRow key={segment.name} data-testid="legend-item">
                <TableCell>{expandLabel(segment.name)}</TableCell>
                <TableCell numeric>
                  <Money
                    cents={segment.cents}
                    locale={i18n.language}
                    {...maskProps}
                  />
                </TableCell>
                <TableCell numeric dim>
                  {formatShare.format(segment.share / 100)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {hasRegisteredAccount && (
          <p className="mt-3 text-caption text-ink-dim">
            {t("netWorth.breakdown.registeredNote")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
