import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button, Card } from "@nixus/shared";
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

  const handleDisable = () => {
    setError(null);
    disableSync.mutate(undefined, {
      onError: (err) => setError(describeFailure(err)),
    });
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

        {ineligible !== null ? (
          <SettingRow
            title={t(
              ineligible === "local_only"
                ? "sync.unavailableLocalOnlyTitle"
                : "sync.unavailableSignedOutTitle"
            )}
            description={t(
              ineligible === "local_only"
                ? "sync.unavailableLocalOnlyBody"
                : "sync.unavailableSignedOutBody"
            )}
            control={
              <Button
                disabled
                aria-disabled="true"
                data-testid="sync-enable-button"
              >
                {t("sync.enableAction")}
              </Button>
            }
            data-testid="setting-sync-unavailable"
          />
        ) : enabled ? (
          <>
            <SettingRow
              title={t("sync.statusTitle")}
              description={`${t(syncStateLabelKey(state))} — ${t(syncStateDetailKey(state))}`}
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
            <SettingRow
              title={t("sync.lastSyncTitle")}
              description={
                payload?.last_sync_ms === undefined || payload.last_sync_ms === null
                  ? t("sync.lastSyncNever")
                  : formatSyncTimestamp(payload.last_sync_ms, i18n.language)
              }
              data-testid="setting-sync-last-sync"
            />
            <SettingRow
              title={t("sync.disableTitle")}
              description={t("sync.disableBody")}
              control={
                <Button
                  variant="outline"
                  onClick={handleDisable}
                  disabled={busy}
                  aria-disabled={busy || undefined}
                  data-testid="sync-disable-button"
                >
                  {disableSync.isPending ? t("sync.disabling") : t("sync.disableAction")}
                </Button>
              }
              data-testid="setting-sync-disable"
            />
          </>
        ) : (
          <SettingRow
            title={t("sync.enableTitle")}
            description={t("sync.enableBody")}
            control={
              <Button
                onClick={handleEnable}
                disabled={busy}
                aria-disabled={busy || undefined}
                data-testid="sync-enable-button"
              >
                {enableSync.isPending ? t("sync.enabling") : t("sync.enableAction")}
              </Button>
            }
            data-testid="setting-sync-enable"
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
