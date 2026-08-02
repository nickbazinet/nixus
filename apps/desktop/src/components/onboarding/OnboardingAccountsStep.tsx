import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { useAccounts, useCreateAccount } from "@/hooks/useAccounts";

const ACCOUNT_TYPE_OPTIONS = [
  { value: "chequing", labelKey: "accounts.typeChequing" },
  { value: "savings", labelKey: "accounts.typeSavings" },
  { value: "credit_card", labelKey: "accounts.typeCreditCard" },
  { value: "tfsa", labelKey: "accounts.typeTFSA" },
  { value: "rrsp", labelKey: "accounts.typeRRSP" },
  { value: "fhsa", labelKey: "accounts.typeFHSA" },
  { value: "non_registered", labelKey: "accounts.typeNonRegistered" },
  { value: "crypto", labelKey: "accounts.typeCrypto" },
];

const CURRENCY_OPTIONS = [
  { value: "CAD", labelKey: "accounts.currencyCAD" },
  { value: "USD", labelKey: "accounts.currencyUSD" },
];

interface AccountFormData {
  name: string;
  institution: string;
  account_type: string;
  currency: string;
}

export function OnboardingAccountsStep() {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const createAccount = useCreateAccount();
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<AccountFormData>({
    defaultValues: {
      name: "",
      institution: "",
      account_type: "chequing",
      currency: "CAD",
    },
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
          toast.success(data.name);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error(t("toast.saveFailed")),
      }
    );
  };

  const accountTypeItems = ACCOUNT_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));
  const currencyItems = CURRENCY_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));
  const typeLabel = (value: string) => {
    const match = ACCOUNT_TYPE_OPTIONS.find((opt) => opt.value === value);
    return match ? t(match.labelKey) : value;
  };

  return (
    <div className="space-y-4" data-testid="onboarding-accounts-step">
      <div>
        <h2 className="text-h2 text-ink">{t("onboarding.accountsTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("onboarding.accountsDescription")}
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="text-caption text-ink-dim">{t("onboarding.accountsEmpty")}</p>
      ) : (
        <Card flush>
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 px-card-pad py-3 not-last:border-b not-last:border-line"
            >
              <span className="min-w-0">
                <span className="block truncate text-label text-ink">{account.name}</span>
                <span className="block truncate text-caption text-ink-dim">
                  {account.institution}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="neutral">{typeLabel(account.account_type)}</Badge>
                <span className="text-caption text-ink-dim">{account.currency}</span>
              </span>
            </div>
          ))}
        </Card>
      )}

      {showForm ? (
        <Card>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ob-account-name" required>
                  {t("common.name")}
                </Label>
                <Input
                  id="ob-account-name"
                  placeholder={t("accounts.namePlaceholder")}
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={errors.name !== undefined || undefined}
                  aria-describedby={errors.name ? "ob-account-name-error" : undefined}
                  {...register("name", { required: t("accounts.nameRequired") })}
                />
                {errors.name && (
                  <p
                    id="ob-account-name-error"
                    className="text-caption text-over-ink"
                    role="alert"
                  >
                    {errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-account-institution" required>
                  {t("accounts.institution")}
                </Label>
                <Input
                  id="ob-account-institution"
                  placeholder={t("accounts.institutionPlaceholder")}
                  required
                  aria-required="true"
                  aria-invalid={errors.institution !== undefined || undefined}
                  aria-describedby={
                    errors.institution ? "ob-account-institution-error" : undefined
                  }
                  {...register("institution", {
                    required: t("accounts.institutionRequired"),
                  })}
                />
                {errors.institution && (
                  <p
                    id="ob-account-institution-error"
                    className="text-caption text-over-ink"
                    role="alert"
                  >
                    {errors.institution.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-account-type" required>
                  {t("common.type")}
                </Label>
                <Controller
                  name="account_type"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      items={accountTypeItems}
                    >
                      <SelectTrigger id="ob-account-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPE_OPTIONS.map((opt) => (
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
                <Label htmlFor="ob-account-currency" required>
                  {t("common.currency")}
                </Label>
                <Controller
                  name="currency"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      items={currencyItems}
                    >
                      <SelectTrigger id="ob-account-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
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
          data-testid="add-account-button"
        >
          <Plus className="size-4" aria-hidden="true" /> {t("accounts.addAccount")}
        </Button>
      )}
    </div>
  );
}
