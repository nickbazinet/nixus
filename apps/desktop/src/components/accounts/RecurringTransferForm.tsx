import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useForm,
  Controller,
  FormProvider,
  type Control,
  type ControllerProps,
} from "react-hook-form";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nixus/shared";
import { toast } from "sonner";
import { RecurrenceFields } from "@/components/shared/RecurrenceFields";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { todayIso } from "@/lib/recurrence";
import { groupAccountsBySection } from "@/lib/accountUtils";
import { useAccounts } from "@/hooks/useAccounts";
import {
  useCreateRecurringTransferTemplate,
  useUpdateRecurringTransferTemplate,
} from "@/hooks/useRecurringTransfers";
import type { Account, RecurrenceFrequency, RecurringTransferTemplate } from "@/lib/types";

interface RecurringTransferFormProps {
  template?: RecurringTransferTemplate;
  onClose: () => void;
}

interface RecurringTransferFormData {
  from_account_id: string;
  to_account_id: string;
  amount_cents: number;
  day_of_month: number;
  frequency: RecurrenceFrequency;
  start_date: string;
  is_active: boolean;
}

export function accountLabel(account: Account): string {
  return `${account.name} — ${account.institution}`;
}

export function RecurringTransferForm({ template, onClose }: RecurringTransferFormProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const createTemplate = useCreateRecurringTransferTemplate();
  const updateTemplate = useUpdateRecurringTransferTemplate();
  const idPrefix = template ? "edit-recurring-transfer" : "recurring-transfer";

  const orderedAccounts = useMemo(() => {
    const { assetGroups, liabilityGroups } = groupAccountsBySection(accounts);
    return [
      ...assetGroups.flatMap(([, groupAccounts]) => groupAccounts),
      ...liabilityGroups.flatMap(([, groupAccounts]) => groupAccounts),
    ];
  }, [accounts]);

  const methods = useForm<RecurringTransferFormData>({
    defaultValues: {
      from_account_id: template ? String(template.from_account_id) : "",
      to_account_id: template ? String(template.to_account_id) : "",
      amount_cents: template?.amount_cents ?? 0,
      day_of_month: template?.day_of_month ?? 1,
      frequency: template?.frequency ?? "monthly",
      start_date: template?.start_date ?? todayIso(),
      is_active: template?.is_active ?? true,
    },
    mode: "onSubmit",
  });
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = methods;

  const findAccount = (id: string) => accounts.find((account) => String(account.id) === id);

  const validateTo = (toId: string, values: RecurringTransferFormData) => {
    if (!toId) return t("recurring.transferToRequired");
    if (toId === values.from_account_id) return t("recurring.transferSameAccount");
    const from = findAccount(values.from_account_id);
    const to = findAccount(toId);
    if (from && to && from.currency !== to.currency) {
      return t("recurring.transferCurrencyMismatch");
    }
    return true;
  };

  const onSubmit = (data: RecurringTransferFormData) => {
    const fields = {
      from_account_id: Number(data.from_account_id),
      to_account_id: Number(data.to_account_id),
      amount_cents: data.amount_cents,
      day_of_month: Number(data.day_of_month),
      frequency: data.frequency,
      start_date: data.frequency === "monthly" ? null : data.start_date,
    };
    const callbacks = {
      onSuccess: () => {
        toast.success(t("recurring.transferSaved"));
        onClose();
      },
      onError: () => {
        toast.error(t("recurring.transferSaveFailed"));
      },
    };

    if (template) {
      updateTemplate.mutate(
        { ...fields, id: template.id, is_active: data.is_active },
        callbacks
      );
    } else {
      createTemplate.mutate(fields, callbacks);
    }
  };

  if (accounts.length < 2) {
    return (
      <p className="text-body text-ink-dim" data-testid="recurring-transfer-needs-accounts">
        {t("recurring.transferNeedsAccounts")}
      </p>
    );
  }

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-3"
        data-testid={template ? "edit-recurring-transfer-form" : "add-recurring-transfer-form"}
      >
        <AccountField
          id={`${idPrefix}-from`}
          name="from_account_id"
          label={t("recurring.transferFrom")}
          control={control}
          accounts={orderedAccounts}
          rules={{ required: t("recurring.transferFromRequired") }}
          error={errors.from_account_id?.message}
        />

        <AccountField
          id={`${idPrefix}-to`}
          name="to_account_id"
          label={t("recurring.transferTo")}
          control={control}
          accounts={orderedAccounts}
          rules={{ validate: validateTo }}
          error={errors.to_account_id?.message}
        />

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-amount`} required>
            {t("common.amount")}
          </Label>
          <Controller
            name="amount_cents"
            control={control}
            rules={{
              validate: (v) => v > 0 || t("validation.amountPositive"),
            }}
            render={({ field }) => (
              <MoneyInput
                id={`${idPrefix}-amount`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-required
                aria-invalid={!!errors.amount_cents}
                aria-describedby={
                  errors.amount_cents ? `${idPrefix}-amount-error` : undefined
                }
              />
            )}
          />
          {errors.amount_cents && (
            <p id={`${idPrefix}-amount-error`} className="text-caption text-over">
              {errors.amount_cents.message}
            </p>
          )}
        </div>

        <RecurrenceFields idPrefix={idPrefix} />

        <p className="text-caption text-ink-dim">{t("recurring.transferHelp")}</p>

        {template && (
          <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
            <div className="min-w-0">
              <Label htmlFor={`${idPrefix}-active`}>{t("recurring.transferActiveLabel")}</Label>
              <p id={`${idPrefix}-active-hint`} className="mt-1 text-caption text-ink-dim">
                {t("recurring.transferActiveHint")}
              </p>
            </div>
            <Controller
              name="is_active"
              control={control}
              render={({ field }) => (
                <Switch
                  id={`${idPrefix}-active`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-describedby={`${idPrefix}-active-hint`}
                  data-testid="recurring-transfer-active-switch"
                />
              )}
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {t("recurring.saveTemplate")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

interface AccountFieldProps {
  id: string;
  name: "from_account_id" | "to_account_id";
  label: string;
  control: Control<RecurringTransferFormData>;
  accounts: Account[];
  rules: ControllerProps<RecurringTransferFormData, AccountFieldProps["name"]>["rules"];
  error?: string;
}

function AccountField({ id, name, label, control, accounts, rules, error }: AccountFieldProps) {
  const { t } = useTranslation();
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required>
        {label}
      </Label>
      <Controller
        name={name}
        control={control}
        rules={rules}
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={(next) => field.onChange(next ?? "")}
            items={accounts.map((account) => ({
              value: String(account.id),
              label: accountLabel(account),
            }))}
          >
            <SelectTrigger
              id={id}
              aria-required="true"
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
            >
              <SelectValue placeholder={t("recurring.transferSelectAccount")} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {accountLabel(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {error && (
        <p id={errorId} className="text-caption text-over">
          {error}
        </p>
      )}
    </div>
  );
}
