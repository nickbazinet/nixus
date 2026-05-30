import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { useUpdateVehicle } from "@/hooks/useMaintenance";
import { VehicleCatalogFields } from "@/components/maintenance/VehicleCatalogFields";
import type { Vehicle } from "@/lib/types";

interface VehicleFormData {
  make: string;
  model: string;
  year: string;
}

interface EditVehicleFormProps {
  vehicle: Vehicle;
  onClose: () => void;
}

export function EditVehicleForm({ vehicle, onClose }: EditVehicleFormProps) {
  const { t } = useTranslation();
  const updateVehicle = useUpdateVehicle();

  const { watch, setValue } = useForm<VehicleFormData>({
    defaultValues: {
      make: vehicle.make ?? "",
      model: vehicle.model ?? "",
      year: vehicle.year ? String(vehicle.year) : "",
    },
    mode: "onSubmit",
  });

  const make = watch("make");
  const model = watch("model");
  const year = watch("year");

  const onSubmit = () => {
    const yearValue = year.trim() ? Number.parseInt(year, 10) : null;

    updateVehicle.mutate(
      {
        id: vehicle.id,
        make: make.trim() || null,
        model: model.trim() || null,
        year: yearValue,
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
      data-testid="edit-vehicle-form"
      autoComplete="off"
    >
      <VehicleCatalogFields
        make={make}
        model={model}
        year={year}
        makeInputId="edit-vehicle-make"
        modelInputId="edit-vehicle-model"
        yearInputId="edit-vehicle-year"
        onMakeChange={(value) => setValue("make", value)}
        onModelChange={(value) => setValue("model", value)}
        onYearChange={(value) => setValue("year", value)}
      />

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("common.save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          data-testid="cancel-edit-vehicle"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
