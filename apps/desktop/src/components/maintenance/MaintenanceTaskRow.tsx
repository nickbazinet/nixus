import { useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@nixus/shared";
import { EditIntervalDialog } from "@/components/maintenance/EditIntervalDialog";
import { LogServiceForm } from "@/components/maintenance/LogServiceForm";
import { formatNextDueLine, getMaintenanceTaskLabel } from "@/lib/maintenanceUtils";
import type { MaintenanceTaskWithStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MaintenanceTaskRowProps {
  task: MaintenanceTaskWithStatus;
  vehicleId: number;
  vehicleOdometerKm: number;
}

function getStatusBadge(status: MaintenanceTaskWithStatus["status"], t: (key: string) => string) {
  switch (status) {
    case "ok":
      return {
        label: t("maintenance.status.ok"),
        className: "bg-slate-500/10 text-slate-600 border-transparent",
      };
    case "upcoming":
      return {
        label: t("maintenance.status.upcoming"),
        className: "bg-amber-500/10 text-amber-600 border-transparent",
      };
    case "due":
      return {
        label: t("maintenance.status.due"),
        className: "border-amber-500/50 text-amber-600 bg-transparent",
      };
    case "overdue":
      return {
        label: t("maintenance.status.overdue"),
        className: "bg-rose-500/10 text-rose-600 border-transparent",
      };
  }
}

export function MaintenanceTaskRow({
  task,
  vehicleId,
  vehicleOdometerKm,
}: MaintenanceTaskRowProps) {
  const { t } = useTranslation();
  const badge = getStatusBadge(task.status, t);
  const nextDueLine = formatNextDueLine(task, t);
  const [editOpen, setEditOpen] = useState(false);
  const [isLogging, setIsLogging] = useState(false);

  return (
    <>
      <div
        className={cn(
          "group flex flex-col gap-2 py-2.5 px-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 border-b border-border last:border-b-0",
          isLogging && "bg-muted/30"
        )}
        data-testid="maintenance-task-row"
        data-state={isLogging ? "logging" : "default"}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {getMaintenanceTaskLabel(task, t)}
          </p>
          <p className="mt-0.5 text-xs font-mono text-muted-foreground">
            {nextDueLine}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={t("maintenance.actions.editInterval")}
            data-testid="edit-interval-button"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="size-4" />
          </Button>
          <Badge
            className={badge.className}
            data-testid={`maintenance-task-status-${task.status}`}
          >
            {badge.label}
          </Badge>
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
