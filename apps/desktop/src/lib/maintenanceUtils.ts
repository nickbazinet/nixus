import { format, parseISO } from "date-fns";
import type { TFunction } from "i18next";
import type {
  MaintenanceTaskStatus,
  MaintenanceTaskWithStatus,
  MaintenanceServiceLogEntry,
  Vehicle,
  VehicleWithTasks,
} from "@/lib/types";

export interface MaintenanceInboxItem {
  vehicle: Vehicle;
  task: MaintenanceTaskWithStatus;
}

/** Display label from year, make, and model; falls back to stored nickname or "Vehicle". */
export function formatVehicleDisplayName(vehicle: Pick<
  Vehicle,
  "nickname" | "make" | "model" | "year"
>): string {
  const parts: string[] = [];
  if (vehicle.year != null) parts.push(String(vehicle.year));
  if (vehicle.make?.trim()) parts.push(vehicle.make.trim());
  if (vehicle.model?.trim()) parts.push(vehicle.model.trim());
  if (parts.length > 0) return parts.join(" ");
  const legacy = vehicle.nickname.trim();
  return legacy || "Vehicle";
}

export function formatOdometerKm(km: number): string {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export function getStatusSortOrder(status: MaintenanceTaskStatus): number {
  switch (status) {
    case "overdue":
      return 0;
    case "due":
      return 1;
    case "upcoming":
      return 2;
    case "ok":
      return 3;
  }
}

export function getMaintenanceTaskLabel(
  task: Pick<MaintenanceTaskWithStatus, "task_type_key" | "custom_task_name">,
  t: TFunction
): string {
  const customName = task.custom_task_name?.trim();
  if (customName) return customName;
  return t(`maintenance.tasks.${task.task_type_key}`);
}

export function sortMaintenanceTasks(
  tasks: MaintenanceTaskWithStatus[],
  t: TFunction
): MaintenanceTaskWithStatus[] {
  return [...tasks].sort((a, b) => {
    const statusDiff =
      getStatusSortOrder(a.status) - getStatusSortOrder(b.status);
    if (statusDiff !== 0) return statusDiff;

    return getMaintenanceTaskLabel(a, t).localeCompare(
      getMaintenanceTaskLabel(b, t)
    );
  });
}

export type UrgencyDisplayKind = "km" | "days" | "never-serviced" | "none";

export interface UrgencyDisplay {
  kind: UrgencyDisplayKind;
  kmRemaining?: number;
  daysRemaining?: number;
}

export function pickUrgencyDisplay(
  task: MaintenanceTaskWithStatus
): UrgencyDisplay {
  const { km_remaining, days_remaining, last_service_date } = task;

  if (last_service_date === null) {
    if (km_remaining !== null && days_remaining !== null) {
      if (days_remaining <= km_remaining) {
        return { kind: "never-serviced", daysRemaining: days_remaining };
      }
      return { kind: "never-serviced", kmRemaining: km_remaining };
    }
    if (km_remaining !== null) {
      return { kind: "never-serviced", kmRemaining: km_remaining };
    }
    if (days_remaining !== null) {
      return { kind: "never-serviced", daysRemaining: days_remaining };
    }
    return { kind: "never-serviced" };
  }

  if (km_remaining !== null && days_remaining !== null) {
    if (days_remaining <= km_remaining) {
      return { kind: "days", daysRemaining: days_remaining };
    }
    return { kind: "km", kmRemaining: km_remaining };
  }
  if (km_remaining !== null) {
    return { kind: "km", kmRemaining: km_remaining };
  }
  if (days_remaining !== null) {
    return { kind: "days", daysRemaining: days_remaining };
  }
  return { kind: "none" };
}

function formatKmLine(
  km: number,
  status: MaintenanceTaskStatus,
  t: TFunction
): string {
  if (status === "overdue" || km < 0) {
    return t("maintenance.nextDue.kmOverdue", { count: Math.abs(km) });
  }
  if (status === "due" || km === 0) {
    return t("maintenance.nextDue.dueNow");
  }
  return t("maintenance.nextDue.kmRemaining", { count: km });
}

function formatDaysLine(
  days: number,
  nextDueDate: string | null,
  status: MaintenanceTaskStatus,
  t: TFunction
): string {
  if (status === "overdue" || days < 0) {
    const overdueDays = Math.abs(days);
    if (overdueDays <= 14) {
      return t("maintenance.nextDue.daysOverdue", { count: overdueDays });
    }
    if (nextDueDate) {
      return t("maintenance.nextDue.dueOnDate", {
        date: format(parseISO(nextDueDate), "MMM d, yyyy"),
      });
    }
    return t("maintenance.nextDue.daysOverdue", { count: overdueDays });
  }
  if (status === "due" || days === 0) {
    return t("maintenance.nextDue.dueToday");
  }
  if (days <= 14) {
    return t("maintenance.nextDue.daysRemaining", { count: days });
  }
  if (nextDueDate) {
    return t("maintenance.nextDue.dueOnDate", {
      date: format(parseISO(nextDueDate), "MMM d, yyyy"),
    });
  }
  return t("maintenance.nextDue.daysRemaining", { count: days });
}

export function formatNextDueLine(
  task: MaintenanceTaskWithStatus,
  t: TFunction
): string {
  const urgency = pickUrgencyDisplay(task);

  if (urgency.kind === "never-serviced") {
    const base = t("maintenance.nextDue.notYetServiced");
    if (urgency.kmRemaining !== undefined) {
      return `${base} · ${formatKmLine(urgency.kmRemaining, task.status, t)}`;
    }
    if (urgency.daysRemaining !== undefined) {
      return `${base} · ${formatDaysLine(
        urgency.daysRemaining,
        task.next_due_date,
        task.status,
        t
      )}`;
    }
    return base;
  }

  if (urgency.kind === "km" && urgency.kmRemaining !== undefined) {
    return formatKmLine(urgency.kmRemaining, task.status, t);
  }

  if (urgency.kind === "days" && urgency.daysRemaining !== undefined) {
    return formatDaysLine(
      urgency.daysRemaining,
      task.next_due_date,
      task.status,
      t
    );
  }

  return "";
}

export function flattenInboxItems(
  vehicles: VehicleWithTasks[],
  t: TFunction
): MaintenanceInboxItem[] {
  const items: MaintenanceInboxItem[] = [];
  for (const { vehicle, tasks } of vehicles) {
    for (const task of tasks) {
      if (task.status !== "ok") {
        items.push({ vehicle, task });
      }
    }
  }
  return items.sort((a, b) => {
    const statusDiff =
      getStatusSortOrder(a.task.status) - getStatusSortOrder(b.task.status);
    if (statusDiff !== 0) return statusDiff;

    const vehicleDiff = formatVehicleDisplayName(a.vehicle).localeCompare(
      formatVehicleDisplayName(b.vehicle)
    );
    if (vehicleDiff !== 0) return vehicleDiff;

    const nameA = t(`maintenance.tasks.${a.task.task_type_key}`);
    const nameB = t(`maintenance.tasks.${b.task.task_type_key}`);
    return nameA.localeCompare(nameB);
  });
}

export function countOnTrackTasks(vehicles: VehicleWithTasks[]): number {
  return vehicles.reduce(
    (sum, { tasks }) => sum + tasks.filter((task) => task.status === "ok").length,
    0
  );
}

export interface MaintenanceFleetSummary {
  vehicleCount: number;
  needsAttentionCount: number;
  onTrackCount: number;
  worstStatus: MaintenanceTaskStatus;
  topUrgent: MaintenanceInboxItem[];
}

export function summarizeMaintenanceFleet(
  vehicles: VehicleWithTasks[],
  t: TFunction,
  urgentLimit = 3
): MaintenanceFleetSummary {
  const vehicleCount = vehicles.length;
  const urgentItems = flattenInboxItems(vehicles, t);
  let worst: MaintenanceTaskStatus = "ok";
  for (const { tasks } of vehicles) {
    const vehicleWorst = getWorstStatus(tasks);
    if (getStatusSortOrder(vehicleWorst) < getStatusSortOrder(worst)) {
      worst = vehicleWorst;
    }
  }

  return {
    vehicleCount,
    needsAttentionCount: urgentItems.length,
    onTrackCount: countOnTrackTasks(vehicles),
    worstStatus: urgentItems.length > 0 ? worst : "ok",
    topUrgent: urgentItems.slice(0, urgentLimit),
  };
}

export function getFleetStatusRingClass(
  status: MaintenanceTaskStatus
): string | undefined {
  switch (status) {
    case "upcoming":
      return "ring-1 ring-amber-500/30";
    case "due":
      return "ring-1 ring-rose-500/40";
    case "overdue":
      return "ring-1 ring-rose-500/60";
    case "ok":
      return undefined;
  }
}

export function getWorstStatus(
  tasks: MaintenanceTaskWithStatus[]
): MaintenanceTaskStatus {
  let worst: MaintenanceTaskStatus = "ok";
  for (const task of tasks) {
    if (getStatusSortOrder(task.status) < getStatusSortOrder(worst)) {
      worst = task.status;
    }
  }
  return worst;
}

export function getMostUrgentNonOkTask(
  tasks: MaintenanceTaskWithStatus[]
): MaintenanceTaskWithStatus | null {
  const alerts = tasks.filter((task) => task.status !== "ok");
  if (alerts.length === 0) return null;
  return [...alerts].sort(
    (a, b) => getStatusSortOrder(a.status) - getStatusSortOrder(b.status)
  )[0];
}

export function formatVehicleMakeModel(
  vehicle: Pick<Vehicle, "make" | "model">
): string | null {
  const parts: string[] = [];
  if (vehicle.make?.trim()) parts.push(vehicle.make.trim());
  if (vehicle.model?.trim()) parts.push(vehicle.model.trim());
  return parts.length > 0 ? parts.join(" ") : null;
}

export function formatServiceEntryLabel(
  entry: MaintenanceServiceLogEntry,
  t: TFunction
): string {
  if (entry.custom_service_name?.trim()) {
    return entry.custom_service_name.trim();
  }
  if (entry.task_type_key) {
    return t(`maintenance.tasks.${entry.task_type_key}`);
  }
  return "—";
}
