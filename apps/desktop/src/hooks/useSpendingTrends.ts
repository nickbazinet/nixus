import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { SpendingTrendsData } from "@/lib/types";

export function useSpendingTrends(months: number = 6) {
  return useQuery({
    queryKey: queryKeys.spendingTrends(months),
    queryFn: () =>
      invoke<SpendingTrendsData>("get_spending_trends", { months }),
  });
}
