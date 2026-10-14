import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { RecentlyDeletedView, RestoreOutcome } from "@/lib/types";

/**
 * The deletes still inside their 30-day retention window (AD-5).
 *
 * Read on demand rather than kept fresh: the list only changes when the user deletes or restores
 * something, and both of those paths invalidate it, so a refetch interval would be polling the
 * local file for an event the app already knows about.
 */
export function useRecentlyDeleted(options: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.recentlyDeleted,
    queryFn: () => invoke<RecentlyDeletedView>("list_recently_deleted"),
    enabled: options.enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Brings one delete back, with the rows that were cascaded away with it (AD-12).
 *
 * Several lists are invalidated and not only the one the restored row belongs to: a restore brings
 * back a whole cascaded group, which can span tables, and the item carries a table name rather
 * than a feature the frontend could map to one query.
 */
export function useRestoreDeleted() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => invoke<RestoreOutcome>("restore_deleted", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recentlyDeleted });
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
    },
  });
}
