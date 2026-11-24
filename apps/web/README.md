# @nixus/web — Nixus Marketing Site

Public marketing site for Nixus, the local-first personal finance desktop app.

Built with **TanStack Start v1** + React 19 + Tailwind v4. Statically prerendered to `.output/public/` and served from a CDN.

## Scripts

```bash
pnpm --filter @nixus/web dev        # Dev server on http://localhost:3000
pnpm --filter @nixus/web build      # Static prerender to .output/public/
pnpm --filter @nixus/web preview    # Preview the production build
pnpm --filter @nixus/web lint       # eslint
pnpm --filter @nixus/web typecheck  # tsc --noEmit
pnpm --filter @nixus/web test       # Vitest unit tests
pnpm --filter @nixus/web test:e2e   # Playwright e2e (build first)
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

The page ships **baked** prices in `src/content/pricing.ts` and those are what gets prerendered, so a crawler and an offline visitor both see complete, correct amounts. After hydration `src/lib/usePlanCatalog.ts` fetches the live catalog and replaces the amount, currency and interval of the Stripe-backed columns — per field, so one malformed value does not discard the rest. That is what lets an operator change a price in the Stripe Dashboard with no rebuild.

A failed, slow or non-200 fetch leaves the baked prices in place silently: no banner, no spinner, no console output. Plans are referenced only by `lookup_key`; no Stripe `price_id` or hard-coded live amount exists anywhere in this app. `cache_ttl_seconds` from the response is the system's only cache bound, so the client adds no TTL and no second cache layer of its own.

Each amount is declared **once**, locale-neutrally, and rendered through `Intl.NumberFormat` with the page's own locale — `$19.99/month` in English, `19,99 $/mois` in French. English and French therefore cannot advertise different amounts, and a price change reaches both at the same moment.

## Languages

English lives at the root, French under `/fr`, with the same slug on both sides (`/pricing` ⇄ `/fr/pricing`). `apps/account` already links out to `nixusapp.com/fr/...` (`apps/account/src/lib/marketing.ts`), so the slugs are a published contract, not a free choice.

There is **no runtime i18n library**. Each language is one plain object checked against the `SiteCopy` type in `src/content/types.ts`:

```
src/content/
├── types.ts       # SiteCopy — every translatable string, as a type
├── en.ts          # English, the source language
├── fr.ts          # Canadian French
├── legal.en.ts    # Terms + Privacy Policy, English
├── legal.fr.ts    # Terms + Privacy Policy, French
├── pricing.ts     # Stripe facts (lookup keys, amounts) — locale-neutral
└── index.ts       # copyFor(locale)
```

A string added to `en.ts` and forgotten in `fr.ts` is a `tsc` error. `src/content/copy.test.ts` covers what a type cannot: array lengths (icons and visuals in code are matched to copy by index), untranslated strings, French typography (non-breaking space before `: ; ! ?`, `%` and `$`, and inside `« »`), and the product vocabulary the desktop and account apps already use (CELI, REER, CELIAPP, valeur nette, forfait).

`src/lib/locale.ts` and `src/lib/routes.ts` are the other half: one table maps each page to its router target and its canonical URL in both languages, and `buildMeta` derives the title, description, `og:locale`, canonical and the full `hreflang` cluster (`en-CA`, `fr-CA`, `x-default`) from that pair alone.

The URL is the only locale authority. There is no `Accept-Language` redirect: every URL answers with the language it advertises, which is what keeps the prerendered HTML, the `hreflang` cluster and the sitemap honest. A visitor changes language with the header/footer switcher, which is a plain `<a href>` to the twin page — a full navigation, so the browser fetches the other prerendered document.

### Verifying the bilingual build

```bash
pnpm --filter @nixus/web build
pnpm --filter @nixus/web verify:prerender  # lang, canonical, og:url, hreflang, JSON-LD, no leaked language
pnpm --filter @nixus/web verify:routes     # every sitemap path resolves through the CloudFront rewrite
pnpm --filter @nixus/web test:e2e          # tests/e2e/bilingual.spec.ts, against .output/public
```

## Project Structure

```
apps/web/
├── src/
│   ├── routes/         # File-based routes (TanStack Start scans this dir)
│   │   ├── __root.tsx  # Shell + <head> setup; derives the locale from the URL
│   │   ├── index.tsx   # Homepage (English)
│   │   ├── 404.tsx     # 404 page (English)
│   │   └── fr/         # One French twin per English route, same slug
│   ├── components/
│   │   ├── pages/      # One component per page, parameterised by locale
│   │   └── ui.tsx      # Shared building blocks (buttons, sections, bullets)
│   ├── content/        # Typed per-locale copy — the single source of truth
│   ├── features/       # Feature-scoped state/logic
│   ├── lib/            # locale.ts, routes.ts, meta.ts, jsonLd.ts, planPrices.ts
│   ├── styles/main.css # Imports tailwind + shared tokens
│   └── router.tsx      # createRouter setup
├── infra/cloudfront/   # The shipped viewer-request rewrite, plus its tests
├── public/             # Static assets served at site root (incl. sitemap.xml)
├── scripts/            # Build-time scripts and the offline output verifiers
└── tests/e2e/          # Playwright tests
```

> **Note on `src/routes/` vs `app/routes/`:** The original architecture spec
> documented `app/routes/`. We chose `src/routes/` because that's the TanStack
> Start v1 default and it matches the `apps/desktop/` convention — staying on
> the framework's happy path is more maintainable than divergence. Trade-off
> is documented; the architecture spec can be updated to match.

## Shared Package

This app consumes `@nixus/shared` (workspace) for UI primitives and design tokens. The token CSS is imported in `src/styles/main.css` to register against Tailwind v4's `@theme`.
