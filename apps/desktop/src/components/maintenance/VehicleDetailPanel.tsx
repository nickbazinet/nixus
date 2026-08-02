import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
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
  formatVehicleSubtitle,
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
  const subtitle = formatVehicleSubtitle(vehicle);

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
      <Card flush className="min-h-0" data-testid="vehicle-detail-panel">
        <div className="border-b border-line px-card-pad py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-h2 text-ink">{displayName}</h2>
              {subtitle && (
                <p className="mt-0.5 text-caption text-ink-dim">{subtitle}</p>
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
                <Plus aria-hidden="true" />
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
              {/* Delete is demoted into the overflow rather than sitting beside Edit: a destructive
                  action is never a peer of an ordinary one in the same row. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("maintenance.detail.vehicleActions", {
                        vehicle: displayName,
                      })}
                      data-testid="vehicle-detail-menu"
                    />
                  }
                >
                  <MoreHorizontal aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                    data-testid="delete-vehicle-button"
                  >
                    <Trash2 aria-hidden="true" />
                    {t("maintenance.deleteVehicle")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="flex-1 p-card-pad">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as DetailTab)}
          >
            <TabsList className="h-auto w-full flex-wrap">
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
                <EmptyState
                  title={t("maintenance.garage.allOnTrack")}
                  description={t("maintenance.garage.allOnTrackHelper")}
                />
              ) : (
                <div
                  className="overflow-hidden rounded-lg border border-line"
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

            <TabsContent
              value="all-tasks"
              className="mt-4 flex flex-col gap-grid-gap"
            >
              <div className="flex items-center justify-between gap-3">
                {/* Count only: when empty, the EmptyState below is what says so. */}
                {tasks.length > 0 && (
                  <p className="text-caption text-ink-dim">
                    {t("maintenance.schedule.summary", { count: tasks.length })}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setAddScheduleOpen(true)}
                  data-testid="add-schedule-task-button"
                >
                  <Plus aria-hidden="true" />
                  {t("maintenance.schedule.addService")}
                </Button>
              </div>

              {sortedAllTasks.length === 0 ? (
                // No action: the Add service button above is already the one.
                <EmptyState
                  title={t("maintenance.schedule.empty")}
                  description={t("maintenance.schedule.emptyHint")}
                />
              ) : (
                <div
                  className="overflow-hidden rounded-lg border border-line"
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

            <TabsContent value="history" className="mt-4">
              <ServiceHistoryTable
                vehicleId={vehicle.id}
                enabled={activeTab === "history"}
                onLogService={() => setCustomLogOpen(true)}
              />
            </TabsContent>
          </Tabs>
        </div>
      </Card>

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
        description={t("maintenance.editVehicleDescription")}
        data-testid="edit-vehicle-slide-over"
      >
        <EditVehicleForm vehicle={vehicle} onClose={() => setEditOpen(false)} />
      </SlideOver>

      <SlideOver
        open={customLogOpen}
        onClose={() => setCustomLogOpen(false)}
        title={t("maintenance.customService.title")}
        description={t("maintenance.customService.description")}
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
