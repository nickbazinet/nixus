---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 25.2: Frontend Hook for Budget Templates

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want `useBudgetTemplates.ts` to also expose system-template listing and the apply-system-template mutation,
so that onboarding and Settings UI can share one data-access layer with no duplicated logic.

**Scope:** Frontend only (TypeScript) + one unit-test file extension. **Three files edited, zero files created:** one `queryKeys` entry in `lib/constants.ts`, one interface in `lib/types.ts`, two hooks appended to the **existing** `hooks/useBudgetTemplates.ts` (plus a behaviour-preserving extraction of its invalidation block into a shared module-private helper), and new cases added to the **existing** `hooks/__tests__/useBudgetTemplates.test.tsx`. **No new file. No i18n. No UI component. No Settings change. No onboarding change. No Playwright. No Rust. No migration. No new dependency.**

**FRs:** FR70 (starter-template fork — frontend data layer), FR71 (shared surface reachable from the redirect gate) · **NFRs:** none directly; NFR13 preserved by passing `target_cents` through untouched
**Epic:** [epics-budget-templates.md § Epic 25, Story 25.2](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — § Frontend Architecture (line 175), § API & Communication Patterns (lines 168-169), § Project Structure (Files to CREATE line 245 / MODIFY lines 261-262)
**Predecessors:** [25.1](25-1-canadian-starter-template-definition-list-apply-commands.md) (**HARD** — both Tauri commands) · [24.4](24-4-import-a-community-template-file.md) (**SOFT** — created the hook file, the TS result type, and the `invalidateTrendsQueries` export)

---

## ⛔ SCOPE RECONCILIATION WITH STORY 24.4 — READ FIRST

The epic's four ACs for 25.2 were written before Story 24.4 was scoped. **24.4 already claims and fully satisfies half of them.** This story implements only what is left. Do not re-implement 24.4's half; do not "improve" it.

| Epic 25.2 AC | Status | This story does |
|---|---|---|
| `useSystemTemplates()` query hook | **Not built** | ✅ Adds it |
| `queryKeys.systemBudgetTemplates` in `constants.ts` | **Not built** | ✅ Adds it |
| `useApplySystemTemplate()` mutation | **Not built** | ✅ Adds it |
| `useImportBudgetTemplate()` mutation | **DONE by 24.4** (AC #3) | ❌ Nothing — verify it exists, then leave it alone |
| `useExportBudgetTemplate()` mutation | **DONE by 24.4** (AC #3) | ❌ Nothing — verify it exists, then leave it alone |
| Invalidate `budgetGroups`/`allBudgetCategories`/`budgetStatus` on **import** success | **DONE by 24.4** (AC #4) | ❌ Nothing — reuse its exact key set/order for apply |
| Invalidate the same on **apply** success | **Not built** | ✅ Adds it, via a shared helper so the two can never drift |
| `ApplyBudgetTemplateResult` in `lib/types.ts` | **DONE by 24.4** (AC #1) | ❌ Nothing — import it |
| `SystemBudgetTemplateSummary` in `lib/types.ts` | **Not built** (24.4 AC #1 explicitly excluded it) | ✅ Adds it |
| `hooks/useBudgetTemplates.ts` **file creation** | **DONE by 24.4** (AC #3) | ❌ Append only |
| `hooks/__tests__/useBudgetTemplates.test.tsx` **file creation** | **DONE by 24.4** (AC #17) | ❌ Extend only |

**Net deliverable: 4 things.** `queryKeys.systemBudgetTemplates` · `SystemBudgetTemplateSummary` · `useSystemTemplates()` · `useApplySystemTemplate()` — plus test coverage for the last two.

---

## ⛔ PREREQUISITE GATE

Verified at story-creation time (2026-08-04): **nothing from Epic 24 or 25 is implemented.** `apps/desktop/src/hooks/useBudgetTemplates.ts` does **not** exist; `apps/desktop/src-tauri/src/commands/budget_template.rs` and `src/budget/` do **not** exist; `grep -rn "systemBudgetTemplates\|useSystemTemplates" apps/desktop/src` returns **zero** matches; `ApplyBudgetTemplateResult` and `SystemBudgetTemplateSummary` appear nowhere in `lib/types.ts` (596 lines). All Epic 24/25 stories are `ready-for-dev`, and `git log` contains zero template commits.

**Run this gate before writing any code:**

```bash
cd /Users/nbazinet/projects/nixus
grep -n "list_system_templates\|apply_system_template" apps/desktop/src-tauri/src/lib.rs
grep -n "pub struct SystemBudgetTemplateSummary" apps/desktop/src-tauri/src/models/mod.rs
ls apps/desktop/src/hooks/useBudgetTemplates.ts
grep -n "ApplyBudgetTemplateResult" apps/desktop/src/lib/types.ts
grep -n "export function invalidateTrendsQueries" apps/desktop/src/hooks/useBudget.ts
```

| Gate | Result | Action |
|---|---|---|
| Either command missing from `lib.rs`'s `generate_handler!`, **or** `SystemBudgetTemplateSummary` missing from `models/mod.rs` | **HARD STOP** | Report "Story 25.1 is not done." Do **not** write any Rust here. |
| `hooks/useBudgetTemplates.ts` missing (24.4 not done) | **SOFT** | Create the file with **only** this story's two hooks. Also add `ApplyBudgetTemplateResult` to `lib/types.ts` and the `export` keyword to `invalidateTrendsQueries` (`useBudget.ts:7`) — 24.4's items, absorbed only because nothing works without them. Record both as deviations in Completion Notes. See §Absorption Rules. |
| `hooks/useBudgetTemplates.ts` present | **SOFT** | **Append** the two hooks. Do **not** touch `useImportBudgetTemplate` / `useExportBudgetTemplate` bodies except for the AC #6 helper extraction. |
| `ApplyBudgetTemplateResult` present but with different field names than `{ groups_created, categories_created, skipped_groups }` | — | Use the **actual** names. Do not rewrite the interface. Note the deviation. |

**Record the ACTUAL Rust signatures before typing the TS against them:**

| Command | Expected Rust return (25.1 AC #5/#6) | TS type to declare |
|---|---|---|
| `list_system_templates` | `Result<Vec<SystemBudgetTemplateSummary>, AppError>` | `SystemBudgetTemplateSummary[]` |
| `apply_system_template(template_id: String)` | `Result<ApplyBudgetTemplateResult, AppError>` | `ApplyBudgetTemplateResult` — **not** `\| null` |

**Why no `| null` here (this is the #1 mistake available in this story):** 24.4's two mutations are `T | null` because a cancelled *native dialog* returns `Ok(None)`. `apply_system_template` opens **no dialog** and returns a non-`Option` (25.1 AC #6, §Validation table row "Dialog + cancel"). Copy-pasting 24.4's `| null` + `if (!data) return;` guard into `useApplySystemTemplate` would add a dead branch that silently swallows every invalidation if the type were ever loosened. Same for `list_system_templates`.

---

## Acceptance Criteria

1. **Given** `apps/desktop/src/lib/constants.ts`
   **When** this story is implemented
   **Then** `queryKeys` gains exactly one entry, inserted immediately after `allBudgetCategories` (line 7) to keep the budget cluster contiguous:
   ```ts
   systemBudgetTemplates: ["system-budget-templates"] as const,
   ```
   **And** it is a bare tuple, **not** a factory function — `list_system_templates` takes no arguments
   **And** `as const` is present (all 40 existing entries have it — 100% consistent, `constants.ts:1-58`)
   **And** the key string is `"system-budget-templates"` — never `"budget-templates"`, `"templates"`, or `"system-templates"` (§Naming Collision Warning)
   **And** **no other line of `constants.ts` changes** — no reordering, no reformatting

2. **Given** `apps/desktop/src/lib/types.ts`
   **When** this story is implemented
   **Then** it declares, inserted **immediately after** 24.4's `ApplyBudgetTemplateResult` (locate it by symbol, not by line number — 24.4 shifts every line below `BudgetCategoryStatus`):
   ```ts
   export interface SystemBudgetTemplateSummary {
     id: string;
     name: string;
     description: string | null;
   }
   ```
   **And** `description` is `string | null` — **not** `description?: string`. 25.1 AC #4 declares Rust `Option<String>` with no `#[serde(skip_serializing_if)]`, so the field is always present and serializes to JSON `null`. This matches the read-only-DTO convention at `types.ts:179-180` (`last_amount_cents: number | null`); the `?:` form at `types.ts:31` is reserved for **input** fields a caller may omit
   **And** all three fields are `snake_case`-compatible plain names matching the Rust struct field-for-field (`id`, `name`, `description`)
   **And** it contains **no** `target_cents`, **no** `groups`, and **no** `format_version` — 25.1 AC #4 makes the Rust summary an id/name/description projection, and the epic forbids leaking targets into the list response
   **And** `ApplyBudgetTemplateResult` is **not** re-declared, edited, or moved

3. **Given** `apps/desktop/src/hooks/useBudgetTemplates.ts`
   **When** this story is implemented
   **Then** it additionally exports:
   ```ts
   export function useSystemTemplates() {
     return useQuery({
       queryKey: queryKeys.systemBudgetTemplates,
       queryFn: () => invoke<SystemBudgetTemplateSummary[]>("list_system_templates"),
     });
   }
   ```
   **And** it sets **only** `queryKey` and `queryFn` — no `staleTime`, `gcTime`, `enabled`, `select`, `retry`, `refetchOnWindowFocus`, or `placeholderData` (§Conflict A)
   **And** `invoke` is called with **no** arguments object, matching the zero-arg command signature
   **And** `useQuery` is added to the existing `@tanstack/react-query` import — a second import statement from the same specifier is a lint/readability regression

4. **Given** the same file
   **When** this story is implemented
   **Then** it additionally exports `useApplySystemTemplate()` as a TanStack Query mutation whose `mutationFn` is:
   ```ts
   (templateId: string) =>
     invoke<ApplyBudgetTemplateResult>("apply_system_template", {
       template_id: templateId,
     })
   ```
   **And** the IPC argument key is `template_id` (`snake_case`), while the TS parameter may be `templateId` — mirroring `useBudget.ts:36-38`'s `{ group_id: groupId }`
   **And** the return type carries **no** `| null` and the hook contains **no** `if (!data) return;` cancel guard (§Prerequisite Gate)
   **And** `mutationFn` returns the `invoke` promise directly — it is **not** wrapped in `async` (every mutation in `useBudget.ts` does it this way)

5. **Given** `useApplySystemTemplate()`'s `onSuccess`
   **When** it runs
   **Then** it invalidates exactly these six query keys, in this order: `queryKeys.budgetGroups`, `["budget-categories"]`, `["budget-status"]`, `["spending-trends"]`, `["trends-insight"]`, `queryKeys.allBudgetCategories` — the last three via `invalidateTrendsQueries(queryClient)`
   **And** the set and order are **byte-identical to `useImportBudgetTemplate`'s** (24.4 AC #4) — applying a template and importing one both create groups with targets, so any divergence is a bug
   **And** the two raw prefixes `["budget-categories"]` / `["budget-status"]` are written as literals, **not** as `queryKeys.budgetCategories(id)` / `queryKeys.budgetStatus(y, m)` — both are parameterized factories (`constants.ts:3-6`) and an apply knows neither the new group ids nor the viewed month. Precedented three times at `useBudget.ts:60-62`, `:102-104`, `:120-122` (§Conflict B)

6. **Given** that AC #5's six-key sequence must equal `useImportBudgetTemplate`'s
   **When** this story is implemented
   **Then** the sequence lives in **one** module-private helper in `useBudgetTemplates.ts`, and **both** hooks call it:
   ```ts
   function invalidateAppliedTemplateQueries(queryClient: QueryClient) {
     queryClient.invalidateQueries({ queryKey: queryKeys.budgetGroups });
     // Prefix invalidation: an apply cannot know the new group ids or the viewed
     // month, and queryKeys.budgetCategories/budgetStatus are per-id/per-month factories.
     queryClient.invalidateQueries({ queryKey: ["budget-categories"] });
     queryClient.invalidateQueries({ queryKey: ["budget-status"] });
     invalidateTrendsQueries(queryClient);
   }
   ```
   **And** `useImportBudgetTemplate`'s `onSuccess` body becomes `if (!data) return; invalidateAppliedTemplateQueries(queryClient);` — its `null` guard, its `mutationFn`, its return type, and its exported name are **unchanged**
   **And** this is a **behaviour-preserving extraction**: the calls, their arguments, and their order are identical, so 24.4's existing assertion (`invalidateSpy.mock.calls.map(c => c[0]?.queryKey)` equals the six-key array) still passes **without being edited**
   **And** if 24.4's shipped implementation differs from its own AC #4, extract **what is actually there** — do not "fix" it to match this story's snippet; note the deviation in Completion Notes
   **And** `type QueryClient` is imported from `@tanstack/react-query` for the helper's parameter, exactly as `useBudget.ts:2` does

7. **Given** `useApplySystemTemplate()`'s `onSuccess`
   **When** it runs
   **Then** it does **not** invalidate `queryKeys.systemBudgetTemplates`. `SYSTEM_TEMPLATES` is a compiled Rust const (architecture Decision 2) that cannot change at runtime, so refetching the list after applying it is pure waste
   **And** it does **not** invalidate `queryKeys.onboardingStatus`, does **not** call `queryClient.clear()`, and does **not** call `queryClient.setQueryData` — the onboarding-completion and router-gate concerns belong to Story 25.4

8. **Given** `useBudgetTemplates.ts` as a whole
   **When** this story is implemented
   **Then** it contains **no** `toast` call, **no** `useTranslation`/`t()` call, **no** JSX, and **no** user-facing string. Result formatting, skipped-group copy, and error toasts are Stories 25.3 (Settings) and 25.4 (onboarding); 24.4 already owns the import/export toasts in `YourDataSettings.tsx`
   **And** it contains **no** `try`/`catch` — callers use `mutateAsync` inside their own try/catch (`YourDataSettings.tsx` precedent) or read `mutation.error`

9. **Given** `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` (created by 24.4)
   **When** `pnpm --filter @nixus/desktop test` runs
   **Then** it additionally proves, in the **same file** using the **same** harness:
   - `useSystemTemplates()` invokes `"list_system_templates"` **once**, with **no** second argument, and exposes the resolved array as `data`
   - `useApplySystemTemplate().mutateAsync("canadian-starter")` invokes `"apply_system_template"` with exactly `{ template_id: "canadian-starter" }`
   - a successful apply invalidates the six keys in AC #5's order (assert the same array literal 24.4's import test asserts)
   - `useApplySystemTemplate()` does **not** invalidate `["system-budget-templates"]` (assert that key is absent from `invalidateSpy.mock.calls`)

   **And** every new `it()` reuses 24.4's existing `describe`/`beforeEach`/`afterEach` harness — **no** second `invokeMock`, **no** second `vi.mock("@tauri-apps/api/core", …)` (a duplicate factory for the same specifier is a Vitest hoisting error), **no** new file
   **And** invalidation is asserted by `vi.spyOn(queryClient, "invalidateQueries")`, not by observing refetches
   **And** `@testing-library/react` is **not** imported — it is not a dependency of `@nixus/desktop` (verified: absent from both `dependencies` and `devDependencies`); the harness drives React with `createRoot` + `act`
   **And** `vi.useFakeTimers()` is **not** introduced (no debounce here); if 24.4's `beforeEach` already omits it, leave it omitted
   **And** all pre-existing Vitest specs still pass unchanged

10. **Given** the desktop app
    **When** `pnpm --filter @nixus/desktop build` runs (`tsc && vite build`)
    **Then** it completes with **zero** TypeScript errors or warnings — `strict` + `noUnusedLocals` + `noUnusedParameters` are on, so an unused `SystemBudgetTemplateSummary` import or a leftover `QueryClient` type import is a hard failure
    **And** **no** file under `apps/desktop/src-tauri/`, `apps/web/`, `packages/`, `apps/desktop/src/locales/`, `apps/desktop/src/components/`, `apps/desktop/src/routes/`, or `apps/desktop/tests/` is modified
    **And** `git diff --name-only` lists at most these four paths: `apps/desktop/src/lib/constants.ts`, `apps/desktop/src/lib/types.ts`, `apps/desktop/src/hooks/useBudgetTemplates.ts`, `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` (plus `apps/desktop/src/hooks/useBudget.ts` **only** if the SOFT gate absorbed 24.4's `export` keyword)

---

## Tasks / Subtasks

- [x] **Task 0: Prerequisite gate** (see ⛔ PREREQUISITE GATE)
  - [x] Run all five gate commands. HARD STOP if 25.1 is missing
  - [x] Read the existing `hooks/useBudgetTemplates.ts` end-to-end (~30 lines) and record: its exact import list, `useImportBudgetTemplate`'s literal `onSuccess` body, and whether it imports `invalidateTrendsQueries`
  - [x] Read `apps/desktop/src-tauri/src/commands/budget_template.rs` and record the **actual** signatures of `list_system_templates` / `apply_system_template` and the **actual** `SystemBudgetTemplateSummary` field names/types. Type the TS against reality, not against this story's assumption
  - [x] Read the existing `hooks/__tests__/useBudgetTemplates.test.tsx` and record its harness variable names (`invokeMock`, `queryClient`, `container`, `root`, the `Harness` component shape) so the new cases slot in without redefining anything

- [x] **Task 1: Add the query key** (AC: #1)
  - [x] `apps/desktop/src/lib/constants.ts` — insert `systemBudgetTemplates: ["system-budget-templates"] as const,` immediately after line 7 (`allBudgetCategories: ["all-budget-categories"] as const,`)
  - [x] Bare tuple, not a factory. Do not touch `recurringTemplates` (`:42`) or any other line

- [x] **Task 2: Add the TS summary interface** (AC: #2)
  - [x] `apps/desktop/src/lib/types.ts` — locate `export interface ApplyBudgetTemplateResult` **by symbol** and insert `SystemBudgetTemplateSummary` directly after its closing brace
  - [x] `description: string | null` — not optional-marker form
  - [x] Touch no other interface

- [x] **Task 3: Extract the shared invalidation helper** (AC: #6)
  - [x] In `hooks/useBudgetTemplates.ts`, add module-private `function invalidateAppliedTemplateQueries(queryClient: QueryClient)` above the hooks, containing the exact four statements 24.4 put inline in `useImportBudgetTemplate`
  - [x] Add `import type { QueryClient } from "@tanstack/react-query";` (separate `import type`, as `useBudget.ts:2` does)
  - [x] Replace `useImportBudgetTemplate`'s `onSuccess` body with `if (!data) return;` + one call to the helper. **Change nothing else about that hook** — not its name, not its `mutationFn`, not its `ApplyBudgetTemplateResult | null` return type, not its WHY comment
  - [x] Do not touch `useExportBudgetTemplate` at all
  - [x] Move 24.4's prefix-invalidation WHY comment into the helper (one copy, not two)

- [x] **Task 4: Add `useSystemTemplates()`** (AC: #3)
  - [x] Add `useQuery` to the **existing** `@tanstack/react-query` import (do not add a second import line)
  - [x] Add `SystemBudgetTemplateSummary` to the **existing** `import type { … } from "@/lib/types";`
  - [x] ```ts
        export function useSystemTemplates() {
          return useQuery({
            queryKey: queryKeys.systemBudgetTemplates,
            queryFn: () =>
              invoke<SystemBudgetTemplateSummary[]>("list_system_templates"),
          });
        }
        ```
  - [x] No `staleTime`, no `enabled`, no `select` — see §Conflict A before you add one

- [x] **Task 5: Add `useApplySystemTemplate()`** (AC: #4, #5, #7)
  - [x] ```ts
        export function useApplySystemTemplate() {
          const queryClient = useQueryClient();

          return useMutation({
            // Compiled-const template: no dialog, so no Ok(None)/null branch here
            // (unlike the import/export mutations above).
            mutationFn: (templateId: string) =>
              invoke<ApplyBudgetTemplateResult>("apply_system_template", {
                template_id: templateId,
              }),
            onSuccess: () => {
              invalidateAppliedTemplateQueries(queryClient);
            },
          });
        }
        ```
  - [x] Do **not** invalidate `queryKeys.systemBudgetTemplates` or `queryKeys.onboardingStatus`; do **not** call `queryClient.clear()`
  - [x] Do **not** add a toast, a `t()` call, or a `try`/`catch` (AC #8)

- [x] **Task 6: Extend the hook unit test** (AC: #9)
  - [x] Open the **existing** `hooks/__tests__/useBudgetTemplates.test.tsx`; add `it()` blocks inside its existing `describe`. Reuse its `invokeMock`, `queryClient`, `render()` helper, and `Harness` pattern
  - [x] For the query test, follow `useTrendsInsight.test.tsx:33-48,88-111`: a `Harness` component that calls the hook and returns `null`, then assert on `invokeMock.mock.calls`. To read `data`, assign the hook result to a module-scoped `let` inside the `Harness` and `await act(async () => {})` once to flush the resolved promise
  - [x] Tests to add:

  | Test | Mock resolves | Assert |
  |---|---|---|
  | `lists system templates with no arguments` | `[{ id: "canadian-starter", name: "Canadian Starter Budget", description: "…" }]` | `invokeMock` called once; first arg `"list_system_templates"`; `invokeMock.mock.calls[0].length === 1` (no args object); hook `data` equals the array |
  | `applies a system template by snake_case id` | `{ groups_created: 4, categories_created: 12, skipped_groups: [] }` | `invokeMock` called with `"apply_system_template"` and `{ template_id: "canadian-starter" }` |
  | `apply invalidates every budget-facing query key` | same | `invalidateSpy.mock.calls.map(c => c[0]?.queryKey)` equals `[["budget-groups"], ["budget-categories"], ["budget-status"], ["spending-trends"], ["trends-insight"], ["all-budget-categories"]]` |
  | `apply does not refetch the immutable system-template list` | same | `invalidateSpy.mock.calls.every(c => c[0]?.queryKey?.[0] !== "system-budget-templates")` |
  | `apply surfaces a rejected command as an error` | `Promise.reject({ type: "validation", message: "That starter template is not available.", field: "template_id" })` | `mutateAsync("nope")` rejects with an object whose `.message` is that string — proving no swallow-and-return-null path exists |

  - [x] Add **no** second `vi.mock("@tauri-apps/api/core", …)` and **no** second `invokeMock`
  - [x] Do not modify 24.4's existing `it()` blocks — Task 3's extraction must leave them green untouched

- [x] **Task 7: Verification** (AC: #10)
  - [x] `pnpm --filter @nixus/desktop build` → zero TS errors/warnings
  - [x] `pnpm --filter @nixus/desktop test` → all Vitest specs pass (24.4's two new specs + the pre-existing three, plus this story's cases). Record the total in Completion Notes; do **not** hardcode an expected count
  - [x] `pnpm exec playwright test` from `apps/desktop/` → no regressions. This story adds **no** E2E; nothing renders these hooks yet
  - [x] Confirm untouched: **all of `apps/desktop/src-tauri/**`**, `apps/web/**`, `packages/**`, `src/locales/*.json`, `src/components/**`, `src/routes/**`, `tests/**`, `routeTree.gen.ts`, `hooks/useBudget.ts` (unless the SOFT gate absorbed the one `export` keyword)
  - [x] `git diff --stat` → at most the four paths in AC #10
  - [x] **Do not commit**

### Review Findings

_Adversarial code review, 2026-08-04. Scope: this story's own additions only — `apps/desktop/src/lib/constants.ts` (`queryKeys.systemBudgetTemplates`), `apps/desktop/src/lib/types.ts` (`SystemBudgetTemplateSummary`), `apps/desktop/src/hooks/useBudgetTemplates.ts` (`useSystemTemplates`, `useApplySystemTemplate`, the `invalidateAppliedTemplateQueries` extraction), `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` (5 new tests, `SystemTemplatesHarness`, `settleQueries`). Stories 24-1..24-4 and 25-1 excluded — already reviewed and passed. Independently confirmed **zero** Rust changes from this story: `git diff --name-only -- apps/desktop/src-tauri/` returns only `commands/mod.rs`, `db/mod.rs`, `lib.rs`, `models/mod.rs` — all pre-existing 24-1..25-1 uncommitted work, none touched by this story's diff._

**Verdict: PASS**, after one auto-fixed defect (test-only, non-functional) and one reported test-coverage gap (non-blocking).

**Verification (all re-run, real output):** `tsc --noEmit` — 0 errors. `pnpm --filter @nixus/desktop test` (Vitest) — **56/56 passed, 6 files** (matches Completion Notes exactly: 51 baseline + 5 new). `cargo check --all-targets` — 0 warnings. `cargo test` — **251/251 passed**, unchanged from the 25-1 baseline (confirms the zero-Rust-changes claim). `pnpm exec playwright test tests/accounts.spec.ts:333 tests/accounts.spec.ts:472 tests/expenses.spec.ts:426 tests/maintenance.spec.ts:1561 --workers=1` — **4/4 passed, twice in a row** (independently confirms the dev's flaky-under-parallelism triage; not fixed, per scope). `chat.spec.ts:250` in isolation — **still fails** (`tabular-nums` vs `normal`), confirming it is the same pre-existing, unrelated failure the dev flagged.

**Type fidelity (§ scrutiny a): PASS.** `SystemBudgetTemplateSummary` in `types.ts` (`id: string; name: string; description: string | null`) matches Rust's `models/mod.rs:75-79` (`id: String, name: String, description: Option<String>`) field-for-field. `apply_system_template` (`commands/budget_template.rs:141`) returns `Result<ApplyBudgetTemplateResult, AppError>` — confirmed **not** `Option<T>` by direct source read. The dev's claim holds: no `| null` and no cancel guard is correct, not a defect.

**Refactor safety (§ scrutiny b): PASS.** Compared the current `useImportBudgetTemplate`/`useExportBudgetTemplate` against the 24-4 story's specified baseline body: `useImportBudgetTemplate`'s name, `mutationFn`, `ApplyBudgetTemplateResult | null` return type, dialog WHY comment, and `if (!data) return;` guard are all unchanged; only the four invalidation statements moved into `invalidateAppliedTemplateQueries`, in identical order, called with identical arguments. `useExportBudgetTemplate` is byte-identical to the 24-4 baseline — confirmed untouched. `useBudget.ts` diffed: contains only the pre-existing 24-4 `export` keyword change, nothing added by this story.

**Query key correctness (§ scrutiny c): PASS**, with one gap (see Medium finding below). `systemBudgetTemplates: ["system-budget-templates"] as const` is used consistently as `useSystemTemplates()`'s `queryKey`. Applying a system template invalidates `budgetGroups`/`budget-categories`/`budget-status`/trends via the shared helper, matching import's set — confirmed live via the vitest suite and via mutation testing (below).

**Test-flush deviation (§ scrutiny d): REAL DEFECT, FOUND AND AUTO-FIXED.** The dev's own Debug Log claims `settleQueries()`'s single `setTimeout(…, 0)` macrotask flush was "verified non-flaky across 3 consecutive full-spec runs (9/9 each)." Independently re-ran `vitest run src/hooks/__tests__/useBudgetTemplates.test.tsx` in isolation **20 times**: **13/20 runs failed** (`lists system templates with no arguments` — `expect(systemTemplates.data).toEqual(summaries)` received `undefined`), a ~65% failure rate that directly contradicts the dev's verification note. Root cause: React's scheduler can defer the re-render triggered by a resolved `useQuery` across more than one macrotask turn depending on ambient timing, so a *single* macrotask flush is not a deterministic settle point. **Auto-fixed** (test-only, non-functional, pre-authorized): replaced the fixed single flush with a bounded poll (`for` loop, ≤20 macrotask flushes) on the render-derived hook state (`systemTemplates.isLoading`) rather than on the mock's call record — an initial fix attempt polling `invokeMock.mock.results` was itself wrong and made the test fail 20/20, because a mocked async fn's call record is stamped `"return"` synchronously when it returns its Promise, not when that Promise settles. **Re-verified: 20/20 stable** after the fix, plus a clean 56/56 full-suite run and a clean `tsc --noEmit`.

**Test non-vacuity (§ scrutiny e): one PASS, one gap found.**
- Mutation 1 (invalidation set): temporarily removed the `["budget-categories"]` call from `invalidateAppliedTemplateQueries`. Both `invalidates every budget-facing query key after an import` and `…after an apply` failed as expected (missing key in the asserted array). Reverted; file confirmed byte-identical to the pre-mutation read. **Not vacuous.**
- Mutation 2 (query key): temporarily changed `queryKeys.systemBudgetTemplates` to `["wrong-mutated-key"] as const`. **All 9 tests still passed — zero failures.** This means AC #1's requirement that the key literal be exactly `"system-budget-templates"` has no test that would catch a regression in the *constant's own value* (the "does not refetch…" test hardcodes the literal `"system-budget-templates"` independently of the constant, so it happens to still pass either way). Reverted; `constants.ts` confirmed identical to its pre-mutation diff. **Logged as a Medium finding below — the shipped value is correct today, this is a coverage gap, not a functional bug.**

**Two-harness split (§ scrutiny f): PASS, with a minor process note.** Adding `useApplySystemTemplate()` to the shared `Harness` is safe: mutations do not fire on mount, so none of the 4 pre-existing 24-4 assertions (`toHaveBeenCalledTimes(1)`, `invokeMock.mock.calls[0]`) are perturbed — confirmed by the clean 56/56 run and by the isolated 20-run flush fix cycle, where all 4 pre-existing tests passed every time. `useSystemTemplates()` correctly got its own `SystemTemplatesHarness` because it is a `useQuery` that fetches on mount, which would otherwise break those same assertions. **Minor note (not a defect):** the pre-existing `invalidates every budget-facing query key after an import` test's assertion line was refactored from an inline `invalidateSpy.mock.calls.map(...)` to a new shared `invalidatedKeys()` helper — a literal, if narrow, deviation from Task 6's "do not modify 24.4's existing `it()` blocks" instruction. The refactor is behavior-preserving (same computation, DRY against the new apply-side test) and was necessary to avoid a third copy of the same expression; logged for completeness, no action needed.

**i18n (§ scrutiny g): PASS.** `en.json`/`fr.json` independently diffed: **1129 keys each, identical set, identical order** — unchanged by this story (`git diff --stat` confirms neither locale file appears in this story's own diff; the 1129 count and the en.json/fr.json entries in the repo-wide diff are 24-4's). No hardcoded user-facing string, no `t()`, no `toast`, no JSX in `useBudgetTemplates.ts` — confirmed by full-file read.

**Guidelines compliance:** `docs/guidelines/warnings.md` — all Rust and TypeScript warnings resolved (0/0, confirmed above). `docs/project-context.md` §6/§Hooks Pattern — query keys sourced from `queryKeys`, mutation invalidates all affected keys, followed.

### Findings by Severity

- **[Review][Fixed] HIGH — flaky test, auto-fixed.** `settleQueries()`'s single macrotask flush failed ~65% of the time in isolation (measured over 20 runs), contradicting the dev's own "verified non-flaky ×3" note. Fixed by polling the render-derived hook state with a bounded loop instead of a fixed single flush. Re-verified 20/20 stable, 56/56 full suite, clean `tsc`. File: `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx`.
- **[Review][Defer] MEDIUM — test-coverage gap, not a functional bug.** No test verifies `queryKeys.systemBudgetTemplates`'s literal value independently of `useSystemTemplates()`'s own hardcoded command string; mutating the constant to a wrong value causes zero test failures. The shipped value (`["system-budget-templates"]`) is verified correct by direct code + Rust cross-check today. A future dedicated assertion (e.g. asserting the query's actual cache key, or the constant's value directly) would close this gap — left to a future story since it is a test-strengthening nicety, not a regression. Logged in `deferred-work.md` is not required (in-file note here is sufficient per the story's own low bar for this kind of finding).
- **[Review][Info] LOW — no action needed.** `useApplySystemTemplate()` added to the shared `Harness`, and the pre-existing import-invalidation test's assertion line was refactored to call a new `invalidatedKeys()` helper. Both are behavior-preserving and empirically confirmed not to perturb the 4 pre-existing 24-4 assertions, but are a narrow, literal deviation from "do not modify 24.4's existing `it()` blocks" / "reuse the shared Harness as-is". No functional impact; noted for completeness.

**Dismissed as noise:** the dev's Debug Log table (lines ~461-471) documenting the async-flush investigation is directionally correct (macrotask > microtask for this case) even though its final "verified non-flaky ×3" conclusion did not hold up under a larger sample — 3 runs was simply too small a sample for a ~65%-failure-rate flake to reliably surface (3 consecutive passes has roughly a 4% chance under that failure rate, so the dev was not being careless, just unlucky/under-sampled).

**Scope/AC coverage:** all 10 acceptance criteria independently verified against actual code (not just tests) — AC #1-#8 confirmed by direct source read against the Rust cross-check; AC #9 confirmed by running the suite and inspecting every new test body; AC #10 confirmed via `tsc --noEmit` and `git diff --stat` scope check (only `constants.ts`, `types.ts`, `useBudgetTemplates.ts`, and its test file are this story's changes; `useBudget.ts`'s one-line `export` keyword is 24-4's, confirmed via diff).

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **Append, do not recreate.** `hooks/useBudgetTemplates.ts`, `hooks/__tests__/useBudgetTemplates.test.tsx`, and `ApplyBudgetTemplateResult` are 24.4's. Overwriting the file — the single most likely failure mode here — silently deletes `useImportBudgetTemplate`, `useExportBudgetTemplate`, and the Settings wiring that imports them, breaking `tsc`. If the file exists, `read` it first and edit surgically.
2. **Zero Rust changes.** 25.1 owns both commands, the Rust `SystemBudgetTemplateSummary`, and `SYSTEM_TEMPLATES`. If you open anything under `src-tauri/`, stop — scope violation. [Source: 25-1 §Scope Boundary]
3. **`invoke` comes from `@tauri-apps/api/core`**, never bare `@tauri-apps/api`. All 21 hook files use this exact specifier (`useBudget.ts:3`).
4. **All IPC field names stay `snake_case` end to end.** `template_id`, `groups_created`, `categories_created`, `skipped_groups`, `target_cents`. There is no camelCase mapping layer anywhere in `lib/types.ts` (596 lines, every interface `snake_case`). [Source: project-context.md §2, §4]
5. **Query keys come from `queryKeys`** (project-context.md §6, §Anti-Patterns) — with the two documented, precedented prefix exceptions in §Conflict B.
6. **Every mutation's `onSuccess` invalidates all affected keys.** [Source: project-context.md §6, §Hooks Pattern]
7. **No user-facing strings, no toasts, no i18n, no JSX in this story.** [AC #8]
8. **No comments explaining *what*; only *why*.** [Source: project-context.md §Code Quality] Exactly two WHY comments are warranted: the prefix-invalidation rationale (in the helper) and the no-dialog/no-null note on `useApplySystemTemplate`.
9. **Zero TypeScript warnings.** `strict` + `noUnusedLocals` + `noUnusedParameters`. [Source: project-context.md §7, §9; docs/guidelines/warnings.md]
10. **Never introduce a bare `Template` type or a `queryKeys.templates` entry.** §Naming Collision Warning.

### Absorption Rules (only if 24.4 has not shipped)

If the SOFT gate fires, this story absorbs the **minimum** from 24.4 and nothing more:

| Absorbed | Not absorbed |
|---|---|
| Create `hooks/useBudgetTemplates.ts` with **only** `useSystemTemplates` + `useApplySystemTemplate` + the helper | `useImportBudgetTemplate`, `useExportBudgetTemplate` |
| `ApplyBudgetTemplateResult` in `lib/types.ts` (needed by `useApplySystemTemplate`'s return type) | Any other TS interface |
| `export` keyword on `invalidateTrendsQueries` (`useBudget.ts:7`) — one word, nothing else in that file | Any other `useBudget.ts` change |
| Create `hooks/__tests__/useBudgetTemplates.test.tsx` from the `useTrendsInsight.test.tsx` harness | The i18n parity test, the Playwright spec |
| — | `YourDataSettings.tsx`, `locales/en.json`, `locales/fr.json`, `tests/budget-templates.spec.ts` |

Record every absorbed item in Completion Notes so 24.4 does not redo it.

### Three Conflicts Resolved Here (Binding — Do Not Re-derive)

**Conflict A — should `useSystemTemplates()` set `staleTime: Infinity`?**
The data is a compiled Rust const returned by a command with **no DB access and no file I/O** (25.1 AC #5), so it provably cannot change within a session, and `main.tsx:11` creates the `QueryClient` with **no `defaultOptions`** — library defaults apply (`staleTime: 0`, `refetchOnWindowFocus: true`), meaning the list refetches on every window focus.
**Resolution: set only `queryKey` + `queryFn`.** Every plain list-query hook in this codebase does exactly that and nothing more — `useAccounts.ts:11-16`, `useAssets.ts:11-16`, `useRecurringTemplates` (`useRecurringExpenses.ts:11-16`), `useBudgetGroups` (`useBudget.ts:14-18`), `useOnboardingStatus.ts:14-19`. Zero of them set `staleTime`/`gcTime`/`enabled`/`select`/`refetchOnWindowFocus`. The only two hooks with extra options are special cases: `useTrendsInsight` (a gated, debounced AI call) and `useBudgetStatus` (`placeholderData: keepPreviousData` for month paging). A refetch here costs one no-IO Rust call returning one 3-field object; making this hook the sole list query with a caching override buys nothing and creates a convention the next hook author would have to reconcile. **Do not add `staleTime`.** If the picker later needs it, that is a 25.3/25.4 decision made with real UI in hand.

**Conflict B — the epic says "invalidate the `budgetStatus` query key", but `queryKeys.budgetStatus` is not a key.**
`constants.ts:5-6` defines `budgetStatus: (year, month) => ["budget-status", year, month] as const` and `:3-4` defines `budgetCategories: (groupId) => ["budget-categories", groupId] as const` — both **factories**, not keys. An apply learns neither the created group ids (the result carries counts, not ids) nor the month the user is viewing.
**Resolution: invalidate the raw prefixes `["budget-categories"]` and `["budget-status"]`.** Not an invention — `useBudget.ts:60-62`, `:102-104`, `:120-122` already hardcode the literal `["budget-status"]` in exactly this situation, three times, and 24.4 AC #4 settled the identical question for import. TanStack Query matches keys by **prefix** by default, so `["budget-status"]` covers every `["budget-status", year, month]` entry. `["budget-categories"]` is beyond the epic's stated three keys and is **required**: a mounted `BudgetGroupCard` renders `useBudgetCategories(groupId)` and would otherwise show a stale list for a group whose categories the apply just created. This is a **documented, precedented deviation from project-context.md §6** ("never hardcode query keys in hooks"); the alternative (adding `budgetStatusAll`/`budgetCategoriesAll` entries nothing else uses) would make this story the odd one out among four existing call sites.

**Conflict C — the epic lists all four hooks under 25.2, but 24.4's binding scope note already built two of them.**
Epic AC 25.2 #2 names `useApplySystemTemplate()`, `useImportBudgetTemplate()`, and `useExportBudgetTemplate()`; epic AC #4 names both TS interfaces. 24.4 §Scope Boundary vs. Stories 25.2/25.3 (a *binding* table, reaffirmed by 25.1 §Previous Story Intelligence) assigns the import/export hooks, `ApplyBudgetTemplateResult`, and the test files to **24.4**, leaving 25.2 only the system-template half.
**Resolution: 24.4's table wins** (see §Scope Reconciliation). Rationale: 24.4 is the final story of Epic 24 and would otherwise close its epic with an export command no user can reach; it also had to type `ApplyBudgetTemplateResult` to compile at all. Consequence for this story: epic ACs #2 (import/export halves), #3 (import half), and #4 (`ApplyBudgetTemplateResult`) are **already satisfied** — verify, then leave alone. Re-deriving them is duplicate work that will produce a merge conflict or, worse, a silent overwrite.

### Existing Code to Extend (DO NOT REINVENT)

| Item | File:line | Exact fact |
|---|---|---|
| List-query hook shape (canonical) | `useAccounts.ts:11-16`, `useAssets.ts:11-16`, `useRecurringExpenses.ts:11-16` | `useQuery({ queryKey: queryKeys.x, queryFn: () => invoke<T[]>("get_x") })` — **queryKey + queryFn only**. Copy this shape verbatim for `useSystemTemplates` |
| Budget list-query precedent | `useBudget.ts:14-18` | `useBudgetGroups` — same two-property shape, in the file this hook file is modelled on |
| Mutation shape | `useBudget.ts:42-66` (`useCreateBudgetCategory`) | `useMutation({ mutationFn: (input) => invoke<T>("cmd", {…}), onSuccess: (_data, variables) => {…} })`. `mutationFn` is **not** `async` — it returns the `invoke` promise |
| Single-scalar-arg mutation precedent | `useBudget.ts:24-25` | `mutationFn: (name: string) => invoke<BudgetGroup>("create_budget_group", { name })` — a plain scalar parameter, not an input object. `useApplySystemTemplate(templateId: string)` mirrors this |
| camelCase param → `snake_case` IPC key | `useBudget.ts:36-38` | `invoke<BudgetCategory[]>("get_budget_categories", { group_id: groupId })` — exactly the `{ template_id: templateId }` shape |
| Trends invalidation set | `useBudget.ts:7-11` | `invalidateTrendsQueries(queryClient)` → `["spending-trends"]`, `["trends-insight"]`, `queryKeys.allBudgetCategories`. **Module-private today**; 24.4 AC #2 adds the `export` |
| `QueryClient` type import | `useBudget.ts:2` | `import type { QueryClient } from "@tanstack/react-query";` — separate `import type` line, the pattern for the new helper's parameter |
| Raw `["budget-status"]` precedent | `useBudget.ts:60-62`, `:102-104`, `:120-122` | Three existing call sites hardcode this prefix instead of calling the `budgetStatus(y, m)` factory |
| `queryKeys` shape | `lib/constants.ts:1-58` | 40 entries, every one `as const`; tuples for zero-arg keys, arrow factories for parameterized ones. `budgetGroups: ["budget-groups"]` (`:2`), `allBudgetCategories: ["all-budget-categories"]` (`:7`), `recurringTemplates: ["recurring-templates"]` (`:42`). **No `systemBudgetTemplates` — this story adds it.** No strict alphabetical order; group by domain |
| `lib/types.ts` convention | `types.ts:1-24` (budget cluster), `:179-180`, `:31` | `export interface X { field_name: T; }`, `snake_case`, mirroring Rust DTOs 1:1. Read-only `Option<T>` → `T \| null` (`:179-180`); caller-omittable input → `?: T \| null` (`:31`). 596 lines |
| `QueryClient` instantiation | `main.tsx:11` | `const queryClient = new QueryClient();` — **no `defaultOptions`** anywhere in the app. Library defaults apply (§Conflict A) |
| Exported `fetchX` helper pattern (**not** needed here) | `useOnboardingStatus.ts:10-19` | A free-standing `fetchOnboardingStatus()` reused by router `beforeLoad`. Only add an equivalent for templates if Story 25.4's route gate needs it — **not** this story |
| Hook unit-test harness | `useTrendsInsight.test.tsx:1-112` | The only hook test in the repo, and it tests a `useQuery`. `vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invokeMock(...a) }))` (`:14-16`), `declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }` (`:8-10`), `globalThis.IS_REACT_ACT_ENVIRONMENT = true` (`:64`), `Harness` returning `null` (`:33-48`), `render()` wrapping in `QueryClientProvider` inside `act` (`:55-61`), `new QueryClient({ defaultOptions: { queries: { retry: false } } })` (`:73-75`), `createRoot(container)` (`:78`), `act(() => root.unmount())` + `queryClient.clear()` (`:81-86`), assertions on `invokeMock.mock.calls[0]` (`:104-110`) |
| Fake timers (**do not copy**) | `useTrendsInsight.test.tsx:65,85` | `vi.useFakeTimers()`/`useRealTimers()` exist only for that hook's 500 ms debounce. Neither hook here debounces — omit both |
| Vitest config | `vitest.config.ts:1-15` | `environment: "jsdom"`, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` → `./src`, **no `setupFiles`** (so no jest-dom matchers; use plain `expect`) |
| Test scripts | `package.json:11-12` | `"test": "vitest run"`, `"test:watch": "vitest"`. Build is `"tsc && vite build"` |
| Tauri rejection shape | `src-tauri/src/error.rs:5-13,31-90` | `AppError::Validation` serializes to `{"type":"validation","message":…,"field":…}`; Tauri rejects the promise with that plain object already deserialized. 25.1 AC #7 returns exactly this for an unknown `template_id` — hence the rejection test in Task 6 |

### Scope Boundary vs. Stories 25.3 / 25.4 (binding)

| Item | Owner |
|---|---|
| `queryKeys.systemBudgetTemplates`, `SystemBudgetTemplateSummary`, `useSystemTemplates()`, `useApplySystemTemplate()`, shared invalidation helper | **25.2 (this story)** |
| Starter-template **picker UI** in `YourDataSettings.tsx` + its apply toast + `locales/en.json`/`fr.json` strings | 25.3 |
| Localizing the template `name`/`description` (keyed off `CANADIAN_STARTER_ID`) | 25.3 |
| Surfacing `skipped_groups` copy for the **apply** path | 25.3 (Settings) / 25.4 (onboarding) |
| Onboarding fork starter-template path, **editable-target preview**, FR71 redirect gate, `queryKeys.onboardingStatus` handling | 25.4 |
| Any per-category target **override** at apply time (the epic's 25.4 AC "adjusted targets are persisted") — may need a new Rust command or a follow-up `update_budget_category` loop | 25.4 — **not** designed here; `apply_system_template` takes only a `template_id` (25.1 AC #6) |
| `tests/budget-templates.spec.ts` Playwright E2E | 24.4 (import/export cases) + 25.4 (apply-from-onboarding case) |
| `useImportBudgetTemplate`, `useExportBudgetTemplate`, `ApplyBudgetTemplateResult`, `export` on `invalidateTrendsQueries`, the i18n parity test | 24.4 |
| Rust commands, `SYSTEM_TEMPLATES`, Rust `SystemBudgetTemplateSummary` | 25.1 |

**Known forward risk for 25.4 (flagged, not solved here):** epic AC 25.4 #2 requires the user's edited targets to persist, but `apply_system_template(template_id)` accepts no target overrides — 25.4 will need either a follow-up `update_budget_category` pass over the created categories or a new command. `useApplySystemTemplate`'s signature deliberately takes a bare `string` rather than an options object so 25.4 can widen it if needed, but **do not pre-build that** here.

### Naming Collision Warning

`lib/types.ts` and Rust `models/mod.rs:351-361` already define `RecurringExpenseTemplate` (a recurring monthly expense rule — `merchant`, `amount_cents`, `budget_category_id`, `day_of_month`), and `constants.ts:42` defines `queryKeys.recurringTemplates: ["recurring-templates"]`, consumed by `hooks/useRecurringExpenses.ts`. **Unrelated concept.** Never introduce a bare `Template` type, a `queryKeys.templates` entry, or a `["templates"]`/`["budget-templates"]` key string, and never touch `useRecurringExpenses.ts`. Every identifier here is `SystemBudgetTemplate*` / `systemBudgetTemplates` / `"system-budget-templates"`. [Source: architecture § Technical Constraints; 24-4 §Naming Collision Warning; 25-1 §Naming Collision Warning]

### Project Structure Notes

- Monorepo: pnpm workspaces, scope **`@nixus/`** (not `@nkbaz/` — `project-context.md` is stale on this). Desktop is `apps/desktop` (`@nixus/desktop`); shared UI is `@nixus/shared`
- Hooks live in `apps/desktop/src/hooks/`, **one file per feature domain exporting several hooks** (21 files; `useBudget.ts` alone exports 9). `useBudgetTemplates.ts` is the budget-templates domain file — do **not** append these hooks to `useBudget.ts`, and do **not** create `useSystemTemplates.ts` as a separate file
- Always use the `@/` alias (`@/lib/constants`, `@/lib/types`, `@/hooks/useBudget`), never relative `../`
- Vitest specs live in `__tests__/` subfolders under `src/`; Playwright specs live flat in `apps/desktop/tests/`
- **`project-context.md` is stale in two ways that matter here:** §Testing Rules claims "No unit test framework in desktop — all testing is Playwright E2E" (**false**: `vitest.config.ts` exists, `"test": "vitest run"` is wired, and specs already run in `src/hooks/__tests__/` and `src/locales/__tests__/`), and it names the package scope `@nkbaz/` (**actual: `@nixus/`**). Use the verified facts
- Money is `number` cents with a `_cents` suffix; never format in a hook. This story surfaces **no** amount (`SystemBudgetTemplateSummary` carries none by design)
- `routeTree.gen.ts` is generated — never edit it. This story adds no route
- Verify with `pnpm --filter @nixus/desktop build` and `pnpm --filter @nixus/desktop test`

### Previous Story Intelligence

**From 24.4 (the story this one appends to) — treat as specification, not verified code:**

- **The file, the result type, the test file, and the `invalidateTrendsQueries` export are all 24.4's.** Its §Scope Boundary table explicitly reserves `useSystemTemplates`/`useApplySystemTemplate`/`SystemBudgetTemplateSummary`/`queryKeys.systemBudgetTemplates` for this story and nothing else. Honour the split in both directions.
- **The six-key invalidation sequence is settled** (24.4 AC #4): `budgetGroups`, `["budget-categories"]`, `["budget-status"]`, then `invalidateTrendsQueries`. Its unit test asserts the resulting array in order — which is exactly why AC #6's extraction must be byte-identical.
- **The `T | null` cancel contract applies only to dialog commands.** 24.4 AC #5/#12 and its §Previous Story Intelligence establish `Ok(None)` → `null` → silent early return for import/export. `apply_system_template` has no dialog — do not propagate the pattern (§Prerequisite Gate).
- **`toast`/`t()`/error-surfacing all live in the component, not the hook.** 24.4 put every toast and the `setError`/`getErrorMessage` handling in `YourDataSettings.tsx`; the hooks are pure data access. Keep that separation (AC #8).
- **Import lands every category at $1.00** (`DEFAULT_TEMPLATE_TARGET_CENTS = 100`), but a **system** template never does — 25.1 AC #2 requires every one of the 12 targets to be `Some(n > 0)`. So the apply path produces real targets and the "wall of $1.00" UX caveat 24.4 flagged does not apply to 25.3/25.4's starter flow.
- **Scope-creep tripwire, inherited and re-inverted:** 24.1–24.3 said "if you find yourself editing anything under `apps/desktop/src/`, stop"; 24.4 flipped it to "if you find yourself editing anything under `apps/desktop/src-tauri/`, stop." **This story keeps 24.4's direction and tightens it further: if you find yourself editing anything outside the four paths in AC #10, stop.**

**From 25.1 (the direct predecessor):**

- `list_system_templates` is **sync**, takes **no** `State<DbState>`, does **no** DB or file I/O, and returns the summary projection in `SYSTEM_TEMPLATES` declaration order — one entry today (`{ id: "canadian-starter", name: "Canadian Starter Budget", description: Some(..) }`). A UI-side sort is unnecessary.
- `apply_system_template` resolves the id **before** locking the DB and returns `AppError::Validation { message: "That starter template is not available.", field: Some("template_id") }` for an unknown/empty/wrong-cased id — the id lookup is **exact and case-sensitive**. That fixed message is what the Task 6 rejection test asserts, and it is why the hook must not swallow rejections.
- A successful apply on an empty budget returns `{ groups_created: 4, categories_created: 12, skipped_groups: [] }` — use those numbers in the test fixture so it matches the real backend.
- Exactly **one** audit row is written by the Rust `db/` primitive per apply. Nothing in the frontend logs or audits — add nothing.
- The Rust `SystemBudgetTemplateSummary` uses owned `String` / `Option<String>` with `#[derive(Serialize)]` and no `skip_serializing_if`, which is why the TS field is `description: string | null` (AC #2).
- `name`/`description` are **English-only Rust consts**; `CANADIAN_STARTER_ID` is a stable slug so 25.3 can localize the display strings. This story passes both through verbatim and localizes nothing.

### Git Intelligence

`git log --oneline -8`: `1bc5427 fix(trends): show friendly fallback instead of raw error on AI insight failure`, `9cadcad fix: AI chat layout + version bump to 0.3.1`, `ea5d9f8`/`f86f300 feat(ui): Implement new UI/UX`, `1e9560e feat(ui): Small improvements`, `ea8f35f chore: bump version to 0.2.8`, `0081d17 fix: where you can't delete a category due to past spending`, `e758710 fix(budget): show actionable errors when category delete is blocked`.

`1bc5427` is the direct precedent for AC #9's rejection test: it added `useTrendsInsight`'s friendly-fallback path **and** the repo's only hook unit test (`useTrendsInsight.test.tsx`) in the same change — that test is this story's harness. `e758710`/`0081d17` established that budget errors must reach the user rather than being swallowed, which is why `useApplySystemTemplate` deliberately has no `try`/`catch`.

**Zero Epic 24/25 commits exist in history** (case-insensitive search for "template" matches only `e758710`, a false positive touching `db/budget.rs`'s soft-delete path). `git status --short` at story creation: `M _bmad-output/implementation-artifacts/deferred-work.md` plus untracked planning/story artifacts — **no source changes pending. Do not commit anything.**

### Latest Tech Information

- **TanStack Query 5.90.21.** `useMutation` exposes `isPending` (not v4's `isLoading`); `mutateAsync` rejects, so callers keep their try/catch. `invalidateQueries({ queryKey })` matches by **prefix** by default — that is what makes `["budget-status"]`/`["budget-categories"]` correct without arguments. `useQuery` with only `queryKey` + `queryFn` inherits the library defaults (`staleTime: 0`, `gcTime: 5 min`, `refetchOnWindowFocus: true`) because `main.tsx:11` sets no `defaultOptions`.
- **React 19.1.0**, `@tauri-apps/api ^2.11.0`. `invoke` is promise-based and rejects with the **deserialized** `AppError` object (never a JSON string) — read `err.message` directly, never `JSON.parse`.
- **Vitest 3.2.4 + jsdom 25**, `globals: true` (existing specs still import `describe`/`it`/`expect` from `vitest` explicitly — do the same). No `setupFiles`, so no jest-dom matchers.
- **`@testing-library/react` is NOT a dependency of `@nixus/desktop`** — absent from both `dependencies` and `devDependencies`; it exists only transitively in the pnpm store and must not be imported. The repo's harness is `createRoot` + `act` from `react-dom/client`/`react`.
- TypeScript `strict`, `noUnusedLocals`, `noUnusedParameters`. `import type` is used for type-only imports throughout (`useBudget.ts:2,5`) — follow it or `verbatimModuleSyntax`-style lint noise appears.

### UX / i18n Note (flag, do not resolve here)

No UX-DR covers budget templates — `ux-design-specification.md` predates the 2026-08-01 FR70 amendment (epic § Requirements Inventory — UX Design Requirements), and architecture § Gap Analysis leaves the confirmation UX to story level. This story is a pure data layer with **no** user-visible surface, so it makes no UX decision. Two items carried forward for the 25.3 / 25.4 UX review:

1. **`name`/`description` arrive from Rust in English only.** `useSystemTemplates()` returns them untranslated; whether the picker localizes via `settings.templates.canadian-starter.name` keyed off `CANADIAN_STARTER_ID`, or displays the const strings as-is, is 25.3's call.
2. **The 12 authored targets total $5,000/month** (25.1 §Canadian Starter Content). `SystemBudgetTemplateSummary` deliberately omits them, so any preview screen showing editable targets (epic AC 25.4 #1) needs either a richer command or a client-side second call — **not** designed here, and `list_system_templates` must not be widened to include targets without revisiting the epic AC that forbids it.

### References

- [Source: _bmad-output/planning-artifacts/epics-budget-templates.md — **Story 25.2 all 4 ACs (lines 250-272)**, Epic 25 (lines 218-220, 275-324), Story 25.1 (222-248), Stories 25.3/25.4 (274-324, scope boundary), Requirements Inventory § Additional Requirements (lines 49-52: hook surface, `queryKeys.systemBudgetTemplates`, TS interfaces, invalidation set), line 55 (no bare `Template`), FR Coverage Map (63-67), UX Design Requirements gap note (line 59)]
- [Source: _bmad-output/planning-artifacts/architecture-budget-templates.md — § Frontend Architecture (line 175: hook surface + invalidation set + `useBudget.ts` conventions), § API & Communication Patterns (lines 168-169: `list_system_templates` / `apply_system_template` contracts), Decision 1 (no DB table) and Decision 2 (compiled-const `SYSTEM_TEMPLATES` — why the list is immutable, AC #7), § Decision Impact Analysis step 5 (line 188), § Project Structure (Files to CREATE line 245, MODIFY lines 261-262), § Gap Analysis (lines 325-330)]
- [Source: _bmad-output/implementation-artifacts/24-4-import-a-community-template-file.md — **§Scope Boundary vs. Stories 25.2/25.3 (binding ownership table)**, AC #1 (`ApplyBudgetTemplateResult`, `SystemBudgetTemplateSummary` explicitly deferred to 25.2), AC #2 (`export invalidateTrendsQueries`), AC #3 (hook file + `invoke` specifier + the two hooks 25.2 must not touch), AC #4 (the six-key invalidation order), AC #5/#12 (`null` cancel contract — dialog-only), AC #17 (test file + harness + no `@testing-library/react`), §Conflict A (prefix invalidation), §Conflict B (private helper), §Out of Scope table, §Naming Collision Warning, §Project Structure Notes, §Latest Tech Information]
- [Source: _bmad-output/implementation-artifacts/25-1-canadian-starter-template-definition-list-apply-commands.md — AC #4 (Rust `SystemBudgetTemplateSummary` = id/name/description, owned `String`/`Option<String>`), AC #5 (`list_system_templates` sync, no state, no IO, declaration order, one entry), AC #6 (`apply_system_template(template_id)` → non-`Option` `ApplyBudgetTemplateResult`), AC #7 (`AppError::Validation` message + exact/case-sensitive lookup), AC #8 (4 groups / 12 categories / empty skips), AC #2 (every target pre-filled and positive), §Canadian Starter Content, §Scope Boundary vs. 25.2/25.3/25.4, §UX / i18n Note, §Naming Collision Warning]
- [Source: _bmad-output/planning-artifacts/prd.md — FR70 (line 532), FR71 (line 533), FR96 (line 600), NFR13 (line 628)]
- [Source: docs/project-context.md — §2 Tauri IPC (`invoke<T>("cmd", { snake_case })`), §4 model/type conventions, §6 TanStack Query keys in `constants.ts` + mandatory `onSuccess` invalidation, §7 TS strictness, §9 warnings policy, §Hooks Pattern (lines 214-228), §Naming (query keys kebab-case, line 196), §Anti-Patterns (line 325 no hardcoded keys); **§Testing Rules and the `@nkbaz/` scope are stale — see §Project Structure Notes**]
- [Source: docs/guidelines/warnings.md — all compilation warnings must be resolved]
- [Source: apps/desktop/src/lib/constants.ts:1-58 — full `queryKeys` object; `budgetGroups` :2, `budgetCategories(id)` :3-4, `budgetStatus(y,m)` :5-6, `allBudgetCategories` :7 (insertion point), `recurringTemplates` :42 (collision), `as const` on all 40 entries, no `systemBudgetTemplates`]
- [Source: apps/desktop/src/hooks/useBudget.ts:1-11 — imports, `import type { QueryClient }`, private `invalidateTrendsQueries`; :14-18 `useBudgetGroups` query shape; :24-25 scalar-arg mutation; :32-40 `{ group_id: groupId }` IPC mapping; :42-66 mutation + invalidation shape; :60-62, :102-104, :120-122 raw `["budget-status"]` precedent]
- [Source: apps/desktop/src/hooks/useAccounts.ts:11-16, useAssets.ts:11-16, useRecurringExpenses.ts:11-16, useOnboardingStatus.ts:10-19 — canonical zero-arg list-query hook shape (queryKey + queryFn only); `useOnboardingStatus`'s exported `fetchX` helper pattern (not needed here)]
- [Source: apps/desktop/src/hooks/useTrendsInsight.ts:56 — the one `useQuery` with `enabled`/`staleTime`, and why it is a special case (§Conflict A)]
- [Source: apps/desktop/src/hooks/__tests__/useTrendsInsight.test.tsx:1-112 — the repo's only hook unit test, and it tests a `useQuery`: `vi.mock("@tauri-apps/api/core")` :14-16, `IS_REACT_ACT_ENVIRONMENT` :8-10,:64, `Harness` :33-48, `render()` in `act` + `QueryClientProvider` :55-61, `new QueryClient({ defaultOptions: { queries: { retry: false } } })` :73-75, `createRoot` :78, teardown :81-86, `invokeMock.mock.calls[0]` assertions :104-110, fake timers :65,:85 (do not copy)]
- [Source: apps/desktop/src/lib/types.ts:1-24 (budget cluster / insertion anchor), :31 (`?: T \| null` input form), :179-180 (`T \| null` read-only form — the convention AC #2 follows); 596 lines; `ApplyBudgetTemplateResult` and `SystemBudgetTemplateSummary` both absent today]
- [Source: apps/desktop/src/main.tsx:11 — `new QueryClient()` with **no** `defaultOptions` (§Conflict A)]
- [Source: apps/desktop/vitest.config.ts:1-15 — jsdom, `globals: true`, `include: ["src/**/*.test.{ts,tsx}"]`, `@` alias, no `setupFiles`]
- [Source: apps/desktop/package.json:11-12 — `"test": "vitest run"`, `"test:watch": "vitest"`, `"build": "tsc && vite build"`; `@testing-library/react` absent from `dependencies` and `devDependencies`]
- [Source: apps/desktop/src-tauri/src/error.rs:5-13,31-90 — `AppError::Validation` → `{"type":"validation","message":…,"field":…}` rejection shape]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

**Prerequisite gate — all five commands run, results recorded:**

| Gate command | Actual result | Verdict |
|---|---|---|
| `grep list_system_templates\|apply_system_template … lib.rs` | `:106 commands::budget_template::list_system_templates`, `:107 commands::budget_template::apply_system_template` | HARD gate **PASS** |
| `grep "pub struct SystemBudgetTemplateSummary" … models/mod.rs` | `:75` present | HARD gate **PASS** |
| `ls hooks/useBudgetTemplates.ts` | present (33 lines, 1355 bytes) | SOFT gate → **append path** |
| `grep ApplyBudgetTemplateResult … types.ts` | `:26` present, fields exactly `{ groups_created, categories_created, skipped_groups }` | no absorption needed |
| `grep "export function invalidateTrendsQueries" … useBudget.ts` | `:7` already exported | no absorption needed |

**Actual Rust signatures (TS typed against these, not against the story's assumption):**

- `budget_template.rs:125` — `#[tauri::command(rename_all = "snake_case")] pub fn list_system_templates() -> Result<Vec<SystemBudgetTemplateSummary>, AppError>` → sync, zero args → TS `SystemBudgetTemplateSummary[]`, `invoke` called with no args object.
- `budget_template.rs:141` — `pub fn apply_system_template(state: State<DbState>, template_id: String) -> Result<ApplyBudgetTemplateResult, AppError>` → **non-`Option`** return, `State` is injected by Tauri and not part of the IPC payload → TS `ApplyBudgetTemplateResult` with **no** `| null` and **no** cancel guard, IPC payload `{ template_id }`.
- `models/mod.rs:75-79` — `SystemBudgetTemplateSummary { id: String, name: String, description: Option<String> }`, `#[derive(Serialize, Deserialize)]`, no `skip_serializing_if` → TS `description: string | null`. Story assumptions matched reality field-for-field; **zero deviations**.

**Async-flush investigation (the one non-trivial problem in this story).** The query assertion `expect(systemTemplates.data).toEqual(summaries)` initially failed with `data === undefined`. The story's prescribed flush (`await act(async () => {})`) does not work here. Measured with a throwaway probe spec (since deleted), rendering the same hook against the same harness:

| Flush strategy | renders | query status | `data` |
|---|---|---|---|
| `await act(async () => {})` | 1 | `pending` | `undefined` |
| `await act(async () => {})` ×2 | 1 | `pending` | `undefined` |
| `await act(async () => { await Promise.resolve(); })`, no pre-mounted `Harness` | 3 | `success` | resolved |
| same, **with** `beforeEach`'s `Harness` pre-mounted (real suite shape) | 1 | `pending` | `undefined` |
| `await act(async () => { await new Promise(r => setTimeout(r, 0)); })` | 2 | `success` | resolved |

Conclusion: an *empty* async `act` callback never yields to the queryFn's microtask chain (two of them change nothing), and the number of microtask hops needed depends on whether the shared `Harness` was already mounted — so a fixed count of microtask flushes is inherently fragile. A **macrotask boundary** drains the whole microtask queue unconditionally, so the test uses a `settleQueries()` helper built on `setTimeout(…, 0)` inside `act`. Verified non-flaky across 3 consecutive full-spec runs (9/9 each).

**Playwright triage.** Full suite: **312 passed, 5 failed**. One is the known pre-existing `chat.spec.ts:250 › money in an answer is tabular Inter` (not mine, not fixed). The other four (`accounts.spec.ts:333`, `accounts.spec.ts:472`, `expenses.spec.ts:426`, `maintenance.spec.ts:1561`) were re-run in isolation and **all 4 passed (8.0s)** → flaky under full-suite parallel worker contention, not regressions. Corroborated structurally: this story's runtime surface is referenced by zero components/routes (`grep` for `useSystemTemplates|useApplySystemTemplate|systemBudgetTemplates|SystemBudgetTemplateSummary` matches only the 4 in-scope files), so it cannot affect accounts/expenses/maintenance/chat behaviour.

### Completion Notes List

**Net deliverable — all 4 items shipped, plus test coverage:**

1. `queryKeys.systemBudgetTemplates: ["system-budget-templates"] as const` — inserted immediately after `allBudgetCategories` (now line 8), bare tuple, no other line of `constants.ts` changed (AC #1).
2. `SystemBudgetTemplateSummary { id: string; name: string; description: string | null }` — inserted directly after `ApplyBudgetTemplateResult`'s closing brace, located by symbol. `description` uses the read-only `T | null` form, not `?:`. No `target_cents`/`groups`/`format_version`. `ApplyBudgetTemplateResult` re-emitted byte-identically — not edited, moved, or re-declared (AC #2).
3. `useSystemTemplates()` — `queryKey` + `queryFn` only; no `staleTime`/`gcTime`/`enabled`/`select`/`retry`/`refetchOnWindowFocus`/`placeholderData` (§Conflict A honoured). `useQuery` added to the **existing** `@tanstack/react-query` import; `invoke` called with no arguments object (AC #3).
4. `useApplySystemTemplate()` — `mutationFn: (templateId: string) => invoke<ApplyBudgetTemplateResult>("apply_system_template", { template_id: templateId })`, returned directly (not `async`-wrapped), no `| null`, no `if (!data) return;` guard, no `try`/`catch`, no toast/`t()`/JSX (AC #4, #8).
5. `invalidateAppliedTemplateQueries(queryClient: QueryClient)` — one module-private helper, called by **both** `useImportBudgetTemplate` and `useApplySystemTemplate`, so the six-key sequence can never drift (AC #5, #6). `type QueryClient` imported via a separate `import type` line, matching `useBudget.ts:2`. 24.4's prefix-invalidation WHY comment moved into the helper (one copy, not two).
6. Apply invalidates exactly `["budget-groups"]`, `["budget-categories"]`, `["budget-status"]`, `["spending-trends"]`, `["trends-insight"]`, `["all-budget-categories"]` in that order, and explicitly does **not** invalidate `["system-budget-templates"]` or `queryKeys.onboardingStatus`, and never calls `queryClient.clear()`/`setQueryData()` (AC #5, #7).

**Behaviour-preserving extraction confirmed (AC #6).** A unified diff of the 24.4 baseline file against the result shows `useImportBudgetTemplate`'s name, `mutationFn`, `ApplyBudgetTemplateResult | null` return type, dialog WHY comment, and `if (!data) return;` guard all unchanged — only the four invalidation statements moved, in identical order. `useExportBudgetTemplate` is byte-identical. The decisive proof: **24.4's existing six-key assertion still passes without being edited.**

**Zero deviations, zero absorptions.** 24.4 had already shipped the hook file, `ApplyBudgetTemplateResult`, the test file, and the `export` on `invalidateTrendsQueries`, so the SOFT-gate absorption path in §Absorption Rules did **not** fire and `hooks/useBudget.ts` was not touched by this story. The story's §PREREQUISITE GATE text ("nothing from Epic 24 or 25 is implemented", verified at story-creation time) is **stale** — Epic 24 and Story 25.1 are complete but uncommitted; the gate commands were re-run against the live worktree and the append path was taken as §Critical Rule 1 requires.

**Test results (real output).**
- Baseline before this story: **51 tests / 6 files passed**.
- After: **56 tests / 6 files passed** — 5 new cases, zero pre-existing tests modified, deleted, or weakened. The 4 pre-existing 24.4 cases in `useBudgetTemplates.test.tsx` still pass unedited (file went 4 → 9 tests).
- New cases: lists system templates with no arguments · applies a system template by snake_case id · invalidates every budget-facing query key after an apply · does not refetch the immutable system-template list after an apply · surfaces a rejected apply instead of swallowing it (asserts the exact 25.1 `AppError::Validation` object reaches the caller, proving no swallow-and-return-null path).
- `pnpm --filter @nixus/desktop exec tsc --noEmit` → **0 errors**. Full `pnpm --filter @nixus/desktop build` (`tsc && vite build`) → **built in 19.37s, zero TS errors/warnings** (the ">500 kB chunk" line is Vite's pre-existing bundling advisory, unrelated).
- **No Rust run needed: zero files under `src-tauri/` were modified** (verified — this story's identifiers return zero matches in `src-tauri/src/`), so `cargo check`/`clippy`/`test` were correctly skipped per §Critical Rule 2.
- i18n untouched and still at parity: **en 1129 / fr 1129 keys, identical set AND order**. This story adds no user-facing string (AC #8).

**Test-harness design decision (worth reviewer attention).** `useApplySystemTemplate()` was added to 24.4's shared `Harness` (a mutation does not fire on mount, so all four pre-existing assertions stay valid), but `useSystemTemplates()` needed a second component, `SystemTemplatesHarness`, rendered only inside its own test. Reason: it is a `useQuery`, so putting it in the shared `Harness` would fire `invoke` on every `beforeEach` mount and break 24.4's `toHaveBeenCalledTimes(1)` and `invokeMock.mock.calls[0]` assertions — and it would run against a reset mock returning `undefined`, which TanStack Query rejects. AC #9's actual constraints are all satisfied: same file, same `describe`/`beforeEach`/`afterEach`, same `invokeMock`, same single `vi.mock`, same `render()`, no `@testing-library/react`, no `vi.useFakeTimers()`.

**Forward note for 25.3 / 25.4 (flagged, not acted on).** The deferred gap called out in the brief is confirmed still open and deliberately untouched: `queryKeys.budgetSummary` and `queryKeys.topBudgetCategories` are invalidated by no budget mutation anywhere, including this one. No AC in 25.2 requires it, so expanding the six-key set was out of scope. Also unchanged: `apply_system_template` takes only a `template_id`, so 25.4's editable-target requirement still needs either a follow-up `update_budget_category` pass or a new command — `useApplySystemTemplate` deliberately takes a bare `string` so 25.4 can widen it.

### File List

- `apps/desktop/src/lib/constants.ts` — modified (1 line added: `queryKeys.systemBudgetTemplates`)
- `apps/desktop/src/lib/types.ts` — modified (6 lines added: `SystemBudgetTemplateSummary`)
- `apps/desktop/src/hooks/useBudgetTemplates.ts` — modified (helper extraction + `useSystemTemplates` + `useApplySystemTemplate`)
- `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx` — modified (5 new `it()` cases, `applySystemTemplate` added to the shared `Harness`, new `SystemTemplatesHarness` + `settleQueries()` helper)
- `_bmad-output/implementation-artifacts/25-2-frontend-hook-for-budget-templates.md` — modified (story record: frontmatter, task checkboxes, Dev Agent Record, File List, Change Log, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (`25-2-frontend-hook-for-budget-templates: ready-for-dev` → `review`)

No other file was created, modified, or deleted. Nothing under `apps/desktop/src-tauri/`, `apps/web/`, `packages/`, `src/locales/`, `src/components/`, `src/routes/`, `apps/desktop/tests/`, or `routeTree.gen.ts` was touched. Nothing was committed.

## Change Log

- 2026-08-04: Story context created (ready-for-dev).
- 2026-08-04: Implemented 25.2 — added `queryKeys.systemBudgetTemplates`, `SystemBudgetTemplateSummary`, `useSystemTemplates()`, `useApplySystemTemplate()`, and extracted the shared `invalidateAppliedTemplateQueries` helper so import and apply share one six-key invalidation sequence. Extended the existing hook spec with 5 cases (51 → 56 vitest tests, all green); `tsc --noEmit` and the full `tsc && vite build` clean; zero Rust, i18n, UI, or out-of-scope changes. Status → review.
- 2026-08-04: Adversarial code review. Verdict **PASS**. Found and auto-fixed a real defect: `settleQueries()`'s single-macrotask flush was flaky (~65% failure rate over 20 isolated runs), contradicting the dev's own "verified non-flaky ×3" note — replaced with a bounded poll on render-derived hook state; re-verified 20/20 stable. Confirmed via independent re-run: `tsc --noEmit` 0 errors, Vitest 56/56, `cargo check` 0 warnings, `cargo test` 251/251 unchanged. Confirmed type fidelity against Rust field-for-field, confirmed the `invalidateAppliedTemplateQueries` extraction is byte-level behaviour-preserving, confirmed the 4 flaky-under-parallelism Playwright specs pass in isolation and `chat.spec.ts:250` remains the same unrelated pre-existing failure. Mutation-tested two load-bearing tests: the invalidation-set test correctly fails when broken (not vacuous); found and logged a Medium test-coverage gap — no test independently verifies `queryKeys.systemBudgetTemplates`'s literal value. Status → done.
