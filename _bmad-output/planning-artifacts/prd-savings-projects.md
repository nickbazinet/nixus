# PRD: Savings Projects

**Project Type:** Desktop App (Tauri, local-first) · **Domain:** General (personal finance tracking — no regulated payments/KYC, no real money movement)

## 1. Executive Summary

Nixus users who track finances manually have no way to earmark savings toward a specific goal (car, vacation, big purchase) without leaving the app or fudging a spreadsheet column. Savings Projects lets a user create a named goal with a target amount and date, log contributions from any existing account without moving real money, see progress visually, and — once their emergency fund and debt are handled — get an opt-in suggested monthly allocation of their surplus across active projects. Differentiator vs. Qapital/Digit/YNAB Targets: allocation math is transparent and always user-confirmed, never a silent auto-transfer, because Nixus has no bank connection to move money through in the first place.

## 2. Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC1 | User can create a project and see progress within 3 clicks from the Wealth section | Manual click-count test |
| SC2 | Account balance never changes as a side effect of project contributions | Contribution create/delete leaves `accounts.balance_cents` untouched (DB assertion in tests) |
| SC3 | Suggested allocation only appears when emergency fund + debt steps are complete | `get_suggested_allocation` returns empty/null when `WaterfallStep` is `BuildEmergencyFund` or `PayHighInterestDebt` |
| SC4 | A user with 3 active projects and one account can view "unallocated vs. earmarked" split without manual math | Breakdown bar renders 4 segments (unallocated + 3 projects) summing to account balance |
| SC5 | Suggested allocation is never auto-applied | 100% of suggested contributions require explicit confirm action to persist a `project_contributions` row |

## 3. Product Scope

**MVP**
- Create/edit/archive a Project (name, target amount, target date, priority, icon/color)
- Manually log a contribution to a project, sourced from a specific existing account
- View project progress (saved / target, remaining, % complete, pace-to-date projection)
- View per-account earmark breakdown ("$10k in Account A: $3k Project B, $1k Project C, $6k unallocated")
- `/wealth/projects` list page + one dashboard summary card

**Growth**
- Opt-in "Suggested Monthly Allocation" flow gated on waterfall step, with editable per-project amounts before confirming
- Multi-project priority ranking + deadline-aware default split weighting
- Milestone visual states (25/50/75/100%) on the project card
- AI chat awareness of projects ("will I hit my car goal by June?")

**Vision (explicitly out of scope for now)**
- Real bank transfers / moving money between accounts
- Non-financial goals (fitness, habits) — would require a standalone module, not a Wealth sub-surface
- Shared/multi-user projects

## 4. User Journeys

| Journey | Steps | Maps to FR |
|---|---|---|
| Create a goal | Wealth → Projects → New → name, target, date, priority | FR1, FR2 |
| Log savings toward a goal | Project detail → Add Contribution → pick source account + amount | FR3, FR4 |
| See the split at a glance | Accounts page → account row shows earmark breakdown bar | FR5 |
| Get help deciding how much to save this month | Dashboard nudge (only when eligible) → review per-project suggested amounts → edit → confirm or skip | FR6, FR7, FR8 |
| Reprioritize when goals compete | Projects list → drag to reorder priority | FR9 |

## 5. Domain Requirements

None — general personal-finance domain, no PCI/KYC/AML applicability since no payment processing or real money movement occurs. Standard local-first data-integrity requirements apply (see NFRs).

## 6. Innovation Analysis

Competitors (YNAB Targets, Qapital, Digit, Monarch, Copilot) ship either a static progress bar with no automation, or automation that's a trust-eroding black box because it actually moves money. Nixus's local-first, no-bank-sync constraint turns into the differentiator: allocation suggestions are computed from data the user already trusts (surplus, waterfall step) and are never applied without explicit confirmation — the "cool" factor comes from transparent math (visible per-project breakdown, deadline-aware pacing) rather than gamification for its own sake.

## 7. Project-Type Requirements (Desktop App)

- Works fully offline — all computation and storage local (SQLite), consistent with existing modules
- New DB objects added via a numbered migration in `migrations/`, registered in the existing migration array
- UI ships within the existing Finance `Wealth` destination — must respect the app's fixed 4-destination × 5-sub-surface navigation limit (no new top-level rail module for MVP)
- Reuses existing design system components (metric card, meter/badge pattern, stacked breakdown bar) rather than introducing new primitives

## 8. Functional Requirements

| ID | Requirement | Test Criteria |
|---|---|---|
| FR1 | Users can create a project with a name, target amount, optional target date, and priority rank | Project persists and appears in `/wealth/projects` list immediately after save |
| FR2 | Users can edit or archive an existing project | Archived projects are hidden from active lists and allocation suggestions but retain history |
| FR3 | Users can log a manual contribution to a project, specifying a source account and amount | Contribution appears in project history; source account's `balance_cents` is unchanged |
| FR4 | Users can delete a logged contribution | Project's saved total decreases by the deleted amount; account balance unchanged |
| FR5 | Users can view, per account, how its balance splits into unallocated and per-project earmarked amounts | Sum of all segments equals the account's `balance_cents` for every account with ≥1 contribution |
| FR6 | The system computes a suggested monthly allocation across active projects, but only when the user's current waterfall step is `ContributeRegisteredAccounts` or `InvestSurplus` | No suggestion is returned/displayed for any earlier waterfall step |
| FR7 | Users can edit each project's suggested amount before confirming, with the total capped at the available monthly surplus | UI blocks confirm if edited total exceeds surplus amount |
| FR8 | Confirming a suggestion creates one `project_contributions` row per project with `source = suggested`; skipping creates none | No DB writes occur unless the user explicitly confirms |
| FR9 | Users can reorder active projects by priority, which changes the default suggested-split weighting | Suggested split for the same surplus amount changes when priority order changes |
| FR10 | The dashboard displays a single summary card showing total saved across all active projects | Card renders on `/` (Finance Today) and updates after any contribution change |

## 9. Non-Functional Requirements

- NFR1: Project and contribution CRUD operations complete in under 100ms on the local SQLite store, as measured by existing command-timing patterns used elsewhere in the app.
- NFR2: All monetary values stored and computed as integer cents (matching existing `_cents` convention) to avoid floating-point rounding errors, verified by code review against existing models.
- NFR3: Deleting an account with existing project contributions is blocked or requires explicit reassignment/deletion of those contributions first, verified by a foreign-key constraint or an explicit guard in the delete-account command.
- NFR4: The suggested-allocation computation must not persist any data until user confirmation, verified by an integration test asserting zero `project_contributions` rows are written by the suggestion-generation command itself.

---

**Handoff note for Architecture:** Key implementation-informing decisions already made during brainstorming (see conversation) — new `projects` + `project_contributions` tables (FK pattern mirrors migration 021's `account_id` FK on expenses/income); ship at `/wealth/projects` (one open slot in `navigation.ts`'s Wealth destination); reuse `NetWorthBreakdownBar` for the earmark split visualization and `BudgetCategoryRow`'s meter/badge pattern for per-project progress; gate suggestions on `financial_health::evaluator::WaterfallStep`.
