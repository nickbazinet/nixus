import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/constants";

export function RecurringApplyListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<number>("recurring:applied", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
        queryClient.invalidateQueries({ queryKey: ["budget-status"] });
        queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
        queryClient.invalidateQueries({ queryKey: ["spending-breakdown"] });
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  return null;
}
