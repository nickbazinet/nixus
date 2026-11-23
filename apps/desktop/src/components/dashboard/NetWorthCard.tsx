import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Banknote,
  CreditCard,
  House,
  Landmark,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  IconChip,
  Money,
  focusRing,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import { NetWorthSparkline } from "@/components/dashboard/NetWorthSparkline";
import type { NetWorthCurrent, NetWorthSnapshotSummary } from "@/lib/types";

interface NetWorthCardProps {
  netWorth: NetWorthCurrent;
  snapshots: NetWorthSnapshotSummary[];
  /** This year's gain when the yearly summary can state one, else the snapshot-to-snapshot trend. */
  change?: { cents: number; label: string };
  /** Extra rows appended after the parts — today, the savings-goals row. */
  children?: ReactNode;
}

/**
 * One row of what the total is made of: a gradient chip, what it is, where it lives, and the
 * amount. A row that opens a surface is the whole row — never an amount beside a separate link.
 */
export function NetWorthPartRow({
  icon,
  title,
  subtitle,
  cents,
  sign,
  to,
  accessibleName,
  meter,
  "data-testid": testId,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  cents: number;
  sign?: "never";
  to?: LinkProps["to"];
  accessibleName?: string;
  meter?: ReactNode;
  "data-testid"?: string;
}) {
  const { i18n } = useTranslation();
  const { maskProps } = useValuesHidden();

  const body = (
    <>
      <IconChip icon={icon} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label text-ink">{title}</span>
        <span className="block truncate text-caption text-ink-dim">{subtitle}</span>
      </span>
      <Money
        cents={cents}
        locale={i18n.language}
        sign={sign}
        className="shrink-0 text-label font-bold text-ink"
        {...maskProps}
      />
    </>
  );

  const rowClass = "flex w-full items-center gap-3 py-3.5 text-left";

  return (
    <div className="border-b border-line last:border-b-0" data-testid={testId}>
      {to ? (
        <Link
          to={to}
          aria-label={accessibleName}
          className={cn(rowClass, "no-underline hover:bg-hover", focusRing)}
        >
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
      {meter && <div className="pb-3.5">{meter}</div>}
    </div>
  );
}

/**
 * Everything you have, broken into the four groups a person actually thinks in, under the total
 * and its direction for the year. The total is a `text-stat` figure, never a second
 * `text-display` one: Today's one display figure is the budget remainder.
 */
export function NetWorthCard({ netWorth, snapshots, change, children }: NetWorthCardProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();

  const rising = (change?.cents ?? 0) >= 0;
  const TrendIcon = rising ? TrendingUp : TrendingDown;

  return (
    <Card data-testid="metric-card">
      <CardHeader>
        <CardTitle icon={TrendingUp}>{t("nav.netWorth")}</CardTitle>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/wealth/net-worth" />}
            data-testid="net-worth-details-link"
          >
            {t("dashboard.v2.details")}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div className="money text-stat text-ink" data-testid="metric-value">
          <Money cents={netWorth.total_cents} locale={i18n.language} {...maskProps} />
        </div>
        {change && (
          <p
            className={cn(
              "mt-1.5 flex items-center gap-1.5 text-caption",
              rising ? "text-good-ink" : "text-over-ink",
            )}
            data-testid="net-worth-change"
          >
            <TrendIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {change.label}
          </p>
        )}

        {snapshots.length >= 2 && (
          <div className="mt-4">
            <NetWorthSparkline snapshots={snapshots} />
          </div>
        )}

        <div className="mt-4" aria-label={t("dashboard.v2.netWorthParts")} role="group">
          <NetWorthPartRow
            icon={Banknote}
            title={t("dashboard.cash")}
            subtitle={t("dashboard.v2.cashSubtitle")}
            cents={netWorth.cash_cents}
          />
          <NetWorthPartRow
            icon={Landmark}
            title={t("dashboard.investments")}
            subtitle={t("dashboard.v2.investmentsSubtitle")}
            cents={netWorth.investments_cents}
          />
          <NetWorthPartRow
            icon={House}
            title={t("dashboard.assets")}
            subtitle={t("dashboard.v2.assetsSubtitle")}
            cents={netWorth.assets_cents}
          />
          {/* Only when the backend actually reports something owed: a $0.00 debt row invents a
              liability the profile does not have. */}
          {netWorth.liabilities_cents > 0 && (
            <NetWorthPartRow
              icon={CreditCard}
              title={t("dashboard.v2.owe")}
              subtitle={t("dashboard.v2.oweSubtitle")}
              cents={-netWorth.liabilities_cents}
            />
          )}
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
