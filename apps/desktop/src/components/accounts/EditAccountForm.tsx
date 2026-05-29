import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
import { useUpdateAccount } from "@/hooks/useAccounts";
import type { Account } from "@/lib/types";

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

interface EditAccountFormProps {
  account: Account;
  onClose: () => void;
}

interface AccountFormData {
  name: string;
  institution: string;
  account_type: string;
  currency: string;
}

export function EditAccountForm({ account, onClose }: EditAccountFormProps) {
  const { t } = useTranslation();
  const updateAccount = useUpdateAccount();
  const ACCOUNT_TYPE_OPTIONS = ACCOUNT_TYPE_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));
  const CURRENCY_OPTIONS = CURRENCY_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AccountFormData>({
    defaultValues: {
      name: account.name,
      institution: account.institution,
      account_type: account.account_type,
      currency: account.currency,
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: AccountFormData) => {
    updateAccount.mutate(
      {
        id: account.id,
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
      className="space-y-3 p-3 rounded-lg ring-1 ring-foreground/10 bg-card"
      data-testid="edit-account-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-account-name">{t("common.name")}</Label>
        <Input
          id="edit-account-name"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: t("accounts.nameRequired") })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-account-institution">{t("accounts.institution")}</Label>
        <Input
          id="edit-account-institution"
          aria-invalid={!!errors.institution}
          {...register("institution", { required: t("accounts.institutionRequired") })}
        />
        {errors.institution && (
          <p className="text-xs text-destructive">
            {errors.institution.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-account-type">{t("common.type")}</Label>
        <Controller
          name="account_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={ACCOUNT_TYPE_OPTIONS}>
              <SelectTrigger id="edit-account-type">
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
        <Label htmlFor="edit-account-currency">{t("common.currency")}</Label>
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={CURRENCY_OPTIONS}>
              <SelectTrigger id="edit-account-currency">
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
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
