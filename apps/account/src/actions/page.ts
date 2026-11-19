import { loadAccountView } from "./account";
import { loadBillingView, type BillingView } from "./billing";
import type { AccountView } from "./gate";

export interface AccountPageData {
  readonly account: AccountView;
  readonly billing: BillingView;
}

/**
 * Both halves of the account page, read in parallel. Each degrades on its own:
 * a billing read that failed still leaves the profile editable, and the other
 * way round.
 */
export async function loadAccountPage(locale: "en" | "fr"): Promise<AccountPageData> {
  const [account, billing] = await Promise.all([
    loadAccountView({ data: { locale } }),
    loadBillingView(),
  ]);
  return { account, billing };
}
