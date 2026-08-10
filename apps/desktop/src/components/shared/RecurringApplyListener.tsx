import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/constants";

export function RecurringApplyListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let unlistenExpenses: (() => void) | undefined;
    let unlistenIncome: (() => void) | undefined;

    const setup = async () => {
      unlistenExpenses = await listen<number>("recurring:applied", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
        queryClient.invalidateQueries({ queryKey: ["budget-status"] });
        queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
        queryClient.invalidateQueries({ queryKey: ["spending-breakdown"] });
      });

      unlistenIncome = await listen<number>("recurring-income:applied", () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.incomeSources });
        queryClient.invalidateQueries({ queryKey: ["income-entries"] });
        queryClient.invalidateQueries({ queryKey: ["income-entries-by-month"] });
        queryClient.invalidateQueries({ queryKey: ["income-total"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
        queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
        queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
        queryClient.invalidateQueries({ queryKey: queryKeys.financialHealth });
        queryClient.invalidateQueries({ queryKey: ["budget-summary"] });
        // A backfill can write entries into past months, so year- and projection-scoped
        // aggregates go stale too, not just the current month.
        queryClient.invalidateQueries({ queryKey: ["yearly-summary"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.projectionInput });
      });
    };

    setup();

    return () => {
      unlistenExpenses?.();
      unlistenIncome?.();
    };
  }, [queryClient]);

  return null;
}
