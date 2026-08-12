---
title: 'AI advisory when a project is off track'
type: 'feature'
created: '2026-08-12'
status: 'ready-for-dev'
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Once a project shows `caution`/`over` pace status (spec-project-pace-status.md), the user knows they're behind but not what to change to catch up.

**Approach:** An explicit, on-demand button in the expanded project detail ("What would get this back on track?") — never automatic — that generates one grounded AI narrative (headline + body + tone), mirroring the existing Trends-vs-Budget insight one-shot pattern (Bedrock/OpenAI, soft-fail, no invented numbers, single request — no tool-calling loop). Grounded on the project's own pace figures, this month's over-target budget categories, budget categories with meaningful slack (candidates to redirect toward the goal), and liquid-account cash not earmarked to any project (candidates to log as a contribution) — all read server-side, not by the frontend.

## Boundaries & Constraints

**Always:** Button visible only when pace status is `caution` or `over`; never on `good`/`neutral`/reached/archived. The AI call fires only on explicit click, never on row expand or page load, and is a single one-shot request (no tool-calling loop, unlike `ai/chat.rs` — this is a narrative, not a conversation). The prompt receives only precomputed figures the backend itself read: pace (`remaining_cents`, `required_monthly_cents`, `actual_monthly_cents`, `months_to_target`), this month's over-target budget categories, budget categories with meaningful slack, liquid accounts (`chequing`/`savings` only) with unallocated (non-earmarked) cash, and (new) `adjusted_required_monthly_cents` — a Rust-computed "if all listed idle cash were applied" figure. The model must never invent, recompute, or extrapolate any amount, including a revised monthly rate for a partial lump sum — only the exact `adjusted_required_monthly_cents` may be quoted, and only when the model's recommendation is "apply all the listed idle cash." Output is read-only text: never prefills a contribution, never edits a budget target, never seeds the allocation panel — it may only *recommend* a specific account, amount, and category for the user to act on manually.

**Ask First:** Whether to extract `TrendsInsightPanel`'s five-state shell (not-configured/loading/error/empty/success) into a shared component now that this is its second consumer, vs. a second inline copy — HALT and ask if the extraction looks riskier than expected once `TrendsInsightPanel.tsx` is re-read.

**Never:** No budget "what-if" simulator, no editable sliders, no category-cut data model. No change to `projects/allocation.rs`, `projects/pace.rs`, or Epic 32's suggestion math — this reads their outputs, never their inputs. No auto-generation on page/list load (this is per-project, not per-page, and would fan out N provider calls).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Off-track project, AI configured | user clicks button on a `caution`/`over` project | headline + body + tone badge render | N/A |
| AI not configured | `useAiConfig().configured === false` | inline `Alert variant="info"` + link to Settings; button still visible but click shows this state | N/A |
| Provider error | Bedrock/OpenAI call fails | `Alert variant="over"` + Retry button; deterministic pace UI stays rendered underneath | soft-fail, no page-level error |
| On-track/no-deadline project | status `good` or `neutral` | button is absent entirely | N/A |
| No over-target categories this month | all budget categories under/at target | prompt still runs; AI is told there are none and must not fabricate a category to cut | N/A |
| Idle cash exists | a `chequing`/`savings` account has `balance_cents - earmarked_cents > 0` beyond a small floor | AI may name that account and amount as money already available to log toward the goal | N/A |
| No idle cash, no budget slack | every liquid account fully earmarked, every category on/over target | AI gives general encouragement (e.g. lower the target date, or note the gap plainly) without naming a nonexistent account/category | N/A |
| Registered/investment accounts only | user's only liquid-looking balances are in `tfsa`/`rrsp`/`fhsa`/`non_registered`/`crypto` | none of these are ever sent to the model or suggested — they are excluded before the prompt is built, not filtered by the model | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/models/mod.rs` -- add `ProjectAdviceRequest { project_name, remaining_cents, required_monthly_cents, actual_monthly_cents: Option<i64>, months_to_target: Option<i64>, locale }`, `ProjectAdviceResponse { headline, body, tone, project_name }`, and `AccountHeadroom { account_id, account_name, account_type, unallocated_cents }` -- **[amended]** the request/response shapes are unchanged from the original pass; only `AccountHeadroom` is new, and it never crosses to the frontend (backend-internal grounding input, like `BudgetCategoryStatus`)
- `apps/desktop/src-tauri/src/ai/project_advice.rs` -- `generate_project_advice(provider, request, over_target_categories: &[BudgetCategoryStatus], under_target_categories: &[CategoryCompareRow], account_headroom: &[AccountHeadroom]) -> Result<ProjectAdviceResponse, AppError>` -- **[amended]** two new parameters; system prompt gains explicit rules: may name at most 2 liquid accounts (with amounts) as idle cash already available to log as a contribution, may name at most 2 slack categories (with the gap amount) as room to redirect toward the goal, must never name an account/category absent from the lists given, must never suggest an account type other than what appears in `account_headroom` (already pre-filtered to `chequing`/`savings`)
- `apps/desktop/src-tauri/src/db/projects.rs` -- add `get_liquid_account_headroom(conn) -> Result<Vec<AccountHeadroom>, AppError>`: accounts where `account_type IN ('chequing','savings')`, `unallocated_cents = balance_cents - COALESCE(SUM(project_contributions.amount_cents), 0)` (LEFT JOIN across all projects, not just this one), keep only `unallocated_cents > 0`, order desc, mirrors `get_account_earmark_breakdown`'s join shape but aggregated across every liquid account instead of one
- `apps/desktop/src-tauri/src/commands/projects.rs` -- `generate_project_advice` **[amended]**: in addition to the existing over-target read, also call `db::projects::get_liquid_account_headroom`, and reuse `db::spending_trends::get_monthly_spend_by_category(&conn, 3)` + `get_category_targets(&conn)` + `compute_category_compare(...)` (all already exist, unchanged) to get `category_compare`, filter to `status == "under"`, sort by slack (`target_cents - avg_cents`) desc, take top 2; truncate account headroom to top 2 by `unallocated_cents`
- `apps/desktop/src-tauri/src/lib.rs` -- no change (command already registered)
- Frontend -- **no change**: `ProjectAdviceRequest`/`Response` shape is identical, so `src/lib/types.ts`, `useProjectAdvice.ts`, and `ProjectDetail.tsx` need no edits; this is a backend-only precision improvement
- `apps/desktop/src-tauri/src/ai/project_advice.rs` tests -- extend with account-headroom and under-target-category prompt-building cases

## Tasks & Acceptance

**Execution:**
- [x] `models/mod.rs` -- add the two new structs *(original pass)*
- [x] `ai/project_advice.rs` -- gate + tone normalization *(original pass)*
- [x] `commands/projects.rs` -- `generate_project_advice` *(original pass)*
- [x] `lib.rs` -- register module + command *(original pass)*
- [x] Frontend types + mutation hook *(original pass)*
- [x] `ProjectDetail.tsx` -- conditional button + result panel *(original pass)*
- [x] i18n EN/FR *(original pass)*
- [x] Playwright coverage *(original pass)*
- [x] `models/mod.rs` -- add `AccountHeadroom` **[new]**
- [x] `db/projects.rs` -- add `get_liquid_account_headroom` + unit tests (multi-account, zero-earmark, fully-earmarked, non-liquid-type excluded) **[new]**
- [x] `commands/projects.rs` -- gather under-target categories + account headroom, pass both into `ai::project_advice::generate_project_advice` **[new]**
- [x] `ai/project_advice.rs` -- extend signature, prompt-building, and gate-adjacent tests for the two new inputs (including the "none qualify" and "only chequing/savings ever appear" cases) **[new]**
- [x] `commands/projects.rs` -- compute `adjusted_required_monthly_cents` (ceiling division, mirroring `pace.rs`'s idiom) from `remaining_cents`, `months_to_target`, and the sum of the (already-truncated-to-2) `account_headroom` list; `None` when there's no deadline or no idle cash **[new, follow-up]**
- [x] `ai/project_advice.rs` -- add the parameter, one new user-prompt line, and rewrite the system prompt for a decisive sequenced-plan structure per the follow-up Spec Change Log entry; add a style-only example the model must not echo numerically **[new, follow-up]**
- [x] `ai/project_advice.rs` tests -- assert the adjusted figure appears/is absent correctly, and that the system prompt forbids inventing a revised rate for a partial amount **[new, follow-up]**

**Acceptance Criteria:**
- Given a project with status `over` and AI configured, when the user clicks "What would get this back on track?", then a headline + body + tone badge render, grounded only in the figures/categories/accounts the command computed
- Given a project with status `good`, when the row is expanded, then no advisory button is rendered
- Given the provider call fails, when the error state renders, then the deterministic pace line and badge above it remain visible and correct
- Given the request is built, when inspected, then it contains no category or amount the backend did not itself read, and no account whose `account_type` is outside `chequing`/`savings`
- Given a liquid account with `unallocated_cents > 0`, when advice is generated, then that account's name and amount are eligible to appear in the prompt sent to the model
- Given every liquid account is fully earmarked and every budget category is on/over target, when advice is generated, then the prompt states there are no idle-cash or slack candidates, and the system prompt forbids fabricating one
- Given idle cash exists and a target date exists, when the prompt is built, then it states the exact `adjusted_required_monthly_cents` the backend computed for "all idle cash applied," and the system prompt instructs the model to quote that figure verbatim only in that scenario
- Given no idle cash or no target date, when the prompt is built, then no adjusted-rate figure appears at all

## Spec Change Log

- **2026-08-12** — User asked for the advisory to be more precise: recommend specific accounts with idle cash, and specific budget changes, rather than generic encouragement. Amended: added `AccountHeadroom` grounding (liquid accounts only, unallocated cash), added under-target budget-category grounding (reusing existing `spending_trends` compute functions, no new SQL there), extended `ai/project_advice.rs`'s prompt rules accordingly. Confirmed with the user that this stays pre-fetched/one-shot (no tool-calling loop, unlike `ai/chat.rs`) — kept for consistency with the Trends insight pattern and to keep the "no invented numbers" guarantee easy to audit. No frontend changes required.
- **2026-08-12 (follow-up)** — User reviewed real output: the narrative *listed* the available figures (accounts, slack) but never committed to a plan. Wanted something closer to "I'd recommend logging $10,000 from your Emergency Fund now, which lowers your required rate to $X/mo — also try trimming $Y from Groceries" — decisive and sequenced, not descriptive. Amended:
  - **New precomputed figure, not LLM arithmetic:** `commands/projects.rs::generate_project_advice` now also computes `adjusted_required_monthly_cents: Option<i64>` = the required monthly rate *if all the idle cash currently listed in the prompt were applied as a lump sum today* — `ceil_div((remaining_cents - total_headroom_cents).max(0), months_to_target)`, same ceiling-division idiom as `pace.rs`/`allocation.rs`, computed only when `months_to_target` is `Some` and `total_headroom_cents > 0`. This is the only new number in the prompt, and it is Rust-computed, never something the model derives.
  - **`ai/project_advice.rs`:** the user prompt gains one more line stating this figure (or its absence) exactly like every other figure. The system prompt is rewritten from "describe what's available" to "commit to a short, sequenced plan": recommend a specific amount (up to, and optionally less than, an account's stated headroom — a partial amount is fine, especially for an account whose name implies a reserve, e.g. contains "emergency") from a specific named account; if it recommends applying **all** the listed idle cash, it may state the revised monthly rate using **only** the given `adjusted_required_monthly_cents` verbatim; if it recommends a **partial** amount, it must not state any recomputed rate at all (no partial-amount arithmetic exists to hand it) and should instead say the original `required_monthly_cents` remains the fallback to keep contributing; and it should still name one concrete slack category to trim if any exist. A short style example is added to the prompt so the model produces prose in this shape, explicitly marked as illustrative — its numbers must never be echoed.
  - Response length constraint loosens from "2-3 sentences" to "up to 4-5 sentences, structured as a short numbered or sequenced plan" so a genuine 2-3 step recommendation fits without cramming.
- **2026-08-12 (second follow-up)** — Two more findings from real use:
  1. **No caching.** `useProjectAdvice` was a `useMutation` by design ("nothing to cache, re-clicking is the retry") — but the project row unmounts `ProjectDetail` on collapse, so collapsing/expanding or navigating away and back re-asked the AI for a project that had already answered in the same session. Amended: `useProjectAdvice` becomes a `useQuery` keyed per project (`queryKeys.projectAdvice(projectId)`), `enabled: false`, `staleTime: Infinity`, triggered by `refetch()` from the same button click. A prior answer already in the TanStack Query cache renders immediately on remount with **zero** provider calls; an explicit re-click still regenerates (that remains an intentional user action, not an automatic one). Invalidate `projectAdvice(projectId)` everywhere `projectPace` is already invalidated (contribution create/delete, project update) — a real pace change means a stale answer, and cache eviction is exactly the reset mechanism for the whole feature, no bespoke expiry logic needed.
  2. **Too aggressive.** Real output recommended moving the *entire* $2,659.88 chequing balance, plus a partial cautious amount from the account named "Emergency Fund" — i.e. the "leave a buffer" instinct only applied to reserve-*sounding* account names, which is a fragile, unenforceable heuristic. Amended to a **structural** guarantee instead of a prompt-only one: `generate_project_advice` now halves every `AccountHeadroom.unallocated_cents` before it ever reaches the prompt or the `adjusted_required_monthly_cents` calculation — the model is never shown, and therefore can never recommend, more than half of what any account actually holds, regardless of that account's name. The system prompt drops the name-sniffing special case and instead states the safety margin is already built into every figure it sees, and that the user's financial health and safety always outrank speed toward the goal — recommending less than the given amount remains encouraged, never discouraged.
- **2026-08-12 (third follow-up)** — User confirmed the 50% structural cap is the right hard guarantee, but asked for the model to layer its own common-sense financial judgment on top rather than always defaulting to the full safe amount. Amended `build_system_prompt` in `ai/project_advice.rs`: added a "Use your own financial judgment" section instructing the model to weigh an account's apparent role (emergency/rainy-day-fund naming warrants extra caution and a smaller recommended share, or none) when deciding how much of the given ceiling to actually recommend — explicitly framed as a second, optional layer *on top of* the Rust-side 50% cap, never a substitute for it (the cap alone already guarantees no account can be fully drained). No change to the Rust-side halving itself. Test `the_system_prompt_no_longer_sniffs_account_names_for_a_reserve` (which pinned the opposite behavior from the prior follow-up) was replaced with `the_system_prompt_uses_account_name_as_judgment_on_top_of_the_hard_cap`, asserting both the new judgment language and that the hard-cap sentence is still present verbatim.

## Verification

**Commands:**
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ai::project_advice` -- green
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml projects` -- green (covers the new `db/projects.rs` headroom tests)
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` -- zero new warnings
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- clean
- `pnpm exec playwright test tests/projects.spec.ts` -- green, including the not-configured and error branches

</content>
