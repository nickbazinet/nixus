import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcwIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import type { RetirementTaxModel } from "@/lib/retirement";

const PENSION_TAX_RATE_INPUT_ID = "retirement-pension-tax-rate";
const PENSION_TAX_RATE_BADGE_ID = "retirement-pension-tax-rate-badge";
const PENSION_TAX_RATE_NOTE_ID = "retirement-pension-tax-rate-note";

interface RetirementSettingsPanelProps {
  governmentPensionAnnualCents: number;
  governmentPensionIsUnsavedDefault: boolean;
  gateGovernmentPensionByAge: boolean;
  onSaveGovernmentPension: (cents: number) => void;
  employerPensionAnnualCents: number;
  onSaveEmployerPension: (cents: number) => void;
  employerPensionStartAge: number;
  onSaveEmployerPensionStartAge: (years: number) => void;
  taxModel: RetirementTaxModel;
  /**
   * Whether an estimate exists to offer at all. False silences every estimate affordance and word of
   * estimate language, because clearing an override then lands on a flat 0% — a default, not an
   * estimate.
   */
  autoEstimateAvailable: boolean;
  /** Drives the "use our estimate" action — there is nothing to replace without an override. */
  pensionTaxRateHasOverride: boolean;
  autoEstimatedTaxRatePercent: number;
  onSavePensionTaxRate: (percent: number) => void;
  onUseEstimatedPensionTaxRate: () => void;
  currentAge: number | null;
  ageFromProfile: boolean;
  onSaveAgeOverride: (years: number) => void;
}

export function RetirementSettingsPanel({
  governmentPensionAnnualCents,
  governmentPensionIsUnsavedDefault,
  gateGovernmentPensionByAge,
  onSaveGovernmentPension,
  employerPensionAnnualCents,
  onSaveEmployerPension,
  employerPensionStartAge,
  onSaveEmployerPensionStartAge,
  taxModel,
  autoEstimateAvailable,
  pensionTaxRateHasOverride,
  autoEstimatedTaxRatePercent,
  onSavePensionTaxRate,
  onUseEstimatedPensionTaxRate,
  currentAge,
  ageFromProfile,
  onSaveAgeOverride,
}: RetirementSettingsPanelProps) {
  const { t } = useTranslation();
  // Auto mode leaves the field genuinely empty rather than showing 0: a 0 there would read as "no
  // tax applied", which is the opposite of what auto mode is doing.
  const pensionTaxRateFieldValue: number | "" =
    taxModel.kind === "manual" ? taxModel.ratePercent : "";
  // Rounded once here so the placeholder, button label, caption and zero test all speak about the
  // same number the user can read on screen — rounding per use site lets a 0.4% estimate show "0"
  // while the zero check still reads false.
  const estimatedRatePercent = Math.round(autoEstimatedTaxRatePercent);
  const estimateInUse = taxModel.kind === "auto";
  const rateInEffectPercent = estimateInUse
    ? estimatedRatePercent
    : taxModel.ratePercent;
  // Outranks the estimate badge: a 0% in effect is worth flagging in every country, because it
  // silently projects untaxed retirement income.
  const showZeroBadge = rateInEffectPercent === 0;
  const showEstimateBadge = estimateInUse && !showZeroBadge;
  const showEstimateButton = autoEstimateAvailable && pensionTaxRateHasOverride;
  const [governmentPensionDraft, setGovernmentPensionDraft] = useState(
    governmentPensionAnnualCents,
  );
  const [governmentPensionDirty, setGovernmentPensionDirty] = useState(false);
  const [employerPensionDraft, setEmployerPensionDraft] = useState(
    employerPensionAnnualCents,
  );
  const [employerPensionDirty, setEmployerPensionDirty] = useState(false);
  const [employerPensionStartAgeDraft, setEmployerPensionStartAgeDraft] =
    useState<number | "">(employerPensionStartAge);
  const [employerPensionStartAgeDirty, setEmployerPensionStartAgeDirty] =
    useState(false);
  const [pensionTaxRateDraft, setPensionTaxRateDraft] = useState<number | "">(
    pensionTaxRateFieldValue,
  );
  const [pensionTaxRateDirty, setPensionTaxRateDirty] = useState(false);
  const pensionTaxRateInputRef = useRef<HTMLInputElement>(null);
  const [ageDraft, setAgeDraft] = useState<number | "">(currentAge ?? "");
  const [ageDirty, setAgeDirty] = useState(false);

  // The pension amounts/currentAge only change from async data resolving (query settle, CA-default
  // reveal, save round-trip) — never mid-keystroke — so re-syncing on change is safe and is what
  // fixes the field staying frozen at its very-first-render value (usually 0/unset).
  useEffect(() => {
    if (!governmentPensionDirty)
      setGovernmentPensionDraft(governmentPensionAnnualCents);
  }, [governmentPensionAnnualCents, governmentPensionDirty]);

  useEffect(() => {
    if (!employerPensionDirty)
      setEmployerPensionDraft(employerPensionAnnualCents);
  }, [employerPensionAnnualCents, employerPensionDirty]);

  useEffect(() => {
    if (!employerPensionStartAgeDirty)
      setEmployerPensionStartAgeDraft(employerPensionStartAge);
  }, [employerPensionStartAge, employerPensionStartAgeDirty]);

  useEffect(() => {
    if (!pensionTaxRateDirty) setPensionTaxRateDraft(pensionTaxRateFieldValue);
  }, [pensionTaxRateFieldValue, pensionTaxRateDirty]);

  useEffect(() => {
    if (!ageDirty) setAgeDraft(currentAge ?? "");
  }, [currentAge, ageDirty]);

  // Handing the field back to the resolved model, so a half-typed or out-of-range draft cannot
  // survive the clear and contradict the badge beside it.
  function applyEstimatedPensionTaxRate() {
    onUseEstimatedPensionTaxRate();
    setPensionTaxRateDirty(false);
  }

  return (
    <Card flush>
      <CardHeader className="pt-card-pad">
        <CardTitle>{t("retirement.settingsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-card-pad">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retirement-government-pension">
            {t("retirement.governmentPensionLabel")}
          </Label>
          <MoneyInput
            id="retirement-government-pension"
            value={governmentPensionDraft}
            onChange={(cents) => {
              setGovernmentPensionDraft(cents);
              setGovernmentPensionDirty(true);
            }}
            onBlur={() => {
              if (governmentPensionDirty) {
                onSaveGovernmentPension(governmentPensionDraft);
                setGovernmentPensionDirty(false);
              }
            }}
          />
          <p className="text-caption text-ink-faint">
            {t("retirement.governmentPensionDisclaimer")}
          </p>
          {gateGovernmentPensionByAge && (
            <p className="text-caption text-ink-faint">
              {t("retirement.governmentPensionAgeGateNote")}
            </p>
          )}
          {governmentPensionIsUnsavedDefault && (
            <p className="text-caption text-ink-faint">
              {t("retirement.governmentPensionCaDefaultNote")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retirement-employer-pension">
            {t("retirement.employerPensionLabel")}
          </Label>
          <MoneyInput
            id="retirement-employer-pension"
            value={employerPensionDraft}
            onChange={(cents) => {
              setEmployerPensionDraft(cents);
              setEmployerPensionDirty(true);
            }}
            onBlur={() => {
              if (employerPensionDirty) {
                onSaveEmployerPension(employerPensionDraft);
                setEmployerPensionDirty(false);
              }
            }}
          />
          <p className="text-caption text-ink-faint">
            {t("retirement.employerPensionDisclaimer")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retirement-employer-pension-start-age">
            {t("retirement.employerPensionStartAgeLabel")}
          </Label>
          <Input
            id="retirement-employer-pension-start-age"
            type="number"
            min={18}
            max={100}
            value={employerPensionStartAgeDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setEmployerPensionStartAgeDraft(raw === "" ? "" : Number(raw));
              setEmployerPensionStartAgeDirty(true);
            }}
            onBlur={() => {
              if (
                employerPensionStartAgeDirty &&
                typeof employerPensionStartAgeDraft === "number" &&
                employerPensionStartAgeDraft >= 18 &&
                employerPensionStartAgeDraft <= 100
              ) {
                onSaveEmployerPensionStartAge(employerPensionStartAgeDraft);
                setEmployerPensionStartAgeDirty(false);
              }
            }}
            className="max-w-32"
          />
          <p className="text-caption text-ink-faint">
            {t("retirement.employerPensionStartAgeNote")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={PENSION_TAX_RATE_INPUT_ID}>
            {t("retirement.pensionTaxRateLabel")}
          </Label>
          {/* The input's own min-h-target-min pins this row's height, so a badge or button
              appearing never reflows the panel under the user's cursor. */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={PENSION_TAX_RATE_INPUT_ID}
              ref={pensionTaxRateInputRef}
              type="number"
              min={0}
              max={100}
              value={pensionTaxRateDraft}
              placeholder={
                estimateInUse ? String(estimatedRatePercent) : undefined
              }
              aria-describedby={
                showZeroBadge || showEstimateBadge
                  ? `${PENSION_TAX_RATE_BADGE_ID} ${PENSION_TAX_RATE_NOTE_ID}`
                  : PENSION_TAX_RATE_NOTE_ID
              }
              onChange={(e) => {
                const raw = e.target.value;
                setPensionTaxRateDraft(raw === "" ? "" : Number(raw));
                setPensionTaxRateDirty(true);
              }}
              onBlur={() => {
                if (!pensionTaxRateDirty) return;
                // Emptying the field used to be a dead end — nothing committed, draft left dirty,
                // field stuck blank forever. Where an estimate can take over it now means the same
                // as asking for the estimate; elsewhere it means "never mind", restoring the saved
                // rate rather than silently committing 0.
                if (pensionTaxRateDraft === "") {
                  if (showEstimateButton) applyEstimatedPensionTaxRate();
                  else {
                    setPensionTaxRateDraft(pensionTaxRateFieldValue);
                    setPensionTaxRateDirty(false);
                  }
                  return;
                }
                if (pensionTaxRateDraft >= 0 && pensionTaxRateDraft <= 100) {
                  onSavePensionTaxRate(pensionTaxRateDraft);
                  setPensionTaxRateDirty(false);
                }
              }}
              className="max-w-32"
            />
            {(showZeroBadge || showEstimateBadge) && (
              <Badge
                id={PENSION_TAX_RATE_BADGE_ID}
                variant={showZeroBadge ? "caution" : "neutral"}
                data-testid="retirement-pension-tax-rate-badge"
              >
                {showZeroBadge
                  ? t("retirement.pensionTaxRateZeroBadge")
                  : t("retirement.pensionTaxRateAutoBadge")}
              </Badge>
            )}
            {showEstimateButton && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  applyEstimatedPensionTaxRate();
                  // Without this, focus lands on <body> the moment this button unmounts.
                  pensionTaxRateInputRef.current?.focus();
                }}
                data-testid="retirement-pension-tax-rate-use-estimate"
              >
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                {t("retirement.pensionTaxRateUseEstimate", {
                  rate: estimatedRatePercent,
                })}
              </Button>
            )}
          </div>
          <p
            id={PENSION_TAX_RATE_NOTE_ID}
            className="text-caption text-ink-faint"
            aria-live="polite"
          >
            {showZeroBadge
              ? t("retirement.pensionTaxRateZeroNote")
              : estimateInUse
                ? t("retirement.pensionTaxRateAutoNote", {
                    rate: estimatedRatePercent,
                  })
                : t("retirement.pensionTaxRateNote")}
          </p>
        </div>

        {!ageFromProfile && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retirement-age">{t("retirement.ageLabel")}</Label>
            <Input
              id="retirement-age"
              type="number"
              min={18}
              max={100}
              value={ageDraft}
              onChange={(e) => {
                const raw = e.target.value;
                setAgeDraft(raw === "" ? "" : Number(raw));
                setAgeDirty(true);
              }}
              onBlur={() => {
                if (ageDirty && typeof ageDraft === "number" && ageDraft >= 18 && ageDraft <= 100) {
                  onSaveAgeOverride(ageDraft);
                  setAgeDirty(false);
                }
              }}
              className="max-w-32"
            />
            <p className="text-caption text-ink-faint">
              {t("retirement.ageManualNote")}
            </p>
          </div>
        )}

        {ageFromProfile && (
          <p className="text-caption text-ink-faint">
            {t("retirement.ageFromProfileNote", { age: currentAge })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
