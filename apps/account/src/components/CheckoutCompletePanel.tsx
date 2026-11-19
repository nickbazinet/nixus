import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, CardContent } from "@nixus/shared";

import { loadEntitlement, type EntitlementView } from "@/actions/billing";
import {
  CHECKOUT_POLL_ATTEMPTS,
  CHECKOUT_POLL_INTERVAL_MS,
  capabilityLabel,
  formatPeriodEnd,
  statusLabel,
  tierDisplayName,
} from "@/lib/billing-plans";
import { billingDestination, destinationPath } from "@/server/destinations";
import type { Locale } from "@/lib/i18n";

/**
 * Stripe's `success_url` landing page (billing AD-5, AD-8, AD-11).
 *
 * Stripe returns the visitor the instant the hosted Checkout finishes, which is
 * normally BEFORE `checkout.session.completed` has reached the webhook and the
 * entitlement has converged. So this page re-reads `GET /entitlement` on a bound
 * — `CHECKOUT_POLL_ATTEMPTS` reads, `CHECKOUT_POLL_INTERVAL_MS` apart, at most
 * 12 seconds on top of the server-rendered first read — and then says one of two
 * true things.
 *
 * Exhausting the bound is NOT a failure and is never rendered as one. The
 * payment went through; Stripe said so by sending the visitor here. The honest
 * answer is that the plan is still updating, and that this page need not stay
 * open: the entitlement converges server-side whether or not anybody is looking.
 */

export function CheckoutCompletePanel({
  initial,
  locale,
}: {
  readonly initial: EntitlementView | null;
  readonly locale: Locale;
}) {
  const { t } = useTranslation();
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(initial);
  const [attempts, setAttempts] = useState(0);

  // `none` is the free entitlement a signed-in account has before the webhook
  // converges, so it is the one status that means "keep waiting". Read from
  // `status`, never from `tier` (AD-1).
  //
  // The recorded Stripe state counts too: a live override pins the effective
  // status to `none` permanently (AD-2), which left a customer who had just paid
  // watching "updating" forever. Pre-convergence it is null, so this still waits.
  const settled =
    entitlement !== null &&
    (entitlement.status !== "none" ||
      (entitlement.stripeState !== null && entitlement.stripeState.status !== "none"));
  const exhausted = attempts >= CHECKOUT_POLL_ATTEMPTS;

  useEffect(() => {
    if (settled || exhausted) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        const snapshot = await loadEntitlement();
        if (snapshot.signedIn) setEntitlement(snapshot.entitlement);
        setAttempts((taken) => taken + 1);
      })();
    }, CHECKOUT_POLL_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [settled, exhausted, attempts]);

  const message = settled
    ? t("checkout.settled")
    : exhausted
      ? entitlement === null
        ? t("checkout.unavailable")
        : t("checkout.pending")
      : t("checkout.updating");

  const periodEnd = formatPeriodEnd(entitlement?.currentPeriodEnd ?? null, locale);

  return (
    <main id="main" tabIndex={-1} className="mkt-page-x mkt-container py-10 outline-none md:py-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-section-gap">
          <h1 className="text-h1 text-ink">{t("checkout.heading")}</h1>
        </div>

        <div className="space-y-4">
          <Alert
            data-testid="checkout-state"
            data-settled={settled ? "yes" : "no"}
            variant="info"
            role="status"
            className="rounded-sm"
          >
            {message}
          </Alert>

          {settled && entitlement !== null ? (
            <Card>
              <CardContent>
                <div className="space-y-1">
                  <p className="text-caption text-ink-dim">{t("billing.currentPlan")}</p>
                  <p data-testid="checkout-tier" className="text-h3 text-ink">
                    {tierDisplayName(t, entitlement.tier)}
                  </p>
                </div>

                <div className="mt-4 space-y-1">
                  <p className="text-caption text-ink-dim">{t("billing.statusLabel")}</p>
                  <p data-testid="checkout-plan-status" className="text-body text-ink">
                    {statusLabel(t, entitlement.status)}
                  </p>
                </div>

                {periodEnd === null ? null : (
                  <div className="mt-4 space-y-1">
                    <p className="text-caption text-ink-dim">{t("billing.renewsOn")}</p>
                    <p data-testid="checkout-period-end" className="text-body text-ink">
                      {periodEnd}
                    </p>
                  </div>
                )}

                {entitlement.capabilities.length === 0 ? null : (
                  <div className="mt-4 space-y-1">
                    <p className="text-caption text-ink-dim">{t("billing.includedHeading")}</p>
                    <ul data-testid="checkout-capabilities" className="text-body text-ink">
                      {entitlement.capabilities.map((capability) => (
                        <li key={capability} data-testid={`checkout-capability-${capability}`}>
                          {capabilityLabel(t, capability)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            className="mkt-tap"
            render={
              <a
                data-testid="checkout-to-billing"
                href={destinationPath(billingDestination(locale))}
              >
                {t("checkout.backToBilling")}
              </a>
            }
          />
        </div>
      </div>
    </main>
  );
}
