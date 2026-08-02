import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertDescription, Button, Card } from "@nixus/shared";
import { DangerZone } from "./DangerZone";
import { SettingRow, SettingsSection } from "./SettingRow";

function getErrorMessage(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? (typeof err === "string" ? err : "");
}

export function YourDataSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveCopy = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await invoke<{ path: string } | null>("export_backup");
      if (result) toast.success(t("sidebar.backupSaved", { path: result.path }));
    } catch (err: unknown) {
      setError(getErrorMessage(err) || t("sidebar.backupFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    setError(null);
    try {
      const restored = await invoke<boolean>("import_backup");
      if (restored) {
        queryClient.clear();
        toast.success(t("sidebar.restoreSuccess"));
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || t("sidebar.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-section-gap" data-testid="settings-your-data">
      <div>
        <h2 className="text-h1 text-ink">{t("settings.yourDataTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("settings.yourDataDescription")}
        </p>
      </div>

      {error !== null && (
        <Alert variant="over" data-testid="your-data-error">
          {error}
        </Alert>
      )}

      <SettingsSection heading={t("settings.sectionBackup")}>
        <Card flush>
          <SettingRow
            title={t("settings.backupSaveTitle")}
            description={t("settings.backupSaveBody")}
            control={
              <Button
                onClick={handleSaveCopy}
                disabled={saving || restoring}
                aria-disabled={saving || restoring || undefined}
                data-testid="your-data-save-copy"
              >
                {saving ? t("settings.backupSaving") : t("settings.backupSaveAction")}
              </Button>
            }
            data-testid="setting-backup"
          />
          <SettingRow
            title={t("settings.dataLocationTitle")}
            description={t("settings.dataLocationUnknown")}
            data-testid="setting-data-location"
          />
        </Card>
      </SettingsSection>

      {/* The warning sits above the control rather than inside a confirm dialog after the fact:
        * "restore replaces everything" is the thing to know before choosing a file, not after. */}
      <SettingsSection heading={t("settings.sectionRestore")}>
        <Card flush>
          <Alert variant="caution">
            <AlertTitle>{t("settings.restoreWarningTitle")}</AlertTitle>
            <AlertDescription>{t("settings.restoreWarningBody")}</AlertDescription>
          </Alert>
          <SettingRow
            title={t("settings.restoreTitle")}
            description={t("settings.restoreBody")}
            control={
              <Button
                variant="outline"
                onClick={handleRestore}
                disabled={saving || restoring}
                aria-disabled={saving || restoring || undefined}
                data-testid="your-data-restore"
              >
                {restoring ? t("settings.restoring") : t("settings.restoreAction")}
              </Button>
            }
            data-testid="setting-restore"
          />
        </Card>
      </SettingsSection>

      {/* No export command exists on the Rust side, so there is no button to wire. The absence is
        * stated rather than hidden, because a spreadsheet user's exit route is the question that
        * decides whether she adopts the product at all. */}
      <SettingsSection heading={t("settings.sectionExport")}>
        <Card flush>
          <SettingRow
            title={t("settings.exportOwnershipLine")}
            data-testid="setting-export-promise"
          />
          <SettingRow
            title={t("settings.exportUnavailableTitle")}
            description={t("settings.exportUnavailableBody")}
            data-testid="setting-export-unavailable"
          />
        </Card>
      </SettingsSection>

      {/* Template import/export needs a versioned document format and an amount-stripping export
        * the backend does not have. Shipping the button first would leak a mortgage payment into
        * the first shared template. */}
      <SettingsSection heading={t("settings.sectionTemplates")}>
        <Card flush>
          <SettingRow
            title={t("settings.templatesUnavailableTitle")}
            description={t("settings.templatesUnavailableBody")}
            data-testid="setting-templates-unavailable"
          />
        </Card>
      </SettingsSection>

      <DangerZone />
    </div>
  );
}
