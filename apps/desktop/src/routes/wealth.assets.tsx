import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Gem } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  formatMoney,
  Money,
  Skeleton,
  SlideOver,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AssetRow } from "@/components/assets/AssetRow";
import { AddAssetForm } from "@/components/assets/AddAssetForm";
import { EditAssetForm } from "@/components/assets/EditAssetForm";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { useAssets } from "@/hooks/useAssets";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  ASSET_TYPE_KEYS,
  buildAssetBreakdown,
  groupAssetsByType,
} from "@/lib/assetUtils";
import type { PassiveAsset } from "@/lib/types";

export const Route = createFileRoute("/wealth/assets")({
  component: AssetsPage,
});

// `isLoading` is true only on a cold load, where TanStack narrows `data` to `undefined` — there is
// provably nothing cached to count. Later fetches keep the real rows on screen, so a row count is
// never faked against content the app already knows.
const FALLBACK_SKELETON_ROWS = 3;

function AssetsPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<PassiveAsset | null>(null);
  const { data: assets, isLoading } = useAssets();
  const netWorth = useCurrentNetWorth();

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
          <Stat
            label={t("assets.totalLabel")}
            value={formatMoney({ cents: grandTotal, locale: i18n.language })}
            data-testid="assets-total"
            {...maskProps}
          />

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

          {breakdown.length > 0 && (
            <div data-testid="assets-breakdown">
              <NetWorthBreakdownBar
                breakdown={breakdown}
                titleKey="assets.breakdown"
              />
            </div>
          )}

          <Card flush data-testid="assets-list">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("assets.colAsset")}</TableHead>
                  <TableHead>{t("assets.colUpdated")}</TableHead>
                  <TableHead numeric>{t("assets.colValue")}</TableHead>
                  <TableHead numeric>
                    <span className="sr-only">{t("assets.colActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
                      onEdit={handleEdit}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </Card>
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

function AssetTypeGroup({
  typeLabel,
  subtotal,
  groupAssets,
  onEdit,
}: {
  typeLabel: string;
  subtotal: number;
  groupAssets: PassiveAsset[];
  onEdit: (asset: PassiveAsset) => void;
}) {
  const { i18n } = useTranslation();
  const maskProps = useMaskProps();

  return (
    <>
      <TableRow data-testid="asset-type-group" className="bg-chrome">
        <TableCell colSpan={2} className="text-label text-ink">
          {typeLabel}
        </TableCell>
        <TableCell numeric dim>
          <Money cents={subtotal} locale={i18n.language} {...maskProps} />
        </TableCell>
        <TableCell />
      </TableRow>
      {groupAssets.map((asset) => (
        <AssetRow key={asset.id} asset={asset} onEdit={onEdit} />
      ))}
    </>
  );
}
