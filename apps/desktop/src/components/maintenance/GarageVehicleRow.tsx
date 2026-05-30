import { useTranslation } from "react-i18next";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import { OdometerUpdateForm } from "@/components/maintenance/OdometerUpdateForm";
import {
  formatNextDueLine,
  formatVehicleDisplayName,
  formatVehicleMakeModel,
  getMaintenanceTaskLabel,
  getMostUrgentNonOkTask,
  getWorstStatus,
} from "@/lib/maintenanceUtils";
import type { VehicleWithTasks } from "@/lib/types";
import { cn } from "@/lib/utils";

interface GarageVehicleRowProps {
  vehicleWithTasks: VehicleWithTasks;
  selected: boolean;
  onSelect: (vehicleId: number) => void;
}

export function GarageVehicleRow({
  vehicleWithTasks,
  selected,
  onSelect,
}: GarageVehicleRowProps) {
  const { t } = useTranslation();
  const { vehicle, tasks } = vehicleWithTasks;
  const displayName = formatVehicleDisplayName(vehicle);
  const makeModel = formatVehicleMakeModel(vehicle);
  const worstStatus = getWorstStatus(tasks);
  const urgentTask = getMostUrgentNonOkTask(tasks);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-muted/30",
        selected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border"
      )}
      data-testid={`garage-vehicle-row-${vehicle.id}`}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      onClick={() => onSelect(vehicle.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {displayName}
          </h3>
          {makeModel && (
            <p className="text-xs text-muted-foreground truncate">{makeModel}</p>
          )}
        </div>
        <MaintenanceStatusBadge status={worstStatus} />
      </div>

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <OdometerUpdateForm
          vehicleId={vehicle.id}
          odometerKm={vehicle.odometer_km}
        />
      </div>

      {urgentTask ? (
        <p className="text-xs text-muted-foreground truncate">
          {getMaintenanceTaskLabel(urgentTask, t)}
          {" · "}
          <span className="font-mono">{formatNextDueLine(urgentTask, t)}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("maintenance.garage.allOnTrack")}
        </p>
      )}
    </button>
  );
}
