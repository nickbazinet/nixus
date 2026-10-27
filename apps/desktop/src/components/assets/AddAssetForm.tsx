import { useState } from "react";
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
import { MoneyInput } from "@/components/shared/MoneyInput";
import { StockAssetFields } from "@/components/assets/StockAssetFields";
import { useCreateAsset, useCreateStockAsset } from "@/hooks/useAssets";
import {
  ASSET_TYPE_VALUES,
  parseQuantityToMicros,
  quantityProblem,
  STOCK_ASSET_TYPE,
} from "@/lib/assetUtils";
import type { StockSearchResult } from "@/lib/types";

interface AssetFormData {
  name: string;
  asset_type: string;
  value_cents: number;
  quantity: string;
}

interface AddAssetFormProps {
  onClose: () => void;
}

export function AddAssetForm({ onClose }: AddAssetFormProps) {
  const { t } = useTranslation();
  const createAsset = useCreateAsset();
  const createStockAsset = useCreateStockAsset();
  const [symbol, setSymbol] = useState<StockSearchResult | null>(null);
  const [symbolMissing, setSymbolMissing] = useState(false);
  const ASSET_TYPE_OPTIONS = ASSET_TYPE_VALUES.map((o) => ({
    value: o.value,
    label: t(o.key),
  }));

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<AssetFormData>({
    defaultValues: {
      name: "",
      asset_type: "real_estate",
      value_cents: 0,
      quantity: "",
    },
    // Validate on blur, not on submit: filling every field and only then learning what was wrong is
    // the pattern the required markers and this mode exist together to replace.
    mode: "onBlur",
  });

  const isStock = watch("asset_type") === STOCK_ASSET_TYPE;
  const isSaving = createAsset.isPending || createStockAsset.isPending;

  const mutationCallbacks = {
    onSuccess: () => {
      toast.success(t("toast.saveSuccess"));
      onClose();
    },
    onError: () => {
      toast.error(t("toast.saveFailed"));
    },
  };

  const onSubmit = (data: AssetFormData) => {
    if (!isStock) {
      createAsset.mutate(
        {
          name: data.name,
          asset_type: data.asset_type,
          value_cents: data.value_cents,
        },
        mutationCallbacks
      );
      return;
    }

    // The combobox is not a react-hook-form field, so its "required" has to be enforced here or a
    // submit with no symbol selected would reach the backend as an empty string.
    if (!symbol) {
      setSymbolMissing(true);
      return;
    }

    const quantityMicros = parseQuantityToMicros(data.quantity);
    if (quantityMicros === null) return;

    createStockAsset.mutate(
      {
        symbol: symbol.symbol,
        name: data.name.trim() || symbol.name,
        exchange: symbol.exchange,
        quantity_micros: quantityMicros,
      },
      mutationCallbacks
    );
  };

  return (
    // Native constraint checking aborts submit before it fires, which suppresses the styled inline
    // error and the `aria-invalid` / `aria-describedby` wiring. Validation belongs to the form layer.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="add-asset-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="asset-type">{t("common.type")}</Label>
        <Controller
          name="asset_type"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={ASSET_TYPE_OPTIONS}
            >
              {/* The first field in DOM order carries the focus, so the keyboard lands on the
                  choice that decides which fields exist rather than mid-form. */}
              <SelectTrigger id="asset-type" autoFocus>
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
      </div>

      {isStock && (
        <StockAssetFields
          idPrefix="asset-stock"
          symbol={{
            selected: symbol,
            missing: symbolMissing,
            onSelect: (result) => {
              setSymbol(result);
              setSymbolMissing(false);
            },
          }}
          quantity={register("quantity", {
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
          quantityError={errors.quantity}
        />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="asset-name" required={!isStock}>
          {t("common.name")}
        </Label>
        <Input
          id="asset-name"
          placeholder={
            isStock ? t("assets.stockNamePlaceholder") : t("assets.namePlaceholder")
          }
          required={!isStock}
          aria-required={isStock ? undefined : "true"}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "asset-name-error" : undefined}
          {...register("name", {
            validate: (value) =>
              isStock || value.trim().length > 0 || t("assets.nameRequired"),
          })}
        />
        {errors.name && (
          <p id="asset-name-error" className="text-caption text-over-ink">
            {errors.name.message}
          </p>
        )}
      </div>

      {!isStock && (
        <div className="space-y-1.5">
          <Label htmlFor="asset-value" required>
            {t("assets.estimatedValue")}
          </Label>
          <Controller
            name="value_cents"
            control={control}
            rules={{
              validate: (v) => isStock || v > 0 || t("assets.valueRequired"),
            }}
            render={({ field }) => (
              <MoneyInput
                id="asset-value"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={!!errors.value_cents}
              />
            )}
          />
          {errors.value_cents && (
            <p id="asset-value-error" className="text-caption text-over-ink">
              {errors.value_cents.message}
            </p>
          )}
          <p className="text-caption text-ink-dim">{t("assets.valueNote")}</p>
        </div>
      )}

      {isStock && (
        <p className="text-caption text-ink-dim" data-testid="stock-value-note">
          {t("assets.stockValueNote")}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {t("assets.saveAsset")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          data-testid="cancel-add-asset"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
