import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { queryKeys } from "@/lib/constants";
import type {
  Vehicle,
  VehicleWithTasks,
  CreateVehicleInput,
  AddMaintenanceTaskInput,
  MaintenanceTaskBaseline,
  UpdateVehicleInput,
  MaintenanceTaskWithStatus,
  MaintenanceServiceLogEntry,
  LogMaintenanceServiceInput,
  LogCustomServiceInput,
  LogCustomServiceResult,
  LogServiceResult,
} from "@/lib/types";
import { formatOdometerKm } from "@/lib/maintenanceUtils";

export function useMaintenance() {
  return useQuery({
    queryKey: queryKeys.maintenance,
    queryFn: async () => {
      const vehicles = await invoke<Vehicle[]>("get_vehicles");
      return Promise.all(
        vehicles.map((vehicle) =>
          invoke<VehicleWithTasks>("get_vehicle", { id: vehicle.id })
        )
      );
    },
  });
}

export function useMaintenanceTaskBaselines() {
  return useQuery({
    queryKey: queryKeys.maintenanceTaskBaselines,
    queryFn: () =>
      invoke<MaintenanceTaskBaseline[]>("get_maintenance_task_baselines"),
    staleTime: Infinity,
  });
}

export function useCreateVehicle() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: CreateVehicleInput) =>
      invoke<Vehicle>("create_vehicle", {
        odometer_km: input.odometer_km,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        use_default_template: input.use_default_template ?? true,
        custom_tasks: null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      toast.success(t("maintenance.toast.vehicleCreated"));
    },
  });
}

export interface UpdateMaintenanceTaskInput {
  task_id: number;
  vehicle_id: number;
  interval_km: number;
  interval_months: number;
}

export function useAddMaintenanceTask() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: AddMaintenanceTaskInput) =>
      invoke<MaintenanceTaskWithStatus>("add_maintenance_task", { input }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceVehicle(input.vehicle_id),
      });
      toast.success(t("maintenance.toast.taskAdded"));
    },
  });
}

export function useUpdateMaintenanceTask() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: UpdateMaintenanceTaskInput) =>
      invoke<MaintenanceTaskWithStatus>(
        "update_maintenance_task",
        {
          task_id: input.task_id,
          interval_km: input.interval_km,
          interval_months: input.interval_months,
        }
      ),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceVehicle(input.vehicle_id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      toast.success(t("maintenance.toast.intervalUpdated"));
    },
  });
}

export function useUpdateVehicleOdometer() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      vehicleId,
      odometerKm,
    }: {
      vehicleId: number;
      odometerKm: number;
    }) =>
      invoke<VehicleWithTasks>("update_vehicle_odometer", {
        vehicle_id: vehicleId,
        odometer_km: odometerKm,
      }),
    onSuccess: (data, { vehicleId }) => {
      queryClient.setQueryData<VehicleWithTasks[]>(
        queryKeys.maintenance,
        (old) => {
          if (!old) return old;
          return old.map((item) =>
            item.vehicle.id === vehicleId ? data : item
          );
        }
      );
      queryClient.setQueryData(queryKeys.maintenanceVehicle(vehicleId), data);
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceVehicle(vehicleId),
      });
      toast.success(t("maintenance.toast.odometerManual"), { duration: 3000 });
    },
  });
}

export function useLogMaintenanceService() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: LogMaintenanceServiceInput) =>
      invoke<LogServiceResult>("log_maintenance_service", { input }),
    onSuccess: async (result) => {
      toast.success(t("maintenance.toast.serviceLogged"));

      if (result.odometer_updated && result.new_odometer_km !== undefined) {
        toast.info(
          t("maintenance.toast.odometerUpdated", {
            km: formatOdometerKm(result.new_odometer_km),
          }),
          { duration: 4000 }
        );
      }

      const vehicleId = result.log.vehicle_id;
      const freshVehicle = await invoke<VehicleWithTasks>("get_vehicle", {
        id: vehicleId,
      });
      queryClient.setQueryData<VehicleWithTasks[]>(
        queryKeys.maintenance,
        (old) => {
          if (!old) return old;
          return old.map((item) =>
            item.vehicle.id === vehicleId ? freshVehicle : item
          );
        }
      );
      queryClient.setQueryData(
        queryKeys.maintenanceVehicle(vehicleId),
        freshVehicle
      );

      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenance,
        refetchType: "none",
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceVehicle(vehicleId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceHistory(vehicleId),
      });
    },
  });
}

export function useLogCustomService() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: LogCustomServiceInput) =>
      invoke<LogCustomServiceResult>("log_custom_service", { input }),
    onSuccess: async (result) => {
      toast.success(t("maintenance.toast.customServiceLogged"));

      if (result.odometer_updated && result.new_odometer_km !== undefined) {
        toast.info(
          t("maintenance.toast.odometerUpdated", {
            km: formatOdometerKm(result.new_odometer_km),
          }),
          { duration: 4000 }
        );
      }

      const vehicleId = result.log.vehicle_id;
      const freshVehicle = await invoke<VehicleWithTasks>("get_vehicle", {
        id: vehicleId,
      });
      queryClient.setQueryData<VehicleWithTasks[]>(
        queryKeys.maintenance,
        (old) => {
          if (!old) return old;
          return old.map((item) =>
            item.vehicle.id === vehicleId ? freshVehicle : item
          );
        }
      );
      queryClient.setQueryData(
        queryKeys.maintenanceVehicle(vehicleId),
        freshVehicle
      );

      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenance,
        refetchType: "none",
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceVehicle(vehicleId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceHistory(vehicleId),
      });
    },
  });
}

export function useServiceHistory(vehicleId: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.maintenanceHistory(vehicleId),
    queryFn: () =>
      invoke<MaintenanceServiceLogEntry[]>("get_service_history", {
        vehicle_id: vehicleId,
      }),
    enabled: vehicleId > 0 && enabled,
  });
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: UpdateVehicleInput) =>
      invoke<Vehicle>("update_vehicle", {
        id: input.id,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      queryClient.invalidateQueries({
        queryKey: queryKeys.maintenanceVehicle(input.id),
      });
      toast.success(t("maintenance.toast.vehicleUpdated"));
    },
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_vehicle", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      toast.success(t("maintenance.toast.vehicleDeleted"));
    },
  });
}
