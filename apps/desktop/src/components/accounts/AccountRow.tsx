import { useState, useRef } from "react";
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
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  useUpdateAccountBalance,
  useDeleteAccount,
} from "@/hooks/useAccounts";
import {
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_KEYS,
  formatAccountUpdatedAt,
} from "@/lib/accountUtils";
import type { Account } from "@/lib/types";

interface AccountRowProps {
  account: Account;
  onEdit: (account: Account) => void;
}

export function AccountRow({ account, onEdit }: AccountRowProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const typeLabel = ACCOUNT_TYPE_KEYS[account.account_type]
    ? t(ACCOUNT_TYPE_KEYS[account.account_type])
    : account.account_type;
  const TypeIcon =
    ACCOUNT_TYPE_ICONS[account.account_type] ?? ACCOUNT_TYPE_ICONS.chequing;
  const updatedLabel = formatAccountUpdatedAt(account.updated_at);
  const isNegative = account.balance_cents < 0;

  const [editingBalance, setEditingBalance] = useState(false);
  const [draftBalance, setDraftBalance] = useState(account.balance_cents);
  const draftRef = useRef(account.balance_cents);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const updateBalance = useUpdateAccountBalance();
  const deleteAccount = useDeleteAccount();

  const handleDraftChange = (cents: number) => {
    draftRef.current = cents;
    setDraftBalance(cents);
  };

  const handleBalanceSave = () => {
    const currentDraft = draftRef.current;
    if (currentDraft !== account.balance_cents) {
      updateBalance.mutate(
        { id: account.id, balance_cents: currentDraft },
        {
          onSuccess: () => {
            toast.success(t("toast.saveSuccess"));
          },
          onError: () => {
            toast.error(t("toast.saveFailed"));
          },
        }
      );
    }
    setEditingBalance(false);
  };

  const handleBalanceCancel = () => {
    draftRef.current = account.balance_cents;
    setDraftBalance(account.balance_cents);
    setEditingBalance(false);
  };

  const handleBalanceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBalanceSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleBalanceCancel();
    }
  };

  const handleDelete = () => {
    deleteAccount.mutate(account.id, {
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
      <div
        className="group flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-colors"
        aria-label={`${account.name}, ${account.institution}, ${typeLabel}, ${formatCurrency(account.balance_cents)}`}
        data-testid="account-row"
      >
        <div className="flex items-start gap-2 min-w-0">
          <TypeIcon
            className="size-4 text-muted-foreground shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">
              {account.name}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {account.institution} · {typeLabel} · {account.currency}
            </span>
            {updatedLabel && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("accounts.updated", { date: updatedLabel })}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {editingBalance ? (
            <div
              onKeyDown={handleBalanceKeyDown}
              data-testid="balance-edit-input"
            >
              <MoneyInput
                value={draftBalance}
                onChange={handleDraftChange}
                className="h-7 w-28 text-sm"
                aria-label={t("accounts.editBalanceHint")}
              />
            </div>
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={() => {
                draftRef.current = account.balance_cents;
                setDraftBalance(account.balance_cents);
                setEditingBalance(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  draftRef.current = account.balance_cents;
                  setDraftBalance(account.balance_cents);
                  setEditingBalance(true);
                }
              }}
              className={`text-sm font-medium font-mono cursor-pointer hover:underline decoration-dashed underline-offset-2 ${isNegative ? "text-rose-500" : "text-foreground"}`}
              data-testid="account-balance"
              aria-label={t("accounts.editBalanceHint")}
            >
              {formatCurrency(account.balance_cents)}
            </span>
          )}
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onEdit(account)}
              data-testid="edit-account-button"
              aria-label={t("accounts.editAccount_action")}
            >
              <Pencil className="size-3.5 text-muted-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowDeleteDialog(true)}
              data-testid="delete-account-button"
              aria-label={t("accounts.deleteAccount_action")}
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
        <DialogContent data-testid="delete-account-dialog">
          <DialogHeader>
            <DialogTitle>{t("accounts.deleteAccount")}</DialogTitle>
            <DialogDescription>
              {t("accounts.confirmDelete")} {account.name}? {t("accounts.cannotBeUndone")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="confirm-delete-account-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
