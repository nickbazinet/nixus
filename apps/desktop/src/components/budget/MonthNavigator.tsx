import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@nixus/shared";

interface MonthNavigatorProps {
  selectedYear: number;
  selectedMonth: number;
  onChange: (year: number, month: number) => void;
}

function getMonthName(month: number, format: "short" | "long" = "long"): string {
  // month is 1-based
  return new Date(2000, month - 1).toLocaleDateString("en-US", { month: format });
}

function prevMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

function nextMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

export function MonthNavigator({ selectedYear, selectedMonth, onChange }: MonthNavigatorProps) {
  const { t } = useTranslation();
  const [prevY, prevM] = prevMonth(selectedYear, selectedMonth);
  const [nextY, nextM] = nextMonth(selectedYear, selectedMonth);

  const goPrev = useCallback(() => onChange(prevY, prevM), [onChange, prevY, prevM]);
  const goNext = useCallback(() => onChange(nextY, nextM), [onChange, nextY, nextM]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext],
  );

  return (
    <div
      className="flex items-center gap-2"
      role="navigation"
      aria-label={t("budget.monthNavigation")}
      data-testid="month-navigator"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={goPrev}
        aria-label={`${t("budget.goTo")} ${getMonthName(prevM, "long")} ${prevY}`}
        data-testid="prev-month-button"
      >
        <ChevronLeft className="size-4 mr-1" />
        {getMonthName(prevM, "short")}
      </Button>

      <span className="font-semibold text-foreground" data-testid="current-month-label">
        {getMonthName(selectedMonth)} {selectedYear}
      </span>

      <Button
        variant="ghost"
        size="sm"
        onClick={goNext}
        aria-label={`${t("budget.goTo")} ${getMonthName(nextM, "long")} ${nextY}`}
        data-testid="next-month-button"
      >
        {getMonthName(nextM, "short")}
        <ChevronRight className="size-4 ml-1" />
      </Button>
    </div>
  );
}
