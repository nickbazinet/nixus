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
import { useUpdateAssetValue, useDeleteAsset } from "@/hooks/useAssets";
import { ASSET_TYPE_ICONS, ASSET_TYPE_KEYS } from "@/lib/assetUtils";
import type { PassiveAsset } from "@/lib/types";

interface AssetRowProps {
  asset: PassiveAsset;
  onEdit: (asset: PassiveAsset) => void;
}

/** An estimate a year old is data too old to trust, so it carries the `stale` treatment. */
const STALE_AFTER_DAYS = 365;

const MS_PER_DAY = 86_400_000;

function ageInDays(isoString: string): number | null {
  const updated = new Date(isoString);
  if (Number.isNaN(updated.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - updated.getTime()) / MS_PER_DAY));
}

// The age is always spelled out beside the status: a badge reading "Stale" next to an unexplained
// date says something is wrong without saying what.
function relativeAge(days: number, locale: string): string {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days >= 60) return relative.format(-Math.round(days / 30), "month");
  if (days >= 14) return relative.format(-Math.round(days / 7), "week");
  return relative.format(-days, "day");
}

export function AssetRow({ asset, onEdit }: AssetRowProps) {
  const { t, i18n } = useTranslation();
  const typeLabel = ASSET_TYPE_KEYS[asset.asset_type]
    ? t(ASSET_TYPE_KEYS[asset.asset_type])
    : asset.asset_type;
  const TypeIcon = ASSET_TYPE_ICONS[asset.asset_type] ?? ASSET_TYPE_ICONS.other;

  const days = ageInDays(asset.updated_at);
  const isStale = days !== null && days >= STALE_AFTER_DAYS;
  const updatedLabel =
    days === null
      ? null
      : t("assets.updatedAge", { age: relativeAge(days, i18n.language) });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const updateValue = useUpdateAssetValue();
  const deleteAsset = useDeleteAsset();

  const handleValueSave = (cents: number) => {
    if (cents === asset.value_cents) return;
    updateValue.mutate(
      { id: asset.id, value_cents: cents },
      {
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      }
    );
  };

  const handleDelete = () => {
    deleteAsset.mutate(asset.id, {
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
      <TableRow data-testid="asset-row">
        <TableCell>
          <div className="flex items-start gap-2">
            <TypeIcon
              className="mt-0.5 size-4 shrink-0 text-ink-faint"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <span className="text-label text-ink">{asset.name}</span>
              <p className="text-caption text-ink-dim">{typeLabel}</p>
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
            value={asset.value_cents}
            onSave={handleValueSave}
            data-testid="asset-value"
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
                  aria-label={t("assets.rowActions", { name: asset.name })}
                  data-testid="asset-row-menu"
                />
              }
            >
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onEdit(asset)}
                data-testid="edit-asset-button"
              >
                <Pencil aria-hidden="true" />
                {t("assets.editAsset_action")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
                data-testid="delete-asset-button"
              >
                <Trash2 aria-hidden="true" />
                {t("assets.deleteAsset_action")}
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
        <DialogContent data-testid="delete-asset-dialog">
          <DialogHeader>
            <DialogTitle>{t("assets.deleteAsset")}</DialogTitle>
            <DialogDescription>
              {t("accounts.confirmDelete")} {asset.name}?{" "}
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
              data-testid="confirm-delete-asset-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
