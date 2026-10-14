import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AlarmClock,
  CircleCheckBig,
  CircleHelp,
  CirclePause,
  CircleArrowUp,
  CloudOff,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import { parseAppError, isSyncError, syncMessageKey } from "@/lib/appError";
import {
  formatSyncTimestamp,
  isSyncPromptState,
  isSyncState,
  syncStateDetailKey,
  syncStateLabelKey,
  syncStateTone,
  type SyncTone,
} from "@/lib/syncState";
import { railLabelClass } from "@/components/shared/SidebarBrandHeader";
import {
  useResolveRemoteChanged,
  useEnableSync,
  useSyncApplied,
  useSyncStatus,
  type RemoteChangedAction,
} from "@/hooks/useSync";
import type { SyncState } from "@/lib/types";
import { SyncLinkChoiceDialog } from "./SyncLinkChoiceDialog";
import { SyncRemoteChangedDialog } from "./SyncRemoteChangedDialog";

const STATE_ICON: Record<SyncState, React.ComponentType<{ className?: string }>> = {
  unlinked: CloudOff,
  idle: CircleCheckBig,
  syncing: RefreshCw,
  offline: CloudOff,
  frozen: CirclePause,
  update_needed: CircleArrowUp,
  clock_skew: AlarmClock,
  link_choice_required: CircleHelp,
  remote_changed: CircleHelp,
  error: TriangleAlert,
};

const TONE_CLASS: Record<SyncTone, string> = {
  quiet: "text-rail-ink",
  busy: "text-brand",
  caution: "text-caution-ink",
  problem: "text-over-ink",
};

interface SyncStatusIndicatorProps {
  expanded: boolean;
  /** The rail's own item recipe, passed in so the sidebar keeps owning it. */
  itemClassName: string;
}

/**
 * The always-mounted sync status, and the host for the two prompts.
 *
 * It renders NOTHING for `unlinked`: a user who never turned sync on should not carry sync chrome
 * on every screen, and the settings section is the discovery path. The prompts are hosted here
 * rather than on the settings page because a conflict can arrive over `sync:status` on any screen
 * and has to be answerable where the user already is.
 */
export function SyncStatusIndicator({
  expanded,
  itemClassName,
}: SyncStatusIndicatorProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const status = useSyncStatus();
  const applied = useSyncApplied();
  const enableSync = useEnableSync();
  const resolveRemote = useResolveRemoteChanged();
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);

  const payload = status.data;
  // An unknown state degrades to no indicator rather than to a broken one: this component is in
  // the shell on every screen, so throwing here would blank the whole window (AD-16).
  if (
    payload === undefined ||
    payload === null ||
    !isSyncState(payload.state) ||
    payload.state === "unlinked"
  ) {
    return null;
  }

  const state = payload.state;
  const Icon = STATE_ICON[state];
  const label = t(syncStateLabelKey(state));
  const detail = t(syncStateDetailKey(state));
  const lastSyncMs = payload.last_sync_ms ?? null;
  const lastSync =
    lastSyncMs === null
      ? null
      : t("sync.lastSyncAt", {
          date: formatSyncTimestamp(lastSyncMs, i18n.language),
        });

  // `?? null`, not a bare read: this component is mounted on every screen, so a payload that omits
  // an optional field instead of sending `null` must degrade to "no question pending" rather than
  // throw and take the whole shell down with it.
  const prompt = payload.prompt ?? null;
  // Keyed on the remote timestamp as well as the kind, so dismissing one question does not also
  // swallow the next one that happens to be of the same kind.
  const promptId =
    prompt === null ? null : `${prompt.kind}:${prompt.remote_created_ms}`;
  const promptOpen = promptId !== null && dismissedPrompt !== promptId;

  const describeFailure = (error: unknown): string => {
    const parsed = parseAppError(error);
    if (isSyncError(parsed)) return t(syncMessageKey(parsed.code));
    return t("sync.errorTransport");
  };

  const handleChoose = (choice: "replace" | "separate") => {
    setPromptError(null);
    enableSync.mutate(choice, {
      onError: (error) => setPromptError(describeFailure(error)),
    });
  };

  const handleResolve = (action: RemoteChangedAction) => {
    setPromptError(null);
    resolveRemote.mutate(action, {
      onError: (error) => setPromptError(describeFailure(error)),
    });
  };

  const handleClick = () => {
    if (isSyncPromptState(state)) {
      setDismissedPrompt(null);
      return;
    }
    navigate({ to: "/settings/ai-provider", search: { section: "data" } });
  };

  return (
    <>
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger
            type="button"
            onClick={handleClick}
            className={itemClassName}
            aria-label={t("sync.indicatorLabel", { status: label })}
            data-testid="sync-status-indicator"
            data-sync-state={state}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                TONE_CLASS[syncStateTone(state)],
                state === "syncing" && "animate-spin"
              )}
            />
            {/* `aria-live` on the label and not on the button: the transition is announced without
              * moving focus, and the button's own accessible name stays stable. */}
            <span
              role="status"
              aria-live="polite"
              className={cn(railLabelClass(expanded), "truncate")}
            >
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-caption">
            <span className="flex flex-col gap-0.5">
              <span>{detail}</span>
              {lastSync !== null && <span className="opacity-80">{lastSync}</span>}
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Remote changes landing is news, not a question: announced politely, dismissible, and
        * gone by itself. No dialog and no autofocus — AD-16 forbids sync interrupting the user. */}
      {applied.visible && (
        <div
          role="status"
          aria-live="polite"
          data-testid="sync-applied-cue"
          // Collapsed by the rail's own recipe rather than unmounted, so the announcement still
          // reaches a screen reader on a collapsed rail without a stray control appearing in it.
          className={cn(
            "flex items-center gap-1 text-caption text-rail-ink",
            railLabelClass(expanded)
          )}
        >
          <span className="truncate">{t("sync.appliedCue")}</span>
          <button
            type="button"
            onClick={applied.dismiss}
            aria-label={t("sync.appliedCueDismiss")}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {prompt !== null && prompt.kind === "link_choice" && (
        <SyncLinkChoiceDialog
          open={promptOpen}
          onOpenChange={(open) => {
            if (!open) setDismissedPrompt(promptId);
          }}
          localRows={prompt.local_rows}
          remoteCreatedMs={prompt.remote_created_ms}
          busy={enableSync.isPending}
          error={promptError}
          onChoose={handleChoose}
        />
      )}

      {prompt !== null && prompt.kind === "remote_changed" && (
        <SyncRemoteChangedDialog
          open={promptOpen}
          onOpenChange={(open) => {
            if (!open) setDismissedPrompt(promptId);
          }}
          remoteCreatedMs={prompt.remote_created_ms}
          busy={resolveRemote.isPending}
          error={promptError}
          onResolve={handleResolve}
        />
      )}
    </>
  );
}
