import { useEffect, useState } from "react";

import {
  EMPTY_PLAN_CATALOG,
  loadPlanCatalog,
  type PlanCatalog,
} from "./planCatalog";

/**
 * Subscribe a component to the live plan catalog.
 *
 * The initial state is deliberately empty, so the prerender pass and the first
 * client render produce byte-identical markup carrying the baked prices — the
 * fetch is reached only from the effect, which neither the prerender nor
 * hydration runs. That is what keeps `crawlLinks` prerendering free of any
 * runtime API dependency and keeps hydration mismatch-free.
 *
 * A failed or slow load simply never updates the state. There is no error
 * member to render a banner from and no loading member to render a spinner
 * from, because the correct page in both cases is the one already on screen.
 */
export function usePlanCatalog(): PlanCatalog {
  const [catalog, setCatalog] = useState<PlanCatalog>(EMPTY_PLAN_CATALOG);

  useEffect(() => {
    const controller = new AbortController();
    let subscribed = true;

    void loadPlanCatalog(controller.signal).then((next) => {
      if (subscribed && next !== null) setCatalog(next);
    });

    return () => {
      subscribed = false;
      controller.abort();
    };
  }, []);

  return catalog;
}
