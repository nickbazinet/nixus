import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertDescription, Button, Card } from "@nixus/shared";
import {
  useApplySystemTemplate,
  useExportBudgetTemplate,
  useImportBudgetTemplate,
  useSystemTemplates,
} from "@/hooks/useBudgetTemplates";
import { DangerZone } from "./DangerZone";
import { SettingRow, SettingsSection } from "./SettingRow";

function getErrorMessage(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? (typeof err === "string" ? err : "");
}

// Rust ships every system template's name and description as English-only consts, so the id slug
// is the only stable i18n anchor. An unmapped id falls back to the backend strings.
const STARTER_TEMPLATE_COPY: Record<string, { nameKey: string; bodyKey: string }> = {
  "canadian-starter": {
    nameKey: "settings.templateStarterCanadianName",
    bodyKey: "settings.templateStarterCanadianBody",
  },
};

export function YourDataSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportTemplate = useExportBudgetTemplate();
  const importTemplate = useImportBudgetTemplate();
  const starterTemplates = useSystemTemplates();
  const applyStarterTemplate = useApplySystemTemplate();
  const busy =
    saving ||
    restoring ||
    exportTemplate.isPending ||
    importTemplate.isPending ||
    applyStarterTemplate.isPending;
  const starters = starterTemplates.data ?? [];
  const applyingId = applyStarterTemplate.isPending
    ? applyStarterTemplate.variables?.templateId
    : undefined;

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

  const handleExportTemplate = async () => {
    setError(null);
    try {
      const result = await exportTemplate.mutateAsync();
      if (result) toast.success(t("settings.templateSaved", { path: result.path }));
    } catch (err: unknown) {
      setError(getErrorMessage(err) || t("settings.templateSaveFailed"));
    }
  };

  const handleImportTemplate = async () => {
    setError(null);
    try {
      const result = await importTemplate.mutateAsync();
      if (!result) return; // User cancelled the native dialog
      const skipped = result.skipped_groups.join(", ");
      if (result.groups_created === 0) {
        toast.info(t("settings.templateImportAllSkipped", { skipped }));
      } else if (result.skipped_groups.length > 0) {
        toast.success(
          t("settings.templateImportedSkipped", {
            groups: result.groups_created,
            categories: result.categories_created,
            skipped,
          })
        );
      } else {
        toast.success(
          t("settings.templateImported", {
            groups: result.groups_created,
            categories: result.categories_created,
          })
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || t("settings.templateImportFailed"));
    }
  };

  const handleApplyStarterTemplate = async (templateId: string) => {
    setError(null);
    try {
      const result = await applyStarterTemplate.mutateAsync({ templateId });
      const skipped = result.skipped_groups.join(", ");
      // Checked first: every group collided, so "added 0 groups" would read as a success.
      if (result.groups_created === 0) {
        toast.info(t("settings.templateApplyAllSkipped", { skipped }));
      } else if (result.skipped_groups.length > 0) {
        toast.success(
          t("settings.templateAppliedSkipped", {
            groups: result.groups_created,
            categories: result.categories_created,
            skipped,
          })
        );
      } else {
        toast.success(
          t("settings.templateApplied", {
            groups: result.groups_created,
            categories: result.categories_created,
          })
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || t("settings.templateApplyFailed"));
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
                disabled={busy}
                aria-disabled={busy || undefined}
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
                disabled={busy}
                aria-disabled={busy || undefined}
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

      <SettingsSection heading={t("settings.sectionTemplates")}>
        <Card flush>
          {starterTemplates.isPending ? (
            <SettingRow
              title={t("settings.templateStarterLoading")}
              data-testid="setting-template-starter-loading"
            />
          ) : starters.length === 0 ? (
            <SettingRow
              title={t("settings.templateStarterUnavailable")}
              data-testid="setting-template-starter-empty"
            />
          ) : (
            starters.map((template) => {
              const copy = STARTER_TEMPLATE_COPY[template.id];
              return (
                <SettingRow
                  key={template.id}
                  title={copy === undefined ? template.name : t(copy.nameKey)}
                  description={
                    copy === undefined
                      ? (template.description ?? undefined)
                      : t(copy.bodyKey)
                  }
                  control={
                    <Button
                      onClick={() => handleApplyStarterTemplate(template.id)}
                      disabled={busy}
                      aria-disabled={busy || undefined}
                      data-testid={`your-data-template-apply-${template.id}`}
                    >
                      {applyingId === template.id
                        ? t("settings.templateStarterApplying")
                        : t("settings.templateStarterApplyAction")}
                    </Button>
                  }
                  data-testid={`setting-template-starter-${template.id}`}
                />
              );
            })
          )}
          <SettingRow
            title={t("settings.templateExportTitle")}
            description={t("settings.templateExportBody")}
            control={
              <Button
                onClick={handleExportTemplate}
                disabled={busy}
                aria-disabled={busy || undefined}
                data-testid="your-data-template-export"
              >
                {exportTemplate.isPending
                  ? t("settings.templateExporting")
                  : t("settings.templateExportAction")}
              </Button>
            }
            data-testid="setting-template-export"
          />
          <SettingRow
            title={t("settings.templateImportTitle")}
            description={t("settings.templateImportBody")}
            control={
              <Button
                variant="outline"
                onClick={handleImportTemplate}
                disabled={busy}
                aria-disabled={busy || undefined}
                data-testid="your-data-template-import"
              >
                {importTemplate.isPending
                  ? t("settings.templateImporting")
                  : t("settings.templateImportAction")}
              </Button>
            }
            data-testid="setting-template-import"
          />
        </Card>
      </SettingsSection>

      <DangerZone />
    </div>
  );
}
