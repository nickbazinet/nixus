import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Car } from "lucide-react";
import { Button, Card, CardContent, buttonVariants } from "@nixus/shared";
import { DashboardMetricCard } from "@/components/dashboard/DashboardMetricCard";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import {
  formatNextDueLine,
  formatVehicleDisplayName,
  getFleetStatusRingClass,
  getMaintenanceTaskLabel,
  summarizeMaintenanceFleet,
} from "@/lib/maintenanceUtils";
import type { VehicleWithTasks } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CarDashboardProps {
  vehicles: VehicleWithTasks[] | undefined;
  isLoading: boolean;
  onAddVehicle: () => void;
}

export function CarDashboard({
  vehicles,
  isLoading,
  onAddVehicle,
}: CarDashboardProps) {
  const { t } = useTranslation();

  const summary = useMemo(
    () => (vehicles ? summarizeMaintenanceFleet(vehicles, t) : null),
    [vehicles, t]
  );

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="car-dashboard-skeleton">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <DashboardMetricCard
              key={i}
              title=""
              value=""
              variant="secondary"
              isLoading
            />
          ))}
        </div>
        <Card className="shadow-sm rounded-lg">
          <CardContent className="p-8">
            <div className="h-6 w-48 bg-muted animate-pulse rounded mb-3" />
            <div className="h-4 w-64 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!vehicles || vehicles.length === 0) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="maintenance-empty-state">
        <CardContent className="p-8 text-center">
          <Car
            className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3"
            aria-hidden="true"
          />
          <p className="font-medium text-foreground mb-1">
            {t("maintenance.emptyTitle")}
          </p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {t("maintenance.emptyHelper")}
          </p>
          <Button size="sm" onClick={onAddVehicle}>
            {t("maintenance.addVehicle")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  const statusRing = getFleetStatusRingClass(summary.worstStatus);
  const statusSubtitle =
    summary.needsAttentionCount === 0
      ? t("maintenance.dashboard.allUpToDate")
      : t("maintenance.dashboard.needsAttentionSummary", {
          count: summary.needsAttentionCount,
        });

  return (
    <div className="space-y-4" data-testid="car-dashboard">
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        data-testid="car-dashboard-metrics"
      >
        <DashboardMetricCard
          title={t("maintenance.dashboard.metricVehicles")}
          value={String(summary.vehicleCount)}
          variant="secondary"
          href="/car/garage"
        />
        <DashboardMetricCard
          title={t("maintenance.dashboard.metricNeedsAttention")}
          value={String(summary.needsAttentionCount)}
          variant="secondary"
          href="/car/garage"
        />
        <DashboardMetricCard
          title={t("maintenance.dashboard.metricOnTrack")}
          value={String(summary.onTrackCount)}
          variant="secondary"
          href="/car/garage"
        />
      </div>

      <Card
        className={cn("shadow-sm rounded-lg", statusRing)}
        data-testid="car-dashboard-status"
      >
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {t("maintenance.dashboard.fleetStatus")}
              </p>
              <p
                className={cn(
                  "text-lg font-medium",
                  summary.needsAttentionCount > 0 &&
                    (summary.worstStatus === "overdue" ||
                      summary.worstStatus === "due")
                    ? "text-rose-600"
                    : summary.needsAttentionCount > 0
                      ? "text-amber-600"
                      : "text-foreground"
                )}
              >
                {statusSubtitle}
              </p>
            </div>
            <Link
              to="/car/garage"
              className={buttonVariants({ variant: "outline", size: "sm" })}
              data-testid="car-dashboard-open-garage"
            >
              {t("maintenance.dashboard.openGarage")}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </div>
        </CardContent>
      </Card>

      {summary.needsAttentionCount === 0 ? (
        <Card
          className="shadow-sm rounded-lg"
          data-testid="car-dashboard-all-clear"
        >
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("maintenance.dashboard.garageHint")}
            </p>
            <Link
              to="/car/garage"
              className="mt-2 inline-block text-sm text-primary hover:underline"
              data-testid="car-dashboard-garage-link"
            >
              {t("maintenance.inbox.goToGarage")}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="car-dashboard-urgent-list">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">
              {t("maintenance.dashboard.urgentHeading")}
            </h2>
            {summary.needsAttentionCount > summary.topUrgent.length && (
              <Link
                to="/car/garage"
                className="text-xs text-primary hover:underline"
                data-testid="car-dashboard-view-all-urgent"
              >
                {t("maintenance.dashboard.viewAllInGarage", {
                  count: summary.needsAttentionCount,
                })}
              </Link>
            )}
          </div>

          {summary.topUrgent.map((item) => {
            const vehicleName = formatVehicleDisplayName(item.vehicle);
            const taskName = getMaintenanceTaskLabel(item.task, t);
            const urgencyLine = formatNextDueLine(item.task, t);

            return (
              <div
                key={`${item.vehicle.id}-${item.task.id}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                data-testid={`car-dashboard-urgent-row-${item.task.id}`}
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
                  <MaintenanceStatusBadge status={item.task.status} />
                  <Link
                    to="/car/garage"
                    search={{ vehicle: item.vehicle.id }}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    data-testid={`car-dashboard-view-car-${item.vehicle.id}`}
                  >
                    {t("maintenance.dashboard.manageInGarage")}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
