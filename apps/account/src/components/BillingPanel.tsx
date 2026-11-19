import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, CardContent, Input, Label } from "@nixus/shared";
import type { PlanCatalogEntry } from "@nixus/shared";

import {
  openPortal,
  startCheckout,
  type BillingView,
  type OpenPortalResponse,
  type StartCheckoutResponse,
} from "@/actions/billing";
import {
  capabilityLabel,
  formatPeriodEnd,
  formatPlanPrice,
  resolvePlanDeepLink,
  statusLabel,
  tierDisplayName,
} from "@/lib/billing-plans";
import { billingDestinationKey, type Locale } from "@/lib/i18n";
import { billingRefusalText } from "@/lib/messages";

/**
 * The billing surface (billing AD-8, AD-12, AD-16, AD-18).
 *
 * Three things this component is NOT allowed to do, and does not:
 *
 *  - **Render a card field.** Checkout and the Customer Portal are Stripe-hosted
 *    without exception, so every paid action here is a redirect out. There is no
 *    Elements mount, no embedded Checkout and no payment input of any kind.
 *  - **Decide where a paid action goes.** `startCheckout` answers with a
 *    `destination`, and an account that already has a live subscription is sent
 *    to the portal BY THE SERVER (AD-18). This page opens the url it is handed.
 *  - **Branch on the tier.** The tier is resolved to a sentence and rendered.
 *    Every decision below reads `status`, `capabilities[]` or the catalog.
 */

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "message"; readonly tone: "ok" | "warn"; readonly text: string };

function intervalKey(plan: PlanCatalogEntry): string {
  return plan.interval === "year" ? "billing.perYear" : "billing.perMonth";
}

export function BillingPanel({
  view,
  locale,
  planParam,
}: {
  readonly view: BillingView;
  readonly locale: Locale;
  /** The raw `?plan=` value. Validated against the catalog; never rendered. */
  readonly planParam: string | null;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>(
    view.error === null
      ? { kind: "idle" }
      : {
          kind: "message",
          tone: "warn",
          text: billingRefusalText(t, { code: view.error, field: null, reason: null }),
        },
  );
  // Separate from `status`, because an invalid code belongs beside the field
  // rather than in a banner — and the submitted value is never put back.
  const [promotionRefused, setPromotionRefused] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");

  const applyCheckout = useCallback(
    (response: StartCheckoutResponse): void => {
      switch (response.kind) {
        case "redirect":
          // Out of this origin, to Stripe's own page. `assign` rather than
          // `replace` so the back button returns the visitor here.
          window.location.assign(response.url);
          return;
        case "checkout_in_progress":
          setStatus({ kind: "message", tone: "warn", text: t("billing.checkoutInProgress") });
          return;
        case "promotion_invalid":
          setPromotionRefused(true);
          setStatus({ kind: "message", tone: "warn", text: t("billing.promotionInvalid") });
          return;
        case "rejected":
          if (response.field === "promotion_code") setPromotionRefused(true);
          setStatus({ kind: "message", tone: "warn", text: billingRefusalText(t, response) });
          return;
        case "indeterminate":
          setStatus({ kind: "message", tone: "warn", text: t("billing.indeterminate") });
          return;
        case "signed_out":
          setStatus({ kind: "message", tone: "warn", text: t("billing.signedOut") });
          return;
      }
    },
    [t],
  );

  const beginCheckout = useCallback(
    async (planLookupKey: string): Promise<void> => {
      setPromotionRefused(false);
      setStatus({ kind: "busy" });
      applyCheckout(
        await startCheckout({
          data: {
            plan_lookup_key: planLookupKey,
            promotion_code: promotionCode.trim() === "" ? null : promotionCode.trim(),
          },
        }),
      );
    },
    [applyCheckout, promotionCode],
  );

  /*
   * `?plan=<lookup_key>` from the marketing site's pricing page.
   *
   * Validated against the catalog this page actually loaded, so a shaped key the
   * catalog does not publish — and anything malformed — resolves to `null` and
   * this page renders normally. The raw value is never rendered and never sent.
   */
  const deepLinkPlan = useMemo(
    () => resolvePlanDeepLink(view.plans, planParam),
    [view.plans, planParam],
  );
  const deepLinkStarted = useRef(false);

  useEffect(() => {
    if (deepLinkPlan === null || deepLinkStarted.current) return;
    deepLinkStarted.current = true;
    void beginCheckout(deepLinkPlan.lookup_key);
  }, [deepLinkPlan, beginCheckout]);

  function applyPortal(response: OpenPortalResponse): void {
    switch (response.kind) {
      case "redirect":
        window.location.assign(response.url);
        return;
      case "rejected":
        setStatus({
          kind: "message",
          tone: "warn",
          text: billingRefusalText(t, { code: response.code, field: null, reason: null }),
        });
        return;
      case "indeterminate":
        setStatus({ kind: "message", tone: "warn", text: t("billing.indeterminate") });
        return;
      case "signed_out":
        setStatus({ kind: "message", tone: "warn", text: t("billing.signedOut") });
        return;
    }
  }

  async function onManage(): Promise<void> {
    setStatus({ kind: "busy" });
    applyPortal(await openPortal());
  }

  const busy = status.kind === "busy";
  const entitlement = view.entitlement;
  const periodEnd = formatPeriodEnd(entitlement?.currentPeriodEnd ?? null, locale);
  const ending = entitlement?.status === "canceled" || entitlement?.status === "unpaid";

  return (
    <main id="main" tabIndex={-1} className="mkt-page-x mkt-container py-10 outline-none md:py-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-section-gap">
          <h1 className="text-h1 text-ink">{t("billing.heading")}</h1>
        </div>

        <div className="space-y-4">
          {status.kind === "message" ? (
            <Alert
              data-testid="billing-status"
              variant={status.tone === "ok" ? "info" : "over"}
              role={status.tone === "ok" ? "status" : "alert"}
              className="rounded-sm"
            >
              {status.text}
            </Alert>
          ) : null}

          <Card>
            <CardContent>
              <div className="space-y-1">
                <p className="text-caption text-ink-dim">{t("billing.currentPlan")}</p>
                <p data-testid="billing-tier" className="text-h3 text-ink">
                  {entitlement === null
                    ? t("billing.tier.unknown")
                    : tierDisplayName(t, entitlement.tier)}
                </p>
              </div>

              {entitlement === null ? null : (
                <>
                  <div className="mt-4 space-y-1">
                    <p className="text-caption text-ink-dim">{t("billing.statusLabel")}</p>
                    <p data-testid="billing-plan-status" className="text-body text-ink">
                      {statusLabel(t, entitlement.status)}
                    </p>
                  </div>

                  {periodEnd === null ? null : (
                    <div className="mt-4 space-y-1">
                      <p className="text-caption text-ink-dim">
                        {ending ? t("billing.endsOn") : t("billing.renewsOn")}
                      </p>
                      <p data-testid="billing-period-end" className="text-body text-ink">
                        {periodEnd}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 space-y-1">
                    <p className="text-caption text-ink-dim">{t("billing.includedHeading")}</p>
                    {entitlement.capabilities.length === 0 ? (
                      <p data-testid="billing-capabilities-empty" className="text-body text-ink">
                        {t("billing.includedNone")}
                      </p>
                    ) : (
                      <ul data-testid="billing-capabilities" className="text-body text-ink">
                        {entitlement.capabilities.map((capability) => (
                          <li key={capability} data-testid={`billing-capability-${capability}`}>
                            {capabilityLabel(t, capability)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p data-testid="billing-request-limit" className="text-caption text-ink-dim">
                      {entitlement.monthlyRequestLimit === null
                        ? t("billing.requestLimitUnlimited")
                        : t("billing.requestLimit", { count: entitlement.monthlyRequestLimit })}
                    </p>
                  </div>
                </>
              )}

              {view.portalAvailable ? (
                <div className="mt-6 space-y-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="mkt-tap"
                    data-testid="billing-portal"
                    disabled={busy}
                    onClick={() => void onManage()}
                  >
                    {busy ? t("billing.opening") : t("billing.manage")}
                  </Button>
                  <p className="text-caption text-ink-dim">{t("billing.manageHint")}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="text-h3 text-ink">{t("billing.plansHeading")}</h2>

              {view.plans.length === 0 ? (
                <p data-testid="billing-plans-unavailable" className="mt-3 text-body text-ink">
                  {t("billing.plansUnavailable")}
                </p>
              ) : (
                <>
                  <div className="mt-4 space-y-1">
                    <Label htmlFor="billing-promotion">{t("billing.promotionLabel")}</Label>
                    <Input
                      id="billing-promotion"
                      data-testid="billing-promotion"
                      // Not a payment field: a promotion code is an ordinary
                      // text input, and `off` keeps a browser from offering a
                      // stored card value for it.
                      autoComplete="off"
                      aria-invalid={promotionRefused || undefined}
                      value={promotionCode}
                      disabled={busy}
                      onChange={(event) => {
                        setPromotionRefused(false);
                        setPromotionCode(event.target.value);
                      }}
                    />
                  </div>

                  <ul className="mt-4 space-y-4">
                    {view.plans.map((plan) => (
                      <li key={plan.lookup_key} className="space-y-1">
                        <p className="text-body text-ink">{tierDisplayName(t, plan.tier)}</p>
                        <p
                          data-testid={`billing-price-${plan.lookup_key}`}
                          className="text-caption text-ink-dim"
                        >
                          {`${formatPlanPrice(plan, locale)} ${t(intervalKey(plan))}`}
                        </p>
                        <Button
                          size="sm"
                          className="mkt-tap"
                          data-testid={`billing-plan-${plan.lookup_key}`}
                          disabled={busy}
                          onClick={() => void beginCheckout(plan.lookup_key)}
                        >
                          {busy ? t("billing.opening") : t("billing.choosePlan")}
                        </Button>
                      </li>
                    ))}
                  </ul>

                  <p data-testid="billing-tax-notice" className="mt-4 text-caption text-ink-dim">
                    {t("billing.taxIncluded")}
                  </p>
                </>
              )}

              <p data-testid="billing-hosted-notice" className="mt-2 text-caption text-ink-dim">
                {t("billing.hostedNotice")}
              </p>
            </CardContent>
          </Card>

          {status.kind === "message" && status.text === t("billing.signedOut") ? (
            <Button
              size="sm"
              className="mkt-tap"
              render={
                <a
                  data-testid="sign-in-again"
                  href={`/auth/login?next=${billingDestinationKey(locale)}&lang=${locale}`}
                >
                  {t("profile.signInAgain")}
                </a>
              }
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
