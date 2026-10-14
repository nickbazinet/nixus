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

interface SyncRemoteChangedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remoteCreatedMs: number;
  busy: boolean;
  error: string | null;
  onResolve: (action: "load_remote" | "keep_local") => void;
}

/**
 * The cloud copy was written by another computer, so publishing over it would discard that work.
 *
 * Neither option is framed as the default: loading the cloud copy keeps the current file as a dated
 * backup and keeping the local copy publishes over the cloud one on the next upload, and both facts
 * are stated on their own option. Dismissing answers nothing — the backend refuses to upload while
 * the question is open, so "decide later" is a real, safe outcome.
 */
export function SyncRemoteChangedDialog({
  open,
  onOpenChange,
  remoteCreatedMs,
  busy,
  error,
  onResolve,
}: SyncRemoteChangedDialogProps) {
  const { t, i18n } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sync-remote-changed-dialog">
        <DialogHeader>
          <DialogTitle>{t("sync.remoteChangedTitle")}</DialogTitle>
          <DialogDescription>
            {t("sync.remoteChangedDescription", {
              date: formatSyncTimestamp(remoteCreatedMs, i18n.language),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-line p-card-pad">
            <p className="text-label text-ink">{t("sync.remoteChangedLoadTitle")}</p>
            <p className="mt-1 text-caption text-ink-dim">
              {t("sync.remoteChangedLoadBody")}
            </p>
            <Button
              className="mt-3"
              autoFocus
              onClick={() => onResolve("load_remote")}
              disabled={busy}
              aria-disabled={busy || undefined}
              data-testid="sync-remote-changed-load"
            >
              {t("sync.remoteChangedLoadAction")}
            </Button>
          </div>

          <div className="rounded-md border border-line p-card-pad">
            <p className="text-label text-ink">{t("sync.remoteChangedKeepTitle")}</p>
            <p className="mt-1 text-caption text-ink-dim">
              {t("sync.remoteChangedKeepBody")}
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => onResolve("keep_local")}
              disabled={busy}
              aria-disabled={busy || undefined}
              data-testid="sync-remote-changed-keep"
            >
              {t("sync.remoteChangedKeepAction")}
            </Button>
          </div>
        </div>

        {error !== null && (
          <Alert variant="over" data-testid="sync-remote-changed-error">
            {error}
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            aria-disabled={busy || undefined}
            data-testid="sync-remote-changed-later"
          >
            {t("sync.decideLater")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
