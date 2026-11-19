import {
  BILLING_CLIENT_VERSION_HEADER,
  toBillingErrorCode,
  type BillingError,
  type BillingErrorCode,
  type CheckoutResponse,
  type EntitlementResponse,
  type PlanCatalogResponse,
  type PortalResponse,
} from "@nixus/shared";

import { ACCOUNT_CLIENT_VERSION } from "./client-version.ts";

/**
 * The account app's ONLY billing access (billing AD-3, AD-7).
 *
 * Every call goes to `https://api.nixusapp.com/v1/billing` with the session's
 * own user access token, and that is the whole of this app's relationship with
 * commerce. It holds no Stripe credential, imports no Stripe SDK, renders no
 * card field, and has no access to the billing table — exactly as
 * `profile-client.ts` is the app's only profile access and holds no AWS client
 * for the profile table (profile AD-11, generalised by billing AD-7).
 *
 * A request is bound to the token it was given. There is no `sub` parameter and
 * no customer parameter anywhere in this interface, by design: the billing API
 * resolves the Stripe customer from the CALLER'S OWN record (billing AD-3), so
 * no request this app can build selects another account's entitlement, portal or
 * checkout session.
 *
 * `x-nixus-client-version` carries this app's own version on every call so
 * AD-9's minimum-client-version floor applies to the web surface the same way it
 * applies to the desktop.
 */

export type BillingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BillingError };

export interface StartCheckoutInput {
  readonly planLookupKey: string;
  /** `null`, never `""` — absent is null on every Nixus wire (billing AD-13). */
  readonly promotionCode: string | null;
}

export interface BillingApi {
  getEntitlement(): Promise<BillingResult<EntitlementResponse>>;
  startCheckout(input: StartCheckoutInput): Promise<BillingResult<CheckoutResponse>>;
  createPortalSession(): Promise<BillingResult<PortalResponse>>;
  getPlans(): Promise<BillingResult<PlanCatalogResponse>>;
}

function fallbackError(code: BillingErrorCode): BillingError {
  return { code, message: "The billing service is unavailable.", request_id: "" } as BillingError;
}

async function readError(response: Response): Promise<BillingError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallbackError("unavailable");
  }
  const envelope = (body as { error?: Record<string, unknown> }).error;
  if (!envelope) return fallbackError("unavailable");

  // A code a newer server added maps onto the closed union rather than crossing
  // into this app as an unknown string (billing AD-13).
  const code = toBillingErrorCode(envelope.code);
  // The insufficient-scope 403 the gateway emits as `unauthorized` means the
  // grant cannot be widened by a refresh, so the user has to authenticate again.
  // Identical reasoning to `profile-client.ts`, and the reason `premium_required`
  // is pinned to 403 with its own code: a plan limitation must never read as an
  // expired session (billing AD-12).
  const resolved: BillingErrorCode =
    code === "unauthorized" && response.status === 403 ? "reauthentication_required" : code;

  return { ...envelope, code: resolved } as BillingError;
}

async function readJson<T>(response: Response): Promise<BillingResult<T>> {
  if (!response.ok) return { ok: false, error: await readError(response) };
  try {
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, error: fallbackError("unavailable") };
  }
}

export function createBillingApi(baseUrl: string, accessToken: string): BillingApi {
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        [BILLING_CLIENT_VERSION_HEADER]: ACCOUNT_CLIENT_VERSION,
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      },
    });

  const post = <T>(path: string, body: unknown): Promise<BillingResult<T>> =>
    call(path, { method: "POST", body: JSON.stringify(body) }).then(readJson<T>);

  return {
    getEntitlement: () => call("/entitlement").then(readJson<EntitlementResponse>),
    startCheckout: (input) =>
      post<CheckoutResponse>("/checkout", {
        plan_lookup_key: input.planLookupKey,
        promotion_code: input.promotionCode,
      }),
    // No body at all: the customer is the caller's own, so there is nothing to
    // send and therefore nothing to get wrong (billing AD-3).
    createPortalSession: () =>
      call("/portal", { method: "POST" }).then(readJson<PortalResponse>),
    getPlans: () => call("/plans").then(readJson<PlanCatalogResponse>),
  };
}
