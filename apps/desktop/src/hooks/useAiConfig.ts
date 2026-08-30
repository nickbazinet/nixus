import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { usePremiumEntitlementState } from "@/hooks/useAuth";
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

/**
 * Whether any AI backend can serve a surface right now, or whether that is still being decided.
 *
 * Three states rather than a boolean, because two of them used to be one. `unavailable` means every
 * signal has answered and none of them said yes; `resolving` means at least one has not answered.
 * A boolean forced the second into the first, which is what made a premium user's first paint
 * identical to a user with no AI access at all — Trends briefly offered to set up a personal key,
 * and a Project Advice click landed in the discarded-then-explain branch.
 *
 * Two signals that stay separate everywhere else, combined only here. `get_ai_config.configured`
 * answers strictly "are there BYO credentials on this machine", and the premium entitlement answers
 * strictly "is the signed-in cloud account entitled to hosted AI". Treating the first as the whole
 * availability signal is what made premium users without a personal key unable to reach the
 * hosted-first backend at all, even though Rust would have routed them.
 *
 * `available` is checked before `resolving` on purpose: either signal answering yes is a complete
 * answer, so a configured BYO machine never waits on the cloud read, and a hung entitlement read
 * cannot drag a working surface into a pending state.
 *
 * It deliberately says nothing about WHICH backend will serve the call: routing, quota and the BYO
 * fallback are `ai/backend.rs`'s to decide per invocation, and a frontend that predicted them would
 * be a second, diverging copy of that table.
 */
export type AiAvailability = "available" | "unavailable" | "resolving";

export function useAiAvailability(): AiAvailability {
  const byo = useAiConfig();
  // Read unconditionally: an early return would make this a conditional hook call.
  const entitlement = usePremiumEntitlementState();

  if (byo.data?.configured === true || entitlement.premium) return "available";
  if (byo.isLoading || entitlement.resolving) return "resolving";
  return "unavailable";
}
