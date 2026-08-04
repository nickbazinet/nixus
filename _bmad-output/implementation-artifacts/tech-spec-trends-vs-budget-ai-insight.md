---
title: 'Trends vs Budget AI Insight'
slug: 'trends-vs-budget-ai-insight'
created: '2026-07-26T21:26:19Z'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
workingFile: '_bmad-output/implementation-artifacts/tech-spec-trends-vs-budget-ai-insight.md'
tech_stack:
  - 'Tauri 2 + React 19 + TypeScript (apps/desktop)'
  - 'TanStack Router + TanStack Query'
  - 'Rust / rusqlite — db/spending_trends + budget_categories'
  - 'AI: Bedrock converse() + OpenAI chat completions via AiState (one-shot, not stream)'
  - 'Recharts + @nixus/shared Card/PillTabs'
  - 'i18next EN/FR (spendingTrends.*)'
  - 'Playwright E2E (apps/desktop/tests); Rust #[cfg(test)] for compare helper'
files_to_modify:
  - 'apps/desktop/src-tauri/src/models/mod.rs'
  - 'apps/desktop/src-tauri/src/db/spending_trends.rs'
  - 'apps/desktop/src-tauri/src/commands/spending_trends.rs'
  - 'apps/desktop/src-tauri/src/ai/trends_insight.rs'
  - 'apps/desktop/src-tauri/src/ai/mod.rs'
  - 'apps/desktop/src-tauri/src/lib.rs'
  - 'apps/desktop/src/lib/types.ts'
  - 'apps/desktop/src/lib/constants.ts'
  - 'apps/desktop/src/hooks/useSpendingTrends.ts'
  - 'apps/desktop/src/hooks/useTrendsInsight.ts'
  - 'apps/desktop/src/hooks/useBudget.ts'
  - 'apps/desktop/src/hooks/useExpenses.ts'
  - 'apps/desktop/src/components/spending-trends/CategorySpendTable.tsx'
  - 'apps/desktop/src/components/spending-trends/TrendsInsightPanel.tsx'
  - 'apps/desktop/src/routes/spending-trends.tsx'
  - 'apps/desktop/src/locales/en.json'
  - 'apps/desktop/src/locales/fr.json'
  - 'apps/desktop/tests/spending-trends.spec.ts'
code_patterns:
  - 'Money as *_cents integers; invoke snake_case; Result<T, AppError>'
  - 'Compare SSOT in Rust get_spending_trends → category_compare rows; FE display-only'
  - 'Avg divisor = selected months param (absent months = $0); replaces FE totals.length divisor'
  - 'One-shot AI mirrors cc_parser converse() — NOT chat stream_chat_response'
  - 'FE passes category_compare into generate_trends_insight for grounding; command does not recompute'
  - 'Stale-ignore + debounce ~400ms + Query staleTime 15m; no Rust LLM cancel for MVP'
  - 'FH panels = visual twin only (Card/skeleton/disclaimer); not deterministic engine'
  - 'Gate: non-empty categories + ≥1 with target; skip LLM if not_configured'
test_patterns:
  - 'Rust #[cfg(test)] for ±10% status / avg / delta_pct (mirror financial_health evaluator tests)'
  - 'Playwright only for desktop FE; mock get_spending_trends + generate_trends_insight via __TAURI_INTERNALS__'
  - 'Mirror financial-health.spec.ts soft-empty / mock patterns; year-summary.spec.ts for trends testids'
---

# Tech-Spec: Trends vs Budget AI Insight

**Created:** 2026-07-26T21:26:19Z  
**Working file:** `_bmad-output/implementation-artifacts/tech-spec-trends-vs-budget-ai-insight.md`  
_(Dedicated path — not `tech-spec-wip.md` — so parallel Quick Specs do not collide.)_

## Overview

### Problem Statement

The Trends page (`/spending-trends`) shows monthly spend history and category averages, but not how that typical spend tracks against the user’s current monthly budget targets. Users must mentally compare Trends to Budget and get no page-level guidance on drift. Existing AI lives only in chat (`budget-helper`); Financial Health–style recommendations are elsewhere and deterministic — nothing on Trends bridges “what I usually spend” to “what I planned” with an actionable insight.

### Solution

Enhance the existing **Trends** tab (name unchanged) with (1) always-on, category-level comparison of window-average spend vs current `target_cents` and a ±10% on-track band, and (2) one auto-generated, page-owned AI narrative insight that compares current trends to categories/budget — generated in the background without blocking chart or table, gated so the LLM is not called without useful data.

### Scope

**In Scope:**
- Category table enhancements: avg monthly spend over selected 3/6/12m window vs **current** monthly `target_cents`, Δ%, status (Under / On track / Over / No target)
- On-track band: **±10% inclusive** of target (`|delta| ≤ 10%` → On track)
- One auto-generated AI insight panel on Trends (headline + short body + tone + window label); not a chat transcript
- Non-blocking UX: chart + table render independently; insight skeleton → appear; cancel in-flight on window change / navigate away; soft fail + Retry
- LLM gate: non-empty trend data **and** ≥1 category with a budget target; calm empty copy when gated
- EN/FR i18n for new UI strings
- Ground AI prompt on the same compare numbers the UI shows
- Support both Bedrock and OpenAI one-shot paths via `AiState` (do not inherit chat’s Bedrock-only gap)

**Out of Scope:**
- Renaming Trends or adding new nav items
- Overall “pace strip” aggregate above the chart
- Multi-card recommendation sets or manual “Generate” primary CTA
- Chart target reference line
- Required “Discuss in chat” handoff (optional later if cheap)
- Token-by-token streaming of the insight into the page (MVP: complete comment appear)
- Income-aware wording / FR39 expansion
- Rust-side mid-flight LLM cancellation infrastructure
- Reusing calendar-month `get_budget_status` as the Trends compare source

## Context for Development

### Codebase Patterns

- **Desktop stack:** Tauri IPC (`invoke`, snake_case), React 19 + TanStack Router/Query, money as `*_cents` integers (`docs/project-context.md`).
- **Trends today:** `get_spending_trends(months)` returns `by_category` + `totals`. `CategorySpendTable.computeAverages` divides by `monthCount` which today is `totals.length || WINDOW_MONTHS` — **months-with-data**, not always the selected window. SQL window includes current partial month; no zero-filled missing months.
- **Budget targets:** Live targets on `budget_categories.target_cents` via `get_all_budget_categories`. Do **not** use `get_budget_status(year, month)` for this feature (that is calendar-month spend vs target).
- **AI one-shot twin:** `ai/cc_parser.rs` uses Bedrock `converse()` request-response + JSON parse. Chat uses `converse_stream` + events — **wrong pattern** for this feature. Today many LLM paths reject OpenAI as `NotConfigured`; insight must support **both** providers.
- **Errors:** Reuse `AppError` JSON (`not_configured`, `invalid_credentials`, `unavailable`, `ai_service` + `recoverable`, `validation`). Insight panel soft-fails; never blocks chart/table.
- **Query keys:** `queryKeys.spendingTrends(months)` exists; add `trendsInsight(months, locale)`. Invalidate insight with spending-trends + budget category mutations (today target edits under-invalidate Trends — fix in Task 8).
- **UX contract:** Category compare owns the page; one progressive page-owned AI caption below chart / above table; Chat is optional follow-up later, not MVP delivery.
- **i18n:** UI chrome via `spendingTrends.*` EN+FR. AI `headline`/`body` written in app locale (`locale` on request). `tone` is machine enum for styling only.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/desktop/src/routes/spending-trends.tsx` | Page shell; mount insight panel non-blocking |
| `apps/desktop/src/components/spending-trends/CategorySpendTable.tsx` | Replace client avg-only with `category_compare` display |
| `apps/desktop/src/components/spending-trends/SpendingTrendChart.tsx` | Unchanged for MVP |
| `apps/desktop/src/hooks/useSpendingTrends.ts` | Trends query; payload grows with `category_compare` |
| `apps/desktop/src-tauri/src/db/spending_trends.rs` | Compute compare rows + status helper + unit tests |
| `apps/desktop/src-tauri/src/commands/spending_trends.rs` | Wire compare; add `generate_trends_insight` |
| `apps/desktop/src-tauri/src/models/mod.rs` | `CategoryCompareRow`, insight request/response types |
| `apps/desktop/src-tauri/src/ai/cc_parser.rs` | One-shot LLM pattern to mirror |
| `apps/desktop/src-tauri/src/ai/mod.rs` / `AiState` | Provider selection |
| `apps/desktop/src/lib/types.ts` / `constants.ts` | TS mirrors + query keys |
| Financial Health panels + `tests/financial-health.spec.ts` | Calm Card/skeleton/soft-empty + Playwright mock style |
| `apps/desktop/tests/year-summary.spec.ts` | Existing trends-related testids |
| `docs/project-context.md` | Cents, IPC, i18n, Playwright-only, graceful AI degrade |

### Technical Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Page identity | Keep **Trends** | Existing tab; enhancement only |
| Compare baseline | Window avg vs **current** `target_cents` | Sally + PO |
| On-track band | **±10% inclusive** | PM: Under / On track / Over / No target |
| Compare math location | **Rust** in `get_spending_trends` → `category_compare` | Winston: SSOT for table + AI; unit-testable; drop dual FE math |
| Avg divisor | Selected **months** param (missing months = $0) | Winston: intentional semantic fix vs today’s `totals.length` |
| Status fields | `avg_cents`, `target_cents?`, `delta_pct?`, `status` | `under` \| `on_track` \| `over` \| `no_target` |
| Pace strip | Out | Category truth wins |
| AI command | `generate_trends_insight` (async, sync response) | One complete comment; not chat |
| AI providers | Bedrock **and** OpenAI one-shot | Avoid Bedrock-only trap for page insight |
| Grounding | FE passes exact `category_compare` rows into command | Prompt must not invent/recompute amounts |
| Cancel strategy | FE debounce ~400ms + stale-ignore / Query identity | No Rust cancel MVP |
| Cache | Query `staleTime: 15m`; `retry: false`; no Rust TTL | Bound cost on window flip-flop |
| Tone enum | `calm` \| `caution` \| `positive` (validate/default `calm`) | Maps to panel accent; not localized |
| FH engine | Do not reuse | LLM narrative only, grounded on compare rows |

**API shapes (Winston):**

```json
// generate_trends_insight request
{ "months": 6, "window_label": "6 months", "locale": "en",
  "categories": [{ "category_id": 1, "category_name": "Food",
    "avg_cents": 45000, "target_cents": 50000, "delta_pct": -10, "status": "on_track" }] }

// response
{ "headline": "...", "body": "...", "tone": "calm", "window_label": "6 months" }
```

**Status classification (pure helper):**
- `no_target` when target missing or `target_cents <= 0`
- Else `delta = (avg - target) / target`; `on_track` if `|delta| <= 0.10`; `under` if `avg < target * 0.90`; `over` if `avg > target * 1.10`
- `delta_pct` = nearest whole percent `(avg - target) * 100 / target` when target present; omit/null otherwise
- `avg_cents` = `round(sum(spent in window) / months)` where `months` is the command param (3|6|12)

**Anti-patterns (do not):** dual FE+Rust compare math; stream tokens on Trends; route via `send_chat_message`; call LLM when gated/unconfigured; block chart/table on insight; use `get_budget_status` for window compare; invent new error types.

## Implementation Plan

### Tasks

- [ ] Task 1: Add Rust/TS compare + insight models
  - File: `apps/desktop/src-tauri/src/models/mod.rs`
  - File: `apps/desktop/src/lib/types.ts`
  - Action: Add `CategoryCompareRow` (`category_id`, `category_name`, `avg_cents`, `target_cents: Option<i64>`, `delta_pct: Option<i32>`, `status: String`). Extend `SpendingTrendsData` with `category_compare: Vec<CategoryCompareRow>`. Add `TrendsInsightRequest` / `TrendsInsightResponse` (`headline`, `body`, `tone`, `window_label`) and request fields (`months`, `window_label`, `locale`, `categories`). Mirror all in TS.

- [ ] Task 2: Implement compare math + unit tests in Rust
  - File: `apps/desktop/src-tauri/src/db/spending_trends.rs`
  - Action: Pure helpers `classify_status(avg, target) -> status`, `compute_category_compare(by_category rows, months, targets map) -> Vec<CategoryCompareRow>`. Avg divisor = `months` param (clamp ≥1). Join current `target_cents` from `budget_categories` (reuse existing db helper or inline SELECT). Row set = categories with spend in window; sort by `avg_cents` desc. Keep existing `get_monthly_spend_*` SQL.
  - Notes: `#[cfg(test)]` cover ±10% inclusive boundaries (exactly 10% = on_track), no target, sparse months (spend in 1 of 6 → avg = total/6), delta_pct rounding.

- [ ] Task 3: Wire `category_compare` into `get_spending_trends`
  - File: `apps/desktop/src-tauri/src/commands/spending_trends.rs`
  - File: `apps/desktop/src-tauri/src/db/spending_trends.rs`
  - Action: After loading totals/by_category, load targets, compute `category_compare`, return extended `SpendingTrendsData`. Validate `months` in {3,6,12} (or clamp) consistent with existing command.

- [ ] Task 4: Create one-shot AI module `trends_insight`
  - File: `apps/desktop/src-tauri/src/ai/trends_insight.rs` (create)
  - File: `apps/desktop/src-tauri/src/ai/mod.rs`
  - Action: `generate_trends_insight(provider, request) -> Result<TrendsInsightResponse, AppError>`. Gate: `categories` non-empty AND ≥1 row with target. Prompt: educational, use ONLY provided figures, write `headline`+`body` in `locale` (`en`|`fr`), return JSON with `tone` in `calm|caution|positive`. Implement Bedrock `converse()` path (mirror `cc_parser`) **and** OpenAI chat-completions JSON path. Parse JSON; invalid/missing tone → default `calm`. Map provider/config errors to existing `AppError` variants.
  - Notes: Do not stream. Do not recompute compare from SQLite.

- [ ] Task 5: Add Tauri command `generate_trends_insight`
  - File: `apps/desktop/src-tauri/src/commands/spending_trends.rs` (or dedicated command module if preferred)
  - File: `apps/desktop/src-tauri/src/lib.rs`
  - Action: Async command accepting request body (`months`, `window_label`, `locale`, `categories`). Lock `AiState`; if `None` → `NotConfigured` with setup guidance. Dispatch to `ai::trends_insight`. Register in `lib.rs` invoke handler.

- [ ] Task 6: FE types, query keys, table consumes `category_compare`
  - File: `apps/desktop/src/lib/constants.ts`
  - File: `apps/desktop/src/hooks/useSpendingTrends.ts`
  - File: `apps/desktop/src/components/spending-trends/CategorySpendTable.tsx`
  - Action: Add `queryKeys.trendsInsight(months, locale)`. Update `CategorySpendTable` to accept `category_compare` (or full data) — **remove client `computeAverages`**. Columns: category, avg, target (or em dash), Δ%, status badge (i18n). Loading skeleton unchanged. Pass `monthCount` label from selected window for subtitle (“Last N months”).

- [ ] Task 7: Build `useTrendsInsight` + `TrendsInsightPanel`
  - File: `apps/desktop/src/hooks/useTrendsInsight.ts` (create)
  - File: `apps/desktop/src/components/spending-trends/TrendsInsightPanel.tsx` (create)
  - Action: Hook: `enabled` only when gate passes (compare rows non-empty + ≥1 target) AND AI configured if that check is cheap via `useAiConfig`; debounce ~400ms on `months`/locale change; `staleTime: 15 * 60_000`; `retry: false`; invoke `generate_trends_insight` with FE-passed `category_compare` + translated `window_label` + `i18n.language`. Ignore stale results (Query key includes months+locale). Panel: Card below chart / above table; skeleton “Reading your trends…”; success shows headline/body/window_label with tone accent; soft empty for gate/not_configured (CTA to Settings); soft error + Retry. `data-testid`s: `trends-insight-panel`, `trends-insight-skeleton`, `trends-insight-error`.
  - Notes: Never block siblings. No token streaming UI.

- [ ] Task 8: Compose page + invalidation
  - File: `apps/desktop/src/routes/spending-trends.tsx`
  - File: `apps/desktop/src/hooks/useBudget.ts`
  - File: `apps/desktop/src/hooks/useExpenses.ts`
  - Action: Keep chart/table independent of insight loading. When not empty: PillTabs → chart → `TrendsInsightPanel` → `CategorySpendTable` with `data.category_compare`. On budget category create/update/delete and expense mutations that already invalidate budget/expenses: also invalidate `queryKeys.spendingTrends` prefix and `trendsInsight` prefix (and `allBudgetCategories` if still referenced elsewhere).

- [ ] Task 9: i18n EN + FR
  - File: `apps/desktop/src/locales/en.json`
  - File: `apps/desktop/src/locales/fr.json`
  - Action: Add keys under `spendingTrends.*` for: status under/onTrack/over/noTarget; table headers (target, delta, status); insight skeleton, gate empty (no targets / no data), not configured + settings CTA, error + retry, optional educational disclaimer once per panel. Keep `nav.trends` unchanged.

- [ ] Task 10: Tests
  - File: `apps/desktop/src-tauri/src/db/spending_trends.rs` (`#[cfg(test)]`)
  - File: `apps/desktop/tests/spending-trends.spec.ts` (create)
  - Action: Rust tests for Task 2 cases. Playwright: mock `get_spending_trends` with `category_compare`; assert table shows avg/target/status; mock `generate_trends_insight` success → panel text; mock `not_configured` → soft CTA without hiding chart; assert chart/table visible while insight delayed; change window → stale insight for old months not shown. Mirror `financial-health.spec.ts` invoke mock style.

- [ ] Task 11: Verification gate
  - Action: `cd apps/desktop/src-tauri && cargo test spending_trends` (or full `cargo test`); `cargo clippy`; `cd apps/desktop && npx tsc --noEmit`; `npx playwright test tests/spending-trends.spec.ts`. Fix until green.

### Acceptance Criteria

- [ ] AC 1: Given expenses across categories and current targets, when the user opens Trends with a 3/6/12m window, then each category row shows avg spend, target (or no-target state), Δ%, and status Under / On track / Over / No target using the ±10% inclusive band.
- [ ] AC 2: Given avg exactly 10% over (or under) target, when status is computed, then the status is **On track** (inclusive boundaries).
- [ ] AC 3: Given sparse history (spend in fewer months than the selected window), when averages are computed, then avg uses the selected window size as divisor (missing months count as $0), not only months-with-data.
- [ ] AC 4: Given Trends has compare data and ≥1 target and AI is configured, when the page loads (or window changes after debounce), then one AI insight auto-generates without blocking chart or table (skeleton then content).
- [ ] AC 5: Given the LLM gate fails (no trends or no targets), when the user views Trends, then no `generate_trends_insight` invoke occurs and the panel shows calm empty copy; chart/table still work when data exists.
- [ ] AC 6: Given AI is not configured, when Trends would otherwise generate an insight, then the panel shows a soft not-configured message with Settings CTA and does not invent insight text.
- [ ] AC 7: Given insight generation fails (`ai_service` / unavailable), when the error surfaces, then the panel shows soft error + Retry and chart/table remain visible and interactive.
- [ ] AC 8: Given the user switches PillTabs window while an insight request is in flight, when the new window’s data settles, then only the insight for the current window is shown (no stale overwrite).
- [ ] AC 9: Given the insight request payload, when the command runs, then the model is prompted only with the FE-provided `category_compare` figures (command does not re-query SQLite for averages/status).
- [ ] AC 10: Given Bedrock **or** OpenAI is the configured provider, when insight generation is invoked with valid gate data, then the command can complete via that provider (not Bedrock-only).
- [ ] AC 11: Given French (or English) app locale, when insight succeeds, then `headline`/`body` are in that language and UI chrome strings are localized via i18n.
- [ ] AC 12: Given the user navigates to Trends, when inspecting nav/title, then the page remains labeled **Trends** (no rename).
- [ ] AC 13: Given budget target or expense mutations that affect Trends, when those mutations succeed, then spending-trends and trends-insight queries are invalidated so compare + insight refresh.

## Additional Context

### Dependencies

- Existing `AiState` / AI settings (`get_ai_config`, credential storage) — no new providers
- Existing `budget_categories.target_cents` and spending/expense data
- Existing Trends route, PillTabs, chart components (chart unchanged)
- `AppError` serialization contract already used by chat/import FE
- No new npm/crates required for MVP (reuse Bedrock SDK + async-openai already in tree)

### Testing Strategy

**Unit (Rust):**
- Status band inclusive ±10%; under/over; no_target for missing/≤0 target
- Avg divisor with sparse months
- `delta_pct` nearest-int behavior
- Optional: JSON parse / tone defaulting helpers if extracted

**E2E (Playwright):**
- Mocked `get_spending_trends` + `generate_trends_insight` (+ `get_ai_config` if gated in FE)
- Compare columns visible; insight success/error/not_configured paths
- Non-blocking: chart/table present during insight delay
- Window switch stale-safety
- No real LLM calls in CI

**Manual:**
- Real provider configured: visit Trends, confirm one narrative, switch 3↔6↔12, confirm cancel/replace
- FR locale: insight language + chrome
- Edit a target on Budget, return to Trends, confirm compare refreshes

### Notes

**Agent inputs:** Sally (UX) → PM (±10%) → Winston (architecture) → code investigation.

**High-risk / pre-mortem:**
1. **Avg semantic change** — sparse history averages drop vs today; communicate in QA notes; intentional per Winston.
2. **Auto-AI cost** — every visit + window switch; mitigate with gate, debounce, 15m staleTime, stale-ignore.
3. **Insight vs table conflict** — prompt must ground on same `category_compare` rows; tone should not invent contrary numbers.
4. **OpenAI path** — must actually call OpenAI for insight (chat/import may still be Bedrock-biased elsewhere); don’t copy Bedrock-only early return.
5. **Empty page** — `totals.length === 0` hides tabs/chart/table; don’t mount insight in that branch.
6. **Parallel WIP** — implement against this file only; ignore shared `tech-spec-wip.md`.

**Known limitations (MVP):**
- No chat deep-link / “Discuss in chat”
- No chart target line; no overall pace strip
- No Rust mid-flight LLM abort (FE ignore only)
- Categories with targets but zero spend in window omitted from table

**Future considerations:**
- Persist last insight per window; token streaming if latency hurts
- Optional discuss-in-chat with seeded context
- Left-join targets-only categories with $0 avg
- Align chat/import OpenAI support with insight’s dual-provider path
