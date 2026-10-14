import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { formatSyncTimestamp } from "@/lib/syncState";

interface SyncLinkChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localRows: number;
  remoteCreatedMs: number;
  busy: boolean;
  error: string | null;
  onChoose: (choice: "replace" | "separate") => void;
}

/**
 * CAP-5: this computer already holds data, so linking it to an account that already has a cloud
 * copy is a question rather than an operation.
 *
 * The safe option is first and carries `autoFocus`, and replace is the only `destructive` button, so
 * neither Enter nor a reflex click can destroy data. The dated-backup promise is in the body of the
 * replace option rather than in a toast afterwards: it is the fact that makes the choice safe to
 * make, and it is worthless once the click has happened.
 */
export function SyncLinkChoiceDialog({
  open,
  onOpenChange,
  localRows,
  remoteCreatedMs,
  busy,
  error,
  onChoose,
}: SyncLinkChoiceDialogProps) {
  const { t, i18n } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sync-link-choice-dialog">
        <DialogHeader>
          <DialogTitle>{t("sync.linkChoiceTitle")}</DialogTitle>
          <DialogDescription>
            {t("sync.linkChoiceDescription", {
              rows: localRows,
              date: formatSyncTimestamp(remoteCreatedMs, i18n.language),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-line p-card-pad">
            <p className="text-label text-ink">{t("sync.linkChoiceKeepSeparateTitle")}</p>
            <p className="mt-1 text-caption text-ink-dim">
              {t("sync.linkChoiceKeepSeparateBody")}
            </p>
            <Button
              variant="outline"
              className="mt-3"
              autoFocus
              onClick={() => onChoose("separate")}
              disabled={busy}
              aria-disabled={busy || undefined}
              data-testid="sync-link-choice-separate"
            >
              {t("sync.linkChoiceKeepSeparateAction")}
            </Button>
          </div>

          <div className="rounded-md border border-over bg-over-bg p-card-pad">
            <p className="text-label text-over-ink">{t("sync.linkChoiceReplaceTitle")}</p>
            <p className="mt-1 text-caption text-ink-dim">
              {t("sync.linkChoiceReplaceBody")}
            </p>
            <p className="mt-1 text-caption text-ink-dim">
              {t("sync.linkChoiceReplaceBackup")}
            </p>
            <Button
              variant="destructive"
              className="mt-3"
              onClick={() => onChoose("replace")}
              disabled={busy}
              aria-disabled={busy || undefined}
              data-testid="sync-link-choice-replace"
            >
              {t("sync.linkChoiceReplaceAction")}
            </Button>
          </div>
        </div>

        {error !== null && (
          <Alert variant="over" data-testid="sync-link-choice-error">
            {error}
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            aria-disabled={busy || undefined}
            data-testid="sync-link-choice-later"
          >
            {t("sync.decideLater")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
