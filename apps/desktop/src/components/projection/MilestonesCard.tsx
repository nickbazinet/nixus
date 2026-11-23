import { useTranslation } from "react-i18next";
import { FlagIcon, TrophyIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  IconChip,
  Money,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import type { ProjectionMilestone } from "./milestones";

/**
 * The round numbers ahead of you inside this horizon, and the year each one lands. Nothing renders
 * when the window crosses none — an empty "Milestones" card would imply there are none at all.
 */
export function MilestonesCard({
  milestones,
}: {
  milestones: readonly ProjectionMilestone[];
}) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  if (milestones.length === 0) return null;

  return (
    <Card data-testid="projection-milestones">
      <CardHeader>
        <CardTitle icon={FlagIcon}>
          {t("insights.v2.milestonesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          {milestones.map((milestone) => (
            <li
              key={milestone.thresholdCents}
              className="flex items-center gap-3 border-b border-line py-3.5 last:border-b-0"
            >
              <IconChip icon={TrophyIcon} size="sm" />
              <div className="min-w-0 flex-1">
                <Money
                  cents={milestone.thresholdCents}
                  locale={locale}
                  className="font-bold text-ink"
                  {...maskProps}
                />
                <p className="text-caption text-ink-dim">
                  {t("projection.projectedNetWorth")}
                </p>
              </div>
              <Badge variant="brand">{milestone.year}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
