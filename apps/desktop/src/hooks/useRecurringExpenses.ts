import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  RecurringExpenseTemplate,
  CreateRecurringExpenseTemplateInput,
  UpdateRecurringExpenseTemplateInput,
  Expense,
} from "@/lib/types";

export function useRecurringTemplates() {
  return useQuery({
    queryKey: queryKeys.recurringTemplates,
    queryFn: () => invoke<RecurringExpenseTemplate[]>("get_recurring_templates"),
  });
}

export function useCreateRecurringTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRecurringExpenseTemplateInput) =>
      invoke<RecurringExpenseTemplate>("create_recurring_template", {
        merchant: input.merchant,
        amount_cents: input.amount_cents,
        budget_category_id: input.budget_category_id,
        day_of_month: input.day_of_month,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurringTemplates });
    },
  });
}

export function useUpdateRecurringTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateRecurringExpenseTemplateInput) =>
      invoke<RecurringExpenseTemplate>("update_recurring_template", {
        id: input.id,
        merchant: input.merchant,
        amount_cents: input.amount_cents,
        budget_category_id: input.budget_category_id,
        day_of_month: input.day_of_month,
        is_active: input.is_active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurringTemplates });
    },
  });
}

export function useDeleteRecurringTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_recurring_template", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurringTemplates });
    },
  });
}

export function useApplyRecurringExpenses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      invoke<Expense[]>("apply_recurring_expenses", { year, month }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      queryClient.invalidateQueries({ queryKey: ["budget-status"] });
    },
  });
}
