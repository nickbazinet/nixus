import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { BudgetSummary, DashboardBudgetCategory, SpendingByCategory } from "@/lib/types";

export function useBudgetSummary(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.budgetSummary(year, month),
    queryFn: () =>
      invoke<BudgetSummary>("get_budget_summary", { year, month }),
  });
}

export function useTopBudgetCategories(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.topBudgetCategories(year, month),
    queryFn: () =>
      invoke<DashboardBudgetCategory[]>("get_top_budget_categories", {
        year,
        month,
        limit: 5,
      }),
  });
}

export function useSpendingBreakdown(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.spendingBreakdown(year, month),
    queryFn: () =>
      invoke<SpendingByCategory[]>("get_spending_breakdown", { year, month }),
  });
}
