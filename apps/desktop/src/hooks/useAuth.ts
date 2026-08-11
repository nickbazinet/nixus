import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { queryKeys } from "@/lib/constants";
import type { AuthState } from "@/lib/types";

export function useAuthSession() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlisten = await listen("auth:callback-received", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
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

export function useSignIn() {
  return useMutation({
    mutationFn: () => invoke<void>("start_login"),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<void>("sign_out"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      // Removed, not invalidated: the previous account's profile must not stay
      // rendered while a refetch is in flight.
      queryClient.removeQueries({ queryKey: queryKeys.profile });
      queryClient.removeQueries({ queryKey: queryKeys.tfsaAccumulatedLimit });
    },
  });
}
