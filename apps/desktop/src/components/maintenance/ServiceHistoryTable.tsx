import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  SlideOver,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { DeleteServiceLogDialog } from "@/components/maintenance/DeleteServiceLogDialog";
import { EditServiceLogForm } from "@/components/maintenance/EditServiceLogForm";
import { useServiceHistory } from "@/hooks/useServiceHistory";
import {
  formatOdometerKm,
  formatServiceEntryLabel,
} from "@/lib/maintenanceUtils";
import {
  formatServiceEntryFullDate,
  formatServiceEntryShortDate,
} from "@/lib/serviceHistoryDates";
import { cn } from "@/lib/utils";
import type { MaintenanceServiceLogEntry } from "@/lib/types";

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
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<MaintenanceServiceLogEntry | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<MaintenanceServiceLogEntry | null>(null);
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
        <TableHead numeric>
          <span className="sr-only">
            {t("maintenance.history.columns.actions")}
          </span>
        </TableHead>
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
              {[0, 1, 2, 3, 4].map((column) => (
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
    <>
      <Card
        flush
        className={cn("pt-card-pad", className)}
        data-testid="service-history-table"
      >
        {title}
        <Table>
          {columnHeads}
          <TableBody>
            {displayedEntries.map((entry) => {
              const serviceLabel = formatServiceEntryLabel(entry, t);
              // The row column stays short and yearless; only the prose labels spell the year out.
              const dateLabel = formatServiceEntryFullDate(
                entry.service_date,
                i18n.language
              );
              return (
                <TableRow
                  key={entry.id}
                  data-testid={`service-history-row-${entry.id}`}
                >
                  <TableCell className="whitespace-nowrap">
                    {formatServiceEntryShortDate(
                      entry.service_date,
                      i18n.language
                    )}
                  </TableCell>
                  <TableCell>{serviceLabel}</TableCell>
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
                  <TableCell numeric className="whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={t("maintenance.history.editEntryLabel", {
                          service: serviceLabel,
                          date: dateLabel,
                        })}
                        onClick={() => setEditing(entry)}
                        data-testid={`service-history-edit-${entry.id}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="text-over-ink"
                        aria-label={t("maintenance.history.deleteEntryLabel", {
                          service: serviceLabel,
                          date: dateLabel,
                        })}
                        onClick={() => setPendingDelete(entry)}
                        data-testid={`service-history-delete-${entry.id}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
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

      {editing &&
        createPortal(
          <SlideOver
            open
            onClose={() => setEditing(null)}
            title={t("maintenance.history.editEntry")}
            description={
              editing.task_id !== null
                ? t("maintenance.history.editDescription")
                : t("maintenance.history.editCustomDescription")
            }
            className="z-[100] w-[min(400px,100vw)]"
            data-testid="edit-service-log-slide-over"
          >
            <EditServiceLogForm
              entry={editing}
              onSuccess={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          </SlideOver>,
          document.body
        )}

      <DeleteServiceLogDialog
        entry={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
