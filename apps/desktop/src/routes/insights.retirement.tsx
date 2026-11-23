import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  FlagIcon,
  InfoIcon,
  LayoutGridIcon,
  PiggyBankIcon,
  TargetIcon,
  TrendingUpIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Money,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricTile } from "@/components/shared/MetricTile";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { RetirementControls } from "@/components/retirement/RetirementControls";
import { RetirementIncomeCard } from "@/components/retirement/RetirementIncomeCard";
import { RetirementMatrix } from "@/components/retirement/RetirementMatrix";
import { RetirementOutlookChart } from "@/components/retirement/RetirementOutlookChart";
import { RetirementSettingsPanel } from "@/components/retirement/RetirementSettingsPanel";
import {
  retirementFocus,
  retirementHeadline,
} from "@/components/retirement/retirement-focus";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { useDirtyTrackedValue } from "@/hooks/useDirtyTrackedValue";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useRetirementSettings } from "@/hooks/useRetirementData";
import {
  autoEstimatedTaxRatePercent,
  computeRetirementMatrix,
  derivedAnchorMonthlyCents,
  horizonsForZoom,
  CURRENT_PACE_TIER_INDEX,
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

/** Above this share of the target, the gap is a nudge rather than a problem. */
const ALMOST_THERE_PERCENT = 85;

function RetirementPage() {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const formatCurrency = useFormatCurrency();
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

  const focus = useMemo(
    () => (matrix && currentAge != null ? retirementFocus(matrix, currentAge) : null),
    [matrix, currentAge],
  );

  // Emptiness is keyed on accounts only, matching the sibling Projection page's pattern — missing
  // expense history alone must never hide the grid (it still renders using $0 base expenses).
  const isEmpty = !isPending && (!input || input.account_balances.length === 0);
  const noExpenseHistory = !!input && input.expense_month_count === 0 && !isEmpty;
  // The nest-egg duration model needs an absolute retirement age (Boundaries: "force the user to
  // enter an age" — no flat-multiplier fallback), so the grid stays hidden until age resolves.
  const needsAge = !isEmpty && !isPending && currentAge == null;

  const headline =
    matrix && focus && input && currentAge != null
      ? retirementHeadline(
          matrix,
          focus,
          isExploring,
          currentAge,
          formatCurrency(input.avg_monthly_expense_cents),
          formatCurrency(matrix.tiersMonthlyCents[CURRENT_PACE_TIER_INDEX] ?? 0),
        )
      : null;

  const readyPercent = focus?.readyPercent ?? null;
  const calloutEyebrow = focus?.achieved
    ? t("retirement.v2.eyebrowOnTrack")
    : readyPercent !== null && readyPercent >= ALMOST_THERE_PERCENT
      ? t("retirement.v2.eyebrowAlmostThere")
      : t("retirement.v2.eyebrowWorthALook");

  return (
    <div>
      <PageHeader
        title={t("nav.retirement")}
        subtitle={
          focus?.achieved
            ? t("surface.subtitle.retirement", { age: focus.age })
            : t("surface.subtitle.retirementNoAge")
        }
      />

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
        <div className="flex flex-col gap-grid-gap">
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
            focus &&
            input &&
            currentAge != null && (
              <>
                <div className="grid gap-grid-gap sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    icon={FlagIcon}
                    label={t("retirement.v2.retireAt")}
                    value={focus.achieved ? focus.age : "\u2014"}
                    caption={
                      focus.achieved
                        ? t("retirement.v2.inYears", { years: focus.years })
                        : t("retirement.v2.notWithinYears", {
                            years: focus.horizonYears,
                          })
                    }
                    data-testid="retirement-metric-age"
                  />
                  <MetricTile
                    icon={WalletIcon}
                    label={t("retirement.anchorLabel")}
                    value={
                      <Money
                        cents={
                          matrix.tiersMonthlyCents[CURRENT_PACE_TIER_INDEX] ?? 0
                        }
                        locale={locale}
                        {...maskProps}
                      />
                    }
                    caption={
                      isExploring
                        ? t("retirement.v2.paceExploring")
                        : t("retirement.v2.paceCurrent")
                    }
                    data-testid="retirement-metric-pace"
                  />
                  <MetricTile
                    icon={TargetIcon}
                    label={t("retirement.v2.nestEggYouNeed")}
                    value={
                      <Money
                        cents={focus.nestEggTodayCents}
                        locale={locale}
                        {...maskProps}
                      />
                    }
                    caption={t("retirement.v2.inTodaysDollars")}
                    data-testid="retirement-metric-nest-egg"
                  />
                  <MetricTile
                    icon={TrendingUpIcon}
                    featured
                    label={t("retirement.v2.projectedAt", { age: focus.age })}
                    value={
                      <Money
                        cents={focus.projectedTodayCents}
                        locale={locale}
                        {...maskProps}
                      />
                    }
                    caption={
                      readyPercent !== null
                        ? t("retirement.v2.shareOfWhatYouNeed", {
                            percent: readyPercent,
                          })
                        : undefined
                    }
                    data-testid="retirement-metric-projected"
                  />
                </div>

                <div className="grid items-start gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <RetirementOutlookChart
                    matrix={matrix}
                    currentAge={currentAge}
                  />

                  <div className="flex flex-col gap-grid-gap">
                    <InsightCallout
                      icon={TargetIcon}
                      eyebrow={calloutEyebrow}
                      title={
                        readyPercent === null
                          ? undefined
                          : focus.achieved
                            ? t("retirement.v2.youAreThere", {
                                age: focus.age,
                              })
                            : t("retirement.v2.youArePartway", {
                                percent: readyPercent,
                              })
                      }
                    >
                      {headline && (
                        <p data-testid="retirement-headline">
                          {t(headline.key, headline.args)}
                        </p>
                      )}
                    </InsightCallout>

                    <RetirementIncomeCard
                      governmentPensionAnnualCents={governmentPensionAnnualCents}
                      gateGovernmentPensionByAge={gateGovernmentPensionByAge}
                      employerPensionAnnualCents={employerPensionAnnualCents}
                      employerPensionStartAge={employerPensionStartAge}
                    />
                  </div>
                </div>

                <Card flush>
                  <CardHeader className="pt-card-pad">
                    <CardTitle icon={LayoutGridIcon}>
                      {t("retirement.v2.matrixTitle")}
                    </CardTitle>
                  </CardHeader>
                  <RetirementControls
                    anchorMonthlyCents={anchorCents}
                    maxAnchorMonthlyCents={maxAnchorMonthlyCents}
                    onAnchorChange={setAnchorCents}
                    onAnchorReset={resetAnchor}
                    isExploring={isExploring}
                    horizonZoom={horizonZoom}
                    onHorizonZoomChange={setHorizonZoom}
                  />
                  <RetirementMatrix
                    matrix={matrix}
                    currentAge={currentAge}
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

          <p className="text-caption text-ink-dim">
            {t("retirement.v2.footnote")}
          </p>
        </div>
      )}
    </div>
  );
}
