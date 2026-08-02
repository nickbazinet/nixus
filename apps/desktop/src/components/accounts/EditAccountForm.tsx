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
  const ACCOUNT_TYPE_OPTIONS = ACCOUNT_TYPE_VALUES.map((o) => ({
    value: o.value,
    label: t(o.key),
  }));
  const CURRENCY_OPTIONS = CURRENCY_VALUES.map((o) => ({
    value: o.value,
    label: t(o.key),
  }));

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
    mode: "onBlur",
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
    // Native constraint checking aborts submit before it fires, which suppresses the styled inline
    // error and the `aria-invalid` / `aria-describedby` wiring. Validation belongs to the form layer.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="edit-account-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-account-name" required>
          {t("common.name")}
        </Label>
        <Input
          id="edit-account-name"
          autoFocus
          required
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "edit-account-name-error" : undefined}
          {...register("name", { required: t("accounts.nameRequired") })}
        />
        {errors.name && (
          <p id="edit-account-name-error" className="text-caption text-over-ink">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-account-institution" required>
          {t("accounts.institution")}
        </Label>
        <Input
          id="edit-account-institution"
          required
          aria-required="true"
          aria-invalid={!!errors.institution}
          aria-describedby={
            errors.institution ? "edit-account-institution-error" : undefined
          }
          {...register("institution", {
            required: t("accounts.institutionRequired"),
          })}
        />
        {errors.institution && (
          <p
            id="edit-account-institution-error"
            className="text-caption text-over-ink"
          >
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
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={ACCOUNT_TYPE_OPTIONS}
            >
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
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={CURRENCY_OPTIONS}
            >
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
        <p className="text-caption text-ink-dim">
          {t("accounts.currencyNote")}
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("common.save")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
