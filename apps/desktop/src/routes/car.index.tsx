import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import { SlideOver } from "@nixus/shared";
import { AddVehicleForm } from "@/components/maintenance/AddVehicleForm";
import { CarDashboard } from "@/components/maintenance/CarDashboard";
import { CarMaintenanceHeader } from "@/components/maintenance/CarMaintenanceHeader";
import { useMaintenance } from "@/hooks/useMaintenance";

export const Route = createFileRoute("/car/")({
  component: CarDashboardPage,
});

function CarDashboardPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: vehicles, isLoading } = useMaintenance();

  return (
    <div>
      <CarMaintenanceHeader
        titleKey="nav.carDashboard"
        vehicleCount={vehicles?.length}
        isLoading={isLoading}
        onAddVehicle={() => setShowForm(true)}
      />

      <CarDashboard
        vehicles={vehicles}
        isLoading={isLoading}
        onAddVehicle={() => setShowForm(true)}
      />

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
