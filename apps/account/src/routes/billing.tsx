import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadBillingView } from "@/actions/billing";
import { BillingPanel } from "@/components/BillingPanel";
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
    const view = await loadBillingView();
    // Thrown from the loader, so SSR answers with a redirect and the browser
    // never renders a billing shell it would immediately replace.
    if (!view.signedIn) throw redirect({ href: billingLoginLocation("en") });
    return view;
  },
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
  return (
    <BillingPanel
      view={Route.useLoaderData()}
      locale="en"
      planParam={Route.useSearch().plan ?? null}
    />
  );
}
