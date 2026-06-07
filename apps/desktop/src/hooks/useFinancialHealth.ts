import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { FinancialHealthDetail, FinancialHealthSummary } from "@/lib/types";

export function useFinancialHealthSummary() {
  return useQuery({
    queryKey: queryKeys.financialHealthSummary,
    queryFn: () =>
      invoke<FinancialHealthSummary>("get_financial_health_summary"),
  });
}

export function useFinancialHealthDetail() {
  return useQuery({
    queryKey: queryKeys.financialHealthDetail,
    queryFn: () => invoke<FinancialHealthDetail>("get_financial_health_detail"),
  });
}

export function useSetEmergencyFundTarget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (months: number) =>
      invoke<void>("set_emergency_fund_target", { months }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
    },
  });
}
