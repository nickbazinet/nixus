import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check } from "lucide-react";
import { Card, CardContent } from "@nixus/shared";
import type { VehicleWithTasks } from "@/lib/types";
import { cn } from "@/lib/utils";

const DISMISS_STORAGE_KEY = "car.onboarding.dismissed";

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
    <Card className="shadow-sm rounded-lg" data-testid="car-onboarding-checklist">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-medium text-foreground">
            {t("maintenance.onboarding.checklistTitle")}
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-xs text-primary hover:underline"
            data-testid="car-onboarding-dismiss"
          >
            {t("maintenance.onboarding.checklistDismiss")}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {t("maintenance.onboarding.progressLabel", { percent })}
          </span>
        </div>

        <ul className="divide-y divide-border">
          {steps.map((step) => {
            const content = (
              <>
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                    step.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  )}
                  aria-hidden="true"
                >
                  {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    "flex-1 text-sm",
                    step.done
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  )}
                >
                  {step.label}
                </span>
                {!step.done && step.to && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                )}
              </>
            );

            const rowClass =
              "flex items-center gap-3 py-2.5 first:pt-0 last:pb-0";

            return (
              <li key={step.key}>
                {!step.done && step.to && firstVehicleId != null ? (
                  <Link
                    to={step.to}
                    search={{ vehicle: firstVehicleId }}
                    className={cn(rowClass, "hover:opacity-80")}
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
