import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@nixus/shared";
import { useFinancialHealthDetail } from "@/hooks/useFinancialHealth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { cn } from "@/lib/utils";
import type { ReasoningParams, WaterfallStep } from "@/lib/types";

const WATERFALL_STEPS: WaterfallStep[] = [
  "build_emergency_fund",
  "pay_high_interest_debt",
  "contribute_registered_accounts",
  "invest_surplus",
];

type RungState = "completed" | "current" | "future";

function getRungState(
  step: WaterfallStep,
  currentStep: WaterfallStep,
  completedSteps: WaterfallStep[],
): RungState {
  if (completedSteps.includes(step)) return "completed";
  if (step === currentStep) return "current";
  return "future";
}

function formatCoverageMonths(months: number | null): string {
  if (months == null) return "—";
  if (months >= 12) return "12+";
  return months.toFixed(1);
}

function buildReasoningParams(
  params: ReasoningParams,
  formatCurrency: (cents: number) => string,
): Record<string, string | number> {
  const surplusCents = params.avg_monthly_surplus_cents;
  const surplusFormatted =
    surplusCents >= 0
      ? `+${formatCurrency(surplusCents)}`
      : formatCurrency(surplusCents);

  return {
    months: formatCoverageMonths(params.coverage_months),
    target: params.target_months,
    debt: formatCurrency(params.credit_card_debt_cents),
    surplus: surplusFormatted,
    liquid: formatCurrency(params.liquid_savings_cents),
    expenses: formatCurrency(params.avg_monthly_expenses_cents),
  };
}

function ActionWaterfallSkeleton() {
  return (
    <Card className="shadow-sm rounded-lg" data-testid="action-waterfall-loading">
      <CardContent className="p-6">
        <div className="h-4 w-40 bg-muted animate-pulse rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ActionWaterfall() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const { data, isPending } = useFinancialHealthDetail();
  const [whyExpanded, setWhyExpanded] = useState(false);

  if (isPending) {
    return <ActionWaterfallSkeleton />;
  }

  if (!data?.data_sufficient) {
    return null;
  }

  const waterfall = data.waterfall;

  return (
    <Card className="shadow-sm rounded-lg" data-testid="action-waterfall">
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground mb-4">
          {t("financialHealth.waterfall.title")}
        </p>

        <ol className="space-y-2" aria-label={t("financialHealth.waterfall.title")}>
          {WATERFALL_STEPS.map((step, index) => {
            const state = getRungState(
              step,
              waterfall.current_step,
              waterfall.completed_steps,
            );
            const isCurrent = state === "current";
            const stepLabel = t(`financialHealth.waterfall.steps.${step}`);

            return (
              <li
                key={step}
                className={cn(
                  "rounded-lg border px-4 py-3 transition-colors",
                  state === "completed" &&
                    "border-transparent bg-muted/40 text-muted-foreground",
                  state === "current" &&
                    "border-teal-500/60 ring-2 ring-teal-500/20 bg-background",
                  state === "future" &&
                    "border-transparent bg-muted/20 text-muted-foreground/70",
                )}
                data-testid={`waterfall-rung-${step}`}
                data-state={state}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sm",
                      state === "completed" && "text-teal-600 dark:text-teal-400",
                      state === "current" && "text-teal-600 dark:text-teal-400 font-bold",
                      state === "future" && "text-muted-foreground/50",
                    )}
                    aria-hidden="true"
                  >
                    {state === "completed" ? (
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                    ) : state === "current" ? (
                      "●"
                    ) : (
                      "○"
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          "text-sm leading-snug",
                          isCurrent ? "font-semibold text-foreground" : "font-medium",
                        )}
                      >
                        {index + 1}. {stepLabel}
                      </span>
                      {isCurrent && (
                        <span className="text-xs font-medium text-teal-600 dark:text-teal-400">
                          {t("financialHealth.waterfall.youAreHere")}
                        </span>
                      )}
                    </div>

                    {isCurrent && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setWhyExpanded((prev) => !prev)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          aria-expanded={whyExpanded}
                          data-testid="waterfall-why-toggle"
                        >
                          {t("financialHealth.waterfall.why")}
                          <ChevronDown
                            className={cn(
                              "h-3 w-3 transition-transform",
                              whyExpanded && "rotate-180",
                            )}
                            aria-hidden="true"
                          />
                        </button>

                        {whyExpanded && (
                          <p
                            className="mt-2 text-sm text-muted-foreground leading-relaxed"
                            data-testid="waterfall-reasoning"
                          >
                            {t(
                              `financialHealth.waterfall.reasoning.${waterfall.reasoning_key}`,
                              buildReasoningParams(
                                waterfall.reasoning_params,
                                formatCurrency,
                              ),
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
