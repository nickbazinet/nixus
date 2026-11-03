---
title: AI-Generated Home Dashboard
status: final
created: 2026-11-02
updated: 2026-11-02
---

# PRD: AI-Generated Home Dashboard

## 0. Document Purpose

This PRD defines a new **Home** surface for the Nixus desktop app: an AI-first page where the user describes, in plain language, the dashboard they want ("show me my net worth growth month over month"), and the app renders it from a safe, declarative description the AI produces — not executable code. It is written for whoever picks this up next (the author, or a future contributor) and for the downstream BMAD workflows (`bmad-architecture`, `bmad-create-epics-and-stories`) that will turn it into a build plan. Terms are defined once in §3 (Glossary) and used verbatim everywhere else. Inline `[ASSUMPTION: ...]` tags mark places where a judgment call was made without explicit confirmation; all are indexed in §9. Protocol-mechanism detail (JSON shape sketches, the A2UI/CopilotKit prior art this borrows from, alternatives considered) lives in `addendum.md` alongside this document — this PRD stays at the capability level.

This builds on functionality that exists today, but not as uniformly as "already built" implies — see §4.1 and §4.3 for an honest split of reuse vs. new work. Two existing pipelines are relevant and are *separate mechanisms*, not one: a read-only query pipeline in `apps/desktop/src-tauri/src/ai/chat.rs` (the ` ```tool_call ``` ` fence, used for `query_expenses` etc.), and a closed, confirm-then-persist write-action pipeline spanning `apps/desktop/src-tauri/src/commands/chat.rs` (`ACTION_TYPES`, server-side enforcement) and `apps/desktop/src/components/chat/ChatMessageBubble.tsx` (the ` ```action ``` ` fence, client-side parsing) plus its `apps/desktop/src/lib/chatActions.ts` mirror (`CHAT_ACTION_TYPES`). §4.3 states which of the two this feature extends. No new AI backend-selection path is introduced — hosted/BYO routing still goes through `apps/desktop/src-tauri/src/ai/backend.rs`, with one deliberate exception stated in §4.6: this feature is Nixus Cloud premium-only and does not fall back to BYO, by explicit decision, the same way statement import is already Bedrock-only today.

## 1. Vision

Nixus users today get a fixed dashboard — budget, net worth, cash flow, assembled by the app, identical for everyone. This feature replaces "fixed" with "asked for": a user opens a new **Home** page, types what they want to see, and the AI assembles a dashboard from it — built from the user's own financial data, shaped by the user's own words. The next time they log in, that dashboard is already there, exactly as they left it.

The core tension this solves: an LLM that can build "whatever the user likes" is normally either boring (a fixed menu of pre-built widgets) or dangerous (the model emits live code that runs with the app's own database access). Nixus resolves this the way Google's A2UI protocol and CopilotKit's custom-catalog pattern do: the AI never emits code or raw numbers *into the structure it returns*. It emits a **declarative description** — which known component, bound to which known data source — and the app, not the model, is the only thing that ever touches real financial data or executes anything. The model gets creative freedom over structure and composition; it never gets a code path into the user's data.

**Scope of the privacy claim, stated precisely:** the app-supplied half of every generation request — the Component Catalog, the Data Source Whitelist, and their schemas — never contains real financial figures (§4.2). This is a real and meaningful constraint on what Nixus itself puts in front of the model. It does **not** mean the request is figure-free end to end: the user's own prompt is free text and can contain anything the user types (including a dollar amount, if they type one), and the AI's own output includes a small free-text channel — Widget titles — the model authors itself. Both of those travel like any other Nixus AI feature: per the existing "content of that one request" boundary, not as some new, stronger guarantee. §4.2 and §4.3 state this precisely so it is not oversold.

## 2. Target User

### 2.1 Jobs To Be Done

- As a Nixus user, I want to describe a dashboard view I care about in my own words, so I don't have to wait for the app to build the exact widget I want.
- As a Nixus user, I want that dashboard to still be there the next time I open the app, so I don't have to re-ask every session.
- As a Nixus user, I want to refine what I asked for by just talking to the AI again, so adjusting my dashboard feels like a conversation, not a settings screen.
- As a privacy-conscious Nixus user, I want assurance that the *app itself* never hands the AI my actual balances or transactions just to decide what a chart should look like — only the data a chart needs is resolved locally, after the AI has already decided the chart's shape. (This does not cover what the user chooses to type into the prompt themselves, which is unconstrained free text like any other Nixus AI chat message — see §1.)

### 2.2 Non-Users (v1)

- Users wanting the AI to render UI outside the finance domain (e.g. Car-module widgets) — v1 is finance-only, matching the existing data domains already queryable today. [ASSUMPTION: Car-module data sources are out of scope for v1, even though Home is now a first-level nav item at `/home` (§4.5) rather than nested under Finance.]
- Users wanting multiple independently named/saved dashboards, or sharing a dashboard with another device/user — Nixus is single-profile, local-first; v1 is one Home surface per local profile.
- Users wanting to manually drag/resize/delete widgets outside of asking the AI — conversational editing only in v1 (explicit decision, §5/§6.2).
- **Non-premium Nixus users.** By explicit decision, this feature is Nixus Cloud premium-only (§4.6). A free/BYO-only user does not get a working Dashboard Composer, regardless of whether they have their own AI provider configured — this is a monetization boundary, not a technical limitation. (Already-built Widgets, if premium later lapses, are a distinct question — see §4.6's FR-11 consequences.)

### 2.3 Key User Journeys

*Protagonists are intentionally generic ("a user"), not named personas — Nixus is a single-profile, single-archetype app, and inventing a persona here would be ceremony without signal.*

- **UJ-1. First-time ask.** A user opens the new **Home** destination for the first time and sees an empty state with an AI composer ("Ask for a dashboard view…"). They type "show me my net worth growth month over month." The AI responds, a line chart of net worth by month appears below the composer, and the page confirms it was saved. **Edge case:** if the AI is unavailable (BYO not configured, hosted quota exhausted), the composer explains why and the empty state persists — the rest of the app is unaffected (per existing AI-degrades-gracefully rule).
- **UJ-2. Returning user sees their own dashboard.** A user who built a Home dashboard last week opens the app. Home loads directly to their previously generated layout — no AI call needed, no re-asking — fed with today's live data, not the numbers from when it was built.
- **UJ-3. Conversational refinement.** A user with an existing Home dashboard asks, "also show my top spending categories this month," and a new widget is added alongside the existing ones. They then say "remove the spending categories one" and, after a brief confirmation step naming the specific Widget matched, it disappears.
- **UJ-4. Malformed generation self-heals.** A user asks for something the AI mis-describes on the first attempt (e.g. a chart bound to a data source that doesn't exist in the whitelist). The app detects the invalid output before anything renders, and the AI gets one corrective turn with the specific validation error. If it still can't produce a valid result after a bounded number of attempts, the user sees a plain "couldn't build that one" message — the existing dashboard (if any) is untouched, and nothing broken ever reaches the screen.

## 3. Glossary

- **Home Surface** — The single, per-profile collection of Widgets that makes up a user's Home dashboard. One Home Surface per local Nixus profile in v1.
- **Widget** — One rendered unit on the Home Surface: a specific Catalog Component bound to a specific Data Source (e.g. "a LineChart bound to net-worth-by-month"). A Home Surface is composed of zero or more Widgets arranged by Layout Primitives.
- **Component Catalog** — The closed, app-defined set of UI building blocks the AI is allowed to use when composing a Widget (§4.1). The AI can only reference a Catalog Component by name — it cannot invent a new one.
- **Catalog Component** — A single entry in the Component Catalog; either a **Display Component** (data-bearing: Metric, LineChart, BarChart, AreaChart, PieChart, Table) or a **Layout Primitive** (structural, no data: Card, Row, Column, Grid).
- **Layout Primitive** — A structural Catalog Component used to arrange other Catalog Components within a Widget or across the Home Surface; carries no Data Binding.
- **Data Source** — One entry in the whitelisted, app-defined list of queries a Widget may bind to (e.g. "expenses by month," "net worth history") (§4.2). The AI selects a Data Source by name; it never writes a query itself.
- **Data Binding** — The reference inside a generated Widget description that names which Data Source (and its parameters, e.g. "last 6 months") feeds that Widget. The binding travels through the AI; the actual resolved values never do.
- **Dashboard Composer** — The natural-language input on the Home page through which the user asks for, or revises, their Home Surface.
- **Surface Validation** — The app-side check that a freshly generated Home Surface description only references real Catalog Components, real Data Sources, well-formed parameters, and no literal data value in a Data Binding, run before anything is persisted or rendered.
- **Self-Healing Retry** — A bounded, automatic follow-up turn in which a Surface Validation failure is reported back to the AI so it can correct its own output, before falling back to a graceful failure message.

## 4. Features

### 4.1 Component Catalog (v1)

**Description:** The closed set of building blocks the AI may compose a Home Surface from. Modeled on the A2UI / CopilotKit custom-catalog pattern: each Catalog Component has a name, a description (which goes into the AI's instructions so it knows when to use it), and a schema for its allowed properties. The AI can only ever reference a Catalog Component that exists in this catalog — anything else is rejected by Surface Validation (FR-4). Realizes UJ-1, UJ-3.

**Build-cost honesty** (this PRD is chain-top; story sizing depends on this being accurate, not aspirational):
- **Reusable today, as-is:** Table (`packages/shared/src/ui/table.tsx`) and Metric (built on the existing `Stat`/`SubStat` primitives in `packages/shared/src/ui/stat.tsx`, already composed into `DashboardMetricCard.tsx`).
- **Needs extraction from existing domain components, not a straight reuse:** LineChart, BarChart, and AreaChart. Today these exist only as three bespoke, single-purpose chart components — `NetWorthTrendChart`, `SpendingTrendChart`, `ProjectionChart` — each hardcoded to one domain's data shape. Generalizing them into series-agnostic, Data-Binding-driven primitives is real work, not registration.
- **New, built from scratch:** PieChart. It does not exist anywhere in the current codebase.

**Functional Requirements:**

#### FR-1: Display Components available to the AI

The AI can compose a Widget using any of: **Metric**, **LineChart**, **BarChart**, **AreaChart**, **PieChart**, **Table**. ("PieChart" is the single canonical catalog name — not "PieChart/Donut" — since Surface Validation matches `component` against the catalog by exact name.) Realizes UJ-1.

**Consequences (testable):**
- A generated Home Surface referencing any of these six Catalog Component names, with a valid Data Binding, passes Surface Validation.
- A generated Home Surface referencing any Catalog Component name outside this set fails Surface Validation (FR-4) and never renders.

#### FR-2: Layout Primitives

The AI can arrange Widgets and Display Components using **Card**, **Row**, **Column**, and **Grid** containers, with no data of their own. Realizes UJ-1.

**Consequences (testable):**
- A Home Surface with nested Row/Column/Grid containers around Display Components renders in that nested arrangement.
- A Layout Primitive is rejected by Surface Validation if it carries a Data Binding (it is structural only).

**Feature-specific NFRs:**
- A Home Surface accepts at most a fixed, bounded number of Widgets. [ASSUMPTION: cap is 12 Widgets per Home Surface — a round number chosen to keep Home open-time bounded (§4.4) and to give SM-C1's "don't chase Widget count up" counter-metric an actual ceiling to sit under; exact number is a build-time tuning decision, not re-litigated here.] A generation or edit that would exceed the cap fails Surface Validation with a specific "too many widgets" error, which is eligible for the Self-Healing Retry (FR-5) the same as any other validation failure.

### 4.2 Data Source Whitelist (v1)

**Description:** The closed set of queries a Widget may bind to. v1's seven Data Sources are chosen on their own merits — broad coverage of the finance data model that already exists and is already queryable (expenses, budget, accounts, assets, net worth, income) — not because they mirror the static dashboard at `/` one-for-one. (They don't: the static dashboard surfaces account balances and assets only indirectly via links/folded summaries, and additionally surfaces financial-health, savings-projects, and year-to-date cards that are out of scope for this whitelist; this whitelist instead surfaces account balances and assets as first-class, directly queryable sources, since a user is more likely to *ask* for "my accounts" as a direct widget than to want the static dashboard's composite cards reproduced verbatim.) Covers: expenses by month, expenses by category, net worth history, budget vs. actual by category, income vs. expense by month, account balances, and asset values. Each Data Source has a name, a description (for the AI's instructions), and the parameters it accepts (e.g. a month range). Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-3: Whitelisted financial Data Sources

A Widget's Data Binding can reference any of the v1 Data Sources listed above, with parameters appropriate to that source (e.g. a lookback window in months). Realizes UJ-1.

**Consequences (testable):**
- A Data Binding naming a Data Source outside the whitelist fails Surface Validation and never resolves.
- A Widget's rendered *data values* always come from resolving its Data Binding against live app data at render time — never from a literal value embedded in the AI's generated output. [ASSUMPTION: this rule is scoped to data-carrying properties only — specifically `dataBinding` and any property documented as data-bearing in a Catalog Component's schema. It is explicitly **not** applied to a Widget's free-text `title`, which the AI authors itself and which may contain any text, including a number the user asked about by name (e.g. "Dining Spend vs. $500 Budget"). Surface Validation checks `dataBinding`-shaped fields for literal values; it does not scan free-text fields for numbers.]

**Feature-specific NFRs:**
- The AI's generation prompt includes only Data Source *names, descriptions, and parameter shapes* from the app side — never actual account balances, transaction amounts, or other real figures supplied by Nixus. **Testable:** for a seeded profile with non-trivial data, the outbound generation request contains no string or numeric value that matches a value in that profile's expense, account, asset, budget, or net-worth tables. This holds under both the hosted-AI and BYO-AI paths. It is a constraint on what *Nixus supplies*; it is not a constraint on the user's own prompt text (§1), which is unconstrained and transmitted like any other Nixus AI chat message.

### 4.3 Dashboard Composer & Generation Flow

**Description:** The natural-language entry point on the Home page, and the flow from a user's request to a rendered, persisted Widget. This extends the **confirm-then-persist write-action pipeline** — `ACTION_TYPES` in `commands/chat.rs` plus the ` ```action ``` ` fence parsed in `ChatMessageBubble.tsx` and mirrored by `CHAT_ACTION_TYPES` in `chatActions.ts` — not the separate read-only `tool_call` query pipeline in `ai/chat.rs`. This is the closer analog because a Home Surface change is a persisted mutation, the same shape as `create_expense` et al., and it means a Widget change appears behind a lightweight confirmation step (a card naming what will be added/changed/removed) the same way any other chat-originated mutation does today — rather than applying immediately and silently. Generation itself routes through hosted AI **only** — see §4.6 for why this feature does not use the standard hosted/BYO fallback that the rest of chat uses. Realizes UJ-1, UJ-2, UJ-3, UJ-4.

**Functional Requirements:**

#### FR-4: Generate a Home Surface from natural language

A user can type a request into the Dashboard Composer, and the AI responds with a proposed Home Surface change (an `action_type` added to the existing closed set) composed from the Component Catalog (FR-1, FR-2) and Data Source Whitelist (FR-3), shown to the user as a confirmation card before anything is persisted. Realizes UJ-1.

**Consequences (testable):**
- Every AI-generated Home Surface change is run through Surface Validation before a confirmation card is ever shown.
- A description that fails Surface Validation never reaches the confirmation-card stage in that state.

#### FR-5: Self-healing retry on invalid generation

When Surface Validation fails, the specific validation error is given back to the AI for one corrective attempt before falling back to a graceful failure. Realizes UJ-4.

**Consequences (testable):**
- Generation is capped at 2 attempts total per user request (1 initial + 1 corrective retry). [ASSUMPTION: this specific cap is a settled decision for v1, not a re-litigated Open Question — chosen primarily to bound hosted-AI quota consumption per request under the existing per-invocation quota model (each attempt is one `ConverseStream` invocation per the hosted-AI cost model). It is cheap to raise later if the first-attempt pass rate (SM-1) turns out low.]
- If both attempts are exhausted, the user sees a plain failure message in the Composer; the Home Surface's existing Widgets (if any) are left exactly as they were before the request.

#### FR-6: Conversational add, modify, and remove

A user can follow up in the Dashboard Composer to add a new Widget, modify an existing one, or remove one, without having to re-describe the whole Home Surface. Realizes UJ-3.

**Consequences (testable):**
- **Add:** a follow-up request that only adds a Widget leaves every other existing Widget on the Home Surface unchanged.
- **Modify:** a modify request is a full replace of the targeted Widget's description, but preserves that Widget's `id` and its position within the Layout — so "make that a bar chart instead" changes the Catalog Component and/or Data Binding while the Widget stays in the same place in the arrangement. It is not an in-place patch of individual properties; the AI re-emits the whole Widget description for the one Widget being changed.
- **Remove:** a follow-up naming an existing Widget for removal is resolved against the current Home Surface's Widgets by a best-effort match on title/content; if exactly one Widget matches, its removal is proposed via a confirmation card (FR-4's pipeline) before anything is deleted; if zero or more than one Widget plausibly matches, no deletion is proposed and the Composer asks the user to be more specific, naming the ambiguous candidates by title.
- No Home Surface change (add, modify, or remove) is applied without the confirmation step — there is no silent-and-immediate mutation path, which is the main mitigation for a wrong-target removal.

**Feature-specific NFRs:**
- A single generation round-trip (initial attempt plus the one allowed Self-Healing Retry) is bounded by a fixed time budget. [ASSUMPTION: 20 seconds end-to-end, matching the general expectation that an AI chat turn elsewhere in Nixus resolves within that order of magnitude; exceeding the budget surfaces the same graceful-failure message as exhausted retries (FR-5), not an indefinite spinner.]

#### FR-7: Graceful degradation when hosted AI is transiently unavailable

For an already-premium user, if hosted AI is temporarily out of quota or the service is erroring, the Home page still renders the user's last-persisted Home Surface with live data; only the Composer's ability to generate or modify is affected for that moment. This is distinct from, and does not overlap with, the premium-gating behavior in §4.6 FR-11 — FR-7 covers a premium user hitting a transient hosted-AI problem; FR-11 covers a user who isn't premium at all. Realizes UJ-4.

**Consequences (testable):**
- Opening Home with hosted AI transiently unavailable still renders all previously persisted Widgets with current data, for a premium user.
- The Composer surfaces the same kind of recoverable/non-recoverable distinction `AppError::HostedAi` already gives the rest of the app (via its `recoverable: bool`, mirrored by `hostedAiIsRetryable` in `src/lib/appError.ts`) — never a generic failure.

**Feature-specific NFRs:**
- This flow routes through the existing `ai/backend.rs` port for its hosted call, but — per §4.6 — never reaches the port's BYO fallback branch for a `premium_required` outcome, which is the one deliberate deviation from the port's general fallback behavior.

### 4.4 Persistence & Reload

**Description:** The Home Surface a user builds must survive restarts and be there, unchanged in structure, on every subsequent login — fed with current data, not a snapshot of the data at creation time. Realizes UJ-2.

**Functional Requirements:**

#### FR-8: Persist the Home Surface per local profile

The Home Surface (its Widgets, their Catalog Component + Data Binding descriptions, and their layout) is saved locally and reloaded automatically when the Home page is opened. Realizes UJ-2.

**Consequences (testable):**
- Closing and reopening the app shows the same Widgets, in the same arrangement, without any new AI call.
- Each Widget's displayed values reflect live data at the time Home is opened, not the data available when the Widget was generated.

**Feature-specific NFRs:**
- Opening Home and resolving every persisted Widget's Data Binding against local SQLite is bounded by a fixed time budget. [ASSUMPTION: 1 second for a Home Surface at the FR-2 cap (12 Widgets) on typical local data volumes; this is a tuning target for the query layer, not re-litigated here.]

#### FR-9: Audit trail for Home Surface changes

Every create/modify/remove of a Widget is audit-logged, consistent with the existing create/update/delete audit pattern used elsewhere in Nixus (`db/audit.rs`'s `audit::record`, writing old/new values to the `audit_log` table). This requires enrolling the Home Surface entity in the existing `AUDITED_TABLES` registry — a registry addition, not something that comes free. Realizes UJ-3.

**Consequences (testable):**
- A Home Surface change (add, modify, remove) produces one audit log entry capturing the prior and new state, the same shape as existing domain audit logging.

### 4.5 Navigation & Placement

**Description:** Resolved. "Home" is a fourth, top-level rail item at route **`/home`**, alongside the existing Finance, Car, and AI items — spending the last available slot in `apps/desktop/src/lib/navigation.ts`'s `FourDestinations` type (Finance, Car, and AI already occupy the other three). The app's launch route and Finance's existing default destination (`/`, labelled `nav.today`/"Today") are **unchanged** — Home is additive navigation, not a new launch target. This was an open question in the first draft of this PRD; it is settled by explicit decision and is no longer open.

**Functional Requirements:**

#### FR-10: A "Home" destination at `/home`

A "Home" rail item, placed above Finance/Car/AI, opens the AI-generated Home Surface page at route `/home`. The app continues to launch to its current route, and the existing Finance static dashboard is unchanged. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- `/home` renders the Home Surface (or its empty/locked state per §4.6) and is reachable from a fourth rail item.
- The existing Finance static dashboard's current behavior, route, and launch-destination status are unchanged.

### 4.6 Premium Access Gating

**Description:** By explicit product decision, the entire Home feature — the Dashboard Composer and all generation/modification — is available only to signed-in **Nixus Cloud premium** accounts. This is a monetization boundary, not a technical limitation: a user with their own BYO AI provider configured does not get a working Composer, because this feature does not fall back to BYO at all. The precedent for a hosted-only AI surface already exists in Nixus — statement import is documented as "Bedrock-only; OpenAI is never a valid fallback there" — Home follows the same shape. Concretely, this means the existing `fallback_for("premium_required") → FallBackToByo` behavior, which the other four AI surfaces (chat, statement import's premium path, project advice, trends insight) rely on, must be **bypassed** for Home's generation call; Home needs its own non-fallback branch for that outcome, the same way statement import already special-cases Bedrock-only rather than using the generic port lookup.

**Functional Requirements:**

#### FR-11: Home is gated to Nixus Cloud premium accounts

A signed-in premium account with hosted-AI quota gets a fully working Dashboard Composer. Every other account state — not signed in, signed in but not premium, or premium but fully out of quota for the billing period (not merely a transient error, which is FR-7) — gets a locked Composer with an explicit upsell/explanation, never a silently broken or generically-erroring one. Realizes UJ-1 (gated), UJ-4 (adjacent but distinct failure mode).

**Consequences (testable):**
- A non-premium account opening `/home` sees the Home Surface's already-persisted Widgets (if any exist, e.g. from a prior premium period) rendered normally, per FR-7/FR-8's "render last-persisted state" behavior — only the Composer's generate/modify affordance is locked, with messaging that names the reason as "requires Nixus Cloud premium," distinct from FR-7's transient-unavailability messaging.
- A non-premium account's generation attempt never reaches a BYO provider, even if one is configured in Settings — the request is rejected before any AI call is attempted.
- Regaining premium (or quota resetting) unlocks the Composer with no other state change.

## 5. Non-Goals (Explicit)

- **Not a general-purpose UI builder.** The Component Catalog and Data Source Whitelist are closed sets curated by the app, not an open palette the AI can extend. Expanding either is a deliberate, future app change — not something a user's request can do on its own. (How an already-persisted Widget behaves when a later app version renames or removes the Catalog Component or Data Source it depends on is not resolved here — see §8 #3.)
- **Not code generation.** At no point does the AI emit, and at no point does Nixus execute, HTML/JS/Dart/SQL generated by the model. Everything rendered comes from the app's own trusted components, fed by the app's own trusted queries.
- **Not multi-dashboard in v1.** One Home Surface per local profile — no naming, saving, or switching between multiple dashboard variants in v1.
- **Not manual layout editing in v1.** No drag-to-resize, drag-to-reorder, or delete buttons on individual Widgets — all changes are conversational (FR-6), each behind a confirmation step, in v1.
- **Not cross-module in v1.** Data Sources cover Finance only; Car-module data is not part of the v1 whitelist.
- **Not live/interactive Widgets in v1.** Widgets display data; they don't accept user input that round-trips back into the dashboard structure (no date pickers, filters, or buttons inside a Widget in v1) — the bi-directional pattern A2UI supports is explicitly deferred, not adopted now.
- **Not available via BYO.** Generation and modification require Nixus Cloud premium and route through hosted AI only (§4.6) — a configured BYO provider does not unlock this feature.

## 6. MVP Scope

### 6.1 In Scope

- A "Home" destination at `/home`, a fourth top-level rail item, hosting the AI-generated dashboard (§4.5, settled).
- Dashboard Composer (natural-language input) on the Home page, gated to Nixus Cloud premium accounts (§4.6).
- Component Catalog: 2 components reused as-is (Table, Metric), 3 generalized from existing bespoke charts (LineChart, BarChart, AreaChart), 1 built new (PieChart), plus 4 Layout Primitives (§4.1) — sized as the mixed reuse/extraction/new-build effort it actually is, not as pure registration.
- Seven finance Data Sources, justified on their own merits (§4.2), not as a 1:1 mirror of the static dashboard.
- Generate → validate → (self-heal once) → confirm → persist → render flow (§4.3), riding the existing `ACTION_TYPES`/`action` confirm-then-persist pipeline.
- Conversational add/modify/remove of Widgets, each behind a confirmation step, with explicit handling for ambiguous/no-match removal targets (FR-6).
- Per-profile persistence and automatic reload with live data (§4.4), with a bounded Widget cap (12) and bounded time budgets for generation and Home-open.
- Audit logging of Home Surface changes, including the `AUDITED_TABLES` registry addition it requires (FR-9).
- Graceful degradation when hosted AI is transiently unavailable to an otherwise-premium user (FR-7), and a distinct locked/upsell state for non-premium accounts (FR-11).
- A test-level assertion that the outbound generation payload contains no literal value from the user's own financial data (§4.2 NFR) — this is in scope as a thing that gets *verified*, not just claimed.

### 6.2 Out of Scope for MVP

- Multiple named/saved dashboards (deferred — v2 candidate).
- Manual drag/resize/reorder/delete UI controls (deferred — v2 candidate; revisit if conversational-only editing proves too slow in practice). `[NOTE FOR PM]` — this is the single highest-risk UX bet in this PRD; if early use shows users fighting the AI to get small layout tweaks right, this should be the first thing reconsidered.
- Car-module (or any non-Finance) Data Sources.
- Interactive/bi-directional Widgets (filters, pickers, buttons inside a Widget).
- Expanding the Component Catalog or Data Source Whitelist beyond v1's fixed lists.
- Sharing a Home Surface across devices/profiles beyond what existing optional sync already does for other domains. [ASSUMPTION: Home Surface JSON travels through the existing sync mechanism like any other locally-stored domain data, with no special-casing; confirm in architecture phase — §8 #1.]
- Verifying or designing for what happens when a user's synced Home Surface references a Catalog Component/Data Source that a different, not-yet-updated device doesn't have yet (version-skew across synced devices) — noted, not solved, here (§8 #3).

## 7. Success Metrics

*Stated plainly up front: Nixus is a local-first, pre-alpha, solo-built app with no production telemetry pipeline today (per its own README, the stated June 2026 north star is learning whether anyone besides the builder uses it at all — not a growth or activation metric). `[NOTE FOR PM]` The metrics below are written to be honest about that: each names how it is actually measured given that constraint, rather than assuming analytics infrastructure that doesn't exist and that the product's privacy stance argues against building casually.*

**Primary**
- **SM-1**: First-attempt Surface Validation pass rate (generation succeeds without needing the Self-Healing Retry) — target ≥ 85% [ASSUMPTION: 85% is a placeholder pending the first real sample, not a derived or benchmarked number]. **Measured by:** a fixed evaluation set of representative prompts run by the builder against the actual generation pipeline (a pre-release eval harness), re-run on every change to the Component Catalog, Data Source Whitelist, or generation prompt — not a production analytics counter. Validates FR-4, FR-5.
- **SM-2**: No literal value from the user's local financial data appears in any outbound generation request. **Measured by:** the test-level assertion in §6.1/§4.2's NFR, run in CI against a seeded profile — a pass/fail regression gate, not a percentage. Validates the §1/§4.2 privacy constraint directly, closing the gap the earlier draft left unmeasured.

**Secondary**
- **SM-3**: Share of generated Widgets still present on the Home Surface 7+ days after creation (i.e. not removed) — a proxy for "the AI built something the user actually wanted to keep," gathered only if the user has opted into sync or otherwise from the builder's own dogfooding during pre-alpha, never from a server-side analytics pipeline. Validates FR-4, FR-6.

**Counter-metrics (do not optimize)**
- **SM-C1**: Average Widget count per Home Surface should **not** be chased upward as a success signal — a cluttered, AI-maximized dashboard is a failure of taste, not a win. The 12-Widget cap (§4.1) is the hard backstop; this metric is the soft one. Counterbalances SM-3.
- **SM-C2**: Self-Healing Retry *usage* rate should not be hidden or treated as acceptable baseline — rising retry usage over time signals catalog/prompt drift, not normal operation. Counterbalances SM-1.

## 8. Open Questions

1. Whether Home Surface JSON travels through existing optional sync unmodified, or needs its own merge semantics given it's AI-composed structure rather than simple field data (§6.2) — architecture-phase question.
2. Whether a user should be able to ask the AI to simply "rebuild this from scratch" / reset the Home Surface, versus only incremental add/modify/remove (§4.3) — deferred to UX/architecture discussion.
3. Catalog/Data-Source versioning: when a later Nixus release renames or removes a Catalog Component or Data Source that an already-persisted Widget depends on, what happens to that Widget on load — dropped, shown as a placeholder, or does the Composer re-ask the AI to rebuild it? This is a live migration concern (Nixus auto-updates and FR-8 persists indefinitely), not hypothetical, and interacts with #1 above for synced devices on different versions.
4. Exact premium-lapse UX: §4.6 FR-11 states that a lapsed-premium account still sees its already-built Widgets with a locked Composer, but the precise copy/affordance for the upsell state (in-app purchase flow vs. a link out) is a UX-spec detail, not resolved here.

## 9. Assumptions Index

- §4.1 FR-2 NFR — Home Surface Widget cap is set at 12.
- §4.2 FR-3 — The "no literal data value" rule is scoped to data-carrying properties (`dataBinding` and similarly data-bearing schema fields); it does not apply to the AI-authored, free-text `title` field.
- §4.3 FR-5 — Self-Healing Retry is capped at 1 corrective attempt (2 total generation attempts per request); this is a settled v1 decision, not a reopened question.
- §4.3 FR-6 NFR — A full generation round-trip (including the one allowed retry) is budgeted at 20 seconds.
- §4.4 FR-8 NFR — Home-open resolution of a full (12-Widget) Home Surface is budgeted at 1 second.
- §7 SM-1 — The 85% first-attempt pass rate target is a placeholder pending the first real evaluation sample.
