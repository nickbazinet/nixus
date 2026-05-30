import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, DatePicker, Input, Label } from "@nixus/shared";
import { useLogMaintenanceService } from "@/hooks/useMaintenance";
import { cn } from "@/lib/utils";

interface LogServiceFormData {
  service_date: string;
  odometer_km: string;
  notes: string;
}

interface LogServiceFormProps {
  taskId: number;
  vehicleId: number;
  defaultOdometerKm: number;
  onSuccess: () => void;
  onCancel: () => void;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseOdometerKm(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 0) return null;

  return num;
}

export function LogServiceForm({
  taskId,
  vehicleId,
  defaultOdometerKm,
  onSuccess,
  onCancel,
}: LogServiceFormProps) {
  const { t } = useTranslation();
  const logService = useLogMaintenanceService();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LogServiceFormData>({
    defaultValues: {
      service_date: todayIsoDate(),
      odometer_km: String(defaultOdometerKm),
      notes: "",
    },
    mode: "onSubmit",
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

  const onSubmit = (data: LogServiceFormData) => {
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

    logService.mutate(
      {
        task_id: taskId,
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
      className="border-b border-border bg-muted/20 px-3 py-3 sm:pl-10"
      data-testid="log-service-form"
      data-vehicle-id={vehicleId}
      data-task-id={taskId}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`log-service-date-${taskId}`}>
            {t("maintenance.logService.date")}
          </Label>
          <div data-testid="log-service-date">
            <Controller
              name="service_date"
              control={control}
              rules={{ required: t("maintenance.validation.dateRequired") }}
              render={({ field }) => (
                <DatePicker
                  id={`log-service-date-${taskId}`}
                  value={field.value}
                  onChange={field.onChange}
                  aria-invalid={!!errors.service_date}
                />
              )}
            />
          </div>
          {errors.service_date && (
            <p className="text-xs text-destructive">{errors.service_date.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`log-service-odometer-${taskId}`}>
            {t("maintenance.logService.odometer")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={`log-service-odometer-${taskId}`}
              type="number"
              min={0}
              step={1}
              aria-invalid={!!errors.odometer_km}
              data-testid="log-service-odometer"
              className="font-mono tabular-nums"
              {...register("odometer_km", {
                required: t("maintenance.validation.odometerRequired"),
              })}
            />
            <span className="text-sm text-muted-foreground shrink-0">km</span>
          </div>
          {errors.odometer_km && (
            <p className="text-xs text-destructive">{errors.odometer_km.message}</p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`log-service-notes-${taskId}`}>
            {t("maintenance.logService.notes")}
          </Label>
          <textarea
            id={`log-service-notes-${taskId}`}
            rows={2}
            data-testid="log-service-notes"
            className={cn(
              "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none",
              "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            )}
            {...register("notes")}
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("maintenance.logService.cancel")}
        </Button>
        <Button type="submit" size="sm" data-testid="log-service-save">
          {t("maintenance.logService.save")}
        </Button>
      </div>
    </form>
  );
}
