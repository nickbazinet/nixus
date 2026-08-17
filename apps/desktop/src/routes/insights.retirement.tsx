import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon, PiggyBankIcon, UserIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, EmptyState } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { RetirementMatrix } from "@/components/retirement/RetirementMatrix";
import { RetirementSettingsPanel } from "@/components/retirement/RetirementSettingsPanel";
import { useRetirementSettings } from "@/hooks/useRetirementData";
import { computeRetirementMatrix } from "@/lib/retirement";

export const Route = createFileRoute("/insights/retirement")({
  component: RetirementPage,
});

function RetirementPage() {
  const { t } = useTranslation();
  const {
    input,
    isPending,
    currentAge,
    ageFromProfile,
    pensionAnnualCents,
    pensionIsUnsavedDefault,
    savePension,
    saveAgeOverride,
  } = useRetirementSettings();

  const matrix = useMemo(() => {
    if (!input || currentAge == null) return null;
    return computeRetirementMatrix(input, pensionAnnualCents, currentAge);
  }, [input, pensionAnnualCents, currentAge]);

  // Emptiness is keyed on accounts only, matching the sibling Projection page's pattern — missing
  // expense history alone must never hide the grid (it still renders using $0 base expenses).
  const isEmpty = !isPending && (!input || input.account_balances.length === 0);
  const noExpenseHistory = !!input && input.expense_month_count === 0 && !isEmpty;
  // The nest-egg duration model needs an absolute retirement age (Boundaries: "force the user to
  // enter an age" — no flat-multiplier fallback), so the grid stays hidden until age resolves.
  const needsAge = !isEmpty && !isPending && currentAge == null;

  return (
    <div>
      <PageHeader title={t("nav.retirement")} />

      {isEmpty ? (
        <Card data-testid="retirement-empty">
          <EmptyState
            icon={<PiggyBankIcon />}
            title={t("retirement.emptyTitle")}
            description={t("retirement.emptyDescription")}
            action={
              <Button render={<Link to="/wealth/accounts" />}>
                {t("dashboard.goToAccounts")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-section-gap">
          {noExpenseHistory && (
            <Card flush data-testid="retirement-no-expense-history">
              <Alert variant="caution" icon={<InfoIcon />}>
                <AlertDescription>
                  {t("retirement.noExpenseHistory")}
                </AlertDescription>
              </Alert>
            </Card>
          )}

          {needsAge ? (
            <Card data-testid="retirement-age-required">
              <EmptyState
                icon={<UserIcon />}
                title={t("retirement.ageRequiredTitle")}
                description={t("retirement.ageRequiredDescription")}
              />
            </Card>
          ) : (
            matrix &&
            input &&
            currentAge != null && (
              <Card flush>
                <RetirementMatrix
                  matrix={matrix}
                  currentAge={currentAge}
                  avgMonthlyExpenseCents={input.avg_monthly_expense_cents}
                />
              </Card>
            )
          )}

          <RetirementSettingsPanel
            pensionAnnualCents={pensionAnnualCents}
            pensionIsUnsavedDefault={pensionIsUnsavedDefault}
            onSavePension={savePension}
            currentAge={currentAge}
            ageFromProfile={ageFromProfile}
            onSaveAgeOverride={saveAgeOverride}
          />
        </div>
      )}
    </div>
  );
}
