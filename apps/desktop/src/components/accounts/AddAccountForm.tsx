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
      name: "",
      institution: "",
      account_type: "chequing",
      currency: "CAD",
    },
    // Validate on blur, not on submit: filling five fields and only then learning what was wrong is
    // the pattern the required markers and this mode exist together to replace.
    mode: "onBlur",
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
    // `noValidate` hands validation to the form layer instead of the browser. Native constraint
    // checking aborts submit before it fires, so the styled inline error, `aria-invalid` and
    // `aria-describedby` never activate — the user gets an unstyled bubble and AT gets nothing.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="add-account-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="account-name" required>
          {t("common.name")}
        </Label>
        <Input
          id="account-name"
          placeholder={t("accounts.namePlaceholder")}
          autoFocus
          required
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "account-name-error" : undefined}
          {...register("name", { required: t("accounts.nameRequired") })}
        />
        {errors.name && (
          <p id="account-name-error" className="text-caption text-over-ink">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account-institution" required>
          {t("accounts.institution")}
        </Label>
        <Input
          id="account-institution"
          placeholder={t("accounts.institutionPlaceholder")}
          required
          aria-required="true"
          aria-invalid={!!errors.institution}
          aria-describedby={
            errors.institution ? "account-institution-error" : undefined
          }
          {...register("institution", {
            required: t("accounts.institutionRequired"),
          })}
        />
        {errors.institution && (
          <p
            id="account-institution-error"
            className="text-caption text-over-ink"
          >
            {errors.institution.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account-type">{t("common.type")}</Label>
        <Controller
          name="account_type"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={ACCOUNT_TYPE_OPTIONS}
            >
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
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={CURRENCY_OPTIONS}
            >
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
        <p className="text-caption text-ink-dim">
          {t("accounts.currencyNote")}
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("accounts.saveAccount")}
        </Button>
        <Button
          type="button"
          variant="outline"
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
