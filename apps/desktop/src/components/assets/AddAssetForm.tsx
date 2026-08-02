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
  const ASSET_TYPE_OPTIONS = ASSET_TYPE_VALUES.map((o) => ({
    value: o.value,
    label: t(o.key),
  }));

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
    // Validate on blur, not on submit: filling every field and only then learning what was wrong is
    // the pattern the required markers and this mode exist together to replace.
    mode: "onBlur",
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
    // Native constraint checking aborts submit before it fires, which suppresses the styled inline
    // error and the `aria-invalid` / `aria-describedby` wiring. Validation belongs to the form layer.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="add-asset-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="asset-name" required>
          {t("common.name")}
        </Label>
        <Input
          id="asset-name"
          placeholder={t("assets.namePlaceholder")}
          autoFocus
          required
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "asset-name-error" : undefined}
          {...register("name", { required: t("assets.nameRequired") })}
        />
        {errors.name && (
          <p id="asset-name-error" className="text-caption text-over-ink">
            {errors.name.message}
          </p>
        )}
      </div>

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
        <Label htmlFor="asset-value" required>
          {t("assets.estimatedValue")}
        </Label>
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
          <p id="asset-value-error" className="text-caption text-over-ink">
            {errors.value_cents.message}
          </p>
        )}
        <p className="text-caption text-ink-dim">{t("assets.valueNote")}</p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
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
