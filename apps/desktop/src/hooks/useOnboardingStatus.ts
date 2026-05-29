import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";

interface OnboardingStatus {
  needs_onboarding: boolean;
}

export function useOnboardingStatus() {
  return useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn: () => invoke<OnboardingStatus>("check_onboarding_status"),
  });
}
