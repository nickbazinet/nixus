import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/lib/constants";
import type { AiAvailability } from "@/hooks/useAiConfig";
import type { CategoryCompareRow, TrendsInsightResponse } from "@/lib/types";

const INSIGHT_STALE_MS = 15 * 60_000;
const DEBOUNCE_MS = 400;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function useInsightGate(categoryCompare: CategoryCompareRow[]) {
  return (
    categoryCompare.length > 0 &&
    categoryCompare.some((row) => (row.target_cents ?? 0) > 0)
  );
}

interface UseTrendsInsightOptions {
  months: number;
  windowLabel: string;
  categoryCompare: CategoryCompareRow[];
  availability: AiAvailability;
  gatePassed: boolean;
}

export function useTrendsInsight({
  months,
  windowLabel,
  categoryCompare,
  availability,
  gatePassed,
}: UseTrendsInsightOptions) {
  const { i18n } = useTranslation();
  const debouncedMonths = useDebouncedValue(months, DEBOUNCE_MS);
  const debouncedLocale = useDebouncedValue(i18n.language, DEBOUNCE_MS);
  const debouncedWindowLabel = useDebouncedValue(windowLabel, DEBOUNCE_MS);
  const debouncedCategories = useDebouncedValue(categoryCompare, DEBOUNCE_MS);

  // The request body carries the debounced categories, so the gate must be evaluated on that same
  // snapshot. Gating on the live array fires the first request with the still-empty debounced
  // value, which the backend rejects with "No category compare data provided".
  const debouncedGatePassed = useInsightGate(debouncedCategories);
  const enabled = gatePassed && debouncedGatePassed && availability === "available";

  return useQuery({
    queryKey: queryKeys.trendsInsight(debouncedMonths, debouncedLocale),
    queryFn: () =>
      invoke<TrendsInsightResponse>("generate_trends_insight", {
        months: debouncedMonths,
        window_label: debouncedWindowLabel,
        locale: debouncedLocale.startsWith("fr") ? "fr" : "en",
        categories: debouncedCategories,
      }),
    enabled,
    staleTime: INSIGHT_STALE_MS,
    retry: false,
  });
}
