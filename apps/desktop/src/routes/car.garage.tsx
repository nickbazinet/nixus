import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, CardContent, SlideOver } from "@nixus/shared";
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
          className="grid gap-6 lg:grid-cols-[minmax(240px,300px)_1fr]"
          data-testid="garage-skeleton"
        >
          <Card className="shadow-sm rounded-lg">
            <CardContent className="p-4 space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
              ))}
            </CardContent>
          </Card>
          <Card className="shadow-sm rounded-lg min-h-[320px]">
            <CardContent className="p-4">
              <div className="h-6 w-48 bg-muted animate-pulse rounded mb-4" />
              <div className="h-40 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        </div>
      )}

      {!isLoading && vehicles && vehicles.length === 0 && (
        <Card className="shadow-sm rounded-lg" data-testid="maintenance-empty-state">
          <CardContent className="p-8 text-center">
            <p className="font-medium text-foreground mb-1">
              {t("maintenance.emptyTitle")}
            </p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {t("maintenance.emptyHelper")}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && vehicles && vehicles.length > 0 && (
        <div
          className="grid gap-6 lg:grid-cols-[minmax(240px,300px)_1fr] lg:items-start"
          data-testid="garage-layout"
        >
          <div className="space-y-2" data-testid="garage-vehicle-list">
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
                className="shadow-sm rounded-lg min-h-[280px]"
                data-testid="garage-detail-placeholder"
              >
                <CardContent className="flex min-h-[280px] items-center justify-center p-8 text-center">
                  <p className="text-sm text-muted-foreground">
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
        data-testid="vehicle-slide-over"
      >
        <AddVehicleForm onClose={() => setShowForm(false)} />
      </SlideOver>
    </div>
  );
}
