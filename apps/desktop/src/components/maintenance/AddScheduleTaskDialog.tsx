import { useId, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Label,
  PillTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SlideOver,
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
  const taskTypeErrorId = useId();
  const customNameErrorId = useId();
  const intervalErrorId = useId();

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
    mode: "onBlur",
  });

  const customForm = useForm<CustomFormData>({
    defaultValues: {
      custom_task_name: "",
      interval_km: "",
      interval_months: "",
    },
    mode: "onBlur",
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
    <SlideOver
      open={open}
      onClose={() => handleOpenChange(false)}
      title={t("maintenance.schedule.addServiceTitle")}
      description={t("maintenance.schedule.addServiceDescription")}
      data-testid="add-schedule-task-dialog"
    >
      <div className="flex flex-col gap-4">
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
            <p className="text-caption text-ink-dim">
              {t("maintenance.schedule.allServicesAdded")}
            </p>
          ) : (
            <form
              onSubmit={catalogForm.handleSubmit(onSubmitCatalog)}
              noValidate
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-task-type" required>
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
                        aria-required="true"
                        aria-invalid={
                          !!catalogForm.formState.errors.task_type_key
                        }
                        aria-describedby={
                          catalogForm.formState.errors.task_type_key
                            ? taskTypeErrorId
                            : undefined
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
                  <p id={taskTypeErrorId} className="text-caption text-over-ink">
                    {catalogForm.formState.errors.task_type_key.message}
                  </p>
                )}
              </div>

              {selectedBaseline && (
                <p className="text-caption text-ink-dim">
                  {t("maintenance.interval.baselineHint", {
                    km: selectedBaseline.interval_km.toLocaleString("en-US"),
                    months: selectedBaseline.interval_months,
                  })}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={addTask.isPending}
                  data-testid="add-schedule-task-save"
                >
                  {t("maintenance.schedule.addService")}
                </Button>
              </div>
            </form>
          )
        ) : (
          <form
            onSubmit={customForm.handleSubmit(onSubmitCustom)}
            noValidate
            className="flex flex-col gap-4"
            data-testid="schedule-custom-task-form"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schedule-custom-name" required>
                {t("maintenance.schedule.customName")}
              </Label>
              <Input
                id="schedule-custom-name"
                aria-required="true"
                aria-invalid={!!customForm.formState.errors.custom_task_name}
                aria-describedby={
                  customForm.formState.errors.custom_task_name
                    ? customNameErrorId
                    : undefined
                }
                data-testid="schedule-custom-name-input"
                {...customForm.register("custom_task_name", {
                  required: t("maintenance.validation.serviceNameRequired"),
                  validate: (value) =>
                    value.trim().length > 0 ||
                    t("maintenance.validation.serviceNameRequired"),
                })}
              />
              {customForm.formState.errors.custom_task_name && (
                <p
                  id={customNameErrorId}
                  className="text-caption text-over-ink"
                >
                  {customForm.formState.errors.custom_task_name.message}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-custom-km">
                  {t("maintenance.interval.kmLabel")}
                </Label>
                <Input
                  id="schedule-custom-km"
                  type="number"
                  min={0}
                  step={1}
                  money
                  aria-invalid={!!customForm.formState.errors.interval_km}
                  aria-describedby={
                    customForm.formState.errors.interval_km
                      ? intervalErrorId
                      : undefined
                  }
                  data-testid="schedule-custom-km-input"
                  {...customForm.register("interval_km")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-custom-months">
                  {t("maintenance.interval.monthsLabel")}
                </Label>
                <Input
                  id="schedule-custom-months"
                  type="number"
                  min={0}
                  step={1}
                  money
                  data-testid="schedule-custom-months-input"
                  {...customForm.register("interval_months")}
                />
              </div>
            </div>

            <p className="text-caption text-ink-dim">
              {t("maintenance.schedule.customIntervalHint")}
            </p>

            {customForm.formState.errors.interval_km && (
              <p id={intervalErrorId} className="text-caption text-over-ink">
                {customForm.formState.errors.interval_km.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={addTask.isPending}
                data-testid="add-schedule-task-save-custom"
              >
                {t("maintenance.schedule.addService")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </SlideOver>
  );
}
