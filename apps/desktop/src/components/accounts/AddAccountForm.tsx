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
import { useCreateAccount } from "@/hooks/useAccounts";

const ACCOUNT_TYPE_VALUES = [
  { value: "chequing", key: "accounts.typeChequing" },
  { value: "savings", key: "accounts.typeSavings" },
  { value: "credit_card", key: "accounts.typeCreditCard" },
  { value: "tfsa", key: "accounts.typeTFSA" },
  { value: "rrsp", key: "accounts.typeRRSP" },
  { value: "fhsa", key: "accounts.typeFHSA" },
  { value: "non_registered", key: "accounts.typeNonRegistered" },
  { value: "crypto", key: "accounts.typeCrypto" },
];

const CURRENCY_VALUES = [
  { value: "CAD", key: "accounts.currencyCAD" },
  { value: "USD", key: "accounts.currencyUSD" },
];

interface AccountFormData {
  name: string;
  institution: string;
  account_type: string;
  currency: string;
}

interface AddAccountFormProps {
  onClose: () => void;
}

export function AddAccountForm({ onClose }: AddAccountFormProps) {
  const { t } = useTranslation();
  const createAccount = useCreateAccount();
  const ACCOUNT_TYPE_OPTIONS = ACCOUNT_TYPE_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));
  const CURRENCY_OPTIONS = CURRENCY_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AccountFormData>({
    defaultValues: {
      name: "",
      institution: "",
      account_type: "chequing",
      currency: "CAD",
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: AccountFormData) => {
    createAccount.mutate(
      {
        name: data.name,
        institution: data.institution,
        account_type: data.account_type,
        currency: data.currency,
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
      data-testid="add-account-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="account-name">{t("common.name")}</Label>
        <Input
          id="account-name"
          placeholder={t("accounts.namePlaceholder")}
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: t("accounts.nameRequired") })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account-institution">{t("accounts.institution")}</Label>
        <Input
          id="account-institution"
          placeholder={t("accounts.institutionPlaceholder")}
          aria-invalid={!!errors.institution}
          {...register("institution", { required: t("accounts.institutionRequired") })}
        />
        {errors.institution && (
          <p className="text-xs text-destructive">{errors.institution.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account-type">{t("common.type")}</Label>
        <Controller
          name="account_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={ACCOUNT_TYPE_OPTIONS}>
              <SelectTrigger id="account-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPE_OPTIONS.map((opt) => (
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
        <Label htmlFor="account-currency">{t("common.currency")}</Label>
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={CURRENCY_OPTIONS}>
              <SelectTrigger id="account-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((opt) => (
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
          {t("accounts.saveAccount")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          data-testid="cancel-add-account"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
