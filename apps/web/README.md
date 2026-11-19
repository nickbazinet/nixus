# @nixus/web — Nixus Marketing Site

Public marketing site for Nixus, the local-first personal finance desktop app.

Built with **TanStack Start v1** + React 19 + Tailwind v4. Statically prerendered to `.output/public/` and served from a CDN.

## Scripts

```bash
pnpm --filter @nixus/web dev        # Dev server on http://localhost:3000
pnpm --filter @nixus/web build      # Static prerender to .output/public/
pnpm --filter @nixus/web preview    # Preview the production build
pnpm --filter @nixus/web typecheck  # tsc --noEmit
pnpm --filter @nixus/web test:e2e   # Playwright e2e (added in later stories)
```

## Output

`pnpm build` produces a fully prerendered static site under `.output/public/`. The Nitro server build under `.output/server/` is unused for the public deployment but is generated as a byproduct of the TanStack Start build pipeline. The CDN serves only `.output/public/`.

## Environment

Copy `.env.example` to `.env` and adjust. Everything the browser needs is `VITE_`-prefixed; all of it is public, none of it is secret.

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_BILLING_API_URL` | `https://api.nixusapp.com` | Origin the `/pricing` page reads the live plan catalog from (`GET /v1/billing/plans`). Point it at a Stripe test-mode deployment to develop against test prices. |
| `VITE_CLOUDFLARE_ANALYTICS_TOKEN` | unset | Cloudflare Web Analytics site token. The beacon is only injected on production builds when this is set. |

### How `/pricing` gets its prices

The page ships **baked** EN/FR prices in `src/content/pricing.ts` and those are what gets prerendered, so a crawler and an offline visitor both see complete, correct amounts. After hydration `src/lib/usePlanCatalog.ts` fetches the live catalog and replaces the amount, currency and interval of the Stripe-backed columns — per field, so one malformed value does not discard the rest. That is what lets an operator change a price in the Stripe Dashboard with no rebuild.

A failed, slow or non-200 fetch leaves the baked prices in place silently: no banner, no spinner, no console output. Plans are referenced only by `lookup_key`; no Stripe `price_id` or hard-coded live amount exists anywhere in this app. `cache_ttl_seconds` from the response is the system's only cache bound, so the client adds no TTL and no second cache layer of its own.

## Project Structure

```
apps/web/
├── src/
│   ├── routes/         # File-based routes (TanStack Start scans this dir)
│   │   ├── __root.tsx  # Shell + <head> setup
│   │   ├── index.tsx   # Homepage (placeholder until Story 3.1)
│   │   └── 404.tsx     # 404 page
│   ├── components/     # Empty until Story 1.3 (SiteHeader/Footer)
│   ├── features/       # Empty until Story 2.x / 3.x
│   ├── lib/            # Empty until Story 2.1 (releases.gen.ts)
│   ├── styles/main.css # Imports tailwind + shared tokens
│   └── router.tsx      # createRouter setup
├── content/            # Markdown content (later stories)
├── public/             # Static assets served at site root
├── tests/e2e/          # Playwright tests (later stories)
└── scripts/            # Build-time scripts (later stories)
```

> **Note on `src/routes/` vs `app/routes/`:** The original architecture spec
> documented `app/routes/`. We chose `src/routes/` because that's the TanStack
> Start v1 default and it matches the `apps/desktop/` convention — staying on
> the framework's happy path is more maintainable than divergence. Trade-off
> is documented; the architecture spec can be updated to match.

## Shared Package

This app consumes `@nixus/shared` (workspace) for UI primitives and design tokens. The token CSS is imported in `src/styles/main.css` to register against Tailwind v4's `@theme`.
