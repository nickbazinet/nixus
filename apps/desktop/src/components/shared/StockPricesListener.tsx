import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAssetsAndNetWorth } from "@/hooks/useAssets";

/** Must match `commands::stock::STOCK_PRICES_UPDATED_EVENT`. */
export const STOCK_PRICES_UPDATED_EVENT = "stock-prices-updated";

// The startup price refresh runs in a background Rust task, so nothing in the UI initiated it and
// no mutation's `onSuccess` can invalidate for it. This listener is the only path by which the
// assets page and net worth update without a reload.
export function StockPricesListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlisten = await listen(STOCK_PRICES_UPDATED_EVENT, () => {
        invalidateAssetsAndNetWorth(queryClient);
      });

      // StrictMode unmounts and remounts before this promise resolves, so a listener that lands
      // after cleanup must tear itself down instead of leaking a second subscription.
      if (cleaned) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };

    setup();

    return () => {
      cleaned = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [queryClient]);

  return null;
}
