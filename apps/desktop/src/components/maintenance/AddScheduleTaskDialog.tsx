import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PillTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import {
  useAddMaintenanceTask,
  useMaintenanceTaskBaselines,
} from "@/hooks/useMaintenance";

type ScheduleTaskMode = "catalog" | "custom";

interface AddScheduleTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: number;
  existingTaskKeys: string[];
}

interface CatalogFormData {
  task_type_key: string;
}

interface CustomFormData {
  custom_task_name: string;
  interval_km: string;
  interval_months: string;
}

function parseOptionalIntegerField(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || String(parsed) !== trimmed || parsed < 0) {
    return Number.NaN;
  }
  return parsed;
}

export function AddScheduleTaskDialog({
  open,
  onOpenChange,
  vehicleId,
  existingTaskKeys,
}: AddScheduleTaskDialogProps) {
  const { t } = useTranslation();
  const { data: baselines } = useMaintenanceTaskBaselines();
  const addTask = useAddMaintenanceTask();
  const [mode, setMode] = useState<ScheduleTaskMode>("catalog");

  const availableBaselines = useMemo(() => {
    const existing = new Set(existingTaskKeys);
    return (baselines ?? [])
      .filter((baseline) => !existing.has(baseline.task_type_key))
      .sort((a, b) =>
        t(`maintenance.tasks.${a.task_type_key}`).localeCompare(
          t(`maintenance.tasks.${b.task_type_key}`)
        )
      );
  }, [baselines, existingTaskKeys, t]);

  const catalogForm = useForm<CatalogFormData>({
    defaultValues: { task_type_key: "" },
    mode: "onSubmit",
  });

  const customForm = useForm<CustomFormData>({
    defaultValues: {
      custom_task_name: "",
      interval_km: "",
      interval_months: "",
    },
    mode: "onSubmit",
  });

  const selectedKey = catalogForm.watch("task_type_key");
  const selectedBaseline = availableBaselines.find(
    (baseline) => baseline.task_type_key === selectedKey
  );

  const resetForms = () => {
    catalogForm.reset({ task_type_key: "" });
    customForm.reset({
      custom_task_name: "",
      interval_km: "",
      interval_months: "",
    });
    setMode("catalog");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForms();
    }
    onOpenChange(nextOpen);
  };

  const onSubmitCatalog = (data: CatalogFormData) => {
    addTask.mutate(
      {
        vehicle_id: vehicleId,
        task_type_key: data.task_type_key,
      },
      {
        onSuccess: () => {
          handleOpenChange(false);
        },
      }
    );
  };

  const onSubmitCustom = (data: CustomFormData) => {
    const intervalKm = parseOptionalIntegerField(data.interval_km);
    const intervalMonths = parseOptionalIntegerField(data.interval_months);

    if (Number.isNaN(intervalKm) || Number.isNaN(intervalMonths)) {
      customForm.setError("interval_km", {
        message: t("maintenance.validation.odometerInvalid"),
      });
      return;
    }

    if (intervalKm === 0 && intervalMonths === 0) {
      customForm.setError("interval_km", {
        message: t("maintenance.interval.bothZeroError"),
      });
      return;
    }

    addTask.mutate(
      {
        vehicle_id: vehicleId,
        custom_task_name: data.custom_task_name.trim(),
        interval_km: intervalKm,
        interval_months: intervalMonths,
      },
      {
        onSuccess: () => {
          handleOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="add-schedule-task-dialog">
        <DialogHeader>
          <DialogTitle>{t("maintenance.schedule.addServiceTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <PillTabs
            options={["catalog", "custom"] as const}
            labels={{
              catalog: t("maintenance.schedule.catalogOption"),
              custom: t("maintenance.schedule.customOption"),
            }}
            value={mode}
            onChange={setMode}
            data-testid="schedule-task-mode"
          />

          {mode === "catalog" ? (
            availableBaselines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("maintenance.schedule.allServicesAdded")}
              </p>
            ) : (
              <form
                onSubmit={catalogForm.handleSubmit(onSubmitCatalog)}
                className="space-y-3"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="schedule-task-type">
                    {t("maintenance.schedule.serviceType")}
                  </Label>
                  <Controller
                    name="task_type_key"
                    control={catalogForm.control}
                    rules={{
                      required: t("maintenance.validation.serviceTypeRequired"),
                    }}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        items={availableBaselines.map((baseline) => ({
                          value: baseline.task_type_key,
                          label: t(
                            `maintenance.tasks.${baseline.task_type_key}`
                          ),
                        }))}
                      >
                        <SelectTrigger
                          id="schedule-task-type"
                          aria-invalid={
                            !!catalogForm.formState.errors.task_type_key
                          }
                          data-testid="schedule-task-type-select"
                        >
                          <SelectValue
                            placeholder={t("maintenance.schedule.selectService")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {availableBaselines.map((baseline) => (
                            <SelectItem
                              key={baseline.task_type_key}
                              value={baseline.task_type_key}
                            >
                              {t(`maintenance.tasks.${baseline.task_type_key}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {catalogForm.formState.errors.task_type_key && (
                    <p className="text-xs text-destructive">
                      {catalogForm.formState.errors.task_type_key.message}
                    </p>
                  )}
                </div>

                {selectedBaseline && (
                  <p className="text-xs text-muted-foreground">
                    {t("maintenance.interval.baselineHint", {
                      km: selectedBaseline.interval_km.toLocaleString("en-US"),
                      months: selectedBaseline.interval_months,
                    })}
                  </p>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={addTask.isPending}
                    data-testid="add-schedule-task-save"
                  >
                    {t("maintenance.schedule.addService")}
                  </Button>
                </DialogFooter>
              </form>
            )
          ) : (
            <form
              onSubmit={customForm.handleSubmit(onSubmitCustom)}
              className="space-y-3"
              data-testid="schedule-custom-task-form"
            >
              <div className="space-y-1.5">
                <Label htmlFor="schedule-custom-name">
                  {t("maintenance.schedule.customName")}
                </Label>
                <Input
                  id="schedule-custom-name"
                  data-testid="schedule-custom-name-input"
                  {...customForm.register("custom_task_name", {
                    required: t("maintenance.validation.serviceNameRequired"),
                    validate: (value) =>
                      value.trim().length > 0 ||
                      t("maintenance.validation.serviceNameRequired"),
                  })}
                />
                {customForm.formState.errors.custom_task_name && (
                  <p className="text-xs text-destructive">
                    {customForm.formState.errors.custom_task_name.message}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="schedule-custom-km">
                    {t("maintenance.interval.kmLabel")}
                  </Label>
                  <Input
                    id="schedule-custom-km"
                    type="number"
                    min={0}
                    step={1}
                    data-testid="schedule-custom-km-input"
                    {...customForm.register("interval_km")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="schedule-custom-months">
                    {t("maintenance.interval.monthsLabel")}
                  </Label>
                  <Input
                    id="schedule-custom-months"
                    type="number"
                    min={0}
                    step={1}
                    data-testid="schedule-custom-months-input"
                    {...customForm.register("interval_months")}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("maintenance.schedule.customIntervalHint")}
              </p>

              {customForm.formState.errors.interval_km && (
                <p className="text-xs text-destructive">
                  {customForm.formState.errors.interval_km.message}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={addTask.isPending}
                  data-testid="add-schedule-task-save-custom"
                >
                  {t("maintenance.schedule.addService")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
