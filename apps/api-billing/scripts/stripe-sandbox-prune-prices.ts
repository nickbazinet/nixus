/**
 * Archives stray Prices on the Nixus tier Products in a Stripe SANDBOX.
 *
 * A Price is kept only if it is active and holds one of the catalog lookup keys that
 * `stripe-sandbox-setup.ts` manages. Every other active Price on a Product carrying
 * `nixus_tier` is archived (`active: false`). Stripe never deletes a Price, and archiving
 * leaves existing subscriptions on it untouched; it only stops new checkouts from using it.
 *
 *   STRIPE_SECRET_KEY=sk_test_... \
 *     node --experimental-strip-types apps/api-billing/scripts/stripe-sandbox-prune-prices.ts
 *
 * Add --apply to write. Without it the script is a DRY RUN. Live keys are refused.
 */

import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-10-28.endive";
const TIER_METADATA_KEY = "nixus_tier";
const KEEP_LOOKUP_KEYS: ReadonlySet<string> = new Set([
  "classic_monthly_cad",
  "advance_monthly_cad",
  "classic_yearly_cad",
  "advance_yearly_cad",
]);

const APPLY = process.argv.includes("--apply");

function describe(price: Stripe.Price): string {
  const amount = price.unit_amount === null ? "n/a" : (price.unit_amount / 100).toFixed(2);
  return `${price.id} ${amount} ${price.currency}/${price.recurring?.interval ?? "one-time"} lookup_key=${price.lookup_key ?? "none"}`;
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("refusing to run: STRIPE_SECRET_KEY is not a Stripe test key.");
  }

  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION, typescript: true });
  process.stdout.write(`Stripe sandbox price prune — ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}\n\n`);

  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    const tier = product.metadata[TIER_METADATA_KEY];
    if (!tier) continue;

    process.stdout.write(`Product ${product.name} (${tier}) ${product.id}\n`);
    for await (const price of stripe.prices.list({ product: product.id, active: true, limit: 100 })) {
      const keep = price.lookup_key !== null && KEEP_LOOKUP_KEYS.has(price.lookup_key);
      if (keep) {
        process.stdout.write(`  keep     ${describe(price)}\n`);
        continue;
      }
      if (!APPLY) {
        process.stdout.write(`  [would archive] ${describe(price)}\n`);
        continue;
      }
      await stripe.prices.update(price.id, { active: false });
      process.stdout.write(`  archived ${describe(price)}\n`);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `stripe-sandbox-prune-prices failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
