import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  IncomeSourceWithLastEntry,
  IncomeSource,
  IncomeEntry,
  IncomeTotal,
  CreateIncomeSourceInput,
  UpdateIncomeSourceInput,
  CreateIncomeEntryInput,
  UpdateIncomeEntryInput,
} from "@/lib/types";

function invalidateIncomeEntryMutationQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
  queryClient.invalidateQueries({ queryKey: ["income-entries"] });
  queryClient.invalidateQueries({ queryKey: ["income-entries-by-month"] });
  queryClient.invalidateQueries({ queryKey: ["income-total"] });
  queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
  queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
  queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
  queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
  queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
  queryClient.invalidateQueries({ queryKey: ["top-budget-categories"] });
}

export function useIncomeSources() {
  return useQuery({
    queryKey: queryKeys.incomeSources,
    queryFn: () => invoke<IncomeSourceWithLastEntry[]>("get_income_sources"),
  });
}

export function useCreateIncomeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateIncomeSourceInput) =>
      invoke<IncomeSource>("create_income_source", {
        name: input.name,
        income_type: input.income_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
    },
  });
}

export function useUpdateIncomeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateIncomeSourceInput) =>
      invoke<IncomeSource>("update_income_source", {
        id: input.id,
        name: input.name,
        income_type: input.income_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
    },
  });
}

export function useDeleteIncomeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_income_source", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
      queryClient.invalidateQueries({ queryKey: ["income-entries"] });
      queryClient.invalidateQueries({ queryKey: ["income-entries-by-month"] });
      queryClient.invalidateQueries({ queryKey: ["income-total"] });
    },
  });
}

export function useCreateIncomeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateIncomeEntryInput) =>
      invoke<IncomeEntry>("create_income_entry", {
        source_id: input.source_id,
        amount_cents: input.amount_cents,
        date: input.date,
        account_id: input.account_id ?? null,
      }),
    onSuccess: () => {
      invalidateIncomeEntryMutationQueries(queryClient);
    },
  });
}

export function useUpdateIncomeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateIncomeEntryInput) =>
      invoke<IncomeEntry>("update_income_entry", {
        id: input.id,
        source_id: input.source_id,
        amount_cents: input.amount_cents,
        date: input.date,
        account_id: input.account_id ?? null,
      }),
    onSuccess: () => {
      invalidateIncomeEntryMutationQueries(queryClient);
    },
  });
}

export function useDeleteIncomeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_income_entry", { id }),
    onSuccess: () => {
      invalidateIncomeEntryMutationQueries(queryClient);
    },
  });
}

export function useIncomeEntries(sourceId?: number) {
  return useQuery({
    queryKey: queryKeys.incomeEntries(sourceId),
    queryFn: () =>
      invoke<IncomeEntry[]>("get_income_entries", {
        source_id: sourceId ?? null,
      }),
  });
}

export function useIncomeEntriesByMonth(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.incomeEntriesByMonth(year, month),
    queryFn: () =>
      invoke<IncomeEntry[]>("get_income_entries_by_month", { year, month }),
  });
}

export function useIncomeTotal(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.incomeTotal(year, month),
    queryFn: () => invoke<IncomeTotal>("get_income_total", { year, month }),
  });
}
