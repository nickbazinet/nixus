import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Money,
  SlideOver,
  TableCell,
  TableRow,
} from "@nixus/shared";
import { useDeleteIncomeSource } from "@/hooks/useIncome";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import type { IncomeSourceWithLastEntry } from "@/lib/types";
import { EditIncomeSourceForm } from "./EditIncomeSourceForm";

// An income type is an identity, not a status and not a chart series, so it gets one neutral badge
// and the word does the work. Four hues pinned to four types is the pinned-colour anti-pattern —
// and teal, sky, purple and slate carried no meaning a user could ever learn.
const TYPE_LABEL_KEYS: Record<string, string> = {
  employment: "income.typeEmployment",
  freelance: "income.typeFreelance",
  investment: "income.typeInvestment",
  other: "income.typeOther",
};

function formatMonth(month: string, locale: string): string {
  const [year, monthPart] = month.split("-");
  const date = new Date(Number(year), Number(monthPart) - 1);
  return date.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

interface IncomeSourceRowProps {
  source: IncomeSourceWithLastEntry;
}

export function IncomeSourceRow({ source }: IncomeSourceRowProps) {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const deleteSource = useDeleteIncomeSource();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  const typeLabelKey = TYPE_LABEL_KEYS[source.income_type] ?? TYPE_LABEL_KEYS.other;

  const handleDelete = () => {
    deleteSource.mutate(source.id, {
      onSuccess: () => {
        toast.success(t("toast.deleteSuccess"));
        setShowDeleteDialog(false);
      },
      onError: () => {
        toast.error(t("toast.deleteFailed"));
        setShowDeleteDialog(false);
      },
    });
  };

  return (
    <>
      <TableRow
        onActivate={() => setShowEditForm(true)}
        aria-label={t("income.openSource", { name: source.name })}
        data-testid="income-source-row"
      >
        <TableCell>{source.name}</TableCell>
        <TableCell>
          <Badge variant="neutral">{t(typeLabelKey)}</Badge>
        </TableCell>
        <TableCell dim>
          {source.last_month ? formatMonth(source.last_month, i18n.language) : (
            <span className="text-ink-faint">{t("income.nothingRecordedYet")}</span>
          )}
        </TableCell>
        <TableCell numeric>
          {source.last_amount_cents != null ? (
            <Money
              cents={source.last_amount_cents}
              locale={i18n.language}
              {...maskProps}
            />
          ) : (
            <span aria-hidden="true" className="text-ink-faint">
              &mdash;
            </span>
          )}
        </TableCell>
        <TableCell onClick={(event) => event.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowDeleteDialog(true)}
            className="text-ink-faint hover:text-over"
            aria-label={t("income.deleteSourceAction", { name: source.name })}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </TableCell>
      </TableRow>

      <SlideOver
        open={showEditForm}
        onClose={() => setShowEditForm(false)}
        title={t("income.editSource")}
        description={t("income.editSourceDescription")}
        data-testid="edit-income-source-slide-over"
      >
        <EditIncomeSourceForm source={source} onClose={() => setShowEditForm(false)} />
      </SlideOver>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) setShowDeleteDialog(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("income.deleteSource")}</DialogTitle>
            <DialogDescription>
              {t("income.deleteSourceWarning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
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
