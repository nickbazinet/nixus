import { useTranslation } from "react-i18next";
import { Badge } from "@nixus/shared";
import {
  getMaintenanceStatusLabelKey,
  getMaintenanceStatusTone,
} from "@/lib/maintenanceUtils";
import type { MaintenanceTaskStatus } from "@/lib/types";

const BADGE_VARIANT = {
  over: "over",
  caution: "caution",
  good: "good",
  neutral: "neutral",
} as const;

interface MaintenanceStatusBadgeProps {
  status: MaintenanceTaskStatus;
}

export function MaintenanceStatusBadge({ status }: MaintenanceStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      variant={BADGE_VARIANT[getMaintenanceStatusTone(status)]}
      data-testid={`maintenance-task-status-${status}`}
    >
      {t(getMaintenanceStatusLabelKey(status))}
    </Badge>
  );
}
