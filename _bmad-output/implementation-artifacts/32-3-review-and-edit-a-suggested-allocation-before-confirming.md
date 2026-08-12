# Story 32.3: Review and edit a suggested allocation before confirming

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user reviewing a suggested allocation,
I want to see and adjust each project's proposed amount before anything is saved,
so that I stay in full control of my own money.

**Scope:** Frontend only. This story renders and edits data that Story 32.2 already fetched, and enforces the FR7 cap client-side. **It performs no `invoke()` of any mutation and creates no database rows — viewing and editing are pure client-side operations against already-fetched, read-only data.** Story 32.4 wires the confirm button to the only write path.

## Acceptance Criteria

1. **Given** a suggested allocation has been computed for my active projects
   **When** I view the suggestion panel
   **Then** I see every eligible active project's proposed amount side by side, each independently editable, plus the available monthly surplus and the running edited total

2. **Given** I edit one or more proposed amounts
   **When** the edited total exceeds my available monthly surplus
   **Then** the confirm control is disabled and a translated, screen-reader-announced message explains the overage, and I cannot proceed until the total is within the surplus

3. **Given** the edited total is within the available surplus
   **When** I view the panel
   **Then** the confirm control is enabled

4. **Given** I edit proposed amounts (any number of times, to any values)
   **When** the panel is inspected
   **Then** nothing has been saved — no mutation command is invoked, no `project_contributions` row is created, and no project's saved total changes

5. **Given** the suggested allocation is empty (I am gated out by my waterfall step, my surplus is not positive, or I have no eligible active projects)
   **When** I visit the projects surface
   **Then** the panel renders nothing at all — no empty state, no zero-value placeholder, no "not eligible" message

6. **Given** I have edited amounts and the underlying suggestion is refetched (e.g. after a priority reorder)
   **When** new data arrives
   **Then** my draft is re-seeded from the new suggestion rather than silently mixing stale edits with new projects

7. **Given** I set a project's amount to zero, or clear the field
   **When** the total is computed
   **Then** zero is a valid, non-blocking value (it means "skip this project this month"), and the total is computed without it

8. **Given** the panel's controls
   **When** used with the keyboard and a screen reader
   **Then** each amount field has an associated translated label naming its project, the total/overage region is announced on change, and all copy exists in both `en.json` and `fr.json`

## Tasks / Subtasks

- [x] **Task 1 — Pure validation helper, test-first** (AC: #2, #3, #7)
  - [x] Write the failing test first: `apps/desktop/src/lib/__tests__/allocation.test.ts`, following the plain-Vitest style of the existing `src/lib/__tests__/agents.test.ts` (Vitest `include` is `src/**/*.test.{ts,tsx}` per `apps/desktop/vitest.config.ts`)
  - [x] Create `apps/desktop/src/lib/allocation.ts` exporting two pure functions and nothing else:
        `export function sumAllocationCents(drafts: Record<number, number>): number`
        `export function validateAllocationTotal(totalCents: number, availableSurplusCents: number): { ok: boolean; overageCents: number }`
  - [x] `validateAllocationTotal` returns `ok: true, overageCents: 0` when `totalCents <= availableSurplusCents`, otherwise `ok: false` with `overageCents = totalCents - availableSurplusCents`
  - [x] Tests: total below the cap → ok; total exactly equal to the cap → **ok** (the cap is inclusive — FR7 blocks only when the total *exceeds* the surplus); total one cent over → not ok with `overageCents === 1`; an empty draft map → total `0`, ok; a draft map containing zeros → total ignores them naturally; `availableSurplusCents === 0` with a positive total → not ok
  - [x] Integer cents only — no `parseFloat`, no division, no rounding in these helpers (project rule 1)
  - [x] **These helpers must not reimplement any weighting.** They sum user-entered integers and compare to a cap. All allocation math stays in Rust (`projects/allocation.rs`) so the two sides cannot diverge

- [x] **Task 2 — `SuggestedAllocationPanel.tsx`** (AC: #1, #5, #6, #7)
  - [x] Create `apps/desktop/src/components/projects/SuggestedAllocationPanel.tsx` exactly at the path the architecture specifies
  - [x] Props: `{ suggestions: ProjectAllocationSuggestion[]; availableSurplusCents: number; onConfirm: (allocations: { project_id: number; amount_cents: number }[]) => void; onSkip: () => void; isSubmitting?: boolean; footer?: React.ReactNode }` — a controlled, presentational component. It performs **no** `useQuery` and **no** `useMutation` of its own; the route supplies the data and the callbacks
  - [x] Return `null` immediately when `suggestions.length === 0` (AC #5), mirroring the "no empty/zero-value card clutter" rule Story 31.4 applies to the dashboard card
  - [x] Hold drafts in `useState<Record<number, number>>` keyed by `project_id`, seeded from each suggestion's `suggested_cents`
  - [x] Re-seed the draft map with a `useEffect` whenever the `suggestions` array identity changes and no submit is in flight (AC #6), mirroring the draft-resync `useEffect` in `src/components/shared/InlineEdit.tsx:128-132`. Drop draft keys for projects no longer present and seed keys for newly present projects — never merge a stale key set with a new one
  - [x] Render one row per suggestion, showing: project name, `saved_cents` / `target_cents` progress, and the editable amount. Compose the progress display from `Meter` + `Badge` + `Money` out of `@nixus/shared`, following the row composition in `src/components/budget/BudgetCategoryRow.tsx:138-183`. If Story 31.1's `ProjectRow.tsx` already encapsulates that progress display, reuse it rather than duplicating it
  - [x] Use `MoneyInput` from `@/components/shared/MoneyInput` for each editable amount — it already takes and emits **cents** (`value: number` / `onChange: (cents: number) => void`), renders the `$` affix, and handles the display/edit/blur formatting. Do **not** create a new money input and do **not** convert to dollars anywhere (project rule 8, project rule 1)
  - [x] Show, per row, the project's `remaining_cents`. When an edited amount exceeds `remaining_cents`, show a **non-blocking** informational hint only. Do not block: FR7's only blocking rule is the surplus cap, and deliberately over-funding a goal is a legitimate user choice. (`projects/allocation.rs` caps its *suggestion* at `remaining_cents`; the user may raise it.)
  - [x] Show the deadline context the backend already computed — `target_date` and `months_to_target` — so the weighting is legible rather than magical (the PRD's transparent-math requirement). Format dates with `date-fns` per existing usage; render nothing for `null`
  - [x] Render a footer with the surplus, the running total, the remainder/overage, a confirm control (disabled per Task 3) calling `onConfirm(...)` with the current drafts mapped to `{ project_id, amount_cents }`, and a skip control calling `onSkip()`. Also render the `footer` slot — Story 32.4 uses it to add the source-account selector required by the `project_contributions.account_id` NOT NULL foreign key
  - [x] Entries whose draft is `0` are still rendered and still included in the `onConfirm` payload; it is Story 32.4's command that decides a zero amount creates no row

- [x] **Task 3 — Wire the FR7 block** (AC: #2, #3, #8)
  - [x] Compute `total = sumAllocationCents(drafts)` and `const { ok, overageCents } = validateAllocationTotal(total, availableSurplusCents)` on every render — never store derived validation state
  - [x] Disable the confirm control when `!ok` (and when `isSubmitting`). Disable, do not hide — a vanished button is not an explanation
  - [x] Render the overage message in a container with `role="status"` and `aria-live="polite"` so the change is announced, and reference it from each amount field via `aria-describedby` when `!ok`. Set `aria-invalid` on fields only where the repo already does so (`src/components/expenses/AddExpenseForm.tsx:107-134` is the precedent for `aria-invalid` / `aria-describedby` on a `MoneyInput`)
  - [x] Never call `onConfirm` while `!ok`, even if the control is somehow activated — the guard lives in the handler as well as in the `disabled` prop

- [x] **Task 4 — Mount the panel on the projects surface** (AC: #1, #5)
  - [x] In `apps/desktop/src/routes/wealth.projects.tsx` (created by Story 31.1), call `useSuggestedAllocation()` (Story 32.2) and `useFinancialHealthSummary()` (existing, `src/hooks/useFinancialHealth.ts`) and render `<SuggestedAllocationPanel />` above the project list
  - [x] Derive the cap as `summary?.savings?.avg_monthly_surplus_cents ?? 0`. **Both levels are optional** — `FinancialHealthSummary.savings` is `None` and `avg_monthly_surplus_cents` is `None` when the app lacks sufficient history (`src-tauri/src/db/financial_health.rs:142-153`). Treat an absent value as `0`, which makes any positive total fail validation and keeps confirm disabled. This is consistent by construction: when data is insufficient the evaluator returns `BuildEmergencyFund`, so the suggestion array is empty anyway and the panel renders nothing
  - [x] While either query is loading, render nothing for the panel (no skeleton) — absence is the designed state for a surface that may legitimately never appear
  - [x] For this story, `onConfirm` and `onSkip` are wired to local behaviour only: `onSkip` dismisses the panel for the session (local state); `onConfirm` is a placeholder the route owns and Story 32.4 replaces with the `confirm_project_allocations` mutation. **Do not add any mutation call in this story** (AC #4)
  - [x] **Do not mount this panel on the dashboard.** The PRD's user journey mentions a dashboard nudge, but no FR or Epic-32 story requires one, and FR10's dashboard card (`components/dashboard/SavingsProjectsCard.tsx`) belongs to Story 31.4. Mounting the panel inside the `/wealth/projects` route also keeps it out of the always-mounted component set, so only the specs that visit that surface need a new invoke-mock case (see Task 6)

- [x] **Task 5 — i18n** (AC: #8)
  - [x] Add the keys from Dev Notes → "i18n keys" to **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` in the same change, in Story 31.1's flat `projects.*` namespace
  - [x] Add them to `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/projects-i18n.test.ts` (created by Story 31.1; if absent, create it from the `src/locales/__tests__/profile-i18n.test.ts` template)
  - [x] No hardcoded English in JSX — every visible string and every `aria-label` goes through `t()`
  - [x] Amount and total figures render through `Money` / `useFormatCurrency`, which already returns the masked placeholder when values are hidden (`src/hooks/useFormatCurrency.ts`); do not double-mask

- [x] **Task 6 — Playwright coverage** (AC: #1, #2, #3, #4, #5, #7)
  - [x] In `apps/desktop/tests/projects.spec.ts` (Story 31.1 lists this spec as optional and 31.2 extends it — **create it from the `apps/desktop/tests/accounts.spec.ts:3-40` self-contained-mock template if it does not exist**), add a `get_suggested_allocation` case to the `window.__TAURI_INTERNALS__.invoke` switch mock returning a fixed two-project suggestion array, plus a `get_financial_health_summary` case returning a known `savings.avg_monthly_surplus_cents`. Without both, the calls fall through to `default: Promise.reject("Unknown command: ...")` and the route renders in an error state — see `apps/desktop/tests/accounts.spec.ts:3-158` for the mock shape
  - [x] **Mock hygiene beyond this spec:** the panel makes `get_suggested_allocation` a *load-time* invoke on `/wealth/projects`, and `apps/desktop/tests/nav-qa.spec.ts` walks that surface (its `SURFACES` list at `:101-119`, extended by Story 31.1) and **fails on any console error**. Add `case "get_suggested_allocation": return Promise.resolve([]);` to nav-qa's mock switch (`:37-91`) if Story 32.2 has not already. `get_financial_health_summary` is already mocked there at `:67`. Audit no other spec — nothing else visits `/wealth/projects`
  - [x] Test: the panel lists one editable amount per suggested project, pre-filled with the suggested values, and shows the surplus and total
  - [x] Test: editing an amount so the total exceeds the surplus disables the confirm control and shows the overage message; reducing it back re-enables the control
  - [x] Test: a total exactly equal to the surplus leaves confirm **enabled** (the inclusive-boundary case)
  - [x] Test: setting one amount to zero keeps confirm enabled
  - [x] Test (AC #4, the important one): drive several edits, then assert that the spec's recorded invoke log contains **no** `confirm_project_allocations` and **no** `create_project_contribution` call. Record invoked command names into a `window`-scoped array inside `addInitScript` and read it back with `page.evaluate` — this is the observable proof that editing writes nothing
  - [x] Test: with `get_suggested_allocation` mocked to `[]`, the panel is absent from the page entirely

- [x] **Task 7 — Verification** (AC: all)
  - [x] `pnpm --filter @nixus/desktop test` passes, including the new `src/lib/__tests__/allocation.test.ts` and locale parity
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean under `noUnusedLocals` / `noUnusedParameters` (project rule 7)
  - [x] `pnpm --filter @nixus/desktop exec playwright test projects` green
  - [x] Confirm this story touched **no** Rust file, added **no** npm package, created **no** new UI primitive, and introduced **no** `useMutation` or `invoke()` call

## Dev Notes

### What this story is, in one sentence

A controlled review form over already-fetched read-only data, plus one inclusive-boundary cap check. **Zero backend work, zero writes.**

### The no-write guarantee, restated because it is the point of the story

FR8 and NFR4 mean the review step must be inert: *"No DB writes occur unless the user explicitly confirms"* and *"The suggested-allocation computation must not persist any data until user confirmation"* [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements`, `#9. Non-Functional Requirements`]. The epic's third AC for this story is the same claim from the user's side: *"nothing has been saved yet — editing amounts on screen creates no database rows."*

Mechanically, in this story that means:

- The panel imports **no** `useMutation` and calls **no** `invoke()`. Its only data inputs are props.
- The route's only new backend calls are the two `useQuery` reads (`get_suggested_allocation`, `get_financial_health_summary`), both of which are read-only commands by construction.
- There is no autosave, no debounce-and-persist, no draft table, and no `localStorage` persistence of drafts. If the user closes the surface, the edits are gone — that is correct.
- The `onConfirm` prop exists so Story 32.4 can attach the single write path without restructuring the component. It is not wired to anything that writes in this story.

Story 32.4's Playwright test asserts the complementary half (skipping leaves zero rows). Task 6's invoke-log test asserts this half.

### The cap is inclusive — pin this down

FR7: *"Users can edit each project's suggested amount before confirming, with the total capped at the available monthly surplus"* → test criterion: *"UI blocks confirm if edited total **exceeds** surplus amount"* [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements`]. So:

```
total <  surplus  → allowed
total == surplus  → allowed   ← the boundary case; do not off-by-one this
total >  surplus  → blocked, with overageCents = total - surplus
```

`validateAllocationTotal` exists as a separately unit-tested pure function specifically so this boundary is pinned by a test rather than by a `<=` buried in JSX. Story 32.4's server-side check must use the same inclusive comparison; a mismatch means the UI enables a confirm the backend then rejects.

### Where the surplus cap comes from, and why not from the suggestion payload

`get_suggested_allocation` returns a bare `Vec<ProjectAllocationSuggestion>` with no envelope [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns`], so the cap comes from the existing financial-health summary query:

```typescript
const { data: summary } = useFinancialHealthSummary();
const availableSurplusCents = summary?.savings?.avg_monthly_surplus_cents ?? 0;
```

Two `Option` levels to respect, both from `src-tauri/src/db/financial_health.rs:142-153`: `savings` is `None` when `data_sufficient` is false, and `avg_monthly_surplus_cents` is `None` when `income_month_count == 0`. `?? 0` handles both. This is also why the panel must not try to infer the cap by summing `suggested_cents` — the suggestion total equals `min(surplus, Σ remaining)` and can be strictly less than the surplus, which would silently under-cap the user's edits.

`queryKeys.financialHealthSummary` (`src/lib/constants.ts:60`) is already invalidated by the flows that change income/expense figures, so no new invalidation wiring is needed here. Note that a *contribution* does not change the surplus (contributions never touch `accounts`, `expenses`, or `income_entries`), so Story 32.4 must **not** invalidate the financial-health keys.

### Reuse only — do not invent primitives

`MoneyInput` (`src/components/shared/MoneyInput.tsx`) is the exact control needed and already speaks cents on both sides of its API:

```typescript
interface MoneyInputProps {
  value: number;              // cents
  onChange: (cents: number) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
}
```

It formats `cents/100` for display, strips non-numeric input, clamps to two decimals, converts back with `Math.round(dollars * 100)`, shows the raw value on focus and reformats on blur, and renders the `$` affix over a shared `<Input money inputMode="decimal">`. **All cents↔display conversion is already solved inside it — never do that arithmetic in the panel.**

`InlineEditMoney` (`src/components/shared/InlineEdit.tsx:109-191`) is *not* the right control here: it is a click-to-edit-then-save-on-blur affordance that fires a save callback and a success toast per field, which is exactly the persist-as-you-type behaviour AC #4 forbids. Use raw `MoneyInput` in a form, as `src/components/expenses/AddExpenseForm.tsx:107-134` does.

For the per-project progress display, `src/components/budget/BudgetCategoryRow.tsx` is the referenced pattern [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Frontend Architecture`]: a name + `Money … / Money` pair + a `Badge` + a `Meter` with a `valueText` sentence. Note the architecture's boundary rule — *"the `BudgetCategoryRow` shape (referenced as a pattern, not imported cross-feature)"* [Source: `#Architectural Boundaries`]: **do not import from `components/budget/` into `components/projects/`.** Recompose from `@nixus/shared` primitives, or reuse Story 31.1's own `ProjectRow.tsx`.

`react-hook-form` is available and is the repo's form library, but a `Record<number, number>` draft map with `useState` is simpler than a dynamic field array here and is what the resync requirement (AC #6) wants. Either is acceptable; do not add a new form library.

### Draft resync (AC #6) — the trap

The project set can change under the panel: a reorder (Story 32.1) invalidates `queryKeys.suggestedAllocation`, and a manual contribution (Story 31.2) changes saved totals. If the draft map is seeded once with `useState(initial)` it will keep stale keys for removed projects and miss newly eligible ones, and the total will be computed over a project set the user is not looking at. Re-seed on `suggestions` change, skipping the reseed while a submit is in flight, exactly as `InlineEdit.tsx:128-132` guards its draft resync with an `isEditing` check.

### Testing approach for this story, given the repo's constraints

`apps/desktop` has **no `@testing-library/react`** and its Vitest suite is limited to locale-parity specs and hook tests using `createRoot`/`act` directly [Source: `docs/project-context.md#Testing Rules`]. Therefore:

- **Component behaviour is tested with Playwright**, in `apps/desktop/tests/projects.spec.ts`. That is where AC #1, #2, #3, #5, #7 and the no-write assertion live.
- **The validation boundary is tested with Vitest** as a pure function, which is why Task 1 extracts it into `src/lib/allocation.ts`. Precedent for a pure `src/lib/` helper with a Vitest test: `src/lib/agents.ts` + `src/lib/__tests__/agents.test.ts`. `vitest.config.ts` includes `src/**/*.test.{ts,tsx}`, so the file is picked up with no config change.
- **Locale parity** is enforced automatically by `src/locales/__tests__/`.

E2E runs against the plain Vite dev server on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per spec — there is no real IPC in that suite, so the "no write occurred" assertion must be made against the recorded invoke log, not against a database.

### i18n keys

Flat dotted keys, added to `en.json` **and** `fr.json` in the same change, inside the `projects.*` namespace.

| Key | EN | FR |
| --- | --- | --- |
| `projects.suggestionTitle` | `Suggested monthly split` | `Répartition mensuelle suggérée` |
| `projects.suggestionIntro` | `Based on your priority order and target dates. Nothing is saved until you confirm.` | `Basée sur votre ordre de priorité et vos dates cibles. Rien n'est enregistré avant votre confirmation.` |
| `projects.suggestionAmountLabel` | `Amount for {{name}}` | `Montant pour {{name}}` |
| `projects.suggestionSurplus` | `Available monthly surplus` | `Surplus mensuel disponible` |
| `projects.suggestionTotal` | `Allocated` | `Réparti` |
| `projects.suggestionRemainder` | `{{amount}} left unallocated` | `{{amount}} non réparti` |
| `projects.suggestionOverBy` | `{{amount}} over your available surplus. Lower an amount to continue.` | `{{amount}} de plus que votre surplus disponible. Réduisez un montant pour continuer.` |
| `projects.suggestionExceedsRemaining` | `More than this goal still needs` | `Plus que ce qu'il reste à atteindre pour cet objectif` |
| `projects.suggestionMonthsToTarget` | `{{count}} month(s) to target` | `{{count}} mois avant la date cible` |
| `projects.suggestionConfirm` | `Confirm split` | `Confirmer la répartition` |
| `projects.suggestionSkip` | `Skip this month` | `Passer ce mois-ci` |

`{{name}}`, `{{amount}}`, and `{{count}}` placeholders must survive translation in both files — the `projects-i18n.test.ts` template (copied from `profile-i18n.test.ts`) guards placeholder preservation. The intro string's second sentence is load-bearing product copy, not decoration: SC5 requires that the user understands nothing is applied without confirmation.

### Dependencies on Epic 31 and Story 32.2 — the exact names to build against

- From Story 31.1: `routes/wealth.projects.tsx`, `components/projects/ProjectRow.tsx`, `hooks/useProjects.ts`, the flat `projects.*` i18n namespace, and `src/locales/__tests__/projects-i18n.test.ts` (modelled on `locales/__tests__/recurring-i18n.test.ts`). TypeScript types `Project`, `ProjectContribution` in `src/lib/types.ts`.
- From Story 31.2: `components/projects/ProjectContributionForm.tsx`, which builds its source-account `Select` **inline** rather than reusing `components/shared/OptionalAccountSelect.tsx` — that shared control prepends a `{ value: "", label: t("common.none") }` option because expenses and income may have no account, which is invalid for a contribution (`project_contributions.account_id` is `NOT NULL`). Story 32.4 reuses 31.2's inline select in this panel's `footer` slot; this story leaves the slot empty.
- From Story 32.2: `ProjectAllocationSuggestion` in `src/lib/types.ts`, `queryKeys.suggestedAllocation` (`["suggested-allocation"]`), and `useSuggestedAllocation()` in `hooks/useProjects.ts`. **This story adds no backend call of its own.**

### Explicitly out of scope

No Rust changes of any kind. No `confirm_project_allocations`, no `ProjectAllocationInput`, no source-account selector, no mutation, no query invalidation (Story 32.4). No `reorder_projects` UI (Story 32.1). No dashboard nudge or dashboard card change. No new npm package. No new shared UI primitive. No autosave, no draft persistence. No milestone/gamification visual states (explicitly deferred in the PRD's Growth/Vision split).

### Project Structure Notes

```
apps/desktop/src/
├── components/projects/
│   └── SuggestedAllocationPanel.tsx        # NEW — controlled review form, renders null when empty
├── lib/allocation.ts                        # NEW — sumAllocationCents, validateAllocationTotal
├── lib/__tests__/allocation.test.ts         # NEW — boundary tests for the FR7 cap
├── routes/wealth.projects.tsx               # MODIFIED (created 31.1): mounts the panel,
│                                            #   supplies suggestions + surplus + local onSkip
└── locales/en.json, fr.json                 # MODIFIED: 11 new projects.suggestion* keys, both files

apps/desktop/src/locales/__tests__/projects-i18n.test.ts  # MODIFIED (or NEW): + REQUIRED_KEYS
apps/desktop/tests/projects.spec.ts                       # MODIFIED (created 31.1): 2 mock cases,
                                                          #   invoke-log recorder, 6 tests
```

**No Rust file is touched by this story.** `src-tauri/**`, `migrations/`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `src/lib/navigation.ts`, `src/components/dashboard/**`, `src/components/budget/**`, and every spec other than `tests/projects.spec.ts` are all untouched.

**Variance from the architecture's file tree, with rationale:** the tree lists `SuggestedAllocationPanel.tsx` (created here as specified) but no `lib/allocation.ts`. That file is added so the FR7 boundary is unit-testable without `@testing-library/react`, which this app does not have; the precedent for a pure `src/lib/` helper plus a `src/lib/__tests__/` spec is `src/lib/agents.ts`. It contains only summing and comparison — no weighting logic is duplicated from Rust.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 32.3: Review and edit a suggested allocation before confirming` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR7, NFR4]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR7: total capped at the available monthly surplus; "UI blocks confirm if edited total exceeds surplus amount"]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#2. Success Criteria` — SC5: 100% of suggested contributions require an explicit confirm action to persist a row]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#4. User Journeys` — review → edit → confirm or skip]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#3. Product Scope` — "editable per-project amounts before confirming"; milestone visuals are Growth-phase]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Frontend Architecture` — `components/projects/SuggestedAllocationPanel.tsx`; reuse `BudgetCategoryRow`'s meter/badge shape; no new primitives]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Architectural Boundaries` — `BudgetCategoryRow` is a referenced pattern, not a cross-feature import]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — `get_suggested_allocation` returns a bare `Vec`, writes nothing; only `confirm_project_allocations` writes]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Process Patterns` — read/write separation must not be collapsed]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Enforcement Guidelines` — check `@nixus/shared/ui` and existing components before creating any UI primitive]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Cross-Cutting Concerns Identified` — all new UI strings go through i18next]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)` — integer cents; formatting only in the UI layer]
- [Source: `docs/project-context.md#7. TypeScript Strictness` — `noUnusedLocals` / `noUnusedParameters` are CI failures]
- [Source: `docs/project-context.md#8. Shared UI Components` — check `@nixus/shared/ui` first; never duplicate an existing component]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — keys only in `lib/constants.ts`]
- [Source: `docs/project-context.md#Testing Rules` — desktop has no `@testing-library/react`; Vitest covers locale parity + hooks; Playwright covers user flows against a stubbed `invoke`; the always-mounted-component mock trap at line 295]
- [Source: `docs/project-context.md#i18n (Both Apps)` — no hardcoded English in JSX]
- [Source: `apps/desktop/src/components/shared/MoneyInput.tsx` — cents-in/cents-out editable money control, `$` affix, focus/blur formatting]
- [Source: `apps/desktop/src/components/shared/InlineEdit.tsx:109-191` — `InlineEditMoney` saves on blur (the wrong affordance here); `:128-132` — the draft-resync `useEffect` pattern to copy]
- [Source: `apps/desktop/src/components/expenses/AddExpenseForm.tsx:107-134` — `MoneyInput` in a form with `aria-invalid` / `aria-describedby`]
- [Source: `apps/desktop/src/components/budget/BudgetCategoryRow.tsx:138-183` — name + `Money`/`Money` + `Badge` + `Meter` row composition, `valueText` masking via `useValuesHidden`]
- [Source: `apps/desktop/src/hooks/useFinancialHealth.ts` — `useFinancialHealthSummary()`, the source of the surplus cap]
- [Source: `apps/desktop/src-tauri/src/db/financial_health.rs:142-153` — `savings` and `avg_monthly_surplus_cents` are both `Option`]
- [Source: `apps/desktop/src/lib/constants.ts:59-61` — `queryKeys.financialHealthSummary`]
- [Source: `apps/desktop/src/hooks/useFormatCurrency.ts` — already returns the masked placeholder when values are hidden; do not double-mask]
- [Source: `apps/desktop/src/lib/agents.ts`, `apps/desktop/src/lib/__tests__/agents.test.ts` — precedent for a pure `lib/` helper with a Vitest spec]
- [Source: `apps/desktop/vitest.config.ts` — jsdom, globals, `include: ["src/**/*.test.{ts,tsx}"]`]
- [Source: `apps/desktop/tests/accounts.spec.ts:3-158` — `page.addInitScript` `__TAURI_INTERNALS__.invoke` switch mock, `default: Promise.reject("Unknown command")`]
- [Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — `REQUIRED_KEYS` + EN/FR parity + placeholder-preservation + orphan-key test template]
- [Source: `apps/desktop/src/locales/en.json` — flat dotted-key locale format]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `pnpm --filter @nixus/desktop test` → 14 files, 223 tests passed (includes the 9 new `src/lib/__tests__/allocation.test.ts` cases and projects locale parity).
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → clean.
- `pnpm --filter @nixus/desktop exec playwright test tests/projects.spec.ts tests/nav-qa.spec.ts` → 27 passed.
- `cargo build` in `src-tauri` → `Finished dev profile` (no Rust file touched by this story).
- Full Playwright suite: 435 passed / 2 failed, both in `tests/expenses.spec.ts` (search placeholder, row actions). Both pass when `tests/expenses.spec.ts` is run on its own (19/19), so they are pre-existing full-suite parallelism flake and share no code path with this story.

### Completion Notes List

- The FR7 cap lives in `src/lib/allocation.ts` as two pure functions (`sumAllocationCents`, `validateAllocationTotal`) with the inclusive boundary pinned by its own Vitest case: `total === surplus` is allowed, `total === surplus + 1` fails with `overageCents === 1`. No weighting logic was duplicated from `projects/allocation.rs`.
- `SuggestedAllocationPanel.tsx` is fully presentational: props in, callbacks out. It imports no `useQuery`, no `useMutation`, and no `invoke`. Verified observationally by the new `editing amounts invokes no write command at all` spec, which records every invoked command name into `window.__INVOKE_LOG__` inside `addInitScript` and asserts neither `confirm_project_allocations` nor `create_project_contribution` appears after four edits.
- **Deviation (file split):** the panel came in at 257 pure LOC, over the project's 250-line ceiling, so the per-suggestion row was extracted to `components/projects/SuggestedAllocationRow.tsx` (panel 158, row 120). The architecture's file tree names only `SuggestedAllocationPanel.tsx`; the split is structural only and adds no new UI primitive or cross-feature import. `ALLOCATION_OVERAGE_ID` is exported from the row module so the panel's live region and the rows' `aria-describedby` cannot drift apart.
- **Deviation (draft resync mechanics):** the resync guard uses a `useRef` holding the last-seeded `suggestions` identity rather than depending on `suggestions` alone, so a change to `isSubmitting` cannot trigger a reseed on its own. A `seedVersion` counter is used as the row `key`: `MoneyInput` seeds its own display string on mount, so without a remount a re-seeded draft would be counted in the total but not shown in the field.
- `ProjectRow.tsx` was deliberately not reused. It takes a `Project` and carries the reorder controls, the row action menu and the expand/`ProjectDetail` affordance — none of which belong in a review form. The progress display was recomposed from `Meter` + `Badge` + `Money`, following `BudgetCategoryRow`'s shape as a pattern with no import from `components/budget/`.
- Per-row over-funding (draft > `remaining_cents`) renders an informational hint only. The surplus cap is the single blocking rule.
- The route derives the cap as `healthSummary?.savings?.avg_monthly_surplus_cents ?? 0` and renders nothing for the panel while either query is loading. `onConfirm` and `onSkip` both dismiss the panel for the session — no mutation, no invalidation. Story 32.4 replaces the confirm path.
- 11 `projects.suggestion*` keys added to `en.json` and `fr.json` in the same change, all 11 added to `REQUIRED_KEYS`, and 4 of them added to the placeholder-parity list. `budget.ofSeparator` was added to `REQUIRED_FOREIGN_KEYS` because the row borrows it for its screen-reader-only `/` separator.
- `tests/projects.spec.ts`'s mock helper is now parameterised (`setupTauriMock(page, suggestion, surplusCents)`) and gained `get_suggested_allocation` and `get_financial_health_summary` cases; the existing 13 tests keep the empty-suggestion default and are unchanged. `tests/nav-qa.spec.ts` already mocked both commands (Story 32.2), so no other spec needed a mock change.

### File List

**New**
- `apps/desktop/src/lib/allocation.ts`
- `apps/desktop/src/lib/__tests__/allocation.test.ts`
- `apps/desktop/src/components/projects/SuggestedAllocationPanel.tsx`
- `apps/desktop/src/components/projects/SuggestedAllocationRow.tsx`

**Modified**
- `apps/desktop/src/routes/wealth.projects.tsx`
- `apps/desktop/src/locales/en.json`
- `apps/desktop/src/locales/fr.json`
- `apps/desktop/src/locales/__tests__/projects-i18n.test.ts`
- `apps/desktop/tests/projects.spec.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

