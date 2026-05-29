import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  Account,
  CreateAccountInput,
  UpdateAccountBalanceInput,
  UpdateAccountInput,
} from "@/lib/types";

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => invoke<Account[]>("get_accounts"),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAccountInput) =>
      invoke<Account>("create_account", {
        name: input.name,
        institution: input.institution,
        account_type: input.account_type,
        currency: input.currency,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

export function useUpdateAccountBalance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAccountBalanceInput) =>
      invoke<Account>("update_account_balance", {
        id: input.id,
        balance_cents: input.balance_cents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAccountInput) =>
      invoke<Account>("update_account", {
        id: input.id,
        name: input.name,
        institution: input.institution,
        account_type: input.account_type,
        currency: input.currency,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_account", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}
