import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { isBillingError, parseAppError } from "@/lib/appError";
import {
  ADVANCE_PLAN_LOOKUP_KEY,
  billingMessageKey,
  useOpenBillingCheckout,
} from "@/lib/billing";

/**
 * The upgrade affordance behind every refusal that names a capability this plan does not
 * include (AD-12): the refusal copy promises an upgrade, and this is the thing to click.
 *
 * Checkout is always Stripe-hosted and always opens in the **system browser** — Rust keeps the
 * URL and opens it there itself, so nothing here can route commerce into the webview, and no
 * card field, Stripe Element or embedded Checkout exists on any Nixus surface.
 *
 * `disabled` while in flight is not cosmetic: launching the system browser takes long enough to
 * invite a second click, and two clicks would create two Checkout sessions.
 *
 * The label names the CAPABILITY, never a tier: under two paid plans a subscriber whose plan
 * excludes this capability is still a paying customer, and "upgrade to premium" is wrong for
 * them.
 */
export function BillingUpgradeAction({
  labelKey,
  planLookupKey = ADVANCE_PLAN_LOOKUP_KEY,
  testId = "billing-upgrade",
  className,
}: {
  readonly labelKey: string;
  readonly planLookupKey?: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  const { t } = useTranslation();
  const checkout = useOpenBillingCheckout();

  const parsed = checkout.error === null ? null : parseAppError(checkout.error);
  const messageKey =
    parsed === null
      ? null
      : isBillingError(parsed)
        ? billingMessageKey(parsed.code)
        : "billing.errorUnavailable";

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Button
        variant="default"
        size="sm"
        disabled={checkout.isPending}
        onClick={() => {
          if (checkout.isPending) return;
          checkout.mutate(planLookupKey);
        }}
        data-testid={testId}
        data-pending={checkout.isPending ? "true" : undefined}
      >
        <ExternalLink aria-hidden="true" />
        {checkout.isPending ? t("billing.opening") : t(labelKey)}
      </Button>

      {messageKey !== null ? (
        <p className="text-caption text-caution-ink" data-testid={`${testId}-error`}>
          {t(messageKey)}
        </p>
      ) : null}
    </div>
  );
}
