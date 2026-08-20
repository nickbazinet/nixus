import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button, Card, CardContent } from "@nixus/shared";
import { useCompleteOnboarding } from "@/hooks/useOnboardingStatus";
import { cn } from "@/lib/utils";
import { OnboardingBudgetStep } from "./OnboardingBudgetStep";
import { OnboardingAccountsStep } from "./OnboardingAccountsStep";
import { OnboardingAssetsStep } from "./OnboardingAssetsStep";
import { OnboardingImportStep } from "./OnboardingImportStep";
import { OnboardingIncomeStep } from "./OnboardingIncomeStep";

const STEPS = [
  { labelKey: "onboarding.stepBudget", key: "budget" },
  { labelKey: "onboarding.stepAccounts", key: "accounts" },
  { labelKey: "onboarding.stepAssets", key: "assets" },
  { labelKey: "onboarding.stepIncome", key: "income" },
  { labelKey: "onboarding.stepImport", key: "import" },
] as const;

const LIMITS = [
  { titleKey: "onboarding.limitLocal", bodyKey: "onboarding.limitLocalBody" },
  { titleKey: "onboarding.limitNoBank", bodyKey: "onboarding.limitNoBankBody" },
  { titleKey: "onboarding.limitReminders", bodyKey: "onboarding.limitRemindersBody" },
  { titleKey: "onboarding.limitEarly", bodyKey: "onboarding.limitEarlyBody" },
];

export function OnboardingWizard() {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const navigate = useNavigate();
  const completeOnboarding = useCompleteOnboarding();

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === STEPS.length - 1;
  const stepProgressLabel = t("onboarding.stepsProgress", {
    current: currentStep + 1,
    total: STEPS.length,
  });

  const handleNext = () => {
    if (!isLastStep) setCurrentStep(currentStep + 1);
    else navigate({ to: "/" });
  };

  const exitToDashboard = async () => {
    try {
      await completeOnboarding.mutateAsync();
    } catch {
      toast.error(t("toast.saveFailed"));
      return;
    }
    navigate({ to: "/" });
  };

  const handleExit = () => {
    void exitToDashboard();
  };

  return (
    <div className="mx-auto max-w-2xl py-8" data-testid="onboarding-wizard">
      {/* Limitations lead, before anything is asked for: "acknowledge limitations first" is the
        * trust rule this product is positioned on, and nothing here mentions an API key. */}
      {isFirstStep && (
        <div className="mb-section-gap text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-5 block size-10 rounded-xl bg-brand"
          />
          <h1 className="text-h1 text-ink">{t("onboarding.welcome")}</h1>
          <p className="mx-auto mt-2 max-w-prose text-body text-ink-dim">
            {t("onboarding.description")}
          </p>
          <Card className="mt-5 text-left">
            <CardContent>
              <ul className="flex list-none flex-col gap-2.5 p-0">
                {LIMITS.map((limit) => (
                  <li key={limit.titleKey} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong"
                    />
                    <span className="text-caption text-ink-dim">
                      <span className="text-label text-ink">{t(limit.titleKey)}</span>{" "}
                      {t(limit.bodyKey)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Progress only, and a labelled one. The previous indicator rendered role="tab" buttons with
        * no handler, so every step was a dead control announced as an activatable tab; a bare div
        * of pips replaced it but carried no name or value, so it announced nothing at all. */}
      <div
        role="progressbar"
        aria-label={t("onboarding.stepsLabel")}
        aria-valuenow={currentStep + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuetext={stepProgressLabel}
        className="mb-section-gap flex items-center justify-center gap-1.5"
        data-testid="step-indicator"
      >
        {STEPS.map((step, index) => (
          <span
            key={step.key}
            aria-hidden="true"
            data-testid={`step-dot-${step.key}`}
            className={cn(
              "h-1.5 rounded-full transition-all",
              index === currentStep
                ? "w-5 bg-brand"
                : index < currentStep
                  ? "w-1.5 bg-brand-soft"
                  : "w-1.5 bg-line-strong"
            )}
          />
        ))}
        <span aria-hidden="true" className="ml-2 text-caption text-ink-faint">
          {stepProgressLabel}
        </span>
      </div>

      <div data-testid="step-content">
        {currentStep === 0 && <OnboardingBudgetStep />}
        {currentStep === 1 && <OnboardingAccountsStep />}
        {currentStep === 2 && <OnboardingAssetsStep />}
        {currentStep === 3 && <OnboardingIncomeStep />}
        {currentStep === 4 && <OnboardingImportStep />}
      </div>

      <div
        className="mt-section-gap flex items-center justify-between gap-2"
        data-testid="step-navigation"
      >
        <div className="flex items-center gap-2">
          {!isFirstStep && (
            <Button
              variant="outline"
              onClick={() => setCurrentStep(currentStep - 1)}
              data-testid="back-button"
            >
              {t("common.back")}
            </Button>
          )}
          <Button
            variant="link"
            onClick={handleExit}
            disabled={completeOnboarding.isPending}
            aria-disabled={completeOnboarding.isPending || undefined}
            data-testid="skip-onboarding-button"
          >
            {t("onboarding.skipForNow")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {!isFirstStep && !isLastStep && (
            <Button variant="outline" onClick={handleNext} data-testid="skip-button">
              {t("common.skip")}
            </Button>
          )}
          {!isLastStep ? (
            <Button onClick={handleNext} data-testid="next-button">
              {t("common.next")}
            </Button>
          ) : (
            <Button
              onClick={handleExit}
              disabled={completeOnboarding.isPending}
              aria-disabled={completeOnboarding.isPending || undefined}
              data-testid="finish-button"
            >
              {t("common.finish")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
