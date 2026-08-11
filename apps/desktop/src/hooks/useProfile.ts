import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  Country,
  Subdivision,
  TfsaAccumulatedLimit,
  UpdateUserProfileInput,
  UserProfile,
} from "@/lib/types";

// No `enabled` guard: the /profile route renders SignInRequired unless the
// session is LoggedIn, so this query only ever mounts behind that guard.
export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => invoke<UserProfile | null>("get_user_profile"),
  });
}

// Not session-gated on the Rust side either: the ISO 3166 list is reference
// data embedded in the binary, so it cannot change while the app runs and
// refetching it is pure waste.
export function useCountries() {
  return useQuery({
    queryKey: queryKeys.countries,
    queryFn: () => invoke<Country[]>("get_countries"),
    staleTime: Infinity,
  });
}

// The country code is part of the query key, so each country is its own cache
// entry and `staleTime: Infinity` means returning to one already viewed makes no
// second call. `enabled` is what keeps "no country selected" from ever asking
// for a global list.
export function useSubdivisions(countryCode: string | null | undefined) {
  const trimmed = countryCode?.trim() ?? "";

  return useQuery({
    queryKey: queryKeys.subdivisions(trimmed),
    queryFn: () =>
      invoke<Subdivision[]>("get_subdivisions", { country_code: trimmed }),
    enabled: trimmed.length > 0,
    staleTime: Infinity,
  });
}

export function useSaveUserProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUserProfileInput) =>
      invoke<UserProfile>("save_user_profile", {
        first_name: input.first_name,
        last_name: input.last_name,
        birth_date: input.birth_date,
        income_bracket: input.income_bracket,
        income_bracket_currency: input.income_bracket_currency,
        country_code: input.country_code,
        subdivision_code: input.subdivision_code,
      }),
    // Invalidate on a DATA change; `useAuth` removes on an IDENTITY change. The
    // two are different operations and must not be conflated.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      // The figure is derived from birth_date and country_code, so a save that
      // changed either must not leave a stale dollar amount on screen.
      queryClient.invalidateQueries({
        queryKey: queryKeys.tfsaAccumulatedLimit,
      });
    },
  });
}

// Deliberately logic-free: no eligibility check, no arithmetic, no fallback
// figure. Rust owns the table, the calculation, and the balance-based display
// gate so the two sides cannot diverge (AC #8); `null` means "withhold", which
// renders as nothing.
//
// `retry: false` because the consumers now sit on Where-to-put-your-money and
// Insights, neither of which is auth-gated: a signed-out visitor gets a
// deterministic `AppError::Auth`, and retrying it three times buys nothing while
// the correct answer — render nothing — is already known on the first rejection.
export function useTfsaAccumulatedLimit() {
  return useQuery({
    queryKey: queryKeys.tfsaAccumulatedLimit,
    queryFn: () =>
      invoke<TfsaAccumulatedLimit | null>("get_tfsa_accumulated_limit"),
    retry: false,
  });
}
