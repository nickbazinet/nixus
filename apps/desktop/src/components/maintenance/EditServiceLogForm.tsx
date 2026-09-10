import { useId } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, DatePicker, Input, Label, focusRing } from "@nixus/shared";
import { useUpdateServiceLog } from "@/hooks/useServiceHistory";
import { formatServiceEntryLabel } from "@/lib/maintenanceUtils";
import { cn } from "@/lib/utils";
import type { MaintenanceServiceLogEntry } from "@/lib/types";

interface EditServiceLogFormData {
  custom_service_name: string;
  service_date: string;
  odometer_km: string;
  notes: string;
}

interface EditServiceLogFormProps {
  entry: MaintenanceServiceLogEntry;
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

export function EditServiceLogForm({
  entry,
  onSuccess,
  onCancel,
}: EditServiceLogFormProps) {
  const { t } = useTranslation();
  const updateServiceLog = useUpdateServiceLog();
  const nameErrorId = useId();
  const dateErrorId = useId();
  const odometerErrorId = useId();

  // A scheduled entry's identity is its task, and the backend refuses to rename one. Only an
  // off-schedule entry carries an editable name.
  const isCustomEntry = entry.task_id === null;
  const serviceLabel = formatServiceEntryLabel(entry, t);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditServiceLogFormData>({
    defaultValues: {
      custom_service_name: entry.custom_service_name?.trim() ?? "",
      service_date: entry.service_date,
      odometer_km: String(entry.odometer_km),
      notes: entry.notes ?? "",
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: EditServiceLogFormData) => {
    const serviceName = data.custom_service_name.trim();
    if (isCustomEntry && !serviceName) {
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

    updateServiceLog.mutate(
      {
        log_id: entry.id,
        service_date: data.service_date,
        odometer_km: odometerKm,
        notes: data.notes.trim() || null,
        custom_service_name: isCustomEntry ? serviceName : null,
      },
      {
        onSuccess: () => {
          onSuccess();
        },
        onError: () => {
          toast.error(t("maintenance.toast.serviceUpdateFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="edit-service-log-form"
      data-log-id={entry.id}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {isCustomEntry ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="edit-service-log-name" required>
              {t("maintenance.customService.name")}
            </Label>
            <Input
              id="edit-service-log-name"
              type="text"
              autoFocus
              aria-required="true"
              aria-invalid={!!errors.custom_service_name}
              aria-describedby={
                errors.custom_service_name ? nameErrorId : undefined
              }
              data-testid="edit-service-log-name"
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
        ) : (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-caption text-ink-faint">
              {t("maintenance.history.columns.task")}
            </span>
            <p className="text-label text-ink" data-testid="edit-service-log-service">
              {serviceLabel}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-service-log-date" required>
            {t("maintenance.logService.date")}
          </Label>
          <div data-testid="edit-service-log-date">
            <Controller
              name="service_date"
              control={control}
              rules={{ required: t("maintenance.validation.dateRequired") }}
              render={({ field }) => (
                <DatePicker
                  id="edit-service-log-date"
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
          <Label htmlFor="edit-service-log-odometer" required>
            {t("maintenance.logService.odometer")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="edit-service-log-odometer"
              type="number"
              min={0}
              step={1}
              money
              aria-required="true"
              aria-invalid={!!errors.odometer_km}
              aria-describedby={
                errors.odometer_km ? odometerErrorId : undefined
              }
              data-testid="edit-service-log-odometer"
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
          <Label htmlFor="edit-service-log-notes">
            {t("maintenance.logService.notes")}
          </Label>
          <textarea
            id="edit-service-log-notes"
            rows={2}
            data-testid="edit-service-log-notes"
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
        <Button
          type="submit"
          size="sm"
          disabled={updateServiceLog.isPending}
          data-testid="edit-service-log-save"
        >
          {t("maintenance.logService.save")}
        </Button>
      </div>
    </form>
  );
}
