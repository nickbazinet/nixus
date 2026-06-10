import { useState, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nixus/shared";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { DatePicker } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import {
  useUpdateIncomeEntry,
  useDeleteIncomeEntry,
  useIncomeSources,
} from "@/hooks/useIncome";
import { useAccounts } from "@/hooks/useAccounts";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { IncomeEntry } from "@/lib/types";

interface IncomeEntryListProps {
  entries: IncomeEntry[];
}

interface EditFormData {
  source_id: string;
  account_id: string;
  amount_cents: number;
  date: string;
}

function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  const date = new Date(
    Number(isoDate.slice(0, 4)),
    Number(month) - 1,
    Number(day)
  );
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    mode: "onSubmit",
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
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3 p-3 rounded-lg ring-1 ring-foreground/10 bg-card"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-income-source">{t("common.source")}</Label>
        <Controller
          name="source_id"
          control={control}
          rules={{ required: t("income.sourceRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={sources.map((s) => ({ value: String(s.id), label: s.name }))}>
              <SelectTrigger id="edit-income-source" aria-invalid={!!errors.source_id}>
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
        <Label htmlFor="edit-income-amount">{t("common.amount")}</Label>
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
              aria-invalid={!!errors.amount_cents}
            />
          )}
        />
        {errors.amount_cents && (
          <p className="text-xs text-destructive">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-income-date">{t("common.date")}</Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("validation.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="edit-income-date"
              value={field.value}
              onChange={field.onChange}
              aria-invalid={!!errors.date}
            />
          )}
        />
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

export function IncomeEntryList({ entries }: IncomeEntryListProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const { data: accounts = [] } = useAccounts();
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IncomeEntry | null>(null);
  const deleteEntry = useDeleteIncomeEntry();

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

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2 px-2">
        {t("income.noEntriesThisMonth")}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-0.5">
        {entries.map((entry) =>
          editingId === entry.id ? (
            <EditIncomeEntryForm
              key={entry.id}
              entry={entry}
              onClose={() => setEditingId(null)}
            />
          ) : (
            <div
              key={entry.id}
              className="group flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent text-sm"
            >
              <div className="flex items-center gap-3">
                <span>{entry.source_name}</span>
                {entry.account_id != null && accountNameById.has(entry.account_id) && (
                  <span className="text-xs text-muted-foreground">
                    {accountNameById.get(entry.account_id)}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {formatShortDate(entry.date)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-mono text-right">
                  {formatCurrency(entry.amount_cents)}
                </span>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEditingId(entry.id)}
                    aria-label={t("income.editEntry")}
                  >
                    <Pencil className="size-3.5 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(entry)}
                    aria-label={t("income.deleteEntryAction")}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>

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
              {t("accounts.confirmDelete")} {deleteTarget?.source_name} (
              {deleteTarget ? formatCurrency(deleteTarget.amount_cents) : ""})?
              {t("accounts.cannotBeUndone")}
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
