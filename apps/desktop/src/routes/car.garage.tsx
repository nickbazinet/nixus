import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Car } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  SlideOver,
} from "@nixus/shared";
import { AddVehicleForm } from "@/components/maintenance/AddVehicleForm";
import { CarMaintenanceHeader } from "@/components/maintenance/CarMaintenanceHeader";
import { GarageVehicleRow } from "@/components/maintenance/GarageVehicleRow";
import { VehicleDetailPanel } from "@/components/maintenance/VehicleDetailPanel";
import { useMaintenance } from "@/hooks/useMaintenance";

type GarageSearch = {
  vehicle?: number;
};

export const Route = createFileRoute("/car/garage")({
  validateSearch: (search: Record<string, unknown>): GarageSearch => {
    const raw = search.vehicle;
    if (raw === undefined || raw === null || raw === "") {
      return {};
    }
    const vehicle = Number(raw);
    return Number.isFinite(vehicle) ? { vehicle } : {};
  },
  component: GaragePage,
});

function GaragePage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: vehicles, isLoading } = useMaintenance();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const selectedVehicleId = useMemo(() => {
    if (!vehicles?.length) return null;
    const fromSearch = search.vehicle;
    if (
      fromSearch !== undefined &&
      vehicles.some((item) => item.vehicle.id === fromSearch)
    ) {
      return fromSearch;
    }
    return vehicles[0].vehicle.id;
  }, [vehicles, search.vehicle]);

  const selectedVehicle = useMemo(
    () =>
      vehicles?.find((item) => item.vehicle.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId]
  );

  useEffect(() => {
    if (!vehicles?.length || selectedVehicleId === null) return;
    if (search.vehicle === selectedVehicleId) return;
    navigate({
      search: { vehicle: selectedVehicleId },
      replace: true,
    });
  }, [vehicles, selectedVehicleId, search.vehicle, navigate]);

  const selectVehicle = (vehicleId: number) => {
    navigate({ search: { vehicle: vehicleId } });
  };

  const clearVehicleSearch = () => {
    navigate({ search: {} });
  };

  return (
    <div>
      <CarMaintenanceHeader
        titleKey="nav.maintenanceGarage"
        vehicleCount={vehicles?.length}
        isLoading={isLoading}
        onAddVehicle={() => setShowForm(true)}
      />

      {isLoading && (
        <div
          className="grid gap-section-gap lg:grid-cols-[minmax(240px,300px)_1fr]"
          data-testid="garage-skeleton"
        >
          {/* One vehicle card's worth of lines. A first fetch cannot know how many cars are in the
              garage, and guessing high is what makes the list jump when the data lands. */}
          <Card size="sm">
            <CardContent>
              <Skeleton rows={3} />
            </CardContent>
          </Card>
          <Card className="min-h-[320px]">
            <CardContent className="flex flex-col gap-4">
              <Skeleton rows={1} className="max-w-48" />
              <Skeleton rows={4} />
            </CardContent>
          </Card>
        </div>
      )}

      {!isLoading && vehicles && vehicles.length === 0 && (
        <Card data-testid="maintenance-empty-state">
          <CardContent>
            <EmptyState
              icon={<Car />}
              title={t("maintenance.emptyTitle")}
              description={t("maintenance.emptyHelper")}
              action={
                <Button onClick={() => setShowForm(true)}>
                  {t("maintenance.onboarding.heroCta")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && vehicles && vehicles.length > 0 && (
        <div
          className="grid gap-section-gap lg:grid-cols-[minmax(240px,300px)_1fr] lg:items-start"
          data-testid="garage-layout"
        >
          <div className="flex flex-col gap-2" data-testid="garage-vehicle-list">
            {vehicles.map((vehicleWithTasks) => (
              <GarageVehicleRow
                key={vehicleWithTasks.vehicle.id}
                vehicleWithTasks={vehicleWithTasks}
                selected={vehicleWithTasks.vehicle.id === selectedVehicleId}
                onSelect={selectVehicle}
              />
            ))}
          </div>

          <div className="min-w-0">
            {selectedVehicle ? (
              <VehicleDetailPanel
                vehicleWithTasks={selectedVehicle}
                onVehicleDeleted={clearVehicleSearch}
              />
            ) : (
              <Card
                className="min-h-[280px]"
                data-testid="garage-detail-placeholder"
              >
                <CardContent className="flex min-h-[248px] items-center justify-center">
                  <p className="text-caption text-ink-dim">
                    {t("maintenance.garage.selectVehicle")}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <SlideOver
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("maintenance.addVehicle")}
        description={t("maintenance.addVehicleDescription")}
        data-testid="vehicle-slide-over"
      >
        <AddVehicleForm onClose={() => setShowForm(false)} />
      </SlideOver>
    </div>
  );
}
