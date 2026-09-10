import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { queryKeys } from "@/lib/constants";
import type {
  VehicleWithTasks,
  MaintenanceServiceLogEntry,
  LogMaintenanceServiceInput,
  LogCustomServiceInput,
  LogCustomServiceResult,
  LogServiceResult,
  UpdateServiceLogInput,
  UpdateServiceLogResult,
  DeleteServiceLogResult,
} from "@/lib/types";
import { formatOdometerKm } from "@/lib/maintenanceUtils";

// One history mutation can move the vehicle's odometer and every task's status, so the vehicle is
// re-read once and written into both caches before the stale marks go out — invalidating alone
// would leave the visible row on the pre-mutation snapshot until a refetch lands.
//
// The re-read is never allowed to throw: the write it follows has already committed, so a failure
// here must not turn a successful mutation into an error that reopens the overlay and reports a
// save that actually happened as failed. When it fails, the caches fall back to a refetching
// invalidation instead of the fresh snapshot.
async function refreshVehicleCaches(
  queryClient: QueryClient,
  vehicleId: number
) {
  const freshVehicle = await invoke<VehicleWithTasks>("get_vehicle", {
    id: vehicleId,
  }).catch(() => null);

  if (freshVehicle) {
    queryClient.setQueryData<VehicleWithTasks[]>(queryKeys.maintenance, (old) => {
      if (!old) return old;
      return old.map((item) => (item.vehicle.id === vehicleId ? freshVehicle : item));
    });
    queryClient.setQueryData(
      queryKeys.maintenanceVehicle(vehicleId),
      freshVehicle
    );
  }

  queryClient.invalidateQueries({
    queryKey: queryKeys.maintenance,
    refetchType: freshVehicle ? "none" : "active",
  });
  queryClient.invalidateQueries({
    queryKey: queryKeys.maintenanceVehicle(vehicleId),
  });
  queryClient.invalidateQueries({
    queryKey: queryKeys.maintenanceHistory(vehicleId),
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

      await refreshVehicleCaches(queryClient, result.log.vehicle_id);
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

      await refreshVehicleCaches(queryClient, result.log.vehicle_id);
    },
  });
}

export function useUpdateServiceLog() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (input: UpdateServiceLogInput) =>
      invoke<UpdateServiceLogResult>("update_service_log", { input }),
    onSuccess: async (result) => {
      toast.success(t("maintenance.toast.serviceUpdated"));

      if (result.odometer_updated && result.new_odometer_km !== undefined) {
        toast.info(
          t("maintenance.toast.odometerUpdated", {
            km: formatOdometerKm(result.new_odometer_km),
          }),
          { duration: 4000 }
        );
      }

      await refreshVehicleCaches(queryClient, result.log.vehicle_id);
    },
  });
}

export function useDeleteServiceLog() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (logId: number) =>
      invoke<DeleteServiceLogResult>("delete_service_log", { log_id: logId }),
    onSuccess: async (result) => {
      toast.success(t("maintenance.toast.serviceDeleted"));
      await refreshVehicleCaches(queryClient, result.vehicle_id);
    },
  });
}
