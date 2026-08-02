import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface MonthNavigatorProps {
  selectedYear: number;
  selectedMonth: number;
  onChange: (year: number, month: number) => void;
}

function getMonthName(
  month: number,
  locale: string,
  format: "short" | "long" = "long"
): string {
  // month is 1-based
  return new Date(2000, month - 1).toLocaleDateString(locale, { month: format });
}

function prevMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

function nextMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

export function MonthNavigator({ selectedYear, selectedMonth, onChange }: MonthNavigatorProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
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
      className={cn("flex items-center gap-2 rounded-md", focusRing)}
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
        aria-label={`${t("budget.goTo")} ${getMonthName(prevM, locale, "long")} ${prevY}`}
        data-testid="prev-month-button"
      >
        <ChevronLeft aria-hidden="true" />
        {getMonthName(prevM, locale, "short")}
      </Button>

      <span className="text-h3 text-ink" data-testid="current-month-label">
        {getMonthName(selectedMonth, locale)} {selectedYear}
      </span>

      <Button
        variant="ghost"
        size="sm"
        onClick={goNext}
        aria-label={`${t("budget.goTo")} ${getMonthName(nextM, locale, "long")} ${nextY}`}
        data-testid="next-month-button"
      >
        {getMonthName(nextM, locale, "short")}
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
