import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button, Card, Switch } from "@nixus/shared";
import { isSyncError, parseAppError, syncMessageKey } from "@/lib/appError";
import {
  formatSyncTimestamp,
  isSyncState,
  syncStateDetailKey,
  syncStateLabelKey,
} from "@/lib/syncState";
import {
  useDisableSync,
  useEnableSync,
  useExportSyncDiagnostics,
  useSyncDiagnostics,
  useSyncNow,
  useSyncStatusValue,
} from "@/hooks/useSync";
import { useActiveProfile } from "@/hooks/useDatasets";
import { SettingRow, SettingsSection } from "./SettingRow";
import {
  SyncFirstSyncDialog,
  type FirstSyncStage,
} from "@/components/sync/SyncFirstSyncDialog";

/**
 * Why the enable button cannot be offered, or `null` when it can.
 *
 * Only the two facts the frontend legitimately holds are checked here: a local-only profile has no
 * account at all, and a signed-out one has no identity to vend credentials for. The account's
 * ACCESS to sync is never precomputed — AD-14 keeps the capability a backend decision, so the user
 * clicks and `sync_enable` answers with `not_entitled` if it must.
 */
type Ineligibility = "local_only" | "signed_out" | null;

export function SyncSettings() {
  const { t, i18n } = useTranslation();
  const status = useSyncStatusValue();
  const profile = useActiveProfile();
  const enableSync = useEnableSync();
  const disableSync = useDisableSync();
  const syncNow = useSyncNow();
  const [diagnosticsRequested, setDiagnosticsRequested] = useState(false);
  const diagnostics = useSyncDiagnostics({ enabled: diagnosticsRequested });
  const exportDiagnostics = useExportSyncDiagnostics();
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [firstSyncOpen, setFirstSyncOpen] = useState(false);
  const [separateProfileId, setSeparateProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = status.data;
  // Same rule as the indicator: a state this build does not know reads as "sync is off" rather
  // than resolving to a missing i18n key (AD-16 — a sync fault never degrades the UI).
  const state = isSyncState(payload?.state) ? payload.state : "unlinked";
  const enabled = payload?.enabled === true;

  const ineligible: Ineligibility =
    profile.data === undefined
      ? null
      : profile.data.kind === "local"
        ? "local_only"
        : !profile.data.is_signed_in
          ? "signed_out"
          : null;

  const busy = enableSync.isPending || disableSync.isPending || syncNow.isPending;
  const paused = payload?.paused === true;

  // What the AUTOMATIC state is, in the user's terms. Sync is on by default for an account that
  // includes it, so every line here answers "why is it not moving right now" rather than "how do
  // I switch it on" — and the account's access is still never precomputed (AD-14): it is learned
  // from the code the backend reports, which is why `not_entitled` is read and not guessed.
  const automatic = ((): { labelKey: string; detailKey: string } => {
    if (ineligible === "local_only") {
      return {
        labelKey: "sync.unavailableLocalOnlyTitle",
        detailKey: "sync.unavailableLocalOnlyBody",
      };
    }
    if (paused) {
      return { labelKey: "sync.stateOffByYouLabel", detailKey: "sync.stateOffByYouDetail" };
    }
    if (payload?.error_code === "not_entitled") {
      return {
        labelKey: "sync.stateNotIncludedLabel",
        detailKey: "sync.stateNotIncludedDetail",
      };
    }
    if (ineligible === "signed_out" || payload?.error_code === "signed_out") {
      return {
        labelKey: "sync.stateWaitingForSignInLabel",
        detailKey: "sync.stateWaitingForSignInDetail",
      };
    }
    if (state === "offline") {
      return {
        labelKey: "sync.stateWaitingForNetworkLabel",
        detailKey: "sync.stateWaitingForNetworkDetail",
      };
    }

    return { labelKey: syncStateLabelKey(state), detailKey: syncStateDetailKey(state) };
  })();

  // `preparing` while the command is in flight, then whatever the actor's own transition says:
  // the dialog reads the shared status rather than keeping a second copy of the progress.
  //
  // `enableSync.isError` is checked BEFORE the status, and is load-bearing: a rejected
  // `sync_enable` leaves the status at whatever it was (usually `unlinked`), which would otherwise
  // fall through to `preparing` and spin a progress indicator for an operation that already failed.
  const firstSyncStage: FirstSyncStage = enableSync.isPending
    ? "preparing"
    : enableSync.isError || state === "error"
      ? "failed"
      : state === "syncing"
        ? "uploading"
        : state === "idle"
          ? "done"
          : "preparing";

  const describeFailure = (err: unknown): string => {
    const parsed = parseAppError(err);
    if (isSyncError(parsed)) return t(syncMessageKey(parsed.code));
    return t("sync.errorTransport");
  };

  // Only reachable from the switch being turned back ON. The automatic join shows no dialog at
  // all, which is the whole point: the first-sync progress dialog is no longer part of normal use.
  const handleEnable = () => {
    setError(null);
    setSeparateProfileId(null);
    setFirstSyncOpen(true);
    enableSync.mutate(undefined, {
      onSuccess: (outcome) => {
        // The link choice is answered elsewhere — the always-mounted indicator hosts the CAP-5
        // dialog, driven by the same status payload — so the first-sync progress dialog closes
        // instead of reporting a failure that did not happen.
        if (outcome.outcome !== "enabled") setFirstSyncOpen(false);
        if (outcome.outcome === "separate_profile_created") {
          setSeparateProfileId(outcome.dataset_id);
        }
      },
      onError: (err) => setError(describeFailure(err)),
    });
  };

  // A cancelled save dialog answers `null` and must leave no trace: no error, and no stale
  // "saved to…" line from a previous export either.
  const handleExportDiagnostics = () => {
    setError(null);
    setExportedPath(null);
    exportDiagnostics.mutate(undefined, {
      onSuccess: (result) => setExportedPath(result?.path ?? null),
      onError: (err) => setError(describeFailure(err)),
    });
  };

  const handleDisable = () => {
    setError(null);
    disableSync.mutate(undefined, {
      onError: (err) => setError(describeFailure(err)),
    });
  };

  const handleToggle = (next: boolean) => {
    if (next) handleEnable();
    else handleDisable();
  };

  const handleRetry = () => {
    setError(null);
    syncNow.mutate(undefined, {
      onError: (err) => setError(describeFailure(err)),
    });
  };

  const statusError =
    payload?.error_code === undefined || payload.error_code === null
      ? null
      : describeFailure({
          type: "sync",
          code: payload.error_code,
          message: "",
          recoverable: payload.recoverable,
        });

  return (
    <SettingsSection heading={t("sync.sectionHeading")}>
      <Card flush data-testid="settings-sync">
        <SettingRow
          title={t("sync.whatIsSyncedTitle")}
          description={
            <>
              <span className="block">{t("sync.whatIsSyncedBody")}</span>
              <span className="mt-1 block">{t("sync.whatIsNotSyncedBody")}</span>
              <span className="mt-1 block">{t("sync.whereItLivesBody")}</span>
            </>
          }
          data-testid="setting-sync-explainer"
        />

        <SettingRow
          title={t("sync.accountTitle")}
          description={
            profile.data === undefined
              ? t("sync.accountUnknown")
              : t("sync.accountProfile", { label: profile.data.label })
          }
          control={
            ineligible === "signed_out" ? (
              <Button
                variant="outline"
                render={<Link to="/profile" />}
                data-testid="sync-sign-in-link"
              >
                {t("sync.signInAction")}
              </Button>
            ) : undefined
          }
          data-testid="setting-sync-account"
        />

        <SettingRow
          title={t("sync.autoTitle")}
          description={t("sync.autoBody")}
          control={
            <Switch
              checked={!paused && ineligible === null}
              disabled={ineligible !== null || busy}
              onCheckedChange={handleToggle}
              aria-label={t("sync.autoTitle")}
              data-testid="sync-switch"
            />
          }
          data-testid="setting-sync-switch"
        />

        <SettingRow
          title={t("sync.statusTitle")}
          description={`${t(automatic.labelKey)} — ${t(automatic.detailKey)}`}
          control={
            state === "error" || state === "offline" ? (
              <Button
                variant="outline"
                onClick={handleRetry}
                disabled={busy}
                aria-disabled={busy || undefined}
                data-testid="sync-retry-button"
              >
                {syncNow.isPending ? t("sync.retrying") : t("sync.retry")}
              </Button>
            ) : undefined
          }
          data-testid="setting-sync-status"
        />

        {enabled && (
          <SettingRow
            title={t("sync.lastSyncTitle")}
            description={
              payload?.last_sync_ms === undefined || payload.last_sync_ms === null
                ? t("sync.lastSyncNever")
                : formatSyncTimestamp(payload.last_sync_ms, i18n.language)
            }
            data-testid="setting-sync-last-sync"
          />
        )}

        <SettingRow
          title={t("sync.diagnosticsTitle")}
          description={
            diagnostics.data === undefined ? (
              t("sync.diagnosticsBody")
            ) : (
              <span data-testid="sync-diagnostics-output">
                {t("sync.diagnosticsSummary", {
                  state: t(syncStateLabelKey(diagnostics.data.state)),
                  uploads: diagnostics.data.uploads,
                  conflicts: diagnostics.data.conflicts,
                  restores: diagnostics.data.restores,
                  failures: diagnostics.data.failures,
                  blocked: diagnostics.data.blocked,
                })}
              </span>
            )
          }
          control={
            <Button
              variant="link"
              onClick={() => setDiagnosticsRequested(true)}
              disabled={diagnostics.isFetching}
              aria-disabled={diagnostics.isFetching || undefined}
              data-testid="sync-diagnostics-button"
            >
              {diagnostics.isFetching
                ? t("sync.diagnosticsLoading")
                : t("sync.diagnosticsAction")}
            </Button>
          }
          data-testid="setting-sync-diagnostics"
        />

        <SettingRow
          title={t("sync.diagnosticsExportTitle")}
          description={
            exportedPath === null ? (
              t("sync.diagnosticsExportBody")
            ) : (
              <span data-testid="sync-diagnostics-export-path">
                {t("sync.diagnosticsExportSaved", { path: exportedPath })}
              </span>
            )
          }
          control={
            <Button
              variant="outline"
              onClick={handleExportDiagnostics}
              disabled={exportDiagnostics.isPending}
              aria-disabled={exportDiagnostics.isPending || undefined}
              data-testid="sync-diagnostics-export-button"
            >
              {exportDiagnostics.isPending
                ? t("sync.diagnosticsExporting")
                : t("sync.diagnosticsExportAction")}
            </Button>
          }
          data-testid="setting-sync-diagnostics-export"
        />

        {separateProfileId !== null && (
          <Alert variant="info" data-testid="sync-separate-profile-notice">
            <AlertTitle>{t("sync.separateProfileTitle")}</AlertTitle>
            <AlertDescription>{t("sync.separateProfileBody")}</AlertDescription>
          </Alert>
        )}

        {statusError !== null && (
          <Alert variant="over" data-testid="sync-status-error">
            <AlertTitle>{t("sync.problemTitle")}</AlertTitle>
            <AlertDescription>{statusError}</AlertDescription>
          </Alert>
        )}

        {error !== null && (
          <Alert variant="over" data-testid="sync-action-error">
            {error}
          </Alert>
        )}
      </Card>

      <SyncFirstSyncDialog
        open={firstSyncOpen}
        onOpenChange={setFirstSyncOpen}
        stage={firstSyncStage}
        error={error}
        // Retrying a failed *enable* re-runs `sync_enable`, not `sync_now`: sync was never turned
        // on, so an upload request would come back as `not_enabled`.
        onRetry={handleEnable}
      />
    </SettingsSection>
  );
}
