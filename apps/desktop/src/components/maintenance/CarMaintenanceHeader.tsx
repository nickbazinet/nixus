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

  // Every surface carries a subtitle. The count is the better one once it is known; until then
  // (first fetch, or an empty garage) the module's own one-liner stands in rather than nothing.
  const subtitle =
    !isLoading && vehicleCount !== undefined && vehicleCount > 0
      ? t("maintenance.subtitle", { count: vehicleCount })
      : t("maintenance.v2.subtitle");

  return (
    <PageHeader
      title={t(titleKey)}
      subtitle={subtitle}
      actions={
        <Button onClick={onAddVehicle} data-testid="add-vehicle-button">
          <Plus aria-hidden="true" />
          {t("maintenance.addVehicle")}
        </Button>
      }
    />
  );
}
