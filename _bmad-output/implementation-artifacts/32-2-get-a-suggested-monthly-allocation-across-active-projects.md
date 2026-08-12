# Story 32.2: Get a suggested monthly allocation across active projects

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user who has already covered my emergency fund and debt,
I want the app to suggest how to split my monthly surplus across my active goals,
so that I don't have to do that math myself every month.

**Scope:** The pure allocation algorithm (`projects/allocation.rs`), its output model, one read-only command, one db read function, and the frontend data layer (type + query key + hook). **No UI in this story** — Story 32.3 owns `SuggestedAllocationPanel.tsx`. **No writes in this story, at all** — Story 32.4 owns the only write path.

## Acceptance Criteria

1. **Given** my current financial-health waterfall step is `BuildEmergencyFund` or `PayHighInterestDebt`
   **When** I request a suggested allocation
   **Then** an empty list is returned — the app never proposes discretionary savings before the safety net is covered

2. **Given** my current waterfall step is `ContributeRegisteredAccounts` or `InvestSurplus` and I have active projects
   **When** I request a suggested allocation
   **Then** I receive one proposed amount per eligible active project, weighted by priority rank **and** deadline urgency, with the amounts summing to no more than my current `avg_monthly_surplus_cents`

3. **Given** any input
   **When** the allocation is computed
   **Then** `Σ suggested_cents == min(avg_monthly_surplus_cents, Σ remaining_cents)` exactly, `0 ≤ suggested_cents ≤ remaining_cents` for every entry, and every value is an `i64` in cents

4. **Given** two projects at the same priority with no target date and enough remaining on each
   **When** the allocation is computed
   **Then** they receive equal amounts (an even split)

5. **Given** two projects at the same priority with equal remaining amounts but different target dates
   **When** the allocation is computed
   **Then** the project with the nearer target date receives the larger amount

6. **Given** two projects with different priorities and no target dates
   **When** the allocation is computed
   **Then** the higher-priority (lower `priority` value) project receives the larger amount
   **And** reversing their priority order reverses which one receives more (FR9)

7. **Given** a project whose saved total already meets or exceeds its target, or an archived project
   **When** the allocation is computed
   **Then** it does not appear in the result at all

8. **Given** `avg_monthly_surplus_cents` is zero or negative, or there are no eligible active projects
   **When** the allocation is computed
   **Then** an empty list is returned

9. **Given** the same inputs
   **When** the computation runs any number of times
   **Then** the output is byte-identical every time, and **zero database rows are created or modified** — verified by asserting the `project_contributions` and `projects` row counts and contents are unchanged after repeated calls (NFR4)

10. **Given** the allocation function
    **When** it is inspected
    **Then** it performs no database access, takes no `Connection`, and reads no clock — the reference date is an injected parameter — exactly mirroring `financial_health/evaluator.rs`

11. **Given** the Rust test suite
    **When** it runs
    **Then** at least 18 unit tests cover the gate, the weighting, the caps, the invariants, the date edge cases, and determinism, and all pass with zero new clippy warnings

## Tasks / Subtasks

- [x] **Task 1 — Create the `projects` module and its input types** (AC: #10)
  - [x] Create `apps/desktop/src-tauri/src/projects/mod.rs` containing exactly `pub mod allocation;`, mirroring `src-tauri/src/financial_health/mod.rs` (which is exactly `pub mod constants;` / `pub mod evaluator;`)
  - [x] Add `mod projects;` to `apps/desktop/src-tauri/src/lib.rs` alongside the existing `mod financial_health;` / `mod tfsa;` declarations
  - [x] Create `apps/desktop/src-tauri/src/projects/allocation.rs` with the two input structs from Dev Notes → "Exact signatures", each deriving exactly `#[derive(Debug, Clone)]` — they never cross the IPC boundary, so no serde derives, mirroring `WaterfallEvalInput` at `financial_health/evaluator.rs:24-33`
  - [x] Define the two weight-scale constants (`PRIORITY_WEIGHT_SCALE`, `URGENCY_WEIGHT_SCALE`) as `pub const … : i64 = 1000;` at the top of the file
  - [x] Verify it compiles with no `Connection`, no `rusqlite`, and no `chrono::Local` import in this file

- [x] **Task 2 — Add the `ProjectAllocationSuggestion` model** (AC: #2, #3)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add the struct exactly as specified in Dev Notes → "Exact signatures", with `snake_case` fields, `_cents` suffixes on all money, and `target_date: Option<String>` as ISO 8601
  - [x] Derive `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`. `PartialEq` is required by AC #9's determinism assertion and follows the in-file precedent of `WaterfallSummary` / `WaterfallDetail` / `FinancialHealthSummary` (`models/mod.rs:511-560`), which all add `PartialEq` to the base derive set
  - [x] No `#[serde(rename_all = ...)]` — fields are already `snake_case`

- [x] **Task 3 — TDD the gate (red first)** (AC: #1, #8)
  - [x] Add `#[cfg(test)] mod tests` at the bottom of `allocation.rs` with a `base_input()` builder, styled on `financial_health/evaluator.rs:106-120`
  - [x] Failing test: `WaterfallStep::BuildEmergencyFund` with healthy surplus and two funded-gap projects → `assert!(result.is_empty())`
  - [x] Failing test: `WaterfallStep::PayHighInterestDebt` → empty
  - [x] Failing test: `WaterfallStep::ContributeRegisteredAccounts` → non-empty
  - [x] Failing test: `WaterfallStep::InvestSurplus` with a positive surplus → non-empty (the gate admits this step per FR6, even though today's evaluator only reaches it with a non-positive surplus — see Dev Notes → "The `InvestSurplus` trap")
  - [x] Failing test: `avg_monthly_surplus_cents = 0` → empty; `= -10_000` → empty
  - [x] Failing test: empty project list → empty
  - [x] Implement the gate (steps 1-3 of the algorithm) and turn these green

- [x] **Task 4 — TDD the weighting** (AC: #4, #5, #6)
  - [x] Failing test `equal_priority_no_deadline_splits_evenly`: two projects, `priority = 0` both, `target_date = None`, `remaining = 1_000_000` each, surplus `100_000` → `[50_000, 50_000]`
  - [x] Failing test `higher_priority_gets_more`: priorities `0` and `1`, no deadlines, surplus `300_000` → `[200_000, 100_000]` (weights 1000 and 500)
  - [x] Failing test `reversing_priority_reverses_the_split` (FR9): same two projects with priorities swapped → `[100_000, 200_000]` for the same ids
  - [x] Failing test `nearer_deadline_gets_larger_share`: both `priority = 0`, `remaining = 1_000_000` each, target dates 2 and 10 whole months out, surplus `320_000` → `[200_000, 120_000]`
  - [x] Failing test `three_dense_ranks_split_1000_500_333`: priorities `0, 1, 2`, no deadlines, ample remaining, surplus `183_300` → `[100_000, 50_000, 33_300]`
  - [x] Failing test `ties_in_priority_share_the_same_rank`: priorities `0, 0, 5` → the first two get identical amounts and the third gets the rank-1 weight (dense ranking, not positional index)
  - [x] Failing test `deadline_urgency_is_relative_to_the_most_urgent_project`: three projects at `priority = 0`, `remaining = 600_000` each, only the middle one has a target 3 months out, surplus `400_000` → `[100_000, 200_000, 100_000]`
  - [x] Implement the weighting (steps 4-12) and turn these green

- [x] **Task 5 — TDD the caps, remainder pass, and invariants** (AC: #3, #7)
  - [x] Failing test `never_suggests_more_than_a_project_needs`: equal priority, no deadlines, remaining `5_000` and `1_000_000`, surplus `100_000` → `[5_000, 95_000]` (the first is capped at its remaining, and the freed `45_000` flows to the next project in priority order)
  - [x] Failing test `total_never_exceeds_the_surplus`: for a table of ~6 varied inputs, assert `Σ suggested_cents <= avg_monthly_surplus_cents` always
  - [x] Failing test `total_equals_min_of_surplus_and_total_remaining`: remaining `2_000` and `4_000`, surplus `100_000` → `[2_000, 4_000]`, `Σ == 6_000`
  - [x] Failing test `fully_funded_project_is_excluded`: `saved_cents == target_cents` → absent from the result
  - [x] Failing test `overfunded_project_is_excluded`: `saved_cents > target_cents` → absent, and no negative amount anywhere
  - [x] Failing test `every_amount_is_non_negative_and_within_remaining` over the same varied table
  - [x] Failing test `single_project_receives_the_whole_surplus_up_to_its_remaining`
  - [x] Failing test `zero_amount_entries_are_still_returned`: a surplus so small that a low-priority project floors to `0` still yields an entry with `suggested_cents = 0` (Story 32.3 renders and edits every active project, so entries must not be dropped)
  - [x] Implement the cap + single-pass remainder distribution (steps 13-15) and turn these green

- [x] **Task 6 — TDD the date handling** (AC: #5)
  - [x] Failing test `no_target_date_has_zero_urgency_and_none_months`: `months_to_target` is `None` in the output
  - [x] Failing test `past_due_target_date_clamps_to_one_month`: a target date before `today` → `months_to_target == Some(1)` and it receives the maximum urgency weight
  - [x] Failing test `target_date_later_this_month_clamps_to_one_month`
  - [x] Failing test `partial_month_floors_down`: `today = "2026-08-11"`, `target_date = "2026-10-01"` → `months_to_target == Some(1)`; `target_date = "2026-10-11"` → `Some(2)`
  - [x] Failing test `unparseable_target_date_is_treated_as_no_deadline`: `Some("not-a-date")` and `Some("")` → `months_to_target == None`, zero urgency, **no panic**
  - [x] Implement `months_to_target` per Dev Notes → "Months-to-target, stated precisely" using `chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")` and turn these green

- [x] **Task 7 — TDD determinism** (AC: #9)
  - [x] Failing test `identical_inputs_produce_identical_output`: call twice on the same input, `assert_eq!(first, second)` (relies on the `PartialEq` derive from Task 2, matching `evaluator.rs:261-267`)
  - [x] Failing test `output_order_is_priority_then_id`: projects supplied in shuffled input order come back sorted by `(priority ASC, project_id ASC)`
  - [x] Ensure no `HashMap`/`HashSet` iteration influences the output — sort explicitly

- [x] **Task 8 — `db/projects.rs`: the read query that feeds the algorithm** (AC: #7, #9)
  - [x] Add `pub fn get_active_allocation_projects(conn: &Connection) -> Result<Vec<AllocationProject>, AppError>` to `apps/desktop/src-tauri/src/db/projects.rs` (created by Story 31.1)
  - [x] SQL: select `p.id, p.name, p.priority, p.target_cents, p.target_date, COALESCE(SUM(pc.amount_cents), 0) AS saved_cents` from `projects p LEFT JOIN project_contributions pc ON pc.project_id = p.id`, `WHERE p.archived_at IS NULL`, `GROUP BY p.id`, `ORDER BY p.priority, p.id` — the same ordering `get_active_projects` uses (Story 31.1). Story 31.2 ships `get_project_saved_cents` and a `get_project_saved_totals` aggregation; if either already produces the per-project `SUM(amount_cents)` this needs, reuse it rather than duplicating the aggregation
  - [x] In-memory SQLite test: two active projects with contributions plus one archived project → the archived project is absent and `saved_cents` matches the contribution sum
  - [x] In-memory SQLite test: a project with no contributions → `saved_cents == 0` (the `LEFT JOIN` + `COALESCE` path, not a missing row)
  - [x] **NFR4 regression test:** insert projects and contributions, record `SELECT COUNT(*) FROM project_contributions` and `SELECT COUNT(*), SUM(priority) FROM projects`, then call `get_active_allocation_projects` + `compute_suggested_allocation` **five times**, and assert both counts/sums are unchanged and all five results are equal. This is the testable seam for AC #9 — do **not** add a rusqlite `hooks` feature to get an authorizer; `Cargo.toml` pins `rusqlite = { version = "0.38", features = ["bundled"] }` and no new dependency or feature may be added

- [x] **Task 9 — `commands/projects.rs::get_suggested_allocation` (read-only)** (AC: #1, #2, #9)
  - [x] Add to `apps/desktop/src-tauri/src/commands/projects.rs` (created by Story 31.1):
        `#[tauri::command(rename_all = "snake_case")] pub fn get_suggested_allocation(state: State<DbState>) -> Result<Vec<ProjectAllocationSuggestion>, AppError>`
  - [x] Body, in this exact order and nothing more: lock `state.0` with the standard `.map_err(|e| AppError::Database { message: e.to_string() })?` idiom → `let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;` → `let projects = projects_db::get_active_allocation_projects(&conn)?;` → build `AllocationInput` with `current_step: evaluation.current_step.clone()`, `avg_monthly_surplus_cents: figures.avg_monthly_surplus_cents`, `today: chrono::Local::now().date_naive().to_string()`, `projects` → `Ok(allocation::compute_suggested_allocation(&input))`
  - [x] **No `INSERT`, `UPDATE`, `DELETE`, or transaction anywhere in this command, and no `audit_db::insert_audit_log` call** — this is a `get_*` command and the architecture forbids writes from it (NFR4). There is nothing to audit because nothing changes
  - [x] Do **not** modify `db/financial_health.rs` or `financial_health/evaluator.rs` — they are read-only inputs to this feature
  - [x] Register `commands::projects::get_suggested_allocation` in the `tauri::generate_handler![...]` list in `lib.rs`

- [x] **Task 10 — Frontend data layer** (AC: #2)
  - [x] Add `ProjectAllocationSuggestion` to `apps/desktop/src/lib/types.ts` mirroring the Rust field names and types exactly (`suggested_cents: number`, `target_date: string | null`, `months_to_target: number | null`, …)
  - [x] Add `suggestedAllocation: ["suggested-allocation"] as const` to `queryKeys` in `apps/desktop/src/lib/constants.ts` as a flat top-level entry (if Story 32.1 already added it, reuse it — never define a second key)
  - [x] Add `useSuggestedAllocation()` to `apps/desktop/src/hooks/useProjects.ts`: `useQuery({ queryKey: queryKeys.suggestedAllocation, queryFn: () => invoke<ProjectAllocationSuggestion[]>("get_suggested_allocation") })`, shaped exactly like `useFinancialHealthSummary` in `src/hooks/useFinancialHealth.ts`
  - [x] The hook performs **no** arithmetic, **no** gating, and **no** weighting — it returns the array or an empty array. All math lives in Rust so the two sides cannot diverge
  - [x] Hook test in `apps/desktop/src/hooks/__tests__/useProjects.test.tsx`: assert `invokeMock.mock.calls[0]` equals `["get_suggested_allocation"]` (no arguments) and that no `invalidateQueries` call is made by the query hook

- [x] **Task 11 — Playwright mock hygiene** (AC: #1)
  - [x] Story 32.3 mounts the consuming panel on `/wealth/projects`, which means `get_suggested_allocation` becomes a **load-time** invoke on that surface. `apps/desktop/tests/nav-qa.spec.ts` walks every entry in its `SURFACES` list (`:101-119`, which Story 31.1 extends with `["wealth-projects", "/wealth/projects"]`) and **fails on any console error**, so add `case "get_suggested_allocation": return Promise.resolve([]);` to that spec's mock switch (`:37-91`). `get_financial_health_summary` is already mocked there (`:67`), so no second case is needed
  - [x] Add the same case to `apps/desktop/tests/projects.spec.ts` if it exists at this point; otherwise Story 32.3 adds it along with its own assertions
  - [x] No other spec visits `/wealth/projects`, and this story mounts no always-mounted component, so the mock trap at `docs/project-context.md:295` is otherwise not triggered

- [x] **Task 12 — Verification** (AC: #11)
  - [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml projects` — at least 18 tests in `allocation.rs` plus the `db/projects.rs` additions, all passing
  - [x] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — full suite green
  - [x] `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` — zero new warnings (project rule 9). If the module is temporarily unused before Story 32.3 lands, prefer wiring the hook (Task 10) over adding `#[allow(dead_code)]`
  - [x] `pnpm --filter @nixus/desktop test` and `pnpm --filter @nixus/desktop exec tsc --noEmit` clean
  - [x] Confirm no new migration, no `MIGRATIONS` change, no new crate, no new npm package, no i18n key (this story ships no UI copy), and no write statement in any file this story touches

## Dev Notes

### What this story is, in one sentence

A pure, deterministic, DB-free, clock-free weighting function plus one read-only command that orchestrates two existing reads into it. **This is the highest-value story in the epic to over-test.**

### Exact signatures — implement these verbatim

In `apps/desktop/src-tauri/src/projects/allocation.rs`:

```rust
pub const PRIORITY_WEIGHT_SCALE: i64 = 1000;
pub const URGENCY_WEIGHT_SCALE: i64 = 1000;

#[derive(Debug, Clone)]
pub struct AllocationProject {
    pub project_id: i64,
    pub name: String,
    pub priority: i32,
    pub target_cents: i64,
    pub saved_cents: i64,
    pub target_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AllocationInput {
    pub current_step: WaterfallStep,
    pub avg_monthly_surplus_cents: i64,
    /// ISO 8601 `YYYY-MM-DD`. Injected, never read from the clock inside this module.
    pub today: String,
    pub projects: Vec<AllocationProject>,
}

pub fn compute_suggested_allocation(input: &AllocationInput) -> Vec<ProjectAllocationSuggestion>
```

In `apps/desktop/src-tauri/src/models/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectAllocationSuggestion {
    pub project_id: i64,
    pub project_name: String,
    pub suggested_cents: i64,
    pub remaining_cents: i64,
    pub target_cents: i64,
    pub saved_cents: i64,
    pub target_date: Option<String>,
    pub months_to_target: Option<i64>,
    pub priority_rank: i32,
    pub weight: i64,
}
```

`remaining_cents`, `months_to_target`, `priority_rank`, and `weight` are returned deliberately: the PRD's stated differentiator is **transparent math** — "allocation math is transparent and always user-confirmed" and "the 'cool' factor comes from transparent math (visible per-project breakdown, deadline-aware pacing)" [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#1. Executive Summary`, `#6. Innovation Analysis`]. Story 32.3 needs `remaining_cents` to bound its editable field and `months_to_target` to explain *why* a project got more. Returning the weight makes the suggestion auditable by the user rather than a black box.

Note the naming: the field is `project_name`, not `name`, because `ProjectAllocationSuggestion` is a projection across two concepts and `project_*` prefixes keep it unambiguous on the wire.

### THE FORMULA — pinned down here, because the architecture deliberately left it open

The architecture explicitly deferred this: *"The exact default-split weighting formula for FR9 (priority + deadline urgency) is specified at the product level (PRD) but not reduced to a precise formula here — left as an implementation detail of `compute_suggested_allocation()` since it's pure, unit-testable logic"* [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Gap Analysis Results`]. **This story closes that gap. Implement exactly the following. Do not substitute your own weighting.**

```
── Step 1: gate on waterfall step (FR6) ─────────────────────────────────────
if current_step ∉ { ContributeRegisteredAccounts, InvestSurplus }  →  return []

── Step 2: gate on surplus ──────────────────────────────────────────────────
if avg_monthly_surplus_cents <= 0  →  return []
let allocatable = avg_monthly_surplus_cents

── Step 3: eligibility ──────────────────────────────────────────────────────
remainingᵢ = target_centsᵢ − saved_centsᵢ
eligible   = { i : remainingᵢ > 0 }          // archived projects never reach here;
if eligible is empty  →  return []           // the db query filters archived_at IS NULL

── Step 4: deterministic order ──────────────────────────────────────────────
sort eligible by (priority ASC, project_id ASC)

── Step 5: dense priority rank (ties share a rank) ──────────────────────────
rank₀ = 0; rankᵢ = rankᵢ₋₁ + 1 if priorityᵢ ≠ priorityᵢ₋₁ else rankᵢ₋₁

── Step 6: priority weight ──────────────────────────────────────────────────
priority_weightᵢ = max(1, PRIORITY_WEIGHT_SCALE / (1 + rankᵢ))     // integer division
                   → rank 0 = 1000, rank 1 = 500, rank 2 = 333, rank 3 = 250 …

── Step 7: deadline urgency ─────────────────────────────────────────────────
months_to_targetᵢ = None  if target_date is None or unparseable
                  = Some(max(1, whole_months(today, target_dateᵢ)))  otherwise

required_monthlyᵢ = 0                                    if months_to_targetᵢ is None
                  = ceil_div(remainingᵢ, monthsᵢ)        otherwise
                    where ceil_div(a, b) = (a + b − 1) / b

max_required = max over eligible of required_monthlyᵢ

urgency_weightᵢ = 0                                                      if max_required == 0
                = URGENCY_WEIGHT_SCALE * required_monthlyᵢ / max_required  otherwise
                  → the most urgent project scores 1000; a project needing
                    half as much per month scores 500; no deadline scores 0

── Step 8: combined weight ──────────────────────────────────────────────────
weightᵢ      = priority_weightᵢ + urgency_weightᵢ        // ∈ [1, 2000], always ≥ 1
total_weight = Σ weightᵢ                                 // always ≥ 1

── Step 9: proportional split, capped at what the project still needs ───────
rawᵢ         = floor( allocatable × weightᵢ / total_weight )   // i128 intermediates
suggestedᵢ   = min(rawᵢ, remainingᵢ)

── Step 10: single deterministic remainder pass ─────────────────────────────
leftover = allocatable − Σ suggestedᵢ
for i in sorted order (priority ASC, project_id ASC):
    if leftover == 0: break
    give        = min(leftover, remainingᵢ − suggestedᵢ)
    suggestedᵢ += give
    leftover   −= give

── Step 11: return ──────────────────────────────────────────────────────────
one ProjectAllocationSuggestion per eligible project, in sorted order,
INCLUDING entries whose suggested_cents is 0
```

**Why priority and urgency are both scaled to `0..1000` and then added:** it makes their maximum influence exactly equal (a 1:1 blend), which is the simplest defensible reading of the PRD's "weighted by priority and deadline urgency" and — critically — it keeps every test expectation an exact integer. The two scales are named constants so a future product decision can re-balance them (e.g. `URGENCY_WEIGHT_SCALE = 2000` to make deadlines dominate) without touching the algorithm's shape.

**Why urgency is normalised against `max_required` rather than used raw:** `required_monthly` is a cents figure in the hundreds of thousands, while a priority weight is ~1000. Adding them raw would make priority arithmetically irrelevant and would silently break FR9. Normalising to the same 0..1000 band is what makes priority and deadline genuinely co-equal inputs.

**Why the cap at `remainingᵢ` (step 9):** suggesting $400 toward a goal that needs $50 to finish is obviously wrong and would make Story 32.3's edited-total validation confusing. AC #3's `min(surplus, Σ remaining)` conservation identity falls out of this cap plus the step-10 remainder pass.

**Why floor division plus one remainder pass, not a largest-remainder method:** floor division alone can leave up to `n − 1` cents unassigned, and the cap in step 9 can free a much larger amount. The single pass in priority order reassigns both, deterministically, in O(n), and gives the freed money to the highest-priority project that can still absorb it — which is the behaviour a priority-ranked list implies. It also produces the exact, hand-checkable expectations in Task 5.

**Use `i128` for the `allocatable × weightᵢ` product** before dividing, then cast back to `i64`. The realistic overflow headroom in `i64` is enormous, but the cast is free and removes the question entirely. Integer arithmetic only — no `f64` anywhere in the money path (project rule 1). Unlike `financial_health/evaluator.rs`, which legitimately uses `f64` for a *coverage-months ratio*, this module produces money and must not.

### Months-to-target, stated precisely

```
whole_months(today = c_y-c_m-c_d, target = t_y-t_m-t_d):
    m = (t_y − c_y) × 12 + (t_m − c_m)
    m = m − 1   if t_d < c_d          // a partial month does not count
    return m                          // may be ≤ 0; the caller clamps with max(1, …)
```

- Parse both dates with `chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")`. `chrono 0.4` is already a dependency. In-repo precedent for date handling: `db/maintenance.rs:258`, `ai/cc_parser.rs:175`.
- **A parse failure is never an error and never a panic** — it degrades to "no deadline" (`months_to_target = None`, zero urgency). `target_date` is a nullable free-text ISO column with no `CHECK` constraint [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture`], so bad data is representable and must not take down the whole suggestion. No `.unwrap()` outside tests (project rule: Rust).
- **`max(1, …)` means a past-due or this-month deadline is maximally urgent, never negative and never infinite.** Dividing `remaining` by a zero or negative month count is the obvious latent panic/absurdity in this algorithm; the clamp is the guard. AC #6's `past_due_target_date_clamps_to_one_month` test is what pins it.
- **`today` is a parameter, never read inside the module** (AC #10). The single `chrono::Local::now().date_naive()` call lives in the command. This is the same discipline as `tfsa::calculator::accumulated_limit(birth_date, current_year)` and exists so date-boundary cases are testable without freezing the system clock.

### Worked examples — use these as the literal test expectations

| Case | Projects (priority, remaining, months to target) | Surplus | Weights | Result |
| --- | --- | --- | --- | --- |
| Even split | (0, 1 000 000, —), (0, 1 000 000, —) | 100 000 | 1000, 1000 | 50 000, 50 000 |
| Priority 2:1 | (0, big, —), (1, big, —) | 300 000 | 1000, 500 | 200 000, 100 000 |
| Reordered (FR9) | (1, big, —), (0, big, —) | 300 000 | 500, 1000 | 100 000, 200 000 |
| Deadline urgency | (0, 1 000 000, 2), (0, 1 000 000, 10) | 320 000 | 1000+1000, 1000+200 | 200 000, 120 000 |
| Three ranks | (0, big, —), (1, big, —), (2, big, —) | 183 300 | 1000, 500, 333 | 100 000, 50 000, 33 300 |
| One deadline of three | (0, 600 000, —), (0, 600 000, 3), (0, 600 000, —) | 400 000 | 1000, 2000, 1000 | 100 000, 200 000, 100 000 |
| Cap + reflow | (0, 5 000, —), (0, 1 000 000, —) | 100 000 | 1000, 1000 | 5 000, 95 000 |
| Surplus exceeds need | (0, 2 000, —), (0, 4 000, —) | 100 000 | 1000, 1000 | 2 000, 4 000 (Σ = 6 000) |

Deadline-urgency arithmetic for the fourth row, spelled out: `required = ceil(1 000 000 / 2) = 500 000` and `ceil(1 000 000 / 10) = 100 000`; `max_required = 500 000`; urgency `= 1000×500 000/500 000 = 1000` and `1000×100 000/500 000 = 200`; weights `2000` and `1200`, total `3200`; `320 000×2000/3200 = 200 000` and `320 000×1200/3200 = 120 000`. Every row above divides exactly — there is no rounding slack to argue about in review.

### The `InvestSurplus` trap — read this before writing the gate test

FR6 requires the gate to admit **both** `ContributeRegisteredAccounts` and `InvestSurplus`. But today's evaluator only ever selects `InvestSurplus` when the surplus is **not** positive:

```rust
} else if input.avg_monthly_surplus_cents > 0 {
    (WaterfallStep::ContributeRegisteredAccounts, "contribute_registered")
} else {
    (WaterfallStep::InvestSurplus, "invest_surplus")
}
```
[Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:76-83`]

So in production, an `InvestSurplus` step arriving at this function will always be paired with a surplus `≤ 0` and will return an empty list at step 2. That is correct behaviour and **must not be "fixed"**:

- **Do not modify `financial_health/evaluator.rs`.** It is a read-only input to this feature [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Technical Constraints & Dependencies`].
- **Do not drop `InvestSurplus` from the gate** — FR6 names it explicitly, the pure function must honour its own stated contract independently of who calls it, and the evaluator's ladder may change later.
- **Do write the `InvestSurplus` + positive-surplus unit test anyway** (Task 3). It documents the function's contract, not today's reachable state. Note this explicitly in the test's name or a `// why` comment so a future reader does not delete it as unreachable.

Related: `SavingsSummary.avg_monthly_surplus_cents` is `Option<i64>` and `FinancialHealthSummary.savings` is itself `Option`, both `None` when `data_sufficient == false` (`db/financial_health.rs:142-153`). The command reads the *internal* figure (`FinancialHealthFiguresInternal.avg_monthly_surplus_cents`, a plain `i64` at `db/financial_health.rs:31`), so it needs no unwrapping. And when `data_sufficient == false` the evaluator returns `BuildEmergencyFund` (`evaluator.rs:70-73`), so the step gate already produces an empty list — the two gates agree and no third `data_sufficient` check is needed.

### The precedent this module mirrors: `financial_health/evaluator.rs`

Study `apps/desktop/src-tauri/src/financial_health/evaluator.rs` before writing a line. It is the exact shape to copy:

- A `pub fn` taking `&Input` and returning a value — no `Result`, because a pure classification cannot fail (`evaluator.rs:43`). `compute_suggested_allocation` likewise returns a plain `Vec`, and "no suggestion" is an empty `Vec`, not an error.
- Plain input struct deriving only `#[derive(Debug, Clone)]` (`evaluator.rs:24-33`) — it is an internal boundary type, not IPC.
- Output type deriving `PartialEq` so a determinism test can `assert_eq!` two runs (`evaluator.rs:35-41`, test at `:261-267`).
- `#[cfg(test)] mod tests` at the bottom of the same file with a `base_input()` builder and struct-update syntax per case (`evaluator.rs:106-120`) — no separate test file, no test fixtures directory.
- **Zero DB access.** The `Connection` never enters this file. Its caller `db/financial_health.rs::evaluate_financial_health_waterfall` (`:247-261`) does the loading and hands plain values in. `commands/projects.rs::get_suggested_allocation` plays that same role for this module.

### Command shape to mirror: `commands/financial_health.rs`

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_financial_health_summary(state: State<DbState>) -> Result<FinancialHealthSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?;
    let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;
    Ok(financial_health_db::build_financial_health_summary(&figures, &evaluation))
}
```
[Source: `apps/desktop/src-tauri/src/commands/financial_health.rs:8-21`]

`get_suggested_allocation` is the same five lines plus one extra read. It takes no parameters. It writes nothing and audits nothing.

### NFR4 is a structural rule, not a reminder

> *"Suggestion flow is read/write-separated: `get_suggested_allocation` is a pure query (zero writes, satisfies NFR4 directly); only `confirm_project_allocations` writes. This separation is the one process rule specific to this feature and must not be collapsed into a single command."*
> [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns`]

Concretely, in this story that means: no `INSERT`/`UPDATE`/`DELETE` string, no `unchecked_transaction`, no `insert_audit_log` call, and no "cache the suggestion in a table so we don't recompute" optimisation — the data volumes are tiny and caching is explicitly not needed [Source: `#Caching strategy`]. There is also nothing to invalidate on the frontend: `useSuggestedAllocation` is a `useQuery`, and it is *other* stories' mutations (32.1's reorder, 32.4's confirm, 31.2's manual contributions) that invalidate `queryKeys.suggestedAllocation`.

### Why no envelope struct, and where Story 32.3 gets the surplus cap

`get_suggested_allocation` returns a bare `Vec<ProjectAllocationSuggestion>`, exactly as the architecture specifies [Source: `#API & Communication Patterns`]. It does **not** return a wrapper carrying `available_surplus_cents`. Story 32.3 needs the cap to validate an edited total, and it gets it from the existing `useFinancialHealthSummary()` hook → `savings.avg_monthly_surplus_cents` — an already-wired, already-invalidated, read-only query key. Both figures derive from the same `load_financial_health_figures` computation, so they agree; if the underlying data changes between the two fetches, Story 32.4's server-side cap check is the authority and correctly rejects a stale confirm. Adding a new envelope shape would deviate from the architected signature for no gain.

### Dependencies on Epic 31 — the exact names to build against

This story extends, and never redefines: the `projects` / `project_contributions` tables from migration `025_projects.sql`; `db/projects.rs` (which already holds `insert_project`, `get_active_projects`, `update_project`, `archive_project`, `insert_project_contribution`, `delete_project_contribution`, `get_project_saved_cents`, `get_account_earmark_breakdown`); `commands/projects.rs` (`create_project`, `get_projects`, `update_project`, `archive_project`, `create_project_contribution`, `delete_project_contribution`, `get_account_earmark_breakdown`); `hooks/useProjects.ts`; and the `Project` / `ProjectContribution` models. Existing query keys: `projects`, `project(id)`, `projectSavedTotals`, `projectContributions(id)`, `accountEarmarks(id)` (`["account-earmarks", id]`), `savingsProjectsSummary` (`["savings-projects-summary"]`). This story adds only `suggestedAllocation` (`["suggested-allocation"]`), which Story 32.1 may have added already.

Story 32.1 changes how a new project's default `priority` is assigned (append to the end of the order instead of `0`). This story's algorithm reads `priority` as an opaque ordering integer and behaves identically either way, so the two stories can land in any order.

### Explicitly out of scope

No `SuggestedAllocationPanel.tsx` or any other component (Story 32.3). No `confirm_project_allocations`, no `ProjectAllocationInput`, no contribution row, no audit log entry (Story 32.4). No `reorder_projects` (Story 32.1). No migration, no `MIGRATIONS` change, no change to `migrations/025_projects.sql`. No modification to `financial_health/evaluator.rs`, `financial_health/constants.rs`, or `db/financial_health.rs`. No i18n keys — this story ships no user-visible copy. No new crate, no new npm package, no new rusqlite feature. No change to `accounts` or `accounts.balance_cents` from any code path.

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── projects/                        # NEW directory — pure logic, no IO, no SQL
│   ├── mod.rs                       # NEW: exactly `pub mod allocation;`
│   └── allocation.rs                # NEW: constants + AllocationProject + AllocationInput
│                                    #      + compute_suggested_allocation() + ≥18 tests
├── models/mod.rs                    # MODIFIED: + ProjectAllocationSuggestion
├── db/projects.rs                   # MODIFIED (created 31.1): + get_active_allocation_projects()
│                                    #      + NFR4 repeated-call regression test
├── commands/projects.rs             # MODIFIED (created 31.1): + get_suggested_allocation (read-only)
└── lib.rs                           # MODIFIED: + `mod projects;`; register the command

apps/desktop/src/
├── lib/types.ts                     # MODIFIED: + ProjectAllocationSuggestion
├── lib/constants.ts                 # MODIFIED: + queryKeys.suggestedAllocation (if 32.1 has not)
├── hooks/useProjects.ts             # MODIFIED (created 31.1): + useSuggestedAllocation()
└── hooks/__tests__/useProjects.test.tsx  # NEW or MODIFIED: read-command wire-contract test
```

**Deliberately not touched:** `migrations/`, `db/mod.rs`, `db/audit.rs`, `db/account.rs`, `db/financial_health.rs`, `financial_health/`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `src/locales/*`, `src/components/**`, `src/routes/**`, and every existing `tests/*.spec.ts` (this story mounts no component, so the always-mounted-invoke mock trap at `docs/project-context.md:295` does not apply).

**Variance from the naming convention, with rationale:** `src-tauri/src/projects/allocation.rs` is a top-level sibling of `financial_health/` and `tfsa/`, **not** `db/projects_allocation.rs`. Project rule 3 puts SQL in `db/`; this module executes no SQL and holds no `Connection`, so the `financial_health/evaluator.rs` precedent governs. The architecture pre-approves exactly this: *"New pure-logic file `projects/allocation.rs` — justified deviation (adds a module dir, like `financial_health/` and `maintenance/`)"* [Source: `#Structure Patterns`]. Note the name collision to keep straight: `src-tauri/src/projects/` (pure logic), `src-tauri/src/db/projects.rs` (SQL), `src-tauri/src/commands/projects.rs` (IPC) — three distinct files, one domain.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 32.2: Get a suggested monthly allocation across active projects` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR6, FR9, NFR2, NFR4]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Additional Requirements` — `projects/allocation.rs` mirrors the `financial_health::evaluator` pattern: deterministic, no DB access]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR6 gate on `ContributeRegisteredAccounts` / `InvestSurplus`; FR9 reorder changes the split]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#2. Success Criteria` — SC3: `get_suggested_allocation` returns empty when the step is `BuildEmergencyFund` or `PayHighInterestDebt`; SC5: never auto-applied]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#9. Non-Functional Requirements` — NFR2 integer cents; NFR4 zero rows written by the suggestion command]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#1. Executive Summary`, `#6. Innovation Analysis` — transparent math is the differentiator, hence the explanatory fields on the output]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Gap Analysis Results` — the exact weighting formula was deliberately deferred to this story]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — `get_suggested_allocation()` returns empty when gated out and writes nothing; returns `Vec<ProjectAllocationSuggestion>`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns` — read/write separation must not be collapsed]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Structure Patterns` — `projects/allocation.rs` as a justified pure-logic module mirroring `financial_health/evaluator`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Enforcement Guidelines` — never let a `get_*` command write; never write `accounts.balance_cents`; all SQL through `db/projects.rs`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data Architecture` — `projects` / `project_contributions` schema, `archived_at` soft delete, `priority` lower = higher, `target_date` nullable ISO 8601 with no format constraint]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Technical Constraints & Dependencies` — `WaterfallStep` and `avg_monthly_surplus_cents` are read-only inputs; no new dependencies]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Decision Impact Analysis` — implementation sequence step 4: `projects/allocation.rs` takes `WaterfallStep` + `avg_monthly_surplus_cents` + active projects, no DB access]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)` — `i64` cents, `_cents` suffix, never floating point for money]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` / `#Tauri IPC` — `rename_all = "snake_case"`, `Result<T, AppError>`, `State<DbState>` lock idiom, register in `lib.rs`]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — no SQL in `commands/`]
- [Source: `docs/project-context.md#4. Rust Model Structs` — derive set, `snake_case` fields, ISO 8601 date strings, models in `models/mod.rs`]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — keys only in `lib/constants.ts`, kebab-case arrays]
- [Source: `docs/project-context.md#9. Compilation Warnings Policy` and `#Language-Specific Rules` — zero warnings; no `.unwrap()` outside tests]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:5-12` — `WaterfallStep` enum, the gate's input type]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:24-41` — plain `Debug, Clone` input struct; output with `PartialEq`]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:43-91` — pure `fn(&Input) -> Output` with no `Result` and no DB]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:76-83` — the `InvestSurplus` branch is only reached when surplus ≤ 0]
- [Source: `apps/desktop/src-tauri/src/financial_health/evaluator.rs:106-323` — `#[cfg(test)] mod tests` with `base_input()` builder, per-case struct update syntax, determinism test at `:261-267`]
- [Source: `apps/desktop/src-tauri/src/financial_health/mod.rs` — two-line module file to mirror]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:21-33` — `FinancialHealthFiguresInternal.avg_monthly_surplus_cents: i64`]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:142-153` — `SavingsSummary.avg_monthly_surplus_cents` is `Option`, `None` when data is insufficient]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:247-261` — `evaluate_financial_health_waterfall` is the loader the command calls; it returns `(figures, evaluation)`]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:332-375` — in-memory SQLite test-DB setup pattern to copy for `db/projects.rs` tests]
- [Source: `apps/desktop/src-tauri/src/commands/financial_health.rs:8-21` — the exact command shape to mirror]
- [Source: `apps/desktop/src-tauri/src/models/mod.rs:506-560` — `SavingsSummary`, `WaterfallSummary`, `FinancialHealthSummary`: derive conventions and the `PartialEq` precedent]
- [Source: `apps/desktop/src-tauri/src/lib.rs` — `mod financial_health;` / `mod tfsa;` declarations and the flat `generate_handler!` list]
- [Source: `apps/desktop/src-tauri/src/tfsa/calculator.rs` — precedent for injecting the current date as a parameter so boundary cases are testable]
- [Source: `apps/desktop/src-tauri/Cargo.toml:25,29` — `rusqlite = { version = "0.38", features = ["bundled"] }` (no `hooks` feature); `chrono 0.4` available]
- [Source: `apps/desktop/src-tauri/src/db/maintenance.rs:258`, `apps/desktop/src-tauri/src/ai/cc_parser.rs:175` — in-repo date-parsing / `Local::now()` precedent]
- [Source: `apps/desktop/src/hooks/useFinancialHealth.ts` — `useQuery` hook shape to mirror]
- [Source: `apps/desktop/src/lib/constants.ts:59-61` — flat kebab-case `queryKeys` entries]
- [Source: `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` — `createRoot`/`act` harness, module-level `invoke` mock, exact `invoke.mock.calls[0]` assertions, negative `not.toHaveBeenCalled()` assertions]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo build` — clean, zero warnings.
- `cargo test` — 542 passed, 0 failed (up from 508 before this story: +31 in `projects::allocation`, +3 in `db::projects`).
- `cargo test projects` — 93 passed, 0 failed.
- `cargo clippy --all-targets` — 1 warning, pre-existing and untouched by this story (`src/commands/backup.rs:106`, `explicit_auto_deref`). Zero new warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` — exit 0 (also clean against `tsconfig.node.json`).
- `pnpm --filter @nixus/desktop test` — 215 passed / 13 files (`useProjects.test.tsx` 8 → 10).
- `pnpm exec playwright test tests/nav-qa.spec.ts tests/projects.spec.ts` — 21 passed, zero console errors.
- Mutation check on the date rules: temporarily deleting the day-of-month adjustment in `whole_months` and the `max(1)` clamp in `months_to_target` failed exactly `partial_month_floors_down`, `past_due_target_date_clamps_to_one_month` and `target_date_later_this_month_clamps_to_one_month`, then reverted — proof those three tests discriminate rather than pass vacuously.

### Completion Notes List

- **Formula implemented exactly as pinned in Dev Notes.** Gate on `{ContributeRegisteredAccounts, InvestSurplus}` → gate on `surplus > 0` → eligibility `remaining = target − saved > 0` → sort `(priority ASC, project_id ASC)` → dense priority rank → `priority_weight = max(1, 1000 / (1 + rank))` → `months_to_target = Some(max(1, whole_months))` / `None` → `required_monthly = ceil_div(remaining, months)` or `0` → `urgency_weight = 1000 × required / max_required` (or `0` when `max_required == 0`) → `weight = priority_weight + urgency_weight` → `raw = floor(allocatable × weight / total_weight)` with `i128` intermediates → `suggested = min(raw, remaining)` → one deterministic leftover pass in sorted order. Every one of the eight worked examples in the Dev Notes table is a literal test expectation and every one divides exactly.
- **31 unit tests in `allocation.rs`** (AC #11 asks for ≥18), plus 3 new tests in `db/projects.rs`. Coverage: gate (4 steps), zero/negative surplus, empty list, even split, priority 2:1, FR9 reversal, deadline urgency, three dense ranks, priority ties, urgency-relative-to-max, cap-and-reflow, conservation identity (single fixture *and* table-driven over 6 varied inputs), fully/over-funded exclusion, non-negativity and per-project ceiling over the same table, single project, zero-amount entries retained, five date edge cases, determinism, output ordering.
- **NFR4 proven structurally, not asserted verbally.** `get_active_allocation_projects` is a single `SELECT`; `get_suggested_allocation` performs two reads and one pure call, with no `INSERT`/`UPDATE`/`DELETE`, no `unchecked_transaction`, and no `insert_audit_log`. `repeated_suggestion_reads_write_nothing_and_stay_identical` calls the read + the algorithm five times and asserts the `project_contributions` count, the `(COUNT(*), SUM(priority))` checksum on `projects`, and the account balance are all unchanged, and that all five results are `==`.
- **AC #10 verified by grep, not by intent:** `allocation.rs` contains no `rusqlite`, no `Connection`, no `chrono::Local`, no `Local::now`, no `f64`, and no `.unwrap()`/`.expect()` in production code. The single `Local::now().date_naive()` call lives in the command.
- **Task-ordering deviation (Task 6 vs Task 4).** `months_to_target` had to land in Task 4's implementation step, not Task 6's, because two of Task 4's own mandated test expectations (`nearer_deadline_gets_larger_share`, `deadline_urgency_is_relative_to_the_most_urgent_project`) are stated in months-to-target and cannot go green without it. Task 6's tests then pin its edge cases. To keep red-first honest for those, the three clamp/floor rules were verified by mutation (see Debug Log) rather than by writing them before any implementation existed.
- **Decision: one SQL statement rather than reusing `get_project_saved_totals`.** The story allowed reuse "if either already produces the per-project `SUM(amount_cents)` this needs". `get_project_saved_totals` returns only `(project_id, saved_cents)`, so reusing it would still require a second query for name/priority/target/target_date plus a Rust-side join, and would re-derive in Rust the `ORDER BY p.priority, p.id` the SQL already guarantees. One `LEFT JOIN … GROUP BY p.id` statement is the smaller, less drift-prone diff; the aggregation shape and the `COALESCE(..., 0)` rationale mirror `get_project_saved_totals` exactly.
- **Decision: an unparseable `today` degrades to "no deadline" for every project** rather than panicking or erroring, mirroring the mandated handling of an unparseable `target_date`. The command always injects `Local::now().date_naive().to_string()`, so this is unreachable in production; `unparseable_today_is_treated_as_no_deadline` pins it and carries a `// why` comment so it is not deleted as dead coverage.
- **Decision: overflow hardened with `saturating_*` on the two paths the story did not name** — `target_cents.saturating_sub(saved_cents)` and `remaining.saturating_add(months - 1)` in `ceil_div`. Free, and removes a debug-build panic on absurd DB data. The `allocatable × weight` product uses `i128` as mandated. No `f64` anywhere in the money path.
- **`InvestSurplus` left exactly as the story requires.** `financial_health/evaluator.rs` was not touched; `InvestSurplus` stays in the gate per FR6; `invest_surplus_step_with_a_positive_surplus_suggests_something` exists with a `// why` comment naming `evaluator.rs:76-83` so a future reader does not delete it as unreachable.
- **`queryKeys.suggestedAllocation` already existed** (added by Story 32.1's `useReorderProjects` invalidation). Reused, not redefined — no second key.
- **`nav-qa.spec.ts` mock case added even though it is a no-op today**: that spec's `default` branch already resolves `[]`, so the case is documentary. `projects.spec.ts`'s `default` *rejects*, so its case is load-bearing for Story 32.3 and carries a comment saying so.
- **Finding, not acted on:** `db/projects.rs` is now 429 production LOC (1451 including its in-file test module), over the 250-LOC review threshold. This is inherited from Epic 31, not introduced here (+34 LOC from this story). The architecture's Enforcement Guidelines require all project SQL to go through `db/projects.rs`, and this story lists `db/mod.rs` as deliberately not touched, so splitting it is out of scope and belongs in a dedicated refactor.
- Confirmed out of scope and untouched: no migration, no `MIGRATIONS` change, no new crate, no new npm package, no new rusqlite feature, no i18n key, no component, no route, no change to `financial_health/` or `db/financial_health.rs`, no write to `accounts.balance_cents`.

### File List

**New**

- `apps/desktop/src-tauri/src/projects/mod.rs`
- `apps/desktop/src-tauri/src/projects/allocation.rs`

**Modified**

- `apps/desktop/src-tauri/src/lib.rs` — `mod projects;`; registered `commands::projects::get_suggested_allocation`
- `apps/desktop/src-tauri/src/models/mod.rs` — `ProjectAllocationSuggestion`
- `apps/desktop/src-tauri/src/db/projects.rs` — `get_active_allocation_projects()` + 3 tests (archived/aggregation, zero-saved `LEFT JOIN` path, NFR4 five-call regression)
- `apps/desktop/src-tauri/src/commands/projects.rs` — read-only `get_suggested_allocation`
- `apps/desktop/src/lib/types.ts` — `ProjectAllocationSuggestion`
- `apps/desktop/src/hooks/useProjects.ts` — `useSuggestedAllocation()`
- `apps/desktop/src/hooks/__tests__/useProjects.test.tsx` — wire-contract + no-invalidation tests
- `apps/desktop/tests/nav-qa.spec.ts` — `get_suggested_allocation` mock case
- `apps/desktop/tests/projects.spec.ts` — `get_suggested_allocation` mock case
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `32-2-…` → `review`

