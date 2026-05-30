import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@nixus/shared";
import { LogServiceForm } from "@/components/maintenance/LogServiceForm";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import {
  formatNextDueLine,
  formatVehicleDisplayName,
  getMaintenanceTaskLabel,
} from "@/lib/maintenanceUtils";
import type { MaintenanceInboxItem } from "@/lib/maintenanceUtils";
import { cn } from "@/lib/utils";

interface MaintenanceInboxRowProps {
  item: MaintenanceInboxItem;
}

export function MaintenanceInboxRow({ item }: MaintenanceInboxRowProps) {
  const { t } = useTranslation();
  const { vehicle, task } = item;
  const [isLogging, setIsLogging] = useState(false);
  const vehicleName = formatVehicleDisplayName(vehicle);
  const taskName = getMaintenanceTaskLabel(task, t);
  const urgencyLine = formatNextDueLine(task, t);

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between",
          isLogging && "bg-muted/30"
        )}
        data-testid={`maintenance-inbox-row-${task.id}`}
        data-state={isLogging ? "logging" : "default"}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {vehicleName} · {taskName}
          </p>
          {urgencyLine && (
            <p className="mt-0.5 text-xs font-mono text-muted-foreground">
              {urgencyLine}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <MaintenanceStatusBadge status={task.status} />
          <Button
            variant="outline"
            size="sm"
            data-testid={`inbox-log-service-${task.id}`}
            onClick={() => setIsLogging(true)}
          >
            {t("maintenance.actions.logService")}
          </Button>
          <Link
            to="/car/garage"
            search={{ vehicle: vehicle.id }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            data-testid={`view-car-button-${vehicle.id}`}
          >
            {t("maintenance.inbox.viewCar")}
          </Link>
        </div>
      </div>

      {isLogging && (
        <LogServiceForm
          taskId={task.id}
          vehicleId={vehicle.id}
          defaultOdometerKm={vehicle.odometer_km}
          onSuccess={() => setIsLogging(false)}
          onCancel={() => setIsLogging(false)}
        />
      )}
    </>
  );
}
