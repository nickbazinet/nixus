import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { useServiceHistory } from "@/hooks/useMaintenance";
import {
  formatOdometerKm,
  formatServiceEntryLabel,
} from "@/lib/maintenanceUtils";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

interface ServiceHistoryTableProps {
  vehicleId: number;
  enabled?: boolean;
  className?: string;
  hideTitle?: boolean;
  onLogService?: () => void;
}

export function ServiceHistoryTable({
  vehicleId,
  enabled = true,
  className,
  hideTitle = false,
  onLogService,
}: ServiceHistoryTableProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const { data: entries = [], isLoading } = useServiceHistory(vehicleId, enabled);

  const displayedEntries = showAll ? entries : entries.slice(0, PAGE_SIZE);

  const columnHeads = (
    <TableHeader>
      <TableRow>
        <TableHead>{t("maintenance.history.columns.date")}</TableHead>
        <TableHead>{t("maintenance.history.columns.task")}</TableHead>
        <TableHead numeric>
          {t("maintenance.history.columns.odometer")}
        </TableHead>
        <TableHead>{t("maintenance.history.columns.notes")}</TableHead>
      </TableRow>
    </TableHeader>
  );

  const title = !hideTitle ? (
    <CardHeader className="border-b border-line pb-3">
      <CardTitle>{t("maintenance.history.title")}</CardTitle>
    </CardHeader>
  ) : null;

  if (isLoading) {
    return (
      <Card flush className={cn("pt-card-pad", className)}>
        {title}
        {/* Chrome resolves first — only the cells are skeletons. One row because a first fetch of
            this vehicle's log genuinely cannot know its length; inventing three is what shifts. */}
        <Table>
          {columnHeads}
          <TableBody>
            <TableRow>
              {[0, 1, 2, 3].map((column) => (
                <TableCell key={column}>
                  <Skeleton rows={1} />
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card
        flush
        className={cn("pt-card-pad", className)}
        data-testid="service-history-table"
      >
        {title}
        <EmptyState
          title={t("maintenance.history.empty")}
          description={t("maintenance.history.emptyHelper")}
          action={
            onLogService ? (
              <Button variant="outline" size="sm" onClick={onLogService}>
                {t("maintenance.customService.add")}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <Card
      flush
      className={cn("pt-card-pad", className)}
      data-testid="service-history-table"
    >
      {title}
      <Table>
        {columnHeads}
        <TableBody>
          {displayedEntries.map((entry) => (
            <TableRow
              key={entry.id}
              data-testid={`service-history-row-${entry.id}`}
            >
              <TableCell className="whitespace-nowrap">
                {format(parseISO(entry.service_date), "MMM d")}
              </TableCell>
              <TableCell>{formatServiceEntryLabel(entry, t)}</TableCell>
              <TableCell numeric className="whitespace-nowrap">
                {formatOdometerKm(entry.odometer_km)}
              </TableCell>
              <TableCell
                dim
                className="max-w-[200px] truncate"
                title={entry.notes ?? undefined}
              >
                {entry.notes?.trim() ? entry.notes : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {entries.length > PAGE_SIZE && !showAll && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full rounded-none border-t border-line"
          onClick={() => setShowAll(true)}
        >
          {t("maintenance.history.viewAll")}
        </Button>
      )}
    </Card>
  );
}
