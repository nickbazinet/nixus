import type { QueryClient } from "@tanstack/react-query";

// Profile-scoped `localStorage` keys. Every entry here describes one profile's
// data or its onboarding progress, so it must not survive a switch.
export const IMPORT_DRAFT_STORAGE_KEY = "nixus:import-draft.v1";
export const FINANCE_ONBOARDING_DISMISSED_KEY = "finance.onboarding.dismissed";
export const CAR_ONBOARDING_DISMISSED_KEY = "car.onboarding.dismissed";

export const PROFILE_SCOPED_STORAGE_KEYS = [
  IMPORT_DRAFT_STORAGE_KEY,
  FINANCE_ONBOARDING_DISMISSED_KEY,
  CAR_ONBOARDING_DISMISSED_KEY,
] as const;

// Deliberately an explicit removal list, never `localStorage.clear()`: global
// preferences (theme, `i18nextLng`, `rail-collapsed`, `values-hidden`,
// `nixus:last_used_agent_id`) belong to the person, not to the profile, and
// resetting them on every switch would read as the app losing its settings.
export function clearProfileScopedState(queryClient: QueryClient): void {
  // Cache first: a storage failure must not be able to leave the previous
  // profile's rows rendered.
  queryClient.clear();

  for (const key of PROFILE_SCOPED_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable for this key; keep sweeping the rest.
    }
  }
}
