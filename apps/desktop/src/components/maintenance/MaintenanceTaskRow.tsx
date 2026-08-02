import { useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AttentionRow, Button } from "@nixus/shared";
import { EditIntervalDialog } from "@/components/maintenance/EditIntervalDialog";
import { LogServiceForm } from "@/components/maintenance/LogServiceForm";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import {
  formatNextDueLine,
  formatTaskAccessibleName,
  getMaintenanceStatusTone,
  getMaintenanceTaskLabel,
} from "@/lib/maintenanceUtils";
import type { MaintenanceTaskWithStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MaintenanceTaskRowProps {
  task: MaintenanceTaskWithStatus;
  vehicleId: number;
  vehicleOdometerKm: number;
}

export function MaintenanceTaskRow({
  task,
  vehicleId,
  vehicleOdometerKm,
}: MaintenanceTaskRowProps) {
  const { t } = useTranslation();
  const nextDueLine = formatNextDueLine(task, t);
  const [editOpen, setEditOpen] = useState(false);
  const [isLogging, setIsLogging] = useState(false);

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-2 border-b border-line px-3 py-1 last:border-b-0 sm:flex-row sm:items-center sm:gap-4",
          isLogging && "bg-hover"
        )}
        data-testid="maintenance-task-row"
        data-state={isLogging ? "logging" : "default"}
      >
        <AttentionRow
          status={getMaintenanceStatusTone(task.status)}
          name={getMaintenanceTaskLabel(task, t)}
          figure={nextDueLine || undefined}
          accessibleName={formatTaskAccessibleName(task, t)}
          className="min-w-0 flex-1 border-b-0"
        />

        <div className="flex shrink-0 items-center gap-2">
          <MaintenanceStatusBadge status={task.status} />
          {/* Visible at rest: a control that only appears on hover is unreachable for a keyboard
              user, who never triggers hover. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("maintenance.actions.editInterval")}
            data-testid="edit-interval-button"
            onClick={() => setEditOpen(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="log-service-button"
            onClick={() => setIsLogging(true)}
          >
            {t("maintenance.actions.logService")}
          </Button>
        </div>
      </div>

      {isLogging && (
        <LogServiceForm
          taskId={task.id}
          vehicleId={vehicleId}
          defaultOdometerKm={vehicleOdometerKm}
          onSuccess={() => setIsLogging(false)}
          onCancel={() => setIsLogging(false)}
        />
      )}

      <EditIntervalDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        vehicleId={vehicleId}
      />
    </>
  );
}
