import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";

interface OnboardingStatus {
  needs_onboarding: boolean;
  setup_incomplete: boolean;
}

export function fetchOnboardingStatus() {
  return invoke<OnboardingStatus>("check_onboarding_status");
}

export function useOnboardingStatus() {
  return useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn: fetchOnboardingStatus,
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<void>("complete_onboarding"),
    onSuccess: () => {
      // Written before invalidation so the dashboard's setup-incomplete banner
      // renders from fresh data instead of the stale pre-onboarding entry.
      queryClient.setQueryData<OnboardingStatus>(queryKeys.onboardingStatus, {
        needs_onboarding: false,
        setup_incomplete: true,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.onboardingStatus });
    },
  });
}
