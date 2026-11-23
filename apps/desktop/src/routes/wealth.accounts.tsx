import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChartNoAxesColumn,
  CreditCard,
  Landmark,
  Plus,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  formatMoney,
  Money,
  Skeleton,
  SlideOver,
} from "@nixus/shared";
import { MetricTile } from "@/components/shared/MetricTile";
import { PageHeader } from "@/components/shared/PageHeader";
import { AccountRow } from "@/components/accounts/AccountRow";
import { AddAccountForm } from "@/components/accounts/AddAccountForm";
import { EditAccountForm } from "@/components/accounts/EditAccountForm";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { useAccounts } from "@/hooks/useAccounts";
import { useAssets } from "@/hooks/useAssets";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  ACCOUNT_TYPE_KEYS,
  ACCOUNT_TYPE_ORDER,
  buildAccountBreakdown,
  hasMixedCurrencies,
  isLiabilityAccountType,
  netAccountPositionCents,
  partitionAccounts,
  sumBalanceCents,
  sumLiabilityOwedCents,
} from "@/lib/accountUtils";
import { stockAssetsByAccount, sumAssetValueCents } from "@/lib/assetUtils";
import type { Account, PassiveAsset } from "@/lib/types";

export const Route = createFileRoute("/wealth/accounts")({
  component: AccountsPage,
});

// `isLoading` is true only on a cold load, where TanStack narrows `data` to `undefined` — there is
// provably nothing cached to count. Later fetches keep the real rows on screen, so a row count is
// never faked against content the app already knows.
const FALLBACK_SKELETON_ROWS = 3;

/**
 * The three groups an account list reads as: the money you can spend today, the money that is
 * invested, and what you owe. Finer than this and every account type becomes its own card; coarser
 * and "cash" and "investments" — the two figures the page exists to separate — are added together.
 */
const CASH_TYPES = ["chequing", "savings"] as const;

type SectionKey = "cash" | "investments" | "credit";

interface AccountSection {
  key: SectionKey;
  labelKey: string;
  icon: LucideIcon;
  accounts: Account[];
  /** A liability section states what is owed, so its total is never signed. */
  isLiability: boolean;
}

interface CurrencyPosition {
  currency: string;
  assets: number;
  debt: number;
  net: number;
}

/**
 * CAD and USD coexist unconverted — there is no FX anywhere in this product — so every figure is
 * computed per currency instead of being added up into a number that means nothing.
 *
 * Linked holdings fold into the asset side because a holding can only be linked to a
 * base-currency account, which is the rule that keeps this sum honest.
 */
function positionsByCurrency(
  accounts: Account[],
  stocksByAccount: Map<number, PassiveAsset[]>
): CurrencyPosition[] {
  const byCurrency = new Map<string, Account[]>();
  for (const account of accounts) {
    const list = byCurrency.get(account.currency) ?? [];
    list.push(account);
    byCurrency.set(account.currency, list);
  }
  return [...byCurrency.entries()]
    .sort((first, second) => first[0].localeCompare(second[0]))
    .map(([currency, list]) => {
      const { assetAccounts, liabilityAccounts } = partitionAccounts(list);
      const assets =
        sumBalanceCents(assetAccounts) +
        sumLinkedStockValueCents(assetAccounts, stocksByAccount);
      const debt = sumLiabilityOwedCents(liabilityAccounts);
      return { currency, assets, debt, net: assets - debt };
    });
}

function sumLinkedStockValueCents(
  accounts: Account[],
  stocksByAccount: Map<number, PassiveAsset[]>
): number {
  return accounts.reduce(
    (sum, account) =>
      sum + sumAssetValueCents(stocksByAccount.get(account.id) ?? []),
    0
  );
}

function sectionKeyFor(account: Account): SectionKey {
  if (isLiabilityAccountType(account.account_type)) return "credit";
  return (CASH_TYPES as readonly string[]).includes(account.account_type)
    ? "cash"
    : "investments";
}

/** Type order first, then name: the order the account list has always read in. */
function byTypeThenName(first: Account, second: Account): number {
  const order =
    ACCOUNT_TYPE_ORDER.indexOf(
      first.account_type as (typeof ACCOUNT_TYPE_ORDER)[number]
    ) -
    ACCOUNT_TYPE_ORDER.indexOf(
      second.account_type as (typeof ACCOUNT_TYPE_ORDER)[number]
    );
  return order !== 0 ? order : first.name.localeCompare(second.name);
}

function buildSections(accounts: Account[]): AccountSection[] {
  const shape: AccountSection[] = [
    {
      key: "cash",
      labelKey: "wealth.v2.accounts.cash",
      icon: Wallet,
      accounts: [],
      isLiability: false,
    },
    {
      key: "investments",
      labelKey: "wealth.v2.accounts.investments",
      icon: ChartNoAxesColumn,
      accounts: [],
      isLiability: false,
    },
    {
      key: "credit",
      labelKey: "wealth.v2.accounts.credit",
      icon: CreditCard,
      accounts: [],
      isLiability: true,
    },
  ];

  for (const account of accounts) {
    const section = shape.find((entry) => entry.key === sectionKeyFor(account));
    section?.accounts.push(account);
  }
  for (const section of shape) section.accounts.sort(byTypeThenName);

  return shape.filter((section) => section.accounts.length > 0);
}

function AccountSectionCard({
  section,
  onEdit,
  stocksByAccount,
}: {
  section: AccountSection;
  onEdit: (account: Account) => void;
  stocksByAccount: Map<number, PassiveAsset[]>;
}) {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();

  const total = section.isLiability
    ? sumLiabilityOwedCents(section.accounts)
    : sumBalanceCents(section.accounts) +
      sumLinkedStockValueCents(section.accounts, stocksByAccount);

  return (
    <Card
      data-testid={
        section.isLiability ? "accounts-liability-section" : "account-type-group"
      }
    >
      <CardHeader>
        <CardTitle icon={section.icon}>{t(section.labelKey)}</CardTitle>
        <CardAction className="self-center pr-11">
          <span className="money text-h1 font-bold text-ink">
            <Money
              cents={total}
              locale={i18n.language}
              sign={section.isLiability ? "never" : "auto"}
              {...maskProps}
            />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul aria-label={t(section.labelKey)}>
          {section.accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onEdit={onEdit}
              stockAssets={stocksByAccount.get(account.id)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AccountsPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const { data: accounts, isLoading } = useAccounts();
  const { data: assets } = useAssets();
  const netWorth = useCurrentNetWorth();

  const stocksByAccount = useMemo(
    () =>
      assets ? stockAssetsByAccount(assets) : new Map<number, PassiveAsset[]>(),
    [assets]
  );

  const sections = useMemo(
    () => (accounts ? buildSections(accounts) : []),
    [accounts]
  );

  const liabilityAccounts = useMemo(
    () => (accounts ? partitionAccounts(accounts).liabilityAccounts : []),
    [accounts]
  );

  const grandTotal = useMemo(
    () =>
      accounts
        ? netAccountPositionCents(accounts) +
          sumLinkedStockValueCents(
            partitionAccounts(accounts).assetAccounts,
            stocksByAccount
          )
        : 0,
    [accounts, stocksByAccount]
  );

  const breakdown = useMemo(() => {
    if (!accounts || accounts.length < 2) return [];
    return buildAccountBreakdown(
      accounts,
      (type) => (ACCOUNT_TYPE_KEYS[type] ? t(ACCOUNT_TYPE_KEYS[type]) : type),
      stocksByAccount
    );
  }, [accounts, t, stocksByAccount]);

  const showMixedCurrencyNote = accounts ? hasMixedCurrencies(accounts) : false;
  const positions = useMemo(
    () => (accounts ? positionsByCurrency(accounts, stocksByAccount) : []),
    [accounts, stocksByAccount]
  );

  const cashSection = sections.find((section) => section.key === "cash");
  const investmentSection = sections.find(
    (section) => section.key === "investments"
  );
  const cashCents = cashSection
    ? sumBalanceCents(cashSection.accounts) +
      sumLinkedStockValueCents(cashSection.accounts, stocksByAccount)
    : 0;
  const investmentsCents = investmentSection
    ? sumBalanceCents(investmentSection.accounts) +
      sumLinkedStockValueCents(investmentSection.accounts, stocksByAccount)
    : 0;

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
              variant="outline"
              onClick={openAddForm}
              data-testid="add-account-button"
            >
              <Plus aria-hidden="true" />
              {t("accounts.addAccount")}
            </Button>
            <Button
              size="sm"
              render={<Link to="/import" />}
              data-testid="accounts-import-button"
            >
              {t("wealth.v2.importStatement")}
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
          {showMixedCurrencyNote ? (
            // No single hero figure exists here: adding CAD to USD would invent an exchange rate.
            <div className="flex flex-col gap-grid-gap">
              {positions.map((position) => (
                <div
                  key={position.currency}
                  className="grid gap-grid-gap md:grid-cols-2"
                  data-testid="accounts-currency-position"
                >
                  <MetricTile
                    icon={Wallet}
                    label={t("accounts.haveInCurrency", {
                      currency: position.currency,
                    })}
                    value={formatMoney({
                      cents: position.assets,
                      currency: position.currency,
                      locale: i18n.language,
                    })}
                    data-testid="accounts-total"
                  />
                  {liabilityAccounts.length > 0 && (
                    <MetricTile
                      icon={CreditCard}
                      label={t("accounts.oweInCurrency", {
                        currency: position.currency,
                      })}
                      value={formatMoney({
                        cents: position.debt,
                        currency: position.currency,
                        locale: i18n.language,
                        sign: "never",
                      })}
                      data-testid="accounts-debt-total"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-grid-gap md:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                featured
                icon={Landmark}
                label={t("wealth.v2.accounts.haveLabel")}
                value={
                  <Money
                    cents={positions[0]?.assets ?? 0}
                    locale={i18n.language}
                    {...maskProps}
                  />
                }
                caption={t("wealth.v2.accounts.haveCaption")}
                data-testid="accounts-total"
              />
              <MetricTile
                icon={Wallet}
                label={t("wealth.v2.accounts.cash")}
                value={
                  <Money
                    cents={cashCents}
                    locale={i18n.language}
                    {...maskProps}
                  />
                }
                caption={t("wealth.v2.accounts.accountCount", {
                  count: cashSection?.accounts.length ?? 0,
                })}
                data-testid="accounts-cash-total"
              />
              <MetricTile
                icon={ChartNoAxesColumn}
                label={t("wealth.v2.accounts.investments")}
                value={
                  <Money
                    cents={investmentsCents}
                    locale={i18n.language}
                    {...maskProps}
                  />
                }
                caption={t("wealth.v2.accounts.accountCount", {
                  count: investmentSection?.accounts.length ?? 0,
                })}
                data-testid="accounts-investments-total"
              />
              {liabilityAccounts.length > 0 && (
                <MetricTile
                  icon={CreditCard}
                  label={t("wealth.v2.accounts.owed")}
                  value={
                    <Money
                      cents={positions[0]?.debt ?? 0}
                      locale={i18n.language}
                      sign="never"
                      {...maskProps}
                    />
                  }
                  caption={t("wealth.v2.accounts.accountCount", {
                    count: liabilityAccounts.length,
                  })}
                  data-testid="accounts-debt-total"
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-grid-gap">
            {sections.map((section) => (
              <AccountSectionCard
                key={section.key}
                section={section}
                onEdit={setEditingAccount}
                stocksByAccount={stocksByAccount}
              />
            ))}

            {breakdown.length > 0 && (
              <div data-testid="accounts-breakdown">
                <NetWorthBreakdownBar
                  breakdown={breakdown}
                  titleKey="accounts.breakdown"
                />
              </div>
            )}

            {netWorth.data && !showMixedCurrencyNote && grandTotal > 0 && (
              <p
                className="text-caption text-ink-dim"
                data-testid="accounts-net-worth-context"
              >
                {t("accounts.contributesToNetWorth", {
                  amount: formatMoney({
                    cents: grandTotal,
                    locale: i18n.language,
                  }),
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
          </div>
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
