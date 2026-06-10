import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nixus/shared";
import { Label } from "@nixus/shared";
import { useAccounts } from "@/hooks/useAccounts";
import { groupAccountsBySection } from "@/lib/accountUtils";

interface OptionalAccountSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  labelKey: string;
  helpKey: string;
}

export function OptionalAccountSelect({
  id,
  value,
  onChange,
  labelKey,
  helpKey,
}: OptionalAccountSelectProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const { assetGroups, liabilityGroups } = groupAccountsBySection(accounts);

  const orderedAccounts = useMemo(
    () => [
      ...assetGroups.flatMap(([, groupAccounts]) => groupAccounts),
      ...liabilityGroups.flatMap(([, groupAccounts]) => groupAccounts),
    ],
    [assetGroups, liabilityGroups]
  );

  const items = [
    { value: "", label: t("common.none") },
    ...orderedAccounts.map((account) => ({
      value: String(account.id),
      label: `${account.name} — ${account.institution}`,
    })),
  ];

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
        items={items}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={t("common.none")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{t("common.none")}</SelectItem>
          {orderedAccounts.map((account) => (
            <SelectItem key={account.id} value={String(account.id)}>
              {account.name} — {account.institution}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t(helpKey)}</p>
    </div>
  );
}
