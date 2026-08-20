import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { queryKeys } from "@/lib/constants";
import type { AuthState } from "@/lib/types";

/**
 * What the completed sign-in should do locally, mirroring Rust's internally-tagged
 * `LoginIntent`. Both entry points run the identical Cognito flow — only the
 * post-callback branch differs — so this is the whole difference between them.
 *
 * `source_dataset_id` is the only value either entry point sends, and it is a
 * local dataset id: no financial, car, or profile data crosses this boundary.
 */
export type LoginIntent =
  | { kind: "Login" }
  | { kind: "Migrate"; source_dataset_id: string };

export function useAuthSession() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlisten = await listen("auth:callback-received", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
        // The callback may have landed on a different dataset (Story 35.2) or a
        // brand-new one (Story 35.3), and the signed-in badge is derived from the
        // pair, so the active profile is re-read alongside the session.
        queryClient.invalidateQueries({ queryKey: queryKeys.activeProfile });
        // `removeQueries`, never `invalidateQueries`: invalidation keeps the
        // previous account's profile rendered while refetching, which is a
        // visible cross-account leak.
        queryClient.removeQueries({ queryKey: queryKeys.profile });
        queryClient.removeQueries({
          queryKey: queryKeys.tfsaAccumulatedLimit,
        });
      });

      if (cleaned) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };

    setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [queryClient]);

  return useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => invoke<AuthState>("get_auth_session"),
    // get_auth_session performs the Cognito refresh POST when the stored token has
    // expired, so a stale entry would re-POST on every window focus and reconnect.
    staleTime: Infinity,
  });
}

/**
 * Starts the one unchanged Cognito flow, carrying the intent the caller chose.
 *
 * The intent is explicit at every call site rather than defaulted here: "log in"
 * and "migrate this profile" are different user actions with different outcomes,
 * and a silent default is how the wrong branch would ship unnoticed.
 */
export function useSignIn() {
  return useMutation({
    mutationFn: (intent: LoginIntent) => invoke<void>("start_login", { intent }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<void>("sign_out"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      // A cloud-linked profile stays cloud-linked and simply reads as signed-out,
      // which is a change to the derived badge, not to the dataset.
      queryClient.invalidateQueries({ queryKey: queryKeys.activeProfile });
      // Removed, not invalidated: the previous account's profile must not stay
      // rendered while a refetch is in flight.
      queryClient.removeQueries({ queryKey: queryKeys.profile });
      queryClient.removeQueries({ queryKey: queryKeys.tfsaAccumulatedLimit });
    },
  });
}
