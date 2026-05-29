import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nkbaz/shared";
import { toast } from "sonner";
import { Button } from "@nkbaz/shared";
import { Input } from "@nkbaz/shared";
import { Label } from "@nkbaz/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useCreateAsset } from "@/hooks/useAssets";

const ASSET_TYPE_VALUES = [
  { value: "real_estate", key: "assets.typeRealEstate" },
  { value: "vehicle", key: "assets.typeVehicle" },
  { value: "business", key: "assets.typeBusiness" },
  { value: "other", key: "assets.typeOther" },
];

interface AssetFormData {
  name: string;
  asset_type: string;
  value_cents: number;
}

interface AddAssetFormProps {
  onClose: () => void;
}

export function AddAssetForm({ onClose }: AddAssetFormProps) {
  const { t } = useTranslation();
  const createAsset = useCreateAsset();
  const ASSET_TYPE_OPTIONS = ASSET_TYPE_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AssetFormData>({
    defaultValues: {
      name: "",
      asset_type: "real_estate",
      value_cents: 0,
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: AssetFormData) => {
    createAsset.mutate(
      {
        name: data.name,
        asset_type: data.asset_type,
        value_cents: data.value_cents,
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
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
      data-testid="add-asset-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="asset-name">{t("common.name")}</Label>
        <Input
          id="asset-name"
          placeholder={t("assets.namePlaceholder")}
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: t("assets.nameRequired") })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="asset-type">{t("common.type")}</Label>
        <Controller
          name="asset_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={ASSET_TYPE_OPTIONS}>
              <SelectTrigger id="asset-type">
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

      <div className="space-y-1.5">
        <Label htmlFor="asset-value">{t("assets.estimatedValue")}</Label>
        <Controller
          name="value_cents"
          control={control}
          rules={{
            validate: (v) => v > 0 || t("assets.valueRequired"),
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
          <p className="text-xs text-destructive">
            {errors.value_cents.message}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("assets.saveAsset")}
        </Button>
        <Button
          type="button"
          variant="ghost"
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
