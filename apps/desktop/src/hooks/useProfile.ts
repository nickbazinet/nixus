import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { queryKeys } from "@/lib/constants";
import type { ProfileSourceInfo } from "@/lib/profileSource";
import type {
  CloudProfileStatus,
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

/**
 * The Nixus Cloud lifecycle state this page branches on, and AD-7's "the Profile page opens"
 * refresh trigger in the same query.
 *
 * `refresh_cloud_profile_now` rather than the passive read because opening the page IS a trigger:
 * the copy is brought up to date and the status answered from the attempt, which is what makes
 * "offline" and "sign in again" states truthful rather than remembered. `staleTime: Infinity` keeps
 * it to one request per open, so a window focus or a remount never spends another.
 *
 * `retry: false`: a rejection here is a refused source, not a transient fault, and every network
 * outcome is already a successful answer carrying an offline state.
 */
export function useCloudProfileStatus(sourceKey: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.profileCloudStatus(sourceKey ?? ""),
    queryFn: () =>
      invoke<CloudProfileStatus>("refresh_cloud_profile_now", {
        source_key: sourceKey,
      }),
    enabled: enabled && sourceKey !== null,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * AD-8's answer, and the one mutation that can retire the prompt.
 *
 * The command answers with the status the attempt left, so it is written straight into the cache:
 * invalidating would re-issue the page's own refresh and spend a second round trip for a state
 * already in hand. The document is invalidated because accepting replaces the copy with the
 * server's response.
 */
export function useAnswerProfileUpload(sourceKey: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accept: boolean) =>
      invoke<CloudProfileStatus>("answer_profile_upload", {
        source_key: sourceKey,
        accept,
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(
        queryKeys.profileCloudStatus(sourceKey ?? ""),
        status,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.profileDocument(sourceKey ?? ""),
      });
    },
  });
}

/**
 * Keeps the profile family fresh when Rust refreshed the copy on its own (AD-7).
 *
 * Route-scoped on purpose: the refresh runs on dataset activation, when no profile surface need be
 * mounted, so a listener in the app shell would be an always-mounted subscriber to an event only
 * this page acts on. The event carries no payload — the subject never crosses IPC — so the whole
 * `profile` prefix is invalidated and the queries that are actually mounted refetch.
 */
export function useProfileRefreshedListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlisten = await listen("profile:refreshed", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      });

      if (cleaned) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };

    void setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [queryClient]);
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
      // AD-7's "after each successful save" trigger, and not merely bookkeeping: a save that
      // created the Nixus Cloud profile retires the first-upload prompt and turns an absent copy
      // into a present one, so a status left in place would keep offering a consent the server has
      // already been given.
      queryClient.invalidateQueries({
        queryKey: queryKeys.profileCloudStatus(sourceKey ?? ""),
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
