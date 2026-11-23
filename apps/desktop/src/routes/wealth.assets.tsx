import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChartNoAxesColumn, CreditCard, Gem, House, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Money,
  Skeleton,
  SlideOver,
  formatMoney,
} from "@nixus/shared";
import { DonutBreakdown, type DonutItem } from "@/components/charts/DonutBreakdown";
import { MetricTile } from "@/components/shared/MetricTile";
import { PageHeader } from "@/components/shared/PageHeader";
import { AssetRow } from "@/components/assets/AssetRow";
import { AddAssetForm } from "@/components/assets/AddAssetForm";
import { EditAssetForm } from "@/components/assets/EditAssetForm";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { RefreshStockPricesButton } from "@/components/assets/RefreshStockPricesButton";
import { useAccounts } from "@/hooks/useAccounts";
import { useAssets } from "@/hooks/useAssets";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  isLiabilityAccountType,
  partitionAccounts,
  sumBalanceCents,
  sumLiabilityOwedCents,
} from "@/lib/accountUtils";
import {
  ASSET_TYPE_KEYS,
  buildAssetBreakdown,
  groupAssetsByType,
  STOCK_ASSET_TYPE,
} from "@/lib/assetUtils";
import type { Account, PassiveAsset } from "@/lib/types";

export const Route = createFileRoute("/wealth/assets")({
  component: AssetsPage,
});

// `isLoading` is true only on a cold load, where TanStack narrows `data` to `undefined` — there is
// provably nothing cached to count. Later fetches keep the real rows on screen, so a row count is
// never faked against content the app already knows.
const FALLBACK_SKELETON_ROWS = 3;

/** The account types that are money you can spend today rather than money that is invested. */
const CASH_TYPES = ["chequing", "savings"] as const;

function isCashAccount(account: Account): boolean {
  return (CASH_TYPES as readonly string[]).includes(account.account_type);
}

function AssetsPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<PassiveAsset | null>(null);
  const { data: assets, isLoading } = useAssets();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const netWorth = useCurrentNetWorth();
  const hasStock = useMemo(
    () => (assets ?? []).some((asset) => asset.asset_type === STOCK_ASSET_TYPE),
    [assets]
  );

  const groupedAssets = useMemo(
    () => (assets ? groupAssetsByType(assets) : []),
    [assets]
  );

  const grandTotal = useMemo(
    () => (assets ? assets.reduce((sum, a) => sum + a.value_cents, 0) : 0),
    [assets]
  );

  const breakdown = useMemo(() => {
    if (!assets || assets.length < 2) return [];
    return buildAssetBreakdown(assets, (type) =>
      ASSET_TYPE_KEYS[type] ? t(ASSET_TYPE_KEYS[type]) : type
    );
  }, [assets, t]);

  // The accounts side of the picture, so "everything together" is the whole of what the user owns
  // rather than only the half this surface edits.
  const { cashCents, investmentsCents, owedCents } = useMemo(() => {
    const { assetAccounts } = partitionAccounts(accounts);
    return {
      cashCents: sumBalanceCents(assetAccounts.filter(isCashAccount)),
      investmentsCents: sumBalanceCents(
        assetAccounts.filter((account) => !isCashAccount(account))
      ),
      owedCents: sumLiabilityOwedCents(
        accounts.filter((account) => isLiabilityAccountType(account.account_type))
      ),
    };
  }, [accounts]);

  // Every holding in one donut: the asset types this surface owns, plus the two account groups.
  const donutItems = useMemo<DonutItem[]>(() => {
    const items: DonutItem[] = groupedAssets.map(([type, groupAssets]) => ({
      key: `asset-${type}`,
      label: ASSET_TYPE_KEYS[type] ? t(ASSET_TYPE_KEYS[type]) : type,
      cents: groupAssets.reduce((sum, asset) => sum + asset.value_cents, 0),
    }));
    items.push({
      key: "accounts-investments",
      label: t("wealth.v2.accounts.investments"),
      cents: investmentsCents,
    });
    items.push({
      key: "accounts-cash",
      label: t("wealth.v2.accounts.cash"),
      cents: cashCents,
    });
    return items;
  }, [groupedAssets, cashCents, investmentsCents, t]);

  const handleEdit = (asset: PassiveAsset) => {
    setShowForm(false);
    setEditingAsset(asset);
  };

  const openAddForm = () => {
    setEditingAsset(null);
    setShowForm(true);
  };

  return (
    <div>
      <PageHeader
        title={t("nav.assets")}
        subtitle={t("assets.subtitle")}
        actions={
          <>
            {hasStock && <RefreshStockPricesButton />}
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/wealth/net-worth" />}
              data-testid="view-net-worth-button"
            >
              {t("assets.viewNetWorth")}
            </Button>
            <Button size="sm" onClick={openAddForm} data-testid="add-asset-button">
              <Plus aria-hidden="true" />
              {t("assets.addAsset")}
            </Button>
          </>
        }
      />

      {isLoading && (
        <Card data-testid="assets-skeleton">
          <CardContent>
            <Skeleton rows={FALLBACK_SKELETON_ROWS} />
          </CardContent>
        </Card>
      )}

      {!isLoading && assets && assets.length === 0 && !showForm && (
        <Card data-testid="assets-empty-state">
          <CardContent>
            <EmptyState
              icon={<Gem />}
              title={t("assets.emptyTitle")}
              description={t("assets.emptyDescription")}
              action={
                <Button size="sm" onClick={openAddForm}>
                  <Plus aria-hidden="true" />
                  {t("assets.addAsset")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && assets && assets.length > 0 && (
        <div className="flex flex-col gap-section-gap">
          <div className="grid gap-grid-gap md:grid-cols-3">
            <MetricTile
              featured
              icon={House}
              label={t("wealth.v2.assets.youOwn")}
              value={
                <Money
                  cents={grandTotal}
                  locale={i18n.language}
                  {...maskProps}
                />
              }
              caption={t("wealth.v2.assets.youOwnCaption")}
              data-testid="assets-total"
            />
            <MetricTile
              icon={ChartNoAxesColumn}
              label={t("wealth.v2.accounts.haveCaption")}
              value={
                <Money
                  cents={cashCents + investmentsCents}
                  locale={i18n.language}
                  {...maskProps}
                />
              }
              caption={t("wealth.v2.assets.countedInNetWorth")}
              data-testid="assets-accounts-total"
            />
            <MetricTile
              icon={CreditCard}
              label={t("wealth.v2.assets.owe")}
              value={
                <Money
                  cents={owedCents}
                  locale={i18n.language}
                  sign="never"
                  {...maskProps}
                />
              }
              caption={t("wealth.v2.accounts.credit")}
              data-testid="assets-owed-total"
            />
          </div>

          <div className="grid items-start gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-grid-gap">
              {groupedAssets.map(([type, groupAssets]) => {
                const subtotal = groupAssets.reduce(
                  (sum, a) => sum + a.value_cents,
                  0
                );
                const typeLabel = ASSET_TYPE_KEYS[type]
                  ? t(ASSET_TYPE_KEYS[type])
                  : type;

                return (
                  <AssetTypeGroup
                    key={type}
                    typeLabel={typeLabel}
                    subtotal={subtotal}
                    groupAssets={groupAssets}
                    compact={type === STOCK_ASSET_TYPE}
                    onEdit={handleEdit}
                  />
                );
              })}

              <Button
                variant="outline"
                className="self-start"
                onClick={openAddForm}
                data-testid="assets-add-inline"
              >
                <Plus aria-hidden="true" />
                {t("assets.addAsset")}
              </Button>
            </div>

            <Card className="lg:sticky lg:top-grid-gap" data-testid="assets-donut">
              <CardHeader>
                <CardTitle icon={ChartNoAxesColumn}>
                  {t("wealth.v2.assets.everythingTogether")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DonutBreakdown
                  items={donutItems}
                  centerLabel={t("wealth.v2.assets.grossLabel")}
                  listLabel={t("wealth.v2.assets.everythingTogether")}
                />
              </CardContent>
            </Card>
          </div>

          {breakdown.length > 0 && (
            <div data-testid="assets-breakdown">
              <NetWorthBreakdownBar
                breakdown={breakdown}
                titleKey="assets.breakdown"
              />
            </div>
          )}

          {netWorth.data && grandTotal > 0 && (
            <p
              className="text-caption text-ink-dim"
              data-testid="assets-net-worth-context"
            >
              {t("assets.contributesToNetWorth", {
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
                data-testid="assets-net-worth-link"
              >
                {t("assets.viewDetails")}
              </Link>
            </p>
          )}
        </div>
      )}

      <SlideOver
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("assets.addAsset")}
        description={t("assets.addAssetDescription")}
        data-testid="asset-slide-over"
      >
        <AddAssetForm onClose={() => setShowForm(false)} />
      </SlideOver>
      <SlideOver
        open={editingAsset !== null}
        onClose={() => setEditingAsset(null)}
        title={t("assets.editAsset")}
        description={t("assets.editAssetDescription")}
        data-testid="edit-asset-slide-over"
      >
        {editingAsset && (
          <EditAssetForm
            key={editingAsset.id}
            asset={editingAsset}
            onClose={() => setEditingAsset(null)}
          />
        )}
      </SlideOver>
    </div>
  );
}

/**
 * The assets of one type, under a quiet header that names the type and sums it. The header is a
 * label rather than a card of its own, so the asset cards below it stay the thing being read.
 */
function AssetTypeGroup({
  typeLabel,
  subtotal,
  groupAssets,
  compact,
  onEdit,
}: {
  typeLabel: string;
  subtotal: number;
  groupAssets: PassiveAsset[];
  /** Holdings that can run to dozens share one card of dense lines instead of a card each. */
  compact: boolean;
  onEdit: (asset: PassiveAsset) => void;
}) {
  const { i18n } = useTranslation();
  const maskProps = useMaskProps();

  return (
    <section className="flex flex-col gap-3" data-testid="asset-type-group">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-h3 text-ink-dim">{typeLabel}</h2>
        <span className="money text-label font-bold text-ink-dim">
          <Money cents={subtotal} locale={i18n.language} {...maskProps} />
        </span>
      </div>
      {compact ? (
        <Card flush className="divide-y divide-line">
          {groupAssets.map((asset) => (
            <AssetRow key={asset.id} asset={asset} onEdit={onEdit} compact />
          ))}
        </Card>
      ) : (
        groupAssets.map((asset) => (
          <AssetRow key={asset.id} asset={asset} onEdit={onEdit} />
        ))
      )}
    </section>
  );
}
