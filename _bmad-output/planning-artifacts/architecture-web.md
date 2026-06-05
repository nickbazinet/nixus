---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
completedAt: '2026-04-25'
inputDocuments:
  - architecture.md
  - architecture-desktop.md
  - product-brief-nixus-marketing-site-2026-04-25.md
  - ux-design-specification-nixus-marketing-site-2026-04-25.md
  - product-brief-nkbaz-finance-2026-03-14.md
  - prd.md
workflowType: 'architecture'
project_name: 'nixus-marketing-site'
user_name: 'Nbazinet'
date: '2026-04-25'
scope: 'module'
module: 'web'
location: 'apps/web/'
parentArchitecture: 'architecture.md'
status: 'complete'
---

# Web App (Marketing Site) Architecture Decision Document

_This is the module-level architecture document for the Nixus web app, located at `apps/web/`. It inherits all platform-level decisions from [architecture.md](architecture.md) and documents only what's specific to the web application._

**Parent platform architecture:** [architecture.md](architecture.md)
**Sister module:** [architecture-desktop.md](architecture-desktop.md)
**Related specs:** product-brief-nixus-marketing-site, ux-design-specification-nixus-marketing-site

_Sections are appended as the workflow proceeds through each architectural decision together._

## Project Context Analysis

### Requirements Overview

The Nixus marketing site is the v1 entry point for the platform's public surface. Per the product brief and UX spec, v1 ships a single long-scroll landing page hosted from `apps/web/`, distributing the desktop binary via GitHub Releases. Auth, payments, and any authenticated surfaces are deferred to v2 but the architecture must not paint itself into a corner that prevents them.

**Functional Requirements (from product brief and UX spec):**

| FR | Requirement | Architectural impact |
|----|-------------|---------------------|
| FR-W1 | Single long-scroll landing page (hero, AI demo, features, screenshots, builder section, FAQ, footer) | Static-rendered SPA or static site; one route in v1 |
| FR-W2 | OS detection (macOS / Windows / Linux / mobile) on page load drives Download CTA variant | Client-side UA parsing; no server-side detection needed |
| FR-W3 | Download CTA serves the latest GitHub Release asset for the detected OS, with build-time pinned-version fallback | GitHub Releases API integration at build time (preferred) or runtime (fallback) |
| FR-W4 | AI parse demo runs as a silent autoplay loop on viewport entry, with `prefers-reduced-motion` static fallback | Client-side animation; tech choice (CSS / Lottie / canvas / video) deferred to step 4 |
| FR-W5 | Right-click on Download CTA exposes a clean binary URL (no tracking redirect) | Real `<a href>` element; no JavaScript-only navigation |
| FR-W6 | Same-page "Thanks + install instructions" reveal after Download click | Client-side state, no route change |
| FR-W7 | Per-OS install instructions (macOS Gatekeeper, Windows SmartScreen) | Static content with shadcn `Tabs` for OS switching |
| FR-W8 | Mobile/tablet visitors see a "Visit on a Mac or PC to download" message + send-to-computer affordance (mailto-self, copy link) | UA-based viewport detection; no separate mobile route |
| FR-W9 | FAQ accordion (single-open) with 8 v1 questions | shadcn Accordion; static content |
| FR-W10 | Privacy-friendly analytics on Download CTA clicks | Lightweight tracker (Plausible / Umami / Cloudflare Analytics) — no cookie banner |
| FR-W11 | SEO basics: meta tags, OG image, sitemap.xml, robots.txt | Static-friendly; framework choice must support meta management |

**v2 capabilities the architecture must accommodate (deferred but seam-aware):**

- FR-WV2-1: Auth (Cognito) — login/signup pages, JWT handling
- FR-WV2-2: Pricing page describing free + paid modules
- FR-WV2-3: Stripe checkout for paid modules
- FR-WV2-4: Authenticated `/account` page (subscription status, billing, downloads)
- FR-WV2-5: Optional first-party `/changelog` and `/blog` pages

**Non-Functional Requirements:**

| NFR | Requirement | Architectural impact |
|-----|------------|---------------------|
| NFR-W1 | ~$0/month at zero traffic (inherited from platform NFR-P1) | Static deploy on S3 + CloudFront (free tier), or equivalent (Cloudflare Pages, Vercel free, Netlify free) |
| NFR-W2 | First paint < 1 second; Lighthouse Performance ≥ 90 mobile + desktop | Static rendering; lazy-loaded AI demo; no client-side framework bloat above what's required |
| NFR-W3 | Lighthouse a11y / SEO / best-practices ≥ 90 on every CI build | axe-core + Lighthouse CI gating |
| NFR-W4 | WCAG 2.1 AA compliance | Semantic HTML, focus management, reduced-motion support, screen-reader testing |
| NFR-W5 | No EU-style cookie banner on first paint | Cookieless analytics |
| NFR-W6 | Modern browsers only — last 2 versions of Chrome, Edge, Firefox, Safari | No legacy polyfills required |
| NFR-W7 | Site works with JavaScript disabled (degraded but functional Download CTA) | SSG-friendly framework; no SPA-only critical path |
| NFR-W8 | OS detection result must be available before first paint or render seamlessly post-paint | Client-side detection with sensible default; flicker minimized |
| NFR-W9 | Site survives GitHub Releases API outage | Build-time release URL fetch + pinned-version fallback |
| NFR-W10 | Visual continuity with the desktop app (shared shadcn tokens) | Shared `packages/ui` consumption |
| NFR-W11 | Ship-fast solo-builder cadence | Bias toward established tools, minimal infra, no operational overhead |

**Scale & Complexity:**

- **Complexity:** Low–Medium. A single-page marketing site is a small surface, but the AI demo, OS detection, and GitHub Releases integration each carry complexity that must be handled correctly.
- **Primary domain:** Frontend / static web (SPA or SSG). No backend services required for v1. v2 introduces an authed boundary that reaches into the platform API (already documented in `architecture.md`).
- **Estimated component count:** ~10 marketing-specific components (Hero, AIDemo, FeatureGrid, FAQ, etc., per UX spec) plus shared primitives consumed from `packages/ui`.
- **Routes in v1:** 1 (`/`). Plus `/404`. Plus optional `/thanks` if same-page reveal is replaced with a route (UX spec prefers same-page).
- **Routes planned for v2:** `/pricing`, `/account`, `/account/billing`, `/login`, `/signup`, `/releases`, `/changelog`, `/docs`, `/blog`. The routing solution must scale to this without restructuring.

### Technical Constraints & Dependencies

**Inherited from platform `architecture.md` (non-negotiable):**

- **Stack:** Vite + React, TypeScript
- **Routing:** TanStack Router
- **Data fetching:** TanStack Query (when authed surfaces ship; v1 has minimal data fetching beyond GitHub Releases)
- **UI:** shadcn/ui + Tailwind CSS, consumed from `packages/ui` in the monorepo
- **Hosting:** S3 + CloudFront (or equivalent free-tier static host if the architect proposes a swap)
- **Auth model (when v2 ships):** Cognito JWTs, validated at API Gateway level
- **JSON contract with backend:** snake_case (matching desktop and API)
- **Monorepo:** pnpm workspaces under `apps/` and `packages/`
- **Cost model:** AWS free tier or pay-per-use only

**Marketing-site-specific dependencies:**

- **GitHub Releases** as the binary source of truth — both for the desktop app's macOS and Windows builds. The web app fetches release metadata at build time (preferred) or runtime (fallback).
- **Privacy-friendly analytics provider** — Plausible, Umami, Cloudflare Analytics, or equivalent. No GA4, no Mixpanel.
- **AI demo asset/animation tech** — TBD in step 4. Constrained by performance NFR (must not block first paint) and accessibility NFR (must support reduced-motion).
- **Hosting domain** — TBD; the architecture documents the *constraint* (custom domain on CloudFront-served static site) without picking the actual domain name.

**Solo-builder constraints:**

- No operational overhead — no databases to manage in v1, no servers to keep alive, no scheduled jobs.
- Minimal toolchain — every added tool must justify its weight.
- Deployment is one command or pushed-to-branch automation.

### Cross-Cutting Concerns Identified

These concerns span multiple parts of the web app and need consistent handling.

1. **OS detection** — appears in the Hero, sticky header, and any mid-page CTA. Must be a single shared utility, not duplicated per component. Handles macOS, Windows, Linux (treated as "choose your platform"), iOS, Android, and unknown UAs.

2. **GitHub Releases data flow** — the source URL for the binary, the version label on the CTA, and the install instructions all depend on release metadata. Must be fetched at build time (so the page renders with correct data on first paint) with a runtime fallback if the build-time fetch is stale or GitHub is temporarily unreachable.

3. **AI demo lifecycle** — the demo's autoplay, loop, reduced-motion fallback, and lazy-loading behavior must be consistent across any place it appears. Encapsulated in a single `<AIDemo />` component.

4. **Analytics events** — only one event ships in v1 (Download CTA click) but the analytics integration should be generic enough to accept future events (page views, FAQ expansion, anchor link clicks) without code restructuring.

5. **Design token inheritance** — every color, spacing, radius value must come from the shared `packages/ui` Tailwind config. No marketing-only design tokens that could drift from the desktop app's palette.

6. **Routing topology that scales to v2** — TanStack Router setup for v1 is one route, but the directory structure must support /pricing, /account, /login, etc. without rework. File-based or code-based routing — choice deferred to step 4.

7. **Auth seam (v2-ready)** — even though v1 has no auth, the layout component and routing config should be structured so a `<RequireAuth>` wrapper can be added in v2 without touching v1 pages. No global auth state in v1, but no anti-patterns that would prevent it later.

8. **SEO + meta management** — every page (just `/` in v1, more in v2) needs a clear pattern for `<title>`, `<meta>`, OG tags, Twitter cards, JSON-LD. The framework / tooling choice must support this without manual `<head>` injection per route.

9. **Static-first with progressive client behavior** — the page must work with JavaScript disabled (degraded Download CTA shows both options as plain links). OS detection, animation, and same-page state are progressive enhancements layered on top of a working static baseline.

10. **Build-time vs. runtime for release data** — a recurring decision shape. Default: build-time wherever possible (faster, cheaper, fewer failure modes). Runtime acceptable when the data freshness window matters more than performance (e.g., user-specific data in v2).

## Starter Template Evaluation

### Primary Technology Domain

**Web (static-first React)** — content-led marketing site with one route in v1, scaling to authed surfaces (`/account`, `/pricing`, `/login`) in v2. Per platform `architecture.md`, the stack is locked to Vite + React + TypeScript + TanStack Router + shadcn/ui. The starter decision is therefore narrower: how do we initialize a Vite + React + TanStack Router project with **static prerendering** for the marketing v1 (NFR-W2 first paint, NFR-W7 JS-disabled fallback, NFR-W3 Lighthouse SEO ≥ 90)?

### Starter Options Considered

#### Option A — **TanStack Start** (chosen)

TanStack Start v1.0 (released March 2026) is the official meta-framework built on TanStack Router. It supports static prerendering out of the box: an app can use `createServerFn` / `'use server'` and *also* be completely static with no server other than a CDN — which exactly matches the platform's "no Node.js servers / S3+CloudFront" constraint.

**Strengths:**
- **Aligned with platform decisions** — the platform doc already commits to TanStack Router; TanStack Start is the official Start framework on top of it. Zero divergence.
- **SSG ships with the framework** — static prerendering via a `prerender` config option; no extra plugins, no community tooling.
- **Type-safe routing** end-to-end (file-based or code-based, configurable).
- **Scales to v2 cleanly** — when auth and authed surfaces ship, `createServerFn` is available without restructuring. v1 stays pure-static; v2 introduces server functions only where needed.
- **Solo-builder velocity** — one framework to learn, official docs, active maintenance, no "this one piece is community-maintained" risk.

**Trade-offs:**
- Younger than alternatives (v1 was March 2026). Some edge tooling (image optimization, MDX) is still maturing relative to Astro's ecosystem.
- Less marketing-content-specific than Astro (no built-in MDX/content collections — but irrelevant for v1's no-blog scope).

#### Option B — **Astro 5 + React islands**

Astro is the gold standard for content-heavy marketing sites: islands architecture ships near-zero JS by default, sprinkling React (with shadcn) only for interactive components. Astro 5 + Tailwind v4 + shadcn integration is well-documented.

**Strengths:**
- Best-in-class first-paint performance — minimal JS by default
- Excellent for content-marketing site shape (blog, docs, etc.)
- Strong SEO defaults

**Trade-offs:** *(disqualifying for this project)*
- **Breaks platform consistency** — Astro's routing is not TanStack Router. Authed v2 surfaces would either run as Astro pages (different patterns from desktop) or split into a second app
- React context doesn't cross islands — shadcn components imported directly into `.astro` files fail; requires wrapping in `.tsx` files. Adds friction.
- Two frameworks to maintain in a "ship fast" solo-builder scenario

#### Option C — **Vite + Vike (vite-plugin-ssr) + React + TanStack Router**

Vike is mature, maintained, ships SSG-or-SSR per route, works with any UI framework.

**Strengths:**
- Production-tested, stable
- Flexible per-route render mode (SSG for `/`, SSR or SPA for `/account` later)

**Trade-offs:**
- Adds a third party between Vite and React (Vike) — more moving parts than TanStack Start, which provides SSG natively
- Vike's TanStack Router integration is community-supported, not first-party
- Slightly more configuration to wire up than TanStack Start

#### Option D — **Vite + React + react-helmet-async + custom prerenderer**

Plain Vite SPA with manual SSG (e.g., `vite-react-ssg`) for the single marketing route.

**Strengths:**
- Minimal dependency footprint
- Maximum control

**Trade-offs:**
- More glue code; more decisions to make manually (meta management, prerender config, etc.)
- React Router v7 now has built-in SSG support, but the platform doc commits to TanStack Router — using React Router would require a deviation

### Selected Starter: **TanStack Start v1**

**Rationale for Selection:**
1. Aligned with the platform-locked TanStack Router decision — zero divergence, one framework family across web modules
2. Native SSG/static-prerendering matches NFR-W1 (no servers), NFR-W2 (fast first paint), NFR-W7 (JS-disabled graceful fallback)
3. v2-ready: `createServerFn` is available when authed surfaces ship; v1 marketing site uses pure static prerendering
4. Solo-builder fit: one official framework, one set of patterns, mature ecosystem (TanStack Query, TanStack Router, TanStack Start are all maintained together)
5. Recently shipped v1.0 (March 2026) with production benchmarks (5.5x throughput, 9.9x faster latency over comparable React frameworks)

**Initialization command (current, verify at install time):**

```bash
# From the monorepo root, scaffold the marketing site app
pnpm dlx create-tsrouter-app@latest apps/web --template start --tailwind

# (or, if creating manually within an existing pnpm monorepo):
mkdir -p apps/web && cd apps/web
pnpm init
# then add tsstart, tsrouter, react, react-dom, tailwindcss per
# https://tanstack.com/start/latest/docs/framework/react/quick-start
```

> **Note:** Verify the latest CLI invocation at install time — TanStack ships frequently and CLI flags evolve.

**Architectural Decisions Provided by the Starter:**

**Language & Runtime:**
- TypeScript with strict mode
- React 18+ with React Server Components support (when using server functions in v2)
- Node 20+ for the build pipeline only — no Node runtime at deploy time

**Routing:**
- TanStack Router (file-based or code-based; this project uses **code-based** to match desktop convention)
- Type-safe params, search params, nested layouts, route loaders

**Static Prerendering:**
- `prerender` config option in `app.config.ts` enabled for the v1 marketing route(s)
- Build output: static HTML + JS chunks suitable for S3+CloudFront upload
- `_redirects` / `_routes.json` files generated as needed for SPA fallback on client-side routes

**Server Functions:**
- Available but **unused in v1** — kept dormant. v2 may introduce `createServerFn` calls for Stripe webhook handling or session management, but that's out of v1 scope.

**Styling:**
- Tailwind CSS (latest v4 with CSS-first config, matching desktop app's setup if upgraded; otherwise v3 for consistency)
- shadcn/ui components imported from the shared `packages/ui` workspace package
- Site-specific compositions live in `apps/web/components/`

**Build Tooling:**
- Vite as the underlying bundler (TanStack Start uses Vite internally)
- Hot module reload during dev
- Build output: `dist/` directory, static-only by default

**Testing Framework:**
- Vitest for unit tests (Vite-native, fast)
- Playwright for end-to-end tests (already in use in the desktop app per platform doc — pattern consistency)
- Lighthouse CI for performance/a11y/SEO regression gates

**Linting / Formatting:**
- ESLint with the TanStack Start preset
- Prettier with shared monorepo config (or Biome if the platform standardizes on it later)
- Inherit from monorepo `tsconfig` base where possible

**Code Organization:**
- `apps/web/`
  - `app/` — route definitions, layouts, root component
  - `components/` — marketing-specific compositions (Hero, AIDemo, FeatureGrid, etc., per UX spec)
  - `features/` — feature-grouped logic (e.g., `features/download/` houses OS detection, GitHub Releases fetching, install instructions)
  - `lib/` — utilities (analytics wrapper, UA parser, etc.)
  - `public/` — static assets (favicon, OG image, screenshots, AI demo asset)
  - `app.config.ts` — TanStack Start config (prerender, build target, etc.)

**Development Experience:**
- `pnpm dev` — local dev server with HMR
- `pnpm build` — production static build
- `pnpm preview` — preview the built static output locally
- `pnpm test` — Vitest watch mode
- `pnpm test:e2e` — Playwright E2E tests

**Note:** Project initialization using this command (or a manual wire-up of TanStack Start) should be the first implementation story for the web app. The exact CLI invocation must be verified at the time of initialization — TanStack Start is on a fast release cadence.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- AI demo rendering technology
- GitHub Releases fetching strategy (build-time vs runtime)
- Analytics provider
- CI/CD pipeline approach
- DNS / domain registrar strategy

**Important Decisions (Shape Architecture):**
- OG image generation approach
- Image optimization pipeline
- Error monitoring (or absence thereof)
- Site map / robots.txt generation
- Environment variable / secrets strategy

**Deferred Decisions (Post-v1):**
- Authenticated route layout (deferred to v2 — Cognito wiring)
- Stripe integration (v2)
- Server function patterns (v2 — `createServerFn`)
- Localization framework (v3+)
- Blog/docs CMS (deferred — Phase 3)

---

### Data Architecture

**v1 has minimal data architecture** — the marketing site is essentially a static page with one external integration (GitHub Releases).

**Decision: GitHub Releases as the binary metadata source**
- **Source of truth:** `https://api.github.com/repos/{owner}/{repo}/releases/latest`
- **Fetch timing:** **Build-time** (preferred). The `prerender` step in TanStack Start fetches the latest release once during build and bakes the binary URL + version into the static HTML. Result: zero runtime dependency on GitHub, instant first paint.
- **Rebuild trigger:** A new desktop app release publishes to GitHub Releases → triggers a CI rebuild + redeploy of the marketing site (via `repository_dispatch` or workflow_call from the desktop app's release pipeline).
- **Pinned-version fallback:** An env var `VITE_PINNED_RELEASE_TAG` (e.g., `v0.2.1`) overrides the "latest" lookup at build time. Used as a kill-switch when a release is broken.
- **Runtime fallback:** If a visitor lands on a stale page (e.g., a new release shipped but the rebuild hasn't completed), the Download CTA still works against whatever release was baked in at build time. No runtime API call to GitHub from the visitor's browser.

**Rationale:** Build-time fetching meets NFR-W1 (zero ongoing cost), NFR-W2 (instant first paint, no API loading state), and NFR-W9 (survives GitHub Releases outages).

**Decision: No client-side data store, no API layer in v1**
- TanStack Query is **available** (consumed from the platform's shared deps) but **unused** in v1. v2 will use it for authed `/account` data.
- No localStorage, no IndexedDB. The site is stateless from the visitor's perspective.

**Decision: API integration deferred to v2**
- v1 has no API calls from the visitor's browser. All "dynamic" data (release version, OS detection result) is either build-time-resolved or client-side-derived.
- v2 introduces calls to the platform API (Cognito, user profile, Stripe checkout). Those will use TanStack Query + the snake_case JSON contract documented in the platform `architecture.md`.

---

### Authentication & Security

**v1 has no authentication** — the marketing site is fully public.

**Decision: No auth in v1, but architecture must not block v2 auth**
- Layout components, routing config, and TanStack Router structure will be set up so a `<RequireAuth>` wrapper or route-level loader can be added in v2 without restructuring v1 pages.
- v1 explicitly does **not** include: auth provider setup, JWT handling, session management, login UI.
- When v2 ships: Cognito (per platform doc), JWTs in HTTP-only cookies, validated at API Gateway level for any authed endpoint.

**Decision: CSP / security headers strategy**
- Static deploy on CloudFront → security headers configured at CloudFront response policy level (not in HTML meta tags)
- Headers to set: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **CSP:** Strict for v1 — `default-src 'self'`, allowlist for analytics provider domain, `img-src` allowlist for GitHub asset URLs (binary download links), no inline scripts/styles. May need iteration after first deploy.

**Decision: Secrets handling**
- **No secrets in browser-shipped code.** Environment variables prefixed with `VITE_` are public; non-prefixed ones are build-time-only.
- **GitHub token for Releases API:** Public repo means the Releases API is rate-limited at 60/hour unauthenticated (sufficient for build-time fetches at sane cadences). Still, use a `GITHUB_TOKEN` (auto-provided in GitHub Actions) for the build-time fetch to get the 1000/hour authenticated limit.
- **Analytics provider key (if applicable):** Plausible/Umami don't require client-side secrets (just a public site ID). No key handling required.

---

### API & Communication Patterns

**v1 has no API integration from the browser.** The only "API" interaction is build-time GitHub Releases fetching (Node-side, in the build script).

**Build-time fetch implementation:**
- Plain `fetch` to GitHub REST API in `app.config.ts` or a dedicated build-time loader
- Result cached as a generated TypeScript file (`apps/web/lib/release.gen.ts`) committed to the build output, not source control
- Build fails fast if GitHub returns an unexpected response shape — better to block deploy than ship broken Download CTAs

**v2 API patterns (deferred):**
- TanStack Query for client-side data fetching
- snake_case JSON request/response (platform standard)
- Error responses follow the platform API's standard error envelope (defined in `architecture-api.md`, not this doc)

---

### Frontend Architecture

**Decision: AI demo rendering technology — CSS + small Canvas/SVG**

Evaluated:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **CSS keyframe animation + DOM elements** *(chosen)* | Smallest payload (~5–10 KB), no extra deps, hits 60fps trivially, accessible (real DOM nodes can have ARIA), respects `prefers-reduced-motion` natively | Less expressive for complex effects | **Best fit for v1** |
| Lottie (lottie-web or @lottiefiles/dotlottie-web) | Designer-friendly, smooth animations | ~250–400 KB lottie-web runtime; overkill for our simple animation; `prefers-reduced-motion` requires manual handling | Reject — too heavy |
| Canvas / WebGL | Maximum control | Hardest to make accessible, custom code, overkill for this animation | Reject — wrong tool |
| Looped MP4/WebM video | Simplest implementation | Large file size at quality, autoplay restrictions vary by browser, no DOM-level accessibility | Reject — fragility, weight |
| GIF | Universally supported | Massive file size, low quality, no reduced-motion support | Reject — quality |

**The chosen approach:** real DOM elements (transaction rows, statement card, badges) animated with CSS keyframes. Same approach as the prototype HTML in `ux-design-directions-nixus-marketing-site.html`. Total CSS animation cost: < 5 KB. Honors `prefers-reduced-motion: reduce` via `@media (prefers-reduced-motion: reduce)` to disable keyframes.

**Decision: State management — React local state only in v1**
- No global state library (no Redux, no Zustand, no Jotai)
- Hooks: `useState`, `useEffect`, `useMemo` for OS detection, post-click reveal state, FAQ accordion state
- v2 introduces TanStack Query for server state; auth state via TanStack Router context

**Decision: Component architecture — feature-based, matching desktop**

```
apps/web/
├── app/
│   ├── routes/
│   │   ├── __root.tsx           # Layout with header + footer
│   │   ├── index.tsx            # The single v1 marketing page
│   │   └── 404.tsx              # 404 page
│   └── app.config.ts            # TanStack Start config (prerender, etc.)
├── components/
│   ├── Hero.tsx                 # Marketing-specific compositions
│   ├── AIDemo.tsx
│   ├── FeatureGrid.tsx
│   ├── ScreenshotShowcase.tsx
│   ├── FAQ.tsx
│   ├── BuilderSection.tsx
│   ├── SiteHeader.tsx
│   ├── SiteFooter.tsx
│   └── InstallInstructions.tsx
├── features/
│   └── download/                # Co-located feature
│       ├── DownloadCTA.tsx      # The OS-aware Download button
│       ├── useOSDetection.ts    # UA-parsing hook
│       ├── release.ts           # Build-time release fetcher (Node)
│       └── release.gen.ts       # Generated release metadata (gitignored)
├── lib/
│   ├── analytics.ts             # Thin wrapper around chosen analytics SDK
│   └── meta.ts                  # SEO meta-tag helper
└── public/
    ├── favicon.svg
    ├── og-image.png
    ├── screenshots/             # Real desktop app screenshots
    └── robots.txt
```

**Decision: Routing — code-based, single route in v1**

- `app/routes/__root.tsx` defines the shared layout (`<SiteHeader />` + `<Outlet />` + `<SiteFooter />`)
- `app/routes/index.tsx` is the single marketing page composition
- `app/routes/404.tsx` for unmatched routes
- Future routes (`/pricing`, `/account`, `/login`) added here in v2 without restructuring

**Decision: Bundle / performance budget**
- **Critical path:** ≤ 200 KB JS gzipped on first paint (TanStack Start runtime + React + minimal page chunk)
- **Total page weight:** ≤ 500 KB on first paint excluding the AI demo asset and below-fold images
- **Below-the-fold:** lazy-loaded images with native `loading="lazy"`; AI demo is below-fold-friendly (renders on viewport entry)
- **Lighthouse Performance:** ≥ 90 on mobile, ≥ 95 on desktop (gating in CI)

---

### Infrastructure & Deployment

**Decision: Hosting — S3 + CloudFront** (per platform doc)
- Static build output uploaded to a private S3 bucket
- CloudFront distribution serves with custom domain, HTTPS via ACM (free), edge caching
- Single distribution for all environments — staging uses a path or subdomain; not a separate distribution
- **Cost:** $0–$1/month at low traffic (CloudFront free tier covers 1 TB egress/month)

**Decision: DNS — Cloudflare (recommended) OR Route 53**

| Option | Pros | Cons |
|--------|------|------|
| **Cloudflare DNS** *(recommended)* | Free, fast, strong UI, easy DNSSEC | DNS provider differs from hosting (CloudFront on AWS) |
| Route 53 | Same vendor as hosting | $0.50/zone/month — non-zero cost; less polished UI than Cloudflare |

**Recommendation:** Cloudflare DNS pointing to the CloudFront distribution. Free, faster propagation, better DNSSEC support. AWS-native isn't a hard requirement for DNS.

**Decision: CI/CD — GitHub Actions**
- Repo lives on GitHub; Actions are free for public repos and generous for private
- Workflow: `on: push to main` → install deps → run tests → fetch GitHub Releases (build-time) → build TanStack Start app → run Lighthouse CI → upload to S3 → invalidate CloudFront paths
- Separate `on: repository_dispatch` (from the desktop app's release pipeline) → triggers a marketing-site rebuild when a new desktop release ships
- PR previews: optional — could deploy preview branches to a `*.preview.nixus.nicolasbazinet.net` subdomain. Defer to post-v1 unless preview reviews become important.

**Decision: Analytics — Cloudflare Web Analytics (free) OR Plausible (€19/mo)**

| Option | Pros | Cons |
|--------|------|------|
| **Cloudflare Web Analytics** *(recommended for v1)* | Free, privacy-friendly, no cookie banner, zero infra to manage, fits the Cloudflare DNS already chosen | Only useful summary; less granular than dedicated tools |
| Plausible | Better UI, more event-tracking flexibility, EU-hosted | €19/month base — non-zero ongoing cost |
| Umami self-hosted | Free, privacy-friendly | Requires hosting (defeats no-server constraint) |
| GA4 | Comprehensive, free | Hostile to privacy goal, requires cookie banner |

**Recommendation:** Cloudflare Web Analytics for v1. Free, zero infra, no cookie banner. Migrate to Plausible later if event-tracking granularity matters.

**Decision: Error monitoring — none in v1**
- The marketing site has minimal client-side logic. No forms, no API calls, no auth. Errors that could occur (failed asset loads, JS exceptions) are rare and recoverable.
- Adding Sentry/etc. adds payload weight + a free-tier signup that doesn't pay off for a static page.
- Lighthouse CI in the pipeline catches major regressions pre-deploy.
- Revisit when v2 ships authed flows where errors actually matter.

**Decision: OG image — static PNG generated once + Vercel-style runtime if needed**
- v1: A single, well-crafted `public/og-image.png` (1200×630). Designed once, served as the OG image for the homepage.
- v2: If per-page OG images become necessary (pricing tiers, blog posts), revisit using `@vercel/og`-style runtime image generation or Satori at build time. **Not v1 scope.**

**Decision: Image optimization — TanStack Start defaults + manual pre-processing**
- Screenshots are pre-processed manually before being committed to `public/screenshots/`: WebP versions at 1x and 2x, with PNG fallbacks for older browsers via `<picture>` elements
- No runtime image optimization service in v1. The screenshot count is small enough (4–6 images) that manual is fine.
- Revisit if/when content scales (blog posts with embedded images, etc.)

**Decision: Sitemap + robots.txt — static files in `public/`**
- `public/robots.txt` allows all crawlers, points to sitemap
- `public/sitemap.xml` listing the homepage (and future routes when added)
- Generated by hand for v1's single page; switch to a build-time generator when route count grows

**Decision: Environment configuration**
- `apps/web/.env.example` lists all expected env vars
- `apps/web/.env.local` (gitignored) for dev-only overrides
- `VITE_*` prefix for any var that needs to ship to the browser (very few)
- Production build env vars set in GitHub Actions secrets, not a `.env.production` file

---

### Decision Impact Analysis

**Implementation Sequence (suggested order):**

1. **Project init** — `pnpm dlx create-tsrouter-app@latest apps/web ...` and wire into the monorepo
2. **Shared package wiring** — ensure `@nixus/ui` (or whatever the shared package is named) is consumed correctly
3. **Layout chrome** — `__root.tsx`, `<SiteHeader />`, `<SiteFooter />`
4. **GitHub Releases build-time fetcher** — `features/download/release.ts` + generated metadata file
5. **Download CTA** — `<DownloadCTA />` with OS detection
6. **Hero** — composes Download CTA + headline
7. **AI Demo** — CSS animation with reduced-motion fallback
8. **Feature grid + FAQ + footer** — content-driven sections
9. **Install instructions reveal** — post-click state
10. **CI/CD pipeline** — GitHub Actions, Lighthouse CI gate, S3 deploy, CloudFront invalidation
11. **DNS + custom domain hookup** — Cloudflare → CloudFront
12. **Analytics + meta + sitemap polish** — final pre-launch checklist

**Cross-Component Dependencies:**

- `<DownloadCTA />` depends on `useOSDetection` AND the build-time release metadata. Order: ship release fetcher → ship hook → ship component.
- `<Hero />`, `<SiteHeader />`, and `<InstallInstructions />` all consume `<DownloadCTA />` — keeps the conversion event consistent across surfaces.
- The CI/CD pipeline depends on the build-time fetcher succeeding; CI must use a `GITHUB_TOKEN` to authenticate the Releases API call (60/hour anonymous → 1000/hour authenticated rate limit).
- Cloudflare DNS choice depends on having the CloudFront distribution domain ready; provision hosting first, DNS second.
- `<AIDemo />`'s reduced-motion fallback affects the animation tech decision (CSS chosen partly because it natively supports `@media (prefers-reduced-motion)`).

## Implementation Patterns & Consistency Rules

The marketing site lives in a monorepo with an established desktop app and platform architecture. Most patterns are **inherited** from those — this section reaffirms the inherited ones (so AI agents don't drift) and adds web-specific rules where they apply.

### Pattern Categories Defined

**Sources of pattern authority (in order):**
1. Platform `architecture.md` — overrides everything
2. `architecture-desktop.md` — for cross-app consistency
3. This document — web-specific only
4. shadcn/ui defaults — for component-level conventions

**Critical conflict points identified:** ~12 areas where AI agents could make different choices. Each is addressed below.

---

### Naming Patterns

**Code naming (TypeScript/React):**
- **Components:** PascalCase, one component per file. `Hero.tsx`, `DownloadCTA.tsx`. Filename matches the default export.
- **Hooks:** camelCase prefixed with `use`. `useOSDetection`, `useDownloadAction`.
- **Utilities / lib functions:** camelCase. `parseUserAgent`, `formatVersion`.
- **Types and interfaces:** PascalCase. `ReleaseMetadata`, `OSDetectionResult`.
- **Constants:** SCREAMING_SNAKE_CASE for module-level immutable values. `DEFAULT_PINNED_VERSION`.
- **CSS classes (custom):** Tailwind utility-first preferred. When custom classes are necessary (rare), use kebab-case BEM-lite: `ai-demo`, `ai-demo__row`. Avoid CSS Modules in v1 — Tailwind covers everything.

**File naming:**
- React components: `PascalCase.tsx` (e.g., `Hero.tsx`)
- Hooks: `useCamelCase.ts` (e.g., `useOSDetection.ts`)
- Utilities: `camelCase.ts` (e.g., `analytics.ts`)
- Generated files: `*.gen.ts` suffix and gitignored (e.g., `release.gen.ts`)
- Tests: co-located `*.test.ts` (Vitest) and `*.spec.ts` (Playwright E2E)
- Type-only files: `*.types.ts` (e.g., `release.types.ts`)

**Route naming (TanStack Router):**
- File-or-code based; this project uses **code-based** routes
- Routes are kebab-case in URL: `/install-instructions`, not `/installInstructions`
- v1 routes: `/`, `/404`. v2 routes: `/pricing`, `/account`, `/account/billing`, `/login`, `/signup`.

**JSON contract (when v2 ships):**
- **snake_case** for all API JSON keys (inherited from platform — both desktop and API use snake_case)
- TypeScript types use camelCase internally; convert at the API boundary using a generated mapper (e.g., `case-anything` lib or hand-written)
- This rule does NOT apply to v1 since v1 has no API calls

**Environment variables:**
- Build-time: `SCREAMING_SNAKE_CASE` (e.g., `GITHUB_TOKEN`)
- Browser-shipped: `VITE_SCREAMING_SNAKE_CASE` (e.g., `VITE_PINNED_RELEASE_TAG`, `VITE_ANALYTICS_DOMAIN`)

---

### Structure Patterns

**Project organization (per step 4):**
```
apps/web/
├── app/
│   ├── routes/
│   └── app.config.ts
├── components/      # Marketing-only compositions
├── features/        # Feature-grouped logic (download, etc.)
├── lib/             # Shared utilities (analytics, meta)
├── public/          # Static assets
├── tests/           # E2E tests (Playwright); unit tests co-located
└── package.json
```

**Co-location rule:**
- Component-specific styles, types, and unit tests live next to the component
- Cross-component utilities go in `lib/`
- Multi-file features (e.g., `download` with hook + component + Node-side fetcher) live in `features/<feature-name>/`

**Test location:**
- **Unit tests:** co-located. `Hero.tsx` and `Hero.test.tsx` sit in the same folder
- **E2E tests:** `apps/web/tests/e2e/*.spec.ts` (Playwright)
- **Visual / Lighthouse CI:** runs against the built output in CI; configured via `lighthouse.config.js` at the package root

**Shared package consumption:**
- Shared primitives (`Button`, `Card`, etc.) consumed via `import { Button } from '@nixus/ui'` (or whatever the shared package is named — match what the desktop app uses)
- **NEVER** copy a shadcn primitive into `apps/web/components/`. If it's a primitive, it lives in the shared package. If it's a marketing-specific composition, it lives in `apps/web/components/`.
- **NEVER** wrap a shared primitive in a marketing-only abstraction (no `MyButton.tsx` that just re-exports `Button`)

---

### Format Patterns

**TypeScript imports:**
- Absolute imports via path alias: `@/components/Hero`, `@/lib/analytics`. The `@` alias maps to `apps/web/`.
- Imports from shared package: `@nixus/ui` (matching desktop app convention)
- No deep relative imports (`../../../`). Either use the alias or restructure.

**Component prop types:**
- Inline `Props` type defined above the component:
  ```tsx
  type HeroProps = {
    headline: string
    subhead: string
  }
  export function Hero({ headline, subhead }: HeroProps) { ... }
  ```
- No `interface` for component props; use `type`. (Style choice; consistent with desktop app.)
- `Props` types are NOT exported unless another component needs to consume them.

**Default exports vs named exports:**
- **Components:** named exports (`export function Hero`). Easier to refactor, easier to grep, no naming-mismatch bugs.
- **Routes (TanStack Router):** named export `Route`, since TanStack Router uses that contract.
- Hooks, utilities, types: named exports.
- No default exports anywhere unless required by a third-party tool.

**JSX style:**
- Self-closing tags for elements without children: `<img />`, `<DownloadCTA />`
- Multi-line JSX always parenthesized:
  ```tsx
  return (
    <div>
      ...
    </div>
  )
  ```
- Conditional rendering: `&&` for simple cases, ternary for binary alternatives, extracted variable for complex cases. Avoid nested ternaries.

**Date / time:**
- v1 has no user-facing dates beyond release version + build date
- Build date: ISO 8601 string (`2026-04-25`) baked into footer at build time
- Release dates from GitHub: ISO 8601, formatted client-side via `Intl.DateTimeFormat` if displayed (not displayed in v1)

---

### Communication Patterns

**Component composition:**
- Components receive data via props. Don't reach into context unless context is the right tool (e.g., theme, future auth).
- v1 has no global state. All state is local to a component or lifted to the smallest common ancestor.

**Event handling:**
- Native HTML event handlers for DOM events (`onClick`, `onSubmit`, etc.)
- Custom callback props use `on<Event>` naming: `onDownload`, `onOSDetected`
- Analytics events go through the `lib/analytics.ts` wrapper, never directly via the analytics SDK

**Analytics event naming:**
- Domain-event style: `download.clicked`, `faq.expanded`, `os.detected`
- Snake-separated within the domain: `download.linux_message_shown`
- Properties on events use snake_case to match the JSON contract: `{ os: "macOS", version: "0.2.1" }`
- Only **one event** in v1: `download.clicked`. The naming convention exists so v2 events extend it without conflict.

**Logging (build-time only in v1):**
- `console.log` for build-time scripts (the GitHub Releases fetcher logs progress)
- No client-side logging in v1 (no errors to log, no diagnostic surface)
- When v2 adds error monitoring, it uses Sentry (or equivalent) — not `console.*` for production diagnostics

---

### Process Patterns

**Error handling:**
- **Build-time errors:** the build fails fast and loud. The GitHub Releases fetcher throws on unexpected response shapes. CI deploy is blocked. Better to catch errors at build than ship a broken Download CTA.
- **Runtime errors (rare in v1):** uncaught JS exceptions are not user-recoverable. v1 has no error boundary because there's no per-component error state to isolate. Ship without one.
- **404:** standard TanStack Router 404 route at `app/routes/404.tsx`. Static page.
- **GitHub Releases unreachable at build:** error caught in the fetcher, logged, and the build either uses the pinned version (if `VITE_PINNED_RELEASE_TAG` is set) OR fails the build (if no fallback configured).

**Loading states:**
- **First paint:** no loading spinner. The page is statically rendered; nothing to "load."
- **AI demo:** lazy-loaded via intersection observer; renders a static skeleton (matching aspect ratio) while waiting. Skeleton uses the `--muted` token.
- **Image lazy loading:** `loading="lazy"` attribute on all below-fold images. No JavaScript-driven loading.
- **Post-click reveal:** state shifts immediately on click; no spinner needed (browser shows the download progress natively).

**OS detection pattern:**
- Single source of truth: `useOSDetection()` hook in `features/download/`
- Returns `{ os: 'macOS' | 'windows' | 'linux' | 'mobile' | 'unknown', isLoading: boolean }`
- During SSR/prerender: `isLoading: true`, `os: 'unknown'`. The DownloadCTA renders with the "Choose your platform" variant during prerender.
- After hydration: `useEffect` runs UA detection, updates state, component re-renders with the detected variant.
- This pattern means the prerendered HTML has a "Choose your platform" CTA, then upgrades client-side. Slight content shift, but no flicker because the layout doesn't change shape.

**Reduced-motion handling:**
- All animation respects `prefers-reduced-motion: reduce` via CSS `@media` query
- The AI demo component checks the preference on mount and disables animation if reduced motion is preferred
- No JavaScript polling; the CSS query handles reduced-motion at the styling layer; JS check is just for state to keep the static composition rendered

**Accessibility patterns:**
- Inherit shadcn/ui's accessibility defaults — never strip Radix focus rings or ARIA attributes for visual reasons
- Every interactive element is a real `<a>` or `<button>` (never `<div onclick>`)
- Heading hierarchy: one `<h1>` per page, sequential nesting

---

### Enforcement Guidelines

**All AI agents MUST:**

1. **Consume primitives from `@nixus/ui`**, never reimplement Button/Card/Accordion/etc. in `apps/web/`
2. **Use Tailwind tokens** from the shared config, never hardcoded color/spacing values
3. **Use the `useOSDetection` hook** for any OS-aware UI; never add a second UA-parsing implementation
4. **Use the `lib/analytics.ts` wrapper** for analytics events; never call the analytics SDK directly
5. **Honor `prefers-reduced-motion`** for any animation — no exceptions
6. **Use real `<a>` elements** (not JS-only navigation) for the Download CTA so right-click works
7. **Snake_case JSON** for any future API call (matches platform contract)
8. **PascalCase component files**, named exports, co-located tests
9. **Build-time fetch** GitHub Releases data; never call the GitHub API from the visitor's browser
10. **No new dependencies** without justifying the bundle weight cost — the performance budget is real

**Pattern enforcement:**
- ESLint + TypeScript catch most naming and import violations
- Lighthouse CI catches performance regressions
- axe-core in CI catches accessibility regressions
- Playwright E2E catches behavioral regressions (Download click works, OS detection works, etc.)
- Code review catches the rest — pattern violations get a "see architecture-web.md" comment, not a debate

**Process for updating patterns:**
- This document is the source of truth. Pattern changes require an edit + commit.
- Big changes (e.g., switching framework, changing JSON case) require an architecture amendment doc.
- Small clarifications can be in-place edits with a one-line changelog at the top.

---

### Pattern Examples

**Good examples:**

```tsx
// ✅ Component file: components/Hero.tsx
import { Button } from '@nixus/ui'
import { DownloadCTA } from '@/features/download/DownloadCTA'

type HeroProps = {
  headline: string
  subhead: string
}

export function Hero({ headline, subhead }: HeroProps) {
  return (
    <section className="bg-hero py-32 text-center">
      <h1 className="text-display-xl font-bold tracking-tight">{headline}</h1>
      <p className="mt-6 text-lg text-muted-foreground">{subhead}</p>
      <div className="mt-10">
        <DownloadCTA size="lg" showVersion />
      </div>
    </section>
  )
}
```

```ts
// ✅ Hook file: features/download/useOSDetection.ts
import { useEffect, useState } from 'react'

type OS = 'macOS' | 'windows' | 'linux' | 'mobile' | 'unknown'

export function useOSDetection(): { os: OS; isLoading: boolean } {
  const [os, setOS] = useState<OS>('unknown')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setOS(parseUserAgent(navigator.userAgent))
    setIsLoading(false)
  }, [])

  return { os, isLoading }
}
```

```ts
// ✅ Analytics wrapper: lib/analytics.ts
type AnalyticsEvent =
  | { name: 'download.clicked'; properties: { os: string; version: string } }

export function trackEvent(event: AnalyticsEvent) {
  // Cloudflare Web Analytics or future provider
  if (typeof window === 'undefined') return
  window.cfBeacon?.track?.(event.name, event.properties)
}
```

**Anti-patterns:**

```tsx
// ❌ DO NOT: hardcode design tokens
<div style={{ color: '#0d9488', padding: '24px' }}>
// ✅ DO: use Tailwind tokens
<div className="text-primary p-6">

// ❌ DO NOT: re-implement a shared primitive
function MyButton(props) { return <button className="..." {...props} /> }
// ✅ DO: import from shared package
import { Button } from '@nixus/ui'

// ❌ DO NOT: parse user agent inline in a component
const isMac = /Mac/.test(navigator.userAgent)
// ✅ DO: use the shared hook
const { os } = useOSDetection()

// ❌ DO NOT: call the analytics SDK directly
window.cfBeacon.track('Download Clicked')
// ✅ DO: use the wrapper
trackEvent({ name: 'download.clicked', properties: { os, version } })

// ❌ DO NOT: fetch GitHub releases from the browser
useEffect(() => {
  fetch('https://api.github.com/...')
}, [])
// ✅ DO: bake into build via the build-time fetcher
import release from '@/features/download/release.gen'

// ❌ DO NOT: use <div onClick> for a navigable element
<div onClick={() => window.location.href = downloadUrl}>Download</div>
// ✅ DO: use a real <a> so right-click + middle-click work
<a href={downloadUrl} className="...">Download</a>

// ❌ DO NOT: use camelCase JSON keys when v2 ships
fetch('/api/account', { body: JSON.stringify({ userId: '...' }) })
// ✅ DO: snake_case to match platform contract
fetch('/api/account', { body: JSON.stringify({ user_id: '...' }) })

// ❌ DO NOT: skip prefers-reduced-motion handling
<div className="animate-spin">  // always animates, no fallback
// ✅ DO: media-query gate
<div className="animate-spin motion-reduce:animate-none">
```

## Project Structure & Boundaries

### Monorepo Context

Current state of the monorepo (verified 2026-04-25):

```
nkbaz-finance/                  # repo root
├── apps/
│   └── desktop/                # Tauri + React + Rust desktop app (existing)
├── packages/
│   └── shared/                 # @nkbaz/shared — currently TS types only
├── pnpm-workspace.yaml         # globs apps/* and packages/*
├── package.json                # root workspace config
└── pnpm-lock.yaml
```

**This document adds `apps/web/` and may extend `packages/shared/` (or add a new `packages/ui`).**

### Shared Package Strategy

The marketing site needs to share visual primitives (Button, Card, Accordion, etc.) and design tokens with the desktop app. Today the desktop app keeps components private. Two options:

| Option | Pros | Cons |
|--------|------|------|
| **A. Extend `@nkbaz/shared`** *(recommended)* | One shared package, simpler to discover, lower monorepo entropy | `shared` becomes mixed-concern (types + UI); can be split later if it gets unwieldy |
| **B. Add a separate `packages/ui`** | Clear concern separation | Two packages to maintain, naming bikeshedding (`@nkbaz/ui`?), more workspace config |

**Recommendation: Option A — extend `@nkbaz/shared`.**

Move the desktop app's existing shadcn primitives into `packages/shared/src/ui/` and re-export them so both apps consume `import { Button } from '@nkbaz/shared'`. This is a small refactor of the desktop app, but it pays off the moment the marketing site needs the same primitives. Tailwind config (design tokens) lives in `packages/shared/tailwind.config.ts` and is consumed by both `apps/desktop/` and `apps/web/`.

If `@nkbaz/shared` later gets too big, split into `@nkbaz/types`, `@nkbaz/ui`, `@nkbaz/tokens` as a follow-up. Don't pre-split.

> **Note on naming:** Throughout this document, references to `@nixus/ui` in earlier sections should be read as `@nkbaz/shared`. The package name comes from the existing repo, not the product brand. Future renaming (if `@nixus/*` is preferred for branding) is a one-line rename in `package.json` consumers — not a structural change.

### Complete Project Directory Structure (apps/web/)

```
apps/web/
├── README.md                   # Quickstart, dev/build/deploy notes
├── package.json                # @nkbaz/web — workspace package
├── tsconfig.json               # Extends shared base
├── tailwind.config.ts          # Re-exports tokens from @nkbaz/shared, adds marketing extensions
├── postcss.config.js           # Tailwind + autoprefixer
├── vite.config.ts              # Per TanStack Start convention
├── app.config.ts               # TanStack Start config (prerender list, build target)
├── playwright.config.ts        # E2E test config
├── lighthouserc.json           # Lighthouse CI config
├── .env.example                # Documents expected env vars
├── .env.local                  # Dev-only overrides (gitignored)
├── .eslintrc.cjs               # Extends shared config
├── .gitignore                  # ignores release.gen.ts, dist/, .env.local
│
├── app/
│   ├── routes/
│   │   ├── __root.tsx          # Layout: <SiteHeader /> + <Outlet /> + <SiteFooter />
│   │   ├── index.tsx           # The single v1 marketing page composition
│   │   └── 404.tsx             # 404 fallback
│   ├── router.tsx              # TanStack Router setup
│   └── client.tsx              # Hydration entry point
│
├── components/                 # Marketing-only compositions (UX spec §11)
│   ├── Hero.tsx
│   ├── Hero.test.tsx
│   ├── AIDemo.tsx
│   ├── AIDemo.test.tsx
│   ├── AIDemo.css              # Custom keyframes (prefers-reduced-motion gated)
│   ├── FeatureGrid.tsx
│   ├── FeatureGrid.test.tsx
│   ├── ScreenshotShowcase.tsx
│   ├── FAQ.tsx
│   ├── FAQ.test.tsx
│   ├── BuilderSection.tsx
│   ├── SiteHeader.tsx
│   ├── SiteFooter.tsx
│   └── InstallInstructions.tsx
│
├── features/
│   └── download/               # Co-located feature
│       ├── DownloadCTA.tsx     # OS-aware Download button
│       ├── DownloadCTA.test.tsx
│       ├── useOSDetection.ts   # UA-parsing hook
│       ├── useOSDetection.test.ts
│       ├── parseUserAgent.ts   # Pure function for UA → OS
│       ├── parseUserAgent.test.ts
│       ├── release.ts          # Build-time GitHub Releases fetcher (Node)
│       ├── release.types.ts    # ReleaseMetadata type
│       └── release.gen.ts      # Generated at build (gitignored)
│
├── lib/
│   ├── analytics.ts            # Wraps Cloudflare Web Analytics SDK
│   ├── analytics.test.ts
│   ├── meta.ts                 # SEO meta-tag helper
│   └── meta.test.ts
│
├── content/                    # Marketing copy + FAQ entries (edit-friendly)
│   ├── faq.ts                  # FAQ Q/A as a typed array
│   ├── features.ts             # Feature card data
│   └── builder.ts              # Builder section copy
│
├── public/
│   ├── favicon.svg
│   ├── favicon.ico             # Fallback for older browsers
│   ├── apple-touch-icon.png
│   ├── og-image.png            # 1200×630 social card
│   ├── robots.txt              # Allow all + sitemap reference
│   ├── sitemap.xml             # Hand-maintained for v1
│   ├── screenshots/            # Pre-processed product screenshots
│   │   ├── dashboard.webp
│   │   ├── dashboard@2x.webp
│   │   ├── dashboard.png       # Fallback
│   │   ├── ai-import.webp
│   │   └── ...
│   └── _redirects              # CloudFront/Netlify-style redirects (if needed)
│
├── tests/
│   └── e2e/
│       ├── conversion.spec.ts  # E2E: hero → demo → download click
│       ├── os-detection.spec.ts
│       ├── mobile.spec.ts      # Mobile path
│       ├── faq.spec.ts
│       └── a11y.spec.ts        # axe-core sweep
│
├── scripts/
│   └── fetch-release.ts        # Dev helper to manually refresh release.gen.ts
│
└── dist/                       # Build output (gitignored)
    ├── _build/                 # JS chunks
    ├── index.html              # Prerendered home
    ├── 404.html                # Prerendered 404
    ├── og-image.png            # Copied from public/
    ├── screenshots/
    └── sitemap.xml
```

### Architectural Boundaries

**API Boundaries (v1 has none externally):**

- **Build-time:** the `features/download/release.ts` script runs in Node during build, calls `https://api.github.com/repos/{owner}/{repo}/releases`, and writes `release.gen.ts`. This is the only external API call in the entire v1 web app.
- **Runtime:** zero API calls from the visitor's browser. The Download CTA navigates directly to a GitHub Releases asset URL (which is a static asset, not an API call).
- **v2 boundary:** the platform API at `api.nixus.nicolasbazinet.net` (or whatever it's named) becomes the runtime API surface. Boundary will be a single TanStack Query client configured in `app/router.tsx`.

**Component Boundaries:**

- **Shared primitives:** consumed via `import ... from '@nkbaz/shared'`. Owned by the shared package; web app does not modify them.
- **Marketing compositions:** live in `apps/web/components/`, consume shared primitives, are not consumed elsewhere.
- **Features:** live in `apps/web/features/<feature>/`, encapsulate multi-file logic (component + hook + data). Features can consume primitives and other features but should avoid importing each other unless explicitly designed to.
- **Lib:** generic utilities. No React-specific code in `lib/` (analytics wrapper is a borderline case; if it grows React hooks, move them to `features/analytics/`).
- **Content:** typed data files separated from components so copy edits don't require touching JSX.

**Service Boundaries:**

- **Build pipeline:** Vite builds the static output. TanStack Start orchestrates prerendering. The `release.ts` fetcher runs as a Vite plugin or via a pre-build npm script — TBD by the implementor.
- **Deployment pipeline:** GitHub Actions runs the build, uploads `dist/` to S3, invalidates CloudFront. No services running between deploys.
- **Analytics:** Cloudflare Web Analytics — script tag injected via the `__root.tsx` layout. Events fired through `lib/analytics.ts`. No backend.

**Data Boundaries:**

- **Static data (build-time):** `release.gen.ts`, `content/faq.ts`, `content/features.ts`. Bundled into the static HTML.
- **Client-derived data:** UA-detected OS (computed at hydration; cached in component state for the session).
- **No persistent data in v1.** No localStorage, no IndexedDB, no cookies set by us.
- **v2 boundary:** authenticated user data fetched via TanStack Query against the platform API; cached in TanStack Query's in-memory cache.

### Requirements to Structure Mapping

**Mapping FRs from step 2 to specific directories/files:**

| FR | Lives in | Notes |
|----|----------|-------|
| FR-W1 (Single landing page) | `app/routes/index.tsx` + `components/*` | Composition file is `index.tsx`; components stand alone |
| FR-W2 (OS detection) | `features/download/useOSDetection.ts` + `parseUserAgent.ts` | Pure UA parser is unit-testable; hook wraps with React state |
| FR-W3 (GitHub Releases serving) | `features/download/release.ts` + `release.gen.ts` | Build-time fetcher; generated file is the data source |
| FR-W4 (AI demo animation) | `components/AIDemo.tsx` + `AIDemo.css` | CSS keyframes, reduced-motion gated |
| FR-W5 (Right-clickable Download) | `features/download/DownloadCTA.tsx` | Uses real `<a href>` element |
| FR-W6 (Same-page reveal) | `app/routes/index.tsx` (state) + `components/InstallInstructions.tsx` | State lives at the page level; component is presentational |
| FR-W7 (Per-OS install instructions) | `components/InstallInstructions.tsx` | Uses shared shadcn `Tabs` from `@nkbaz/shared` |
| FR-W8 (Mobile message + send-to-computer) | `features/download/DownloadCTA.tsx` (variant) | Variant logic inside the same component |
| FR-W9 (FAQ) | `components/FAQ.tsx` + `content/faq.ts` | Component is data-driven; copy in content file |
| FR-W10 (Analytics on Download click) | `lib/analytics.ts` + `DownloadCTA.tsx` (caller) | Wrapper hides the SDK; caller fires the event |
| FR-W11 (SEO basics) | `lib/meta.ts` + `app/routes/__root.tsx` + `public/{robots,sitemap,og-image}` | Meta helper + root layout + static files |

**Cross-cutting concerns mapping:**

| Concern | Location |
|---------|----------|
| Design tokens | `packages/shared/tailwind.config.ts` (consumed via `apps/web/tailwind.config.ts`) |
| Shared primitives | `packages/shared/src/ui/*` (re-exported from `@nkbaz/shared`) |
| ESLint config | `packages/shared/eslint.config.js` (extended by `apps/web/.eslintrc.cjs`) |
| TS config base | `packages/shared/tsconfig.base.json` (extended by `apps/web/tsconfig.json`) |
| Build secrets | GitHub Actions secrets (`GITHUB_TOKEN`, `AWS_*`, `CF_API_TOKEN`) |
| Reduced-motion | `components/AIDemo.css` (`@media (prefers-reduced-motion: reduce)`) |
| Accessibility tests | `tests/e2e/a11y.spec.ts` (axe-core via Playwright) |

### Integration Points

**Internal communication (within `apps/web/`):**

- **Page → DownloadCTA:** props (`size`, `showVersion`, `showAltOS`)
- **DownloadCTA → useOSDetection:** hook return values
- **DownloadCTA → release.gen:** import (build-time data)
- **DownloadCTA → analytics:** function call (`trackEvent`)
- **InstallInstructions ← Page (state):** parent renders when post-click state is set
- **AIDemo:** self-contained; no inputs from elsewhere

**External integrations:**

| Integration | When | Where | Failure mode |
|-------------|------|-------|---------------|
| **GitHub Releases API** | Build-time only | `features/download/release.ts` | Build fails OR uses pinned version |
| **Cloudflare Web Analytics** | Runtime | `lib/analytics.ts` + script tag in `__root.tsx` | Silently degrades; site keeps working |
| **AWS S3** | Deploy-time | GitHub Actions | Deploy fails; site unchanged |
| **CloudFront** | Deploy-time + runtime | GitHub Actions (invalidation) + DNS pointing | Stale cached version served until TTL |

**Data flow:**

```
1. Build time:
   GitHub Releases API
        ↓ (release.ts)
   release.gen.ts (in apps/web/features/download/)
        ↓ (import)
   DownloadCTA.tsx (uses release URL + version)
        ↓ (Vite + TanStack Start prerender)
   dist/index.html (static, with download URL inlined)

2. Visitor request:
   Browser → CloudFront → dist/index.html → React hydrates
        ↓
   useOSDetection runs (client-side UA parse)
        ↓
   DownloadCTA re-renders with OS-correct label
        ↓
   Visitor clicks → browser navigates to GitHub Releases asset URL
        ↓
   GitHub serves binary; browser downloads
        ↓
   Page state shifts to show InstallInstructions
        ↓
   trackEvent('download.clicked', ...) fires to Cloudflare Analytics
```

### File Organization Patterns

**Configuration files:**
- All TS configs extend a shared base in `packages/shared/`
- ESLint config is shared
- Tailwind config is per-app but imports tokens from shared
- Vite config and TanStack Start config live in `apps/web/` (not shared)
- Env files live in `apps/web/` (`.env.example` checked in, `.env.local` ignored)

**Source organization:**
- Routes own page composition (one route file = one page)
- Components are presentational (props in, JSX out)
- Features are domain-grouped (`features/download/` owns everything OS/release/install-related)
- Lib holds general utilities; if a util becomes feature-specific, move it into the feature
- Content files are typed data (no JSX)

**Test organization:**
- Unit tests co-located (`Hero.tsx` + `Hero.test.tsx`)
- E2E tests centralized in `apps/web/tests/e2e/`
- Visual + Lighthouse runs in CI; not committed test files
- Test utilities (if needed) in `apps/web/tests/utils/`

**Asset organization:**
- `public/` is for files served directly at the URL root (favicon, robots.txt, sitemap, og-image)
- Screenshots in `public/screenshots/` with WebP + PNG fallback per file
- AI demo doesn't ship a binary asset (CSS-driven); animation CSS lives next to the component

### Development Workflow Integration

**Development server:**
- `pnpm --filter @nkbaz/web dev` from repo root
- Or `cd apps/web && pnpm dev`
- HMR via Vite; TanStack Start dev mode
- `release.gen.ts` regenerated when `pnpm fetch-release` runs (or stub data committed to dev-only `release.dev.ts`)

**Build process:**
1. `pnpm --filter @nkbaz/web build` triggers TanStack Start build
2. Pre-build script fetches GitHub Releases (or uses pinned version), writes `release.gen.ts`
3. TanStack Start prerenders configured routes to static HTML
4. Vite bundles JS chunks
5. Output written to `apps/web/dist/`

**Deployment:**
1. GitHub Actions checks out repo
2. `pnpm install --frozen-lockfile` from root
3. `pnpm --filter @nkbaz/web build` produces `dist/`
4. `aws s3 sync apps/web/dist s3://<bucket>/` uploads
5. `aws cloudfront create-invalidation` invalidates `/*`
6. Done — visitor traffic served by CloudFront

**Triggers:**
- `on: push to main` (touching `apps/web/`, `packages/shared/`, or root config) → deploy web
- `on: repository_dispatch` from desktop release pipeline → deploy web (to bake the new release)
- `on: pull_request` → run tests + Lighthouse CI; no deploy

**Local preview of production build:**
- `pnpm --filter @nkbaz/web preview` serves `dist/` locally for sanity checking before push

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All decisions stack cleanly without internal conflicts:
- TanStack Start (step 3) provides static prerendering → satisfies "no Node.js servers" platform constraint and S3+CloudFront hosting choice
- TanStack Router is shared with the desktop app → no routing-paradigm split across modules
- shadcn/ui in `@nkbaz/shared` → both apps consume the same primitives, ensuring visual continuity (UX spec requirement)
- Build-time GitHub Releases fetch → no runtime API dependency, supports zero-traffic free-tier hosting
- CSS-only AI demo → meets bundle budget AND `prefers-reduced-motion` requirement natively

**No version conflicts identified.** TanStack Start v1 is compatible with React 18+, TanStack Router (latest), TanStack Query (latest), shadcn/ui (latest), Tailwind v3 or v4 (architect picks at impl time).

**Pattern Consistency:**
- Naming patterns (PascalCase components, camelCase hooks, snake_case JSON) align with desktop app conventions
- Structure patterns (feature-based directories, co-located tests) mirror desktop app
- shadcn/ui consumption rule (no forks, no wrappers) is enforceable via lint/review
- Reduced-motion gate is structural (CSS media query), not just convention

**Structure Alignment:**
- Project tree supports v1 routes (`/`, `/404`) AND v2 expansion routes (`/pricing`, `/account`, etc.) without restructuring
- `features/download/` co-locates the most architecturally complex piece of v1
- Shared package strategy (extend `@nkbaz/shared`) avoids monorepo bloat in v1
- Build pipeline (build-time fetch → prerender → static output) is linear and debuggable

### Requirements Coverage Validation ✅

**Functional Requirements Coverage (from step 2):**

| FR | Architectural support | Verified |
|----|----------------------|----------|
| FR-W1 (Single landing page) | Route `/` + composition in `index.tsx` | ✅ |
| FR-W2 (OS detection) | `useOSDetection` hook + `parseUserAgent` utility | ✅ |
| FR-W3 (GitHub Releases serving) | Build-time fetcher writes `release.gen.ts` | ✅ |
| FR-W4 (AI demo + reduced-motion) | `AIDemo.tsx` + `AIDemo.css` with media query | ✅ |
| FR-W5 (Right-clickable Download) | Real `<a href>` element, no JS-only nav | ✅ |
| FR-W6 (Same-page reveal) | Page-level state + `InstallInstructions` component | ✅ |
| FR-W7 (Per-OS install instructions) | shadcn `Tabs` component with macOS/Windows panes | ✅ |
| FR-W8 (Mobile message) | Variant logic in `DownloadCTA.tsx` | ✅ |
| FR-W9 (FAQ accordion) | shadcn `Accordion` (single-open) + `content/faq.ts` | ✅ |
| FR-W10 (Analytics on click) | `lib/analytics.ts` wrapper + Cloudflare Web Analytics | ✅ |
| FR-W11 (SEO basics) | `lib/meta.ts` + `__root.tsx` head + `public/{robots,sitemap,og-image}` | ✅ |

**v2 capabilities (deferred but seam-aware):**

| FR | Seam preserved | Verified |
|----|---------------|----------|
| FR-WV2-1 (Auth) | TanStack Router supports route loaders + `<RequireAuth>` wrapping post-v1 | ✅ |
| FR-WV2-2 (Pricing page) | Adding `/pricing` route is one new file in `app/routes/` | ✅ |
| FR-WV2-3 (Stripe checkout) | `createServerFn` available in TanStack Start when needed | ✅ |
| FR-WV2-4 (`/account`) | Same — new route, gated by future auth wrapper | ✅ |
| FR-WV2-5 (`/changelog`, `/blog`) | Routing scales; content can be MDX or static data files | ✅ |

**Non-Functional Requirements Coverage:**

| NFR | Architectural support | Verified |
|-----|----------------------|----------|
| NFR-W1 (~$0/month) | Static deploy on S3+CloudFront free tier; Cloudflare DNS free; Cloudflare Analytics free | ✅ |
| NFR-W2 (First paint < 1s, Lighthouse Perf ≥ 90) | Static prerender; CSS-only animation; lazy-loaded images; bundle budget ≤ 200KB JS gz | ✅ |
| NFR-W3 (Lighthouse a11y/SEO/best-practices ≥ 90) | Lighthouse CI gating in pipeline | ✅ |
| NFR-W4 (WCAG 2.1 AA) | shadcn/Radix defaults + axe-core CI + manual screen reader testing | ✅ |
| NFR-W5 (No cookie banner) | Cloudflare Web Analytics is cookieless | ✅ |
| NFR-W6 (Modern browsers) | TanStack Start + Vite default targets last 2 versions; no legacy polyfills | ✅ |
| NFR-W7 (JS-disabled CTA works) | Real `<a href>` to GitHub asset URL; works without JS | ✅ |
| NFR-W8 (OS detection seamless) | Prerender renders "Choose your platform"; client upgrade post-hydration | ✅ |
| NFR-W9 (Survives GitHub Releases outage) | Build-time fetch + pinned-version fallback | ✅ |
| NFR-W10 (Visual continuity with desktop) | Shared `@nkbaz/shared` Tailwind config + primitives | ✅ |
| NFR-W11 (Solo-builder velocity) | One framework, official ecosystem, minimal infra, no servers | ✅ |

### Implementation Readiness Validation ✅

**Decision Completeness:** Framework, hosting, DNS, analytics, error monitoring, OG image, image pipeline, sitemap/robots, AI demo rendering, GitHub Releases data flow, routing topology, auth strategy — all decided.

**Structure Completeness:** Full directory tree specified; each FR mapped to a specific file/directory; test placement convention defined; build/deploy/preview workflows defined.

**Pattern Completeness:** Naming, structure, format, communication, and process patterns all specified with concrete good/bad examples. Enforcement via ESLint, Lighthouse CI, axe-core CI, Playwright E2E, code review.

### Gap Analysis Results

**Critical gaps:** *(none — all v1 implementation is unblocked)*

**Important gaps (worth addressing before implementation but not blocking):**

1. **Domain name not chosen.** Decision needed before DNS setup but doesn't affect code.
2. **Logo / wordmark assets don't exist yet.** Need a design pass.
3. **Hero copy is placeholder.** "Your spreadsheet's replacement, finally." can be iterated on.
4. **Real desktop app screenshots needed.** Capture from actual desktop app at high DPI.
5. **Builder section copy needed.** First-person voice ≤ 150 words.
6. **Shared package refactor for `@nkbaz/shared/ui`.** Prerequisite first implementation story.

**Nice-to-have gaps (post-v1):** PR preview deploys, Storybook, visual regression tests, per-page OG images, first-party `/changelog`.

### Validation Issues Addressed

1. **Naming inconsistency.** Earlier sections referenced `@nixus/ui`. Repo has `@nkbaz/shared`. Resolved via callout in step 6.
2. **Shared UI package doesn't exist yet.** Resolved by making "extract primitives into `@nkbaz/shared`" the first implementation story.
3. **TanStack Start version recency.** v1.0 shipped March 2026. Resolved by flagging in step 3 that the CLI invocation should be verified at install time.

### Architecture Completeness Checklist

**✅ Requirements Analysis** — context analyzed, scale assessed, constraints identified, cross-cutting concerns mapped
**✅ Architectural Decisions** — critical decisions documented, stack specified, integration patterns defined, performance addressed
**✅ Implementation Patterns** — naming, structure, communication, process patterns documented
**✅ Project Structure** — directory structure complete, boundaries established, integration points mapped, FRs mapped to structure

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** **High** — small, conservative, built on well-established platform decisions. Main uncertainty is TanStack Start's recency (v1.0 March 2026), but the framework's stability has been demonstrated and the alternatives (Astro, Vike) introduce more risk for a solo builder.

**Key Strengths:**
- Aligned with platform `architecture.md` — zero divergence
- Static-first hosting with no runtime servers — true zero-cost-at-zero-traffic
- v2-ready without v1 over-engineering — auth, payments, blog all have clear seams
- Solo-builder velocity preserved — one framework, minimal infra
- All FRs and NFRs traced to specific architectural elements
- Concrete code patterns + anti-patterns reduce AI-agent ambiguity

**Areas for Future Enhancement:**
- Promote popular content surfaces (changelog, blog) to first-party when traffic warrants
- Add image optimization service when content scales
- Add visual regression testing if marketing copy/design iterates frequently
- Split `@nkbaz/shared` if it grows past comfort (likely past 50–100 modules)
- Move analytics behind a more flexible provider (Plausible) if event-tracking granularity becomes valuable

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- When platform decisions in `architecture.md` conflict with this doc, **the platform doc wins**
- When the desktop app's existing patterns conflict with this doc, **prefer this doc's marketing-site adaptations** but raise the discrepancy for review

**First implementation priorities (suggested order):**

1. **Refactor `@nkbaz/shared` to expose UI primitives.** Move the desktop app's shadcn components, Tailwind config, and design tokens into `packages/shared/`. Update desktop app imports. Precondition for the marketing site work.
2. **Initialize `apps/web/` with TanStack Start.** Verify current CLI command at install time. Wire into the pnpm workspace. Confirm the shared package is consumable.
3. **Build the conversion path first.** `<DownloadCTA />` + `useOSDetection` + build-time `release.ts` fetcher. Get end-to-end working with placeholder content before refining the rest.
4. **Layer on the trust spine.** `<Hero />`, `<AIDemo />`, `<FeatureGrid />`, `<FAQ />`, `<BuilderSection />`. Real screenshots and final copy come last.
5. **CI/CD + hosting.** GitHub Actions, S3+CloudFront, Cloudflare DNS, custom domain. Lighthouse CI gating from day one.
6. **Pre-launch sweep.** Reduced-motion fallback verification, screen-reader pass, keyboard-only walk-through, mobile/Linux/Windows visit testing, right-click verification on Download CTA.

**Stories ready for sprint planning:**

1. Shared UI package extraction
2. `apps/web/` initialization + monorepo wiring
3. GitHub Releases build-time fetcher
4. `<DownloadCTA />` with OS detection
5. `<Hero />` composition
6. `<AIDemo />` with reduced-motion fallback
7. Feature grid + content
8. FAQ + content
9. Screenshots showcase + asset capture
10. Builder section + copy
11. `<InstallInstructions />` post-click reveal
12. SEO + meta + sitemap + OG image
13. Analytics integration (Cloudflare Web Analytics)
14. GitHub Actions CI + Lighthouse gating
15. S3 + CloudFront hosting + custom domain + DNS
16. Pre-launch a11y + cross-browser + cross-OS sweep
