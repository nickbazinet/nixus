import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button } from "@nixus/shared";
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

export function OnboardingWizard() {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const navigate = useNavigate();

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      navigate({ to: "/" });
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    handleNext();
  };

  const handleFinish = () => {
    navigate({ to: "/" });
  };

  return (
    <div className="max-w-3xl mx-auto py-8" data-testid="onboarding-wizard">
      <h1 className="text-2xl font-semibold mb-6 text-center">
        {t("onboarding.welcome")}
      </h1>
      <p className="text-muted-foreground text-center mb-8">
        {t("onboarding.description")}
      </p>

      {/* Step Indicator */}
      <div
        role="tablist"
        aria-label={t("onboarding.stepsLabel")}
        className="flex items-center justify-center gap-2 mb-8"
        data-testid="step-indicator"
      >
        {STEPS.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const label = t(step.labelKey);

          return (
            <div key={step.key} className="flex items-center">
              <button
                role="tab"
                aria-selected={isCurrent}
                aria-label={label}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  isCurrent
                    ? "bg-teal-600 text-white"
                    : isCompleted
                      ? "bg-teal-100 text-teal-700"
                      : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-tab-${step.key}`}
              >
                {isCompleted ? (
                  <Check className="size-4" />
                ) : (
                  <span className="size-5 flex items-center justify-center rounded-full bg-white/20 text-xs">
                    {index + 1}
                  </span>
                )}
                {label}
              </button>
              {index < STEPS.length - 1 && (
                <div
                  className={`w-8 h-0.5 mx-1 ${
                    index < currentStep ? "bg-teal-400" : "bg-muted"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div role="tabpanel" aria-label={t(STEPS[currentStep].labelKey)} data-testid="step-content">
        {currentStep === 0 && <OnboardingBudgetStep />}
        {currentStep === 1 && <OnboardingAccountsStep />}
        {currentStep === 2 && <OnboardingAssetsStep />}
        {currentStep === 3 && <OnboardingIncomeStep />}
        {currentStep === 4 && <OnboardingImportStep />}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between mt-8" data-testid="step-navigation">
        <div>
          {currentStep > 0 && (
            <Button variant="ghost" onClick={handleBack} data-testid="back-button">
              {t("common.back")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {currentStep > 0 && currentStep < STEPS.length - 1 && (
            <Button variant="ghost" onClick={handleSkip} data-testid="skip-button">
              {t("common.skip")}
            </Button>
          )}
          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext} data-testid="next-button">
              {t("common.next")}
            </Button>
          ) : (
            <Button onClick={handleFinish} data-testid="finish-button">
              {t("common.finish")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
