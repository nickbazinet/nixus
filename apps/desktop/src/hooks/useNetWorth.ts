import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  NetWorthChange,
  NetWorthCurrent,
  NetWorthSnapshot,
  NetWorthSnapshotSummary,
} from "@/lib/types";

export function useCurrentNetWorth() {
  return useQuery({
    queryKey: queryKeys.netWorthCurrent,
    queryFn: () => invoke<NetWorthCurrent>("get_current_net_worth"),
  });
}

export function useRecentNetWorthSnapshots(limit: number = 12) {
  return useQuery({
    queryKey: queryKeys.netWorthSnapshotsRecent,
    queryFn: () =>
      invoke<NetWorthSnapshotSummary[]>("get_recent_net_worth_snapshots", {
        limit,
      }),
  });
}

export function useNetWorthHistory(period: string) {
  return useQuery({
    queryKey: queryKeys.netWorthHistory(period),
    queryFn: () =>
      invoke<NetWorthSnapshot[]>("get_net_worth_history", { period }),
  });
}

export function useNetWorthChange(period: string) {
  return useQuery({
    queryKey: queryKeys.netWorthChange(period),
    queryFn: () =>
      invoke<NetWorthChange>("get_net_worth_change", { period }),
  });
}
