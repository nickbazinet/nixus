import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check } from "lucide-react";
import { Button, Card, CardContent, Meter, focusRing } from "@nixus/shared";
import type { VehicleWithTasks } from "@/lib/types";
import { CAR_ONBOARDING_DISMISSED_KEY } from "@/lib/datasetSwitch";
import { cn } from "@/lib/utils";

const DISMISS_STORAGE_KEY = CAR_ONBOARDING_DISMISSED_KEY;

interface CarOnboardingChecklistProps {
  vehicles: VehicleWithTasks[];
}

export function CarOnboardingChecklist({
  vehicles,
}: CarOnboardingChecklistProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const firstVehicleId = vehicles[0]?.vehicle.id;

  const steps = useMemo(() => {
    const hasSchedule = vehicles.some((v) => v.tasks.length > 0);
    const hasLoggedService = vehicles.some((v) =>
      v.tasks.some((task) => task.last_service_date != null)
    );

    return [
      {
        key: "addCar",
        label: t("maintenance.onboarding.checkAddCar"),
        done: vehicles.length > 0,
        to: undefined as string | undefined,
      },
      {
        key: "reviewSchedule",
        label: t("maintenance.onboarding.checkReviewSchedule"),
        done: hasSchedule,
        to: "/car/garage",
      },
      {
        key: "logService",
        label: t("maintenance.onboarding.checkLogService"),
        done: hasLoggedService,
        to: "/car/garage",
      },
    ];
  }, [vehicles, t]);

  const completedCount = steps.filter((step) => step.done).length;
  const percent = Math.round((completedCount / steps.length) * 100);
  const allComplete = completedCount === steps.length;

  if (dismissed || allComplete) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
    setDismissed(true);
  };

  return (
    <Card data-testid="car-onboarding-checklist">
      <CardContent>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-h3 text-ink">
            {t("maintenance.onboarding.checklistTitle")}
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={handleDismiss}
            data-testid="car-onboarding-dismiss"
          >
            {t("maintenance.onboarding.checklistDismiss")}
          </Button>
        </div>

        <div className="mb-3 flex items-center gap-3">
          <Meter
            value={percent}
            label={t("maintenance.onboarding.progressMeterLabel")}
            valueText={t("maintenance.onboarding.progressValueText", {
              done: completedCount,
              total: steps.length,
            })}
          />
          <span className="money shrink-0 text-caption text-ink-dim">
            {t("maintenance.onboarding.progressLabel", { percent })}
          </span>
        </div>

        <ul className="divide-y divide-line">
          {steps.map((step) => {
            const content = (
              <>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    step.done
                      ? "border-brand bg-brand text-brand-on"
                      : "border-line-strong"
                  )}
                  aria-hidden="true"
                >
                  {step.done && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    "flex-1 text-body",
                    step.done ? "text-ink-dim line-through" : "text-ink"
                  )}
                >
                  {step.label}
                </span>
                {!step.done && step.to && (
                  <ArrowRight
                    className="size-4 text-ink-faint"
                    aria-hidden="true"
                  />
                )}
              </>
            );

            const rowClass =
              "flex min-h-target-min items-center gap-3 py-2.5 first:pt-0 last:pb-0";

            return (
              <li key={step.key}>
                {!step.done && step.to && firstVehicleId != null ? (
                  <Link
                    to={step.to}
                    search={{ vehicle: firstVehicleId }}
                    className={cn(rowClass, "no-underline hover:bg-hover", focusRing)}
                    data-testid={`car-onboarding-step-${step.key}`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    className={rowClass}
                    data-testid={`car-onboarding-step-${step.key}`}
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
