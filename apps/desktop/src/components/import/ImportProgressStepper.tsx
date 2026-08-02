import { useEffect, useState } from "react";
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

/** Past this, a user with no other loading affordance concludes the app froze and force-quits. */
const SLOW_AFTER_MS = 15_000;

interface ImportProgressStepperProps {
  currentStage: ImportStage;
  message?: string | null;
}

export function ImportProgressStepper({
  currentStage,
  message,
}: ImportProgressStepperProps) {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  const currentIndex = STAGE_KEYS.findIndex((s) => s.key === currentStage);
  const activeIndex = currentIndex < 0 ? 0 : currentIndex;
  const stageLabel = t(STAGE_KEYS[activeIndex].labelKey);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="progressbar"
      aria-valuenow={activeIndex + 1}
      aria-valuemin={1}
      aria-valuemax={STAGE_KEYS.length}
      aria-valuetext={stageLabel}
      aria-label={t("import.progressLabel", {
        current: activeIndex + 1,
        total: STAGE_KEYS.length,
        stage: stageLabel,
      })}
      data-testid="import-progress-stepper"
    >
      <ol className="flex list-none items-start justify-center gap-1 p-0">
        {STAGE_KEYS.map((stage, index) => {
          const isDone = index < activeIndex || currentStage === "done";
          const isCurrent = index === activeIndex && currentStage !== "done";
          const label = t(stage.labelKey);
          const state = isDone
            ? t("import.statusComplete")
            : isCurrent
              ? t("import.statusInProgress")
              : t("import.statusPending");

          return (
            <li key={stage.key} className="flex items-start">
              <span className="flex w-24 flex-col items-center gap-1.5">
                <span
                  data-testid={`stage-${stage.key}`}
                  aria-label={`${label}: ${state}`}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full transition-colors",
                    isDone && "bg-good-bg text-good-ink",
                    isCurrent && "bg-brand-soft text-brand-ink",
                    !isDone && !isCurrent && "bg-track text-ink-faint"
                  )}
                >
                  {isDone ? (
                    <Check className="size-5" aria-hidden="true" />
                  ) : isCurrent ? (
                    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Circle className="size-5" aria-hidden="true" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-center text-caption",
                    isDone || isCurrent ? "text-ink" : "text-ink-faint"
                  )}
                >
                  {label}
                </span>
              </span>
              {index < STAGE_KEYS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-5 h-px w-6 shrink-0",
                    isDone ? "bg-good" : "bg-line-strong"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Stage level, never per-tick: this region carries the stage name alone, so the Tauri
        * progress messages rendered below can change freely without a screen-reader firehose. */}
      <p aria-live="polite" className="sr-only">
        {stageLabel}
      </p>

      {message && (
        <p
          className="mt-4 text-center text-caption text-ink-dim"
          data-testid="import-message"
        >
          {message}
        </p>
      )}

      {slow && currentStage !== "done" && (
        <p
          className="mt-2 text-center text-caption text-ink-dim"
          data-testid="import-slow-notice"
        >
          {t("import.stillWorking")}
        </p>
      )}
    </div>
  );
}
