import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { BudgetGroup, BudgetCategory, BudgetCategoryStatus } from "@/lib/types";

export function useBudgetGroups() {
  return useQuery({
    queryKey: queryKeys.budgetGroups,
    queryFn: () => invoke<BudgetGroup[]>("get_budget_groups"),
  });
}

export function useCreateBudgetGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      invoke<BudgetGroup>("create_budget_group", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgetGroups });
    },
  });
}

export function useBudgetCategories(groupId: number) {
  return useQuery({
    queryKey: queryKeys.budgetCategories(groupId),
    queryFn: () =>
      invoke<BudgetCategory[]>("get_budget_categories", {
        group_id: groupId,
      }),
  });
}

export function useCreateBudgetCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      group_id: number;
      name: string;
      target_cents: number;
    }) =>
      invoke<BudgetCategory>("create_budget_category", {
        group_id: input.group_id,
        name: input.name,
        target_cents: input.target_cents,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.budgetCategories(variables.group_id),
      });
      queryClient.invalidateQueries({
        queryKey: ["budget-status"],
      });
    },
  });
}

export function useUpdateBudgetGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: number; name: string }) =>
      invoke<BudgetGroup>("update_budget_group", {
        id: input.id,
        name: input.name,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgetGroups });
    },
  });
}

export function useUpdateBudgetCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: number;
      group_id: number;
      name?: string;
      target_cents?: number;
    }) =>
      invoke<BudgetCategory>("update_budget_category", {
        id: input.id,
        name: input.name ?? null,
        target_cents: input.target_cents ?? null,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.budgetCategories(variables.group_id),
      });
      queryClient.invalidateQueries({
        queryKey: ["budget-status"],
      });
    },
  });
}

export function useDeleteBudgetCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: number; group_id: number }) =>
      invoke<void>("delete_budget_category", { id: input.id }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.budgetCategories(variables.group_id),
      });
      queryClient.invalidateQueries({
        queryKey: ["budget-status"],
      });
    },
  });
}

export function useBudgetStatus(year: number, month: number) {
  return useQuery({
    queryKey: queryKeys.budgetStatus(year, month),
    queryFn: () =>
      invoke<BudgetCategoryStatus[]>("get_budget_status", { year, month }),
    placeholderData: keepPreviousData,
  });
}

export function useDeleteBudgetGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      invoke<void>("delete_budget_group", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgetGroups });
    },
  });
}
