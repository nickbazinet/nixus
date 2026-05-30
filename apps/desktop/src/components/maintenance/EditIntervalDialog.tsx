import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nixus/shared";
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
    mode: "onSubmit",
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-interval-dialog">
        <DialogHeader>
          <DialogTitle>{t("maintenance.dialog.editIntervalTitle")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <p className="text-sm text-muted-foreground">{baselineHint}</p>

          <div className="space-y-1.5">
            <Label htmlFor="interval-km">{t("maintenance.interval.kmLabel")}</Label>
            <Input
              id="interval-km"
              type="number"
              min={0}
              step={1}
              aria-invalid={!!errors.interval_km}
              {...register("interval_km")}
            />
            {errors.interval_km && (
              <p className="text-xs text-destructive">{errors.interval_km.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="interval-months">
              {t("maintenance.interval.monthsLabel")}
            </Label>
            <Input
              id="interval-months"
              type="number"
              min={0}
              step={1}
              aria-invalid={!!errors.interval_months}
              {...register("interval_months")}
            />
            {errors.interval_months && (
              <p className="text-xs text-destructive">
                {errors.interval_months.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" data-testid="edit-interval-save">
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
