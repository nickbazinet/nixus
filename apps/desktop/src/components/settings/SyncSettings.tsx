import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle, Button, Card } from "@nixus/shared";
import { isSyncError, parseAppError, syncMessageKey } from "@/lib/appError";
import { syncStateLabelKey } from "@/lib/syncState";
import {
  useExportSyncDiagnostics,
  useSyncDiagnostics,
  useSyncStatusValue,
} from "@/hooks/useSync";
import { SettingRow, SettingsSection } from "./SettingRow";

export function SyncSettings() {
  const { t } = useTranslation();
  const status = useSyncStatusValue();
  const [diagnosticsRequested, setDiagnosticsRequested] = useState(false);
  const diagnostics = useSyncDiagnostics({ enabled: diagnosticsRequested });
  const exportDiagnostics = useExportSyncDiagnostics();
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payload = status.data;

  const describeFailure = (err: unknown): string => {
    const parsed = parseAppError(err);
    if (isSyncError(parsed)) return t(syncMessageKey(parsed.code));
    return t("sync.errorTransport");
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

    </SettingsSection>
  );
}
