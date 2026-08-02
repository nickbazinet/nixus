import { useEffect, useId } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, DatePicker, Input, Label, focusRing } from "@nixus/shared";
import { useLogCustomService } from "@/hooks/useMaintenance";
import { todayIsoDate } from "@/lib/maintenanceUtils";
import { cn } from "@/lib/utils";

interface LogCustomServiceFormData {
  custom_service_name: string;
  service_date: string;
  odometer_km: string;
  notes: string;
}

interface LogCustomServiceFormProps {
  vehicleId: number;
  defaultOdometerKm: number;
  onSuccess: () => void;
  onCancel: () => void;
}

function parseOdometerKm(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 0) return null;

  return num;
}

export function LogCustomServiceForm({
  vehicleId,
  defaultOdometerKm,
  onSuccess,
  onCancel,
}: LogCustomServiceFormProps) {
  const { t } = useTranslation();
  const logCustomService = useLogCustomService();
  const nameErrorId = useId();
  const dateErrorId = useId();
  const odometerErrorId = useId();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LogCustomServiceFormData>({
    defaultValues: {
      custom_service_name: "",
      service_date: todayIsoDate(),
      odometer_km: String(defaultOdometerKm),
      notes: "",
    },
    mode: "onBlur",
  });

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  const onSubmit = (data: LogCustomServiceFormData) => {
    const serviceName = data.custom_service_name.trim();
    if (!serviceName) {
      setError("custom_service_name", {
        message: t("maintenance.validation.serviceNameRequired"),
      });
      return;
    }

    if (!data.service_date.trim()) {
      setError("service_date", {
        message: t("maintenance.validation.dateRequired"),
      });
      return;
    }

    const odometerKm = parseOdometerKm(data.odometer_km);
    if (odometerKm === null) {
      setError("odometer_km", {
        message: data.odometer_km.trim()
          ? t("maintenance.validation.odometerInvalid")
          : t("maintenance.validation.odometerRequired"),
      });
      return;
    }

    logCustomService.mutate(
      {
        vehicle_id: vehicleId,
        custom_service_name: serviceName,
        service_date: data.service_date,
        odometer_km: odometerKm,
        notes: data.notes.trim() || null,
      },
      {
        onSuccess: () => {
          onSuccess();
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
      className="space-y-4"
      data-testid="log-custom-service-form"
      data-vehicle-id={vehicleId}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`custom-service-name-${vehicleId}`} required>
            {t("maintenance.customService.name")}
          </Label>
          <Input
            id={`custom-service-name-${vehicleId}`}
            type="text"
            placeholder={t("maintenance.customService.namePlaceholder")}
            aria-required="true"
            aria-invalid={!!errors.custom_service_name}
            aria-describedby={
              errors.custom_service_name ? nameErrorId : undefined
            }
            data-testid="custom-service-name"
            {...register("custom_service_name", {
              required: t("maintenance.validation.serviceNameRequired"),
            })}
          />
          {errors.custom_service_name && (
            <p id={nameErrorId} className="text-caption text-over-ink">
              {errors.custom_service_name.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`custom-service-date-${vehicleId}`} required>
            {t("maintenance.logService.date")}
          </Label>
          <div data-testid="custom-service-date">
            <Controller
              name="service_date"
              control={control}
              rules={{ required: t("maintenance.validation.dateRequired") }}
              render={({ field }) => (
                <DatePicker
                  id={`custom-service-date-${vehicleId}`}
                  value={field.value}
                  onChange={field.onChange}
                  aria-required="true"
                  aria-invalid={!!errors.service_date}
                  aria-describedby={
                    errors.service_date ? dateErrorId : undefined
                  }
                />
              )}
            />
          </div>
          {errors.service_date && (
            <p id={dateErrorId} className="text-caption text-over-ink">
              {errors.service_date.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`custom-service-odometer-${vehicleId}`} required>
            {t("maintenance.logService.odometer")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={`custom-service-odometer-${vehicleId}`}
              type="number"
              min={0}
              step={1}
              money
              aria-required="true"
              aria-invalid={!!errors.odometer_km}
              aria-describedby={
                errors.odometer_km ? odometerErrorId : undefined
              }
              data-testid="custom-service-odometer"
              {...register("odometer_km", {
                required: t("maintenance.validation.odometerRequired"),
              })}
            />
            <span className="shrink-0 text-caption text-ink-dim">km</span>
          </div>
          {errors.odometer_km && (
            <p id={odometerErrorId} className="text-caption text-over-ink">
              {errors.odometer_km.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`custom-service-notes-${vehicleId}`}>
            {t("maintenance.logService.notes")}
          </Label>
          <textarea
            id={`custom-service-notes-${vehicleId}`}
            rows={2}
            data-testid="custom-service-notes"
            className={cn(
              "w-full min-w-0 rounded-sm border border-line-strong bg-card px-2.5 py-1.5 text-body text-ink transition-colors",
              "placeholder:text-ink-faint",
              focusRing
            )}
            {...register("notes")}
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("maintenance.logService.cancel")}
        </Button>
        <Button type="submit" size="sm" data-testid="custom-service-save">
          {t("maintenance.logService.save")}
        </Button>
      </div>
    </form>
  );
}
