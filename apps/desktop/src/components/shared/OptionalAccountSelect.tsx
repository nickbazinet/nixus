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
import type { Account } from "@/lib/types";

interface OptionalAccountSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  labelKey: string;
  helpKey: string;
  /** Narrows the offered accounts to those the caller's backend path will accept. */
  filter?: (account: Account) => boolean;
}

export function OptionalAccountSelect({
  id,
  value,
  onChange,
  labelKey,
  helpKey,
  filter,
}: OptionalAccountSelectProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const { assetGroups, liabilityGroups } = groupAccountsBySection(accounts);

  const orderedAccounts = useMemo(() => {
    const ordered = [
      ...assetGroups.flatMap(([, groupAccounts]) => groupAccounts),
      ...liabilityGroups.flatMap(([, groupAccounts]) => groupAccounts),
    ];
    return filter ? ordered.filter(filter) : ordered;
  }, [assetGroups, liabilityGroups, filter]);

  const items = [
    { value: "", label: t("common.none") },
    ...orderedAccounts.map((account) => ({
      value: String(account.id),
      label: `${account.name} — ${account.institution}`,
    })),
  ];

  const helpId = `${id}-help`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
        items={items}
      >
        {/* The help text explains why imports carry no account, so it has to reach the accessible
         * name rather than float beside the field unassociated. */}
        <SelectTrigger id={id} aria-describedby={helpId}>
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
      <p id={helpId} className="text-caption text-ink-dim">
        {t(helpKey)}
      </p>
    </div>
  );
}
