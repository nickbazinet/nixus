import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Label,
  Money,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SlideOver,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { toast } from "sonner";
import { Trash2, Wallet } from "lucide-react";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InlineEditMoney } from "@/components/shared/InlineEdit";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import {
  useUpdateIncomeEntry,
  useDeleteIncomeEntry,
  useIncomeSources,
} from "@/hooks/useIncome";
import { useAccounts } from "@/hooks/useAccounts";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import type { IncomeEntry } from "@/lib/types";

interface IncomeEntryListProps {
  entries: IncomeEntry[];
  isLoading?: boolean;
  onAddEntry?: () => void;
}

interface EditFormData {
  source_id: string;
  account_id: string;
  amount_cents: number;
  date: string;
}

function formatShortDate(isoDate: string, locale: string): string {
  const [, month, day] = isoDate.split("-");
  const date = new Date(
    Number(isoDate.slice(0, 4)),
    Number(month) - 1,
    Number(day)
  );
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function EditIncomeEntryForm({
  entry,
  onClose,
}: {
  entry: IncomeEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: sources = [] } = useIncomeSources();
  const updateEntry = useUpdateIncomeEntry();

  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EditFormData>({
    defaultValues: {
      source_id: String(entry.source_id),
      account_id: entry.account_id ? String(entry.account_id) : "",
      amount_cents: entry.amount_cents,
      date: entry.date,
    },
    mode: "onBlur",
  });

  const onSubmit = (data: EditFormData) => {
    updateEntry.mutate(
      {
        id: entry.id,
        source_id: Number(data.source_id),
        amount_cents: data.amount_cents,
        date: data.date,
        account_id: data.account_id ? Number(data.account_id) : null,
      },
      {
        onSuccess: () => {
          toast.success(t("toast.saveSuccess"));
          onClose();
        },
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="edit-income-source" required>
          {t("common.source")}
        </Label>
        <Controller
          name="source_id"
          control={control}
          rules={{ required: t("income.sourceRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={sources.map((s) => ({ value: String(s.id), label: s.name }))}>
              <SelectTrigger
                id="edit-income-source"
                aria-required="true"
                aria-invalid={!!errors.source_id}
                aria-describedby={errors.source_id ? "edit-income-source-error" : undefined}
              >
                <SelectValue placeholder={t("income.selectSource")} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.source_id && (
          <p id="edit-income-source-error" className="text-caption text-over">
            {errors.source_id.message}
          </p>
        )}
      </div>

      <Controller
        name="account_id"
        control={control}
        render={({ field }) => (
          <OptionalAccountSelect
            id="edit-income-account"
            value={field.value}
            onChange={field.onChange}
            labelKey="income.accountOptional"
            helpKey="income.accountLinkHelp"
          />
        )}
      />

      <div className="space-y-1.5">
        <Label htmlFor="edit-income-amount" required>
          {t("common.amount")}
        </Label>
        <Controller
          name="amount_cents"
          control={control}
          rules={{
            validate: (v) => v > 0 || t("validation.amountPositive"),
          }}
          render={({ field }) => (
            <MoneyInput
              id="edit-income-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={errors.amount_cents ? "edit-income-amount-error" : undefined}
            />
          )}
        />
        {errors.amount_cents && (
          <p id="edit-income-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-income-date" required>
          {t("common.date")}
        </Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("validation.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="edit-income-date"
              value={field.value}
              onChange={field.onChange}
              aria-required="true"
              aria-invalid={!!errors.date}
              aria-describedby={errors.date ? "edit-income-date-error" : undefined}
            />
          )}
        />
        {errors.date && (
          <p id="edit-income-date-error" className="text-caption text-over">
            {errors.date.message}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function IncomeEntryList({ entries, isLoading = false, onAddEntry }: IncomeEntryListProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { data: accounts = [] } = useAccounts();
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  );
  const [editing, setEditing] = useState<IncomeEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IncomeEntry | null>(null);
  const deleteEntry = useDeleteIncomeEntry();
  const updateEntry = useUpdateIncomeEntry();

  // A hardcoded 2–3 skeleton rows reintroduces the layout shift the skeleton exists to remove, so
  // the count is the last real one this list rendered.
  const lastRowCount = useRef(3);
  useEffect(() => {
    if (!isLoading && entries.length > 0) lastRowCount.current = entries.length;
  }, [isLoading, entries.length]);

  const totalCents = entries.reduce((sum, entry) => sum + entry.amount_cents, 0);

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteEntry.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(t("toast.deleteSuccess"));
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error(t("toast.deleteFailed"));
        setDeleteTarget(null);
      },
    });
  };

  const handleUpdateAmount = (entry: IncomeEntry, amountCents: number) => {
    updateEntry.mutate(
      {
        id: entry.id,
        source_id: entry.source_id,
        amount_cents: amountCents,
        date: entry.date,
        account_id: entry.account_id ?? null,
      },
      {
        onError: () => toast.error(t("toast.saveFailed")),
      }
    );
  };

  if (isLoading) {
    return (
      <Table>
        <caption className="sr-only">{t("common.loading")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.date")}</TableHead>
            <TableHead>{t("common.source")}</TableHead>
            <TableHead>{t("expenses.account")}</TableHead>
            <TableHead numeric>{t("common.amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={4}>
              <Skeleton rows={lastRowCount.current} data-testid="income-entries-skeleton" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Wallet />}
        title={t("income.noEntriesThisMonth")}
        description={t("income.noEntriesHint")}
        action={
          onAddEntry ? (
            <Button size="sm" onClick={onAddEntry}>
              {t("income.addEntry")}
            </Button>
          ) : undefined
        }
        data-testid="income-entries-empty"
      />
    );
  }

  return (
    <>
      <Table>
        <caption className="sr-only">{t("income.entriesTableCaption")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.date")}</TableHead>
            <TableHead>{t("common.source")}</TableHead>
            <TableHead>{t("expenses.account")}</TableHead>
            <TableHead numeric>{t("common.amount")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("common.delete")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const accountName =
              entry.account_id != null ? accountNameById.get(entry.account_id) : undefined;
            return (
              <TableRow
                key={entry.id}
                onActivate={() => setEditing(entry)}
                aria-label={t("income.openEntry", { source: entry.source_name })}
                data-testid="income-entry-row"
              >
                <TableCell dim>{formatShortDate(entry.date, i18n.language)}</TableCell>
                <TableCell>{entry.source_name}</TableCell>
                <TableCell dim>
                  {accountName ?? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="text-ink-faint">
                        &mdash;
                      </span>
                      <span className="sr-only">{t("income.notLinkedWhy")}</span>
                      <Badge variant="neutral" aria-hidden="true">
                        {t("expenses.notLinked")}
                      </Badge>
                    </span>
                  )}
                </TableCell>
                <TableCell numeric onClick={(event) => event.stopPropagation()}>
                  <InlineEditMoney
                    value={entry.amount_cents}
                    onSave={(cents) => handleUpdateAmount(entry, cents)}
                    data-testid="income-amount-edit"
                  />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(entry)}
                    className="text-ink-faint hover:text-over"
                    aria-label={t("income.deleteEntryAction")}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="text-caption">
              {t("income.entryCount", { count: entries.length })}
            </TableCell>
            <TableCell numeric data-testid="income-entries-total">
              <Money cents={totalCents} locale={i18n.language} {...maskProps} />
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>

      <SlideOver
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("income.editEntry")}
        description={t("income.editEntryDescription")}
        data-testid="edit-income-entry-slide-over"
      >
        {editing && (
          <EditIncomeEntryForm entry={editing} onClose={() => setEditing(null)} />
        )}
      </SlideOver>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("income.deleteEntry")}</DialogTitle>
            <DialogDescription>
              {t("income.deleteEntryExplain", {
                source: deleteTarget?.source_name ?? "",
                amount: deleteTarget ? formatCurrency(deleteTarget.amount_cents) : "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
