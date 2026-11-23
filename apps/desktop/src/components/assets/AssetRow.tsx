import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
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
  IconChip,
  Money,
} from "@nixus/shared";
import { InlineEditMoney } from "@/components/shared/InlineEdit";
import { useUpdateAssetValue, useDeleteAsset } from "@/hooks/useAssets";
import {
  ASSET_TYPE_ICONS,
  ASSET_TYPE_KEYS,
  priceAgeHours,
  relativeQuoteAge,
  STOCK_STALE_AFTER_HOURS,
} from "@/lib/assetUtils";
import { StockRowDetail } from "@/components/assets/StockRowDetail";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import type { PassiveAsset } from "@/lib/types";

interface AssetRowProps {
  asset: PassiveAsset;
  onEdit: (asset: PassiveAsset) => void;
  /**
   * One dense line for a holding in a long list, rendered without a card of its own so the parent
   * can stack many of them inside a single card.
   */
  compact?: boolean;
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

/**
 * One thing you own, as its own card: what it is, what it is worth, and when that figure was last
 * believed. The value is the card's figure rather than a cell in a column, because a house and a
 * car are two readings a user takes one at a time, not a column they scan.
 */
export function AssetRow({ asset, onEdit, compact = false }: AssetRowProps) {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const holding = asset.stock;
  const typeLabel = ASSET_TYPE_KEYS[asset.asset_type]
    ? t(ASSET_TYPE_KEYS[asset.asset_type])
    : asset.asset_type;
  const TypeIcon = ASSET_TYPE_ICONS[asset.asset_type] ?? ASSET_TYPE_ICONS.other;

  const hours = holding ? priceAgeHours(holding.last_price_at) : null;
  const days = ageInDays(asset.updated_at);
  const isStale = holding
    ? hours === null || hours >= STOCK_STALE_AFTER_HOURS
    : days !== null && days >= STALE_AFTER_DAYS;

  const stockAgeLabel =
    holding && hours !== null
      ? t("assets.stockAsOf", { age: relativeQuoteAge(hours, i18n.language) })
      : null;
  const updatedLabel = holding
    ? (stockAgeLabel ?? t("assets.stockPriceUnavailable"))
    : days === null
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

  // A stock's value is derived from quantity x price x FX, so it is read-only here: an inline edit
  // would be silently overwritten by the next refresh.
  const valueNode = holding ? (
    <Money
      cents={asset.value_cents}
      locale={i18n.language}
      data-testid="stock-asset-value"
      {...maskProps}
    />
  ) : (
    <InlineEditMoney
      value={asset.value_cents}
      onSave={handleValueSave}
      className={compact ? "text-label" : "text-stat"}
      data-testid="asset-value"
    />
  );

  const statusNode =
    updatedLabel && isStale ? (
      <span className="inline-flex items-center gap-1.5">
        {/* A ring dot rather than a filled one: amber against crimson is the pair a
         * deuteranopic user cannot separate, and the dot column is the fastest scan path. */}
        <span
          data-slot="status-dot"
          data-status="caution"
          aria-hidden="true"
          className="size-[7px] shrink-0 rounded-full border-[1.5px] border-caution bg-transparent"
        />
        <Badge variant="caution" data-testid="asset-stale-badge">
          {updatedLabel}
        </Badge>
      </span>
    ) : (
      updatedLabel && (
        <span className="text-caption text-ink-dim">{updatedLabel}</span>
      )
    );

  const actionsMenu = (
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
  );

  const deleteDialog = (
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
  );

  if (compact) {
    return (
      <div
        className="flex items-center gap-3 px-card-pad py-3"
        data-testid="asset-row"
      >
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-label font-bold text-ink">{asset.name}</h3>
          {holding ? (
            <StockRowDetail holding={holding} />
          ) : (
            <p className="text-caption text-ink-dim">{typeLabel}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {statusNode}
        </div>
        <div className="money w-32 shrink-0 text-right text-label font-bold text-ink">
          {valueNode}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(asset)}
            data-testid="asset-edit-action"
          >
            {t("assets.editAsset_action")}
          </Button>
          {actionsMenu}
        </div>
        {deleteDialog}
      </div>
    );
  }

  return (
    <Card data-testid="asset-row">
      <div className="flex items-start gap-3 px-card-pad">
        <IconChip icon={TypeIcon} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-h1 text-ink">{asset.name}</h3>
          {holding ? (
            <StockRowDetail holding={holding} />
          ) : (
            <p className="text-caption text-ink-dim">{typeLabel}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(asset)}
            data-testid="asset-edit-action"
          >
            {t("assets.editAsset_action")}
          </Button>
          {/* Delete is demoted into the overflow rather than sitting beside Edit: a destructive
           * action is never a peer of an ordinary one in the same row. */}
          {actionsMenu}
        </div>
      </div>

      <div className="px-card-pad">
        <div className="money text-stat text-ink">{valueNode}</div>

        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {statusNode}
          {!holding && (
            <span className="text-caption text-ink-faint">
              {updatedLabel ? "· " : null}
              {t("wealth.v2.assets.updateHint")}
            </span>
          )}
        </div>
      </div>

      {deleteDialog}
    </Card>
  );
}
