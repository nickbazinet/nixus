import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  PassiveAsset,
  CreateAssetInput,
  UpdateAssetInput,
  UpdateAssetValueInput,
} from "@/lib/types";

export function useAssets() {
  return useQuery({
    queryKey: queryKeys.assets,
    queryFn: () => invoke<PassiveAsset[]>("get_assets"),
  });
}

export function useCreateAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAssetInput) =>
      invoke<PassiveAsset>("create_asset", {
        name: input.name,
        asset_type: input.asset_type,
        value_cents: input.value_cents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

export function useUpdateAssetValue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAssetValueInput) =>
      invoke<PassiveAsset>("update_asset_value", {
        id: input.id,
        value_cents: input.value_cents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

export function useUpdateAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAssetInput) =>
      invoke<PassiveAsset>("update_asset", {
        id: input.id,
        name: input.name,
        asset_type: input.asset_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_asset", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}
