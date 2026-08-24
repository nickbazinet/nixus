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

/**
 * Reads the machine-wide Cognito session and keeps every reader of it fresh.
 *
 * `enabled` gates the query and nothing else. It exists for the always-mounted account menu, which
 * may not read the session while a *local* profile is open — that read opens the OS secure store
 * and can POST a Cognito refresh for a profile that has no account at all. The callback listener
 * stays registered while disabled, so a cloud sign-in completed elsewhere still invalidates the
 * caches this hook owns.
 */
export function useAuthSession({ enabled = true }: { enabled?: boolean } = {}) {
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
    enabled,
    // get_auth_session performs the Cognito refresh POST when the stored token has
    // expired, so a stale entry would re-POST on every window focus and reconnect.
    staleTime: Infinity,
  });
}

/**
 * Which Nixus Cloud page the browser opens on, mirroring Rust's `AuthorizeEntry`.
 *
 * One authorize-URL variant, never a second flow: both entries run the same PKCE
 * attempt, the same loopback listener and the same callback, and differ only in
 * the path segment the Hosted UI lands on.
 */
export type AuthorizeEntry = "SignIn" | "SignUp";

/** The whole payload `start_login` receives: a Hosted UI entry, and what to do with the tokens. */
export interface SignInRequest {
  intent: LoginIntent;
  entry: AuthorizeEntry;
}

/**
 * Starts the one unchanged Cognito flow, carrying the entry and the intent the caller chose.
 *
 * Both are explicit at every call site rather than defaulted here: "log in", "create an account" and
 * "migrate this profile" are different user actions with different outcomes, and a silent default is
 * how the wrong branch — or the wrong Hosted UI page — would ship unnoticed.
 */
export function useSignIn() {
  return useMutation({
    mutationFn: ({ intent, entry }: SignInRequest) =>
      invoke<void>("start_login", { intent, entry }),
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
