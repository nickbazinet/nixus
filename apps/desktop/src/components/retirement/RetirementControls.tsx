import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcwIcon } from "lucide-react";
import { Button, PillTabs, Slider } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { ANCHOR_STEP_CENTS, HORIZON_ZOOMS } from "@/lib/retirement";
import type { HorizonZoom } from "@/lib/retirement";

const HORIZON_ZOOM_LABEL_KEYS: Record<HorizonZoom, string> = {
  "6y": "retirement.horizonNext6",
  "12y": "retirement.horizonNext12",
  "30y": "retirement.horizonNext30",
};

interface RetirementControlsProps {
  anchorMonthlyCents: number;
  /** Upper bound of the slider. Derived by the route so it tracks the user's own surplus. */
  maxAnchorMonthlyCents: number;
  onAnchorChange: (cents: number) => void;
  /** Only shown when the anchor differs from the derived pace — nothing to reset otherwise. */
  onAnchorReset: () => void;
  isExploring: boolean;
  horizonZoom: HorizonZoom;
  onHorizonZoomChange: (zoom: HorizonZoom) => void;
}

export function RetirementControls({
  anchorMonthlyCents,
  maxAnchorMonthlyCents,
  onAnchorChange,
  onAnchorReset,
  isExploring,
  horizonZoom,
  onHorizonZoomChange,
}: RetirementControlsProps) {
  const { t } = useTranslation();
  const { hidden } = useValuesHidden();
  const formatCurrency = useFormatCurrency();

  const horizonLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(HORIZON_ZOOM_LABEL_KEYS).map(([zoom, key]) => [
          zoom,
          t(key),
        ]),
      ) as Record<HorizonZoom, string>,
    [t],
  );

  const anchorLabel = t("retirement.anchorLabel");

  // The visible readout masks to bullets, but a screen reader cannot read bullets — under privacy
  // the thumb announces the translated "Amount hidden" instead, matching how every other masked
  // figure in the product names itself. Dragging still works either way.
  const anchorValueText = hidden
    ? t("common.amountHidden")
    : formatCurrency(anchorMonthlyCents);

  return (
    <div
      className="flex flex-col gap-4 p-card-pad sm:flex-row sm:items-end sm:justify-between sm:gap-6"
      data-testid="retirement-controls"
    >
      <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-96 sm:flex-1">
        {/* min-h-target-min is the reset chip's own height, reserved whether or not the chip is
            showing. Without it the row grows the moment the chip appears, nudging the whole
            live-recomputing grid down on the user's very first drag. */}
        <div
          className="flex min-h-target-min items-center justify-between gap-2"
          data-testid="retirement-anchor-header"
        >
          <span className="truncate text-label text-ink-dim">{anchorLabel}</span>
          {/* shrink-0 so the reset chip appearing truncates the label rather than reflowing the row
              onto a second line, which would shift the grid for the same reason. */}
          <div className="flex shrink-0 items-center gap-1">
            <span
              className="money text-label text-ink"
              data-testid="retirement-anchor-readout"
            >
              {formatCurrency(anchorMonthlyCents)}
            </span>
            {isExploring && (
              <Button
                variant="ghost"
                size="xs"
                onClick={onAnchorReset}
                data-testid="retirement-anchor-reset"
              >
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                {t("retirement.anchorReset")}
              </Button>
            )}
          </div>
        </div>
        <Slider
          label={anchorLabel}
          valueText={anchorValueText}
          value={anchorMonthlyCents}
          onValueChange={onAnchorChange}
          min={0}
          max={maxAnchorMonthlyCents}
          step={ANCHOR_STEP_CENTS}
          largeStep={ANCHOR_STEP_CENTS * 5}
          data-testid="retirement-anchor-slider"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-label text-ink-dim">
          {t("retirement.horizonLabel")}
        </span>
        <PillTabs
          options={HORIZON_ZOOMS}
          labels={horizonLabels}
          value={horizonZoom}
          onChange={onHorizonZoomChange}
          data-testid="retirement-horizon-tabs"
        />
      </div>
    </div>
  );
}
