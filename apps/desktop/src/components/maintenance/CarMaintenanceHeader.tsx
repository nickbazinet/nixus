import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";

interface CarMaintenanceHeaderProps {
  titleKey: "nav.carDashboard" | "nav.maintenanceGarage";
  vehicleCount: number | undefined;
  isLoading: boolean;
  onAddVehicle: () => void;
}

export function CarMaintenanceHeader({
  titleKey,
  vehicleCount,
  isLoading,
  onAddVehicle,
}: CarMaintenanceHeaderProps) {
  const { t } = useTranslation();

  return (
    <PageHeader
      title={t(titleKey)}
      subtitle={
        !isLoading && vehicleCount !== undefined && vehicleCount > 0
          ? t("maintenance.subtitle", { count: vehicleCount })
          : undefined
      }
      actions={
        <Button
          size="sm"
          onClick={onAddVehicle}
          data-testid="add-vehicle-button"
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("maintenance.addVehicle")}
        </Button>
      }
    />
  );
}
