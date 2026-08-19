import { useQuery } from "@tanstack/react-query";
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
