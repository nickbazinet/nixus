---
baseline_commit: 1bc542762f39223e091c1f9d297fd2b0b8e9cc3e
---

# Story 25.4: Starter Template Path in Onboarding Fork

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new user,
I want to pick the system starter template as one of the onboarding fork options, with its category targets editable before I finish,
so that I can get a working budget in about two clicks without manual data entry.

**Scope:** Frontend-heavy with one small backend extension. **Files touched:** `apps/desktop/src/components/onboarding/OnboardingBudgetStep.tsx` (insertion point), a new self-contained component `OnboardingStarterTemplate.tsx`, `apps/desktop/src/hooks/useBudgetTemplates.ts` (widen `useApplySystemTemplate` to accept overrides — coordinate with 25.2/25.3), `apps/desktop/src/components/settings/YourDataSettings.tsx` (update the two 25.3 call sites to the widened signature), a new Rust command + `SystemBudgetTemplateDetail` struct, `apps/desktop/src-tauri/src/commands/budget_template.rs`, `lib.rs` registration, `locales/en.json`/`fr.json`.

**FRs:** FR70 (starter-template fork path), FR71 (redirect-gate reachability) · **NFRs:** NFR11 (transactional apply, inherited from 24.1), NFR13 (`target_cents` accuracy on edited overrides)
**Epic:** [epics-budget-templates.md § Epic 25, Story 25.4 (lines 298-324)](../planning-artifacts/epics-budget-templates.md)
**Architecture:** [architecture-budget-templates.md](../planning-artifacts/architecture-budget-templates.md) — § "Important Gaps" (import-confirmation / preview-vs-direct-apply UX, explicitly extended here to cover this screen)
**Predecessors:** [25.1](25-1-canadian-starter-template-definition-list-apply-commands.md) (**HARD** — `apply_system_template`, `SYSTEM_TEMPLATES`) · [25.2](25-2-frontend-hook-for-budget-templates.md) (**HARD** — `useApplySystemTemplate`, widened here) · [25.3](25-3-settings-templates-section-wiring.md) (**HARD, coordination** — both call sites of `useApplySystemTemplate` must be updated together with this story)

---

## ⛔ CRITICAL FINDING — READ FIRST

**The single-fork onboarding screen the PRD's FR70 amendment describes does not exist in code yet.** The current onboarding is still the retired 5-step `OnboardingWizard.tsx` flow (`OnboardingBudgetStep.tsx` is one of its steps). Building a new dedicated fork screen (statement-upload / starter-template / start-from-scratch) is out of scope for this story and for this epic (the epic's own scope note restricts it to "the starter-template path only — the statement-upload and start-from-scratch forks are out of scope for this document").

**Resolution:** insert the starter-template option **inside the existing `OnboardingBudgetStep.tsx`**, as the primary/first choice presented when the user reaches the budget step, with "start from scratch" (the step's current manual category-creation UI) retained below it as the fallback. This satisfies FR70's "~2 clicks" claim (select template → confirm) without adding a 6th wizard step or changing step count/tests that assume 5 steps.

Extract all starter-template UI and logic into its own component, `OnboardingStarterTemplate.tsx`, rendered by `OnboardingBudgetStep.tsx`. This keeps the component self-contained so it can be migrated wholesale into a real fork screen later without a rewrite — **flag this explicitly in Completion Notes as a forward-compat decision, not a permanent home.**

**Flagged for UX review (per epic line 322-324):** no UX-DR specifies this screen's exact layout (choice presentation, preview-then-edit-then-confirm interaction, or how "start from scratch" is de-emphasized beneath it). This story makes a minimal, functional decision (see §Conflicts below) and does not invent unstated visual specs.

---

## ⛔ PREREQUISITE GATE

Run before writing code:

```bash
cd /Users/nbazinet/projects/nixus
grep -n "useApplySystemTemplate\|useSystemTemplates" apps/desktop/src/hooks/useBudgetTemplates.ts
grep -n "apply_system_template" apps/desktop/src-tauri/src/commands/budget_template.rs
grep -n "OnboardingBudgetStep" apps/desktop/src/components/onboarding/*.tsx apps/desktop/src/routes/**/*.tsx 2>/dev/null
grep -n "useApplySystemTemplate" apps/desktop/src/components/settings/YourDataSettings.tsx
grep -n "onboardingStatus\|needs_onboarding\|has_budget_data" apps/desktop/src/hooks/useOnboardingStatus.ts apps/desktop/src/lib/constants.ts
```

| Gate | Result | Action |
|---|---|---|
| `apply_system_template` missing from Rust, or `useApplySystemTemplate` missing from the hook | **HARD STOP** | Report "Story 25.1/25.2 is not done." |
| `useApplySystemTemplate` call sites in `YourDataSettings.tsx` (25.3) not yet shipped | **SOFT** | Proceed — widening an unbuilt call site is moot; just implement the widened hook signature and this story's own call site. Note in Completion Notes that 25.3 must be checked against the widened signature when it lands. |
| `OnboardingBudgetStep.tsx` path differs from assumed | — | Adapt to the real path; do not invent a new step file. |

---

## Acceptance Criteria

1. **Given** a new user reaches `OnboardingBudgetStep.tsx`
   **When** the step renders and `useSystemTemplates()` returns at least one template
   **Then** a new `OnboardingStarterTemplate` component is rendered as the step's primary content, presenting the Canadian starter template's pre-filled categories with their target amounts, each amount editable via the existing `MoneyInput` component before confirming
   **And** the step's existing "start from scratch" manual group/category creation UI remains available below it as a secondary path — neither path is removed

2. **Given** the starter-template preview
   **When** the user edits one or more target amounts
   **Then** the edited values are held in local component state (not yet persisted) until the user confirms — canceling the edit or navigating away without confirming discards them, per standard form behavior; no partial apply occurs

3. **Given** the user confirms the (possibly edited) starter template
   **When** the apply runs
   **Then** it calls the widened `useApplySystemTemplate()` mutation with `{ templateId: "canadian-starter", overrides: [...] }`, where `overrides` contains one entry per category whose target was changed from its authored default, each `{ groupName, categoryName, targetCents }`
   **And** unedited categories are **not** included in `overrides` — the Rust apply logic applies the template's own authored default for any category absent from the overrides list
   **And** the call succeeds in one transaction (Story 24.1's core apply function, invoked via 25.1's `apply_system_template`), producing one audit row with `source: "system"`

4. **Given** the Rust `apply_system_template` command
   **When** it receives an `overrides` argument
   **Then** it accepts `Option<Vec<TemplateTargetOverride>>` (new struct: `{ group_name: String, category_name: String, target_cents: i64 }`), defaulting to `None` for backward compatibility with 25.1's existing zero-argument callers (e.g. Story 25.3's Settings apply)
   **And** each override is matched case-insensitively against the template's own group/category names before the merged template is passed into the shared `apply_budget_template_json`/`apply_budget_template` core (Story 24.1) — no duplicate apply logic is introduced for this entry point
   **And** an override whose `group_name`/`category_name` does not match any entry in the template is rejected with `AppError::Validation` before any DB write
   **And** each override's `target_cents` passes the same bounds validation as import (Story 24.2's non-negative, capped rule)

5. **Given** the Settings starter-template preview needs full category/target detail but `list_system_templates` (25.1) intentionally omits target amounts
   **When** this story needs that detail for the onboarding preview
   **Then** a new Tauri command `get_system_template_detail(template_id: String)` is added, returning an owned `SystemBudgetTemplateDetail { id: String, name: String, description: Option<String>, groups: Vec<TemplateGroupDetail> }` (each group: `{ name: String, categories: Vec<TemplateCategoryDetail> }`, each category: `{ name: String, target_cents: Option<i64> }`) — an owned projection of `SystemBudgetTemplate`, mirroring the `SystemBudgetTemplateSummary` pattern from 25.1 rather than attempting to serialize the `Cow<'static, _>`-based struct directly
   **And** an unknown `template_id` returns `AppError::Validation`, matching `apply_system_template`'s existing error shape
   **And** the command is registered in `lib.rs`'s `tauri::generate_handler!`

6. **Given** `apps/desktop/src/hooks/useBudgetTemplates.ts`
   **When** this story is implemented
   **Then** it adds `useSystemTemplateDetail(templateId: string)` as a TanStack Query hook wrapping `get_system_template_detail`, and widens `useApplySystemTemplate()`'s mutation variables from a bare `string` to `{ templateId: string; overrides?: TemplateTargetOverride[] }`
   **And** both of 25.3's existing `useApplySystemTemplate().mutateAsync(templateId)` call sites in `YourDataSettings.tsx` are updated to `mutateAsync({ templateId })` (no overrides) so the widened signature does not break Settings
   **And** the widened mutation's `onSuccess` invalidation list is unchanged from 25.2 (`budget-groups`, `budget-categories`, `budget-status`, `spending-trends`, `trends-insight`, `all-budget-categories`) — it still does **not** invalidate `queryKeys.onboardingStatus`

7. **Given** the starter-template path completes successfully during onboarding
   **When** the apply mutation's `onSuccess` fires inside `OnboardingStarterTemplate`/`OnboardingBudgetStep` (not inside the shared hook — 25.2 explicitly keeps the hook free of onboarding-status concerns)
   **Then** the onboarding component invalidates the onboarding-status query key (`queryKeys.onboardingStatus`) so the router's `beforeLoad` guard does not read stale cached "needs onboarding" state
   **And** the user is then navigated to the dashboard (`/`), landing there with budget groups already present — satisfying FR71's "a budget is mandatory" gate in ~2 clicks (select template, confirm)

8. **Given** no budget groups exist for a returning user (FR71's redirect condition)
   **When** the router's `beforeLoad` gate fires
   **Then** the user is redirected to the onboarding flow, which — per this story's insertion point — reaches `OnboardingBudgetStep.tsx` and the starter-template option remains reachable there
   **And** no separate/duplicated apply logic exists for this entry point versus the Settings entry point (Story 25.3) — both call the same widened `useApplySystemTemplate()` mutation and the same Rust `apply_system_template` command

9. **Given** the starter-template preview/edit UI
   **When** implemented
   **Then** the interaction flow (present pre-filled categories → allow per-category target edits → confirm → apply) is documented in this story's Dev Notes as flagged for UX review, since no UX-DR specifies this screen's exact visual layout — this story ships a functional, unstyled-beyond-existing-primitives implementation, not an invented design system extension

10. **Given** `apps/desktop/src/locales/en.json` and `fr.json`
    **When** this story is implemented
    **Then** new `onboarding.starterTemplate*` keys are added to both locales for: the section heading, the "use starter template" / "start from scratch" choice labels, the confirm button, a per-category edit label, and success/error feedback — all keys present with non-empty values in both locales

11. **Given** the desktop app
    **When** `pnpm --filter @nixus/desktop build` runs
    **Then** it completes with zero TypeScript errors/warnings
    **And** `cargo check`/`cargo test` (Rust side) pass with the new command and struct
    **And** nothing is committed

---

## Tasks / Subtasks

- [x] **Task 0: Prerequisite gate** — run the gate commands above; hard-stop if 25.1/25.2 Rust or hook surfaces are missing.
- [x] **Task 1: Rust — `TemplateTargetOverride` + widened `apply_system_template`** (AC #3, #4)
  - [x] Add `TemplateTargetOverride { group_name: String, category_name: String, target_cents: i64 }` to `models/mod.rs`
  - [x] Change `apply_system_template(template_id: String, overrides: Option<Vec<TemplateTargetOverride>>)`; merge overrides case-insensitively into the looked-up `SystemBudgetTemplate` before calling the shared core apply function
  - [x] Validate each override matches an existing group/category name and passes bounds checks; reject unmatched/invalid entries with `AppError::Validation` before any DB write
  - [x] Add unit tests: no-overrides path unchanged, valid override applied, unmatched override rejected, invalid `target_cents` rejected
- [x] **Task 2: Rust — `get_system_template_detail` command** (AC #5)
  - [x] Add `SystemBudgetTemplateDetail`/`TemplateGroupDetail`/`TemplateCategoryDetail` owned structs to `models/mod.rs`
  - [x] Add `get_system_template_detail(template_id: String) -> Result<SystemBudgetTemplateDetail, AppError>` to `commands/budget_template.rs`, looking up `SYSTEM_TEMPLATES` and projecting into the owned shape
  - [x] Register in `lib.rs`'s `tauri::generate_handler!`
  - [x] Unit test: known id returns full detail incl. targets; unknown id returns `AppError::Validation`
- [x] **Task 3: Frontend hook widening** (AC #6)
  - [x] Add `useSystemTemplateDetail(templateId)` query hook to `hooks/useBudgetTemplates.ts`
  - [x] Widen `useApplySystemTemplate()` mutation variables to `{ templateId, overrides? }`, mapping to `invoke("apply_system_template", { template_id: templateId, overrides })`
  - [x] Update both existing call sites in `YourDataSettings.tsx` to `mutateAsync({ templateId })`
- [x] **Task 4: `OnboardingStarterTemplate.tsx` component** (AC #1, #2, #9)
  - [x] New self-contained component: fetches detail via `useSystemTemplateDetail`, renders each group/category with a `MoneyInput` pre-filled from `target_cents`, tracks edited values in local state
  - [x] Confirm handler diffs edited values against authored defaults, builds the `overrides` array (only changed categories), calls the widened `useApplySystemTemplate()`
  - [x] On success: invalidate `queryKeys.onboardingStatus`, navigate to `/`
  - [x] On error: surface via the step's existing error-display convention (no bare `console.error`)
- [x] **Task 5: Wire into `OnboardingBudgetStep.tsx`** (AC #1, #8)
  - [x] Render `OnboardingStarterTemplate` as the primary choice; retain existing manual creation UI below as fallback, gated behind a simple toggle/expand (no new wizard step, no step-count change)
- [x] **Task 6: i18n** (AC #10) — add `onboarding.starterTemplate*` keys to `en.json`/`fr.json`, verify parity.
- [x] **Task 7: Verification** (AC #11) — `pnpm --filter @nixus/desktop build`, `cargo check`/`cargo test`, confirm nothing committed.

---

### Review Findings

- [x] [Review][Decision] **Resolved: ACCEPT AS-IS, DEFER.** Duplicate override entries for the same (group, category) pair — `merge_target_overrides` silently uses the first matching entry (`find_override` resolves via `.find()`); no validation rejects the duplicate. Product decision: the case is unreachable through the shipped UI (`buildOverrides` in `OnboardingStarterTemplate.tsx` can only emit one entry per category), the first-entry-wins behavior is now locked by the regression test added during this review, and adding a defensive rejection at the Rust boundary would be speculative hardening against a caller that does not exist. Deferred to `deferred-work.md`; revisit only if a future caller can construct raw override lists (e.g. a public API or an AI-driven apply path). [`apps/desktop/src-tauri/src/budget/template_defaults.rs:68-76`]
- [x] [Review][Patch] Add regression test locking the current first-entry-wins behavior for duplicate overrides, so a future refactor toward last-wins (or rejection) is a deliberate, reviewed change rather than an accidental one — `merge_with_duplicate_overrides_for_the_same_pair_uses_the_first_entry` in `budget/template_defaults.rs`. Test-only; no product code changed. [`apps/desktop/src-tauri/src/budget/template_defaults.rs:388`]
- [x] [Review][Defer] Completion Notes decision #11's rationale for awaiting `queryClient.invalidateQueries(onboardingStatus)` before `navigate()` slightly overstates the mechanism: the `/` route's `beforeLoad` calls `fetchOnboardingStatus()` directly, bypassing the TanStack Query cache entirely on every navigation, so it cannot read stale cached `needs_onboarding` state regardless of whether the invalidation is awaited. The `await` itself is correct and worth keeping — it is load-bearing for `IndexPage`'s own `useOnboardingStatus()` read (the `setup_incomplete` banner) — but the "races the beforeLoad guard" framing is inaccurate. Documentation-only; no code change warranted. — deferred, pre-existing framing in Completion Notes, not a functional defect [`apps/desktop/src/components/onboarding/OnboardingStarterTemplate.tsx:109`]
- [x] [Review][Defer] Completion Notes item 13 overstates the `get_system_template_detail`-failure fallback: `OnboardingBudgetStep`'s `manualPathVisible` predicate only auto-reveals the manual path when `list_system_templates` fails or returns empty (`starterTemplateId === undefined`); a `get_system_template_detail` failure inside the already-rendered `OnboardingStarterTemplate` still requires one click on "Start from scratch instead" to reach the manual UI, not "no toggle to find." Not a dead end (the button is present and functional) and practically unreachable in production since both commands read the same compiled-in `SYSTEM_TEMPLATES` const with no I/O — the id passed to the detail query is guaranteed to exist. — deferred, pre-existing framing in Completion Notes, not a functional defect [`apps/desktop/src/components/onboarding/OnboardingBudgetStep.tsx:177-180`]

---

## Dev Notes

### Conflicts Resolved Here (Binding)

**Conflict A — no fork screen exists.** Resolved by inserting into `OnboardingBudgetStep.tsx` rather than inventing a fork screen, with the new component built as a self-contained unit for future migration. See §Critical Finding above.

**Conflict B — `list_system_templates` has no targets, but the preview needs them.** Resolved with a new owned-projection command (`get_system_template_detail`) rather than serializing `SystemBudgetTemplate`'s `Cow<'static, _>` fields directly, following the same pattern 25.1 established for `SystemBudgetTemplateSummary`.

**Conflict C — editable targets require per-category override plumbing the backend doesn't have.** Resolved by widening `apply_system_template` with an optional, backward-compatible `overrides` parameter, matched case-insensitively and validated with the same bounds rules as import (24.2), rather than duplicating apply logic for this entry point.

**Conflict D — widening `useApplySystemTemplate()`'s signature touches 25.3's call sites.** Resolved by updating both Settings call sites to the widened `{ templateId }` shape (no overrides) as part of this story, since the epic explicitly forbids duplicated apply logic between entry points, and 25.2's Dev Notes permit widening the hook if a later story needs it.

**Conflict E — where to invalidate onboarding status.** Resolved in the onboarding component's own `onSuccess`, not inside the shared hook, consistent with 25.2's scope boundary keeping onboarding-status concerns out of the hook.

### Coordination Note

This story's Task 1/3 changes (`apply_system_template` signature, `useApplySystemTemplate()` variables shape) are shared surface with Story 25.3. If 25.3 is implemented **before** this story, update its two call sites here. If implemented **after**, 25.3's dev must consume the widened signature this story ships (`mutateAsync({ templateId })`), not the bare-string form described in 25.2's original doc.

### UX Review Flag

Per epic AC 25.4 #5 (lines 322-324): the preview-then-edit-then-confirm interaction flow, the visual presentation of "starter template" vs. "start from scratch" as onboarding choices, and the per-category edit affordance are **not** specified by any UX-DR. This story ships a functional implementation using only existing primitives (`MoneyInput`, existing step layout conventions) and flags the screen for a follow-up UX pass rather than inventing unstated visual specifications.

### Sprint Status

`sprint-status.yaml` has no `epic-25`/`25-*` entries yet — this is expected; `bmad-sprint-planning` will add and detect `ready-for-dev` status for all budget-template stories in a subsequent run. No update attempted here.

**Correction (dev run):** this note was stale. `sprint-status.yaml` did contain `epic-25` and all four `25-*` entries, with `25-4-…: ready-for-dev`. Updated to `in-progress` then `review` per the workflow.

---

## Dev Agent Record

### Implementation Plan (as built)

| # | Step | Outcome |
|---|---|---|
| 0 | Prerequisite gate | **PASSED.** `apply_system_template` + `list_system_templates` present in Rust; `useSystemTemplates`/`useApplySystemTemplate` present in the hook; `OnboardingBudgetStep.tsx` at the assumed path; 25.3's Settings call site shipped. Additive path taken throughout. |
| 1 | Rust overrides | `TemplateTargetOverride` in `models/mod.rs`; pure `merge_target_overrides()` in `budget/template_defaults.rs`; `apply_system_template` widened with `Option<Vec<…>>`, merging **before** taking the DB mutex. |
| 2 | Rust detail command | 3 owned projection structs + `get_system_template_detail`, registered in `lib.rs`. |
| 3 | Hook surface | `useSystemTemplateDetail` added; `useApplySystemTemplate` variables widened to `{ templateId, overrides? }` with camelCase→snake_case mapping at the IPC boundary. |
| 4 | `OnboardingStarterTemplate.tsx` | New self-contained component: preview → per-category `MoneyInput` edit → confirm → apply → invalidate `onboardingStatus` → navigate `/`. |
| 5 | Step wiring | Rendered as `OnboardingBudgetStep`'s primary content; manual path retained behind a "Start from scratch instead" toggle. No step-count change (still 5). |
| 6 | i18n | 14 `onboarding.starterTemplate*` keys × 2 locales. 1139 → 1153 keys each, identical order. |
| 7 | Verification | tsc, build, vitest, cargo check/test, full Playwright suite — all real output below. |

### Debug Log

**One genuine defect found and fixed during E2E, in the test harness rather than the product.**
`page.getByLabel(…).fill("2200")` on a *pre-filled* `MoneyInput` silently wrote the **old** value back. Root cause: `MoneyInput.handleFocus` re-formats its own `displayValue` when `value > 0`; Playwright's `fill()` focuses and writes within one action, so the focus-triggered re-render landed on top of the typed text and `handleChange` received `"1800.00"`. Since `1800.00` equals the authored default, `buildOverrides()` correctly produced `[]` — the test was asserting against a value that never reached the component. Diagnosed empirically (intermediate assertion showed the input reverting to `1800.00`), then fixed with a `fillMoneyInput()` helper that clicks first so the focus re-format settles before the value lands. `budget.spec.ts` never hit this because every money input it fills starts at `0`, where `handleFocus` is a no-op. **No product code changed for this** — `MoneyInput` behaves correctly for real users, who focus before typing.

### Completion Notes

**Forward-compat decision (per §Critical Finding).** `OnboardingStarterTemplate.tsx` is a fully self-contained component whose only prop is `templateId`. Its current home inside `OnboardingBudgetStep.tsx` is **not a permanent one** — when the real single-fork onboarding screen (statement-upload / starter-template / start-from-scratch) is built, this component moves wholesale with no rewrite. It owns its own detail query, edit state, apply, invalidation and navigation; the step contributes only the `templateId` and the layout slot.

**AC #9 — as-built interaction flow, flagged for UX review.** No UX-DR specifies this screen. Shipped flow, built only from existing primitives (`Card`, `CardContent`, `Label`, `Button`, `MoneyInput`, `toast`):
1. Step heading (unchanged) → starter block as primary content: `h3` heading, description, and an "these amounts are not locked in" note.
2. One `Card` per template group; inside, a `Monthly target` caption and one row per category: `<Label htmlFor>` carrying the category name (so the name *is* the input's accessible name) beside a 9rem `MoneyInput` pre-filled from `target_cents`.
3. A single primary `Use this budget` button, disabled while pending with a `Adding…` label.
4. Beneath it, when the starter is on offer, a secondary outline `Start from scratch instead` button plus a one-line hint; clicking it expands the step's original manual group/category UI. Neither path is removed.
Deliberately **not** invented: no stepper, no diff view, no confirmation dialog, no per-row reset affordance, no de-emphasis styling beyond the existing `outline` button variant.

**Decisions and deviations**

1. **Override validation returns `AppError::Validation`, not import's `AppError::File`.** AC #4 requires "the same bounds validation as import" — the *rule* (`0..=MAX_TEMPLATE_TARGET_CENTS`) is reused verbatim from the shared constant so it cannot drift, but the error *type* is `Validation` because overrides come from our own UI, not an untrusted file. Import's opaque `AppError::File` copy exists specifically so an adversarial file cannot control user-visible text; that rationale does not apply here, and `Validation` matches `apply_system_template`'s existing error shape (AC #4 mandates `Validation` for unmatched entries, so a single error type keeps the command coherent).
2. **Merge logic lives in `budget/template_defaults.rs`, not the command.** `apply_system_template` takes `State<DbState>`, which cannot be constructed in a lib unit test. Extracting `merge_target_overrides()` as a pure function makes the whole of AC #4 directly testable (10 unit tests) while keeping the command a thin orchestrator per `project-context.md` §3. The command→DB path is then covered end-to-end by a real-`Connection` test in `db/budget_template.rs` and by the Playwright specs.
3. **Case-insensitive matching uses `.trim().to_lowercase()`**, the exact rule the shared apply core already uses for group-name collisions — so an override addresses precisely the row a later apply would create. Verified by test with `"  hOuSiNg  "` / `"rent / MORTGAGE"`.
4. **Validate-then-merge is all-or-nothing.** Every override entry is checked before a single value is merged, so a rejected request can never yield a partially edited document (test: `merge_rejects_the_whole_request_when_any_entry_is_invalid`).
5. **Group+category must match as a pair.** `"Housing"/"Groceries"` is rejected even though both names exist (in different groups) — otherwise an edit could silently land on the wrong row.
6. **`target_cents: 0` is accepted, then normalized to `$1.00` by the shared core.** This is pre-existing, documented behaviour of `apply_template_inner` (`target_cents.filter(|c| *c > 0).unwrap_or(DEFAULT_TEMPLATE_TARGET_CENTS)`), inherited unchanged because AC #4 mandates the non-negative bounds rule and the epic forbids duplicating apply logic. Flagged as a **known inherited wart**, not introduced here: a user who zeroes a target gets $1.00 rather than $0. Fixing it means changing shared import behaviour — out of 25.4's scope.
7. **Unedited and re-typed-to-default categories send no override.** `buildOverrides()` diffs against the authored default, so typing `1800` into a category already at `$1,800.00` produces `overrides: undefined`, not a redundant entry (E2E: *re-typing a target's own default is not sent as an override*).
8. **`undefined`, not `[]`, when there are no overrides.** Rust reads a missing argument as "apply the authored defaults"; an explicit empty array would be a semantically different request. Locked by a unit test and an E2E payload assertion.
9. **Detail query key is `["system-budget-templates", templateId]`** (new `queryKeys.systemBudgetTemplateDetail` factory in `constants.ts`, per §6 — no hardcoded keys). It shares the list's prefix because both describe the same immutable compiled-const resource; nothing invalidates either, and the existing "does not refetch the immutable system-template list after an apply" test still holds.
10. **`enabled: templateId !== ""`** on the detail query: the parent can render one pass before the template list resolves, and firing `get_system_template_detail("")` would hit Rust's unknown-id rejection for nothing.
11. **Onboarding-status invalidation is `await`ed before `navigate()`** (Conflict E). Not awaiting it races the `/` route's `beforeLoad` guard, which would read the stale cached `needs_onboarding: true` and bounce the user straight back into onboarding.
12. **`complete_onboarding` is deliberately *not* called** on the starter path. `check_onboarding_status` derives `needs_onboarding = !has_budget_data && !completed`; applying the template makes `has_budget_data` true, so the FR71 gate is satisfied and `setup_incomplete` stays false (no post-skip banner). This mirrors the wizard's own Next-button behaviour, which also defers the completion flag to Finish/Skip. Nothing in AC #7 or Task 4 asks for it.
13. **Graceful degradation is explicit, because onboarding is a first-run gate.** A pending detail query renders a loading line; an errored or empty one renders a short "not available right now — build it by hand below" note *and* the manual path becomes visible with no toggle to find. An apply failure toasts the backend message and leaves the user on the step with the fallback intact. Three E2E tests cover these (unavailable, apply-fails, skip-while-offered).
14. **Zero-created is not reported as success.** Checked first, exactly as 25.3 does: all-collided → `toast.info` naming every duplicate group; partial → `toast.success` naming the skipped ones; clean → plain counts. Both branches covered by E2E.
15. **Manual-path visibility is a 3-clause predicate**, each clause guarding a distinct failure mode: `showManualPath` (user asked), `groups.length > 0` (their existing data must stay visible — also covers returning here after an apply), and `!isPending && starterTemplateId === undefined` (no starter to offer → manual is the whole step). The `!isPending` term is what prevents the manual UI flashing visible then collapsing while the list is in flight.
16. **AC #6's "both call sites" is one call site plus one `variables` read.** `YourDataSettings.tsx` (25.3 as shipped) contains a single `mutateAsync(templateId)` and a single `applyStarterTemplate.variables` read used for the per-row `applyingId` label. Both were updated (`mutateAsync({ templateId })`, `variables?.templateId`); the second would have failed *silently* at runtime, not at compile time, so it is locked by a dedicated unit test that reads `variables.templateId` mid-flight.
17. **i18n:** 14 new keys in both locales, real fr-CA French (*"rien n'est coulé dans le béton"*, *"Cible mensuelle"*, *"Partir de zéro plutôt"*). U+2026 used for both pending states (`Adding…`, `Ajout en cours…`) per the established convention; a new `ELLIPSIS_KEYS` test now enforces that convention across all six pending-state template keys in both locales and rejects `...`.

**Existing tests changed (each justified — none deleted or weakened)**

| File | Change | Why |
|---|---|---|
| `src/hooks/__tests__/useBudgetTemplates.test.tsx` | 4 call sites `mutateAsync("canadian-starter")` → `mutateAsync({ templateId: … })` | Mechanically forced by AC #6's mandated signature widening. No assertion relaxed; the pre-existing wire-payload assertion `["apply_system_template", { template_id: "canadian-starter" }]` still passes byte-for-byte. |
| `src/hooks/__tests__/useBudgetTemplates.test.tsx` | `settleQueries()` given an optional predicate parameter, defaulting to the previous behaviour | Needed to also poll the new detail query. The existing zero-arg call site is untouched and the bounded-polling design is preserved — **no fixed-single-macrotask flush was introduced**. |
| `tests/onboarding.spec.ts` | 2 pre-existing tests gained one `onboarding-start-from-scratch` click before `add-group-button` | The step now leads with the starter template, so the manual path is one click deeper. This is the behaviour change the story asks for, not a test workaround; the tests still assert exactly what they asserted before. |
| `tests/onboarding.spec.ts` | `setupTauriMock` extended with `list_system_templates`, `get_system_template_detail`, `apply_system_template` (with real collision + override semantics) and two new options | Extends the existing harness rather than replacing it; all 11 original tests still pass. |

**Not fixed, deliberately (out of scope):** `budgetSummary` / `topBudgetCategories` query keys remain invalidated by no budget mutation anywhere — the known deferred gap.

### File List

**Modified**
- `apps/desktop/src-tauri/src/models/mod.rs`
- `apps/desktop/src-tauri/src/budget/template_defaults.rs`
- `apps/desktop/src-tauri/src/commands/budget_template.rs`
- `apps/desktop/src-tauri/src/db/budget_template.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/lib/types.ts`
- `apps/desktop/src/lib/constants.ts`
- `apps/desktop/src/hooks/useBudgetTemplates.ts`
- `apps/desktop/src/components/settings/YourDataSettings.tsx`
- `apps/desktop/src/components/onboarding/OnboardingBudgetStep.tsx`
- `apps/desktop/src/locales/en.json`
- `apps/desktop/src/locales/fr.json`
- `apps/desktop/src/hooks/__tests__/useBudgetTemplates.test.tsx`
- `apps/desktop/src/locales/__tests__/budget-templates-i18n.test.ts`
- `apps/desktop/tests/onboarding.spec.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/25-4-starter-template-path-in-onboarding-fork.md`

**Added**
- `apps/desktop/src/components/onboarding/OnboardingStarterTemplate.tsx`

**Deleted:** none.

### Verification (real output)

```
cargo check --all-targets   →  Finished `dev` profile … in 14.84s   (0 warnings, 0 errors)
cargo test --lib            →  test result: ok. 265 passed; 0 failed   (baseline 251, +14)
tsc --noEmit                →  clean, exit 0
pnpm --filter @nixus/desktop build (tsc && vite build)
                            →  ✓ built in 6.88s   (0 TS errors/warnings)
pnpm --filter @nixus/desktop test (vitest)
                            →  Test Files 6 passed (6) | Tests 103 passed (103)   (baseline 71, +32)
playwright test tests/onboarding.spec.ts
                            →  20 passed (9.0s)   (baseline 11, +9)
playwright test (full suite)
                            →  332 passed, 1 failed (1.5m)   (baseline 324 total, now 333)
```

New Rust tests (14): 10 × `merge_target_overrides` (no-op preserve, single apply + sibling isolation, case-insensitive/trimmed match, multi-entry, unknown group rejected, cross-group category pair rejected, negative/over-cap/`i64::MAX` rejected, inclusive bounds accepted, all-or-nothing batch, merged doc still satisfies shared validation) · 3 × `get_system_template_detail` (full detail incl. targets, authored order preserved, unknown id → `Validation` for `""`/`"nope"`/`"CANADIAN-STARTER"`) · 1 × `db` integration (merged template's edited target persists, siblings keep defaults, still exactly one `source: "system"` audit row).

New vitest tests (32): 7 × hook (no-overrides payload omits `overrides`, camelCase→snake_case mapping, `variables.templateId` mid-flight, no `onboarding-status` invalidation from the hook, detail fetch by snake_case id, per-id detail key, empty id does not fetch) · 25 × i18n (14 new required keys, onboarding-prefix cross-locale parity, declared-vs-shipped key reconciliation, 3 new placeholder sets, 6 × ellipsis convention).

New Playwright tests (9): starter presented with pre-filled editable targets · edit sends only that override and lands on `/` · no edits sends no overrides · re-typed default sends no override · all-collided says nothing was added · partial collision names skips · starter unavailable → manual path immediately usable · failed apply keeps user on step with reason and fallback intact · skip path still works while the starter is offered.

**Sole failure is non-attributable and pre-existing:** `chat.spec.ts:250 › money in an answer is tabular Inter, never monospace [AC4]` (`Expected "tabular-nums", Received "normal"`) — a known real failure on the listed exclusion list, untouched by this story. None of the known parallelism-flaky specs (`accounts.spec.ts:333/:472`, `expenses.spec.ts:426`, `maintenance.spec.ts:1290/:1436/:1561`) failed in this run.

**Nothing committed.** `git status` confirms all work is uncommitted on `master`; no `add`/`commit`/`stash`/`checkout`/branch operation was run. Baseline commit remains `1bc5427`.

### Post-Review Decision (human/product call)

The sole open `[Review][Decision]` finding — duplicate override entries for the same (group, category)
pair in `merge_target_overrides` — is resolved: **accept as-is, defer.** The case is unreachable through
the shipped UI (`buildOverrides` in `OnboardingStarterTemplate.tsx` can only emit one entry per category),
the first-entry-wins behavior is locked by the regression test added during code review, and a defensive
rejection at the Rust boundary would be speculative hardening against a caller that does not exist. Logged
in `deferred-work.md` under "Deferred from: code review of 25-4-starter-template-path-in-onboarding-fork";
revisit only if a future caller can construct raw override lists (e.g. a public API or an AI-driven apply
path). No product code changed. Story status → **done**.

### Change Log

| Date | Change |
|---|---|
| 2026-08-04 | Story 25.4 implemented. Rust: `TemplateTargetOverride` + `merge_target_overrides()` + widened `apply_system_template`; new `get_system_template_detail` command with 3 owned projection structs, registered in `lib.rs`. Frontend: `useSystemTemplateDetail` hook, `useApplySystemTemplate` variables widened to `{ templateId, overrides? }`, `YourDataSettings` call sites updated, new self-contained `OnboardingStarterTemplate` component rendered as `OnboardingBudgetStep`'s primary content with the manual path retained behind a toggle. 14 i18n keys × 2 locales (1139 → 1153, identical order). 55 new tests (14 Rust, 32 vitest, 9 Playwright); 2 pre-existing onboarding E2E tests and 4 hook-test call sites updated for the new UI fork and mandated signature. Status → review. |
| 2026-08-04 | Adversarial code review (`bmad-code-review`). Verdict: **PASS**. One `patch` applied (test-only, no product-code change): added `merge_with_duplicate_overrides_for_the_same_pair_uses_the_first_entry` to `budget/template_defaults.rs`, locking the previously-untested first-entry-wins behavior for duplicate override entries targeting the same (group, category) pair. One `decision-needed` reported, not resolved (needs a human/product call): whether duplicate overrides for the same pair should instead be rejected outright as a defensive measure — currently unreachable via the shipped UI (`buildOverrides` cannot emit duplicates), so not blocking. All 11 ACs independently re-verified against code (not just tests); `merge_target_overrides`'s bounds/pair-matching/all-or-nothing logic mutation-tested (2 injected regressions, both caught); merge-before-lock ordering, `undefined`-vs-`[]` Option semantics (traced into Tauri's `CommandItem::deserialize_option`, confirmed missing-key → `None`), the FR71 gate (`needs_onboarding = !has_data && !completed`), and the `fillMoneyInput()` Playwright-only harness fix (confirmed unreachable via keyboard/paste/realistic autofill) all traced independently and confirmed correct. i18n: en/fr both exactly 1153 keys, identical order, no empty values, matching placeholders, U+2026 in all 6 new pending-state keys, no orphaned keys. Full verification suite re-run with real output: `cargo check`/`clippy -D warnings` clean, `cargo test --lib` 266 passed (265 + the new regression test), `tsc --noEmit` clean, `pnpm build` clean, vitest 103/103, `onboarding.spec.ts` 20/20 twice (stable), `budget-templates.spec.ts` 15/15, full Playwright suite 332 passed / 1 failed (`chat.spec.ts:250`, pre-existing, non-attributable; none of the known parallelism-flaky specs failed). Whole-feature (epics 24-25) integrity check: all 5 `budget_template` Tauri commands registered in `lib.rs`, no orphaned `settings.template*`/`onboarding.starterTemplate*` i18n keys, no TODO/FIXME/`allow(dead_code)` markers. Two informational-only notes (no code action): (1) Completion Notes' rationale for awaiting the `onboardingStatus` invalidation before `navigate()` slightly overstates the mechanism — the `/` route's `beforeLoad` calls `fetchOnboardingStatus()` directly and always bypasses the query cache, so it cannot read stale cached state either way; the await remains good practice for `IndexPage`'s own `useOnboardingStatus()` read. (2) Completion Notes item 13 overstates the `get_system_template_detail`-failure fallback: only a `list_system_templates` failure auto-reveals the manual path without a click; a detail-query failure still requires one click on "Start from scratch instead" (not a dead end, and practically unreachable since both commands read the same compiled-in const). Review artifact: this Change Log entry + inline Review Findings section below. |
| 2026-08-04 | Post-review decision on the sole open `[Review][Decision]` finding (duplicate override entries for the same (group, category) pair in `merge_target_overrides`): **accept as-is, defer.** Unreachable via the shipped UI, first-entry-wins behavior locked by the review's regression test, defensive rejection would be speculative hardening against a non-existent caller. Logged in `deferred-work.md`. No product code changed. Status → **done**. |
