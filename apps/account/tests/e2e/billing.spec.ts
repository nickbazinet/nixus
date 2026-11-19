import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import {
  ADVANCE_ACCOUNT,
  CLASSIC_ACCOUNT,
  FREE_ACCOUNT,
  GRANT_ONLY_ACCOUNT,
  OVERRIDE_OVER_PAID_ACCOUNT,
} from "./support/billing-api";
import { startHarness, type Harness } from "./support/harness";

/**
 * The billing surfaces, driven in a real browser against the PACKAGED server
 * (`pnpm build && pnpm package` must have run) and a local billing stub.
 *
 * What only this suite can prove: that every paid action leaves this origin for
 * a url the server produced, that the two refusals a user is most likely to meet
 * read as themselves rather than as a generic failure, that the Stripe-return
 * page settles on a bound without ever claiming the payment failed, and that one
 * account's session cannot reach another's entitlement or portal.
 */

let harness: Harness;

/** The access token the stub IdP mints for the Nth sign-in of a harness run. */
const TOKEN_FOR_SIGN_IN = (nth: number): string => `access-code-${nth}`;

test.beforeEach(async () => {
  harness = await startHarness();
});

test.afterEach(async () => {
  await harness.stop();
});

/**
 * Signs in and lands on `/profile`.
 *
 * The stub provider keeps its own session, so only the FIRST sign-in of a run
 * presents a page to click: a second browser context is granted silently, which
 * is Managed Login's real behaviour and is what makes two concurrent accounts
 * possible in one harness.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${harness.origin}/`);
  const button = page.getByTestId("stub-idp-sign-in");
  if ((await button.count()) > 0) await button.click();
  await page.waitForURL(`${harness.origin}/profile`);
}

async function signedInBilling(page: Page, path = "/billing"): Promise<void> {
  await signIn(page);
  await page.goto(`${harness.origin}${path}`);
  await expect(page.getByTestId("billing-tier")).toBeVisible();
}

/** The status and `Location` the SERVER answered `path` with. See `account.spec.ts`. */
async function firstHop(page: Page, path: string): Promise<[number, string | null]> {
  const response = await page.goto(`${harness.origin}${path}`);
  const hops: Request[] = [];
  let request: Request | null = response?.request() ?? null;
  while (request !== null) {
    hops.unshift(request);
    request = request.redirectedFrom();
  }
  const served = hops[0] ? await hops[0].response() : null;
  return [served?.status() ?? 0, served?.headers()["location"] ?? null];
}

test.describe("the signed-out gate", () => {
  test("sends a signed-out visitor from the billing pages to sign-in", async ({ page }) => {
    // 307, not 302: a loader redirect, which preserves the method. The
    // `Location` carries a destination KEY from the server-side allow-list, so
    // nothing from the request reaches it.
    expect(await firstHop(page, "/billing")).toEqual([
      307,
      "/auth/login?next=billing&lang=en",
    ]);
    expect(await firstHop(page, "/fr/billing")).toEqual([
      307,
      "/auth/login?next=billing-fr&lang=fr",
    ]);
    await expect(page.getByTestId("billing-tier")).toHaveCount(0);
  });

  test("sends a signed-out visitor from the Stripe-return page to sign-in", async ({
    page,
  }) => {
    expect(await firstHop(page, "/checkout/complete")).toEqual([
      307,
      "/auth/login?next=billing&lang=en",
    ]);
    expect(await firstHop(page, "/fr/checkout/complete")).toEqual([
      307,
      "/auth/login?next=billing-fr&lang=fr",
    ]);
  });

  test("carries no plan value into the login url, even when one was asked for", async ({
    page,
  }) => {
    const [status, location] = await firstHop(
      page,
      "/billing?plan=advance_monthly_cad&promotion_code=SECRET",
    );
    expect(status).toBe(307);
    expect(location).toBe("/auth/login?next=billing&lang=en");
    expect(location).not.toContain("advance_monthly_cad");
    expect(location).not.toContain("SECRET");
  });

  test("treats an expired session exactly like no session", async ({ page }) => {
    await signIn(page);
    harness.dynamo.expireSessions();
    expect(await firstHop(page, "/billing")).toEqual([
      307,
      "/auth/login?next=billing&lang=en",
    ]);
  });

  /* `/billing` has no header entry by design - the account header's own comment
     records that the French sign-out label already does not fit a 320px bar
     beside both toggles. The profile page is therefore the ONLY in-app way in,
     which makes it load-bearing rather than decorative. */
  test("offers the only in-app way into billing from the profile page", async ({
    page,
  }) => {
    for (const [path, href, label] of [
      ["/profile", "/billing", "Plan and billing"],
      ["/fr/profile", "/fr/billing", "Forfait et facturation"],
    ] as const) {
      await signIn(page);
      await page.goto(`${harness.origin}${path}`);
      const link = page.getByTestId("billing-link");
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveText(label);

      await link.click();
      await page.waitForURL(`${harness.origin}${href}`);
      await expect(page.getByTestId("billing-tier")).toBeVisible();
    }
  });
});

test.describe("the billing page", () => {
  test("shows the signed-in account's own tier, status, renewal and capabilities", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);

    await expect(page.getByTestId("billing-tier")).toHaveText("Advance");
    await expect(page.getByTestId("billing-plan-status")).toHaveText("Active");
    await expect(page.getByTestId("billing-period-end")).toHaveText("December 1, 2026");
    await expect(page.getByTestId("billing-capability-hosted_ai")).toBeVisible();
    await expect(page.getByTestId("billing-capability-multi_device_sync")).toBeVisible();
    await expect(page.getByTestId("billing-request-limit")).toContainText("1000");
    await expect(page.getByTestId("billing-portal")).toBeVisible();
  });

  test("shows a free account as an ordinary account with no portal", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);

    await expect(page.getByTestId("billing-tier")).toHaveText("Free");
    await expect(page.getByTestId("billing-plan-status")).toHaveText("No paid plan");
    await expect(page.getByTestId("billing-capabilities-empty")).toBeVisible();
    // Nothing to manage yet, so no dead-end button.
    await expect(page.getByTestId("billing-portal")).toHaveCount(0);
    await expect(page.getByTestId("billing-status")).toHaveCount(0);
  });

  test("offers the way back when the entitlement read needs a fresh sign-in", async ({
    page,
  }) => {
    harness.billing.refuseEntitlement = { code: "unauthorized", status: 403 };
    await signedInBilling(page);

    await expect(page.getByTestId("billing-status")).toBeVisible();
    // A refresh cannot widen scope (AD-9), so a banner alone was terminal.
    await expect(page.getByTestId("sign-in-again")).toBeVisible();
  });

  test("shows an overridden payer the subscription they are being charged for", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), OVERRIDE_OVER_PAID_ACCOUNT);
    await signedInBilling(page);

    // The grant is what they hold; the subscription is what they pay for. Before
    // this, the page showed the grant and claimed there was no paid plan at all.
    await expect(page.getByTestId("billing-tier")).toHaveText("Advance");
    await expect(page.getByTestId("billing-plan-status")).toHaveText("Granted by Nixus");
    await expect(page.getByTestId("billing-subscription")).toContainText("Classic");
    await expect(page.getByTestId("billing-subscription")).toContainText("Active");
    // A renewal date, which the override had nulled out of the effective state.
    await expect(page.getByTestId("billing-period-end")).toHaveText("December 19, 2026");
    // And the way to cancel it, which was never rendered at all.
    await expect(page.getByTestId("billing-portal")).toBeVisible();
  });

  test("tells an active subscriber a plan click is a switch, not a second purchase", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), OVERRIDE_OVER_PAID_ACCOUNT);
    await signedInBilling(page);

    await expect(page.getByTestId("billing-plan-classic_monthly_cad")).toHaveText(
      "Switch to this plan",
    );
    await expect(page.getByTestId("billing-plan-advance_monthly_cad")).toHaveText(
      "Switch to this plan",
    );
    await expect(page.getByTestId("billing-switch-hint")).toBeVisible();
  });

  test("offers a grant-only account no portal it cannot open", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), GRANT_ONLY_ACCOUNT);
    await signedInBilling(page);

    await expect(page.getByTestId("billing-plan-status")).toHaveText("Granted by Nixus");
    // No Stripe customer exists, so the portal would refuse: no dead-end button,
    // and nothing claiming a subscription they do not have.
    await expect(page.getByTestId("billing-portal")).toHaveCount(0);
    await expect(page.getByTestId("billing-subscription")).toHaveCount(0);
    await expect(page.getByTestId("billing-plan-classic_monthly_cad")).toHaveText(
      "Choose this plan",
    );
  });

  test("lists both plans in display order, with CAD prices and the tax rule", async ({
    page,
  }) => {
    await signedInBilling(page);

    await expect(page.getByTestId("billing-price-classic_monthly_cad")).toContainText("9.99");
    await expect(page.getByTestId("billing-price-advance_monthly_cad")).toContainText("19.99");
    await expect(page.getByTestId("billing-price-classic_monthly_cad")).toContainText("CAD");

    const notice = page.getByTestId("billing-tax-notice");
    await expect(notice).toContainText("tax included");
    await expect(notice).not.toContainText("taxes extra");
  });

  test("names a tier these locale files have never seen without breaking", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), {
      ...ADVANCE_ACCOUNT,
      tier: "a_tier_shipped_from_the_dashboard",
    });
    await signedInBilling(page);

    await expect(page.getByTestId("billing-tier")).toHaveText("Nixus Cloud plan");
    // The rest of the page still works, which is the point of the fallback.
    await expect(page.getByTestId("billing-plan-status")).toHaveText("Active");
    await expect(page.getByTestId("billing-portal")).toBeVisible();
    expect(await page.content()).not.toContain("a_tier_shipped_from_the_dashboard");
  });

  test("still shows the plan when the catalog could not be loaded", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), CLASSIC_ACCOUNT);
    harness.billing.plansUnavailable = true;
    await signedInBilling(page);

    await expect(page.getByTestId("billing-tier")).toHaveText("Classic");
    await expect(page.getByTestId("billing-plans-unavailable")).toBeVisible();
  });

  test("renders no card field, and no payment component, anywhere", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);

    // AD-8: Checkout and the Portal are Stripe-hosted without exception, so
    // there is no card input, no payment iframe and no Elements mount here.
    const payment = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input")];
      return {
        creditCardInputs: inputs.filter((input) =>
          /^cc-|^cc$/.test(input.getAttribute("autocomplete") ?? ""),
        ).length,
        passwordOrNumberInputs: inputs.filter((input) =>
          ["password", "tel"].includes(input.type),
        ).length,
        iframes: document.querySelectorAll("iframe").length,
        stripeGlobal: "Stripe" in window,
      };
    });

    expect(payment).toEqual({
      creditCardInputs: 0,
      passwordOrNumberInputs: 0,
      iframes: 0,
      stripeGlobal: false,
    });
  });

  test("states its own version on every billing call", async ({ page }) => {
    await signedInBilling(page);

    expect(harness.billing.calls.length).toBeGreaterThan(0);
    for (const call of harness.billing.calls) {
      expect(call.clientVersion, call.path).toBe("0.0.1");
    }
  });

  test("serves the French page and keeps the brand term untranslated", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), CLASSIC_ACCOUNT);
    await signIn(page);
    await page.goto(`${harness.origin}/fr/billing`);

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByTestId("billing-plan-status")).toHaveText("Actif");
    await expect(page.getByTestId("billing-period-end")).toHaveText("1 décembre 2026");
    await expect(page.getByTestId("billing-tax-notice")).toContainText("taxes incluses");
    await expect(page.locator("body")).not.toContainText("Nuage");
    await expect(page.locator("body")).not.toContainText("taxes en sus");
  });
});

test.describe("starting a checkout", () => {
  test("sends a free account out to the hosted checkout url the server returned", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);

    await page.getByTestId("billing-plan-advance_monthly_cad").click();
    await expect(page.getByTestId("stub-hosted-checkout")).toBeVisible();
    expect(page.url()).toContain("/hosted-checkout");

    const checkout = harness.billing.calls.find((call) => call.path === "/checkout");
    expect(checkout?.method).toBe("POST");
    expect(JSON.parse(checkout?.body ?? "null")).toEqual({
      plan_lookup_key: "advance_monthly_cad",
      promotion_code: null,
    });
  });

  test("lets the SERVER route a live subscriber to the portal instead", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), CLASSIC_ACCOUNT);
    await signedInBilling(page);

    // AD-18: the page asked for a checkout and is handed `destination: portal`.
    // It opens what it was given without deciding anything itself.
    await page.getByTestId("billing-plan-advance_monthly_cad").click();
    await expect(page.getByTestId("stub-hosted-portal")).toBeVisible();
  });

  test("renders an already-open checkout as its own state, not as an error", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);
    harness.billing.refuseCheckoutNext = { code: "checkout_in_progress" };

    await page.getByTestId("billing-plan-classic_monthly_cad").click();

    const status = page.getByTestId("billing-status");
    await expect(status).toContainText("A checkout is already open");
    await expect(status).not.toContainText("could not reach");
    await expect(status).not.toContainText("unavailable");
    // Still on the billing page, with the plan buttons usable again.
    await expect(page.getByTestId("billing-plan-classic_monthly_cad")).toBeEnabled();
  });

  test("refuses an invalid promotion code without ever echoing it", async ({ page }) => {
    const submitted = "ANOTREALCODE2026";
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);
    harness.billing.refuseCheckoutNext = { code: "promotion_invalid" };

    await page.getByTestId("billing-promotion").fill(submitted);
    await page.getByTestId("billing-plan-classic_monthly_cad").click();

    const status = page.getByTestId("billing-status");
    await expect(status).toContainText("could not be applied");
    expect(await status.textContent()).not.toContain(submitted);
    await expect(page.getByTestId("billing-promotion")).toHaveAttribute("aria-invalid", "true");
  });

  test("refuses a malformed promotion code before any billing call is made", async ({
    page,
  }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);
    const before = harness.billing.calls.filter((call) => call.path === "/checkout").length;

    await page.getByTestId("billing-promotion").fill("not a valid code!");
    await page.getByTestId("billing-plan-classic_monthly_cad").click();

    const status = page.getByTestId("billing-status");
    await expect(status).toBeVisible();
    // The value stays in the field the user typed it into, which is theirs. What
    // must never carry it is the refusal, the request, or a log line.
    expect(await status.textContent()).not.toContain("not a valid code!");
    const after = harness.billing.calls.filter((call) => call.path === "/checkout").length;
    expect(after).toBe(before);
  });

  test("opens the portal from the manage button", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);

    await page.getByTestId("billing-portal").click();
    await expect(page.getByTestId("stub-hosted-portal")).toBeVisible();

    const portal = harness.billing.calls.find((call) => call.path === "/portal");
    expect(portal?.method).toBe("POST");
    // AD-3: there is no customer parameter to send, so the body is empty.
    expect(portal?.body).toBe("");
  });

  test("reports a refused portal without claiming the plan changed", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);
    harness.billing.refusePortalNext = { code: "unavailable" };

    await page.getByTestId("billing-portal").click();
    const status = page.getByTestId("billing-status");
    await expect(status).toContainText("Your plan is unchanged");
  });
});

test.describe("the ?plan= deep link from the pricing page", () => {
  test("starts a checkout for a plan the catalog publishes", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signIn(page);

    await page.goto(`${harness.origin}/billing?plan=advance_monthly_cad`);
    await expect(page.getByTestId("stub-hosted-checkout")).toBeVisible();

    const checkout = harness.billing.calls.find((call) => call.path === "/checkout");
    expect(JSON.parse(checkout?.body ?? "null")).toEqual({
      plan_lookup_key: "advance_monthly_cad",
      promotion_code: null,
    });
  });

  test("starts a checkout for the French deep link too", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signIn(page);

    await page.goto(`${harness.origin}/fr/billing?plan=classic_monthly_cad`);
    await expect(page.getByTestId("stub-hosted-checkout")).toBeVisible();
  });

  for (const plan of [
    "enterprise_monthly_usd",
    "Advance_Monthly_CAD",
    "advance monthly cad",
    "../../etc/passwd",
    "<script>alert(1)</script>",
    "",
  ]) {
    test(`ignores the unusable plan ${JSON.stringify(plan)} and renders the page`, async ({
      page,
    }) => {
      harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
      await signIn(page);

      await page.goto(
        `${harness.origin}/billing?plan=${encodeURIComponent(plan)}`,
      );

      // An ordinary billing page: no checkout, no error, nothing echoed.
      await expect(page.getByTestId("billing-tier")).toBeVisible();
      await expect(page.getByTestId("billing-plan-advance_monthly_cad")).toBeVisible();
      await expect(page.getByTestId("billing-status")).toHaveCount(0);
      expect(harness.billing.calls.some((call) => call.path === "/checkout")).toBe(false);
      if (plan !== "") expect(await page.content()).not.toContain(plan);
    });
  }
});

test.describe("the Stripe-return landing page", () => {
  test("polls until the webhook has converged, then shows the new plan", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    // The loader's read is the first; the entitlement converges on the second,
    // which is the first poll. This is AD-5's lag, reproduced.
    harness.billing.convergeEntitlementAfter = 2;
    await signIn(page);

    await page.goto(`${harness.origin}/checkout/complete`);
    await expect(page.getByTestId("checkout-state")).toHaveAttribute("data-settled", "no");
    await expect(page.getByTestId("checkout-state")).toContainText("went through");

    await expect(page.getByTestId("checkout-state")).toHaveAttribute("data-settled", "yes", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("checkout-tier")).toHaveText("Advance");
    await expect(page.getByTestId("checkout-capability-hosted_ai")).toBeVisible();
  });

  test("settles immediately when the webhook already landed", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signIn(page);

    await page.goto(`${harness.origin}/checkout/complete`);
    await expect(page.getByTestId("checkout-state")).toHaveAttribute("data-settled", "yes");
    await expect(page.getByTestId("checkout-state")).toContainText("Your plan is active");
    await expect(page.getByTestId("checkout-period-end")).toHaveText("December 1, 2026");
  });

  test("stops at its bound with an honest state, never a failure", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signIn(page);

    await page.goto(`${harness.origin}/checkout/complete`);

    // Six polls two seconds apart. Bounded, so this terminates.
    const state = page.getByTestId("checkout-state");
    await expect(state).toContainText("still updating", { timeout: 25_000 });
    await expect(state).toHaveAttribute("data-settled", "no");
    await expect(state).toContainText("went through");
    await expect(state).not.toContainText("failed");
    await expect(state).not.toContainText("declined");

    const reads = harness.billing.calls.filter((call) => call.path === "/entitlement").length;
    // One loader read plus six polls, and then it stops asking.
    expect(reads).toBeLessThanOrEqual(7);
  });

  test("renders the French landing page in French", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signIn(page);

    await page.goto(`${harness.origin}/fr/checkout/complete`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByTestId("checkout-state")).toContainText("Votre forfait est actif");
    await expect(page.locator("body")).not.toContainText("Nuage");
  });
});

/*
 * AD-16's cross-account gate. The billing API resolves the Stripe customer from
 * the CALLER'S OWN record, and the BFF sends no subject or customer parameter —
 * so there is no request A's browser can make that reaches B. These assertions
 * are what prove the absence rather than assume it.
 */
test.describe("one account cannot reach another", () => {
  async function pageFor(browser: Browser): Promise<Page> {
    const context = await browser.newContext();
    return context.newPage();
  }

  test("shows each session its own entitlement, never the other's", async ({ browser }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(2), CLASSIC_ACCOUNT);

    const first = await pageFor(browser);
    await signedInBilling(first);
    await expect(first.getByTestId("billing-tier")).toHaveText("Advance");
    await expect(first.getByTestId("billing-capability-hosted_ai")).toBeVisible();

    const second = await pageFor(browser);
    await signedInBilling(second);
    await expect(second.getByTestId("billing-tier")).toHaveText("Classic");
    // Classic does not grant hosted AI, and this session must not see it.
    await expect(second.getByTestId("billing-capability-hosted_ai")).toHaveCount(0);
    await expect(second.getByTestId("billing-capability-multi_device_sync")).toBeVisible();

    // The first session's page is unchanged by the second's existence.
    await first.reload();
    await expect(first.getByTestId("billing-tier")).toHaveText("Advance");

    const tokens = new Set(
      harness.billing.calls
        .filter((call) => call.path === "/entitlement")
        .map((call) => call.token),
    );
    expect([...tokens].sort()).toEqual([TOKEN_FOR_SIGN_IN(1), TOKEN_FOR_SIGN_IN(2)]);

    await first.context().close();
    await second.context().close();
  });

  test("opens a portal only for the session's own account", async ({ browser }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(2), CLASSIC_ACCOUNT);

    const first = await pageFor(browser);
    await signedInBilling(first);
    const second = await pageFor(browser);
    await signedInBilling(second);

    await second.getByTestId("billing-portal").click();
    await expect(second.getByTestId("stub-hosted-portal")).toBeVisible();

    // The url the server minted is bound to the SECOND session's token, and the
    // request that produced it named no account at all.
    const portal = harness.billing.calls.filter((call) => call.path === "/portal");
    expect(portal).toHaveLength(1);
    expect(portal[0]?.token).toBe(TOKEN_FOR_SIGN_IN(2));
    expect(portal[0]?.body).toBe("");
    expect(second.url()).toContain(encodeURIComponent(TOKEN_FOR_SIGN_IN(2)));
    expect(second.url()).not.toContain(encodeURIComponent(TOKEN_FOR_SIGN_IN(1)));

    await first.context().close();
    await second.context().close();
  });

  test("names no subject or customer on any billing request", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);
    await page.getByTestId("billing-portal").click();
    await expect(page.getByTestId("stub-hosted-portal")).toBeVisible();

    for (const call of harness.billing.calls) {
      for (const forbidden of ["sub", "customer", "cus_", "price_id"]) {
        expect(call.body, `${call.path} names ${forbidden}`).not.toContain(forbidden);
        expect(call.path, `${call.path} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

/*
 * The CSRF gate on the two POST server functions (AD-10). A refusal is a status
 * code and nothing else: no body, no echoed header, no reason.
 *
 * The server-function URL is not a stable string, so it is captured from the
 * real request the page makes and then replayed with a foreign `Origin` — which
 * is the exact shape of the cross-site POST the check exists for. `page.request`
 * shares the browser context's cookie jar, so the replay presents the real
 * session cookie; a page script cannot set `Origin`.
 */
test.describe("Origin verification on the billing mutations", () => {
  async function captureServerFnPost(
    page: Page,
    act: () => Promise<void>,
  ): Promise<{ url: string; data: string }> {
    const posts: { url: string; data: string }[] = [];
    const listener = (request: Request) => {
      if (request.method() === "POST" && request.url().startsWith(harness.origin)) {
        posts.push({ url: request.url(), data: request.postData() ?? "" });
      }
    };
    page.on("request", listener);
    await act();
    page.off("request", listener);

    const captured = posts[0];
    expect(captured, "no server-function POST was observed").toBeDefined();
    return captured!;
  }

  test("refuses startCheckout from a foreign Origin with a bodyless 403", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);

    const captured = await captureServerFnPost(page, async () => {
      await page.getByTestId("billing-plan-classic_monthly_cad").click();
      await expect(page.getByTestId("stub-hosted-checkout")).toBeVisible();
    });

    await page.goBack();
    const before = harness.billing.calls.filter((call) => call.path === "/checkout").length;

    const refusal = await page.request.post(captured.url, {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: captured.data,
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(refusal.status()).toBe(403);
    expect(await refusal.text()).toBe("");
    // The refusal happened before the billing API was reached at all.
    expect(harness.billing.calls.filter((call) => call.path === "/checkout").length).toBe(
      before,
    );
  });

  test("refuses startCheckout with no Origin header at all", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), FREE_ACCOUNT);
    await signedInBilling(page);

    const captured = await captureServerFnPost(page, async () => {
      await page.getByTestId("billing-plan-classic_monthly_cad").click();
      await expect(page.getByTestId("stub-hosted-checkout")).toBeVisible();
    });

    const refusal = await page.request.post(captured.url, {
      headers: { "content-type": "application/json" },
      data: captured.data,
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(refusal.status()).toBe(403);
    expect(await refusal.text()).toBe("");
  });

  test("refuses openPortal from a foreign Origin with a bodyless 403", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);

    const captured = await captureServerFnPost(page, async () => {
      await page.getByTestId("billing-portal").click();
      await expect(page.getByTestId("stub-hosted-portal")).toBeVisible();
    });

    await page.goBack();
    const before = harness.billing.calls.filter((call) => call.path === "/portal").length;

    const refusal = await page.request.post(captured.url, {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: captured.data,
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(refusal.status()).toBe(403);
    expect(await refusal.text()).toBe("");
    expect(harness.billing.calls.filter((call) => call.path === "/portal").length).toBe(before);
  });

  test("refuses openPortal with no Origin header at all", async ({ page }) => {
    harness.billing.accounts.set(TOKEN_FOR_SIGN_IN(1), ADVANCE_ACCOUNT);
    await signedInBilling(page);

    const captured = await captureServerFnPost(page, async () => {
      await page.getByTestId("billing-portal").click();
      await expect(page.getByTestId("stub-hosted-portal")).toBeVisible();
    });

    const refusal = await page.request.post(captured.url, {
      headers: { "content-type": "application/json" },
      data: captured.data,
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(refusal.status()).toBe(403);
    expect(await refusal.text()).toBe("");
  });
});
