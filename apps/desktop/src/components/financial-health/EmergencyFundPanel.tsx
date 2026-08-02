import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Meter,
  Skeleton,
  Stat,
  focusRing,
  formatMoney,
} from "@nixus/shared";
import {
  useFinancialHealthDetail,
  useSetEmergencyFundTarget,
} from "@/hooks/useFinancialHealth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { EmergencyFundStatus } from "@/lib/types";

const MIN_TARGET_MONTHS = 1;
const MAX_TARGET_MONTHS = 24;

// Status is carried by the badge beside the figure, never by colouring the figure itself: the meter
// fill is always brand, because brand means brand and action and nothing else.
const statusBadgeVariant: Record<EmergencyFundStatus, "good" | "caution" | "over"> = {
  funded: "good",
  approaching: "caution",
  underfunded: "over",
};

function parseTargetMonths(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < MIN_TARGET_MONTHS || num > MAX_TARGET_MONTHS) {
    return null;
  }

  return num;
}

function EmergencyFundPanelSkeleton() {
  return (
    <Card data-testid="emergency-fund-panel-loading">
      <CardContent>
        {/* Title, figure, caption, meter, source line, savings-only note. */}
        <Skeleton rows={6} />
      </CardContent>
    </Card>
  );
}

export function EmergencyFundPanel() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useFinancialHealthDetail();
  const setTarget = useSetEmergencyFundTarget();

  const [editingTarget, setEditingTarget] = useState(false);
  const [draftTarget, setDraftTarget] = useState("");
  const [targetError, setTargetError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const emergencyFund = data?.emergency_fund;
  const figures = data?.figures;
  const targetMonths = emergencyFund?.target_months ?? 6;

  useEffect(() => {
    if (editingTarget) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingTarget]);

  useEffect(() => {
    if (!editingTarget) {
      setDraftTarget(String(targetMonths));
      setTargetError(null);
    }
  }, [targetMonths, editingTarget]);

  if (isPending) {
    return <EmergencyFundPanelSkeleton />;
  }

  if (!data?.data_sufficient || !emergencyFund || !figures) {
    return null;
  }

  const coverageMonths = emergencyFund.coverage_months ?? 0;
  const monthsCapped = coverageMonths >= 12;
  const monthsText = monthsCapped
    ? t("financialHealth.monthsCapped")
    : t("financialHealth.months", { months: coverageMonths.toFixed(1) });

  const efStatus = emergencyFund.status;
  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  const enterTargetEdit = () => {
    setDraftTarget(String(targetMonths));
    setTargetError(null);
    setEditingTarget(true);
  };

  const cancelTargetEdit = () => {
    setDraftTarget(String(targetMonths));
    setTargetError(null);
    setEditingTarget(false);
  };

  const saveTarget = () => {
    const parsed = parseTargetMonths(draftTarget);
    if (parsed === null) {
      setTargetError(t("financialHealth.validation.targetMonths"));
      return;
    }

    if (parsed === targetMonths) {
      setEditingTarget(false);
      return;
    }

    setTarget.mutate(parsed, {
      onSuccess: () => {
        toast.success(t("financialHealth.toast.targetUpdated"));
        setEditingTarget(false);
      },
      onError: () => {
        toast.error(t("toast.saveFailed"));
      },
    });
  };

  const handleTargetKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTarget();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelTargetEdit();
    }
  };

  return (
    <Card data-testid="emergency-fund-panel">
      <CardHeader>
        <CardTitle>{t("financialHealth.panel.cushion.title")}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* The one text-display figure on this surface — it answers "am I saving enough?". */}
        <div className="flex flex-wrap items-end gap-3">
          <Stat
            value={monthsText}
            caption={t("financialHealth.panel.cushion.coveredCaption", {
              target: targetMonths,
            })}
            data-testid="emergency-fund-months"
          />
          <Badge variant={statusBadgeVariant[efStatus]} className="mb-1">
            {t(`financialHealth.panel.cushion.status.${efStatus}`)}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <Meter
            className="flex-1"
            label={t("financialHealth.panel.cushion.meterLabel")}
            value={Math.min(emergencyFund.progress_ratio * 100, 100)}
            valueText={t("financialHealth.panel.cushion.meterValue", {
              months: monthsText,
              target: targetMonths,
            })}
            data-testid="emergency-fund-progress"
          />

          <div className="flex shrink-0 items-center gap-1.5 text-caption text-ink-dim">
            <span>{t("financialHealth.panel.cushion.targetLabel")}</span>
            {editingTarget ? (
              <div
                className="flex flex-col items-end gap-1"
                onKeyDown={handleTargetKeyDown}
              >
                <Input
                  ref={inputRef}
                  type="number"
                  min={MIN_TARGET_MONTHS}
                  max={MAX_TARGET_MONTHS}
                  step={1}
                  value={draftTarget}
                  onChange={(e) => {
                    setDraftTarget(e.target.value);
                    setTargetError(null);
                  }}
                  onKeyDown={handleTargetKeyDown}
                  aria-invalid={targetError ? true : undefined}
                  aria-describedby={targetError ? "emergency-fund-target-error" : undefined}
                  className="money h-7 w-16 text-right"
                  aria-label={t("financialHealth.panel.emergencyFund.targetEditLabel")}
                  data-testid="emergency-fund-target-input"
                />
                {targetError && (
                  <p
                    id="emergency-fund-target-error"
                    className="max-w-40 text-right text-caption text-over-ink"
                    data-testid="emergency-fund-target-error"
                  >
                    {targetError}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={enterTargetEdit}
                // The dotted underline is the required resting affordance: a keyboard-focus-only
                // user never triggers hover, so a hover-revealed pencil is not a substitute.
                className={cn(
                  "money min-h-target-min border-b border-dotted border-line-strong text-ink",
                  focusRing,
                )}
                aria-label={t("financialHealth.panel.emergencyFund.targetEditLabel")}
                data-testid="emergency-fund-target"
              >
                {t("financialHealth.panel.cushion.targetValue", { months: targetMonths })}
              </button>
            )}
          </div>
        </div>

        {/* Prose, not a formula. The shipped line stated the division outright, which is the exact
            copy this spine names as a failure. */}
        <p className="money text-body text-ink-dim" data-testid="emergency-fund-math-line">
          {t("financialHealth.panel.cushion.sourceLine", {
            liquid: money(figures.liquid_savings_cents),
            expenses: money(figures.avg_monthly_expenses_cents),
          })}
        </p>

        <p className="text-caption text-ink-faint">
          {t("financialHealth.panel.cushion.trailingNote", {
            months: figures.expense_month_count,
          })}
        </p>

        <p className="text-caption text-ink-faint">
          {t("financialHealth.panel.cushion.savingsOnlyNote")}
        </p>
      </CardContent>
    </Card>
  );
}
