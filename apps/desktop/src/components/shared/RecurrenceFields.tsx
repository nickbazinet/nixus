import { useTranslation } from "react-i18next";
import { Controller, useFormContext } from "react-hook-form";
import {
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { FREQUENCY_LABEL_KEYS, RECURRENCE_FREQUENCIES, scheduleLabel } from "@/lib/recurrence";
import type { RecurrenceFrequency } from "@/lib/types";

export interface RecurrenceFormFields {
  frequency: RecurrenceFrequency;
  day_of_month: number;
  start_date: string;
}

interface RecurrenceFieldsProps {
  /** Prefix for the field ids, e.g. `recurring` gives `recurring-frequency` and `recurring-day`. */
  idPrefix: string;
}

/**
 * The "Repeats" picker shared by the recurring expense and income forms: a day of the month for
 * a monthly schedule, a start date (which fixes the weekday) for a week-based one. Must render
 * inside a `FormProvider` whose values include `RecurrenceFormFields`.
 */
export function RecurrenceFields({ idPrefix }: RecurrenceFieldsProps) {
  const { t, i18n } = useTranslation();
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<RecurrenceFormFields>();
  const frequency = watch("frequency");
  const startDate = watch("start_date");

  const frequencyId = `${idPrefix}-frequency`;
  const dayId = `${idPrefix}-day`;
  const startId = `${idPrefix}-start`;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={frequencyId} required>
          {t("recurring.frequencyLabel")}
        </Label>
        <Controller
          name="frequency"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={RECURRENCE_FREQUENCIES.map((value) => ({
                value,
                label: t(FREQUENCY_LABEL_KEYS[value]),
              }))}
            >
              <SelectTrigger id={frequencyId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRENCE_FREQUENCIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(FREQUENCY_LABEL_KEYS[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {frequency === "monthly" ? (
        <div className="space-y-1.5">
          <Label htmlFor={dayId} required>
            {t("recurring.dayOfMonth")}
          </Label>
          <Input
            id={dayId}
            type="number"
            min={1}
            max={31}
            aria-required="true"
            aria-invalid={!!errors.day_of_month}
            aria-describedby={
              errors.day_of_month ? `${dayId}-hint ${dayId}-error` : `${dayId}-hint`
            }
            {...register("day_of_month", {
              required: t("recurring.dayRequired"),
              min: { value: 1, message: t("recurring.dayRange") },
              max: { value: 31, message: t("recurring.dayRange") },
              valueAsNumber: true,
            })}
          />
          <p id={`${dayId}-hint`} className="text-caption text-ink-dim">
            {t("recurring.dayHint")}
          </p>
          {errors.day_of_month && (
            <p id={`${dayId}-error`} className="text-caption text-over">
              {errors.day_of_month.message}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={startId} required>
            {t("recurring.startDate")}
          </Label>
          <Controller
            name="start_date"
            control={control}
            rules={{
              validate: (value, values) =>
                values.frequency === "monthly" || !!value || t("recurring.startRequired"),
            }}
            render={({ field }) => (
              <DatePicker
                id={startId}
                value={field.value}
                onChange={field.onChange}
                aria-invalid={!!errors.start_date}
              />
            )}
          />
          {startDate && (
            <p className="text-caption text-ink-dim" data-testid={`${startId}-hint`}>
              {t("recurring.startHint", {
                schedule: scheduleLabel(
                  t,
                  { frequency, day_of_month: 1, start_date: startDate },
                  i18n.language
                ),
              })}
            </p>
          )}
          {errors.start_date && (
            <p id={`${startId}-error`} className="text-caption text-over">
              {errors.start_date.message}
            </p>
          )}
        </div>
      )}
    </>
  );
}
