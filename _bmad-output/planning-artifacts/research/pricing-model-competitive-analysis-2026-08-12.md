---
project_name: 'Nixus'
user_name: 'dev'
date: 2026-08-12
status: complete
document_type: 'pricing-strategy-research'
inputs:
  - docs/project-context.md
  - _bmad-output/planning-artifacts/architecture-entitlements-licensing.md
  - _bmad-output/planning-artifacts/prd.md
  - README.md
  - live code audit (apps/desktop)
  - web search, August 2026
---

# Nixus Pricing Model — Competitive Analysis & Recommendation

## Executive Summary

Nixus is being positioned into the wrong competitive set if compared against YNAB/Monarch/Copilot ($95–$199/yr, bank-synced, cloud-first). Nixus has no bank sync, is local-first, desktop-only, and uses BYOK AI — that puts it in a much smaller, cheaper cluster: **manual-import, local-first, privacy-first desktop finance apps** (Actual Budget, Sumhouse, MeasuredMoney, Ouriva, Rise Budget), where prices run **$0–$50 one-time or $20–$40/yr**, not $100+/yr.

The entitlements architecture is already locked (LemonSqueezy + Keygen, per-module gating, lifetime one-time + monthly/yearly recurring — see [architecture-entitlements-licensing.md](../architecture-entitlements-licensing.md)). Zero pricing/monetization code exists today; the app is fully unlocked. This doc recommends the actual numbers.

**Recommendation:** Per-module lifetime pricing anchored low ($29–$39 Finance, $15–$19 Car, ~$49 bundle), a monthly/yearly subscription as the higher-friction alternative (not the primary ask), and a time-limited "founding price" during pre-alpha/beta — consistent with what every local-first competitor in this cluster actually does.

---

## 1. What Nixus Actually Ships Today (code-verified)

Verified directly against `apps/desktop` source (not docs) as of 2026-08-12:

| Area | Status |
|---|---|
| Budget builder, expenses, recurring templates | Shipped |
| AI statement import (screenshot/PDF → Bedrock → auto-categorize) | Shipped — **BYOK**: user supplies their own AWS Bedrock or OpenAI key, stored in OS keychain. Nixus has **zero AI variable cost** today. |
| Multi-account (bank/investment/crypto, CAD/USD), passive assets, net worth history | Shipped |
| Income tracking | Shipped |
| AI chat (multi-agent, natural language over your data) | Shipped |
| Financial Health / Next-Best-Action (emergency fund, savings rate, priority waterfall) | Shipped |
| Budget templates (import/export, Canadian starter) | Shipped |
| Savings Projects (goal earmarking, contribution tracking) | Code-complete, in final QA |
| User Profile (income bracket, province, TFSA limit tracking) | Code-complete, in final QA |
| Car module (garage, maintenance schedules, service history, alerts, NHTSA catalog lookup) | Code-complete, in final QA |
| Login (Cognito email/password + Google) | Shipped — **but architecturally decoupled from entitlements today.** Signing in gates nothing. Using it as the identity anchor for licenses is a deliberate amendment, not a rewire. |
| Licensing/entitlements/paywall | **None.** Everything above is unlocked and unmetered right now. |

Two differentiators worth pricing around: (1) AI import with **no marginal AI cost to Nixus** (competitors either bundle AI cost into subscription price or don't offer it at all), and (2) a genuine **multi-module platform** (Finance + Car today, more later) — no direct competitor spans personal finance and vehicle maintenance in one app.

---

## 2. Competitive Landscape

### Cluster A — Cloud-first, bank-synced (the "obvious" comps — wrong comparison for Nixus)

| App | Price | Bank sync | Platform | Notes |
|---|---|---|---|---|
| YNAB | $109/yr or $14.99/mo | Yes (Plaid) | iOS/Android/Web | Zero-based method, up to 6 people/subscription |
| Monarch Money | $99.99/yr (Core) / $199/yr (Plus) | Yes (Plaid, 13k+ institutions) | iOS/Android/Web | Household sharing, investment tracking on Plus |
| Copilot Money | $95/yr or $13/mo | Yes (Plaid, US-only) | Apple only | AI categorization, no Android |
| Quicken Simplifi | ~$47.88/yr (promo) | Yes | iOS/Android/Web | Cited as budget option in this cluster |
| Tiller | $79/yr | Yes (via Sheets feed) | Google Sheets/Excel | Spreadsheet, no mobile app |

These apps monetize continuous bank-sync infrastructure and managed AI/ML — cost structure Nixus doesn't carry. Pricing here (**$80–$200/yr**) reflects that ongoing infra cost, not just feature value.

### Cluster B — Local-first, manual/CSV import, no bank sync (Nixus's actual peer set)

| App | Price | Model | Platform |
|---|---|---|---|
| Actual Budget | Free (self-host) / ~$36/yr (managed hosting, e.g. PikaPods) | Open-source, optional paid hosting only | Win/Mac/Linux |
| Sumhouse | $34.99 one-time (first 100 buyers) → $49.99 one-time after | Lifetime, no subscription, price rises once launch cohort sells out | Mac only |
| MeasuredMoney | $49 one-time | Lifetime, local SQLite, license-gated | Desktop |
| Ouriva | Free (self-host) / $39/yr → $69/yr (hosted) / $99 → $149 one-time (lifetime, founding-member pricing) | Tiered: free self-host, hosted subscription, or lifetime buyout | Self-hosted/PWA |
| Rise Budget | Subscription (trial then paid; exact figure not published) | No bank sync, desktop, privacy-first | Win/Mac |
| Banktivity | $59.99/yr+ | Has bank sync option, native Apple only | Mac/iOS only |

This is Nixus's real market: **$0–$50 one-time, or $36–$69/yr** for the paid tiers. Every player here uses a "founding price now, higher price later" tactic and leans one-time-purchase-first, subscription-second.

### Cluster C — Car maintenance apps (secondary module comp)

| App | Price | Model |
|---|---|---|
| Simply Auto | Free tier / Gold $9.99 one-time / Platinum $9.99/yr | Freemium + one-time + subscription tiers |
| Fuelio | Free / Pro $19.99/yr or $4.99/mo | Freemium + subscription |
| AUTOsist | $7–28/vehicle/month | Fleet-focused, not a personal-use comp |

Consumer car-maintenance tracking prices at **$10–$20/yr or a ~$10 one-time unlock** — well below finance-app pricing, as expected for a lower-frequency-use module.

---

## 3. Where Nixus Fits

Positioning Nixus against Cluster A (YNAB/Monarch/Copilot) would price it 3–5x above its true peer set for a product that, by design, doesn't offer bank sync, doesn't offer mobile, and is pre-alpha. Positioning against Cluster B is the honest comparison, and it's favorable: Nixus already matches or exceeds this cluster's feature depth (financial health intelligence, savings goals, budget templates, AI import) while most Cluster B apps are single-purpose trackers.

**Fit statement:** Nixus belongs in the **top third of Cluster B on price** ($35–$49 lifetime / low-$20s per year) once past beta, justified by: multi-module platform breadth, AI-assisted import (a feature most of Cluster B lacks entirely), and financial-health intelligence beyond passive tracking. It should not be priced near Cluster A ($100+/yr) without bank sync and mobile to justify that gap — attempting to would invite direct "why not just use Monarch" comparisons Nixus loses on ecosystem maturity (pre-alpha vs. established products).

**Update (2026-08-12) — post-differentiation-strategy revision:** Following the [product-brief addendum](../product-brief-addendum-mobile-cloud-differentiation-2026-08-12.md), three net-new capabilities (cross-module intelligence, life-checkup reports, and an optional Nixus Cloud sync tier) change *what* Nixus is charging for, but not the core positioning above — none of the three require moving into Cluster A's price range, because none of them require Cluster A's cost structure (bank sync, mobile-first infra, per-user AI subscription). See §4.6–4.8 below for the pricing impact of each.

---

## 4. Pricing Recommendation

Architecture is already committed to LemonSqueezy + Keygen with **per-module entitlements** and **lifetime one-time + monthly/yearly recurring** support (FR1/FR2 in the architecture doc). Recommendation works within that, not against it.

### 4.1 Per-module lifetime pricing (primary offer)

| Module | Founding price (pre-alpha/beta window) | Standard price (post-beta) | Anchors against |
|---|---|---|---|
| Finance | **$29** one-time | **$39** one-time | Sumhouse ($35→$50), MeasuredMoney ($49) |
| Car | **$15** one-time | **$19** one-time | Simply Auto Gold ($9.99), Fuelio |
| Bundle ("Nixus Complete", all current + future modules) | **$39** one-time | **$49** one-time | Ouriva lifetime ($99→$149, but Ouriva has hosting cost baked in — Nixus doesn't) |

Rationale for lifetime-first: Nixus's own cost structure (local SQLite, BYOK AI, no bank-sync infra) has near-zero marginal cost per user — the same reason every Cluster B competitor defaults to one-time pricing instead of subscription. Recurring revenue isn't structurally necessary the way it is for YNAB/Monarch (who pay per-user for Plaid connections).

### 4.2 Subscription as the secondary, not primary, option

Offer monthly/yearly per the architecture's FR1, but priced to make lifetime the obviously better deal (standard practice across every competitor reviewed):

- Finance: $4.99/mo or $34.99/yr (recovers lifetime price in ~14 months — pushes committed users toward lifetime)
- Car: $2.49/mo or $14.99/yr
- Bundle: $6.99/mo or $44.99/yr

### 4.3 Founding-price tactic (use the pre-alpha window)

Sumhouse and Ouriva both explicitly price low for their first N buyers, then raise and hold. Nixus is still pre-alpha per the README — this is the ideal window to run the same play: **advertise the founding price as time/quantity-limited, lock it permanently for who buys**. This directly supports the existing beta-tester recruitment effort (README's "Help shape Nixus" section) — early testers become the cheapest, most loyal cohort, and their price-lock becomes word-of-mouth material ("I got it for $29 before it went to $39").

### 4.4 Trial length

Category norm ranges 7–34 days; Nixus should offer **14–30 days full-feature trial, no card required** (matches Sumhouse's 14-day and Copilot's 30-day; avoids YNAB's higher-friction card-optional-but-generous 34-day since Nixus doesn't have YNAB's brand trust yet to justify that generosity).

### 4.5 Open item this analysis surfaces (flagged, not resolved)

The architecture doc explicitly left **device limit per license** as an unresolved pricing/product decision. Recommendation: **3 devices per license**, matching Sumhouse's model — generous enough for a personal multi-machine setup (home + laptop + maybe a partner's machine) without enabling casual sharing, and simple to state on the `/pricing` page.

### 4.6 Cross-module intelligence & life-checkup reports — no separate price

Both new differentiators (car-upkeep-cost-to-financial-health synthesis, printable life checkups) are pure local computation on data the core app already owns — **zero incremental infra cost to Nixus.** They should ship as part of the base Finance+Car lifetime price, not as a separate paid tier. Their role is to strengthen the *value story* at the existing $29–$49 lifetime price point (nobody else in Cluster B offers either), not to raise it. Gating them separately would fragment a feature that's cheap to deliver and expensive to explain.

### 4.7 Nixus Cloud — the one genuinely new pricing tier

Nixus Cloud (multi-device capture sync + push notifications for the mobile companion) is the first part of the product with **real ongoing marginal cost** (storage, bandwidth, push delivery, uptime) — unlike the core app, this legitimately justifies a subscription rather than a lifetime purchase.

Because Nixus Cloud only ever carries a transient capture queue and lightweight "reminder tickets" (never the financial ledger — see addendum §3.2), its cost footprint is lower than a full-ledger-sync competitor's, so it should price below the comparable managed-hosting tiers in Cluster B:

| Reference point | Price | Why Nixus Cloud can undercut it |
|---|---|---|
| Actual Budget managed hosting (PikaPods) | ~$36/yr | Syncs the full budget dataset continuously |
| Ouriva hosted tier | $39/yr → $69/yr at launch | Syncs the full ledger, self-host is the only free alternative |
| **Nixus Cloud (recommended)** | **$2.99/mo or $24.99/yr** | Only ever moves captures-in-transit + notification triggers, not the ledger |

Recommendation: **$2.99/mo or $24.99/yr**, opt-in, sold as an add-on on top of any owned module (no Cloud-only purchase — it has nothing to sync without at least one core module). Frame the pricing-page copy explicitly around what it does *not* store, since that's the differentiator against every Cluster A competitor's "sync" (which means "we hold your full financial history").

### 4.8 Advisor / accountant channel — B2B2C lever, not a consumer price change

Not a consumer-facing price point — a distribution channel. Recommendation once the advisor license type is scoped (flagged as an open item in the product-brief addendum): a **per-client bulk rate** for advisors managing multiple clients, e.g. $19/client/yr (vs. $39 standard lifetime or the yearly-alt price) as a volume incentive, keeping the advisor's economics simple ("recommend Nixus, we both benefit") without touching the core module pricing above. This should not be finalized until the entitlements architecture defines how advisor-assigned licenses actually work.

---

## 5. Summary Table for the Pricing Page

| | Finance | Car | Complete Bundle | Nixus Cloud (add-on) |
|---|---|---|---|---|
| Founding lifetime price | $29 | $15 | $39 | — |
| Standard lifetime price (post-beta) | $39 | $19 | $49 | — |
| Monthly | $4.99 | $2.49 | $6.99 | $2.99 |
| Yearly | $34.99 | $14.99 | $44.99 | $24.99 |
| Devices per license | 3 | 3 | 3 | n/a (per-account sync) |
| Trial | 14–30 days, no card | 14–30 days, no card | 14–30 days, no card | bundled with core trial |

Advisor/accountant channel pricing intentionally excluded from this table — B2B rate, not a self-serve `/pricing` line item, pending entitlements architecture for advisor-assigned licenses (§4.8).

---

## 6. Confidence & Caveats

- Pricing data for Cluster A/B/C is web-search-verified as of August 2026 (search results self-report checks as recent as June–July 2026 for several sources).
- Rise Budget's exact subscription price wasn't published on its marketing site at time of research — flagged as an open gap, not assumed.
- Nixus Cloud's $2.99/mo figure is a comparative estimate against Cluster B's hosted-tier pricing, not a bottoms-up infra cost model — validate against actual push-notification/storage cost at expected user volume before this goes live.
- This is a pricing **recommendation**, not a validated one — no user willingness-to-pay research has been run on Nixus's actual beta cohort yet. Given the README's own stated goal for this pre-alpha window ("learn whether anyone besides the builder would actually use it"), consider validating the $29/$39 Finance price point informally with current beta testers before it goes live on `/pricing`.
</content>
