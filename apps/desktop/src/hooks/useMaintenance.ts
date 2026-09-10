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
} from "@/lib/types";

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
    onSuccess: (vehicle) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.maintenance });
      toast.success(
        t("maintenance.onboarding.successToast", {
          nickname: vehicle.nickname,
        })
      );
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
