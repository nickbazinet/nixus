import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nixus/shared";
import { useServiceHistory } from "@/hooks/useMaintenance";
import { formatServiceEntryLabel } from "@/lib/maintenanceUtils";

interface ServiceHistoryTableProps {
  vehicleId: number;
  enabled?: boolean;
  className?: string;
  hideTitle?: boolean;
}

export function ServiceHistoryTable({
  vehicleId,
  enabled = true,
  className,
  hideTitle = false,
}: ServiceHistoryTableProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const { data: entries = [], isLoading } = useServiceHistory(vehicleId, enabled);

  const displayedEntries = showAll ? entries : entries.slice(0, 10);

  if (isLoading) {
    return (
      <Card className={`shadow-sm rounded-lg ${className ?? ""}`}>
        <CardContent className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted animate-pulse rounded" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className={`px-4 py-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
        data-testid="service-history-table"
      >
        {t("maintenance.history.empty")}
      </div>
    );
  }

  return (
    <Card className={`shadow-sm rounded-lg ${className ?? ""}`} data-testid="service-history-table">
      {!hideTitle && (
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            {t("maintenance.history.title")}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={hideTitle ? "p-4" : "p-4 pt-0"}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">
                  {t("maintenance.history.columns.date")}
                </th>
                <th className="pb-2 pr-3 font-medium">
                  {t("maintenance.history.columns.task")}
                </th>
                <th className="pb-2 pr-3 font-medium">
                  {t("maintenance.history.columns.odometer")}
                </th>
                <th className="pb-2 font-medium">
                  {t("maintenance.history.columns.notes")}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedEntries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-border/50 last:border-0"
                  data-testid={`service-history-row-${entry.id}`}
                >
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {format(parseISO(entry.service_date), "MMM d")}
                  </td>
                  <td className="py-2 pr-3">
                    {formatServiceEntryLabel(entry, t)}
                  </td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">
                    {entry.odometer_km.toLocaleString()} km
                  </td>
                  <td
                    className="py-2 truncate max-w-[200px] text-muted-foreground"
                    title={entry.notes ?? undefined}
                  >
                    {entry.notes?.trim() ? entry.notes : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length > 10 && !showAll && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setShowAll(true)}
          >
            {t("maintenance.history.viewAll")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
