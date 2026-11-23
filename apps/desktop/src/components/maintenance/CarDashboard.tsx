import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CalendarClock,
  Car,
  CircleAlert,
  CircleCheck,
  Clock,
  ListChecks,
  Wrench,
} from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  IconChip,
  Skeleton,
} from "@nixus/shared";
import { CarOnboardingChecklist } from "@/components/maintenance/CarOnboardingChecklist";
import { MaintenanceStatusBadge } from "@/components/maintenance/MaintenanceStatusBadge";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { MetricTile } from "@/components/shared/MetricTile";
import {
  formatNextDueLine,
  formatOdometerKm,
  formatVehicleDisplayName,
  getMaintenanceTaskLabel,
  summarizeMaintenanceFleet,
} from "@/lib/maintenanceUtils";
import type { MaintenanceTaskStatus, VehicleWithTasks } from "@/lib/types";

interface CarDashboardProps {
  vehicles: VehicleWithTasks[] | undefined;
  isLoading: boolean;
  onAddVehicle: () => void;
}

// The chip icon repeats the row's status in a second channel: three identical wrenches down the
// list give the scan nothing, and the badge beside it stays the one that carries the words.
const STATUS_ICON: Record<MaintenanceTaskStatus, typeof Wrench> = {
  overdue: CircleAlert,
  due: Clock,
  upcoming: CalendarClock,
  ok: CircleCheck,
};

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
        <div className="grid grid-cols-1 gap-grid-gap md:grid-cols-3">
          {[
            {
              icon: Wrench,
              label: t("maintenance.dashboard.metricNeedsAttention"),
            },
            { icon: Car, label: t("maintenance.dashboard.metricVehicles") },
            {
              icon: CircleCheck,
              label: t("maintenance.dashboard.metricOnTrack"),
            },
          ].map(({ icon, label }) => (
            <MetricTile key={label} icon={icon} label={label} value="" isLoading />
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
                size="lg"
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

  const scheduledCount = vehicles.reduce(
    (total, { tasks }) => total + tasks.length,
    0
  );
  const fleetOdometerKm = vehicles.reduce(
    (total, { vehicle }) => total + vehicle.odometer_km,
    0
  );
  const odometerCaption =
    summary.vehicleCount === 1
      ? t("maintenance.v2.captionOdometer", {
          km: formatOdometerKm(fleetOdometerKm),
        })
      : t("maintenance.v2.captionOdometerFleet", {
          km: formatOdometerKm(fleetOdometerKm),
        });

  const statusSubtitle =
    summary.needsAttentionCount === 0
      ? t("maintenance.dashboard.allUpToDate")
      : t("maintenance.dashboard.needsAttentionSummary", {
          count: summary.needsAttentionCount,
        });

  const next = summary.topUrgent[0];

  return (
    <div className="flex flex-col gap-grid-gap" data-testid="car-dashboard">
      <CarOnboardingChecklist vehicles={vehicles} />

      {/* The violet tile is the one that answers "does my car need anything" — the question this
          surface exists for, and the only figure allowed to be loudest. */}
      <div
        className="grid grid-cols-1 gap-grid-gap md:grid-cols-3"
        data-testid="car-dashboard-metrics"
      >
        <MetricTile
          featured
          size="hero"
          icon={Wrench}
          label={t("maintenance.dashboard.metricNeedsAttention")}
          value={String(summary.needsAttentionCount)}
          caption={t("maintenance.v2.captionOfScheduled", {
            count: scheduledCount,
          })}
          href="/car/garage"
          linkLabel={`${t("maintenance.dashboard.metricNeedsAttention")}, ${statusSubtitle}`}
        />
        <MetricTile
          icon={Car}
          label={t("maintenance.dashboard.metricVehicles")}
          value={String(summary.vehicleCount)}
          caption={odometerCaption}
          href="/car/garage"
          linkLabel={`${t("maintenance.dashboard.metricVehicles")}, ${summary.vehicleCount}`}
        />
        <MetricTile
          icon={CircleCheck}
          label={t("maintenance.dashboard.metricOnTrack")}
          value={String(summary.onTrackCount)}
          caption={t("maintenance.v2.captionOnTrack")}
          href="/car/garage"
          linkLabel={`${t("maintenance.dashboard.metricOnTrack")}, ${summary.onTrackCount}`}
        />
      </div>

      {summary.needsAttentionCount === 0 ? (
        <InsightCallout
          layout="row"
          icon={CircleCheck}
          eyebrow={t("maintenance.v2.eyebrowAllClear")}
          title={t("maintenance.dashboard.allUpToDate")}
          data-testid="car-dashboard-all-clear"
          actions={
            <Button
              variant="outline"
              render={<Link to="/car/garage" />}
              data-testid="car-dashboard-garage-link"
            >
              {t("maintenance.inbox.goToGarage")}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          }
        >
          {t("maintenance.dashboard.garageHint")}
        </InsightCallout>
      ) : (
        <>
          <InsightCallout
            layout="row"
            icon={Wrench}
            eyebrow={t("maintenance.v2.eyebrowNextService")}
            title={statusSubtitle}
            data-testid="car-dashboard-status"
            actions={
              <Button
                variant="outline"
                render={<Link to="/car/garage" />}
                data-testid="car-dashboard-open-garage"
              >
                {t("maintenance.dashboard.openGarage")}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            }
          >
            {next &&
              t("maintenance.v2.nextServiceLine", {
                task: getMaintenanceTaskLabel(next.task, t),
                vehicle: formatVehicleDisplayName(next.vehicle),
                detail:
                  formatNextDueLine(next.task, t) ||
                  t(`maintenance.status.${next.task.status}`),
              })}
          </InsightCallout>

          <Card flush data-testid="car-dashboard-urgent-list">
            <CardHeader className="border-b border-line pt-card-pad pb-4">
              <CardTitle icon={ListChecks}>
                {t("maintenance.dashboard.urgentHeading")}
              </CardTitle>
              {summary.needsAttentionCount > summary.topUrgent.length && (
                <CardAction>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link to="/car/garage" />}
                    data-testid="car-dashboard-view-all-urgent"
                  >
                    {t("maintenance.dashboard.viewAllInGarage", {
                      count: summary.needsAttentionCount,
                    })}
                  </Button>
                </CardAction>
              )}
            </CardHeader>

            <CardContent className="py-1">
              {summary.topUrgent.map((item) => {
                const vehicleName = formatVehicleDisplayName(item.vehicle);
                const taskName = getMaintenanceTaskLabel(item.task, t);
                const urgencyLine = formatNextDueLine(item.task, t);

                return (
                  <div
                    key={`${item.vehicle.id}-${item.task.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line py-3.5 last:border-b-0"
                    data-testid={`car-dashboard-urgent-row-${item.task.id}`}
                  >
                    {/* One sentence for assistive tech; every visual fragment below is hidden so
                        the row is not announced as four disconnected pieces. */}
                    <span className="sr-only">
                      {t("maintenance.a11y.urgentRow", {
                        vehicle: vehicleName,
                        task: taskName,
                        detail:
                          urgencyLine || t(`maintenance.status.${item.task.status}`),
                      })}
                    </span>
                    <IconChip icon={STATUS_ICON[item.task.status]} size="sm" />
                    <div className="min-w-0 flex-1" aria-hidden="true">
                      <p className="truncate text-label text-ink">{taskName}</p>
                      <p className="truncate text-caption text-ink-dim">
                        {vehicleName}
                      </p>
                    </div>
                    {urgencyLine && (
                      <span
                        aria-hidden="true"
                        className="money shrink-0 text-caption font-semibold text-ink"
                      >
                        {urgencyLine}
                      </span>
                    )}
                    <span aria-hidden="true" className="shrink-0">
                      <MaintenanceStatusBadge status={item.task.status} />
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      render={
                        <Link
                          to="/car/garage"
                          search={{ vehicle: item.vehicle.id }}
                        />
                      }
                      data-testid={`car-dashboard-view-car-${item.vehicle.id}`}
                    >
                      {t("maintenance.dashboard.manageInGarage")}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
