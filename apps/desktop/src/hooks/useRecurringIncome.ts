import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  RecurringIncomeTemplate,
  CreateRecurringIncomeTemplateInput,
  UpdateRecurringIncomeTemplateInput,
} from "@/lib/types";

export function useRecurringIncomeTemplates() {
  return useQuery({
    queryKey: queryKeys.recurringIncomeTemplates,
    queryFn: () =>
      invoke<RecurringIncomeTemplate[]>("get_recurring_income_templates"),
  });
}

export function useCreateRecurringIncomeTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRecurringIncomeTemplateInput) =>
      invoke<RecurringIncomeTemplate>("create_recurring_income_template", {
        source_id: input.source_id,
        amount_cents: input.amount_cents,
        day_of_month: input.day_of_month,
        account_id: input.account_id ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.recurringIncomeTemplates,
      });
    },
  });
}

export function useUpdateRecurringIncomeTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateRecurringIncomeTemplateInput) =>
      invoke<RecurringIncomeTemplate>("update_recurring_income_template", {
        id: input.id,
        source_id: input.source_id,
        amount_cents: input.amount_cents,
        day_of_month: input.day_of_month,
        account_id: input.account_id ?? null,
        is_active: input.is_active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.recurringIncomeTemplates,
      });
    },
  });
}

export function useDeleteRecurringIncomeTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      invoke<void>("delete_recurring_income_template", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.recurringIncomeTemplates,
      });
    },
  });
}
