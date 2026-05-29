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
import { useUpdateAsset } from "@/hooks/useAssets";
import type { PassiveAsset } from "@/lib/types";

const ASSET_TYPE_VALUES = [
  { value: "real_estate", key: "assets.typeRealEstate" },
  { value: "vehicle", key: "assets.typeVehicle" },
  { value: "business", key: "assets.typeBusiness" },
  { value: "other", key: "assets.typeOther" },
];

interface EditAssetFormProps {
  asset: PassiveAsset;
  onClose: () => void;
}

interface AssetFormData {
  name: string;
  asset_type: string;
}

export function EditAssetForm({ asset, onClose }: EditAssetFormProps) {
  const { t } = useTranslation();
  const updateAsset = useUpdateAsset();
  const ASSET_TYPE_OPTIONS = ASSET_TYPE_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AssetFormData>({
    defaultValues: {
      name: asset.name,
      asset_type: asset.asset_type,
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: AssetFormData) => {
    updateAsset.mutate(
      {
        id: asset.id,
        name: data.name,
        asset_type: data.asset_type,
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
      className="space-y-3"
      data-testid="edit-asset-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-asset-name">{t("common.name")}</Label>
        <Input
          id="edit-asset-name"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: t("assets.nameRequired") })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-asset-type">{t("common.type")}</Label>
        <Controller
          name="asset_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={ASSET_TYPE_OPTIONS}>
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
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
