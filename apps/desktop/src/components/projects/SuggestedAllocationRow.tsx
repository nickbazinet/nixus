import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { Badge, Label, Meter, Money } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  useMaskProps,
  useValuesHidden,
} from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { ProjectAllocationSuggestion } from "@/lib/types";

export const ALLOCATION_OVERAGE_ID = "suggested-allocation-overage";

interface SuggestedAllocationRowProps {
  suggestion: ProjectAllocationSuggestion;
  valueCents: number;
  onChange: (cents: number) => void;
  hasOverage: boolean;
  striped?: boolean;
}

export function SuggestedAllocationRow({
  suggestion,
  valueCents,
  onChange,
  hasOverage,
  striped = false,
}: SuggestedAllocationRowProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { hidden } = useValuesHidden();

  const fieldId = `suggested-allocation-${suggestion.project_id}`;
  // The backend caps its *suggestion* at what the goal still needs, but deliberately over-funding a
  // goal is the user's call: this is a hint, never a block. FR7's only block is the surplus cap.
  const overFunding = valueCents > suggestion.remaining_cents;

  return (
    <div
      className={cn("rounded-md px-2 py-2", striped && "bg-hover")}
      data-testid="suggested-allocation-row"
    >
      <div className="mb-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={fieldId} data-testid="suggested-allocation-name">
            {t("projects.suggestionAmountLabel", {
              name: suggestion.project_name,
            })}
          </Label>
          <p className="text-caption text-ink-dim">
            <span data-testid="suggested-allocation-saved-target">
              <Money
                cents={suggestion.saved_cents}
                locale={i18n.language}
                {...maskProps}
              />
              <span aria-hidden="true"> / </span>
              <span className="sr-only"> {t("budget.ofSeparator")} </span>
              <Money
                cents={suggestion.target_cents}
                locale={i18n.language}
                {...maskProps}
              />
            </span>
            {suggestion.target_date !== null && (
              <span data-testid="suggested-allocation-target-date">
                {" · "}
                {format(parseISO(suggestion.target_date), "MMM d, yyyy")}
              </span>
            )}
            {suggestion.months_to_target !== null && (
              <span data-testid="suggested-allocation-months">
                {" · "}
                {t("projects.suggestionMonthsToTarget", {
                  count: suggestion.months_to_target,
                })}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="neutral" data-testid="suggested-allocation-remaining">
            {t("projects.remainingBadge", {
              amount: formatCurrency(suggestion.remaining_cents),
            })}
          </Badge>
          <div className="w-32">
            <MoneyInput
              id={fieldId}
              value={valueCents}
              onChange={onChange}
              aria-invalid={hasOverage}
              aria-describedby={
                hasOverage ? ALLOCATION_OVERAGE_ID : undefined
              }
            />
          </div>
        </div>
      </div>
      {suggestion.target_cents > 0 && (
        <Meter
          value={suggestion.saved_cents}
          max={suggestion.target_cents}
          label={t("projects.meterLabel", { name: suggestion.project_name })}
          valueText={
            hidden
              ? t("common.amountHidden")
              : t("projects.savedOfTarget", {
                  saved: formatCurrency(suggestion.saved_cents),
                  target: formatCurrency(suggestion.target_cents),
                })
          }
        />
      )}
      {overFunding && (
        <p
          className="text-caption text-ink-dim"
          data-testid="suggested-allocation-over-goal-hint"
        >
          {t("projects.suggestionExceedsRemaining")}
        </p>
      )}
    </div>
  );
}
