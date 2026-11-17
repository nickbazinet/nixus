import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { ProfileSourceInfo } from "@/lib/profileSource";
import type {
  Country,
  Subdivision,
  TfsaAccumulatedLimit,
  UpdateUserProfileInput,
  UserAvatar,
  UserProfile,
} from "@/lib/types";

/**
 * Which home the open profile's demographics live in, and the key every command below is threaded
 * with (AD-6).
 *
 * Route-scoped on purpose: an always-mounted component may not add an `invoke()` (D11), so the
 * header derives the same answer from its existing active-profile query through
 * `deriveProfileSource`. Rust re-resolves the key on every call, so neither path authorizes
 * anything by itself.
 */
export function useProfileSource() {
  return useQuery({
    queryKey: queryKeys.profileSource,
    queryFn: () => invoke<ProfileSourceInfo>("get_profile_source"),
  });
}

// `enabled` is derived from the source rather than from the session: a local profile has
// demographics with no account at all, and a cloud-linked profile whose account is not the one
// signed in resolves to no source — so there is nothing to ask for in either of those cases.
export function useUserProfile(sourceKey: string | null) {
  return useQuery({
    queryKey: queryKeys.profileDocument(sourceKey ?? ""),
    queryFn: () =>
      invoke<UserProfile | null>("get_user_profile", {
        source_key: sourceKey,
      }),
    enabled: sourceKey !== null,
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

export function useSaveUserProfile(sourceKey: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUserProfileInput) =>
      invoke<UserProfile>("save_user_profile", {
        source_key: sourceKey,
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.profileDocument(sourceKey ?? ""),
      });
      // The figure is derived from birth_date and country_code, so a save that
      // changed either must not leave a stale dollar amount on screen.
      queryClient.invalidateQueries({
        queryKey: queryKeys.tfsaAccumulatedLimit,
      });
    },
  });
}

// `enabled` is the caller's, unlike `useUserProfile` above: this one also serves the always-mounted
// account trigger, which may not read the avatar while a local profile is open — a picture belongs
// to a Nixus Cloud account, and resolving one opens the OS secure store.
//
// `staleTime: Infinity` for the same reason `useAuthSession` uses it: the only
// thing that changes an avatar is the mutation below, which writes the new value
// into this cache entry itself, so any shorter window would re-open the keyring on
// every window focus for a value that cannot have gone stale.
//
// `retry: false` because a rejection here is deterministic — no source, or a
// refused one — and the correct answer, render the placeholder, is already
// known on the first attempt.
export function useUserAvatar({
  sourceKey,
  enabled = true,
}: {
  sourceKey: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: queryKeys.userAvatar(sourceKey ?? ""),
    queryFn: () =>
      invoke<UserAvatar | null>("get_user_avatar", { source_key: sourceKey }),
    enabled: enabled && sourceKey !== null,
    staleTime: Infinity,
    retry: false,
  });
}

// Only the picked path crosses IPC; Rust reads, validates, downscales and stores,
// and answers with the derivative alone.
//
// `setQueryData`, not `invalidateQueries`: the response IS the new server state for
// the one key this write affects, so invalidating would spend a second command —
// and another keyring read — fetching bytes already in hand, and would blank both
// round renderings for that round trip.
export function useSetUserAvatar(sourceKey: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (filePath: string) =>
      invoke<UserAvatar>("set_user_avatar", {
        source_key: sourceKey,
        file_path: filePath,
      }),
    onSuccess: (avatar) => {
      queryClient.setQueryData(queryKeys.userAvatar(sourceKey ?? ""), avatar);
    },
  });
}

// Deliberately logic-free: no eligibility check, no arithmetic, no fallback
// figure. Rust owns the table, the calculation, and the balance-based display
// gate so the two sides cannot diverge (AC #8); `null` means "withhold", which
// renders as nothing.
//
// It takes no source key: Rust resolves the source itself, so the figure follows a local profile's
// own demographics with no account and withholds silently when nothing resolves.
//
// `retry: false` because the consumers now sit on Where-to-put-your-money and
// Insights, neither of which is auth-gated: a signed-out visitor gets a
// deterministic rejection, and retrying it three times buys nothing while
// the correct answer — render nothing — is already known on the first rejection.
export function useTfsaAccumulatedLimit() {
  return useQuery({
    queryKey: queryKeys.tfsaAccumulatedLimit,
    queryFn: () =>
      invoke<TfsaAccumulatedLimit | null>("get_tfsa_accumulated_limit"),
    retry: false,
  });
}
