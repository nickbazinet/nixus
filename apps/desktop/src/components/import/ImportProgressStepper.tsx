import { useTranslation } from "react-i18next";
import { Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImportStage =
  | "uploading"
  | "extracting"
  | "categorizing"
  | "done";

const STAGE_KEYS: { key: ImportStage; labelKey: string }[] = [
  { key: "uploading", labelKey: "import.stepUploading" },
  { key: "extracting", labelKey: "import.stepExtracting" },
  { key: "categorizing", labelKey: "import.stepCategorizing" },
  { key: "done", labelKey: "import.stepDone" },
];

interface ImportProgressStepperProps {
  currentStage: ImportStage;
  message?: string | null;
}

export function ImportProgressStepper({
  currentStage,
  message,
}: ImportProgressStepperProps) {
  const { t } = useTranslation();
  const currentIndex = STAGE_KEYS.findIndex((s) => s.key === currentStage);

  return (
    <div
      role="progressbar"
      aria-valuenow={currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={4}
      aria-label={`Import progress: ${t(STAGE_KEYS[currentIndex]?.labelKey ?? "")}`}
      aria-live="polite"
      data-testid="import-progress-stepper"
    >
      <div className="flex items-center justify-center gap-2">
        {STAGE_KEYS.map((stage, index) => {
          const isDone = index < currentIndex || currentStage === "done";
          const isCurrent = index === currentIndex && currentStage !== "done";
          const label = t(stage.labelKey);

          return (
            <div key={stage.key} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  data-testid={`stage-${stage.key}`}
                  aria-label={`${label}: ${isDone ? t("import.statusComplete") : isCurrent ? t("import.statusInProgress") : t("import.statusPending")}`}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                    isDone && "bg-emerald-500/20 text-emerald-500",
                    isCurrent && "bg-teal-500/20 text-teal-500",
                    !isDone && !isCurrent && "bg-muted text-muted-foreground"
                  )}
                >
                  {isDone ? (
                    <Check className="h-5 w-5" />
                  ) : isCurrent ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    isDone && "text-emerald-500",
                    isCurrent && "text-teal-500",
                    !isDone && !isCurrent && "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
              {index < STAGE_KEYS.length - 1 && (
                <div
                  className={cn(
                    "mb-5 h-0.5 w-12",
                    index < currentIndex || currentStage === "done"
                      ? "bg-emerald-500/50"
                      : "bg-muted"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      {message && (
        <p className="mt-4 text-center text-sm text-muted-foreground" data-testid="import-message">
          {message}
        </p>
      )}
    </div>
  );
}
