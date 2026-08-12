---
stepsCompleted: [1]
status: complete
document_type: 'product-brief-addendum'
supersedes: null
amends:
  - product-brief-nkbaz-finance-2026-03-14.md
relatedDocuments:
  - _bmad-output/planning-artifacts/research/pricing-model-competitive-analysis-2026-08-12.md
  - _bmad-output/planning-artifacts/architecture-entitlements-licensing.md
  - _bmad-output/planning-artifacts/architecture-login.md
date: 2026-08-12
author: dev
---

# Product Brief Addendum — Cross-Module Intelligence, Advisor Channel, Life-Checkup Reports & Nixus Cloud

_This addendum captures a strategy discussion held 2026-08-12 on market differentiation and the mobile-companion vision. It does not replace [product-brief-nkbaz-finance-2026-03-14.md](product-brief-nkbaz-finance-2026-03-14.md) — that document's original MVP scope (web-only, single-user) is historical and already superseded by the desktop pivot and current [PRD](prd.md). This addendum records net-new strategic direction that should inform future architecture and PRD work: differentiation strategy, the mobile companion's actual shape, and the local-core/cloud-optional data model that makes it possible without abandoning the local-first promise._

---

## Context: Why This Addendum Exists

Competitive analysis ([pricing-model-competitive-analysis-2026-08-12.md](research/pricing-model-competitive-analysis-2026-08-12.md)) concluded Nixus should not compete head-on with cloud-first, bank-synced incumbents (YNAB, Monarch, Copilot) — it structurally can't win that fight as a pre-alpha, solo-built, no-bank-sync desktop app. Instead, differentiation should come from capabilities those incumbents can't copy without abandoning their own business model. Three such ideas were selected for adoption; a fourth conversation refined how the mobile companion should actually work.

---

## 1. Selected Differentiators

### 1.1 Cross-Module Intelligence

**What it is:** Nixus is the only product in its category that owns both a personal-finance module and a life-maintenance module (Car today, more later). No competitor — YNAB, Monarch, Copilot, Actual Budget, Simply Auto, Fuelio — spans both domains, so none can connect life-upkeep costs to financial health.

**Concrete capability:** Surface statements like *"Your Civic's timing belt is due next month — approximately $800. That will drop your emergency-fund coverage from 2.4 to 1.6 months."* This is computed entirely from data Nixus already has (car maintenance schedule + cost history, financial health evaluator, emergency fund coverage) — no new data source, no cloud dependency. It is a synthesis feature across the existing `maintenance/evaluator.rs` and `financial_health/evaluator.rs` domains.

**Why it's defensible:** A single-domain competitor cannot build this without also owning the other domain. It converts the "modular life OS" framing already in the README from marketing language into a demoable, differentiated feature.

### 1.2 Advisor / Accountant Channel

**What it is:** A B2B2C distribution channel targeting Canadian fee-only financial planners and accountants, who can hand Nixus to clients as a "homework tool between sessions" instead of a spreadsheet.

**Why it matters for a solo builder:** Nixus cannot out-spend or out-SEO YNAB/Monarch for direct acquisition (confirmed by the [Canadian market research](research/market-canadian-pf-mint-alternatives-research-2026-06-09.md) — Mint-alternative SEO is saturated with affiliate listicles). An advisor channel turns trusted professionals into a sales force without ad spend.

**Mechanism (future architecture input):** The entitlements/licensing system already being architected ([architecture-entitlements-licensing.md](architecture-entitlements-licensing.md)) is the natural home for this — an advisor-assigned license type, distinct from a self-serve LemonSqueezy purchase, issued by an advisor to their client. Not scoped for MVP of licensing; flagged here so it's on record before that architecture is considered "final."

### 1.3 Printable "Life Checkup" Report

**What it is:** A periodic (monthly/quarterly) PDF combining financial health status, net worth trend, and upcoming car/life-maintenance costs into one printable, shareable document.

**Why it fits the audience:** The validated Nixus persona (spreadsheet trackers, privacy-conscious, skeptical of "just another dashboard") values something tangible and ownable — a document to print, file, or hand to a partner or advisor without granting app access. This is purely local generation from data already in the app; no cloud dependency required.

---

## 2. Mobile Companion — Refined Vision

### 2.1 What it is NOT

Not a mobile-first budgeting app competing with YNAB/Monarch/Copilot on cross-device convenience. Nixus loses that fight structurally (no bank sync, no years of mobile polish, solo builder).

### 2.2 What it IS

A **capture and notification bridge between a user's active life and their desktop app** — the phone captures moments as they happen and notifies proactively; the desktop remains the canonical source of truth and does all the actual computation and storage.

**Capture-in-the-moment:**
- Photograph a receipt/CC statement the moment it's received — queued, AI-processed on next sync, instead of relying on the user to batch statements later (the #1 reason manual-import tools lose users to abandonment)
- Quick voice/manual expense log
- Odometer + fill-up photo at the pump, service receipt photo at the shop — feeds the Car module directly
- Glovebox document vault (insurance card, registration, warranty) — snap once, attach to the vehicle/asset record

**Proactive alerts:**
- Car maintenance due (mileage/date threshold)
- Budget category running hot mid-month
- Upcoming large/recurring expense (insurance renewal, annual subscription)
- Financial Health "next best action" weekly nudge
- Savings project pace ("behind schedule to hit your goal by date X")

**Passive surfaces:** home-screen widget (budget remaining, next car service, net worth trend), lock-screen digest notification.

**Deferred / lower priority:** location-aware nudges (gas station, known shop — local-only geofencing, never server-tracked), read-only AI chat on the go, second-device capture for a partner feeding one canonical desktop DB (a scoped answer to the README's stated "single-user only" limitation, without a full multi-user rearchitecture).

---

## 3. Data Model: Local Core + Optional "Nixus Cloud"

This is the architectural decision that makes the mobile companion possible without breaking the local-first promise that the target segment (per market research) actively cares about.

### 3.1 The Split

| | Core app (Finance, Car, future modules) | Nixus Cloud (optional add-on) |
|---|---|---|
| **What it holds** | The full ledger — every transaction, budget, account, net worth number | Transient capture queue + lightweight "reminder tickets," never the ledger itself |
| **Required?** | No — fully functional standalone, as today | No — opt-in only |
| **Ongoing cost to Nixus** | ~Zero (local SQLite, BYOK AI) | Real (storage, bandwidth, push delivery, uptime) |
| **Pricing model** | One-time lifetime purchase (see pricing doc) | Subscription — this is the one part of the product with genuine ongoing cost, so a subscription here is an honest price, not an upsell-for-upsell's-sake |

### 3.2 The "Reminder Ticket, Not Record" Pattern

To keep the claim "your financial ledger never has to touch a server" true rather than aspirational, Nixus Cloud should carry the minimum possible information:

- Desktop computes locally (budget status, maintenance due dates, financial-health nudges — no change to where intelligence lives)
- Desktop pushes an opaque instruction to the cloud, e.g. *"fire a push notification for device X at time Y with message Z"* — not the underlying financial record that produced it
- The captures queue (photos/voice notes awaiting sync) is transient — cleared once synced to a desktop, not a permanent cloud copy of user data

This means **cross-module intelligence (§1.1) requires zero cloud** — it is pure local computation. Cloud is a delivery/sync convenience layer only. This distinction should be stated explicitly in future marketing copy, since it is a real technical fact backing the privacy claim, not just an assertion.

### 3.3 Existing Foundation

The desktop app already has a fully implemented Cognito login (`commands/auth.rs`, email/password + Google federation), currently deliberately decoupled from every other feature — signing in gates nothing today ([architecture-login.md](architecture-login.md)). Nixus Cloud is very likely the feature that login was always going to end up serving: an account to *opt into* for sync, never an account required to use the app. This means less net-new identity architecture is needed than it would first appear — the amendment note already in `architecture-login.md` regarding this decoupling should be revisited once Nixus Cloud is scoped for architecture work.

---

## 4. Open Items for Future Architecture / PRD Work

- Advisor-assigned license type is not yet scoped in `architecture-entitlements-licensing.md` (FR1-FR6 cover self-serve LemonSqueezy purchase only) — needs its own FR/decision pass before advisor channel (§1.2) can be built
- Nixus Cloud pricing (subscription tier/amount) is not yet numbered — should be added to the pricing doc's summary table once cloud infra cost is estimated
- Second-device/partner capture (§2.2, deferred) implies a scoped multi-writer model against one canonical desktop DB — needs its own architecture decision when prioritized, distinct from a full multi-user rearchitecture
- Life-checkup report (§1.3) format/frequency/export path (PDF generation library, print vs. email) not yet decided — local-only generation is the one constraint already set
