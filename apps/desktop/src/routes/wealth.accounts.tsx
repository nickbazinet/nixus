import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Landmark } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EmptyState,
  formatMoney,
  Money,
  Skeleton,
  SlideOver,
  Stat,
  SubStat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AccountRow } from "@/components/accounts/AccountRow";
import { AddAccountForm } from "@/components/accounts/AddAccountForm";
import { EditAccountForm } from "@/components/accounts/EditAccountForm";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { useAccounts } from "@/hooks/useAccounts";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  ACCOUNT_TYPE_KEYS,
  buildAccountBreakdown,
  groupAccountsBySection,
  hasMixedCurrencies,
  isLiabilityAccountType,
  netAccountPositionCents,
  owedBalanceCents,
  partitionAccounts,
  sumBalanceCents,
  sumLiabilityOwedCents,
} from "@/lib/accountUtils";
import type { Account } from "@/lib/types";

export const Route = createFileRoute("/wealth/accounts")({
  component: AccountsPage,
});

// `isLoading` is true only on a cold load, where TanStack narrows `data` to `undefined` — there is
// provably nothing cached to count. Later fetches keep the real rows on screen, so a row count is
// never faked against content the app already knows.
const FALLBACK_SKELETON_ROWS = 3;

/**
 * CAD and USD coexist unconverted — there is no FX anywhere in this product — so a mixed-currency
 * position is reported per currency instead of being added up into a number that means nothing.
 */
function netPositionByCurrency(accounts: Account[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    const signed = isLiabilityAccountType(account.account_type)
      ? -owedBalanceCents(account.balance_cents)
      : account.balance_cents;
    totals.set(account.currency, (totals.get(account.currency) ?? 0) + signed);
  }
  return [...totals.entries()].sort((first, second) =>
    first[0].localeCompare(second[0])
  );
}

function AccountTypeGroup({
  type,
  groupAccounts,
  onEdit,
}: {
  type: string;
  groupAccounts: Account[];
  onEdit: (account: Account) => void;
}) {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const isLiability = isLiabilityAccountType(type);
  const subtotal = isLiability
    ? sumLiabilityOwedCents(groupAccounts)
    : sumBalanceCents(groupAccounts);

  return (
    <>
      <TableRow data-testid="account-type-group" className="bg-chrome">
        <TableCell colSpan={2} className="text-label text-ink">
          {ACCOUNT_TYPE_KEYS[type] ? t(ACCOUNT_TYPE_KEYS[type]) : type}
        </TableCell>
        <TableCell numeric dim>
          <Money
            cents={subtotal}
            locale={i18n.language}
            sign={isLiability ? "never" : "auto"}
            {...maskProps}
          />
        </TableCell>
        <TableCell />
      </TableRow>
      {groupAccounts.map((account) => (
        <AccountRow key={account.id} account={account} onEdit={onEdit} />
      ))}
    </>
  );
}

function AccountsPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const { data: accounts, isLoading } = useAccounts();
  const netWorth = useCurrentNetWorth();

  const { assetGroups, liabilityGroups } = useMemo(
    () =>
      accounts
        ? groupAccountsBySection(accounts)
        : { assetGroups: [], liabilityGroups: [] },
    [accounts]
  );

  const { assetAccounts, liabilityAccounts } = useMemo(
    () =>
      accounts
        ? partitionAccounts(accounts)
        : { assetAccounts: [], liabilityAccounts: [] },
    [accounts]
  );

  const grandTotal = useMemo(
    () => (accounts ? netAccountPositionCents(accounts) : 0),
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
  const perCurrency = useMemo(
    () => (accounts && showMixedCurrencyNote ? netPositionByCurrency(accounts) : []),
    [accounts, showMixedCurrencyNote]
  );

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
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/wealth/net-worth" />}
              data-testid="view-net-worth-button"
            >
              {t("accounts.viewNetWorth")}
            </Button>
            <Button
              size="sm"
              onClick={openAddForm}
              data-testid="add-account-button"
            >
              <Plus aria-hidden="true" />
              {t("accounts.addAccount")}
            </Button>
          </>
        }
      />

      {isLoading && (
        <Card data-testid="accounts-skeleton">
          <CardContent>
            <Skeleton rows={FALLBACK_SKELETON_ROWS} />
          </CardContent>
        </Card>
      )}

      {!isLoading && accounts && accounts.length === 0 && !showForm && (
        <Card data-testid="accounts-empty-state">
          <CardContent>
            <EmptyState
              icon={<Landmark />}
              title={t("accounts.emptyTitle")}
              description={t("accounts.emptyDescription")}
              action={
                <Button size="sm" onClick={openAddForm}>
                  <Plus aria-hidden="true" />
                  {t("accounts.addAccount")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && accounts && accounts.length > 0 && (
        <div className="flex flex-col gap-section-gap">
          <div className="grid grid-cols-1 gap-grid-gap min-[1100px]:grid-cols-3">
            {showMixedCurrencyNote ? (
              // No single hero figure exists here: adding CAD to USD would invent an exchange rate.
              perCurrency.map(([currency, cents]) => (
                <SubStat
                  key={currency}
                  label={t("accounts.positionInCurrency", { currency })}
                  value={formatMoney({
                    cents,
                    currency,
                    locale: i18n.language,
                    showCurrencyCode: true,
                  })}
                  data-testid="accounts-total"
                  {...maskProps}
                />
              ))
            ) : (
              <Stat
                label={t("accounts.totalLabel")}
                value={formatMoney({
                  cents: grandTotal,
                  locale: i18n.language,
                })}
                data-testid="accounts-total"
                {...maskProps}
              />
            )}
            {liabilityAccounts.length > 0 && (
              <>
                <SubStat
                  label={t("accounts.assetsTotalLabel")}
                  value={formatMoney({
                    cents: assetsTotal,
                    locale: i18n.language,
                  })}
                  data-testid="accounts-assets-total"
                  {...maskProps}
                />
                <SubStat
                  label={t("accounts.debtTotalLabel")}
                  value={formatMoney({
                    cents: debtTotal,
                    locale: i18n.language,
                    sign: "never",
                  })}
                  data-testid="accounts-debt-total"
                  {...maskProps}
                />
              </>
            )}
          </div>

          {showMixedCurrencyNote && (
            <p className="text-caption text-ink-dim" data-testid="accounts-mixed-currency">
              {t("accounts.mixedCurrencyNote")}
            </p>
          )}

          {netWorth.data && !showMixedCurrencyNote && grandTotal > 0 && (
            <p className="text-caption text-ink-dim" data-testid="accounts-net-worth-context">
              {t("accounts.contributesToNetWorth", {
                amount: formatMoney({ cents: grandTotal, locale: i18n.language }),
                total: formatMoney({
                  cents: netWorth.data.total_cents,
                  locale: i18n.language,
                }),
              })}{" "}
              <Link
                to="/wealth/net-worth"
                className="text-brand-ink underline underline-offset-2"
                data-testid="accounts-net-worth-link"
              >
                {t("accounts.viewDetails")}
              </Link>
            </p>
          )}

          {/* Stated where the editing actually happens: balances are typed in, and nothing in the
           * app moves them, so a linked expense never silently double-counts against one. */}
          <Alert variant="info">
            <AlertDescription>{t("accounts.manualBalanceNote")}</AlertDescription>
          </Alert>

          {breakdown.length > 0 && (
            <div data-testid="accounts-breakdown">
              <NetWorthBreakdownBar
                breakdown={breakdown}
                titleKey="accounts.breakdown"
              />
            </div>
          )}

          <Card flush data-testid="accounts-list">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accounts.colAccount")}</TableHead>
                  <TableHead>{t("accounts.colUpdated")}</TableHead>
                  <TableHead numeric>{t("accounts.colBalance")}</TableHead>
                  <TableHead numeric>
                    <span className="sr-only">{t("accounts.colActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assetGroups.length > 0 &&
                  assetGroups.map(([type, groupAccounts]) => (
                    <AccountTypeGroup
                      key={type}
                      type={type}
                      groupAccounts={groupAccounts}
                      onEdit={setEditingAccount}
                    />
                  ))}
                {liabilityGroups.length > 0 && (
                  <TableRow data-testid="accounts-liability-section">
                    <TableCell colSpan={4} className="text-label text-ink">
                      {t("accounts.sectionLiabilities")}
                    </TableCell>
                  </TableRow>
                )}
                {liabilityGroups.map(([type, groupAccounts]) => (
                  <AccountTypeGroup
                    key={type}
                    type={type}
                    groupAccounts={groupAccounts}
                    onEdit={setEditingAccount}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      <SlideOver
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("accounts.addAccount")}
        description={t("accounts.addAccountDescription")}
        data-testid="account-slide-over"
      >
        <AddAccountForm onClose={() => setShowForm(false)} />
      </SlideOver>
      <SlideOver
        open={editingAccount !== null}
        onClose={() => setEditingAccount(null)}
        title={t("accounts.editAccount")}
        description={t("accounts.editAccountDescription")}
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
