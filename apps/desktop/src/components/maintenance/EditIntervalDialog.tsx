import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button, Input, Label, SlideOver } from "@nixus/shared";
import { useUpdateMaintenanceTask } from "@/hooks/useMaintenance";
import type { MaintenanceTaskWithStatus } from "@/lib/types";

interface IntervalFormData {
  interval_km: string;
  interval_months: string;
}

interface EditIntervalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: MaintenanceTaskWithStatus;
  vehicleId: number;
}

function parseIntegerField(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || String(parsed) !== trimmed) return null;
  return parsed;
}

export function EditIntervalDialog({
  open,
  onOpenChange,
  task,
  vehicleId,
}: EditIntervalDialogProps) {
  const { t } = useTranslation();
  const updateTask = useUpdateMaintenanceTask();
  const kmErrorId = useId();
  const monthsErrorId = useId();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<IntervalFormData>({
    defaultValues: {
      interval_km: String(task.interval_km),
      interval_months: String(task.interval_months),
    },
    mode: "onBlur",
  });

  useEffect(() => {
    if (open) {
      reset({
        interval_km: String(task.interval_km),
        interval_months: String(task.interval_months),
      });
    }
  }, [open, task.interval_km, task.interval_months, reset]);

  const baselineHint = t("maintenance.interval.baselineHint", {
    km: task.default_interval_km.toLocaleString("en-US"),
    months: task.default_interval_months,
  });

  const onSubmit = (data: IntervalFormData) => {
    const intervalKm = parseIntegerField(data.interval_km);
    const intervalMonths = parseIntegerField(data.interval_months);

    if (intervalKm === null || intervalKm < 0) {
      setError("interval_km", {
        message: t("maintenance.validation.odometerMin"),
      });
      return;
    }
    if (intervalMonths === null || intervalMonths < 0) {
      setError("interval_months", {
        message: t("maintenance.validation.odometerMin"),
      });
      return;
    }
    if (intervalKm === 0 && intervalMonths === 0) {
      setError("interval_km", {
        message: t("maintenance.interval.bothZeroError"),
      });
      setError("interval_months", {
        message: t("maintenance.interval.bothZeroError"),
      });
      return;
    }

    updateTask.mutate(
      {
        task_id: task.id,
        vehicle_id: vehicleId,
        interval_km: intervalKm,
        interval_months: intervalMonths,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      }
    );
  };

  return (
    <SlideOver
      open={open}
      onClose={() => onOpenChange(false)}
      title={t("maintenance.dialog.editIntervalTitle")}
      description={t("maintenance.dialog.editIntervalDescription")}
      data-testid="edit-interval-dialog"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        <p className="text-caption text-ink-dim">{baselineHint}</p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="interval-km" required>
            {t("maintenance.interval.kmLabel")}
          </Label>
          <Input
            id="interval-km"
            type="number"
            min={0}
            step={1}
            money
            aria-required="true"
            aria-invalid={!!errors.interval_km}
            aria-describedby={errors.interval_km ? kmErrorId : undefined}
            {...register("interval_km")}
          />
          {errors.interval_km && (
            <p id={kmErrorId} className="text-caption text-over-ink">
              {errors.interval_km.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="interval-months" required>
            {t("maintenance.interval.monthsLabel")}
          </Label>
          <Input
            id="interval-months"
            type="number"
            min={0}
            step={1}
            money
            aria-required="true"
            aria-invalid={!!errors.interval_months}
            aria-describedby={
              errors.interval_months ? monthsErrorId : undefined
            }
            {...register("interval_months")}
          />
          {errors.interval_months && (
            <p id={monthsErrorId} className="text-caption text-over-ink">
              {errors.interval_months.message}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" data-testid="edit-interval-save">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}
