import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, Input, Label } from "@nixus/shared";
import {
  MaintenanceTemplateSection,
  type MaintenanceTemplateMode,
} from "@/components/maintenance/MaintenanceTemplateSection";
import { VehicleCatalogFields } from "@/components/maintenance/VehicleCatalogFields";
import { useCreateVehicle } from "@/hooks/useMaintenance";

interface VehicleFormData {
  make: string;
  model: string;
  year: string;
  odometer_km: string;
}

interface AddVehicleFormProps {
  onClose: () => void;
}

export function AddVehicleForm({ onClose }: AddVehicleFormProps) {
  const { t } = useTranslation();
  const createVehicle = useCreateVehicle();
  const odometerErrorId = useId();
  const [templateMode, setTemplateMode] =
    useState<MaintenanceTemplateMode>("default");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<VehicleFormData>({
    defaultValues: {
      make: "",
      model: "",
      year: "",
      odometer_km: "",
    },
    mode: "onBlur",
  });

  const make = watch("make");
  const model = watch("model");
  const year = watch("year");

  const onSubmit = (data: VehicleFormData) => {
    const odometerKm = Number.parseInt(data.odometer_km, 10);
    const yearValue = year.trim() ? Number.parseInt(year, 10) : null;

    createVehicle.mutate(
      {
        make: make.trim() || null,
        model: model.trim() || null,
        year: yearValue,
        odometer_km: odometerKm,
        use_default_template: templateMode === "default",
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
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
      data-testid="add-vehicle-form"
      autoComplete="off"
    >
      <VehicleCatalogFields
        make={make}
        model={model}
        year={year}
        onMakeChange={(value) => setValue("make", value)}
        onModelChange={(value) => setValue("model", value)}
        onYearChange={(value) => setValue("year", value)}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vehicle-odometer" required>
          {t("maintenance.fields.odometer")}
        </Label>
        <Input
          id="vehicle-odometer"
          type="number"
          min={0}
          step={1}
          money
          aria-required="true"
          aria-invalid={!!errors.odometer_km}
          aria-describedby={errors.odometer_km ? odometerErrorId : undefined}
          {...register("odometer_km", {
            required: t("maintenance.validation.odometerRequired"),
            validate: (v) => {
              if (!v.trim()) return t("maintenance.validation.odometerRequired");
              const km = Number.parseInt(v, 10);
              if (Number.isNaN(km) || km < 0) {
                return t("maintenance.validation.odometerMin");
              }
              if (String(km) !== v.trim()) {
                return t("maintenance.validation.odometerMin");
              }
              return true;
            },
          })}
        />
        {errors.odometer_km && (
          <p id={odometerErrorId} className="text-caption text-over-ink">
            {errors.odometer_km.message}
          </p>
        )}
      </div>

      <MaintenanceTemplateSection
        mode={templateMode}
        onModeChange={setTemplateMode}
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
          data-testid="cancel-add-vehicle"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
