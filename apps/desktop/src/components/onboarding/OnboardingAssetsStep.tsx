import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nixus/shared";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useAssets, useCreateAsset } from "@/hooks/useAssets";
import { Plus } from "lucide-react";

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
    mode: "onSubmit",
  });

  const onSubmit = (data: AssetFormData) => {
    createAsset.mutate(
      { name: data.name, asset_type: data.asset_type, value_cents: data.value_cents },
      {
        onSuccess: () => {
          toast.success(`Asset "${data.name}" added`);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error("Failed to add asset"),
      }
    );
  };

  const assetTypeItems = ASSET_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));

  return (
    <div data-testid="onboarding-assets-step">
      <h2 className="text-lg font-medium mb-2">{t("onboarding.assetsTitle")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("onboarding.assetsDescription")}
      </p>

      {assets.length > 0 && (
        <div className="space-y-2 mb-4">
          {assets.map((asset) => (
            <Card key={asset.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{asset.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{asset.asset_type}</span>
                </div>
                <span className="font-mono text-sm">${(asset.value_cents / 100).toFixed(2)}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card">
          <div className="space-y-1.5">
            <Label htmlFor="ob-asset-name">{t("common.name")}</Label>
            <Input
              id="ob-asset-name"
              placeholder={t("assets.namePlaceholder")}
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: t("assets.nameRequired") })}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-asset-type">{t("common.type")}</Label>
            <Controller
              name="asset_type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} items={assetTypeItems}>
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
          <div className="space-y-1.5">
            <Label htmlFor="ob-asset-value">{t("assets.estimatedValue")}</Label>
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
                  aria-invalid={!!errors.value_cents}
                />
              )}
            />
            {errors.value_cents && <p className="text-xs text-destructive">{errors.value_cents.message}</p>}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">{t("assets.saveAsset")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setShowForm(false); }}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setShowForm(true)}
          data-testid="add-asset-button"
        >
          <Plus className="size-4 mr-1" /> {t("assets.addAsset")}
        </Button>
      )}
    </div>
  );
}
