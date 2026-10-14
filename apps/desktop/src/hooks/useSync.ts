import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { queryKeys } from "@/lib/constants";
import type {
  SyncDiagnostics,
  SyncEnableOutcome,
  SyncStatusPayload,
} from "@/lib/types";

/** CAP-5's answer: replace this computer's data with the cloud copy, or keep it separate. */
export type LinkChoice = "replace" | "separate";

/** The answer to the "cloud copy changed elsewhere" prompt. */
export type RemoteChangedAction = "load_remote" | "keep_local";

function publish(queryClient: QueryClient, payload: SyncStatusPayload) {
  queryClient.setQueryData(queryKeys.syncStatus, payload);
}

function statusQueryOptions() {
  return {
    queryKey: queryKeys.syncStatus,
    queryFn: () => invoke<SyncStatusPayload>("sync_status"),
    staleTime: Infinity,
    retry: false,
  };
}

/**
 * The status, read once and then kept current by the `sync:status` event alone (AD-16).
 *
 * `staleTime: Infinity` plus no `refetchInterval` is the whole no-polling rule: the actor emits on
 * every real transition, so a refetch could only ever re-read what the event already delivered, and
 * a window-focus refetch would turn every alt-tab into IPC.
 *
 * `retry: false` because `sync_status` is documented never to fail — a dataset that cannot sync has
 * the state `unlinked` rather than an error — so a rejection here is a local IPC fault that retrying
 * cannot fix.
 *
 * Exactly ONE caller may use this hook: the always-mounted indicator. A second listener would
 * apply every transition twice, which is the duplication `useAuthSession` already documents — so
 * other readers take `useSyncStatusValue` and share this cache entry.
 */
export function useSyncStatus() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      const stop = await listen<SyncStatusPayload>("sync:status", (event) => {
        publish(queryClient, event.payload);
      });
      // StrictMode mounts this effect twice; without the flag the first listener outlives its
      // cleanup and every transition is applied twice.
      if (cleaned) stop();
      else unlisten = stop;
    };

    setup().catch(() => {
      // A webview with no event plugin still renders the last status read; it must not throw
      // from an always-mounted component and take the shell with it.
    });

    return () => {
      cleaned = true;
      unlisten?.();
    };
  }, [queryClient]);

  return useQuery(statusQueryOptions());
}

/**
 * The same status, for a surface that is not the one owning the event subscription.
 *
 * Reads through the identical query key, so it is the indicator's cache entry rather than a second
 * one — and registers no listener of its own, which is the whole point.
 */
export function useSyncStatusValue() {
  return useQuery(statusQueryOptions());
}

/**
 * Turns sync on, and answers CAP-5 by calling the same command again with the choice.
 *
 * The `enabled` outcome invalidates nothing: the actor publishes the resulting transition over
 * `sync:status`, and invalidating would re-invoke `sync_status` for a payload already in hand.
 *
 * Every OTHER outcome does re-read the status once, because the question the UI now has to render
 * lives in `SyncStatusPayload.prompt`, and a user-initiated command resolving is the one moment
 * where waiting on an event that may already have been emitted would leave a dead screen.
 */
export function useEnableSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkChoice?: LinkChoice) =>
      invoke<SyncEnableOutcome>("sync_enable", {
        link_choice: linkChoice ?? null,
      }),
    onSuccess: (outcome) => {
      if (outcome.outcome !== "enabled") {
        queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus });
      }
    },
  });
}

export function useDisableSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<void>("sync_disable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.syncDiagnostics });
    },
  });
}

/** Uploads now, ignoring the settle window and the minimum interval. This is the retry action. */
export function useSyncNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<SyncStatusPayload>("sync_now"),
    onSuccess: (payload) => publish(queryClient, payload),
  });
}

export function useResolveRemoteChanged() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: RemoteChangedAction) =>
      invoke<SyncStatusPayload>("sync_resolve_remote_changed", { action }),
    onSuccess: (payload) => publish(queryClient, payload),
  });
}

/**
 * Counts, states and timings for support (AD-16). Fetched only when asked: `enabled` is the
 * caller's, so opening the settings page costs no extra IPC.
 */
export function useSyncDiagnostics({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.syncDiagnostics,
    queryFn: () => invoke<SyncDiagnostics>("sync_diagnostics"),
    enabled,
    retry: false,
  });
}
