import type { SyncState } from "@/lib/types";

const KNOWN_STATES: readonly SyncState[] = [
  "unlinked",
  "idle",
  "syncing",
  "offline",
  "frozen",
  "update_needed",
  "link_choice_required",
  "remote_changed",
  "error",
];

/**
 * Whether a value off the wire is a state this build can render.
 *
 * AD-16 makes "sync never blocks the UI" a hard rule, and the status indicator is mounted on every
 * screen — so a payload carrying a state this build has never heard of has to degrade to no
 * indicator. Without this guard the unknown state misses every arm of the icon and label tables and
 * React renders `undefined` as an element type, which blanks the whole window.
 */
export function isSyncState(value: unknown): value is SyncState {
  return KNOWN_STATES.some((state) => state === value);
}

/**
 * How urgent a state is, which is what decides colour, weight and whether the indicator shows at
 * all. Separate from the i18n key so the two cannot drift: a new state must be given both.
 */
export type SyncTone = "quiet" | "busy" | "caution" | "problem";

/**
 * The i18n key for a state's short label. Exhaustive with no `default`, so adding a state to
 * `SyncState` is a compile error here rather than a blank indicator.
 */
export function syncStateLabelKey(state: SyncState): string {
  switch (state) {
    case "unlinked":
      return "sync.stateUnlinked";
    case "idle":
      return "sync.stateIdle";
    case "syncing":
      return "sync.stateSyncing";
    case "offline":
      return "sync.stateOffline";
    case "frozen":
      return "sync.stateFrozen";
    case "update_needed":
      return "sync.stateUpdateNeeded";
    case "link_choice_required":
    case "remote_changed":
      return "sync.stateActionNeeded";
    case "error":
      return "sync.stateError";
  }
}

/** The i18n key for the one-sentence explanation shown in the tooltip and in settings. */
export function syncStateDetailKey(state: SyncState): string {
  switch (state) {
    case "unlinked":
      return "sync.detailUnlinked";
    case "idle":
      return "sync.detailIdle";
    case "syncing":
      return "sync.detailSyncing";
    case "offline":
      return "sync.detailOffline";
    case "frozen":
      return "sync.detailFrozen";
    case "update_needed":
      return "sync.detailUpdateNeeded";
    case "link_choice_required":
      return "sync.detailLinkChoiceRequired";
    case "remote_changed":
      return "sync.detailRemoteChanged";
    case "error":
      return "sync.detailError";
  }
}

export function syncStateTone(state: SyncState): SyncTone {
  switch (state) {
    case "unlinked":
    case "idle":
      return "quiet";
    case "syncing":
      return "busy";
    case "offline":
    case "frozen":
    case "update_needed":
    case "link_choice_required":
    case "remote_changed":
      return "caution";
    case "error":
      return "problem";
  }
}

/** Whether the state is waiting on an answer only the user can give. */
export function isSyncPromptState(state: SyncState): boolean {
  return state === "link_choice_required" || state === "remote_changed";
}

/**
 * A sync timestamp as a short local date and time.
 *
 * Milliseconds, not an ISO date string: every sync timing crosses IPC as a unix-ms `i64` (AD-16
 * reports timings as numbers), unlike the domain tables' ISO `String` dates.
 */
export function formatSyncTimestamp(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
