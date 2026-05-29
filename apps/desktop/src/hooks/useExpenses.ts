import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { BudgetCategory, CreateExpenseInput, Expense, UpdateExpenseInput } from "@/lib/types";

export function useAllBudgetCategories() {
  return useQuery({
    queryKey: queryKeys.allBudgetCategories,
    queryFn: () => invoke<BudgetCategory[]>("get_all_budget_categories"),
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateExpenseInput) =>
      invoke<Expense>("create_expense", {
        merchant: input.merchant,
        amount_cents: input.amount_cents,
        budget_category_id: input.budget_category_id,
        date: input.date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
    },
  });
}

export function useExpensesByMonth(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.expensesByMonth(year, month),
    queryFn: () => invoke<Expense[]>("get_expenses", { year, month }),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateExpenseInput) =>
      invoke<Expense>("update_expense", {
        id: input.id,
        merchant: input.merchant,
        amount_cents: input.amount_cents,
        budget_category_id: input.budget_category_id,
        date: input.date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_expense", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
    },
  });
}

export function groupExpensesByCategory(
  expenses: Expense[]
): Record<number, Expense[]> {
  const grouped: Record<number, Expense[]> = {};
  for (const expense of expenses) {
    if (!grouped[expense.budget_category_id]) {
      grouped[expense.budget_category_id] = [];
    }
    grouped[expense.budget_category_id].push(expense);
  }
  return grouped;
}
