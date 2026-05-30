import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type {
  VehicleCatalogStatus,
  VehicleMake,
  VehicleModel,
} from "@/lib/types";

export function useVehicleCatalogStatus() {
  return useQuery({
    queryKey: queryKeys.vehicleCatalog,
    queryFn: () => invoke<VehicleCatalogStatus>("get_vehicle_catalog_status"),
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) =>
      query.state.data?.available ? false : 3000,
  });
}

export function useVehicleMakes(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.vehicleMakes,
    queryFn: () => invoke<VehicleMake[]>("get_vehicle_makes"),
    enabled,
    staleTime: 30 * 60 * 1000,
  });
}

export function useVehicleModels(
  make: string | null,
  year: number | null,
  enabled: boolean
) {
  const trimmedMake = make?.trim() ?? "";
  const yearValid =
    year !== null && !Number.isNaN(year) && year >= 1900 && year <= 2100;

  return useQuery({
    queryKey: queryKeys.vehicleModels(trimmedMake, year ?? 0),
    queryFn: () =>
      invoke<VehicleModel[]>("get_vehicle_models", {
        make: trimmedMake,
        year: year as number,
      }),
    enabled: enabled && trimmedMake.length > 0 && yearValid,
    staleTime: 30 * 60 * 1000,
  });
}
