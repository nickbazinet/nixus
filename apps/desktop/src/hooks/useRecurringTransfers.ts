import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  RecurringTransferTemplate,
  CreateRecurringTransferTemplateInput,
  UpdateRecurringTransferTemplateInput,
} from "@/lib/types";

export function useRecurringTransferTemplates() {
  return useQuery({
    queryKey: queryKeys.recurringTransferTemplates,
    queryFn: () =>
      invoke<RecurringTransferTemplate[]>("get_recurring_transfer_templates"),
  });
}

export function useCreateRecurringTransferTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRecurringTransferTemplateInput) =>
      invoke<RecurringTransferTemplate>("create_recurring_transfer_template", {
        from_account_id: input.from_account_id,
        to_account_id: input.to_account_id,
        amount_cents: input.amount_cents,
        day_of_month: input.day_of_month,
        frequency: input.frequency,
        start_date: input.start_date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.recurringTransferTemplates,
      });
    },
  });
}

export function useUpdateRecurringTransferTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateRecurringTransferTemplateInput) =>
      invoke<RecurringTransferTemplate>("update_recurring_transfer_template", {
        id: input.id,
        from_account_id: input.from_account_id,
        to_account_id: input.to_account_id,
        amount_cents: input.amount_cents,
        day_of_month: input.day_of_month,
        frequency: input.frequency,
        start_date: input.start_date,
        is_active: input.is_active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.recurringTransferTemplates,
      });
    },
  });
}

export function useDeleteRecurringTransferTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      invoke<void>("delete_recurring_transfer_template", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.recurringTransferTemplates,
      });
    },
  });
}
