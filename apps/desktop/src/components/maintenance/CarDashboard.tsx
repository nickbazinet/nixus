import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Car } from "lucide-react";
import {
  AttentionRow,
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  Stat,
  SubStat,
  buttonVariants,
  focusRing,
} from "@nixus/shared";
import { CarOnboardingChecklist } from "@/components/maintenance/CarOnboardingChecklist";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import {
  formatNextDueLine,
  formatVehicleDisplayName,
  getMaintenanceStatusAccentClass,
  getMaintenanceStatusTone,
  getMaintenanceTaskLabel,
  summarizeMaintenanceFleet,
} from "@/lib/maintenanceUtils";
import type { MaintenanceTaskStatus, VehicleWithTasks } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CarDashboardProps {
  vehicles: VehicleWithTasks[] | undefined;
  isLoading: boolean;
  onAddVehicle: () => void;
}

const STATUS_INK: Record<MaintenanceTaskStatus, string> = {
  overdue: "text-over-ink",
  due: "text-caution-ink",
  upcoming: "text-caution-ink",
  ok: "text-ink",
};

function MetricCard({
  title,
  value,
  hero = false,
}: {
  title: string;
  value: string;
  hero?: boolean;
}) {
  const Figure = hero ? Stat : SubStat;

  return (
    <Card interactive render={<Link to="/car/garage" />}>
      <CardContent>
        <Figure label={title} value={value} />
      </CardContent>
    </Card>
  );
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
      <div
        className="flex flex-col gap-grid-gap"
        data-testid="car-dashboard-skeleton"
      >
        <div className="grid grid-cols-1 gap-grid-gap sm:grid-cols-3">
          {[
            t("maintenance.dashboard.metricNeedsAttention"),
            t("maintenance.dashboard.metricVehicles"),
            t("maintenance.dashboard.metricOnTrack"),
          ].map((label) => (
            <Card key={label}>
              <CardContent className="flex flex-col gap-2">
                <span className="text-caption text-ink-dim">{label}</span>
                <Skeleton rows={1} className="max-w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent>
            <Skeleton rows={2} className="max-w-sm" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!vehicles || vehicles.length === 0) {
    return (
      <Card data-testid="maintenance-empty-state">
        <CardContent data-testid="car-onboarding-hero">
          <EmptyState
            icon={<Car />}
            title={t("maintenance.onboarding.heroTitle")}
            description={t("maintenance.onboarding.heroSubtitle")}
            action={
              <Button
                onClick={onAddVehicle}
                data-testid="car-onboarding-hero-cta"
              >
                {t("maintenance.onboarding.heroCta")}
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  const statusSubtitle =
    summary.needsAttentionCount === 0
      ? t("maintenance.dashboard.allUpToDate")
      : t("maintenance.dashboard.needsAttentionSummary", {
          count: summary.needsAttentionCount,
        });

  return (
    <div className="flex flex-col gap-grid-gap" data-testid="car-dashboard">
      <CarOnboardingChecklist vehicles={vehicles} />

      <div
        className="grid grid-cols-1 gap-grid-gap sm:grid-cols-3"
        data-testid="car-dashboard-metrics"
      >
        {/* The one text-display figure on this surface: "does my car need anything" is the question
            the page exists to answer, so it is the only figure allowed to be loudest. */}
        <MetricCard
          hero
          title={t("maintenance.dashboard.metricNeedsAttention")}
          value={String(summary.needsAttentionCount)}
        />
        <MetricCard
          title={t("maintenance.dashboard.metricVehicles")}
          value={String(summary.vehicleCount)}
        />
        <MetricCard
          title={t("maintenance.dashboard.metricOnTrack")}
          value={String(summary.onTrackCount)}
        />
      </div>

      <Card
        className={getMaintenanceStatusAccentClass(summary.worstStatus)}
        data-testid="car-dashboard-status"
      >
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-caption text-ink-dim">
              {summary.vehicleCount === 1
                ? t("maintenance.dashboard.yourCar")
                : t("maintenance.dashboard.yourCars")}
            </p>
            <p className={cn("mt-1 text-h2", STATUS_INK[summary.worstStatus])}>
              {statusSubtitle}
            </p>
          </div>
          <Link
            to="/car/garage"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="car-dashboard-open-garage"
          >
            {t("maintenance.dashboard.openGarage")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>

      {summary.needsAttentionCount === 0 ? (
        <Card data-testid="car-dashboard-all-clear">
          <CardContent className="text-center">
            <p className="text-caption text-ink-dim">
              {t("maintenance.dashboard.garageHint")}
            </p>
            <Link
              to="/car/garage"
              className={cn(
                "mt-2 inline-block text-caption text-brand-ink underline-offset-4 hover:underline",
                focusRing
              )}
              data-testid="car-dashboard-garage-link"
            >
              {t("maintenance.inbox.goToGarage")}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div
          className="flex flex-col gap-2"
          data-testid="car-dashboard-urgent-list"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-h3 text-ink">
              {t("maintenance.dashboard.urgentHeading")}
            </h2>
            {summary.needsAttentionCount > summary.topUrgent.length && (
              <Link
                to="/car/garage"
                className={cn(
                  "text-caption text-brand-ink underline-offset-4 hover:underline",
                  focusRing
                )}
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
              <Card
                key={`${item.vehicle.id}-${item.task.id}`}
                size="sm"
                data-testid={`car-dashboard-urgent-row-${item.task.id}`}
              >
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <AttentionRow
                    status={getMaintenanceStatusTone(item.task.status)}
                    name={`${vehicleName} · ${taskName}`}
                    figure={urgencyLine || undefined}
                    badge={<MaintenanceStatusBadge status={item.task.status} />}
                    accessibleName={t("maintenance.a11y.urgentRow", {
                      vehicle: vehicleName,
                      task: taskName,
                      detail:
                        urgencyLine ||
                        t(`maintenance.status.${item.task.status}`),
                    })}
                    className="min-w-0 flex-1 border-b-0"
                  />
                  <Link
                    to="/car/garage"
                    search={{ vehicle: item.vehicle.id }}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "shrink-0"
                    )}
                    data-testid={`car-dashboard-view-car-${item.vehicle.id}`}
                  >
                    {t("maintenance.dashboard.manageInGarage")}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
