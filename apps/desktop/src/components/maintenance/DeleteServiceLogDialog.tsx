import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { useDeleteServiceLog } from "@/hooks/useServiceHistory";
import { formatServiceEntryLabel } from "@/lib/maintenanceUtils";
import { formatServiceEntryFullDate } from "@/lib/serviceHistoryDates";
import type { MaintenanceServiceLogEntry } from "@/lib/types";

interface DeleteServiceLogDialogProps {
  entry: MaintenanceServiceLogEntry | null;
  onClose: () => void;
}

export function DeleteServiceLogDialog({
  entry,
  onClose,
}: DeleteServiceLogDialogProps) {
  const { t, i18n } = useTranslation();
  const deleteServiceLog = useDeleteServiceLog();

  const handleDelete = () => {
    if (!entry) return;
    deleteServiceLog.mutate(entry.id, {
      onSuccess: () => {
        onClose();
      },
      onError: () => {
        toast.error(t("maintenance.toast.serviceDeleteFailed"));
        onClose();
      },
    });
  };

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        style={{ zIndex: 100 }}
        data-testid="delete-service-log-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("maintenance.history.deleteEntry")}</DialogTitle>
          <DialogDescription>
            {entry &&
              t("maintenance.history.deleteConfirm", {
                service: formatServiceEntryLabel(entry, t),
                date: formatServiceEntryFullDate(
                  entry.service_date,
                  i18n.language
                ),
              })}{" "}
            {/* Only a scheduled entry has anchors to recompute; promising a custom entry the same
                would describe work that never happens. */}
            {entry &&
              (entry.task_id !== null
                ? t("maintenance.history.deleteScheduleNote")
                : t("maintenance.history.deleteCustomNote"))}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteServiceLog.isPending}
            data-testid="confirm-delete-service-log-button"
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
