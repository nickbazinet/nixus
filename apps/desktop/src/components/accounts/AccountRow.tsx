import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TableCell,
  TableRow,
} from "@nixus/shared";
import { InlineEditMoney } from "@/components/shared/InlineEdit";
import {
  useUpdateAccountBalance,
  useDeleteAccount,
} from "@/hooks/useAccounts";
import {
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_KEYS,
  isLiabilityAccountType,
} from "@/lib/accountUtils";
import type { Account } from "@/lib/types";

interface AccountRowProps {
  account: Account;
  onEdit: (account: Account) => void;
}

/** Past a month a typed-in balance is data too old to trust, so it carries the `stale` treatment. */
const STALE_AFTER_DAYS = 30;

const MS_PER_DAY = 86_400_000;

function ageInDays(isoString: string): number | null {
  const updated = new Date(isoString);
  if (Number.isNaN(updated.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - updated.getTime()) / MS_PER_DAY));
}

// The age is always spelled out beside the status, because a badge reading "Stale" next to an
// unexplained date tells the user something is wrong without telling them what.
function relativeAge(days: number, locale: string): string {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days >= 60) return relative.format(-Math.round(days / 30), "month");
  if (days >= 14) return relative.format(-Math.round(days / 7), "week");
  return relative.format(-days, "day");
}

export function AccountRow({ account, onEdit }: AccountRowProps) {
  const { t, i18n } = useTranslation();
  const typeLabel = ACCOUNT_TYPE_KEYS[account.account_type]
    ? t(ACCOUNT_TYPE_KEYS[account.account_type])
    : account.account_type;
  const TypeIcon =
    ACCOUNT_TYPE_ICONS[account.account_type] ?? ACCOUNT_TYPE_ICONS.chequing;
  const isLiability = isLiabilityAccountType(account.account_type);

  const days = ageInDays(account.updated_at);
  const isStale = days !== null && days >= STALE_AFTER_DAYS;
  const updatedLabel =
    days === null
      ? null
      : t("accounts.updatedAge", { age: relativeAge(days, i18n.language) });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const updateBalance = useUpdateAccountBalance();
  const deleteAccount = useDeleteAccount();

  // A liability is entered and shown as a positive amount owed, but the stored sign is whatever the
  // backend already holds — so the user's edit is written back with the original sign preserved
  // rather than silently normalised.
  const storedSignIsNegative = account.balance_cents < 0;
  const displayCents = isLiability
    ? Math.abs(account.balance_cents)
    : account.balance_cents;

  const handleBalanceSave = (cents: number) => {
    const next = isLiability && storedSignIsNegative ? -cents : cents;
    if (next === account.balance_cents) return;
    updateBalance.mutate(
      { id: account.id, balance_cents: next },
      {
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      }
    );
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
      <TableRow data-testid="account-row">
        <TableCell>
          <div className="flex items-start gap-2">
            <TypeIcon
              className="mt-0.5 size-4 shrink-0 text-ink-faint"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <span className="text-label text-ink">{account.name}</span>
              <p className="text-caption text-ink-dim">
                {account.institution} · {typeLabel} · {account.currency}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell dim>
          {updatedLabel && isStale ? (
            <span className="inline-flex items-center gap-1.5">
              {/* A ring dot rather than a filled one: amber against crimson is the pair a
               * deuteranopic user cannot separate, and the dot column is the fastest scan path. */}
              <span
                data-slot="status-dot"
                data-status="caution"
                aria-hidden="true"
                className="size-[7px] shrink-0 rounded-full border-[1.5px] border-caution bg-transparent"
              />
              <Badge variant="caution">{updatedLabel}</Badge>
            </span>
          ) : (
            <span className="text-caption">{updatedLabel}</span>
          )}
        </TableCell>
        <TableCell numeric>
          <InlineEditMoney
            value={displayCents}
            onSave={handleBalanceSave}
            data-testid="account-balance"
          />
        </TableCell>
        <TableCell numeric>
          {/* Delete is demoted into the overflow rather than sitting beside Edit: a destructive
           * action is never a peer of an ordinary one in the same row. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("accounts.rowActions", { name: account.name })}
                  data-testid="account-row-menu"
                />
              }
            >
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onEdit(account)}
                data-testid="edit-account-button"
              >
                <Pencil aria-hidden="true" />
                {t("accounts.editAccount_action")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
                data-testid="delete-account-button"
              >
                <Trash2 aria-hidden="true" />
                {t("accounts.deleteAccount_action")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

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
              {t("accounts.confirmDelete")} {account.name}?{" "}
              {t("accounts.cannotBeUndone")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
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
