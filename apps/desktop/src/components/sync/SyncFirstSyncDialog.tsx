import { useTranslation } from "react-i18next";
import { Check, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StepProgress,
} from "@nixus/shared";

/**
 * Where the first sync has got to. `preparing` is the local snapshot build and `uploading` is the
 * transfer, which are the two waits long enough to be worth distinguishing on a large dataset.
 */
export type FirstSyncStage = "preparing" | "uploading" | "done" | "failed";

const STEP_OF: Record<FirstSyncStage, number> = {
  preparing: 1,
  uploading: 2,
  done: 3,
  failed: 1,
};

const STAGE_LABEL_KEY: Record<FirstSyncStage, string> = {
  preparing: "sync.firstSyncPreparing",
  uploading: "sync.firstSyncUploading",
  done: "sync.firstSyncDone",
  failed: "sync.firstSyncFailed",
};

interface SyncFirstSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: FirstSyncStage;
  error: string | null;
  onRetry: () => void;
}

export function SyncFirstSyncDialog({
  open,
  onOpenChange,
  stage,
  error,
  onRetry,
}: SyncFirstSyncDialogProps) {
  const { t } = useTranslation();
  const inProgress = stage === "preparing" || stage === "uploading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sync-first-sync-dialog">
        <DialogHeader>
          <DialogTitle>{t("sync.firstSyncTitle")}</DialogTitle>
          <DialogDescription>{t("sync.firstSyncDescription")}</DialogDescription>
        </DialogHeader>

        <StepProgress
          completed={STEP_OF[stage]}
          total={3}
          label={t("sync.firstSyncProgressLabel")}
          valueText={t(STAGE_LABEL_KEY[stage])}
        />

        {/* `role="status"` rather than a plain line: the stage changes while focus stays on the
          * dialog, so a screen reader would otherwise never hear the app stopped working. */}
        <p
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 text-caption text-ink-dim"
          data-testid="sync-first-sync-stage"
          data-stage={stage}
        >
          {inProgress && (
            <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          )}
          {stage === "done" && (
            <Check className="size-4 shrink-0 text-good-ink" aria-hidden="true" />
          )}
          {stage === "failed" && (
            <TriangleAlert className="size-4 shrink-0 text-over" aria-hidden="true" />
          )}
          {t(STAGE_LABEL_KEY[stage])}
        </p>

        {error !== null && (
          <Alert variant="over" data-testid="sync-first-sync-error">
            {error}
          </Alert>
        )}

        <DialogFooter>
          {stage === "failed" && (
            <Button onClick={onRetry} data-testid="sync-first-sync-retry">
              {t("sync.retry")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="sync-first-sync-close"
          >
            {stage === "done" ? t("sync.done") : t("sync.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
