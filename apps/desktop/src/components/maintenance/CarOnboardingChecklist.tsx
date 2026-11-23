import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Rocket } from "lucide-react";
import { Button, Card, Eyebrow, IconChip, Meter, focusRing } from "@nixus/shared";
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
    // Glass is the one surface that speaks to the user, and getting the garage set up is the only
    // thing this surface asks for while it is unfinished.
    <Card tone="glass" className="gap-0 px-card-pad" data-testid="car-onboarding-checklist">
      <div className="flex flex-wrap items-center gap-4">
        <IconChip icon={Rocket} tone="card" size="lg" />
        <div className="min-w-0 flex-1">
          <Eyebrow>{t("maintenance.onboarding.checklistTitle")}</Eyebrow>
          <p className="mt-1.5 font-display text-h1 text-ink">
            {t("maintenance.onboarding.progressValueText", {
              done: completedCount,
              total: steps.length,
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          data-testid="car-onboarding-dismiss"
        >
          {t("maintenance.onboarding.checklistDismiss")}
        </Button>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Meter
          value={percent}
          label={t("maintenance.onboarding.progressMeterLabel")}
          valueText={t("maintenance.onboarding.progressValueText", {
            done: completedCount,
            total: steps.length,
          })}
          className="bg-card"
        />
        <span className="money shrink-0 text-caption font-semibold text-brand-ink">
          {t("maintenance.onboarding.progressLabel", { percent })}
        </span>
      </div>

      <ul className="mt-4 list-none">
        {steps.map((step) => {
          const content = (
            <>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  step.done
                    ? "border-transparent bg-button-gradient text-brand-on"
                    : "border-line-strong bg-card"
                )}
                aria-hidden="true"
              >
                {step.done && <Check className="size-3.5" strokeWidth={3} />}
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
                <ArrowRight className="size-4 text-brand-ink" aria-hidden="true" />
              )}
            </>
          );

          const rowClass =
            "flex min-h-target-min items-center gap-3 rounded-xl px-2.5 py-2.5";

          return (
            <li key={step.key}>
              {!step.done && step.to && firstVehicleId != null ? (
                <Link
                  to={step.to}
                  search={{ vehicle: firstVehicleId }}
                  className={cn(
                    rowClass,
                    "no-underline transition-colors hover:bg-card",
                    focusRing
                  )}
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
    </Card>
  );
}
