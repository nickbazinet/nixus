import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { useRefreshStockPrices } from "@/hooks/useAssets";

/**
 * The on-demand refresh. A partial failure is reported per symbol rather than as one "refresh
 * failed", because the holdings that DID price are already updated on screen behind the toast.
 */
export function RefreshStockPricesButton() {
  const { t } = useTranslation();
  const refreshPrices = useRefreshStockPrices();

  const handleRefresh = () => {
    refreshPrices.mutate(undefined, {
      onSuccess: (results) => {
        // An empty array means the pass did nothing at all — throttled, or overlapping another
        // refresh. Reporting "Prices updated" for it would claim work that never happened.
        if (results.length === 0) {
          toast.info(t("assets.stockRefreshSkipped"));
          return;
        }

        const failed = results.filter((result) => !result.ok);
        if (failed.length > 0) {
          toast.warning(
            t("assets.stockRefreshPartial", {
              symbols: failed.map((result) => result.symbol).join(", "),
            })
          );
          return;
        }
        toast.success(t("assets.stockRefreshDone"));
      },
      onError: () => {
        toast.error(t("assets.stockRefreshFailed"));
      },
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleRefresh}
      disabled={refreshPrices.isPending}
      data-testid="refresh-stock-prices-button"
    >
      <RefreshCw aria-hidden="true" />
      {refreshPrices.isPending
        ? t("assets.stockRefreshing")
        : t("assets.stockRefresh")}
    </Button>
  );
}
