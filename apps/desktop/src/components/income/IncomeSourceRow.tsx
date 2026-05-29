import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@nkbaz/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nkbaz/shared";
import { useDeleteIncomeSource } from "@/hooks/useIncome";
import type { IncomeSourceWithLastEntry } from "@/lib/types";
import { EditIncomeSourceForm } from "./EditIncomeSourceForm";

const TYPE_BADGE_KEYS: Record<string, { key: string; className: string }> = {
  employment: { key: "income.typeEmployment", className: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300" },
  freelance: { key: "income.typeFreelance", className: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300" },
  investment: { key: "income.typeInvestment", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300" },
  other: { key: "income.typeOther", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

interface IncomeSourceRowProps {
  source: IncomeSourceWithLastEntry;
}

export function IncomeSourceRow({ source }: IncomeSourceRowProps) {
  const { t } = useTranslation();
  const deleteSource = useDeleteIncomeSource();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);

  const badgeInfo = TYPE_BADGE_KEYS[source.income_type] ?? TYPE_BADGE_KEYS.other;

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

  if (showEditForm) {
    return (
      <EditIncomeSourceForm
        source={source}
        onClose={() => setShowEditForm(false)}
      />
    );
  }

  return (
    <>
      <div className="group flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {source.name}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeInfo.className}`}
          >
            {t(badgeInfo.key)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowEditForm(true)}
            >
              <Pencil className="size-3.5 text-muted-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>
      </div>

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
