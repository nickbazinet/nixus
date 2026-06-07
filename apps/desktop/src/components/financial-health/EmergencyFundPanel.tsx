import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Input } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import {
  useFinancialHealthDetail,
  useSetEmergencyFundTarget,
} from "@/hooks/useFinancialHealth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { cn } from "@/lib/utils";
import type { EmergencyFundStatus } from "@/lib/types";

const MIN_TARGET_MONTHS = 1;
const MAX_TARGET_MONTHS = 24;

function formatCoverageMonths(months: number, cappedLabel: string): string {
  if (months >= 12) return cappedLabel;
  return months.toFixed(1);
}

function emergencyFundBarColor(status: EmergencyFundStatus): string {
  switch (status) {
    case "funded":
      return "bg-teal-500";
    case "approaching":
      return "bg-amber-500";
    case "underfunded":
      return "bg-rose-500";
  }
}

function emergencyFundTextColor(status: EmergencyFundStatus): string {
  switch (status) {
    case "funded":
      return "text-teal-600 dark:text-teal-400";
    case "approaching":
      return "text-amber-600 dark:text-amber-400";
    case "underfunded":
      return "text-rose-500";
  }
}

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
    <Card className="shadow-sm rounded-lg" data-testid="emergency-fund-panel-loading">
      <CardContent className="p-6">
        <div className="h-4 w-32 bg-muted animate-pulse rounded mb-4" />
        <div className="h-10 w-24 bg-muted animate-pulse rounded mb-3" />
        <div className="h-2.5 w-full bg-muted animate-pulse rounded mb-2" />
        <div className="h-3 w-64 bg-muted animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

export function EmergencyFundPanel() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
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
  const monthsDisplay = monthsCapped
    ? t("financialHealth.panel.emergencyFund.monthsCapped")
    : t("financialHealth.panel.emergencyFund.months", {
        months: formatCoverageMonths(
          coverageMonths,
          t("financialHealth.panel.emergencyFund.monthsCapped"),
        ),
      });

  const progressPercent = Math.min(emergencyFund.progress_ratio * 100, 100);
  const efStatus = emergencyFund.status;

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
    <Card className="shadow-sm rounded-lg" data-testid="emergency-fund-panel">
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground mb-3">
          {t("financialHealth.panel.emergencyFund.title")}
        </p>

        <p
          className={cn(
            "text-4xl font-mono font-medium mb-4",
            emergencyFundTextColor(efStatus),
          )}
          data-testid="emergency-fund-months"
        >
          {monthsDisplay}
        </p>

        <div className="flex items-center gap-2 mb-3">
          <div
            className="relative flex-1 h-2.5 rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            data-testid="emergency-fund-progress"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all",
                emergencyFundBarColor(efStatus),
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center text-xs text-muted-foreground font-mono whitespace-nowrap shrink-0">
            <span aria-hidden="true">│</span>
            {editingTarget ? (
              <div className="flex flex-col items-end gap-1" onKeyDown={handleTargetKeyDown}>
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
                  className="h-7 w-16 text-xs font-mono tabular-nums text-right"
                  aria-label={t("financialHealth.panel.emergencyFund.targetEditLabel")}
                  data-testid="emergency-fund-target-input"
                />
                {targetError && (
                  <p
                    className="text-xs text-destructive max-w-40 text-right"
                    data-testid="emergency-fund-target-error"
                  >
                    {targetError}
                  </p>
                )}
              </div>
            ) : (
              <span
                role="button"
                tabIndex={0}
                onClick={enterTargetEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    enterTargetEdit();
                  }
                }}
                className="cursor-pointer hover:underline decoration-dashed underline-offset-2"
                aria-label={t("financialHealth.panel.emergencyFund.targetEditLabel")}
                data-testid="emergency-fund-target"
              >
                {t("financialHealth.panel.emergencyFund.targetDisplay", {
                  months: targetMonths,
                })}
              </span>
            )}
          </div>
        </div>

        <p
          className="text-sm text-muted-foreground font-mono"
          data-testid="emergency-fund-math-line"
        >
          {t("financialHealth.panel.emergencyFund.mathLine", {
            liquid: formatCurrency(figures.liquid_savings_cents),
            expenses: formatCurrency(figures.avg_monthly_expenses_cents),
          })}
        </p>

        <p className="text-xs text-muted-foreground mt-2">
          {t("financialHealth.panel.emergencyFund.guideline")}
        </p>
      </CardContent>
    </Card>
  );
}
