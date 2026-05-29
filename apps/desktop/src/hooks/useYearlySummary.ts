import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { YearlySummaryData } from "@/lib/types";

export function useYearlySummary(year: number) {
  return useQuery({
    queryKey: queryKeys.yearlySummary(year),
    queryFn: () =>
      invoke<YearlySummaryData>("get_yearly_summary", { year }),
  });
}
