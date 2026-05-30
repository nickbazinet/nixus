# Story 8.1: First-Time Onboarding Wizard

Status: review

## Story

As a first-time user,
I want a guided setup wizard to create my budget, add accounts, and add assets,
So that I can get started with the app quickly.

## Acceptance Criteria

**Given** the app launches with no budget data (empty database)
**When** the dashboard detects the empty state
**Then** the user is redirected to the OnboardingWizard component (UX-DR12)
**And** a 4-step horizontal indicator shows: Budget → Accounts → Assets → Import
**And** each step uses `role="tablist"` with `role="tab"` per step and `role="tabpanel"` for content

**Given** the user is on Step 1 (Budget)
**When** the user creates category groups and categories with targets
**Then** the budget is saved using the same backend as Epic 2
**And** "Next" advances to Step 2

**Given** the user is on Steps 2 (Accounts), 3 (Assets), or 4 (Import)
**When** the user wants to skip a step
**Then** a "Skip" ghost button allows advancing without adding data
**And** "Back" allows returning to previous steps

**Given** the onboarding is complete (user finishes or skips to the end)
**When** the wizard closes
**Then** the user lands on the Dashboard with whatever data was entered
**And** subsequent app launches go directly to the Dashboard (onboarding not shown again)

## Tasks / Subtasks

### Task 1: Onboarding Detection — Backend Command

Create a Tauri command to check whether the app has been set up (data exists in the database).

**AC reference:** "app launches with no budget data" + "subsequent app launches go directly to the Dashboard"

- Create `#[tauri::command] fn check_onboarding_status(state) -> Result<OnboardingStatus, AppError>` in `src-tauri/src/commands/backup.rs` or a new `src-tauri/src/commands/onboarding.rs`
- `OnboardingStatus { needs_onboarding: bool }` — returns `true` if `budget_groups` table has zero rows
- Query: `SELECT COUNT(*) FROM budget_groups` — if 0, onboarding is needed
- Register command in `main.rs`
- Verify: Command returns `needs_onboarding: true` on fresh database, `false` after budget data exists

### Task 2: Onboarding Detection — Frontend Redirect

Detect empty state on dashboard load and redirect to the onboarding wizard.

**AC reference:** "dashboard detects the empty state" + "user is redirected to the OnboardingWizard"

- Add a `useOnboardingStatus` hook in `src/hooks/useOnboardingStatus.ts` that calls `check_onboarding_status` via TanStack Query
- In the dashboard route (`src/routes/index.tsx`), check onboarding status on mount
- If `needs_onboarding` is `true`, redirect to `/onboarding` route using TanStack Router's `navigate()`
- Add `/onboarding` route in `src/routes/onboarding.tsx` that renders `OnboardingWizard`
- Verify: Fresh app redirects to `/onboarding`; app with data loads dashboard directly

### Task 3: OnboardingWizard Component — Shell and Step Indicator

Build the wizard shell with a 4-step horizontal progress indicator.

**AC reference:** "4-step horizontal indicator shows: Budget → Accounts → Assets → Import" + ARIA roles

- Create `src/components/onboarding/OnboardingWizard.tsx`
- Horizontal step indicator at the top with labels: Budget, Accounts, Assets, Import
- Step states: completed (checkmark icon), current (highlighted/teal), upcoming (muted)
- Step indicator uses `role="tablist"` with each step as `role="tab"` and `aria-selected` for current
- Content area below step indicator with `role="tabpanel"`
- Manage current step via local React state (number 1-4)
- Navigation buttons: "Next" (primary/teal), "Skip" (ghost, steps 2-4 only), "Back" (ghost, steps 2+)
- Step 1 does not show "Skip" — budget is required
- Verify: All 4 steps render, navigation buttons work, ARIA roles are correct

### Task 4: Step 1 — Budget Setup

Implement the Budget step reusing existing Epic 2 components/commands.

**AC reference:** "user creates category groups and categories with targets" + "budget is saved using the same backend as Epic 2"

- Render a simplified budget creation form within the wizard step panel
- Reuse `create_budget_group` and `create_budget_category` Tauri commands (from Epic 2)
- Form fields: group name, category name, target amount (MoneyInput pattern)
- "Add another group" / "Add another category" buttons to keep adding without navigation
- Use React Hook Form with inline validation (name required, target > 0)
- On "Next" click, data is already saved (each add saves immediately via Tauri command)
- Verify: Budget groups and categories are created in the database

### Task 5: Step 2 — Accounts Setup

Implement the Accounts step reusing existing Epic 4 components/commands.

**AC reference:** Steps 2/3/4 allow skip + "Back" returns to previous steps

- Render a simplified account creation form: name, institution, type, currency, balance
- Reuse `create_account` Tauri command (from Epic 4)
- "Add another" button for multiple accounts
- "Skip" ghost button to advance to Step 3 without adding any accounts
- Verify: Accounts are saved to database; skip works correctly

### Task 6: Step 3 — Assets Setup

Implement the Assets step reusing existing Epic 4 components/commands.

**AC reference:** Steps 2/3/4 allow skip

- Render a simplified asset creation form: name, type, estimated value
- Reuse `create_asset` Tauri command (from Epic 4)
- "Add another" button for multiple assets
- "Skip" ghost button to advance to Step 4
- Verify: Assets are saved to database; skip works correctly

### Task 7: Step 4 — First Import (Optional)

Implement the Import step as an optional final step.

**AC reference:** "onboarding is complete" + skip to end

- Show an option to upload a CC statement or skip
- If user chooses to import, reuse the CC import flow from Epic 5 (or show a prompt to use Import page later)
- "Skip" or "Finish" button to complete onboarding
- On completion, navigate to the dashboard route
- Verify: Completing or skipping Step 4 navigates to dashboard

### Task 8: Playwright E2E Tests

Write and run Playwright tests for the onboarding flow.

**AC reference:** Testing section from epic

- Create `tests/onboarding.spec.ts`
- Test: With empty database, app redirects to onboarding wizard (not dashboard)
- Test: 4-step horizontal indicator shows Budget → Accounts → Assets → Import
- Test: Step 1 (Budget) allows creating a group and category; "Next" advances to Step 2
- Test: Steps 2-4 show a "Skip" button that advances to the next step
- Test: "Back" button returns to the previous step
- Test: After completing onboarding, user lands on Dashboard
- Test: On next launch with data, dashboard loads directly (no onboarding redirect)
- Verify: All tests pass via `npx playwright test tests/onboarding.spec.ts`

## Dev Notes

### Architecture

- OnboardingWizard is a frontend-only orchestration component — it reuses all existing backend commands from Epics 2 and 4
- Empty state detection is a lightweight query on `budget_groups` count — no new tables needed
- The wizard does NOT store its own progress state in the database; it simply checks whether budget data exists
- Each step saves data immediately via existing Tauri commands (no "save all at the end" pattern)

### Components

- `src/components/onboarding/OnboardingWizard.tsx` — main wizard shell with step indicator and navigation
- Step content can be inline in the wizard or extracted to `OnboardingBudgetStep.tsx`, `OnboardingAccountsStep.tsx`, etc. if complexity warrants it
- Reuse shadcn Card, Button, Input, and existing MoneyInput components
- Step indicator is a custom composition using shadcn primitives (no new atomic components)

### Testing

- Playwright tests need a way to start with an empty database — may need a test utility to reset DB state
- Tests should verify actual data persistence (not just UI navigation)

### Scope

- The wizard is a convenience layer — all underlying operations already exist from prior epics
- Step 4 (Import) can be a simple prompt rather than embedding the full import flow; user can use the Import page after onboarding
- No new database tables or migrations required for this story

### Project Structure Notes

**Frontend files:**
- `src/components/onboarding/OnboardingWizard.tsx` — wizard component
- `src/hooks/useOnboardingStatus.ts` — onboarding detection hook
- `src/routes/onboarding.tsx` — onboarding route

**Backend files:**
- `src-tauri/src/commands/onboarding.rs` (or add to existing commands) — `check_onboarding_status` command

**Test files:**
- `tests/onboarding.spec.ts`

### References

- UX-DR12: OnboardingWizard component spec (UX Design Specification)
- UX Journey 1: First-Time Setup flow (UX Design Specification)
- Epic 2: Budget management commands (reused)
- Epic 4: Account and asset commands (reused)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed test "after completing onboarding, user lands on Dashboard" — needed to create budget data in Step 1 before finishing, otherwise dashboard redirects back to onboarding due to empty state detection.

### Completion Notes List
- Task 1: Created `src-tauri/src/commands/onboarding.rs` with `check_onboarding_status` command. Queries `budget_groups` count. Registered in `lib.rs`.
- Task 2: Created `useOnboardingStatus` hook. Added redirect logic in dashboard route (`index.tsx`). Created `/onboarding` route.
- Task 3: Built `OnboardingWizard.tsx` with 4-step horizontal indicator using `role="tablist"`/`role="tab"`/`role="tabpanel"`. Step states: completed (checkmark), current (teal), upcoming (muted). Navigation: Next, Back, Skip, Finish.
- Task 4: `OnboardingBudgetStep.tsx` — reuses `create_budget_group`/`create_budget_category` via existing hooks. React Hook Form + MoneyInput. Add Group / Add Category buttons.
- Task 5: `OnboardingAccountsStep.tsx` — reuses `create_account` via existing hook. Same form pattern as Epic 4 AddAccountForm.
- Task 6: `OnboardingAssetsStep.tsx` — reuses `create_asset` via existing hook. Same form pattern as Epic 4 AddAssetForm with MoneyInput.
- Task 7: `OnboardingImportStep.tsx` — simple prompt with link to Import page. No embedded import flow (per story scope note).
- Task 8: 7 Playwright E2E tests all passing. Full suite: 130/130 pass, zero regressions.

### File List
- `src-tauri/src/commands/onboarding.rs` (new)
- `src-tauri/src/commands/mod.rs` (modified — added onboarding module)
- `src-tauri/src/lib.rs` (modified — registered check_onboarding_status command)
- `src/hooks/useOnboardingStatus.ts` (new)
- `src/lib/constants.ts` (modified — added onboardingStatus query key)
- `src/routes/index.tsx` (modified — added onboarding redirect)
- `src/routes/onboarding.tsx` (new)
- `src/routeTree.gen.ts` (regenerated — includes /onboarding route)
- `src/components/onboarding/OnboardingWizard.tsx` (new)
- `src/components/onboarding/OnboardingBudgetStep.tsx` (new)
- `src/components/onboarding/OnboardingAccountsStep.tsx` (new)
- `src/components/onboarding/OnboardingAssetsStep.tsx` (new)
- `src/components/onboarding/OnboardingImportStep.tsx` (new)
- `tests/onboarding.spec.ts` (new)

### Change Log
- 2026-03-15: Implemented Story 8.1 — First-Time Onboarding Wizard. All 8 tasks complete. 7 E2E tests added. 130/130 full suite passing.
