import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import { clearProfileScopedState } from "@/lib/datasetSwitch";

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

/**
 * What the account menu needs about the dataset it renders inside, straight off
 * the wire. `is_signed_in` is derived Rust-side and arrives as a bare boolean —
 * the Cognito subject deliberately never crosses IPC.
 */
export interface ActiveProfile {
  dataset_id: string;
  kind: Dataset["kind"];
  label: string;
  is_signed_in: boolean;
}

export function useActiveProfile() {
  return useQuery({
    queryKey: queryKeys.activeProfile,
    queryFn: () => invoke<ActiveProfile>("get_active_profile"),
  });
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
 * `clearProfileScopedState`, never a bare `clear()`: every cached entry belongs to the *previous*
 * dataset, and invalidation would keep serving it while refetching — a cross-dataset leak, not a
 * stale render. Sweeping synchronously here, rather than relying on the `dataset:switched` listener
 * alone, is what guarantees the previous profile's `localStorage` is gone before `mutateAsync`
 * resolves and the caller navigates. The listener still covers switches the picker never initiated.
 *
 * Navigation and error toasting stay with the caller, matching `useCompleteOnboarding`.
 *
 * Split out of the hook so the ordering and the sweep are unit-testable against a real QueryClient
 * without rendering a component — the picker unmounts on navigation, which makes the sweep
 * unobservable from an E2E test.
 */
export function selectDatasetMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: async (datasetId: string) => {
      await invoke<void>("select_dataset", { dataset_id: datasetId });
      await invoke<void>("mark_picker_passed");
    },
    onSuccess: () => clearProfileScopedState(queryClient),
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

/** What `rename_dataset` needs, in the camelCase the frontend speaks. */
export interface RenameDatasetInput {
  datasetId: string;
  label: string;
}

/**
 * Two invalidations, never a `clear()`: a rename changes one display string and leaves every
 * profile's data exactly where it was, so the same reasoning as `createDatasetMutationOptions`
 * applies — clearing would blank the app for a label edit.
 *
 * `activeProfile` is the second key because the renamed profile may be the one currently open, and
 * `get_active_profile` carries its own copy of the label for the account menu. Without it the
 * picker row would update while the header went on showing the old name until the next remount.
 * Invalidated unconditionally rather than only for the active id, so no second source of truth for
 * "which profile is open" appears here.
 *
 * Awaited, so `mutateAsync` does not resolve before the refetches have been kicked off — the caller
 * closes its editor the moment it resolves.
 *
 * Navigation and error toasting stay with the caller, matching its two siblings above.
 */
export function renameDatasetMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: ({ datasetId, label }: RenameDatasetInput) =>
      invoke<Dataset>("rename_dataset", { dataset_id: datasetId, label }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activeProfile }),
      ]);
    },
  };
}

export function useRenameDataset() {
  return useMutation(renameDatasetMutationOptions(useQueryClient()));
}

/**
 * Which profile is open, as a bare id, or `null` when this run has opened none.
 *
 * A separate query from `useActiveProfile`, never a field read off it: that one calls
 * `get_active_profile`, which resolves the Cognito subject for a cloud-linked entry and can
 * refresh an expired session over the network. The picker asks this question to decide which row's
 * Delete item is disabled, and that decision must stay auth-free (NFR7).
 */
export function useActiveDatasetId() {
  return useQuery({
    queryKey: queryKeys.activeDatasetId,
    queryFn: () => invoke<string | null>("get_active_dataset_id"),
  });
}

/**
 * The same two invalidations `renameDatasetMutationOptions` does, and for the same reason: a
 * deletion removes one profile's own directory, registry row and AI keys, and leaves every other
 * profile's data exactly where it was — so a `clear()` would blank the app for a change that
 * touched nothing it is showing. `selectDatasetMutationOptions` stays the only sweeping case.
 *
 * `activeProfile` is the second key because `get_active_profile` carries its own copy of the open
 * profile's label for the header. The deleted profile can never be the open one — Rust refuses that
 * outright — but the key is invalidated unconditionally anyway, so no second source of truth for
 * "which profile is open" appears here.
 *
 * `activeDatasetId` is deliberately *not* invalidated: deletion cannot change which profile is
 * open, and refetching it would be a round-trip for an answer that provably did not move.
 *
 * Awaited, so `mutateAsync` does not resolve before the refetches are kicked off — the caller
 * closes its dialog the moment it resolves.
 *
 * Navigation and error reporting stay with the caller, matching all three siblings above.
 */
export function deleteDatasetMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (datasetId: string) =>
      invoke<void>("delete_dataset", { dataset_id: datasetId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.datasets }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activeProfile }),
      ]);
    },
  };
}

export function useDeleteDataset() {
  return useMutation(deleteDatasetMutationOptions(useQueryClient()));
}
