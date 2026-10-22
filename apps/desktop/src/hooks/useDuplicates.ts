import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { DuplicatesView } from "@/lib/types";

/**
 * The records two computers each saved their own copy of, found on this computer's own file.
 *
 * Read on demand and never kept fresh: it is a repair the person asks for, it costs a scan of the
 * whole dataset, and nothing else in the app changes the answer, so a refetch interval would be
 * paying for a question nobody asked.
 */
export function useDuplicates(options: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.syncDuplicates,
    queryFn: () => invoke<DuplicatesView>("sync_duplicates"),
    enabled: options.enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Removes the second copy of every record two computers each saved (restorable for 30 days).
 *
 * Every query is invalidated and not a chosen few: the repair can remove records from nearly any
 * table the app shows, and which ones depends on the data rather than on the feature.
 */
export function useRemoveDuplicates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<DuplicatesView>("sync_remove_duplicates"),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
