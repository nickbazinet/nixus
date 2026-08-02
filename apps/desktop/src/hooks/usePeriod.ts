import { useCallback, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

interface Period {
  year: number;
  /** 1-based, matching every backend command's `month` argument. */
  month: number;
}

interface PeriodState extends Period {
  setPeriod: (year: number, month: number) => void;
  /** Localized "March 2026", for the destination header. */
  label: string;
  /** `2026-03`, the wire format for the URL and for backend month keys. */
  key: string;
}

const PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;

function currentPeriod(): Period {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parsePeriod(raw: unknown): Period | null {
  if (typeof raw !== "string") return null;
  const match = PERIOD_PATTERN.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function formatPeriodKey({ year, month }: Period): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Parses `?period=YYYY-MM`, falling back to today. Exported for the root route's validateSearch. */
export function normalizePeriodParam(raw: unknown): string | undefined {
  const parsed = parsePeriod(raw);
  return parsed ? formatPeriodKey(parsed) : undefined;
}

// One period for the whole product, held in the URL rather than in component state.
//
// Three surfaces each kept their own `useState` month, so choosing March on Today and clicking
// Budget silently returned you to the current month — "review last month" was structurally broken,
// and it is the first thing a spreadsheet user tries. Living in the URL also makes back and forward
// work, which component state cannot do.
//
// The param is only written once the user actually changes period, so a freshly opened window has a
// clean URL and still reads as the current month.
export function usePeriod(): PeriodState {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const rawPeriod = useRouterState({
    select: (state) => (state.location.search as Record<string, unknown>).period,
  });

  const period = useMemo(() => parsePeriod(rawPeriod) ?? currentPeriod(), [rawPeriod]);

  const setPeriod = useCallback(
    (year: number, month: number) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          period: formatPeriodKey({ year, month }),
        }),
      });
    },
    [navigate]
  );

  const label = useMemo(
    () =>
      new Date(period.year, period.month - 1).toLocaleDateString(i18n.language, {
        month: "long",
        year: "numeric",
      }),
    [period, i18n.language]
  );

  return {
    ...period,
    setPeriod,
    label,
    key: formatPeriodKey(period),
  };
}

export type { Period, PeriodState };
