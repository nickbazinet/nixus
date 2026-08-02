import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  focusRing,
  formatMoney,
} from "@nixus/shared";
import { useFinancialHealthDetail } from "@/hooks/useFinancialHealth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
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
  money: (cents: number, sign?: "auto" | "always") => string,
): Record<string, string | number> {
  return {
    months: formatCoverageMonths(params.coverage_months),
    target: params.target_months,
    debt: money(params.credit_card_debt_cents),
    // Signed: a shortfall and a surplus read identically otherwise.
    surplus: money(params.avg_monthly_surplus_cents, "always"),
    liquid: money(params.liquid_savings_cents),
    expenses: money(params.avg_monthly_expenses_cents),
  };
}

function ActionWaterfallSkeleton() {
  return (
    <Card data-testid="action-waterfall-loading">
      <CardContent>
        {/* One row per rung — a hardcoded count is what makes the list jump when data lands. */}
        <Skeleton rows={WATERFALL_STEPS.length} />
      </CardContent>
    </Card>
  );
}

const numeralClasses: Record<RungState, string> = {
  completed: "bg-good-bg text-good-ink",
  current: "bg-brand text-brand-on",
  future: "bg-neutral-bg text-neutral-ink",
};

export function ActionWaterfall() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useFinancialHealthDetail();
  const [whyExpanded, setWhyExpanded] = useState(false);

  if (isPending) {
    return <ActionWaterfallSkeleton />;
  }

  if (!data?.data_sufficient) {
    return null;
  }

  const waterfall = data.waterfall;
  const amountHidden = t("common.amountHidden");
  const money = (cents: number, sign: "auto" | "always" = "auto") =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language, sign });

  return (
    <Card data-testid="action-waterfall">
      <CardHeader>
        <CardTitle>{t("financialHealth.waterfall.orderOfOperations")}</CardTitle>
      </CardHeader>

      <CardContent>
        <ol aria-label={t("financialHealth.waterfall.orderOfOperations")}>
          {WATERFALL_STEPS.map((step, index) => {
            // The waterfall is deterministic and backend-owned: this renders `current_step` and
            // never re-derives which rung should be highlighted.
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
                  "flex gap-3 border-b border-line py-3.5 last:border-b-0",
                  // {components.action-card} — the only brand-tinted treatment on this surface, on
                  // exactly one rung. Its scarcity is what makes it read as "do this".
                  isCurrent &&
                    "-mx-card-pad border-l-3 border-l-brand bg-brand-soft px-card-pad",
                )}
                data-testid={`waterfall-rung-${step}`}
                data-state={state}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-caption",
                    numeralClasses[state],
                  )}
                  aria-hidden="true"
                >
                  {state === "completed" ? (
                    <Check className="size-3.5" strokeWidth={2.5} />
                  ) : (
                    index + 1
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "text-h3",
                        state === "future" ? "text-ink-dim" : "text-ink",
                      )}
                    >
                      {stepLabel}
                    </span>
                    {state === "completed" && (
                      <Badge variant="good">{t("financialHealth.waterfall.done")}</Badge>
                    )}
                    {isCurrent && (
                      <Badge variant="caution">
                        {t("financialHealth.waterfall.youreHere")}
                      </Badge>
                    )}
                    {state === "future" && (
                      <span className="sr-only">
                        {t("financialHealth.waterfall.comesLater")}
                      </span>
                    )}
                  </div>

                  {isCurrent && (
                    <div className="mt-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setWhyExpanded((prev) => !prev)}
                        className={cn(
                          "inline-flex w-fit min-h-target-min items-center gap-1 text-label text-brand-ink hover:underline",
                          focusRing,
                        )}
                        aria-expanded={whyExpanded}
                        data-testid="waterfall-why-toggle"
                      >
                        {t("financialHealth.waterfall.whyThisFirst")}
                        <ChevronDown
                          className={cn(
                            "size-3 transition-transform",
                            whyExpanded && "rotate-180",
                          )}
                          aria-hidden="true"
                        />
                      </button>

                      {whyExpanded && (
                        <p
                          className="money text-body text-ink-dim"
                          data-testid="waterfall-reasoning"
                        >
                          {t(
                            `financialHealth.waterfall.reasoning.${waterfall.reasoning_key}`,
                            buildReasoningParams(waterfall.reasoning_params, money),
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
