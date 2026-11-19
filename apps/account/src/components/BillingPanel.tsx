import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Receipt } from "lucide-react";
import { Alert, Badge, Button, Input, Label, Switch, grantsCapabilities } from "@nixus/shared";
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
  formatPlanAmount,
  formatPlanPrice,
  listPriceFor,
  resolvePlanDeepLink,
  statusLabel,
  tierDisplayName,
} from "@/lib/billing-plans";
import { billingDestinationKey, type Locale } from "@/lib/i18n";
import { billingRefusalText } from "@/lib/messages";
import {
  AccountSection,
  PILL_BUTTON_CLASS,
  SectionRow,
  type AccountSectionId,
} from "./AccountSection";

/**
 * The three billing cards of the account page: Subscription, Payment method and
 * Invoices (billing AD-8, AD-12, AD-16, AD-18). They share one status, so a
 * portal or checkout refusal is reported in whichever of them is open.
 *
 * Three things this component is NOT allowed to do, and does not:
 *
 *  - **Render a card field.** Checkout and the Customer Portal are Stripe-hosted
 *    without exception, so every paid action here is a redirect out — updating
 *    the card, the renewal switch and the invoice list included. There is no
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
  | {
      readonly kind: "message";
      readonly tone: "ok" | "warn";
      readonly text: string;
      readonly needsSignIn: boolean;
    };

// Widening a token's scope needs a FULL re-authentication (AD-9), so a session
// issued before `nixus-api/billing` existed reads back 403 here forever. Carried
// as a flag because the initial-load and mid-session sentences differ, and
// matching on either text left the other a banner with no way out.
const REAUTH_CODES: readonly string[] = ["unauthorized", "reauthentication_required"];

const BILLING_SECTIONS: readonly AccountSectionId[] = ["subscription", "payment", "invoices"];

function isReauthCode(code: string | null): boolean {
  return code !== null && REAUTH_CODES.includes(code);
}

function warn(text: string, needsSignIn = false): Status {
  return { kind: "message", tone: "warn", text, needsSignIn };
}

function intervalKey(plan: PlanCatalogEntry): string {
  return plan.interval === "year" ? "billing.perYear" : "billing.perMonth";
}

function shortIntervalKey(plan: PlanCatalogEntry): string {
  return plan.interval === "year" ? "billing.slashYear" : "billing.slashMonth";
}

export function BillingPanel({
  view,
  locale,
  planParam,
  section,
}: {
  readonly view: BillingView;
  readonly locale: Locale;
  /** The raw `?plan=` value. Validated against the catalog; never rendered. */
  readonly planParam: string | null;
  readonly section: AccountSectionId;
}) {
  const { t, i18n } = useTranslation();
  const plansId = useId();
  const [status, setStatus] = useState<Status>(
    view.error === null
      ? { kind: "idle" }
      : warn(
          billingRefusalText(t, { code: view.error, field: null, reason: null }),
          isReauthCode(view.error),
        ),
  );
  // Separate from `status`, because an invalid code belongs beside the field
  // rather than in a banner — and the submitted value is never put back.
  const [promotionRefused, setPromotionRefused] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");
  // A subscriber came here to see their plan, so the list waits behind a
  // button; anyone without a live subscription came to choose one.
  const [plansOpen, setPlansOpen] = useState(!view.subscriptionLive);

  const applyCheckout = useCallback(
    (response: StartCheckoutResponse): void => {
      switch (response.kind) {
        case "redirect":
          // Out of this origin, to Stripe's own page. `assign` rather than
          // `replace` so the back button returns the visitor here.
          window.location.assign(response.url);
          return;
        case "checkout_in_progress":
          setStatus(warn(t("billing.checkoutInProgress")));
          return;
        case "promotion_invalid":
          setPromotionRefused(true);
          setStatus(warn(t("billing.promotionInvalid")));
          return;
        case "rejected":
          if (response.field === "promotion_code") setPromotionRefused(true);
          setStatus(warn(billingRefusalText(t, response), isReauthCode(response.code)));
          return;
        case "indeterminate":
          setStatus(warn(t("billing.indeterminate")));
          return;
        case "signed_out":
          setStatus(warn(t("billing.signedOut"), true));
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
        setStatus(
          warn(
            billingRefusalText(t, { code: response.code, field: null, reason: null }),
            isReauthCode(response.code),
          ),
        );
        return;
      case "indeterminate":
        setStatus(warn(t("billing.indeterminate")));
        return;
      case "signed_out":
        setStatus(warn(t("billing.signedOut"), true));
        return;
    }
  }

  async function onManage(): Promise<void> {
    setStatus({ kind: "busy" });
    applyPortal(await openPortal());
  }

  const busy = status.kind === "busy";
  const entitlement = view.entitlement;
  const subscription = entitlement?.stripeState ?? null;
  // The period and the ending notice describe the SUBSCRIPTION, so both read the
  // recorded Stripe state: a live override nulls the effective period (AD-2) and
  // would otherwise hide the renewal date from a customer who is being charged.
  const periodEnd = formatPeriodEnd(
    subscription?.currentPeriodEnd ?? entitlement?.currentPeriodEnd ?? null,
    locale,
  );
  const subscriptionStatus = subscription?.status ?? entitlement?.status;
  const ending = subscriptionStatus === "canceled" || subscriptionStatus === "unpaid";
  const listPrice =
    view.subscriptionLive && subscription !== null
      ? listPriceFor(view.plans, subscription.tier)
      : null;
  const showPlanPrefix =
    entitlement !== null && i18n.exists(`billing.tier.${entitlement.tier}`);

  // One banner, in whichever billing card is open.
  const statusBlock =
    status.kind === "message" && BILLING_SECTIONS.includes(section) ? (
      <div className="mb-6 space-y-3">
        <Alert
          data-testid="billing-status"
          variant={status.tone === "ok" ? "info" : "over"}
          role={status.tone === "ok" ? "status" : "alert"}
          className="rounded-lg"
        >
          {status.text}
        </Alert>
        {status.needsSignIn ? (
          <Button
            className={PILL_BUTTON_CLASS}
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
    ) : null;

  const statusFor = (id: AccountSectionId) => (section === id ? statusBlock : null);

  return (
    <>
      <AccountSection
        id="subscription"
        active={section === "subscription"}
        title={t("account.subscription.title")}
      >
        {statusFor("subscription")}

        <div className="flex flex-col gap-4 rounded-xl bg-gradient-to-br from-[#EDF0FD] via-[#F0EFFD] to-[#F4EEFB] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className="font-display text-lg font-semibold tracking-[-0.015em] text-ink">
                {showPlanPrefix ? `${t("billing.planPrefix")} ` : null}
                <span data-testid="billing-tier">
                  {entitlement === null
                    ? t("billing.tier.unknown")
                    : tierDisplayName(t, entitlement.tier)}
                </span>
              </p>
              {entitlement === null ? null : (
                <Badge
                  data-testid="billing-plan-status"
                  variant={
                    entitlement.source === "admin"
                      ? "brand"
                      : grantsCapabilities(entitlement.status)
                        ? "good"
                        : "neutral"
                  }
                  className="rounded-full px-2"
                >
                  {entitlement.source === "admin"
                    ? t("billing.grantedByNixus")
                    : statusLabel(t, entitlement.status)}
                </Badge>
              )}
            </div>

            {entitlement === null ? null : (
              <>
                {entitlement.capabilities.length === 0 ? (
                  <p
                    data-testid="billing-capabilities-empty"
                    className="mt-1.5 text-body text-ink-dim"
                  >
                    {t("billing.includedNone")}
                  </p>
                ) : (
                  <ul
                    data-testid="billing-capabilities"
                    aria-label={t("billing.includedHeading")}
                    className="mt-1.5 flex flex-wrap gap-x-1.5 text-body text-ink-dim"
                  >
                    {entitlement.capabilities.map((capability, index) => (
                      <li key={capability} data-testid={`billing-capability-${capability}`}>
                        {capabilityLabel(t, capability)}
                        {index < entitlement.capabilities.length - 1 ? " ·" : "."}
                      </li>
                    ))}
                  </ul>
                )}
                <p data-testid="billing-request-limit" className="mt-1 text-caption text-ink-dim">
                  {entitlement.monthlyRequestLimit === null
                    ? t("billing.requestLimitUnlimited")
                    : t("billing.requestLimit", { count: entitlement.monthlyRequestLimit })}
                </p>

                {/* Shown only where the grant and the charge can disagree, which
                    is decided from `source` - comparing the two tiers would be
                    exactly the branch AD-1 forbids. */}
                {entitlement.source === "admin" && subscription !== null ? (
                  <p data-testid="billing-subscription" className="mt-1 text-caption text-ink-dim">
                    {`${t("billing.yourSubscription")}: ${tierDisplayName(t, subscription.tier)} — ${statusLabel(t, subscription.status)}`}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {listPrice === null ? null : (
            <p data-testid="billing-current-price" className="shrink-0 text-ink">
              <span className="font-display text-2xl font-bold tracking-[-0.02em]">
                {formatPlanAmount(listPrice, locale)}
              </span>{" "}
              <span className="text-caption text-ink-dim">
                {`${listPrice.currency} ${t(shortIntervalKey(listPrice))}`}
              </span>
            </p>
          )}
        </div>

        <div className="mt-6">
          {periodEnd !== null || view.portalAvailable ? (
            <SectionRow
              title={t("billing.renewalTitle")}
              detail={
                <>
                  {periodEnd === null ? null : (
                    <span>
                      {ending ? t("billing.endsOn") : t("billing.renewsOn")}{" "}
                      <span data-testid="billing-period-end">{periodEnd}</span>
                      {!ending && listPrice !== null
                        ? ` ${t("billing.renewsFor", { amount: formatPlanAmount(listPrice, locale) })}`
                        : null}
                      .{" "}
                    </span>
                  )}
                  {view.portalAvailable ? <span>{t("billing.renewalHint")}</span> : null}
                </>
              }
              action={
                view.portalAvailable ? (
                  <Switch
                    data-testid="billing-portal"
                    aria-label={t("billing.renewalTitle")}
                    checked={!ending}
                    disabled={busy}
                    onCheckedChange={() => void onManage()}
                    className="h-6 w-11"
                  />
                ) : null
              }
            />
          ) : null}

          <SectionRow
            detail={
              <span className="text-body">
                {view.subscriptionLive ? t("billing.compareHint") : t("billing.chooseHint")}
              </span>
            }
            action={
              <Button
                variant="outline"
                className={PILL_BUTTON_CLASS}
                data-testid="billing-compare"
                aria-expanded={plansOpen}
                aria-controls={plansId}
                onClick={() => setPlansOpen((open) => !open)}
              >
                {view.subscriptionLive ? t("billing.compare") : t("billing.seePlans")}
              </Button>
            }
          />
        </div>

        <div id={plansId} hidden={!plansOpen} className="mt-2 border-t border-line pt-6">
          <h3 className="text-body font-semibold text-ink">{t("billing.plansHeading")}</h3>

          {view.plans.length === 0 ? (
            <p data-testid="billing-plans-unavailable" className="mt-3 text-body text-ink">
              {t("billing.plansUnavailable")}
            </p>
          ) : (
            <>
              {view.subscriptionLive ? (
                <p data-testid="billing-switch-hint" className="mt-2 text-caption text-ink-dim">
                  {t("billing.switchHint")}
                </p>
              ) : null}

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {view.plans.map((plan) => (
                  <li
                    key={plan.lookup_key}
                    className="flex flex-col gap-3 rounded-xl border border-line p-4"
                  >
                    <div>
                      <p className="font-display text-base font-semibold text-ink">
                        {tierDisplayName(t, plan.tier)}
                      </p>
                      <p
                        data-testid={`billing-price-${plan.lookup_key}`}
                        className="text-caption text-ink-dim"
                      >
                        {`${formatPlanPrice(plan, locale)} ${t(intervalKey(plan))}`}
                      </p>
                    </div>
                    <Button
                      className={`${PILL_BUTTON_CLASS} self-start`}
                      data-testid={`billing-plan-${plan.lookup_key}`}
                      disabled={busy}
                      onClick={() => void beginCheckout(plan.lookup_key)}
                    >
                      {busy
                        ? t("billing.opening")
                        : view.subscriptionLive
                          ? t("billing.switchPlan")
                          : t("billing.choosePlan")}
                    </Button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 max-w-xs space-y-1.5">
                <Label htmlFor="billing-promotion" className="text-[13px] font-semibold text-ink">
                  {t("billing.promotionLabel")}
                </Label>
                <Input
                  id="billing-promotion"
                  data-testid="billing-promotion"
                  // Not a payment field: a promotion code is an ordinary text
                  // input, and `off` keeps a browser from offering a stored card
                  // value for it.
                  autoComplete="off"
                  className="mkt-tap h-10 rounded-lg px-3"
                  aria-invalid={promotionRefused || undefined}
                  value={promotionCode}
                  disabled={busy}
                  onChange={(event) => {
                    setPromotionRefused(false);
                    setPromotionCode(event.target.value);
                  }}
                />
              </div>

              <p data-testid="billing-tax-notice" className="mt-4 text-caption text-ink-dim">
                {t("billing.taxIncluded")}
              </p>
            </>
          )}

          <p data-testid="billing-hosted-notice" className="mt-2 text-caption text-ink-dim">
            {t("billing.hostedNotice")}
          </p>
        </div>
      </AccountSection>

      <AccountSection
        id="payment"
        active={section === "payment"}
        title={t("account.payment.title")}
      >
        {statusFor("payment")}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-ink text-white"
            >
              <CreditCard className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">
                {view.portalAvailable ? t("billing.cardOnFile") : t("billing.noCard")}
              </p>
              <p className="text-caption text-ink-dim">
                {view.portalAvailable ? t("billing.cardOnFileHint") : t("billing.noCardHint")}
              </p>
            </div>
          </div>

          {view.portalAvailable ? (
            <Button
              variant="outline"
              className={PILL_BUTTON_CLASS}
              data-testid="billing-update-card"
              disabled={busy}
              onClick={() => void onManage()}
            >
              {busy ? t("billing.opening") : t("billing.updateCard")}
            </Button>
          ) : (
            <Button
              variant="outline"
              className={PILL_BUTTON_CLASS}
              render={<a href="#subscription">{t("billing.seePlans")}</a>}
            />
          )}
        </div>
      </AccountSection>

      <AccountSection
        id="invoices"
        active={section === "invoices"}
        title={t("account.invoices.title")}
      >
        {statusFor("invoices")}

        <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong p-5">
          <Receipt aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-dim" />
          <div>
            <p className="text-body font-semibold text-ink">
              {view.portalAvailable ? t("billing.invoicesAtStripe") : t("billing.noInvoices")}
            </p>
            <p className="mt-0.5 text-caption text-ink-dim">
              {view.portalAvailable
                ? t("billing.invoicesAtStripeHint")
                : t("billing.noInvoicesHint")}
            </p>
          </div>
        </div>

        {view.portalAvailable ? (
          <div className="mt-6 border-t border-line pt-6">
            <SectionRow
              detail={<span className="text-body">{t("billing.portalHint")}</span>}
              action={
                <Button
                  variant="outline"
                  className={PILL_BUTTON_CLASS}
                  data-testid="billing-invoices-portal"
                  disabled={busy}
                  onClick={() => void onManage()}
                >
                  {busy ? t("billing.opening") : t("billing.openPortal")}
                </Button>
              }
            />
          </div>
        ) : null}
      </AccountSection>
    </>
  );
}
