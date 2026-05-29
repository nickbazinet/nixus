---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-nkbaz-finance-2026-03-14.md
  - _bmad-output/planning-artifacts/prd.md
date: 2026-04-25
author: Nbazinet
project_name: nixus-marketing-site
location: apps/web/
relatedProduct: nkbaz-finance (desktop app, branded as Nixus)
---

# Product Brief: nixus-marketing-site

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

The Nixus marketing site is the public face of the Nixus desktop app — the landing place where prospective users arrive from search and marketing campaigns, learn what Nixus does, and download the latest build in seconds. The site's job today is twofold: tell a clear, compelling story about automation-first personal finance, and make the install path frictionless by serving the latest GitHub release (or a pinned version) as a one-click download. It's free now, with a roadmap toward authenticated accounts, a free tier, and paid modules — most notably the AI-powered statement import — layered in once the core funnel is converting. Success is measured in visual polish that earns trust, and download conversion that proves the pitch lands.

---

## Core Vision

### Problem Statement

Nixus exists, but no one outside a small circle can find it, evaluate it, or install it without a personal nudge. There's no public surface that explains what the app is, why it's different, or how to get it running. Prospective users arriving from a search result or a campaign click have nowhere to land — which means marketing spend has no destination, organic discovery has no payoff, and the "install in 30 seconds" promise can't be delivered to anyone who isn't already a friend.

### Problem Impact

Without a marketing site, growth is gated entirely on word-of-mouth from the builder's personal network. Marketing campaigns can't be run because there's no landing page to point them at. Search traffic is unreachable. The product can't graduate from "personal project shared with friends" to "product strangers choose," and the future subscription model has no foundation — no audience funnel, no auth surface, no place to put a buy button when the time comes.

### Why Existing Solutions Fall Short

A bare GitHub Releases page can technically distribute the binary, but it doesn't sell the product, doesn't explain the automation-first vision, doesn't reassure a non-technical user that the install is safe and straightforward, and doesn't establish brand. Generic SaaS landing-page templates pitch a hosted web app — Nixus is a downloadable desktop experience, which is its own conversion challenge (trust, install friction, OS detection) that templates don't solve well.

### Proposed Solution

A polished marketing site at apps/web/ that:

- **Pitches the product** — clear hero, the automation-first story, feature highlights (AI import, budgeting, net worth, multi-account) pulled from the desktop app's positioning
- **Drives downloads** — prominent download CTA serving the latest GitHub release (or a pinned version, configurable), with OS detection where feasible
- **Earns trust** — visual polish, screenshots of the actual app, honest framing about the project's stage
- **Lays the foundation for monetization** — built so login, free-tier account creation, and paid module checkout can be added without a rewrite, even though none of that ships in v1

### Key Differentiators

- **Authentic product story** — the site reflects a real builder solving a real problem, not a templated SaaS pitch
- **Frictionless install** — the download path is the shortest possible: land, understand, click, install. No signup wall, no email gate.
- **Aligned with the product's automation-first identity** — the site itself feels effortless, mirroring the promise of the app
- **Future-ready architecture** — auth and payments are planned-for from day one in the structure, even though they're deferred in v1

---

## Target Users

### Primary Users

The marketing site serves **prospective Nixus users** — people who experience the same financial-tracking pain that drove the desktop app, but don't yet know Nixus exists.

**Persona: "The Frustrated Tracker"**

Alex is a 30-something Canadian professional with a multi-pillar financial life — chequing/savings at one bank, a CC at another, TFSA + RRSP + non-registered + some crypto at Wealthsimple, plus a condo and a slice of a small business on the side. Alex has tried Google Sheets, gave up, tried Mint (now defunct in Canada), tried Monarch, looked at YNAB. Each one either misses the asset side, can't connect to Canadian banks reliably, or demands more manual maintenance than Alex will sustain.

Alex finds the marketing site by searching "personal finance app TFSA RRSP," "Mint alternative Canada," or "AI budget app," or by clicking a campaign ad. Tech-comfortable — runs Mac or Windows, can install a desktop binary without hand-holding, but wants to know quickly: *what is this, who built it, is it safe to run, can it actually parse my CC statement.*

**Problem they're experiencing:**
- Their financial picture is fragmented across tools and bank logins
- Existing solutions either don't cover their full life (TFSA, RRSP, crypto, real estate, business equity) or demand too much manual upkeep
- Most tools require connecting bank accounts via Plaid-style integrations they don't trust or that don't reliably support Canadian institutions

**What success looks like for them:**
"In two minutes on the site I understood the pitch, saw the AI auto-import in action via screenshot or short demo, trusted the brand enough to click download, and had a working build on my machine inside five minutes."

### Secondary Users

**Persona: "The AI-Curious Visitor"**
Lands because the AI angle ("upload a CC screenshot, get categorized expenses") caught their attention from a Twitter/Reddit/HN post. May or may not have a multi-account financial life — they're here for the magic. Site needs to lead with the AI demo prominently for this segment, even though they're not the primary buyer.

**Persona: "The Returning User"**
Existing Nixus user coming back for a new build, changelog, or — once monetization ships — to upgrade to a paid module. Needs a fast, clear path to *Latest Version*, *What's New*, and (later) *Account / Billing*. Lower priority for v1 but the navigation should anticipate them.

**Persona: "The Builder (You)"**
Self as content publisher — pushing release notes, screenshots, and future paid-module pages. Not a user-of-the-app persona per se, but an editorial constraint: the site has to be cheap and fast to update.

### User Journey

**Acquisition → Install (the v1 critical path):**

1. **Discover** — Google search ("personal finance app TFSA RRSP," "AI budget tracker Canada," "Mint Canada alternative") or a paid campaign click brings Alex to the homepage.
2. **Pitch** — Hero communicates the automation-first promise in one sentence. A short demo (animated screenshot or video) shows the AI-import flow within the first scroll.
3. **Validate** — Alex scrolls: feature highlights (budgeting, AI import, multi-account, passive assets, net worth, AI chat), real screenshots from the desktop app, an honest "who built this and why" section, an FAQ that handles the obvious objections (privacy / data location, bank integration, install safety, supported OS).
4. **Convert** — A prominent Download CTA serves the latest build from GitHub Releases (with a fallback to a pinned version if needed). Detects OS and offers the right binary — macOS or Windows. Both platforms are first-class for downloads; if a visitor is on Linux or mobile, the site explains current platform support without making them feel turned away.
5. **Install** — Honest, brief install instructions per platform: macOS "unidentified developer" Gatekeeper guidance, Windows SmartScreen guidance, and reassurance on install safety.
6. **First-run** — Hand-off to the desktop app; the site's job ends here. (The app itself owns onboarding per the desktop PRD.)

**Future journey (post-v1):**

7. **Account creation** — Once auth ships, Alex can create a free-tier account from the site (or from the app's account screen).
8. **Upgrade** — When AI module pricing ships, Alex hits a paywall in the app or a pricing page on the site, picks a paid module (likely AI import first), checks out, and the desktop app unlocks the feature.

The "aha!" moment for the site is the AI import demo — the moment Alex sees a CC screenshot turn into categorized budget entries on screen and thinks *"I've been needing exactly this."*

---

## Success Metrics

The site is a "ship it and see" v1, not a measurement-heavy experiment. Tracking is intentionally minimal — the goal is to get the marketing surface live, not to instrument it. Metrics here are starter targets and a watch-list of what to instrument *if* the site needs to be optimized later. The builder is happy with a single download as a sign that the funnel works at all.

### User Success

The user-side definition of success is qualitative and observable, not metric-driven for v1:

- A visitor lands, understands what Nixus is within ~30 seconds, and feels the site is polished enough to trust the download.
- The download path is short and clear — no friction between "I want this" and "it's installing."
- Install instructions handle the obvious OS friction (macOS Gatekeeper, Windows SmartScreen) without sending the user away.

### Business Objectives

N/A for revenue — the product is free in v1 with no monetization shipping. Business objectives at this stage are existential, not financial: *have a public surface that exists*, so future marketing, search traffic, and the eventual paid-module funnel have somewhere to land.

When monetization ships (post-v1), the relevant business objectives will become free-tier signups, paid-module conversion, and ARPU — but those are deferred and explicitly out of scope for v1 measurement.

### Key Performance Indicators

**v1 (live now):**

| KPI | Starter Target | How to Measure |
|-----|---------------|----------------|
| Download conversion rate | ~5% of unique visitors click Download | Basic web analytics on the Download CTA |
| Site is live and accurate | Page loads, latest GitHub release is served | Manual verification at release time |

That's intentionally the whole list for v1. The builder doesn't want to spend time on tracking infrastructure right now; the site needs to ship.

**Tracked-but-not-targeted (nice to know if cheap to add):**

- Total visits per month
- Geographic split (Canada vs. elsewhere)
- Top entry pages / referrers (search vs. campaign vs. direct)

**Future KPIs (deferred to later phases — track when monetization ships):**

- Free-tier signup rate (visit → account creation)
- Paid module conversion rate (free → paid)
- ARPU (average revenue per user)
- Module attach rate (which paid modules get bought, in what mix)
- Retention proxy: returning-visitor rate to /releases or /changelog

### Notes on Measurement Philosophy

- No install telemetry assumed — the site can only measure *download clicks*, not actual installs or activation. If install telemetry becomes available later, real conversion metrics get unlocked.
- Whatever analytics solution gets used should be lightweight and privacy-friendly (e.g., Plausible, Umami, or similar) to match the product's general "trust us" positioning. No heavyweight ad-tech.

---

## MVP Scope

### Core Features

The v1 marketing site is intentionally a single, well-crafted landing experience plus the supporting pages needed to make a download trustworthy. No more.

**Must-ship for v1:**

1. **Landing page** — single long-scroll page with:
   - Hero: one-sentence pitch + primary Download CTA
   - Short visual demo of the AI CC-import flow (animated screenshot, loop, or short video — whichever is fastest to produce)
   - Feature highlights pulled from the desktop PRD: AI import, budgeting, multi-account, passive assets, net worth, AI chat
   - Real screenshots of the desktop app in action
   - "Built by a real person" / why-this-exists section
   - FAQ covering: privacy/data location (local-first), bank integration (intentionally not yet), supported OS, install safety
   - Footer with link to GitHub repo, email contact, privacy
2. **Download experience**
   - OS detection on the Download CTA (macOS vs. Windows; Linux/mobile get a "not yet" message that doesn't shame the visitor)
   - Configurable source: latest GitHub release by default, with a pinned-version fallback flag for when a release is broken
   - Brief, per-OS install instructions (macOS Gatekeeper, Windows SmartScreen)
3. **Operational basics**
   - Lives in `apps/web/` as part of the pnpm monorepo
   - Deployable to a static host (Vercel/Netlify/Cloudflare Pages — TBD)
   - Custom domain hookup
   - Lightweight, privacy-friendly analytics on the Download CTA
   - SEO basics: title/meta, OG image, sitemap, robots.txt
4. **Architectural readiness for what's next** — no shipped features, just don't paint into corners:
   - Routing/structure that can later host /pricing, /account, /releases, /changelog, /docs without restructuring
   - Component system (e.g., shadcn/ui to match the desktop app, or equivalent) that can carry forward into authed surfaces

### Out of Scope for MVP

Explicitly **not** in v1, even though they'll likely come later:

- **Authentication / accounts** — no signup, no login, no password reset, no profile pages
- **Payment / subscriptions** — no Stripe integration, no pricing page, no paid-module checkout, no entitlement system
- **User-specific dashboards** — no logged-in surfaces of any kind
- **Blog / content marketing** — no blog engine, no articles
- **Documentation site** — link to GitHub README is sufficient for v1
- **Changelog / release notes page** — link to GitHub Releases for v1
- **Email capture / newsletter** — no "notify me" forms
- **Multi-language** — English-only for v1 (no FR even though target user is Canadian; revisit if usage warrants)
- **A/B testing infrastructure** — no experimentation framework
- **Heavy analytics / behavioral tracking** — no Segment, no Mixpanel, no GA4. Privacy-friendly counter only.
- **Live chat / support widget** — email contact link is enough
- **Affiliate / referral system**
- **Press kit, careers, or "Company" pages** — solo project, not needed

### MVP Success Criteria

The MVP is "done" when:

- The site is deployed at a custom domain and reachable publicly
- A first-time visitor on macOS or Windows can land, understand the pitch within ~30 seconds, and download the correct binary in one click without leaving the site
- The Download CTA serves the latest GitHub release (or a configured pinned version) reliably
- The visual quality is high enough that the builder feels comfortable sharing the link publicly (the "would I send this to a stranger" bar)
- At least one real download happens from a non-friend visitor — the signal that the funnel works at all

The MVP is **not** waiting on metrics targets, A/B tests, or optimization. Ship-and-watch.

### Future Vision

Post-v1 expansion, in rough order of likely priority:

**Phase 2 — Monetization Foundations**
- Pricing page describing free tier + paid modules (AI import as the flagship paid module)
- Account creation / login flow tied to the desktop app's user model
- Stripe checkout for paid modules; entitlement sync to desktop app
- Authenticated /account page (subscription status, billing, downloads for paid users)

**Phase 3 — Content & Acquisition**
- Blog / changelog as first-party content (better SEO than relying on GitHub Releases)
- Documentation site for setup, AI import troubleshooting, importing from spreadsheets, etc.
- Email capture for product updates and launch announcements
- Affiliate or referral mechanic if the user base grows organically

**Phase 4 — Scale & Polish**
- Linux build distribution
- Localization (French at minimum, given Canadian audience)
- Press kit, comparison pages vs. specific competitors (YNAB, Monarch, Copilot), case studies
- Heavier analytics / experimentation as the funnel becomes worth optimizing
