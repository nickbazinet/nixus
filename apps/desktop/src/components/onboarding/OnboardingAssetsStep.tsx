import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Money,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { CardContent } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { useAssets, useCreateAsset } from "@/hooks/useAssets";

const ASSET_TYPE_OPTIONS = [
  { value: "real_estate", labelKey: "assets.typeRealEstate" },
  { value: "vehicle", labelKey: "assets.typeVehicle" },
  { value: "business", labelKey: "assets.typeBusiness" },
  { value: "other", labelKey: "assets.typeOther" },
];

interface AssetFormData {
  name: string;
  asset_type: string;
  value_cents: number;
}

export function OnboardingAssetsStep() {
  const { t } = useTranslation();
  const maskProps = useMaskProps();
  const { data: assets = [] } = useAssets();
  const createAsset = useCreateAsset();
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<AssetFormData>({
    defaultValues: { name: "", asset_type: "real_estate", value_cents: 0 },
    mode: "onBlur",
  });

  const onSubmit = (data: AssetFormData) => {
    createAsset.mutate(
      { name: data.name, asset_type: data.asset_type, value_cents: data.value_cents },
      {
        onSuccess: () => {
          toast.success(data.name);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error(t("toast.saveFailed")),
      }
    );
  };

  const assetTypeItems = ASSET_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));
  const typeLabel = (value: string) => {
    const match = ASSET_TYPE_OPTIONS.find((opt) => opt.value === value);
    return match ? t(match.labelKey) : value;
  };

  return (
    <div className="space-y-4" data-testid="onboarding-assets-step">
      <div>
        <h2 className="text-h2 text-ink">{t("onboarding.assetsTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("onboarding.assetsDescription")}
        </p>
      </div>

      {assets.length === 0 ? (
        <p className="text-caption text-ink-dim">{t("onboarding.assetsEmpty")}</p>
      ) : (
        <Card flush>
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center justify-between gap-3 px-card-pad py-3 not-last:border-b not-last:border-line"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-label text-ink">{asset.name}</span>
                <Badge variant="neutral">{typeLabel(asset.asset_type)}</Badge>
              </span>
              <Money
                cents={asset.value_cents}
                className="shrink-0 text-label text-ink"
                {...maskProps}
              />
            </div>
          ))}
        </Card>
      )}

      {showForm ? (
        <Card>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ob-asset-name" required>
                  {t("common.name")}
                </Label>
                <Input
                  id="ob-asset-name"
                  placeholder={t("assets.namePlaceholder")}
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={errors.name !== undefined || undefined}
                  aria-describedby={errors.name ? "ob-asset-name-error" : undefined}
                  {...register("name", { required: t("assets.nameRequired") })}
                />
                {errors.name && (
                  <p id="ob-asset-name-error" className="text-caption text-over-ink" role="alert">
                    {errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-asset-type" required>
                  {t("common.type")}
                </Label>
                <Controller
                  name="asset_type"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      items={assetTypeItems}
                    >
                      <SelectTrigger id="ob-asset-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSET_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-asset-value" required>
                  {t("assets.estimatedValue")}
                </Label>
                <Controller
                  name="value_cents"
                  control={control}
                  rules={{ validate: (v) => v > 0 || t("assets.valueRequired") }}
                  render={({ field }) => (
                    <MoneyInput
                      id="ob-asset-value"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={errors.value_cents !== undefined || undefined}
                    />
                  )}
                />
                {errors.value_cents && (
                  <p className="text-caption text-over-ink" role="alert">
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
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    reset();
                    setShowForm(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button
          variant="outline"
          onClick={() => setShowForm(true)}
          data-testid="add-asset-button"
        >
          <Plus className="size-4" aria-hidden="true" /> {t("assets.addAsset")}
        </Button>
      )}
    </div>
  );
}
