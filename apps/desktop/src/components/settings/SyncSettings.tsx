import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle, Button, Card } from "@nixus/shared";
import { isSyncError, parseAppError, syncMessageKey } from "@/lib/appError";
import { syncStateLabelKey } from "@/lib/syncState";
import { useDuplicates, useRemoveDuplicates } from "@/hooks/useDuplicates";
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
  const [duplicatesRequested, setDuplicatesRequested] = useState(false);
  const [duplicatesRemoved, setDuplicatesRemoved] = useState<number | null>(null);
  const duplicates = useDuplicates({ enabled: duplicatesRequested });
  const removeDuplicates = useRemoveDuplicates();

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

  const handleLookForDuplicates = () => {
    setError(null);
    setDuplicatesRemoved(null);
    // A second look is a second scan: the query stays enabled, so asking again has to refetch.
    if (duplicatesRequested) {
      void duplicates.refetch();
    } else {
      setDuplicatesRequested(true);
    }
  };

  const handleRemoveDuplicates = () => {
    setError(null);
    removeDuplicates.mutate(undefined, {
      onSuccess: (removed) => {
        // What was asked about is gone, so the question is closed: asking again is a fresh scan,
        // and the number on screen is what was removed rather than a stale count of what remained.
        setDuplicatesRequested(false);
        setDuplicatesRemoved(removed.total);
      },
      onError: () => setError(t("sync.duplicatesFailed")),
    });
  };

  const found = duplicates.data;
  const duplicatesDescription = ((): string => {
    if (duplicatesRemoved !== null) {
      return t("sync.duplicatesRemoved", { count: duplicatesRemoved });
    }
    if (duplicatesRequested && duplicates.isFetching) return t("sync.duplicatesChecking");
    if (duplicatesRequested && duplicates.isError) return t("sync.duplicatesFailed");
    if (duplicatesRequested && found !== undefined) {
      if (!found.sync_available) return t("sync.duplicatesUnavailable");
      if (found.total === 0) return t("sync.duplicatesNone");
      return t("sync.duplicatesFound", { count: found.total });
    }
    return t("sync.duplicatesBody");
  })();

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

        <SettingRow
          title={t("sync.duplicatesTitle")}
          description={<span data-testid="sync-duplicates-output">{duplicatesDescription}</span>}
          control={
            duplicatesRequested && found !== undefined && found.total > 0 ? (
              <Button
                variant="destructive"
                onClick={handleRemoveDuplicates}
                disabled={removeDuplicates.isPending}
                aria-disabled={removeDuplicates.isPending || undefined}
                data-testid="sync-duplicates-remove-button"
              >
                {removeDuplicates.isPending
                  ? t("sync.duplicatesRemoving")
                  : t("sync.duplicatesRemove", { count: found.total })}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleLookForDuplicates}
                disabled={duplicates.isFetching}
                aria-disabled={duplicates.isFetching || undefined}
                data-testid="sync-duplicates-check-button"
              >
                {duplicates.isFetching
                  ? t("sync.duplicatesChecking")
                  : t("sync.duplicatesCheck")}
              </Button>
            )
          }
          data-testid="setting-sync-duplicates"
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
