import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { clearProfileScopedState } from "@/lib/datasetSwitch";

// `dataset:switched` is the universal backend-switch boundary: the picker's own
// mutation also clears the cache, but only this event covers every swap, including
// ones the picker never initiated. Duplicate clearing is harmless.
export function DatasetSwitchListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cleaned = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlisten = await listen("dataset:switched", () => {
        clearProfileScopedState(queryClient);
      });

      // StrictMode unmounts and remounts before this promise resolves, so a
      // listener that lands after cleanup must tear itself down instead of
      // leaking a second subscription for the app's lifetime.
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
