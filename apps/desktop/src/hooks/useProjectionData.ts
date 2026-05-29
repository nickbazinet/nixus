import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { ProjectionInput } from "@/lib/types";

export function useProjectionInput() {
  return useQuery({
    queryKey: queryKeys.projectionInput,
    queryFn: () => invoke<ProjectionInput>("get_projection_input"),
  });
}
