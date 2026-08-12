# Story 31.4: See total saved toward goals on the dashboard

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user,
I want to see my total progress across all savings goals from the main dashboard,
so that I don't have to visit the Projects page to check in.

## Acceptance Criteria

1. **Given** I have at least one active project with contributions
   **When** I view the Finance "Today" dashboard
   **Then** I see a summary card showing the total amount saved across all active projects

2. **Given** I have no active projects
   **When** I view the dashboard
   **Then** the card is not shown (no empty/zero-value card clutter)

3. **Given** I log or delete a contribution
   **When** the mutation succeeds
   **Then** the dashboard card's figure updates without requiring a manual page refresh

4. **Given** the card is rendered
   **When** the component tree is inspected
   **Then** it is composed from the existing `DashboardMetricCard` in its `secondary` variant — no new card primitive is introduced, and it is not the surface's `hero` figure

5. **Given** the summary command
   **When** it runs
   **Then** it performs zero writes, and archived projects' contributions are excluded from the total

## Tasks / Subtasks

- [x] **Task 1 — Summary model** (AC: #1, #2, #5)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add:
    ```rust
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SavingsProjectsSummary {
        pub active_project_count: i64,
        pub total_saved_cents: i64,
        pub total_target_cents: i64,
    }
    ```
  - [x] Derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`, `snake_case` fields, no `rename_all`. This is a "summary struct" of the kind the architecture's `models/mod.rs` tree entry anticipates.
  - [x] `active_project_count` exists because AC #2 requires the card to disappear when there are no active projects — the frontend cannot distinguish "no projects" from "projects with nothing saved yet" from a total alone, and those two states have different correct renderings. `total_target_cents` is included so the card can show a `Meter`/secondary line without a second round trip; if the implemented card does not use it, drop the field rather than leaving it unread (project rule 9).
- [x] **Task 2 — `db/projects.rs`: the rollup aggregation (TDD each)** (AC: #1, #2, #5)
  - [x] Add `pub fn get_savings_projects_summary(conn: &Connection) -> Result<SavingsProjectsSummary, AppError>` to `apps/desktop/src-tauri/src/db/projects.rs`.
  - [x] Use the single query in Dev Notes → "The rollup query": one `query_row` returning `(active_project_count, total_saved_cents, total_target_cents)`. Do not issue three separate queries and do not compute the total in Rust by summing the Story-31.2 `get_project_saved_totals` vector — a dedicated aggregate is what the architecture calls for ("a new db aggregation") and keeps NFR1 comfortable.
  - [x] `WHERE p.archived_at IS NULL` on both the count and the sums (AC #5). Contrast with Story 31.3's earmark query, which deliberately does *not* filter archived projects — the two answer different questions and the rationale is in Dev Notes.
  - [x] `COALESCE(SUM(...), 0)` on every aggregate — `SUM` over zero rows is `NULL` in SQLite and would fail the `i64` row-get. Precedent: `db/account.rs:106`, `db/dashboard.rs:15-22`.
  - [x] No writes of any kind in this function (AC #5).
- [x] **Task 3 — Command + registration** (AC: #1, #5)
  - [x] In `apps/desktop/src-tauri/src/commands/projects.rs`, add:
    ```rust
    #[tauri::command(rename_all = "snake_case")]
    pub fn get_savings_projects_summary(
        state: State<DbState>,
    ) -> Result<SavingsProjectsSummary, AppError>
    ```
    locking with `state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?` and delegating to `projects_db::get_savings_projects_summary`. Shape: `commands/dashboard.rs`'s read commands / `commands/account.rs:41-48`.
  - [x] **No audit log** — reads never write (architecture "Enforcement Guidelines").
  - [x] Register `commands::projects::get_savings_projects_summary` in the `generate_handler![...]` list in `apps/desktop/src-tauri/src/lib.rs`.
- [x] **Task 4 — Frontend type, query key, hook** (AC: #1, #3)
  - [x] Add a `SavingsProjectsSummary` interface to `apps/desktop/src/lib/types.ts` mirroring the Rust shape.
  - [x] Add `savingsProjectsSummary: ["savings-projects-summary"] as const` to `queryKeys` in `apps/desktop/src/lib/constants.ts`. This is the "dashboard's savings-summary query key" the architecture requires contribution mutations to invalidate.
  - [x] Add `useSavingsProjectsSummary()` to `apps/desktop/src/hooks/useProjects.ts` — a plain `useQuery` calling `invoke<SavingsProjectsSummary>("get_savings_projects_summary")`.
  - [x] **Wire the invalidation this story owns** (AC #3): add `queryClient.invalidateQueries({ queryKey: queryKeys.savingsProjectsSummary })` to the `onSuccess` of **every** mutation in `useProjects.ts` — `useCreateProjectContribution`, `useDeleteProjectContribution` (Story 31.2), and `useCreateProject`, `useUpdateProject`, `useArchiveProject` (Story 31.1). Create/update change `total_target_cents` and `active_project_count`; archive changes all three; contributions change `total_saved_cents`.
  - [x] Confirm by reading the file that no mutation was missed — a stale dashboard figure after archiving a project is an AC #3 failure just as much as one after a contribution.
- [x] **Task 5 — `SavingsProjectsCard.tsx`** (AC: #1, #2, #4)
  - [x] Create `apps/desktop/src/components/dashboard/SavingsProjectsCard.tsx`. Note the folder: it goes in `components/dashboard/`, **not** `components/projects/` — that is the location the architecture's file tree specifies, and it matches the existing dashboard-card taxonomy (`CashFlowSummaryCard.tsx`, `FinancialHealthCard.tsx`, `NetWorthSparkline.tsx` all live there).
  - [x] The component takes **no props**: it calls `useSavingsProjectsSummary()` itself, mirroring `components/dashboard/FinancialHealthCard.tsx`, which self-fetches via `useFinancialHealthSummary()` and is mounted prop-free at `routes/index.tsx:186`.
  - [x] Return `<DashboardMetricCard ... isLoading />` while the query is pending, and `null` once resolved if `active_project_count === 0` (AC #2). Order matters: check `isPending` first, then the zero-project case, so a cold load does not flash a card that then disappears.
  - [x] Compose from `@/components/dashboard/DashboardMetricCard` with `variant="secondary"`, `title={t("dashboard.savingsProjects")}`, `value={moneyNode(total_saved_cents)}`, `valueLabel={money(total_saved_cents)}`, and `href="/wealth/projects"`.
  - [x] `variant` is mandatory on `DashboardMetricCard` (`DashboardMetricCard.tsx:21`) and `"secondary"` is required by the surface's rule: `hero` is *"the surface's one `text-display` figure"* and `routes/index.tsx:148` already spends it on budget remaining. Passing `"hero"` would put two display figures on the dashboard.
  - [x] `valueLabel` is required whenever `value` is not a string (`DashboardMetricCard.tsx:18`) — it is what the card speaks in its accessible name when `href` makes it a link (`:88-90`). Follow `routes/index.tsx:194-199` exactly: `value={moneyNode(cents)}` + `valueLabel={money(cents)}`.
  - [x] Money rendering respects hide-values: reuse the `money()` / `moneyNode()` helper shape from `routes/index.tsx:67-77` (`formatMoney` + `<Money masked maskedLabel>` with `useValuesHidden()`), or `useFormatCurrency()` — do not format currency by hand and do not bypass masking.
  - [x] Optional and preferred if `total_target_cents > 0`: a `progressBar={<Meter ... />}` slot showing saved-vs-target, following the budget hero card's `progressBar` usage at `routes/index.tsx:165-175`. Guard on `total_target_cents > 0` and give the `Meter` a localized `valueText` that falls back to `t("common.amountHidden")` when values are hidden.
  - [x] Add a `data-testid` on the card wrapper if a distinct hook is needed for E2E; note `DashboardMetricCard` already emits `data-testid="metric-card"` and `"metric-value"` (`:110`, `:117`), and `tests/dashboard.spec.ts:5-7` selects cards by filtering `metric-card` on its label text — prefer that existing convention over a new test id.
- [x] **Task 6 — Mount it on the dashboard** (AC: #1, #4)
  - [x] In `apps/desktop/src/routes/index.tsx`, mount `<SavingsProjectsCard />` inside the secondary metrics grid (`routes/index.tsx:190-244`, the `grid-cols-1 sm:grid-cols-2 min-[1100px]:grid-cols-4` block) — that is the row for secondary figures and it already holds Net worth / Cash / Investments / Assets.
  - [x] Because the card can render `null`, a CSS grid is the right container: a suppressed card simply leaves no cell, which is why no conditional wrapper is needed in the route.
  - [x] Do **not** place it in the hero row (`:125-187`) — that row is capped by the one-`hero`-figure rule and already holds the budget hero, cash-flow, and financial-health cards.
  - [x] Add the import; keep `noUnusedLocals` clean.
- [x] **Task 7 — i18n keys in both locales** (AC: #1)
  - [x] Add the keys from Dev Notes → "i18n keys" to `apps/desktop/src/locales/en.json` **and** `fr.json` in the same change.
  - [x] The card title lives in the `dashboard.*` namespace (it is a dashboard string, beside `dashboard.cash`, `dashboard.investments`, `dashboard.assets`); the meter label may live in `projects.*`. Extend `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` for the `projects.*` keys; the `dashboard.*` keys are covered by the general parity assertions in the existing locale specs — add them to a `REQUIRED_KEYS` list only if a `dashboard`-prefixed spec exists.
- [x] **Task 8 — Rust unit tests (write first)** (AC: #1, #2, #5)
  - [x] Extend `db/projects.rs`'s `#[cfg(test)] mod tests`, reusing the existing `projects_test_db()` helper.
  - [x] Test: no projects at all → `active_project_count == 0`, `total_saved_cents == 0`, `total_target_cents == 0` (proves the `COALESCE`s; this is the AC #2 data state).
  - [x] Test: one active project with two contributions → `active_project_count == 1` and `total_saved_cents` equals their sum.
  - [x] Test: two active projects with contributions → the total spans both projects and `active_project_count == 2`.
  - [x] Test: an active project with **no** contributions still counts toward `active_project_count` and contributes `0` to `total_saved_cents` (AC #2's boundary: the card shows, with `$0`).
  - [x] Test (AC #5): an **archived** project with contributions is excluded from all three figures. Verify by archiving a project that has contributions and asserting the total drops by exactly that project's amount and the count drops by one.
  - [x] Test: contributions from multiple different accounts to the same project are all counted once (no double counting from a bad join).
  - [x] Test (AC #5): `SELECT COUNT(*)` on `projects` and on `project_contributions`, plus every account's `balance_cents`, are unchanged after calling `get_savings_projects_summary`.
- [x] **Task 9 — Playwright / spec-mock audit (HIGHEST-RISK TASK IN THIS STORY)** (AC: #1, #2, #3)
  - [x] `routes/index.tsx` is the app's landing surface, so adding an `invoke` call there triggers exactly the trap documented at `docs/project-context.md:295`: every existing spec whose Tauri mock is a `switch` on the command name will fall through to `Promise.reject("Unknown command")` for `get_savings_projects_summary` and render this card in its error state.
  - [x] Audit and add a mock case to every spec that navigates to `/`: `apps/desktop/tests/dashboard.spec.ts`, `app-launch.spec.ts`, `navigation.spec.ts`, `nav-qa.spec.ts` (its `SURFACES` list begins with `["today", "/"]`), `accessibility.spec.ts`, `design-system.spec.ts`, `onboarding.spec.ts`, `auth.spec.ts`, `profile.spec.ts`, `chat.spec.ts`, `ai-navigation.spec.ts`, `maintenance.spec.ts`, `financial-health.spec.ts`. Confirm the list by grepping for `goto("/")` before you start, and treat any spec that lands on `/` as in scope.
  - [x] The neutral mock is `case "get_savings_projects_summary": return Promise.resolve({ active_project_count: 0, total_saved_cents: 0, total_target_cents: 0 });` — with `active_project_count: 0` the card suppresses itself, so no existing dashboard layout or card-count assertion changes. Use this everywhere except where you are deliberately testing the card.
  - [x] Note `tests/dashboard.spec.ts` passes its mocks through a single `addInitScript` object argument, with an in-file comment explaining that a second argument is silently dropped (`dashboard.spec.ts:64-67`). Respect that structure when adding data there.
  - [x] Positive coverage in `tests/dashboard.spec.ts`: with `active_project_count: 2, total_saved_cents: 450000`, the card appears with the formatted figure; with `active_project_count: 0`, no card with that label exists. Select via `page.getByTestId("metric-card").filter({ hasText: label })`, the helper already defined at `dashboard.spec.ts:5-7`.
  - [x] Invalidation coverage for AC #3 is best asserted in `tests/projects.spec.ts` (log a contribution, navigate to `/`, see the updated figure) or via a `hooks/__tests__/useProjects.test.tsx` invalidation test — a full-suite mock cannot prove cache invalidation on its own.
- [x] **Task 10 — Verification** (AC: all)
  - [x] `cargo test` green; `cargo clippy --all-targets` adds zero new warnings.
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean; `pnpm --filter @nixus/desktop test` passes.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — **full** suite, not just `dashboard.spec.ts`. A missed mock in an unrelated spec is the expected failure mode of this story.
  - [x] `git diff` grep confirms no new card primitive was created and `DashboardMetricCard.tsx` itself is unmodified (AC #4).
  - [x] `git diff` grep for `f64` in Rust → zero matches; no write to `accounts` anywhere.

## Dev Notes

### What this story is, in one sentence

One read-only rollup aggregation, one command, one dashboard card composed from `DashboardMetricCard`, mounted on `/`, plus the invalidation that keeps it fresh — and a mock-audit across every spec that visits the dashboard.

### The rollup query

```sql
SELECT COUNT(DISTINCT p.id),
       COALESCE(SUM(c.amount_cents), 0),
       COALESCE((SELECT SUM(target_cents) FROM projects WHERE archived_at IS NULL), 0)
FROM projects p
LEFT JOIN project_contributions c ON c.project_id = p.id
WHERE p.archived_at IS NULL
```

Three things this shape gets right:

- **`LEFT JOIN`, not `JOIN`** — an active project with no contributions must still be counted (AC #2's boundary case: one project, nothing saved → the card shows `$0`, it does not disappear).
- **`COUNT(DISTINCT p.id)`** — the join multiplies project rows by their contributions, so a plain `COUNT(*)` would report 4 for one project with four contributions.
- **`total_target_cents` comes from a correlated subquery, not from `SUM(p.target_cents)`** over the joined set — the join would multiply each project's target by its contribution count. The same defensive pattern (a scalar subquery inside the select list to avoid join multiplication) is already used at `db/dashboard.rs:15-22`.

`COALESCE(..., 0)` is mandatory on both sums: `SUM` over zero rows returns `NULL` in SQLite, and reading `NULL` into `i64` is a rusqlite type error, so the "brand new install, no projects" path would fail at runtime instead of returning zeros. Precedents: `db/account.rs:106`, `:122`; `db/dashboard.rs:15-22`.

### Archived projects: excluded here, included in Story 31.3

These two are not inconsistent — they answer different questions:

- **This story** answers *"how much have I saved toward the goals I'm actively working on?"* Archived goals are, by definition, not being worked on, and FR2's contract is that archived projects are *"hidden from active lists and allocation suggestions but retain history."* A dashboard rollup is an active list in aggregate form. → `WHERE archived_at IS NULL`.
- **Story 31.3** answers *"where is the money in this account labelled?"* Money earmarked for an archived goal is still labelled, and dropping it would break the segments-sum-to-balance invariant that PRD SC4 measures. → no `archived_at` filter.

If a future story wants "total ever saved including archived goals", that is a second figure, not a change to this one.

### The card: compose, do not invent

`components/dashboard/DashboardMetricCard.tsx` is the existing primitive and its API is:

```typescript
interface DashboardMetricCardProps {
  title: string;
  /** Pass a `<Money>` node for currency; a plain string only for counts and non-money figures. */
  value: ReactNode;
  /** The figure spoken in the card's accessible name. Required when `value` is not a string. */
  valueLabel?: string;
  trend?: TrendInfo;
  /** `hero` is the surface's one `text-display` figure. Every other card is `secondary`. */
  variant: "hero" | "secondary";
  /** Route-typed, not `string`: a plain string let the pre-migration `/budget` path compile. */
  href?: LinkProps["to"];
  progressBar?: ReactNode;
  isLoading?: boolean;
}
```

Four API facts that determine the call:

1. **`variant` is required and must be `"secondary"`.** The doc comment states the rule; `routes/index.tsx:148` already holds the surface's single `hero`. `variant` selects `Stat` vs `SubStat` internally (`DashboardMetricCard.tsx:86`).
2. **`valueLabel` is required here** because `value` is a `<Money>` node, not a string: the accessible name is built as `` `${title}: ${spokenValue}${trendLabel}` `` and `spokenValue` falls back to `""` for non-string values (`:88-90`). Without it a screen reader announces the title and nothing else.
3. **`href` is `LinkProps["to"]`, not `string`** — pass the literal `"/wealth/projects"` so the route type checks. Supplying `href` makes the whole card a keyboard-operable link (`:94-109`); that is desirable here (the card is a shortcut to the Projects surface) and requires no extra work.
4. **`isLoading` renders the built-in three-row skeleton** (`:59-68`, `:82-84`) — use it instead of writing a skeleton in the new component.

The architecture is explicit: *"Dashboard card → new `SavingsProjectsCard` composed from `DashboardMetricCard` (secondary-row variant, single 'total saved across active projects' figure) — matches existing card taxonomy, no new card primitive."*

### Self-fetching card, following `FinancialHealthCard`

`FinancialHealthCard` is the precedent for a prop-free, self-fetching dashboard card that owns its own empty/insufficient state: it calls `useFinancialHealthSummary()` internally, renders a dedicated skeleton or empty card depending on the response, and is mounted as bare `<FinancialHealthCard />` at `routes/index.tsx:186`. Follow that. The alternative (fetch in `routes/index.tsx` and pass props, as `CashFlowSummaryCard` does at `:179-183`) also exists in the codebase, but self-fetching keeps the "hide when there are no projects" decision inside the component, where AC #2 lives.

Note the deliberate difference from `FinancialHealthCard`: it renders an explicit `InsufficientDataCard` empty state because *"`data_sufficient: false` is a first-class state, not an error"* for financial health. This card does the opposite — AC #2 requires **no card at all** ("no empty/zero-value card clutter"). Returning `null` is the specified behaviour, not an oversight.

### Money and hide-values

`routes/index.tsx:67-77` defines the two helpers this card needs:

```typescript
const amountHidden = t("common.amountHidden");
const money = (cents: number) =>
  hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });
const moneyNode = (cents: number) => (
  <Money cents={cents} locale={i18n.language} masked={hidden} maskedLabel={amountHidden} />
);
```

`hidden` comes from `useValuesHidden()` (`@/contexts/ValuesVisibilityContext`). Replicate this pair inside `SavingsProjectsCard` (it is four lines and keeps the card prop-free) or use `useFormatCurrency()` from `@/hooks/useFormatCurrency`, which already returns the masked placeholder. **Do not** double-mask: if you pass a `useFormatCurrency()` string as `value`, do not also pass `masked`.

Never format currency by hand and never divide cents by 100 for display outside these helpers (project rule 1: display formatting happens in the UI layer, through the provided utilities).

### Invalidation: every mutation, not just contributions

The architecture requires *"every contribution mutation's `onSuccess` invalidates ... and the dashboard's savings-summary query key."* AC #3 names contributions specifically. But the card's figures also move on project mutations:

| Mutation | Which summary field changes |
| --- | --- |
| `useCreateProjectContribution` | `total_saved_cents` |
| `useDeleteProjectContribution` | `total_saved_cents` |
| `useCreateProject` | `active_project_count`, `total_target_cents` |
| `useUpdateProject` | `total_target_cents` |
| `useArchiveProject` | all three |

Add `invalidateQueries({ queryKey: queryKeys.savingsProjectsSummary })` to all five `onSuccess` bodies. Project rule 6 is "invalidate **all** affected query keys" — the mirror obligation applies here: this key must be invalidated by every mutation that affects it.

### i18n keys

Both `en.json` and `fr.json`, same change.

| Key | EN | FR |
| --- | --- | --- |
| `dashboard.savingsProjects` | `Saved toward goals` | `Épargné pour vos objectifs` |
| `projects.dashboardMeterLabel` | `Progress across all active goals` | `Progression de tous vos objectifs actifs` |
| `projects.dashboardMeterValue` | `{{saved}} of {{target}} across {{count}} goals` | `{{saved}} sur {{target}} pour {{count}} objectifs` |

Reused as-is: `common.amountHidden` (masking fallback) and `nav.projects` (from Story 31.1, if the card labels its link). `dashboard.savingsProjects` sits beside the existing `dashboard.cash` / `dashboard.investments` / `dashboard.assets` keys in the same flat namespace.

If `total_target_cents` ends up unused (no `Meter` in the shipped card), drop both `projects.dashboardMeter*` keys **and** the struct field rather than leaving either unread.

### Dependencies and sequencing

- **Depends on Story 31.2** — the contribution rows this rolls up, and the two contribution mutations whose `onSuccess` this story extends.
- **Depends on Story 31.1** — migration 025, `db/projects.rs`, `commands/projects.rs`, `hooks/useProjects.ts`, the `/wealth/projects` route this card links to, and the `projects.*` locale namespace.
- **Independent of Story 31.3** — no earmark data is read here. 31.3 and 31.4 can be implemented in either order.
- Nothing depends on this story.

### Testing standards

- **Rust:** extend the inline `#[cfg(test)] mod tests` in `db/projects.rs` with the existing `projects_test_db()` helper. In-memory SQLite, `PRAGMA foreign_keys=ON`, plain `#[test]` fns, `assert_eq!` on concrete cent values. Precedents: `db/budget.rs:379-440`, `db/account.rs:464-480`.
- **The archived-exclusion test is the load-bearing one**: it is the only thing that distinguishes this aggregation from Story 31.3's, and getting it backwards produces a plausible-looking but wrong dashboard figure.
- **Commands are not unit-tested** in this codebase — keep `get_savings_projects_summary` a two-line orchestrator.
- **Frontend:** locale parity spec extension for the `projects.*` keys. A `hooks/__tests__/useProjects.test.tsx` invalidation test is the cheapest honest proof of AC #3; follow `src/hooks/__tests__/useBudgetTemplates.test.tsx` (`createRoot`/`act`, no `@testing-library/react` in the desktop app).
- **Playwright:** the suite runs against the Vite dev server with `window.__TAURI_INTERNALS__.invoke` stubbed per spec; there is no real IPC. Because this story adds an `invoke` to the landing route, the mock audit in Task 9 is not optional — it is the difference between a green suite and a dozen confusing failures. [Source: `docs/project-context.md#Testing Rules`, line 295]
- **Zero new warnings** from `cargo clippy` and `tsc`.

### Explicitly out of scope

No migration change, no per-project detail on the card, no trend/sparkline (no AC asks for one, and `trend` would need a historical series this feature does not store), no modification to `DashboardMetricCard` or any other existing dashboard card, no earmark breakdown (Story 31.3), no change to `commands/account.rs` (Story 31.5), no allocation suggestions or nudge (Epic 32 — the suggestion nudge on the dashboard is Epic 32's, not this card), no new UI primitive, no new dependency, no version bump.

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── models/mod.rs                                    # MODIFIED — + SavingsProjectsSummary
├── db/projects.rs                                   # MODIFIED — + get_savings_projects_summary
│                                                    #            + tests
├── commands/projects.rs                             # MODIFIED — + get_savings_projects_summary (read)
└── lib.rs                                           # MODIFIED — register 1 command

apps/desktop/src/
├── components/dashboard/SavingsProjectsCard.tsx      # NEW — composed from DashboardMetricCard
├── routes/index.tsx                                 # MODIFIED — mount it in the secondary grid
├── hooks/useProjects.ts                             # MODIFIED — + useSavingsProjectsSummary;
│                                                    #            + summary invalidation in ALL
│                                                    #              five project/contribution mutations
├── lib/constants.ts                                 # MODIFIED — + queryKeys.savingsProjectsSummary
├── lib/types.ts                                     # MODIFIED — + SavingsProjectsSummary
├── locales/en.json, fr.json                         # MODIFIED — dashboard.savingsProjects (+ meter keys)
└── locales/__tests__/projects-i18n.test.ts          # MODIFIED — + REQUIRED_KEYS

apps/desktop/tests/
├── dashboard.spec.ts                                # MODIFIED — mock case + positive/suppressed coverage
├── app-launch.spec.ts, navigation.spec.ts,          # MODIFIED — neutral mock case
│   nav-qa.spec.ts, accessibility.spec.ts,
│   design-system.spec.ts, onboarding.spec.ts,
│   auth.spec.ts, profile.spec.ts, chat.spec.ts,
│   ai-navigation.spec.ts, maintenance.spec.ts,
│   financial-health.spec.ts
└── projects.spec.ts                                 # MODIFIED — contribution → dashboard freshness
```

**One new file only** (`SavingsProjectsCard.tsx`); the rest are extensions. The card deliberately lives in `components/dashboard/`, matching the architecture's file tree and the existing dashboard-card taxonomy, even though it is a Projects feature — dashboard composition is the dashboard folder's job.

**Deliberately not touched:** `components/dashboard/DashboardMetricCard.tsx` (composed, not modified — AC #4), `CashFlowSummaryCard.tsx`, `FinancialHealthCard.tsx`, `NetWorthSparkline.tsx`, `db/dashboard.rs` and `commands/dashboard.rs` (this aggregation belongs in the projects domain per project rule 3's one-`db`-file-per-domain rule, not in the dashboard module), `db/account.rs`, `commands/account.rs`, `migrations/`, `db/mod.rs`, `lib/navigation.ts`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Variance note, with rationale:** the aggregation lands in `db/projects.rs` rather than `db/dashboard.rs`, even though it feeds the dashboard. `docs/project-context.md` rule 3 says one `db/` file per **domain**, and the architecture assigns *all* project SQL — *"all SQL (CRUD + earmark aggregation queries)"* — to `db/projects.rs`. Splitting projects SQL across two db modules by consumer would make the projects domain harder to reason about than the one dashboard import costs.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 31.4: See total saved toward goals on the dashboard` — acceptance criteria, copied faithfully, incl. "card is not shown" and "updates without a manual refresh"]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR10]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Additional Requirements` — reuse `DashboardMetricCard`, no new design-system primitives; invalidate all affected query keys incl. the dashboard savings query]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR10: "Card renders on `/` (Finance Today) and updates after any contribution change"]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR2: archived projects are hidden from active lists (basis for the archived exclusion)]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Frontend Architecture` — `SavingsProjectsCard` composed from `DashboardMetricCard`, secondary-row variant, single total figure, no new card primitive]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Cross-Cutting Concerns Identified` — the dashboard card's query key must be invalidated by contribution mutations]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns` — invalidate `projects`, `project(id)`, `accountEarmarks(accountId)` and the dashboard savings-summary key]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Requirements to Structure Mapping` — FR10 → `components/dashboard/SavingsProjectsCard.tsx`, wired into `routes/index.tsx`]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Structure Patterns` / `#Enforcement Guidelines` — all project SQL in `db/projects.rs`; no `get_*` command may write]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)`; `#2. Tauri IPC Commands`; `#3. Database Operations Belong in db/ Only`; `#4. Rust Model Structs`; `#6. TanStack Query Keys`; `#8. Shared UI Components`; `#9. Compilation Warnings Policy`; `#Testing Rules` — especially line 295, the always-mounted-`invoke` mock trap]
- [Source: `apps/desktop/src-tauri/src/db/dashboard.rs:6-31`, `:15-22` — scalar-subquery-in-select-list aggregation and `COALESCE` precedent]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:102-129` — `COALESCE(SUM(...), 0)` precedent]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:464-480`, `apps/desktop/src-tauri/src/db/budget.rs:379-440` — in-memory `#[cfg(test)]` helpers]
- [Source: `apps/desktop/src-tauri/src/commands/account.rs:41-48` — minimal read-command shape]
- [Source: `apps/desktop/src-tauri/src/commands/dashboard.rs` — dashboard read-command precedent]
- [Source: `apps/desktop/src-tauri/src/lib.rs:171-280` — `generate_handler!` registration list]
- [Source: `apps/desktop/src/components/dashboard/DashboardMetricCard.tsx:13-26`, `:59-68`, `:82-90`, `:94-121` — full props contract, skeleton, accessible-name construction, link behaviour, test ids]
- [Source: `apps/desktop/src/components/dashboard/FinancialHealthCard.tsx:1-60` — prop-free self-fetching dashboard card with its own loading/empty states]
- [Source: `apps/desktop/src/routes/index.tsx:67-77` — `money()` / `moneyNode()` hide-values helpers]
- [Source: `apps/desktop/src/routes/index.tsx:125-187` — hero row and the one-`hero`-figure rule in practice]
- [Source: `apps/desktop/src/routes/index.tsx:190-244` — the secondary metrics grid where this card mounts]
- [Source: `apps/desktop/src/routes/index.tsx:148-176`, `:194-206` — `variant`/`href`/`trend`/`progressBar` and the `value` + `valueLabel` pairing in practice]
- [Source: `apps/desktop/src/routes/index.tsx:179-186` — `CashFlowSummaryCard` (props-in) vs `FinancialHealthCard` (self-fetching) mounting styles]
- [Source: `apps/desktop/src/hooks/useAccounts.ts:11-16` — plain `useQuery` hook shape]
- [Source: `apps/desktop/src/lib/constants.ts:1-70` — `queryKeys` flat kebab-case shape]
- [Source: `apps/desktop/tests/dashboard.spec.ts:5-7`, `:22-99` — `metricCard(page, label)` selector helper and the single-object `addInitScript` mock structure]
- [Source: `apps/desktop/tests/nav-qa.spec.ts:101-119` — `SURFACES` begins with `["today", "/"]`; console-error gate]
- [Source: `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` — desktop hook-test style]
- [Source: `apps/desktop/src/locales/__tests__/recurring-i18n.test.ts:1-40` — parity + `REQUIRED_KEYS` pattern]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test` — 486 passed, 0 failed (7 new `savings_summary_*` tests in `db/projects.rs`).
- `cargo clippy --all-targets` — 1 warning, pre-existing (`commands/backup.rs:106`, `explicit_auto_deref`); zero new warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @nixus/desktop test` — 13 files, 210 tests passed (5 new in `hooks/__tests__/useProjects.test.tsx`).
- `pnpm --filter @nixus/desktop exec playwright test` — full suite, 426 passed (4 new in `dashboard.spec.ts`). One earlier run showed a load-related flake in `maintenance.spec.ts:1324` (vehicle slide-over close timing, unrelated to this story); it passes in isolation, passes for the whole `maintenance.spec.ts` file, and passed on the confirming full-suite run.

### Completion Notes List

- TDD order held: the seven `savings_summary_*` tests were written first and confirmed failing with `cannot find function get_savings_projects_summary` before the query was implemented.
- `get_savings_projects_summary` is the single `query_row` from Dev Notes verbatim: `LEFT JOIN`, `COUNT(DISTINCT p.id)`, correlated subquery for `total_target_cents`, `COALESCE(..., 0)` on both sums, `WHERE p.archived_at IS NULL` on the count and the join, and no writes. The `savings_summary_writes_nothing` test asserts row counts and the account balance are unchanged.
- `total_target_cents` is used: the card renders a `Meter` in `progressBar` when it is greater than zero, so neither the field nor the two `projects.dashboardMeter*` keys are left unread.
- All five mutations in `useProjects.ts` invalidate `queryKeys.savingsProjectsSummary` — `useCreateProject`, `useUpdateProject`, `useArchiveProject` directly, and both contribution mutations through the shared `invalidateContributionKeys` helper. Each is covered by a case in `hooks/__tests__/useProjects.test.tsx` (AC #3).
- **Deviation (AC #3 proof):** invalidation is proved by the new `hooks/__tests__/useProjects.test.tsx` rather than by a contribution-then-navigate flow in `tests/projects.spec.ts`. Task 9 offers these as alternatives; the hook test is the honest proof (a Playwright mock cannot observe cache invalidation), and driving `/` from `projects.spec.ts` would have required teaching that spec's stateful mock the whole dashboard command surface. `projects.spec.ts`'s `get_savings_projects_summary` case was still made state-derived rather than a static zero, so the spec's mock stays consistent with the projects it holds.
- **Deviation (spec mock audit):** `app-launch.spec.ts`, `navigation.spec.ts` and `ai-navigation.spec.ts` land on `/` but install **no** `__TAURI_INTERNALS__` mock at all, so there is no switch statement to extend; every `invoke` already rejects there. The card handles that path by design — the query error leaves `data` undefined and the component returns `null`, so no error state renders. The neutral case was added to every spec that does have a mock switch and reaches `/`: `accessibility`, `auth`, `chat`, `dashboard` (all five switches), `design-system`, `financial-health`, `maintenance`, `nav-qa`, `onboarding`, `profile`, plus the state-derived case in `projects`.
- AC #2 ordering is explicit in the component: `isPending` is checked before `active_project_count === 0`, so a cold load shows the built-in skeleton rather than flashing a card that then vanishes.
- AC #4 verified by diff: `DashboardMetricCard.tsx` is unmodified and `SavingsProjectsCard.tsx` is the only new component; the card passes `variant="secondary"`, and the dashboard's single `hero` figure remains budget remaining.
- `git diff -- '*.rs' | grep -c f64` → 0. No write to `accounts` anywhere in this change.

### File List

**Modified — Rust (`apps/desktop/src-tauri/`)**
- `src/models/mod.rs` — added `SavingsProjectsSummary`
- `src/db/projects.rs` — added `get_savings_projects_summary` + 7 tests
- `src/commands/projects.rs` — added the `get_savings_projects_summary` read command
- `src/lib.rs` — registered the command

**New — frontend**
- `apps/desktop/src/components/dashboard/SavingsProjectsCard.tsx`
- `apps/desktop/src/hooks/__tests__/useProjects.test.tsx`

**Modified — frontend (`apps/desktop/src/`)**
- `lib/types.ts` — added `SavingsProjectsSummary`
- `lib/constants.ts` — added `queryKeys.savingsProjectsSummary`
- `hooks/useProjects.ts` — added `useSavingsProjectsSummary`; summary invalidation in all five mutations
- `routes/index.tsx` — mounted `<SavingsProjectsCard />` in the secondary metrics grid
- `locales/en.json`, `locales/fr.json` — `dashboard.savingsProjects`, `projects.dashboardMeterLabel`, `projects.dashboardMeterValue`
- `locales/__tests__/projects-i18n.test.ts` — extended `REQUIRED_KEYS`, `REQUIRED_FOREIGN_KEYS`, and the placeholder-parity list

**Modified — Playwright (`apps/desktop/tests/`)**
- `dashboard.spec.ts` — neutral mock case in all five switches, `setupSavingsDashboardMock`, and four new tests
- `projects.spec.ts` — state-derived `get_savings_projects_summary` case
- `accessibility.spec.ts`, `auth.spec.ts`, `chat.spec.ts`, `design-system.spec.ts`, `financial-health.spec.ts`, `maintenance.spec.ts`, `nav-qa.spec.ts`, `onboarding.spec.ts`, `profile.spec.ts` — neutral mock case

**Modified — tracking**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `31-4-...` → `review`

