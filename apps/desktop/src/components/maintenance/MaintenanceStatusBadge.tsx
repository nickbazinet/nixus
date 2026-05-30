import { useTranslation } from "react-i18next";
import { Badge } from "@nixus/shared";
import type { MaintenanceTaskStatus } from "@/lib/types";

function getStatusBadgeConfig(
  status: MaintenanceTaskStatus,
  t: (key: string) => string
) {
  switch (status) {
    case "ok":
      return {
        label: t("maintenance.status.ok"),
        className: "bg-slate-500/10 text-slate-600 border-transparent",
      };
    case "upcoming":
      return {
        label: t("maintenance.status.upcoming"),
        className: "bg-amber-500/10 text-amber-600 border-transparent",
      };
    case "due":
      return {
        label: t("maintenance.status.due"),
        className: "border-amber-500/50 text-amber-600 bg-transparent",
      };
    case "overdue":
      return {
        label: t("maintenance.status.overdue"),
        className: "bg-rose-500/10 text-rose-600 border-transparent",
      };
  }
}

interface MaintenanceStatusBadgeProps {
  status: MaintenanceTaskStatus;
}

export function MaintenanceStatusBadge({ status }: MaintenanceStatusBadgeProps) {
  const { t } = useTranslation();
  const badge = getStatusBadgeConfig(status, t);

  return (
    <Badge
      className={badge.className}
      data-testid={`maintenance-task-status-${status}`}
    >
      {badge.label}
    </Badge>
  );
}
