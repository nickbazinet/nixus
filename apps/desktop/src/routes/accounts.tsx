import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Landmark } from "lucide-react";
import { Button } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AccountRow } from "@/components/accounts/AccountRow";
import { AddAccountForm } from "@/components/accounts/AddAccountForm";
import { EditAccountForm } from "@/components/accounts/EditAccountForm";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { useAccounts } from "@/hooks/useAccounts";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  ACCOUNT_TYPE_KEYS,
  buildAccountBreakdown,
  groupAccountsBySection,
  hasMixedCurrencies,
  netAccountPositionCents,
  partitionAccounts,
  sumBalanceCents,
  sumLiabilityOwedCents,
} from "@/lib/accountUtils";
import { SlideOver } from "@nixus/shared";
import type { Account } from "@/lib/types";

export const Route = createFileRoute("/accounts")({
  component: AccountsPage,
});

function AccountTypeGroup({
  type,
  groupAccounts,
  onEdit,
}: {
  type: string;
  groupAccounts: Account[];
  onEdit: (account: Account) => void;
}) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const subtotal = sumBalanceCents(groupAccounts);

  return (
    <div data-testid="account-type-group">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {ACCOUNT_TYPE_KEYS[type] ? t(ACCOUNT_TYPE_KEYS[type]) : type}
        </span>
        <span className="text-xs font-medium font-mono text-muted-foreground">
          {formatCurrency(subtotal)}
        </span>
      </div>
      {groupAccounts.map((account) => (
        <AccountRow key={account.id} account={account} onEdit={onEdit} />
      ))}
    </div>
  );
}

function AccountsPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const { data: accounts, isLoading } = useAccounts();
  const netWorth = useCurrentNetWorth();
  const formatCurrency = useFormatCurrency();

  const { assetGroups, liabilityGroups } = useMemo(
    () => (accounts ? groupAccountsBySection(accounts) : { assetGroups: [], liabilityGroups: [] }),
    [accounts]
  );

  const grandTotal = useMemo(
    () => (accounts ? netAccountPositionCents(accounts) : 0),
    [accounts]
  );

  const { assetAccounts, liabilityAccounts } = useMemo(
    () => (accounts ? partitionAccounts(accounts) : { assetAccounts: [], liabilityAccounts: [] }),
    [accounts]
  );

  const assetsTotal = useMemo(
    () => sumBalanceCents(assetAccounts),
    [assetAccounts]
  );

  const debtTotal = useMemo(
    () => sumLiabilityOwedCents(liabilityAccounts),
    [liabilityAccounts]
  );

  const breakdown = useMemo(() => {
    if (!accounts || accounts.length < 2) return [];
    return buildAccountBreakdown(accounts, (type) =>
      ACCOUNT_TYPE_KEYS[type] ? t(ACCOUNT_TYPE_KEYS[type]) : type
    );
  }, [accounts, t]);

  const showMixedCurrencyNote = accounts ? hasMixedCurrencies(accounts) : false;

  const openAddForm = () => {
    setEditingAccount(null);
    setShowForm(true);
  };

  return (
    <div>
      <PageHeader
        title={t("nav.accounts")}
        subtitle={t("accounts.subtitle")}
        actions={
          <>
            <Link to="/net-worth">
              <Button
                size="sm"
                variant="outline"
                data-testid="view-net-worth-button"
              >
                {t("accounts.viewNetWorth")}
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={openAddForm}
              data-testid="add-account-button"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("accounts.addAccount")}
            </Button>
          </>
        }
      />

      {isLoading && (
        <Card className="shadow-sm rounded-lg" data-testid="accounts-skeleton">
          <CardContent className="p-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-20 bg-muted animate-pulse rounded" />
                </div>
                <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isLoading && accounts && accounts.length === 0 && !showForm && (
        <Card className="shadow-sm rounded-lg" data-testid="accounts-empty-state">
          <CardContent className="p-8 text-center">
            <Landmark
              className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3"
              aria-hidden="true"
            />
            <p className="font-medium text-foreground mb-1">
              {t("accounts.emptyTitle")}
            </p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              {t("accounts.emptyDescription")}
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button size="sm" onClick={openAddForm}>
                <Plus className="h-4 w-4 mr-1" />
                {t("accounts.addAccount")}
              </Button>
              <Link to="/net-worth">
                <Button size="sm" variant="outline" data-testid="empty-view-net-worth">
                  {t("accounts.viewNetWorth")}
                </Button>
              </Link>
              <Link to="/import">
                <Button size="sm" variant="outline" data-testid="empty-import-statement">
                  {t("accounts.importStatement")}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && accounts && accounts.length > 0 && (
        <>
          <div className="mb-4">
            <span
              className="text-[32px] font-mono font-semibold"
              data-testid="accounts-total"
            >
              {formatCurrency(grandTotal)}
            </span>
            {liabilityAccounts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span data-testid="accounts-assets-total">
                  {t("accounts.assetsTotal", {
                    amount: formatCurrency(assetsTotal),
                  })}
                </span>
                <span data-testid="accounts-debt-total">
                  {t("accounts.debtTotal", {
                    amount: formatCurrency(debtTotal),
                  })}
                </span>
              </div>
            )}
            {showMixedCurrencyNote && (
              <p
                className="mt-1 text-sm text-muted-foreground"
                data-testid="accounts-mixed-currency"
              >
                {t("accounts.mixedCurrencyNote")}
              </p>
            )}
            {netWorth.data && grandTotal > 0 && (
              <p
                className="mt-1 text-sm text-muted-foreground"
                data-testid="accounts-net-worth-context"
              >
                {t("accounts.contributesToNetWorth", {
                  amount: formatCurrency(grandTotal),
                  total: formatCurrency(netWorth.data.total_cents),
                })}{" "}
                <Link
                  to="/net-worth"
                  className="text-primary hover:underline"
                  data-testid="accounts-net-worth-link"
                >
                  {t("accounts.viewDetails")}
                </Link>
              </p>
            )}
          </div>

          {breakdown.length > 0 && (
            <div className="mb-4" data-testid="accounts-breakdown">
              <NetWorthBreakdownBar
                breakdown={breakdown}
                titleKey="accounts.breakdown"
              />
            </div>
          )}

          <Card className="shadow-sm rounded-lg" data-testid="accounts-list">
            <CardContent className="p-0 py-2">
              {assetGroups.length > 0 && (
                <div data-testid="accounts-asset-section">
                  {assetGroups.length > 0 && liabilityGroups.length > 0 && (
                    <div className="px-3 py-2 border-b border-border">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("accounts.sectionAccounts")}
                      </span>
                    </div>
                  )}
                  {assetGroups.map(([type, groupAccounts]) => (
                    <AccountTypeGroup
                      key={type}
                      type={type}
                      groupAccounts={groupAccounts}
                      onEdit={setEditingAccount}
                    />
                  ))}
                </div>
              )}
              {liabilityGroups.length > 0 && (
                <div data-testid="accounts-liability-section">
                  <div className="px-3 py-2 border-b border-border">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("accounts.sectionLiabilities")}
                    </span>
                  </div>
                  {liabilityGroups.map(([type, groupAccounts]) => (
                    <AccountTypeGroup
                      key={type}
                      type={type}
                      groupAccounts={groupAccounts}
                      onEdit={setEditingAccount}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <SlideOver
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("accounts.addAccount")}
        data-testid="account-slide-over"
      >
        <AddAccountForm onClose={() => setShowForm(false)} />
      </SlideOver>
      <SlideOver
        open={editingAccount !== null}
        onClose={() => setEditingAccount(null)}
        title={t("accounts.editAccount")}
        data-testid="edit-account-slide-over"
      >
        {editingAccount && (
          <EditAccountForm
            account={editingAccount}
            onClose={() => setEditingAccount(null)}
          />
        )}
      </SlideOver>
    </div>
  );
}
