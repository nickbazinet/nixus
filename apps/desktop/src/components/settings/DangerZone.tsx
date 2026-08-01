import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nixus/shared";
import { toast } from "sonner";

interface AppError {
  message?: string;
}

function getErrorMessage(err: unknown): string {
  const e = err as AppError;
  return (
    e?.message ??
    (typeof err === "string" ? err : JSON.stringify(err, null, 2)) ??
    "An unexpected error occurred"
  );
}

const ONBOARDING_DISMISS_KEY = "finance.onboarding.dismissed";

export function DangerZone() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmWord = t("settings.dangerZoneConfirmWord", "DELETE");
  const canDelete = typed.trim() === confirmWord && !deleting && !wiped;
  // Stay open through the wipe so the restart-failure message cannot be hidden.
  const isExpanded = expanded || deleting || wiped;

  const handleOpenChange = (next: boolean) => {
    if (deleting || wiped) return;
    setOpen(next);
    setTyped("");
    setError(null);
  };

  const handleExportBackup = async () => {
    setExporting(true);
    setError(null);
    try {
      const result = await invoke<{ path: string } | null>("export_backup");
      if (result) {
        toast.success(t("sidebar.backupSaved", { path: result.path }));
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await invoke("delete_all_data");
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setDeleting(false);
      return;
    }

    // Past this point the data is gone. Never report a failure as "delete failed".
    setWiped(true);
    queryClient.clear();
    try {
      // The dashboard's "finish setup" banner is the post-wipe recovery path; a stale
      // dismissal flag would otherwise leave the user on an empty dashboard with no
      // route back to onboarding.
      localStorage.removeItem(ONBOARDING_DISMISS_KEY);
    } catch {
      // localStorage unavailable
    }

    try {
      await relaunch();
    } catch {
      setError(
        t(
          "settings.dangerZoneRestartFailed",
          "Your data was deleted. Please close and reopen Nixus to finish."
        )
      );
    }
  };

  return (
    <div
      className="rounded-lg border border-destructive/50 bg-card"
      data-testid="danger-zone"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        disabled={deleting || wiped}
        aria-expanded={isExpanded}
        aria-controls="danger-zone-content"
        className="flex w-full items-center gap-2 rounded-lg p-6 text-left transition-colors hover:bg-destructive/5 disabled:cursor-default"
        data-testid="danger-zone-toggle"
      >
        <span className="flex-1">
          <span className="block text-base font-semibold text-destructive">
            {t("settings.dangerZone", "Danger Zone")}
          </span>
          <span className="mt-2 block text-sm text-muted-foreground">
            {t(
              "settings.dangerZoneDescription",
              "Permanently delete everything you have recorded in Nixus. This cannot be undone."
            )}
          </span>
        </span>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div id="danger-zone-content" className="px-6 pb-6">
          <div className="space-y-2 text-sm">
            <p className="font-medium text-foreground">
              {t("settings.dangerZoneDeletedTitle", "This deletes:")}
            </p>
            <p className="text-muted-foreground">
              {t(
                "settings.dangerZoneDeletedList",
                "Budgets and categories, expenses, recurring templates, accounts, passive assets, net worth history, income, vehicles and maintenance history, AI chat conversations, and the audit log."
              )}
            </p>
            <p className="font-medium text-foreground">
              {t("settings.dangerZoneKeptTitle", "This keeps:")}
            </p>
            <p className="text-muted-foreground">
              {t(
                "settings.dangerZoneKeptList",
                "Your app preferences and stored AI provider credentials. Use Clear Credentials above to remove those."
              )}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={handleExportBackup}
              disabled={exporting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              data-testid="danger-zone-export-backup"
            >
              {exporting
                ? t("settings.dangerZoneExporting", "Exporting...")
                : t("settings.dangerZoneExportBackup", "Export a backup first")}
            </button>

            <button
              onClick={() => handleOpenChange(true)}
              disabled={exporting || deleting || wiped}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              data-testid="danger-zone-delete-button"
            >
              {t("settings.dangerZoneDeleteAll", "Delete all data")}
            </button>
          </div>

          {error !== null && !open && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t("settings.dangerZoneDialogTitle", "Delete all data?")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.dangerZoneDialogDescription",
                "Every budget, expense, account, asset, net worth entry, income record, vehicle, maintenance log, chat conversation and audit entry will be permanently deleted. Nixus will restart with an empty database."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="danger-zone-confirm">
              {t("settings.dangerZoneTypeToConfirm", "Type {{word}} to confirm", {
                word: confirmWord,
              })}
            </Label>
            <Input
              id="danger-zone-confirm"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmWord}
              autoComplete="off"
              autoFocus
              disabled={deleting || wiped}
              data-testid="danger-zone-confirm-input"
            />
          </div>

          {error !== null && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="danger-zone-error"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <button
              onClick={() => handleOpenChange(false)}
              disabled={deleting || wiped}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleDelete}
              disabled={!canDelete}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              data-testid="danger-zone-confirm-button"
            >
              {deleting
                ? t("settings.dangerZoneDeleting", "Deleting...")
                : t("settings.dangerZoneConfirmDelete", "Delete everything")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
