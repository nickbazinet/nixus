import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";

/** One entry in the Rust-side registry, snake_case straight off the wire. */
export interface Dataset {
  id: string;
  label: string;
  kind: "local" | "cloud-linked";
  cognito_sub: string | null;
  linked_from: string | null;
  is_default: boolean;
  created_at: string;
}

interface PickerGateStatus {
  needs_picker: boolean;
}

export function fetchPickerGateStatus() {
  return invoke<PickerGateStatus>("check_picker_gate");
}

export function fetchDatasets() {
  return invoke<Dataset[]>("list_datasets");
}

export function useDatasets() {
  return useQuery({
    queryKey: queryKeys.datasets,
    queryFn: fetchDatasets,
  });
}

/**
 * Two invokes rather than one, and strictly in this order. `select_dataset` is also `lib.rs`'s
 * startup auto-selector for the Default dataset, so the gate's flag cannot be folded into it —
 * only this path may mark the picker passed. Latching second is what leaves the gate up (and the
 * user on the picker) when the open fails, instead of stranding them in an app pointed at nothing.
 *
 * `clear()`, never `invalidateQueries()`: every cached entry belongs to the *previous* dataset, and
 * invalidation would keep serving it while refetching — a cross-dataset leak, not a stale render.
 *
 * Navigation and error toasting stay with the caller, matching `useCompleteOnboarding`.
 *
 * Split out of the hook so the ordering and the clear are unit-testable against a real QueryClient
 * without rendering a component — the picker unmounts on navigation, which makes the clear
 * unobservable from an E2E test.
 */
export function selectDatasetMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (datasetId: string) => {
      await invoke<void>("select_dataset", { dataset_id: datasetId });
      await invoke<void>("mark_picker_passed");
    },
    onSuccess: () => queryClient.clear(),
  };
}

export function useSelectDataset() {
  return useMutation(selectDatasetMutationOptions(useQueryClient()));
}

/**
 * `invalidateQueries`, never `clear()` — the deliberate contrast with
 * `selectDatasetMutationOptions` above. Creating appends a row to one list and leaves the active
 * dataset exactly where it was, so every other cached entry still belongs to the dataset it was
 * read from; clearing would blank the app for nothing. Selecting is the case where all of it
 * really is stale.
 *
 * Split out for the same reason its sibling is: the two are indistinguishable at the E2E surface —
 * under `clear()` the mounted list query simply refetches and the new row still appears — so the
 * choice is only assertable against a real QueryClient.
 *
 * Navigation and error toasting stay with the caller, matching `useSelectDataset`.
 */
export function createDatasetMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => invoke<Dataset>("create_dataset"),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.datasets }),
  };
}

export function useCreateDataset() {
  return useMutation(createDatasetMutationOptions(useQueryClient()));
}
