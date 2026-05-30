import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SlideOver,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nixus/shared";
import { AddScheduleTaskDialog } from "@/components/maintenance/AddScheduleTaskDialog";
import { EditVehicleForm } from "@/components/maintenance/EditVehicleForm";
import { LogCustomServiceForm } from "@/components/maintenance/LogCustomServiceForm";
import { MaintenanceTaskRow } from "@/components/maintenance/MaintenanceTaskRow";
import { OdometerUpdateForm } from "@/components/maintenance/OdometerUpdateForm";
import { ServiceHistoryTable } from "@/components/maintenance/ServiceHistoryTable";
import { useDeleteVehicle } from "@/hooks/useMaintenance";
import {
  formatVehicleDisplayName,
  formatVehicleMakeModel,
  sortMaintenanceTasks,
} from "@/lib/maintenanceUtils";
import type { VehicleWithTasks } from "@/lib/types";

interface VehicleDetailPanelProps {
  vehicleWithTasks: VehicleWithTasks;
  onVehicleDeleted?: () => void;
}

type DetailTab = "needs-attention" | "all-tasks" | "history";

export function VehicleDetailPanel({
  vehicleWithTasks,
  onVehicleDeleted,
}: VehicleDetailPanelProps) {
  const { t } = useTranslation();
  const deleteVehicle = useDeleteVehicle();
  const [activeTab, setActiveTab] = useState<DetailTab>("needs-attention");
  const [customLogOpen, setCustomLogOpen] = useState(false);
  const [addScheduleOpen, setAddScheduleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { vehicle, tasks } = vehicleWithTasks;

  const attentionTasks = useMemo(
    () => tasks.filter((task) => task.status !== "ok"),
    [tasks]
  );
  const sortedAttentionTasks = useMemo(
    () => sortMaintenanceTasks(attentionTasks, t),
    [attentionTasks, t]
  );
  const sortedAllTasks = useMemo(
    () => sortMaintenanceTasks(tasks, t),
    [tasks, t]
  );
  const existingTaskKeys = useMemo(
    () => tasks.map((task) => task.task_type_key),
    [tasks]
  );

  const defaultTab: DetailTab =
    attentionTasks.length > 0 ? "needs-attention" : "all-tasks";

  useEffect(() => {
    setActiveTab(defaultTab);
    setCustomLogOpen(false);
  }, [vehicle.id, defaultTab]);

  const displayName = formatVehicleDisplayName(vehicle);
  const makeModel = formatVehicleMakeModel(vehicle);

  const handleDelete = () => {
    deleteVehicle.mutate(vehicle.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        onVehicleDeleted?.();
      },
    });
  };

  return (
    <>
      <div
        className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-sm"
        data-testid="vehicle-detail-panel"
      >
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-foreground">{displayName}</h2>
              {makeModel && (
                <p className="mt-0.5 text-sm text-muted-foreground">{makeModel}</p>
              )}
              <div className="mt-2">
                <OdometerUpdateForm
                  vehicleId={vehicle.id}
                  odometerKm={vehicle.odometer_km}
                />
              </div>
            </div>
            <div
              className="flex shrink-0 flex-wrap items-center justify-end gap-2"
              data-testid="vehicle-detail-actions"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomLogOpen(true)}
                data-testid="log-custom-service-button"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t("maintenance.customService.add")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
                data-testid="edit-vehicle-button"
              >
                {t("maintenance.editVehicle")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => setDeleteOpen(true)}
                data-testid="delete-vehicle-button"
              >
                {t("maintenance.deleteVehicle")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 p-4 sm:p-5">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as DetailTab)}
          >
            <TabsList className="w-full flex-wrap h-auto gap-1">
              <TabsTrigger
                value="needs-attention"
                data-testid="detail-tab-needs-attention"
              >
                {t("maintenance.detail.tabs.needsAttention")}
              </TabsTrigger>
              <TabsTrigger value="all-tasks" data-testid="detail-tab-all-tasks">
                {t("maintenance.detail.tabs.allTasks")}
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="detail-tab-history">
                {t("maintenance.detail.tabs.history")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="needs-attention" className="mt-4">
              {sortedAttentionTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("maintenance.garage.allOnTrack")}
                </p>
              ) : (
                <div
                  className="rounded-lg border border-border overflow-hidden"
                  data-testid="vehicle-detail-tasks"
                >
                  {sortedAttentionTasks.map((task) => (
                    <MaintenanceTaskRow
                      key={task.id}
                      task={task}
                      vehicleId={vehicle.id}
                      vehicleOdometerKm={vehicle.odometer_km}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="all-tasks" className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {tasks.length === 0
                    ? t("maintenance.schedule.empty")
                    : t("maintenance.schedule.summary", { count: tasks.length })}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddScheduleOpen(true)}
                  data-testid="add-schedule-task-button"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t("maintenance.schedule.addService")}
                </Button>
              </div>

              {sortedAllTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-4 py-6 text-center">
                  {t("maintenance.schedule.emptyHint")}
                </p>
              ) : (
                <div
                  className="rounded-lg border border-border overflow-hidden"
                  data-testid="vehicle-schedule-tasks"
                >
                  {sortedAllTasks.map((task) => (
                    <MaintenanceTaskRow
                      key={task.id}
                      task={task}
                      vehicleId={vehicle.id}
                      vehicleOdometerKm={vehicle.odometer_km}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4 space-y-4">
              <ServiceHistoryTable
                vehicleId={vehicle.id}
                enabled={activeTab === "history"}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <AddScheduleTaskDialog
        open={addScheduleOpen}
        onOpenChange={setAddScheduleOpen}
        vehicleId={vehicle.id}
        existingTaskKeys={existingTaskKeys}
      />

      <SlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("maintenance.editVehicle")}
        data-testid="edit-vehicle-slide-over"
      >
        <EditVehicleForm vehicle={vehicle} onClose={() => setEditOpen(false)} />
      </SlideOver>

      <SlideOver
        open={customLogOpen}
        onClose={() => setCustomLogOpen(false)}
        title={t("maintenance.customService.title")}
        data-testid="log-custom-service-slide-over"
      >
        <LogCustomServiceForm
          vehicleId={vehicle.id}
          defaultOdometerKm={vehicle.odometer_km}
          onSuccess={() => setCustomLogOpen(false)}
          onCancel={() => setCustomLogOpen(false)}
        />
      </SlideOver>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent data-testid="delete-vehicle-dialog">
          <DialogHeader>
            <DialogTitle>{t("maintenance.deleteVehicle")}</DialogTitle>
            <DialogDescription>
              {t("maintenance.deleteVehicleConfirm", {
                nickname: displayName,
              })}{" "}
              {t("budget.cannotBeUndone")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="confirm-delete-vehicle-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
