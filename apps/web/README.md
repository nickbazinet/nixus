# @nkbaz/web — Nixus Marketing Site

Public marketing site for Nixus, the local-first personal finance desktop app.

Built with **TanStack Start v1** + React 19 + Tailwind v4. Statically prerendered to `.output/public/` and served from a CDN.

## Scripts

```bash
pnpm --filter @nkbaz/web dev        # Dev server on http://localhost:3000
pnpm --filter @nkbaz/web build      # Static prerender to .output/public/
pnpm --filter @nkbaz/web preview    # Preview the production build
pnpm --filter @nkbaz/web typecheck  # tsc --noEmit
pnpm --filter @nkbaz/web test:e2e   # Playwright e2e (added in later stories)
```

## Output

`pnpm build` produces a fully prerendered static site under `.output/public/`. The Nitro server build under `.output/server/` is unused for the public deployment but is generated as a byproduct of the TanStack Start build pipeline. The CDN serves only `.output/public/`.

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

This app consumes `@nkbaz/shared` (workspace) for UI primitives and design tokens. The token CSS is imported in `src/styles/main.css` to register against Tailwind v4's `@theme`.
