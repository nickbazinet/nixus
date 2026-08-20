import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  focusRing,
} from "@nixus/shared";
import { toast } from "sonner";
import { FINANCE_ONBOARDING_DISMISSED_KEY } from "@/lib/datasetSwitch";
import { cn } from "@/lib/utils";

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

const ONBOARDING_DISMISS_KEY = FINANCE_ONBOARDING_DISMISSED_KEY;

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

  const confirmWord = t("settings.dangerZoneConfirmWord");
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
      if (result) toast.success(t("sidebar.backupSaved", { path: result.path }));
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
      setError(t("settings.dangerZoneRestartFailed"));
    }
  };

  return (
    <Card flush data-testid="danger-zone">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        disabled={deleting || wiped}
        aria-expanded={isExpanded}
        aria-controls="danger-zone-content"
        className={cn(
          "flex w-full items-center gap-2 px-card-pad py-3.5 text-left transition-colors hover:bg-hover disabled:cursor-default",
          focusRing
        )}
        data-testid="danger-zone-toggle"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-h3 text-over-ink">{t("settings.dangerZone")}</span>
          <span className="mt-0.5 block text-caption text-ink-dim">
            {t("settings.dangerZoneDescription")}
          </span>
        </span>
        {isExpanded ? (
          <ChevronUp className="size-4 shrink-0 text-ink-dim" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-ink-dim" aria-hidden="true" />
        )}
      </button>

      {isExpanded && (
        <div
          id="danger-zone-content"
          className="border-t border-line px-card-pad py-card-pad"
        >
          <dl className="space-y-2 text-caption">
            <dt className="text-label text-ink">{t("settings.dangerZoneDeletedTitle")}</dt>
            <dd className="text-ink-dim">{t("settings.dangerZoneDeletedList")}</dd>
            <dt className="text-label text-ink">{t("settings.dangerZoneKeptTitle")}</dt>
            <dd className="text-ink-dim">{t("settings.dangerZoneKeptList")}</dd>
          </dl>

          <div className="mt-4">
            <Button
              variant="outline"
              onClick={handleExportBackup}
              disabled={exporting}
              aria-disabled={exporting || undefined}
              data-testid="danger-zone-export-backup"
            >
              {exporting
                ? t("settings.dangerZoneExporting")
                : t("settings.dangerZoneExportBackup")}
            </Button>
          </div>

          {/* Demoted out of the primary row: a destructive action is never a peer of a primary
            * action side by side, so it sits on its own line under the safe one. */}
          <div className="mt-4 border-t border-line pt-4">
            <Button
              variant="destructive"
              onClick={() => handleOpenChange(true)}
              disabled={exporting || deleting || wiped}
              aria-disabled={exporting || deleting || wiped || undefined}
              data-testid="danger-zone-delete-button"
            >
              {t("settings.dangerZoneDeleteAll")}
            </Button>
          </div>

          {error !== null && !open && (
            <Alert variant="over" className="mt-3">
              {error}
            </Alert>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-over-ink">
              {t("settings.dangerZoneDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.dangerZoneDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="danger-zone-confirm" required>
              {t("settings.dangerZoneTypeToConfirm", { word: confirmWord })}
            </Label>
            <Input
              id="danger-zone-confirm"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmWord}
              autoComplete="off"
              autoFocus
              required
              aria-required="true"
              disabled={deleting || wiped}
              data-testid="danger-zone-confirm-input"
            />
          </div>

          {error !== null && (
            <Alert variant="over" data-testid="danger-zone-error">
              {error}
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={deleting || wiped}
              aria-disabled={deleting || wiped || undefined}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!canDelete}
              aria-disabled={!canDelete || undefined}
              data-testid="danger-zone-confirm-button"
            >
              {deleting
                ? t("settings.dangerZoneDeleting")
                : t("settings.dangerZoneConfirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
