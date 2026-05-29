import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Gem } from "lucide-react";
import { Button } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AssetRow } from "@/components/assets/AssetRow";
import { AddAssetForm } from "@/components/assets/AddAssetForm";
import { EditAssetForm } from "@/components/assets/EditAssetForm";
import { NetWorthBreakdownBar } from "@/components/net-worth/NetWorthBreakdownBar";
import { useAssets } from "@/hooks/useAssets";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  ASSET_TYPE_KEYS,
  buildAssetBreakdown,
  groupAssetsByType,
} from "@/lib/assetUtils";
import { SlideOver } from "@nixus/shared";
import type { PassiveAsset } from "@/lib/types";

export const Route = createFileRoute("/assets")({
  component: AssetsPage,
});

function AssetsPage() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
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
            <Link to="/net-worth">
              <Button
                size="sm"
                variant="outline"
                data-testid="view-net-worth-button"
              >
                {t("assets.viewNetWorth")}
              </Button>
            </Link>
            <Button size="sm" onClick={openAddForm} data-testid="add-asset-button">
              <Plus className="h-4 w-4 mr-1" />
              {t("assets.addAsset")}
            </Button>
          </>
        }
      />

      {isLoading && (
        <Card className="shadow-sm rounded-lg" data-testid="assets-skeleton">
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

      {!isLoading && assets && assets.length === 0 && !showForm && (
        <Card className="shadow-sm rounded-lg" data-testid="assets-empty-state">
          <CardContent className="p-8 text-center">
            <Gem
              className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3"
              aria-hidden="true"
            />
            <p className="font-medium text-foreground mb-1">
              {t("assets.emptyTitle")}
            </p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              {t("assets.emptyDescription")}
            </p>
            <div className="flex gap-2 justify-center">
              <Button size="sm" onClick={openAddForm}>
                <Plus className="h-4 w-4 mr-1" />
                {t("assets.addAsset")}
              </Button>
              <Link to="/net-worth">
                <Button size="sm" variant="outline" data-testid="empty-view-net-worth">
                  {t("assets.viewNetWorth")}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && assets && assets.length > 0 && (
        <>
          <div className="mb-4">
            <span
              className="text-[32px] font-mono font-semibold"
              data-testid="assets-total"
            >
              {formatCurrency(grandTotal)}
            </span>
            {netWorth.data && grandTotal > 0 && (
              <p
                className="mt-1 text-sm text-muted-foreground"
                data-testid="assets-net-worth-context"
              >
                {t("assets.contributesToNetWorth", {
                  amount: formatCurrency(grandTotal),
                  total: formatCurrency(netWorth.data.total_cents),
                })}{" "}
                <Link
                  to="/net-worth"
                  className="text-primary hover:underline"
                  data-testid="assets-net-worth-link"
                >
                  {t("assets.viewDetails")}
                </Link>
              </p>
            )}
          </div>

          {breakdown.length > 0 && (
            <div className="mb-4" data-testid="assets-breakdown">
              <NetWorthBreakdownBar
                breakdown={breakdown}
                titleKey="assets.breakdown"
              />
            </div>
          )}

          <Card className="shadow-sm rounded-lg" data-testid="assets-list">
            <CardContent className="p-0 py-2">
              {groupedAssets.map(([type, groupAssets]) => {
                const subtotal = groupAssets.reduce(
                  (sum, a) => sum + a.value_cents,
                  0
                );
                const typeLabel = ASSET_TYPE_KEYS[type]
                  ? t(ASSET_TYPE_KEYS[type])
                  : type;

                return (
                  <div key={type} data-testid="asset-type-group">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border mb-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {typeLabel}
                      </span>
                      <span className="text-xs font-medium font-mono text-muted-foreground">
                        {formatCurrency(subtotal)}
                      </span>
                    </div>
                    {groupAssets.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        onEdit={handleEdit}
                      />
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      <SlideOver
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("assets.addAsset")}
        data-testid="asset-slide-over"
      >
        <AddAssetForm onClose={() => setShowForm(false)} />
      </SlideOver>
      <SlideOver
        open={editingAsset !== null}
        onClose={() => setEditingAsset(null)}
        title={t("assets.editAsset")}
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
