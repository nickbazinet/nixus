import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { useUpdateAsset, useUpdateStockQuantity } from "@/hooks/useAssets";
import {
  ASSET_TYPE_KEYS,
  ASSET_TYPE_VALUES,
  microsToQuantity,
  parseQuantityToMicros,
  quantityProblem,
  STOCK_ASSET_TYPE,
} from "@/lib/assetUtils";
import type { PassiveAsset } from "@/lib/types";

interface EditAssetFormProps {
  asset: PassiveAsset;
  onClose: () => void;
}

interface AssetFormData {
  name: string;
  asset_type: string;
  quantity: string;
}

export function EditAssetForm({ asset, onClose }: EditAssetFormProps) {
  const { t } = useTranslation();
  const updateAsset = useUpdateAsset();
  const updateQuantity = useUpdateStockQuantity();
  const holding = asset.stock;
  // `stock` is omitted for a plain asset: the backend refuses the change either way, so offering it
  // would be a choice whose only outcome is an error.
  const ASSET_TYPE_OPTIONS = ASSET_TYPE_VALUES.filter(
    (o) => o.value !== STOCK_ASSET_TYPE
  ).map((o) => ({ value: o.value, label: t(o.key) }));
  const isSaving = updateAsset.isPending || updateQuantity.isPending;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AssetFormData>({
    defaultValues: {
      name: asset.name,
      asset_type: asset.asset_type,
      quantity: holding ? String(microsToQuantity(holding.quantity_micros)) : "",
    },
    mode: "onBlur",
  });

  const onSubmit = async (data: AssetFormData) => {
    // The trimmed name is both what is COMPARED and what is SENT, so a change of leading
    // whitespace alone cannot be reported as saved while nothing was written.
    const name = data.name.trim();

    try {
      // Quantity first: it is the write that can fail on validation, and failing it after the
      // rename would leave the form closed over a half-applied edit.
      if (holding) {
        const quantityMicros = parseQuantityToMicros(data.quantity);
        if (quantityMicros === null) return;
        if (quantityMicros !== holding.quantity_micros) {
          await updateQuantity.mutateAsync({
            id: asset.id,
            quantity_micros: quantityMicros,
          });
        }
      }

      const nextType = holding ? asset.asset_type : data.asset_type;
      if (name !== asset.name || nextType !== asset.asset_type) {
        await updateAsset.mutateAsync({
          id: asset.id,
          name,
          asset_type: nextType,
        });
      }

      toast.success(t("toast.saveSuccess"));
      onClose();
    } catch {
      toast.error(t("toast.saveFailed"));
    }
  };

  return (
    // Native constraint checking aborts submit before it fires, which suppresses the styled inline
    // error and the `aria-invalid` / `aria-describedby` wiring. Validation belongs to the form layer.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="edit-asset-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-asset-name" required>
          {t("common.name")}
        </Label>
        <Input
          id="edit-asset-name"
          autoFocus
          required
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "edit-asset-name-error" : undefined}
          {...register("name", { required: t("assets.nameRequired") })}
        />
        {errors.name && (
          <p id="edit-asset-name-error" className="text-caption text-over-ink">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-asset-type">{t("common.type")}</Label>
        {holding ? (
          // A stock's type is structural: its value comes from a holding row, so changing the type
          // either way is a shape the data model cannot represent and the backend refuses it.
          <>
            <Input
              id="edit-asset-type"
              value={t(ASSET_TYPE_KEYS[asset.asset_type] ?? asset.asset_type)}
              readOnly
              disabled
              data-testid="edit-asset-type-locked"
            />
            <p className="text-caption text-ink-dim">
              {t("assets.stockTypeLocked")}
            </p>
          </>
        ) : (
          <Controller
            name="asset_type"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                items={ASSET_TYPE_OPTIONS}
              >
                <SelectTrigger id="edit-asset-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </div>

      {holding && (
        <div className="space-y-1.5">
          <Label htmlFor="edit-asset-quantity" required>
            {t("assets.stockQuantity")}
          </Label>
          <Input
            id="edit-asset-quantity"
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            aria-required="true"
            aria-invalid={!!errors.quantity}
            aria-describedby={
              errors.quantity ? "edit-asset-quantity-error" : undefined
            }
            {...register("quantity", {
              validate: (value) => {
                switch (quantityProblem(value)) {
                  case "empty":
                    return t("assets.stockQuantityRequired");
                  case "too_large":
                    return t("assets.stockQuantityTooLarge");
                  default:
                    return true;
                }
              },
            })}
          />
          {errors.quantity && (
            <p
              id="edit-asset-quantity-error"
              className="text-caption text-over-ink"
              data-testid="edit-stock-quantity-error"
            >
              {errors.quantity.message}
            </p>
          )}
          <p className="text-caption text-ink-dim">
            {t("assets.stockEditQuantityNote", { symbol: holding.symbol })}
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {t("common.save")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
