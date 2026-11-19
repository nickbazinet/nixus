import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * AD-8's prohibition, as a guard rather than as a habit.
 *
 * Checkout and the Customer Portal are ALWAYS Stripe-hosted. Nixus renders no
 * card field anywhere, and Stripe Elements, embedded Checkout and every other
 * in-page payment component are FORBIDDEN on every surface - that prohibition,
 * not merely the absence of a card field today, is what keeps the integration at
 * SAQ-A scope. A guard is the only form of it that survives a future change.
 *
 * Comments are stripped before every scan, because this package deliberately
 * NAMES what it refuses to build and a raw text scan would match that rationale.
 * The scan runs over RUNTIME sources for the same reason, exactly as
 * src/iam-isolation.test.ts does: a spec that asserts a publishable key is never
 * logged has to spell one, and this spec has to spell every forbidden symbol in
 * order to look for it.
 */

const SRC_ROOT = fileURLToPath(new URL("./", import.meta.url));
const THIS_SPEC = "commerce-surface.test.ts";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const RUNTIME_SOURCES = sourceFiles(SRC_ROOT)
  .map((path) => ({
    path: path.slice(SRC_ROOT.length),
    code: stripComments(readFileSync(path, "utf8")),
  }))
  .filter(
    (file) =>
      !file.path.endsWith(THIS_SPEC) &&
      !file.path.endsWith(".test.ts") &&
      !file.path.includes("testing/"),
  );

describe("no in-page payment component exists anywhere in this package", () => {
  /* Each of these is a way to put a card field, or the token that fills one, into
   * a Nixus surface. All of them are forbidden, not merely unused. */
  it.each([
    ["Stripe Elements", "Elements"],
    ["a card element", "CardElement"],
    ["a payment element", "PaymentElement"],
    ["an express checkout element", "ExpressCheckoutElement"],
    ["embedded Checkout", "ui_mode"],
    ["embedded Checkout's mount target", "embedded"],
    ["a client secret a browser would confirm with", "client_secret"],
    ["a browser-side confirmation", "confirmPayment"],
    ["a browser-side setup confirmation", "confirmSetup"],
    ["a publishable key", "pk_live_"],
    ["a test publishable key", "pk_test_"],
    ["the browser SDK", "@stripe/stripe-js"],
    ["the React bindings", "@stripe/react-stripe-js"],
    ["a payment method token", "createPaymentMethod"],
  ])("contains no %s", (_label, symbol) => {
    for (const file of RUNTIME_SOURCES) {
      expect(file.code, `${file.path} names ${symbol}`).not.toContain(symbol);
    }
  });

  /* Both commerce surfaces are reached through a URL Stripe hosts. A session
   * created with anything other than these two calls would be a surface this
   * service rendered itself. */
  it("creates both commerce surfaces as Stripe-hosted sessions", () => {
    const code = RUNTIME_SOURCES.map((file) => file.code).join("\n");

    expect(code).toContain("checkout.sessions.create");
    expect(code).toContain("billingPortal.sessions.create");
    expect(code).toContain("managed_payments");
  });

  /* Stripe does not permit updating a Managed Payments subscription's default
   * payment method through the API, so no such path is built - and the guard is
   * what keeps one from being added. */
  it("builds no card-update path of its own", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const symbol of [
        "default_payment_method",
        "paymentMethods.attach",
        "paymentMethods.create",
        "setupIntents",
      ]) {
        expect(file.code, `${file.path} names ${symbol}`).not.toContain(symbol);
      }
    }
  });

  /* The card fields are not merely absent from the code: the log serializer
   * types each of them as `never`, so a caller holding one cannot be passed to
   * it at all. That mechanism is why `card_number` is not on the list above - it
   * appears in src/lib/logging.ts precisely in order to be forbidden. */
  it("types every card field as never in the one serializer", () => {
    const logging = RUNTIME_SOURCES.find(
      (file) => file.path === "lib/logging.ts",
    )!;

    for (const field of ["card", "card_number", "cvv", "payment_method"]) {
      expect(logging.code, field).toContain(`${field}?: never`);
    }
  });

  /* No amount, currency amount or price id in code: prices are referenced ONLY
   * by lookup key, and every amount is read from Stripe for display (AD-6). */
  it("contains no amount, currency amount or literal price id", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const symbol of ["unit_amount:", "price_1", "prod_", "9.99", "19.99"]) {
        expect(file.code, `${file.path} names ${symbol}`).not.toContain(symbol);
      }
    }
  });

  /* Proration is Stripe's: the desktop and the account app never compute one,
   * and neither does this service. */
  it("computes no proration", () => {
    for (const file of RUNTIME_SOURCES) {
      for (const symbol of ["proration", "prorate"]) {
        expect(file.code.toLowerCase(), `${file.path} names ${symbol}`).not.toContain(
          symbol,
        );
      }
    }
  });
});
