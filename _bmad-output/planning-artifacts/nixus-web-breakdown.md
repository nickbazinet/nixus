---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - product-brief-nixus-marketing-site-2026-04-25.md
  - ux-design-specification-nixus-marketing-site-2026-04-25.md
  - architecture-web.md
  - architecture.md
project_name: 'nixus-marketing-site'
location: 'apps/web/'
status: 'complete'
note: 'No standalone PRD exists for the marketing site. Requirements are sourced from architecture-web.md (FR-W*/NFR-W*) and the product brief.'
---

# nixus-marketing-site - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the **Nixus marketing site** (the v1 web app at `apps/web/`), decomposing the requirements from the product brief, UX design spec, and module architecture into implementable stories.

The marketing site is a static-first web app built with TanStack Start v1 hosted on S3+CloudFront, distributing the Nixus desktop binary via GitHub Releases. Per the architecture, v1 has no auth, no payments, and no backend — these are deferred to v2.

## Requirements Inventory

### Functional Requirements

(Sourced from `architecture-web.md` step 2; v1 only — v2 FRs deferred and tracked separately.)

- **FR-W1:** Single long-scroll landing page (hero, AI demo, features, screenshots, builder section, FAQ, footer)
- **FR-W2:** OS detection (macOS / Windows / Linux / mobile) on page load drives Download CTA variant
- **FR-W3:** Download CTA serves the latest GitHub Release asset for the detected OS, with build-time pinned-version fallback
- **FR-W4:** AI parse demo runs as a silent autoplay loop on viewport entry, with `prefers-reduced-motion` static fallback
- **FR-W5:** Right-click on Download CTA exposes a clean binary URL (no tracking redirect)
- **FR-W6:** Same-page "Thanks + install instructions" reveal after Download click
- **FR-W7:** Per-OS install instructions (macOS Gatekeeper, Windows SmartScreen)
- **FR-W8:** Mobile/tablet visitors see a "Visit on a Mac or PC to download" message + send-to-computer affordance (mailto-self, copy link)
- **FR-W9:** FAQ accordion (single-open) with 8 v1 questions
- **FR-W10:** Privacy-friendly analytics on Download CTA clicks (Cloudflare Web Analytics)
- **FR-W11:** SEO basics: meta tags, OG image, sitemap.xml, robots.txt

### NonFunctional Requirements

- **NFR-W1:** ~$0/month at zero traffic (S3+CloudFront free tier; Cloudflare DNS + Analytics free)
- **NFR-W2:** First paint < 1 second; Lighthouse Performance ≥ 90 on mobile and desktop
- **NFR-W3:** Lighthouse a11y / SEO / best-practices ≥ 90 on every CI build (gating)
- **NFR-W4:** WCAG 2.1 AA compliance
- **NFR-W5:** No EU-style cookie banner on first paint
- **NFR-W6:** Modern browsers only — last 2 versions of Chrome, Edge, Firefox, Safari
- **NFR-W7:** Site works with JavaScript disabled (degraded but functional Download CTA)
- **NFR-W8:** OS detection result must render seamlessly post-paint (no jarring flicker)
- **NFR-W9:** Site survives GitHub Releases API outage (build-time fetch + pinned-version fallback)
- **NFR-W10:** Visual continuity with the desktop app (shared `@nkbaz/shared` Tailwind tokens + primitives)
- **NFR-W11:** Ship-fast solo-builder cadence (no operational overhead, no servers, minimal toolchain)

### Additional Requirements

**From Architecture (`architecture-web.md`):**
- **Starter / framework:** Initialize `apps/web/` with **TanStack Start v1** (CLI invocation verified at install time). This is the first implementation activity.
- **Shared package prerequisite:** Extract the desktop app's shadcn primitives + Tailwind tokens into `packages/shared/src/ui/` (or equivalent) before the marketing site can consume them. **This is a precondition story for the marketing site work.**
- **Hosting:** S3 + CloudFront (private bucket, ACM HTTPS, custom domain via Cloudflare DNS)
- **CI/CD:** GitHub Actions — build on push, Lighthouse CI gating, S3 sync, CloudFront invalidation
- **Build-time release fetch:** GitHub Releases API call during build via `GITHUB_TOKEN`-authenticated request; output written to `release.gen.ts` (gitignored)
- **AI demo tech:** CSS keyframe animation on real DOM elements (no Lottie, no video)
- **Analytics:** Cloudflare Web Analytics (cookieless, no banner)
- **Routing:** TanStack Router code-based, single v1 route plus 404
- **Auth seam:** v1 has no auth, but routing/layout structure must allow `<RequireAuth>` to be added in v2 without restructuring

**From UX Design (`ux-design-specification-nixus-marketing-site-2026-04-25.md`):**
- **Visual continuity:** Inherit desktop app's slate + teal palette, Inter typography, JetBrains Mono for figures, 4px Tailwind spacing scale
- **Hero treatment:** Variant B (Raycast-style centered hero with full AI demo in its own section directly below)
- **Reduced motion:** Mandatory `prefers-reduced-motion: reduce` static-fallback for the AI demo
- **Mobile-first behavior:** Site works correctly on mobile/tablet with the pitch fully landing; Download CTA replaced with "Visit on a Mac or PC to download" + send-to-computer affordance
- **Builder voice:** Honest, direct, first-person; no SaaS-template language; specific (real Canadian banks named in copy/demo)
- **No friction surfaces:** No email capture, no signup, no live chat, no cookie modals (beyond legal minimum), no carousels, no popups

### FR Coverage Map

| FR / NFR | Covered by Epic.Story | Notes |
|----------|----------------------|-------|
| (Pre-req) Shared UI extraction | E1.S1 | Refactor desktop app to expose primitives via `packages/shared` |
| FR-W1 (Single landing page) | E1.S2 + E2.* + E3.* | Composition is one route; sections delivered across epics |
| FR-W2 (OS detection) | E2.S2 | Pure UA parser + React hook |
| FR-W3 (GitHub Releases serving) | E2.S1, E2.S3 | Build-time fetcher + Download CTA consuming the data |
| FR-W4 (AI demo + reduced-motion) | E3.S2 | CSS animation with media-query gate |
| FR-W5 (Right-clickable Download) | E2.S3 | Real `<a href>` element |
| FR-W6 (Same-page reveal) | E2.S5 | Page-level state + `<InstallInstructions />` |
| FR-W7 (Install instructions) | E2.S5 | shadcn `Tabs` component, per-OS panes |
| FR-W8 (Mobile message) | E2.S4 | Variant logic in DownloadCTA |
| FR-W9 (FAQ accordion) | E3.S5 | shadcn Accordion + content |
| FR-W10 (Analytics) | E5.S1 | Cloudflare Web Analytics + lib wrapper |
| FR-W11 (SEO basics) | E5.S2 | meta helper, sitemap, robots, OG image |
| NFR-W1 (~$0/month) | E5.S3, E5.S4 | Hosting choices + DNS |
| NFR-W2/W3 (Performance, a11y, SEO ≥ 90) | E5.S5 | Lighthouse CI gate |
| NFR-W4 (WCAG 2.1 AA) | E6.S1 | Pre-launch a11y sweep |
| NFR-W5 (No cookie banner) | E5.S1 | Cloudflare Analytics is cookieless |
| NFR-W6 (Modern browsers) | (Implicit) | Default Vite/TanStack target |
| NFR-W7 (Works without JS) | E2.S3, E6.S1 | Real `<a>` tags + verification |
| NFR-W8 (OS detection seamless) | E2.S2 | Choose-platform default during prerender |
| NFR-W9 (Releases outage survival) | E2.S1 | Build-time fetch + pinned fallback |
| NFR-W10 (Visual continuity) | E1.S1 + all components | Shared package consumption |
| NFR-W11 (Solo-builder cadence) | (Architectural) | One framework, no servers, minimal infra |

## Epic List

### Epic 1: Foundation & Site Skeleton

After this epic, the marketing site is **deployed and reachable** on a custom domain, showing a layout with the header, footer, and a placeholder body. The hosting, DNS, CI/CD, and shared package wiring all work end-to-end. No marketing content yet — just a live, blank canvas.

**FRs covered:** (foundational; enables all downstream FRs)
**NFRs covered:** NFR-W1, NFR-W6, NFR-W10, NFR-W11

### Epic 2: Conversion Path

After this epic, a visitor on **macOS or Windows** can land on the page, see an OS-detected Download CTA, click it, and start downloading the latest Nixus binary from GitHub Releases. Visitors on mobile/Linux/unknown platforms see graceful, honest variants. Post-click, install instructions appear on the same page.

**FRs covered:** FR-W2, FR-W3, FR-W5, FR-W6, FR-W7, FR-W8
**NFRs covered:** NFR-W7, NFR-W8, NFR-W9

### Epic 3: Trust Spine & Pitch

After this epic, the site **tells the Nixus story** convincingly. The hero communicates the pitch in seconds, the AI parse demo lands the magic moment, the feature grid + screenshots + builder section build trust, and the FAQ resolves the predictable objections.

**FRs covered:** FR-W1, FR-W4, FR-W9
**NFRs covered:** NFR-W2, NFR-W4 (reduced-motion)

### Epic 4: Launch Readiness

After this epic, the site is **production-launch-ready**: SEO meta tags, OG image, sitemap, robots.txt, analytics wired up, accessibility verified across screen readers and reduced-motion, cross-browser sanity checked, JS-disabled and right-click paths verified.

**FRs covered:** FR-W10, FR-W11
**NFRs covered:** NFR-W3, NFR-W4 (full sweep), NFR-W5

---

## Epic 1: Foundation & Site Skeleton

**Goal:** Stand up the marketing site as a deployed, reachable canvas — header, footer, hosting, DNS, CI/CD, and shared package wiring all working end-to-end. No marketing content yet; just a live URL serving a placeholder body.

### Story 1.1: Extract Shared UI Primitives and Design Tokens

As a **monorepo maintainer**,
I want **the desktop app's shadcn primitives, Tailwind config, and design tokens moved into `@nkbaz/shared` and re-exported as `@nkbaz/shared/ui`**,
So that **the marketing site can consume the same visual language as the desktop app without duplicating code**.

**Acceptance Criteria:**

**Given** the desktop app currently keeps shadcn primitives in `apps/desktop/src/components/ui/`
**When** the refactor is complete
**Then** all shadcn primitive components live in `packages/shared/src/ui/`
**And** `@nkbaz/shared` exports `Button`, `Card`, `Accordion`, `Badge`, `Sheet`, `Tabs`, `Tooltip`, and any other primitives the desktop app uses
**And** the desktop app imports from `@nkbaz/shared` (or `@nkbaz/shared/ui`) instead of relative paths

**Given** the existing Tailwind config in the desktop app
**When** the refactor is complete
**Then** the canonical Tailwind config (palette, typography, spacing, radius, shadows) lives in `packages/shared/tailwind.config.ts`
**And** the desktop app's Tailwind config extends or imports from this shared config
**And** all design tokens (`--primary`, `--foreground`, `--positive`, `--ring-screenshot`, etc.) defined in `architecture-web.md` step 8 are present in the shared config

**Given** the desktop app currently builds and runs successfully
**When** the refactor is complete
**Then** the desktop app still builds without errors (`pnpm --filter @nkbaz/desktop build`)
**And** the desktop app's UI looks visually identical to before the refactor
**And** existing desktop app tests (unit + E2E) continue to pass

**Given** another app (the future `apps/web/`) wants to consume primitives
**When** it imports `import { Button } from '@nkbaz/shared'` from a sibling workspace package
**Then** the import resolves correctly via pnpm workspace linking
**And** the component renders with the same visual treatment as in the desktop app

---

### Story 1.2: Scaffold apps/web/ with TanStack Start

As a **solo builder**,
I want **a new `apps/web/` package initialized with TanStack Start v1, wired into the pnpm workspace, and consuming the shared package**,
So that **I have a working foundation to build the marketing site on**.

**Acceptance Criteria:**

**Given** the monorepo has `apps/desktop/` and `packages/shared/`
**When** the scaffolding is complete
**Then** `apps/web/` exists as a new pnpm workspace package named `@nkbaz/web`
**And** the package uses TanStack Start v1 (CLI invocation verified at install time per architecture step 3)
**And** the package consumes `@nkbaz/shared` as a workspace dependency (`"@nkbaz/shared": "workspace:*"`)

**Given** the project structure defined in `architecture-web.md` step 6
**When** the scaffolding is complete
**Then** the directory tree matches the documented structure: `app/routes/`, `components/`, `features/`, `lib/`, `content/`, `public/`, `tests/e2e/`, `scripts/`
**And** `app.config.ts`, `vite.config.ts`, `tailwind.config.ts`, `playwright.config.ts`, `lighthouserc.json`, `tsconfig.json`, `.env.example`, `.eslintrc.cjs`, `.gitignore` are present
**And** `tailwind.config.ts` re-exports the shared config from `@nkbaz/shared`

**Given** the dev server should run for local development
**When** I run `pnpm --filter @nkbaz/web dev`
**Then** a local dev server starts with HMR on a non-conflicting port
**And** a placeholder homepage renders showing at minimum the project name

**Given** the production build should produce static output
**When** I run `pnpm --filter @nkbaz/web build`
**Then** the build completes without errors
**And** the output is written to `apps/web/dist/`
**And** `dist/index.html` exists and is statically prerendered (no JS required to read the body content)

**Given** TypeScript should be strict
**When** I run `pnpm --filter @nkbaz/web typecheck`
**Then** no type errors are reported
**And** the `tsconfig.json` extends the shared base config

---

### Story 1.3: Build SiteHeader and SiteFooter Chrome

As a **prospective visitor**,
I want **the marketing site to display a consistent header and footer on every page**,
So that **the brand is identifiable and I can navigate to GitHub and contact email even before any content has been built**.

**Acceptance Criteria:**

**Given** the layout described in UX spec step 11 and architecture step 6
**When** the chrome is built
**Then** `<SiteHeader />` exists in `apps/web/components/SiteHeader.tsx` with named export
**And** the header shows the Nixus logo (placeholder mark + "Nixus" wordmark) on the left and a placeholder Download button on the right
**And** the header is sticky on scroll (subtle backdrop blur appears when scrolled past hero)
**And** the header is a real `<header role="banner">` semantic element

**Given** the layout described in UX spec
**When** the chrome is built
**Then** `<SiteFooter />` exists in `apps/web/components/SiteFooter.tsx` with named export
**And** the footer shows: a GitHub link, a contact email link (`mailto:`), and a "Built in Canada by [name]" line
**And** the footer is a real `<footer role="contentinfo">` semantic element

**Given** the root layout in TanStack Router
**When** any route renders
**Then** the page renders `<SiteHeader />` above `<Outlet />` and `<SiteFooter />` below
**And** the layout is centered with `max-width: 1280px` and horizontal padding per the UX spec

**Given** mobile viewport
**When** the page renders at < 768px width
**Then** the header collapses gracefully (logo + Download button only; no nav drawer needed in v1)
**And** the footer reflows to a single column

**Given** accessibility expectations
**When** I navigate the page with keyboard alone
**Then** all interactive elements in the header and footer are reachable via Tab
**And** focus rings are visible on every interactive element
**And** a "Skip to main content" link appears on Tab focus and is hidden by default

---

### Story 1.4: Set Up GitHub Actions CI with Build and Lighthouse Gating

As a **solo builder**,
I want **a GitHub Actions workflow that builds the site, runs tests, and gates merges on Lighthouse CI scores**,
So that **regressions are caught before they ship**.

**Acceptance Criteria:**

**Given** the repo is on GitHub with the marketing site at `apps/web/`
**When** a pull request is opened touching `apps/web/` or `packages/shared/`
**Then** GitHub Actions runs a workflow that: installs dependencies (`pnpm install --frozen-lockfile`), typechecks (`pnpm --filter @nkbaz/web typecheck`), runs unit tests (`pnpm --filter @nkbaz/web test`), and builds (`pnpm --filter @nkbaz/web build`)
**And** the workflow fails if any of these steps fail

**Given** Lighthouse CI is configured per architecture NFR-W3
**When** the CI workflow runs
**Then** Lighthouse CI runs against the built static output
**And** the workflow fails if any of Performance / Accessibility / Best Practices / SEO scores drop below 90
**And** Lighthouse results are visible in the PR check output

**Given** a push to `main`
**When** the workflow runs
**Then** it executes the same checks as PR builds
**And** on success, it triggers the deploy step (deferred to Story 1.5 — no-op stub for now if hosting not yet set up)

**Given** no existing GitHub Actions workflows for the web app
**When** the work is complete
**Then** `.github/workflows/web-ci.yml` exists at the repo root with the workflow defined above
**And** the workflow uses pnpm caching to keep CI fast

---

### Story 1.5: Provision S3+CloudFront Hosting and Cloudflare DNS

As a **solo builder**,
I want **the marketing site deployed to S3+CloudFront behind a custom domain via Cloudflare DNS**,
So that **the live URL is reachable publicly and the cost stays at ~$0/month at zero traffic**.

**Acceptance Criteria:**

**Given** the chosen hosting per architecture step 4 is S3+CloudFront with Cloudflare DNS
**When** the infrastructure is provisioned
**Then** a private S3 bucket exists for the static build output (named consistently, e.g., `nixus-web-prod`)
**And** a CloudFront distribution serves content from that bucket
**And** an ACM certificate (free, AWS-issued) provides HTTPS for the custom domain
**And** Cloudflare DNS is configured to point the custom domain (apex + www) to the CloudFront distribution

**Given** the GitHub Actions deploy step from Story 1.4
**When** a push to `main` succeeds the build + Lighthouse gate
**Then** the workflow runs `aws s3 sync apps/web/dist s3://<bucket>/ --delete`
**And** the workflow runs `aws cloudfront create-invalidation --paths "/*"` against the distribution
**And** the new build is reachable at the custom domain within ~60 seconds of merge

**Given** the security headers requirement from architecture step 4
**When** CloudFront serves any response
**Then** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy` headers are present
**And** a strict CSP allowlists only first-party + analytics + GitHub asset domains

**Given** the cost target NFR-W1
**When** the site receives < 1 TB egress per month
**Then** the AWS bill for hosting components remains within the CloudFront free tier (cost ≤ $1/month)
**And** the Cloudflare DNS zone cost is $0/month
**And** total recurring cost (excluding domain registration) is ≤ $1/month

**Given** the visitor lands on the site
**When** they hit the custom domain in any modern browser
**Then** the placeholder homepage renders within 1 second on a typical connection
**And** the response is served over HTTPS with HTTP/2 or HTTP/3
**And** cache-control headers indicate appropriate caching for static assets

---

## Epic 2: Conversion Path

**Goal:** Land the v1 conversion flow end-to-end. A visitor on macOS or Windows can click Download and start downloading the latest binary; visitors on mobile/Linux/unknown see graceful variants; install instructions appear post-click.

### Story 2.1: Build-time GitHub Releases Fetcher

As a **build pipeline**,
I want **to fetch the latest GitHub Release metadata at build time and bake it into the static site**,
So that **the visitor's browser never depends on the GitHub API at runtime, and the site stays fast and resilient to GitHub outages**.

**Acceptance Criteria:**

**Given** the desktop app's GitHub Releases provide macOS and Windows binary assets
**When** the build runs
**Then** `apps/web/features/download/release.ts` runs in Node, calls the GitHub Releases API for the configured repo
**And** the result is written to `apps/web/features/download/release.gen.ts` as a typed TypeScript module
**And** the generated file exports at minimum: `version` (e.g., `"0.2.1"`), `published_at` (ISO date), `assets.macos.url`, `assets.windows.url`

**Given** the GitHub Releases API rate limits
**When** the fetch runs in CI
**Then** the request uses a `GITHUB_TOKEN` (auto-provided by GitHub Actions) for authenticated requests
**And** the rate limit budget is the authenticated 1000/hour, not the anonymous 60/hour

**Given** the pinned-version fallback per architecture step 4
**When** the env var `VITE_PINNED_RELEASE_TAG` is set (e.g., `v0.2.1`)
**Then** the fetcher fetches that specific release instead of "latest"
**And** the bake output reflects the pinned version

**Given** the GitHub API is unreachable or returns an error
**When** the fetcher runs
**Then** if `VITE_PINNED_RELEASE_TAG` is set, the build uses that pinned data (if cached locally) and continues
**And** if no fallback is available, the build fails fast with a clear error message
**And** the build never silently produces a broken site

**Given** the response shape from GitHub
**When** the fetcher parses it
**Then** unexpected response shapes (missing assets, schema changes) cause the build to fail with a clear error
**And** the parse logic uses TypeScript types defined in `release.types.ts`

**Given** the file should be regenerable in development
**When** I run `pnpm --filter @nkbaz/web fetch-release`
**Then** the script in `apps/web/scripts/fetch-release.ts` runs the same fetcher and updates `release.gen.ts`
**And** `release.gen.ts` is gitignored

---

### Story 2.2: useOSDetection Hook and parseUserAgent Utility

As a **page rendering on the visitor's browser**,
I want **a single source of truth for OS detection that classifies the visitor as macOS, Windows, Linux, mobile, or unknown**,
So that **every OS-aware UI element shows the correct variant without duplicate UA-parsing implementations**.

**Acceptance Criteria:**

**Given** the architecture step 5 communication patterns
**When** the implementation is complete
**Then** `apps/web/features/download/parseUserAgent.ts` exists as a pure function: `(ua: string) => OS` where `OS = 'macOS' | 'windows' | 'linux' | 'mobile' | 'unknown'`
**And** the function correctly classifies common UAs: macOS Safari/Chrome/Firefox, Windows Edge/Chrome/Firefox, Linux Firefox/Chrome, iOS Safari, Android Chrome, and unknown UAs
**And** the function is deterministic and has no side effects
**And** unit tests in `parseUserAgent.test.ts` cover at least 10 representative UA strings

**Given** the React hook consumers
**When** the implementation is complete
**Then** `apps/web/features/download/useOSDetection.ts` exists exporting `useOSDetection(): { os: OS; isLoading: boolean }`
**And** during SSR/prerender, `isLoading` is `true` and `os` is `'unknown'`
**And** after hydration, the hook calls `parseUserAgent(navigator.userAgent)` once and updates state
**And** unit tests cover the prerender state and the hydrated state

**Given** the architecture rule that OS detection is a single source of truth
**When** any component needs OS context
**Then** it consumes `useOSDetection`, never inlining UA parsing
**And** ESLint or code review enforces this (no `navigator.userAgent` references outside `features/download/`)

---

### Story 2.3: DownloadCTA Component with OS-aware Label

As a **macOS or Windows visitor**,
I want **the Download CTA to show the right binary for my OS and start downloading on click**,
So that **I can install Nixus in one click without choosing a platform manually**.

**Acceptance Criteria:**

**Given** the visitor is on macOS
**When** the page hydrates
**Then** `<DownloadCTA />` renders as a primary button labeled "Download for macOS"
**And** the button is a real `<a href="...">` element pointing to the macOS asset URL from `release.gen.ts`
**And** right-clicking the button exposes the native "Copy Link" with the actual binary URL (no tracking redirect)
**And** the button optionally shows the version (e.g., "v0.2.1") next to or below the OS label when `showVersion` prop is `true`

**Given** the visitor is on Windows
**When** the page hydrates
**Then** `<DownloadCTA />` renders labeled "Download for Windows" pointing to the Windows asset URL
**And** all other behavior matches the macOS case

**Given** the visitor's OS is unknown or detection failed (Linux, BSD, unknown UA)
**When** the page hydrates
**Then** the CTA shows "Choose your platform"
**And** clicking it expands an inline state showing both macOS and Windows options as buttons

**Given** the prerender pass
**When** the static HTML is generated
**Then** the CTA renders with the "Choose your platform" variant (because `useOSDetection` is loading)
**And** after hydration, the CTA upgrades to the OS-specific variant without layout shift

**Given** the analytics requirement (FR-W10)
**When** a visitor clicks the Download CTA
**Then** the click fires `trackEvent({ name: 'download.clicked', properties: { os: '...', version: '...' } })`
**And** the click also navigates the browser to the binary URL, starting the download

**Given** the no-JS fallback NFR-W7
**When** JavaScript is disabled
**Then** the prerendered HTML still contains a working `<a href>` to the binary URL (using a sensible default OS or both options)
**And** clicking it starts the download even without JS

**Given** the size variants
**When** the CTA is rendered with `size="lg"` (hero), `size="default"` (mid-page), or `size="sm"` (sticky header)
**Then** the visual size matches per the UX spec
**And** the variants share all OS-detection and click-tracking behavior

---

### Story 2.4: Mobile and Unsupported Platform CTA Variants

As a **mobile or Linux visitor**,
I want **the site to show a clear, non-shaming message about platform support and offer a way to come back from a desktop**,
So that **I leave with the pitch landed and the option to bookmark or send myself the link, instead of feeling locked out**.

**Acceptance Criteria:**

**Given** the visitor is on iOS, Android, or any mobile UA
**When** the page hydrates
**Then** the Download CTA is replaced with a clear message "Visit on a Mac or PC to download"
**And** below it, a "Send to my computer" affordance offers two actions: a "Copy link" button (copies the site URL to clipboard) and an "Email link to myself" button (opens a `mailto:` with the site URL prefilled)
**And** the message is informational and friendly, not apologetic or shaming

**Given** the visitor is on Linux or BSD
**When** the page hydrates
**Then** the CTA shows "Choose your platform" with an inline expansion offering both macOS and Windows options
**And** an additional small note links to the FAQ entry "Is Linux supported?" for context

**Given** UA detection fails entirely (unknown UA)
**When** the page hydrates
**Then** the same "Choose your platform" expansion is shown (treated identically to Linux for v1)

**Given** the mobile visit path
**When** the visitor scrolls through the page
**Then** the AI demo, features, screenshots, FAQ, and footer all render correctly on mobile (responsive layout per UX spec step 13)
**And** the only thing that changes versus desktop is the CTA's content; the rest of the pitch remains intact

**Given** the analytics granularity desired
**When** a mobile visitor sees the "Visit on a Mac or PC" message
**Then** an event `os.linux_message_shown` or `os.mobile_message_shown` is fired (one-time per session) so we can measure how often this branch is hit

---

### Story 2.5: InstallInstructions Post-click Reveal

As a **visitor who just clicked Download**,
I want **per-OS install instructions to appear on the same page**,
So that **I know how to handle the macOS Gatekeeper or Windows SmartScreen warning and complete the install**.

**Acceptance Criteria:**

**Given** a visitor clicks the Download CTA
**When** the click fires
**Then** the page state updates to render `<InstallInstructions />` below the hero (or in a dedicated section)
**And** the section scrolls smoothly into view
**And** focus moves to the section's heading so screen readers announce the state change
**And** the URL does NOT change (no `/thank-you` route navigation)

**Given** the install instructions component
**When** it renders
**Then** it shows tabs (using shadcn `Tabs` from `@nkbaz/shared`) labeled "macOS" and "Windows"
**And** the tab matching the detected OS is selected by default
**And** each tab pane contains brief, honest instructions (≤ 50 words each):
  - macOS: how to handle the "unidentified developer" Gatekeeper warning (System Settings → Privacy & Security → "Open Anyway")
  - Windows: how to handle the SmartScreen warning ("More info" → "Run anyway")
**And** instructions acknowledge the friction without apologizing

**Given** the visitor wants to switch tabs
**When** they click the other OS tab
**Then** the corresponding pane displays
**And** focus management follows shadcn `Tabs` defaults (keyboard-navigable arrows)

**Given** the visitor wants help
**When** they read the instructions
**Then** a "Need help?" link below the tabs links to the contact email or relevant FAQ entry

**Given** the visitor's intent to download again (e.g., for someone else)
**When** the install instructions are visible
**Then** the original Download CTA in the hero and sticky header remains functional and re-clickable
**And** the install instructions section does not block subsequent clicks

---

## Epic 3: Trust Spine & Pitch

**Goal:** Tell the Nixus story convincingly. The hero earns the scroll, the AI parse demo lands the magic moment, and the surrounding sections (features, screenshots, builder, FAQ) reinforce trust.

### Story 3.1: Hero Composition (Variant B — Centered)

As a **first-time visitor**,
I want **a hero section that communicates what Nixus is in one sentence and offers a clear Download CTA**,
So that **I understand the pitch and decide whether to keep scrolling within ~5 seconds**.

**Acceptance Criteria:**

**Given** the chosen design direction (Variant B from UX step 9)
**When** the hero renders
**Then** `<Hero />` exists in `apps/web/components/Hero.tsx` and is composed in the homepage route
**And** the hero is centered with content max-width ~960px
**And** it contains: an optional eyebrow label, a Display XL headline (~64px desktop, 48px mobile), a Lead-size subhead (~20px), `<DownloadCTA size="lg" showVersion showAltOS />`, and a small alt-OS link below
**And** there is no secondary CTA in the hero (single-CTA per UX step 9 decision)

**Given** the visual foundation from UX step 8
**When** the hero renders
**Then** the background uses the `--bg-hero` gradient (subtle slate-50 → white)
**And** typography uses Inter with negative tracking (-0.02em) on the display headline
**And** spacing uses generous vertical padding (`pt-32 pb-24` on desktop, scaled down on mobile)

**Given** placeholder content for v1
**When** the hero renders
**Then** the headline reads "Your spreadsheet's replacement, finally." (placeholder — final copy to be iterated post-launch)
**And** the subhead reads similarly to the prototype HTML mockup
**And** copy lives in props or `content/hero.ts`, not hardcoded in JSX

**Given** the heading hierarchy
**When** the page renders
**Then** the hero headline is the page's only `<h1>`
**And** subsequent sections use `<h2>` for their titles

**Given** unit testing
**When** `Hero.test.tsx` runs
**Then** at minimum: the headline renders, the subhead renders, and `<DownloadCTA />` is present

---

### Story 3.2: AIDemo CSS Animation with Reduced-Motion Fallback

As a **visitor scrolling past the hero**,
I want **to watch a credit card statement get parsed and categorized in seconds**,
So that **I understand and feel the AI auto-import promise without reading any copy**.

**Acceptance Criteria:**

**Given** the demo design from the prototype HTML and architecture step 4
**When** `<AIDemo />` renders
**Then** the component shows a card-styled container with a mac-style title bar and two-column body (statement on left, categorized output on right)
**And** statement content uses real Canadian merchant names (Costco, Tim Hortons, Petro-Canada, Tangerine, Wealthsimple) with realistic CAD amounts in JetBrains Mono
**And** the categorized output rows use shadcn `Badge` components with category-appropriate colors (Groceries=emerald, Dining=amber, Gas=indigo, Subs=purple)

**Given** the animation per architecture step 4 (CSS keyframes on real DOM elements)
**When** the demo enters the viewport
**Then** an IntersectionObserver triggers the animation
**And** the animation runs ~3–4 seconds: a "scan" effect highlights statement lines sequentially, transactions appear on the right side as they're "parsed", and a summary banner appears at the end ("5 transactions categorized in 2.4 seconds")
**And** after a 1–2 second pause the animation loops
**And** the animation is silent (no audio track ever)
**And** total CSS animation cost is < 5 KB

**Given** the reduced-motion accessibility requirement (NFR-W4)
**When** the visitor has `prefers-reduced-motion: reduce` set
**Then** the CSS animation is disabled via `@media (prefers-reduced-motion: reduce)`
**And** the demo renders a static "before/after" composition showing the statement on the left and the fully-categorized output on the right (no motion)
**And** the visitor still sees the value proposition without any animation

**Given** the performance budget (NFR-W2)
**When** the page first paints
**Then** the AI demo does NOT block first paint
**And** the demo renders a skeleton (matching aspect ratio, using `--muted` token) until its assets load
**And** there is no cumulative layout shift when the demo content arrives

**Given** accessibility expectations
**When** a screen reader encounters the demo
**Then** the component is wrapped in `<figure aria-label="AI parsing demo: a credit card statement becomes categorized expenses in seconds">`
**And** keyboard users can `Tab` past the demo without getting stuck

**Given** unit testing
**When** `AIDemo.test.tsx` runs
**Then** the component renders both the statement column and the output column
**And** with `prefers-reduced-motion: reduce` mocked, no CSS animations are applied

---

### Story 3.3: FeatureGrid with Feature Content

As a **visitor evaluating the pitch**,
I want **a feature grid that shows what's inside Nixus at a glance**,
So that **I quickly confirm Nixus has the capabilities I need (budgeting, multi-account, AI import, net worth, AI chat, income tracking)**.

**Acceptance Criteria:**

**Given** the UX spec component definition
**When** `<FeatureGrid />` renders
**Then** it lays out feature cards in a 3-column grid on desktop, 2-column on tablet, 1-column on mobile
**And** each card uses shadcn `Card` from `@nkbaz/shared`
**And** each card shows: a small icon (in `--accent` background), an `<h3>` title (≤ 4 words), and a 1-sentence description (≤ 100 chars)

**Given** the feature content per UX spec
**When** the grid renders
**Then** content is sourced from `apps/web/content/features.ts` (typed array, no JSX)
**And** v1 features include: AI Statement Import, Budget Builder, Multi-Account Tracking, Passive Asset Tracking, Net Worth History, AI Chat (6 features)
**And** copy is honest, specific, and avoids "AI-powered" repetition

**Given** the heading hierarchy
**When** the page renders
**Then** the section is wrapped in `<section aria-labelledby="features-heading">` with an `<h2>` section header
**And** each card uses `<h3>` for its title

**Given** restraint on interactivity
**When** a feature card is rendered
**Then** the card is presentational (no `onClick`, no link to a detail page in v1)
**And** hover state shows only a subtle border-tone shift (no transform, no scale)

**Given** unit testing
**When** `FeatureGrid.test.tsx` runs
**Then** it renders the expected number of feature cards
**And** each card has its title and description visible

---

### Story 3.4: ScreenshotShowcase with Real Screenshots

As a **visitor evaluating trust**,
I want **to see real screenshots of the Nixus desktop app**,
So that **I know the product is real and visually polished, not vapor**.

**Acceptance Criteria:**

**Given** the UX spec ScreenshotShowcase component
**When** the section renders
**Then** `<ScreenshotShowcase />` exists in `apps/web/components/ScreenshotShowcase.tsx` accepting `src`, `alt`, optional `caption`, optional `align`
**And** the image is framed using the `--ring-screenshot` token (subtle border + soft drop shadow per UX step 8)
**And** images use `<picture>` with WebP source + PNG fallback
**And** images use `loading="lazy"` (below-fold)
**And** layout shift is prevented via `aspect-ratio` CSS

**Given** real screenshots are needed
**When** the work is complete
**Then** `apps/web/public/screenshots/` contains at minimum 4 real desktop app screenshots (e.g., dashboard, AI import flow, net worth history, AI chat) at 1x and 2x WebP variants
**And** PNG fallbacks exist for older browsers
**And** screenshots are captured on a real device (not a Tauri dev preview) to reflect actual visual quality

**Given** accessibility requirements (NFR-W4)
**When** screenshots render
**Then** each `<img>` has meaningful `alt` text describing what's shown (e.g., "Nixus dashboard showing budget bars, account balances, and net worth trend")
**And** decorative-only screenshots (none expected in v1) would use `alt=""`

**Given** the trust-spine context
**When** screenshots appear in the page
**Then** they're laid out near the feature grid (either inside the features section or in their own adjacent section)
**And** each screenshot is paired with a brief caption describing what's shown

---

### Story 3.5: BuilderSection with Builder Copy

As a **skeptical visitor**,
I want **to read who built Nixus and why**,
So that **I trust this is a real project from a real person, not a faceless SaaS pretending to care**.

**Acceptance Criteria:**

**Given** the UX spec BuilderSection component
**When** the section renders
**Then** `<BuilderSection />` exists in `apps/web/components/BuilderSection.tsx`
**And** the section is wrapped in `<section aria-labelledby="builder-heading">`
**And** the layout is centered with a narrower content container (~720px) for readability

**Given** the content per UX spec
**When** the section renders
**Then** content is sourced from `apps/web/content/builder.ts`
**And** the copy is first-person, ≤ 150 words, and tells the spreadsheet origin story honestly
**And** an optional avatar/photo can be shown next to or above the copy
**And** links to the builder's GitHub profile and contact email are present

**Given** brand-voice expectations
**When** copy is written
**Then** the voice is direct, slightly understated, and specific (mentions real banks, real account types like TFSA/RRSP)
**And** the copy avoids "we" framing, marketing-speak ("revolutionizing"), and false intimacy ("Hey friend!")
**And** the copy explicitly acknowledges that Nixus is solo-built

**Given** the section is content-heavy with no interactivity
**When** rendered
**Then** the only interactive elements are the GitHub and email links
**And** the section uses `<h2>` heading hierarchy

---

### Story 3.6: FAQ Accordion with FAQ Content

As a **visitor with predictable concerns**,
I want **an FAQ that answers my privacy, safety, pricing, and platform questions plainly**,
So that **I resolve my doubts without having to email or hunt through external pages**.

**Acceptance Criteria:**

**Given** the UX spec FAQ component
**When** the FAQ renders
**Then** `<FAQ />` exists in `apps/web/components/FAQ.tsx` using shadcn `Accordion` from `@nkbaz/shared` in single-open mode
**And** the FAQ content lives in `apps/web/content/faq.ts` as a typed array of `{ question, answer }` objects
**And** the section is wrapped in `<section aria-labelledby="faq-heading">` with an `<h2>` section header

**Given** the v1 FAQ entries from UX spec step 11
**When** the FAQ renders
**Then** at minimum 8 entries are present:
  1. "Does this connect to my bank?" — No, by design
  2. "Is this safe to install?" — Honest answer about Gatekeeper/SmartScreen + GitHub source link
  3. "Is it free?" — Free now, paid modules planned
  4. "Where is my data stored?" — Locally; AI feature uses AWS Bedrock for parsing only
  5. "Is Linux supported?" — Not in v1; planned later
  6. "What about mobile?" — Desktop-only (macOS/Windows)
  7. "Who built this?" — One person; GitHub profile link
  8. "How do I update?" — Re-download from this site

**Given** the accordion behavior
**When** a visitor clicks a question
**Then** the corresponding answer expands smoothly (~200ms ease — shadcn default)
**And** any other open question collapses (single-open mode)
**And** keyboard navigation follows shadcn `Accordion` defaults (Tab between questions, Enter/Space to toggle)

**Given** the layout containers
**When** the FAQ renders
**Then** the content is in a narrower container (~720px) for readability per UX step 8
**And** below the accordion, a "Still have questions?" line links to the contact email

**Given** analytics granularity
**When** a visitor expands a question
**Then** an event `faq.expanded` fires with the question title in properties (per the analytics naming convention from architecture step 5)

---

## Epic 4: Launch Readiness

**Goal:** Verify and polish everything that doesn't directly belong to a content section: SEO, OG image, analytics, accessibility, cross-browser/cross-OS compatibility, and the JS-disabled / right-click paths.

### Story 4.1: Analytics Wrapper and Cloudflare Web Analytics Integration

As a **product owner**,
I want **Cloudflare Web Analytics to track Download CTA clicks (and a few other key events) without cookies or banners**,
So that **I can measure conversion lightly without compromising privacy or the calm-baseline emotional goal**.

**Acceptance Criteria:**

**Given** the analytics provider chosen in architecture step 4
**When** the integration is complete
**Then** the Cloudflare Web Analytics beacon script is injected via `__root.tsx` layout (or equivalent) only on production builds
**And** the script is loaded with appropriate defer/async attributes so it does not block first paint
**And** no cookies are set as a result of analytics

**Given** the analytics wrapper per architecture step 5
**When** the wrapper is built
**Then** `apps/web/lib/analytics.ts` exports a `trackEvent` function with a typed `AnalyticsEvent` discriminated union
**And** v1 events include `download.clicked`, `faq.expanded`, and either `os.mobile_message_shown` or `os.linux_message_shown` (one-time per session)
**And** event property keys are snake_case (matching architecture's JSON contract rule)
**And** `trackEvent` is a no-op when `window` is undefined (SSR-safe)

**Given** consumer call sites
**When** the integrations are complete
**Then** `<DownloadCTA />` calls `trackEvent({ name: 'download.clicked', properties: { os, version } })` on click
**And** `<FAQ />` calls `trackEvent({ name: 'faq.expanded', properties: { question } })` on expansion
**And** the mobile-message variant of `<DownloadCTA />` fires the OS-specific message-shown event once per session

**Given** unit testing
**When** `analytics.test.ts` runs
**Then** `trackEvent` does not throw when `window.cfBeacon` is undefined
**And** when `window.cfBeacon.track` is mocked, calling `trackEvent` invokes it with the correct name + properties

**Given** the privacy goal (NFR-W5)
**When** the analytics integration is verified
**Then** no cookies are set by the site
**And** no consent banner is displayed
**And** the legal cookie/privacy footer link mentions analytics as cookieless

---

### Story 4.2: SEO Meta Helper and OG Image

As a **search engine crawler or social media link preview**,
I want **the marketing site to expose proper title, meta, OG, and Twitter card tags**,
So that **search results and shared links display accurate, polished previews**.

**Acceptance Criteria:**

**Given** the SEO requirements from architecture FR-W11
**When** the implementation is complete
**Then** `apps/web/lib/meta.ts` exports a helper that returns standard meta tags for a given page (title, description, canonical URL, OG title/description/image/url, Twitter card type/title/description/image)
**And** the helper is consumed in `apps/web/app/routes/__root.tsx` (or per-route) to inject tags into `<head>`

**Given** the homepage in v1
**When** the page renders
**Then** the `<title>` is "Nixus — Personal finance, automated" (or similar; final title to be confirmed)
**And** the `<meta name="description">` is a concise, distinctive 150–160 char summary of the pitch
**And** OG and Twitter card tags reference an actual `og-image.png` at 1200×630
**And** a `canonical` link tag points to the production URL

**Given** an OG image is needed
**When** the work is complete
**Then** `apps/web/public/og-image.png` exists at 1200×630, designed to match the site's visual language (slate + teal palette, real product imagery or polished typography, NOT a generic illustration)
**And** the image renders correctly when posted to Twitter, LinkedIn, Slack, and Discord (verifiable manually)

**Given** the Lighthouse SEO score requirement (NFR-W3)
**When** Lighthouse CI runs on the prerendered output
**Then** SEO score is ≥ 90
**And** all checks (meta description, viewport meta, document language, etc.) pass

---

### Story 4.3: Static robots.txt and sitemap.xml

As a **search engine crawler**,
I want **standard robots.txt and sitemap.xml files**,
So that **I can discover and index the site's pages efficiently**.

**Acceptance Criteria:**

**Given** the standard SEO conventions
**When** the work is complete
**Then** `apps/web/public/robots.txt` exists and allows all crawlers (no Disallow rules in v1)
**And** robots.txt references the sitemap with a `Sitemap: https://<domain>/sitemap.xml` line

**Given** the v1 has a single page
**When** the work is complete
**Then** `apps/web/public/sitemap.xml` exists listing the homepage with current `<lastmod>` (build date)
**And** the sitemap is hand-maintained (no build-time generator in v1)

**Given** the deployment
**When** the site is live
**Then** `https://<domain>/robots.txt` and `https://<domain>/sitemap.xml` return 200 with correct content
**And** the sitemap validates against the sitemap.org schema

---

### Story 4.4: Pre-launch Accessibility Sweep

As a **product owner**,
I want **a comprehensive accessibility verification before launch**,
So that **the site meets WCAG 2.1 AA compliance and works for users with assistive tech**.

**Acceptance Criteria:**

**Given** axe-core integration in CI
**When** the CI pipeline runs
**Then** `apps/web/tests/e2e/a11y.spec.ts` (Playwright + axe-core) runs against the homepage and 404 page
**And** the test fails if any WCAG 2.1 AA violation is detected
**And** the test is part of the gating CI workflow

**Given** manual screen-reader testing
**When** the pre-launch sweep runs
**Then** the homepage has been tested with VoiceOver on macOS and the full page is navigable + announced correctly
**And** the homepage has been tested with NVDA on Windows and the full page is navigable + announced correctly
**And** the AI demo's `aria-label` reads correctly
**And** post-click focus-management on `<InstallInstructions />` reveal works (focus moves to the heading)

**Given** keyboard-only verification
**When** the sweep runs
**Then** the entire site is operable with keyboard alone (Tab, Shift-Tab, Enter, Space, Arrow keys for tabs/accordion)
**And** the focus order is logical (header → hero CTA → demo → features → screenshots → builder → FAQ → footer)
**And** focus rings are visible on every interactive element
**And** the "Skip to main content" link works correctly

**Given** reduced-motion verification
**When** the visitor has `prefers-reduced-motion: reduce` set
**Then** the AI demo renders the static before/after composition (no animation)
**And** all other animations on the site (e.g., FAQ accordion) respect the preference or use minimal motion

**Given** color-contrast verification
**When** the sweep runs
**Then** all text/background combinations meet WCAG 2.1 AA contrast (4.5:1 normal, 3:1 large)
**And** any borderline cases are documented and ratified

**Given** zoom support
**When** the visitor zooms to 200% in the browser
**Then** the layout reflows without horizontal scrolling on text content
**And** all interactive elements remain reachable and usable

**Given** high-contrast mode
**When** the page is rendered in Windows high-contrast mode or macOS Increase Contrast
**Then** borders, focus rings, and text remain visible

---

### Story 4.5: Cross-browser and Cross-OS Verification

As a **product owner**,
I want **the site verified on the supported browser/OS matrix before launch**,
So that **the conversion path works regardless of where the visitor lands from**.

**Acceptance Criteria:**

**Given** the supported browser matrix (NFR-W6)
**When** the verification runs
**Then** the site has been manually tested on Chrome (current + previous version) on macOS and Windows
**And** Firefox (current + previous) on macOS and Windows
**And** Safari (current + previous) on macOS
**And** Edge (current) on Windows
**And** in each case, the homepage renders correctly, the AI demo plays (or shows reduced-motion fallback), and the Download CTA works

**Given** OS detection accuracy
**When** the verification runs
**Then** macOS visitors see "Download for macOS" by default
**And** Windows visitors see "Download for Windows" by default
**And** Linux visitors see "Choose your platform"
**And** iOS and Android visitors see "Visit on a Mac or PC to download"

**Given** the Download click verification
**When** a visitor clicks Download on each platform
**Then** the correct binary downloads (verifiable by checking the download URL in browser history)
**And** install instructions appear for the correct OS

**Given** mobile verification
**When** the site is tested on a real iPhone and a real Android device
**Then** the layout reflows correctly per the responsive breakpoints
**And** the "Send to my computer" affordance (copy link, mailto-self) works
**And** all images and the AI demo render correctly at mobile size

**Given** Playwright E2E coverage
**When** the test suite runs
**Then** `tests/e2e/conversion.spec.ts` exercises the hero → demo → download click flow on Chromium
**And** `tests/e2e/os-detection.spec.ts` mocks UA and verifies CTA variants
**And** `tests/e2e/mobile.spec.ts` runs against a mobile viewport configuration

---

### Story 4.6: JavaScript-disabled and Right-click Verification

As a **power user**,
I want **the Download CTA to work even with JavaScript disabled, and right-clicking it to expose a clean binary URL**,
So that **I can `wget` the file, share a direct link, or use the site under any browser configuration**.

**Acceptance Criteria:**

**Given** the no-JS fallback (NFR-W7)
**When** JavaScript is disabled in the browser
**Then** the prerendered homepage still renders the hero, demo (static composition), features, FAQ, and footer
**And** the Download CTA shows both macOS and Windows download links as plain `<a>` tags
**And** clicking either link starts the download successfully

**Given** the right-click guarantee (FR-W5)
**When** a visitor right-clicks the Download CTA in any state (macOS variant, Windows variant, Choose-your-platform variant)
**Then** the native browser "Copy Link" menu item returns the actual GitHub Releases binary URL
**And** the URL contains no tracking redirect or analytics shim
**And** middle-clicking or Cmd-clicking opens the binary URL in a new tab (which starts the download)

**Given** verification via manual testing
**When** the pre-launch checklist runs
**Then** the no-JS path has been tested in at least Chrome and Firefox
**And** right-click "Copy Link" has been tested on Chrome, Firefox, and Safari
**And** the URLs returned have been verified to start the actual binary download when pasted into a fresh tab

**Given** a stretch verification
**When** a CLI user runs `curl -L -o nixus.dmg <copied-url>`
**Then** the binary downloads correctly (no auth required, no redirect to a login page, no rate limit per anonymous user)
