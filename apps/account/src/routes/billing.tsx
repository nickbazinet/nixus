import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadAccountPage } from "@/actions/page";
import { AccountPage } from "@/components/AccountPage";
import { billingLoginLocation } from "@/server/destinations";

/**
 * `GET /billing` (billing AD-8).
 *
 * `?plan=<lookup_key>` is the marketing site's pricing-page deep link. It is
 * narrowed to a string here and validated against the loaded catalog inside the
 * panel; an unknown or malformed value renders an ordinary page and is never
 * echoed, so `validateSearch` must not throw on anything.
 */
export const Route = createFileRoute("/billing")({
  // The member is OMITTED rather than nulled when absent, because a narrowed
  // search object the router cannot round-trip makes it redirect to a canonical
  // url: `GET /billing` would answer `/billing?plan=null`, which is both ugly
  // and an extra hop in front of the sign-in gate.
  validateSearch: (search: Record<string, unknown>): { plan?: string } =>
    typeof search.plan === "string" ? { plan: search.plan } : {},
  loader: async () => {
    const data = await loadAccountPage("en");
    // Thrown from the loader, so SSR answers with a redirect and the browser
    // never renders a billing shell it would immediately replace.
    if (!data.account.signedIn || !data.billing.signedIn) {
      throw redirect({ href: billingLoginLocation("en") });
    }
    return data;
  },
  // The only client-side navigations here are the section menu's hash changes,
  // which must not re-read the account.
  staleTime: Infinity,
  head: () => ({
    meta: [
      { title: "Plan and billing — Nixus Cloud account" },
      {
        name: "description",
        content: "View your Nixus Cloud plan, change it, or cancel it.",
      },
    ],
  }),
  component: EnglishBilling,
});

function EnglishBilling() {
  const { account, billing } = Route.useLoaderData();
  return (
    <AccountPage
      account={account}
      billing={billing}
      locale="en"
      initialSection="subscription"
      planParam={Route.useSearch().plan ?? null}
    />
  );
}
