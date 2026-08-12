import { useTranslation } from "react-i18next";
import { format, parseISO } from "date-fns";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { SuggestionSettlement } from "@/lib/types";

interface SettledAllocationCardProps {
  settlement: SuggestionSettlement;
  remainingSurplusCents: number;
  nextSuggestionDate: string;
  hasOpenSuggestions: boolean;
  onReopen: () => void;
}

function monthLabel(month: string) {
  return format(parseISO(`${month}-01`), "MMMM yyyy");
}

// Same `Card` slot as the active panel so settling the month does not shift the page, but
// deliberately without the `border-l-brand` accent: that accent marks "do this now", and a settled
// month is a receipt. The title drops to `text-h3` for the same reason.
export function SettledAllocationCard({
  settlement,
  remainingSurplusCents,
  nextSuggestionDate,
  hasOpenSuggestions,
  onReopen,
}: SettledAllocationCardProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();

  const confirmed = settlement.settled_by === "confirm";
  const nextLine = t("projects.suggestionSettledNext", {
    date: format(parseISO(nextSuggestionDate), "MMMM d"),
  });

  const title = confirmed
    ? t("projects.suggestionSettledConfirmedTitle")
    : t("projects.suggestionSettledSkippedTitle");

  const body =
    settlement.settled_by === "confirm"
      ? t("projects.suggestionSettledConfirmedBody", {
          date: format(parseISO(settlement.settled_date), "MMMM d"),
          amount: formatCurrency(settlement.confirmed_total_cents),
          count: settlement.confirmed_project_count,
        })
      : t("projects.suggestionSettledSkippedBody", {
          month: monthLabel(settlement.settled_month),
        });

  // The second line answers the follow-up each state actually raises: after a confirm, "where does
  // the rest of my surplus stand?"; after a skip, "when does this come back?".
  const secondLine = confirmed
    ? remainingSurplusCents > 0
      ? t("projects.suggestionSettledRemainder", {
          amount: formatCurrency(remainingSurplusCents),
        })
      : t("projects.suggestionSettledFullyAllocated")
    : nextLine;

  return (
    <Card className="mb-section-gap" data-testid="settled-allocation-card">
      <CardHeader className="flex-row items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${
            confirmed
              ? "bg-good-bg text-good-ink"
              : "bg-neutral-bg text-neutral-ink"
          }`}
        >
          {confirmed ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <CalendarClock className="size-4" />
          )}
        </span>
        <CardTitle className="text-h3" data-testid="settled-allocation-title">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className="text-caption text-ink-dim"
          data-testid="settled-allocation-body"
        >
          {body}
        </p>
        <p
          className="text-caption text-ink-dim"
          data-testid="settled-allocation-second-line"
        >
          {secondLine}
        </p>
      </CardContent>
      <CardFooter className="items-center justify-between gap-3">
        <p
          className="text-caption text-ink-dim"
          data-testid="settled-allocation-hint"
        >
          {confirmed && hasOpenSuggestions
            ? t("projects.suggestionSettledNewGoals")
            : nextLine}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReopen}
          data-testid="settled-allocation-reopen"
        >
          {confirmed
            ? t("projects.suggestionSettledAdjust")
            : t("projects.suggestionSettledShow")}
        </Button>
      </CardFooter>
    </Card>
  );
}
