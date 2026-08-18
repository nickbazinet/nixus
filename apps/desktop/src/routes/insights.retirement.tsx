import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon, PiggyBankIcon, UserIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, EmptyState } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { RetirementControls } from "@/components/retirement/RetirementControls";
import { RetirementMatrix } from "@/components/retirement/RetirementMatrix";
import { RetirementSettingsPanel } from "@/components/retirement/RetirementSettingsPanel";
import { useDirtyTrackedValue } from "@/hooks/useDirtyTrackedValue";
import { useRetirementSettings } from "@/hooks/useRetirementData";
import {
  autoEstimatedTaxRatePercent,
  computeRetirementMatrix,
  derivedAnchorMonthlyCents,
  horizonsForZoom,
  DEFAULT_HORIZON_ZOOM,
} from "@/lib/retirement";
import type {
  HorizonZoom,
  RetirementMatrixOptions,
  RetirementPensionInputs,
} from "@/lib/retirement";

export const Route = createFileRoute("/insights/retirement")({
  component: RetirementPage,
});

/**
 * Floor for the slider's upper bound, so a user with no measured surplus still has somewhere to drag
 * to. Above that the range is twice the derived pace, which puts the untouched handle at the exact
 * midpoint: the control reads as "your pace, with room either side" rather than a bar to max out.
 */
const MIN_ANCHOR_RANGE_CENTS = 200_00; // $200

function RetirementPage() {
  const { t } = useTranslation();
  const {
    input,
    isPending,
    currentAge,
    ageFromProfile,
    governmentPensionAnnualCents,
    governmentPensionIsUnsavedDefault,
    gateGovernmentPensionByAge,
    employerPensionAnnualCents,
    employerPensionStartAge,
    taxModel,
    autoEstimateAvailable,
    pensionTaxRateHasOverride,
    saveGovernmentPension,
    saveEmployerPension,
    saveEmployerPensionStartAge,
    savePensionTaxRate,
    clearPensionTaxRate,
    saveAgeOverride,
  } = useRetirementSettings();

  const pension = useMemo<RetirementPensionInputs>(
    () => ({
      governmentPensionAnnualCents,
      employerPensionAnnualCents,
      gateGovernmentPensionByAge,
      employerPensionStartAge,
      taxModel,
    }),
    [
      governmentPensionAnnualCents,
      employerPensionAnnualCents,
      gateGovernmentPensionByAge,
      employerPensionStartAge,
      taxModel,
    ],
  );

  const autoEstimatedRatePercent = useMemo(
    () =>
      input ? autoEstimatedTaxRatePercent(input.avg_monthly_expense_cents * 12) : 0,
    [input],
  );

  // Deliberately ephemeral — a "what if" is a question, not a setting, so neither control persists.
  const [horizonZoom, setHorizonZoom] =
    useState<HorizonZoom>(DEFAULT_HORIZON_ZOOM);
  const derivedAnchorCents = useMemo(
    () => (input ? derivedAnchorMonthlyCents(input) : 0),
    [input],
  );
  // Same dirty-sync contract as RetirementSettingsPanel: the derived anchor only moves when async
  // data settles, never mid-drag, so re-syncing while untouched is what stops the slider from
  // freezing at its first-render 0 — while going dirty on the first user edit stops a late query
  // settle from yanking the handle out from under someone who is mid-exploration.
  const {
    value: anchorCents,
    setValue: setAnchorCents,
    reset: resetAnchor,
  } = useDirtyTrackedValue(derivedAnchorCents);

  // Measured against the derived pace rather than a "touched" flag, so dragging back to your own
  // number returns you to "current pace" instead of stranding the page in a hypothetical it can no
  // longer distinguish from reality.
  const isExploring = anchorCents !== derivedAnchorCents;

  const maxAnchorMonthlyCents = Math.max(
    2 * derivedAnchorCents,
    MIN_ANCHOR_RANGE_CENTS,
  );

  const matrix = useMemo(() => {
    if (!input || currentAge == null) return null;
    const options: RetirementMatrixOptions = {
      anchorMonthlyCents: isExploring ? anchorCents : undefined,
      horizons:
        horizonZoom === DEFAULT_HORIZON_ZOOM
          ? undefined
          : horizonsForZoom(horizonZoom),
    };
    return computeRetirementMatrix(input, pension, currentAge, options);
  }, [input, pension, currentAge, isExploring, anchorCents, horizonZoom]);

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
              <>
                <Card flush>
                  <RetirementControls
                    anchorMonthlyCents={anchorCents}
                    maxAnchorMonthlyCents={maxAnchorMonthlyCents}
                    onAnchorChange={setAnchorCents}
                    onAnchorReset={resetAnchor}
                    isExploring={isExploring}
                    horizonZoom={horizonZoom}
                    onHorizonZoomChange={setHorizonZoom}
                  />
                </Card>

                <Card flush>
                  <RetirementMatrix
                    matrix={matrix}
                    currentAge={currentAge}
                    avgMonthlyExpenseCents={input.avg_monthly_expense_cents}
                    isExploring={isExploring}
                  />
                </Card>
              </>
            )
          )}

          <RetirementSettingsPanel
            governmentPensionAnnualCents={governmentPensionAnnualCents}
            governmentPensionIsUnsavedDefault={governmentPensionIsUnsavedDefault}
            gateGovernmentPensionByAge={gateGovernmentPensionByAge}
            onSaveGovernmentPension={saveGovernmentPension}
            employerPensionAnnualCents={employerPensionAnnualCents}
            onSaveEmployerPension={saveEmployerPension}
            employerPensionStartAge={employerPensionStartAge}
            onSaveEmployerPensionStartAge={saveEmployerPensionStartAge}
            taxModel={taxModel}
            autoEstimateAvailable={autoEstimateAvailable}
            pensionTaxRateHasOverride={pensionTaxRateHasOverride}
            autoEstimatedTaxRatePercent={autoEstimatedRatePercent}
            onSavePensionTaxRate={savePensionTaxRate}
            onUseEstimatedPensionTaxRate={clearPensionTaxRate}
            currentAge={currentAge}
            ageFromProfile={ageFromProfile}
            onSaveAgeOverride={saveAgeOverride}
          />
        </div>
      )}
    </div>
  );
}
