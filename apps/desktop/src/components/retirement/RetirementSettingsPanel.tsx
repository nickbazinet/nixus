import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";

interface RetirementSettingsPanelProps {
  pensionAnnualCents: number;
  pensionIsUnsavedDefault: boolean;
  onSavePension: (cents: number) => void;
  currentAge: number | null;
  ageFromProfile: boolean;
  onSaveAgeOverride: (years: number) => void;
}

export function RetirementSettingsPanel({
  pensionAnnualCents,
  pensionIsUnsavedDefault,
  onSavePension,
  currentAge,
  ageFromProfile,
  onSaveAgeOverride,
}: RetirementSettingsPanelProps) {
  const { t } = useTranslation();
  const [pensionDraft, setPensionDraft] = useState(pensionAnnualCents);
  const [pensionDirty, setPensionDirty] = useState(false);
  const [ageDraft, setAgeDraft] = useState<number | "">(currentAge ?? "");
  const [ageDirty, setAgeDirty] = useState(false);

  // pensionAnnualCents/currentAge only change from async data resolving (query settle, CA-default
  // reveal, save round-trip) — never mid-keystroke — so re-syncing on change is safe and is what
  // fixes the field staying frozen at its very-first-render value (usually 0/unset).
  useEffect(() => {
    if (!pensionDirty) setPensionDraft(pensionAnnualCents);
  }, [pensionAnnualCents, pensionDirty]);

  useEffect(() => {
    if (!ageDirty) setAgeDraft(currentAge ?? "");
  }, [currentAge, ageDirty]);

  return (
    <Card flush>
      <CardHeader className="pt-card-pad">
        <CardTitle>{t("retirement.settingsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-card-pad">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retirement-pension">
            {t("retirement.pensionLabel")}
          </Label>
          <MoneyInput
            id="retirement-pension"
            value={pensionDraft}
            onChange={(cents) => {
              setPensionDraft(cents);
              setPensionDirty(true);
            }}
            onBlur={() => {
              if (pensionDirty) {
                onSavePension(pensionDraft);
                setPensionDirty(false);
              }
            }}
          />
          <p className="text-caption text-ink-faint">
            {t("retirement.pensionDisclaimer")}
          </p>
          {pensionIsUnsavedDefault && (
            <p className="text-caption text-ink-faint">
              {t("retirement.pensionCaDefaultNote")}
            </p>
          )}
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
