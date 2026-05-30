import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { Button, Card, CardContent } from "@nixus/shared";
import { SlideOver } from "@nixus/shared";
import { AddVehicleForm } from "@/components/maintenance/AddVehicleForm";
import { CarMaintenanceHeader } from "@/components/maintenance/CarMaintenanceHeader";
import { MaintenanceInboxRow } from "@/components/maintenance/MaintenanceInboxRow";
import { useMaintenance } from "@/hooks/useMaintenance";
import {
  countOnTrackTasks,
  flattenInboxItems,
} from "@/lib/maintenanceUtils";

export const Route = createFileRoute("/car/")({
  component: MaintenanceInboxPage,
});

function MaintenanceInboxPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const { data: vehicles, isLoading } = useMaintenance();

  const inboxItems = useMemo(
    () => (vehicles ? flattenInboxItems(vehicles, t) : []),
    [vehicles, t]
  );
  const onTrackCount = useMemo(
    () => (vehicles ? countOnTrackTasks(vehicles) : 0),
    [vehicles]
  );

  const openAddForm = () => setShowForm(true);

  return (
    <div>
      <CarMaintenanceHeader
        titleKey="nav.maintenanceInbox"
        vehicleCount={vehicles?.length}
        isLoading={isLoading}
        onAddVehicle={openAddForm}
      />

      {isLoading && (
        <Card className="shadow-sm rounded-lg" data-testid="maintenance-skeleton">
          <CardContent className="p-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-20 bg-muted animate-pulse rounded" />
                </div>
                <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isLoading && vehicles && vehicles.length === 0 && !showForm && (
        <Card className="shadow-sm rounded-lg" data-testid="maintenance-empty-state">
          <CardContent className="p-8 text-center">
            <Wrench
              className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3"
              aria-hidden="true"
            />
            <p className="font-medium text-foreground mb-1">
              {t("maintenance.emptyTitle")}
            </p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              {t("maintenance.emptyHelper")}
            </p>
            <Button size="sm" onClick={openAddForm}>
              {t("maintenance.addVehicle")}
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && vehicles && vehicles.length > 0 && inboxItems.length === 0 && (
        <Card
          className="shadow-sm rounded-lg"
          data-testid="maintenance-inbox-empty"
        >
          <CardContent className="p-8 text-center">
            <p className="font-medium text-foreground mb-3">
              {t("maintenance.inbox.allUpToDate")}
            </p>
            <Link
              to="/car/garage"
              className="text-sm text-primary hover:underline"
              data-testid="inbox-go-to-garage"
            >
              {t("maintenance.inbox.goToGarage")}
            </Link>
          </CardContent>
        </Card>
      )}

      {!isLoading && inboxItems.length > 0 && (
        <div className="space-y-3" data-testid="maintenance-inbox-list">
          {inboxItems.map((item) => (
            <MaintenanceInboxRow
              key={`${item.vehicle.id}-${item.task.id}`}
              item={item}
            />
          ))}

          {onTrackCount > 0 && (
            <p
              className="pt-2 text-sm text-muted-foreground"
              data-testid="maintenance-inbox-footer"
            >
              {t("maintenance.inbox.footerOnTrack", { count: onTrackCount })}{" "}
              <Link
                to="/car/garage"
                className="text-primary hover:underline"
                data-testid="inbox-footer-garage-link"
              >
                {t("maintenance.inbox.goToGarage")}
              </Link>
            </p>
          )}
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
