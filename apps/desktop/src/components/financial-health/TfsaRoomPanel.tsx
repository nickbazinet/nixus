import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, SubStat } from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useTfsaAccumulatedLimit } from "@/hooks/useProfile";

export function TfsaRoomPanel() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const { data } = useTfsaAccumulatedLimit();

  // Absence is the designed outcome, not a gap to fill: no skeleton, no empty state, no error text.
  // Rust withholds the figure whenever it cannot be stated honestly — including when the CAD TFSA
  // balance already reaches the accumulated room — and a placeholder would invite an expectation.
  if (!data) return null;

  return (
    <Card data-testid="tfsa-room-panel">
      <CardHeader>
        <CardTitle>{t("profile.tfsaAccumulatedLimit")}</CardTitle>
      </CardHeader>

      <CardContent>
        <SubStat
          // `useFormatCurrency` already returns the masked placeholder when values are hidden, so
          // `masked` stays false — passing it would double-mask.
          value={formatCurrency(data.total_cents)}
          caption={
            <>
              {t("profile.tfsaAccumulatedLimitCaption", {
                year: data.eligible_from_year,
              })}{" "}
              {t("profile.tfsaAccumulatedLimitNote")}
            </>
          }
          data-testid="tfsa-room-panel-figure"
        />
      </CardContent>
    </Card>
  );
}
