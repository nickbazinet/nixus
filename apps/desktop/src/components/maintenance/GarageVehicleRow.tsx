import { useTranslation } from "react-i18next";
import { Car } from "lucide-react";
import { Card, IconChip } from "@nixus/shared";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import { OdometerUpdateForm } from "@/components/maintenance/OdometerUpdateForm";
import {
  formatNextDueLine,
  formatVehicleDisplayName,
  formatVehicleSubtitle,
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
  const subtitle = formatVehicleSubtitle(vehicle);
  const worstStatus = getWorstStatus(tasks);
  const urgentTask = getMostUrgentNonOkTask(tasks);

  return (
    <Card
      size="sm"
      interactive
      // Brand carries selection because brand means action; it never means "on track" here — the
      // vehicle's own state is the status badge.
      className={cn(
        "gap-0 px-4 transition-colors",
        selected
          ? "border-brand bg-brand-soft hover:bg-brand-soft"
          : "hover:border-line-strong"
      )}
      render={
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(vehicle.id)}
        />
      }
      data-testid={`garage-vehicle-row-${vehicle.id}`}
      data-selected={selected ? "true" : "false"}
    >
      <div className="flex flex-col gap-3 text-left">
        <div className="flex items-start gap-3">
          <IconChip icon={Car} size="sm" tone={selected ? "card" : "soft"} />
          <h3 className="min-w-0 flex-1 font-display text-h3 text-ink">
            {displayName}
          </h3>
        </div>

        {subtitle && (
          <p className="truncate text-caption text-ink-dim">{subtitle}</p>
        )}

        {/* No stopPropagation here: the odometer control stops its own events, and swallowing them
            for the whole band made the middle of the card a dead zone that never selected. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <OdometerUpdateForm
            vehicleId={vehicle.id}
            odometerKm={vehicle.odometer_km}
          />
          <MaintenanceStatusBadge status={worstStatus} />
        </div>

        {urgentTask ? (
          <p className="truncate text-caption text-ink-dim">
            {getMaintenanceTaskLabel(urgentTask, t)}
            {" · "}
            <span className="money">{formatNextDueLine(urgentTask, t)}</span>
          </p>
        ) : (
          <p className="text-caption text-ink-dim">
            {t("maintenance.garage.allOnTrack")}
          </p>
        )}
      </div>
    </Card>
  );
}
