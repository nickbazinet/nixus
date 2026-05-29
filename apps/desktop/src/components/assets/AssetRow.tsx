import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useUpdateAssetValue, useDeleteAsset } from "@/hooks/useAssets";
import {
  ASSET_TYPE_ICONS,
  ASSET_TYPE_KEYS,
  formatAssetUpdatedAt,
} from "@/lib/assetUtils";
import type { PassiveAsset } from "@/lib/types";

interface AssetRowProps {
  asset: PassiveAsset;
  onEdit: (asset: PassiveAsset) => void;
}

export function AssetRow({ asset, onEdit }: AssetRowProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const typeLabel = ASSET_TYPE_KEYS[asset.asset_type]
    ? t(ASSET_TYPE_KEYS[asset.asset_type])
    : asset.asset_type;
  const TypeIcon = ASSET_TYPE_ICONS[asset.asset_type] ?? ASSET_TYPE_ICONS.other;
  const updatedLabel = formatAssetUpdatedAt(asset.updated_at);

  const [editingValue, setEditingValue] = useState(false);
  const [draftValue, setDraftValue] = useState(asset.value_cents);
  const draftRef = useRef(asset.value_cents);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const updateValue = useUpdateAssetValue();
  const deleteAsset = useDeleteAsset();

  const handleDraftChange = (cents: number) => {
    draftRef.current = cents;
    setDraftValue(cents);
  };

  const handleValueSave = () => {
    const currentDraft = draftRef.current;
    if (currentDraft !== asset.value_cents) {
      updateValue.mutate(
        { id: asset.id, value_cents: currentDraft },
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
    setEditingValue(false);
  };

  const handleValueCancel = () => {
    draftRef.current = asset.value_cents;
    setDraftValue(asset.value_cents);
    setEditingValue(false);
  };

  const handleValueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleValueSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleValueCancel();
    }
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
      <div
        className="group flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-accent/50 transition-colors"
        aria-label={`${asset.name}, ${typeLabel}, ${formatCurrency(asset.value_cents)}`}
        data-testid="asset-row"
      >
        <div className="flex items-start gap-2 min-w-0">
          <TypeIcon
            className="size-4 text-muted-foreground shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">
              {asset.name}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {typeLabel}
            </span>
            {updatedLabel && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("assets.updated", { date: updatedLabel })}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {editingValue ? (
            <div onKeyDown={handleValueKeyDown} data-testid="value-edit-input">
              <MoneyInput
                value={draftValue}
                onChange={handleDraftChange}
                className="h-7 w-28 text-sm"
                aria-label={t("assets.editValueHint")}
              />
            </div>
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={() => {
                draftRef.current = asset.value_cents;
                setDraftValue(asset.value_cents);
                setEditingValue(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  draftRef.current = asset.value_cents;
                  setDraftValue(asset.value_cents);
                  setEditingValue(true);
                }
              }}
              className="text-sm font-medium font-mono cursor-pointer hover:underline decoration-dashed underline-offset-2 text-foreground"
              data-testid="asset-value"
              aria-label={t("assets.editValueHint")}
            >
              {formatCurrency(asset.value_cents)}
            </span>
          )}
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onEdit(asset)}
              data-testid="edit-asset-button"
              aria-label={t("assets.editAsset_action")}
            >
              <Pencil className="size-3.5 text-muted-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowDeleteDialog(true)}
              data-testid="delete-asset-button"
              aria-label={t("assets.deleteAsset_action")}
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
        <DialogContent data-testid="delete-asset-dialog">
          <DialogHeader>
            <DialogTitle>{t("assets.deleteAsset")}</DialogTitle>
            <DialogDescription>
              {t("accounts.confirmDelete")} {asset.name}? {t("accounts.cannotBeUndone")}
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
