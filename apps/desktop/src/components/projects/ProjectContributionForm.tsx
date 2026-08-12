import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Button,
  DatePicker,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useAccounts } from "@/hooks/useAccounts";
import { useCreateProjectContribution } from "@/hooks/useProjects";
import { groupAccountsBySection } from "@/lib/accountUtils";

interface ContributionFormData {
  account_id: string;
  amount_cents: number;
  date: string;
}

interface ProjectContributionFormProps {
  projectId: number;
  onClose: () => void;
}

export function ProjectContributionForm({
  projectId,
  onClose,
}: ProjectContributionFormProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const createContribution = useCreateProjectContribution();

  const { assetGroups, liabilityGroups } = groupAccountsBySection(accounts);

  // `OptionalAccountSelect` is deliberately not reused: its leading `common.none` option is
  // load-bearing for imports and expenses, while `project_contributions.account_id` is NOT NULL.
  const orderedAccounts = useMemo(
    () => [
      ...assetGroups.flatMap(([, groupAccounts]) => groupAccounts),
      ...liabilityGroups.flatMap(([, groupAccounts]) => groupAccounts),
    ],
    [assetGroups, liabilityGroups]
  );

  const items = orderedAccounts.map((account) => ({
    value: String(account.id),
    label: `${account.name} — ${account.institution}`,
  }));

  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ContributionFormData>({
    defaultValues: {
      account_id: "",
      amount_cents: 0,
      date: format(new Date(), "yyyy-MM-dd"),
    },
    mode: "onBlur",
  });

  const onSubmit = (data: ContributionFormData) => {
    createContribution.mutate(
      {
        project_id: projectId,
        account_id: Number(data.account_id),
        amount_cents: data.amount_cents,
        date: data.date,
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
    // `noValidate` hands validation to the form layer: native constraint checking aborts submit
    // before the styled inline error, `aria-invalid` and `aria-describedby` can activate.
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4"
      data-testid="project-contribution-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="contribution-account" required>
          {t("projects.sourceAccount")}
        </Label>
        <Controller
          name="account_id"
          control={control}
          rules={{ required: t("projects.sourceAccountRequired") }}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(next) => field.onChange(next ?? "")}
              items={items}
            >
              <SelectTrigger
                id="contribution-account"
                aria-required="true"
                aria-invalid={!!errors.account_id}
                aria-describedby={
                  errors.account_id ? "contribution-account-error" : undefined
                }
              >
                <SelectValue placeholder={t("projects.sourceAccount")} />
              </SelectTrigger>
              <SelectContent>
                {orderedAccounts.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.name} — {account.institution}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.account_id && (
          <p
            id="contribution-account-error"
            className="text-caption text-over-ink"
          >
            {errors.account_id.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contribution-amount" required>
          {t("common.amount")}
        </Label>
        <Controller
          name="amount_cents"
          control={control}
          rules={{ validate: (v) => v > 0 || t("validation.amountPositive") }}
          render={({ field }) => (
            <MoneyInput
              id="contribution-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={
                errors.amount_cents ? "contribution-amount-error" : undefined
              }
            />
          )}
        />
        {errors.amount_cents && (
          <p
            id="contribution-amount-error"
            className="text-caption text-over-ink"
          >
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contribution-date" required>
          {t("common.date")}
        </Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("validation.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="contribution-date"
              value={field.value}
              onChange={field.onChange}
              aria-required="true"
              aria-invalid={!!errors.date}
              aria-describedby={
                errors.date ? "contribution-date-error" : undefined
              }
            />
          )}
        />
        {errors.date && (
          <p id="contribution-date-error" className="text-caption text-over-ink">
            {errors.date.message}
          </p>
        )}
      </div>

      <p
        className="text-caption text-ink-dim"
        data-testid="contribution-no-money-moved"
      >
        {t("projects.noMoneyMovedNote")}
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("projects.saveContribution")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          data-testid="cancel-contribution-form"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
