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
import { useAccounts, useCreateAccount } from "@/hooks/useAccounts";
import { Plus } from "lucide-react";

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
          toast.success(`Account "${data.name}" added`);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error("Failed to add account"),
      }
    );
  };

  const accountTypeItems = ACCOUNT_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));
  const currencyItems = CURRENCY_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));

  return (
    <div data-testid="onboarding-accounts-step">
      <h2 className="text-lg font-medium mb-2">{t("onboarding.accountsTitle")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("onboarding.accountsDescription")}
      </p>

      {accounts.length > 0 && (
        <div className="space-y-2 mb-4">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{account.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{account.institution}</span>
                </div>
                <span className="text-xs text-muted-foreground">{account.account_type} · {account.currency}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card">
          <div className="space-y-1.5">
            <Label htmlFor="ob-account-name">{t("common.name")}</Label>
            <Input
              id="ob-account-name"
              placeholder={t("accounts.namePlaceholder")}
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: t("accounts.nameRequired") })}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-account-institution">{t("accounts.institution")}</Label>
            <Input
              id="ob-account-institution"
              placeholder={t("accounts.institutionPlaceholder")}
              aria-invalid={!!errors.institution}
              {...register("institution", { required: t("accounts.institutionRequired") })}
            />
            {errors.institution && <p className="text-xs text-destructive">{errors.institution.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-account-type">{t("common.type")}</Label>
            <Controller
              name="account_type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} items={accountTypeItems}>
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
          <div className="space-y-1.5">
            <Label htmlFor="ob-account-currency">{t("common.currency")}</Label>
            <Controller
              name="currency"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} items={currencyItems}>
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
            <Button type="submit" size="sm">{t("accounts.saveAccount")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setShowForm(false); }}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setShowForm(true)}
          data-testid="add-account-button"
        >
          <Plus className="size-4 mr-1" /> {t("accounts.addAccount")}
        </Button>
      )}
    </div>
  );
}
