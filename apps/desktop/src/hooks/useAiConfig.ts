import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { AiConfig } from "../lib/types";

export function useAiConfig() {
  return useQuery({
    queryKey: ["ai-config"],
    queryFn: () => invoke<AiConfig>("get_ai_config"),
  });
}

export function useInvalidateAiConfig() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["ai-config"] });
}
