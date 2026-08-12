---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prd-savings-projects.md
  - _bmad-output/planning-artifacts/architecture-savings-projects.md
  - docs/project-context.md
---

# nixus - Epic Breakdown: Savings Projects

## Overview

This document provides the complete epic and story breakdown for the Savings Projects feature, decomposing the requirements from [prd-savings-projects.md](../_bmad-output/planning-artifacts/prd-savings-projects.md) and [architecture-savings-projects.md](../_bmad-output/planning-artifacts/architecture-savings-projects.md) into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Users can create a project with a name, target amount, optional target date, and priority rank
FR2: Users can edit or archive an existing project
FR3: Users can log a manual contribution to a project, specifying a source account and amount
FR4: Users can delete a logged contribution
FR5: Users can view, per account, how its balance splits into unallocated and per-project earmarked amounts
FR6: The system computes a suggested monthly allocation across active projects, but only when the user's current waterfall step is `ContributeRegisteredAccounts` or `InvestSurplus`
FR7: Users can edit each project's suggested amount before confirming, with the total capped at the available monthly surplus
FR8: Confirming a suggestion creates one `project_contributions` row per project with `source = suggested`; skipping creates none
FR9: Users can reorder active projects by priority, which changes the default suggested-split weighting
FR10: The dashboard displays a single summary card showing total saved across all active projects

### NonFunctional Requirements

NFR1: Project and contribution CRUD operations complete in under 100ms on the local SQLite store
NFR2: All monetary values stored and computed as integer cents, matching the existing `_cents` convention
NFR3: Deleting an account with existing project contributions is blocked, enforced via `ON DELETE RESTRICT` foreign key
NFR4: The suggested-allocation computation must not persist any data until user confirmation

### Additional Requirements

- Migration `025_projects.sql` adds `projects` and `project_contributions` tables, registered in `db/mod.rs`'s migration array (Architecture: Data Architecture)
- New pure-logic module `src-tauri/src/projects/allocation.rs` mirrors the `financial_health::evaluator` pattern — deterministic, no DB access (Architecture: Decision Impact Analysis)
- Frontend ships at `/wealth/projects`, consuming the one remaining slot in `navigation.ts`'s `Wealth` destination — no new top-level rail module (Architecture: Frontend Architecture)
- Reuse existing UI primitives: `NetWorthBreakdownBar` for earmark splits, `BudgetCategoryRow`'s meter/badge shape for per-project progress, `DashboardMetricCard` for the dashboard rollup — no new design-system primitives (Architecture: Frontend Architecture)
- Every mutation must call `audit_db::insert_audit_log` (`entity_type = "project"` or `"project_contribution"`) per project-context.md rule #3
- Every mutation's `onSuccess` must invalidate all affected `queryKeys` entries (`projects`, `project(id)`, `accountEarmarks(accountId)`, dashboard savings query) per project-context.md rule #6
- No starter template applicable — this is a feature addition to the existing Tauri/React/Rust/SQLite monorepo, no project scaffolding needed

### FR Coverage Map

FR1: Epic 31 - Create a savings project
FR2: Epic 31 - Edit or archive a savings project
FR3: Epic 31 - Log a contribution to a project
FR4: Epic 31 - Delete a logged contribution
FR5: Epic 31 - View per-account earmark breakdown
FR6: Epic 32 - Compute suggested monthly allocation
FR7: Epic 32 - Edit suggested amounts before confirming
FR8: Epic 32 - Confirm or skip a suggestion
FR9: Epic 32 - Reorder project priority
FR10: Epic 31 - Dashboard savings summary card
NFR3: Epic 31 - Account-deletion guard (enforced by schema + surfaced error)
NFR4: Epic 32 - Read/write separation on suggestion flow

## Epic List

### Epic 31: Savings Projects Foundation
Users can create named savings goals, log manual contributions toward them from any account, see exactly how each account's balance splits across goals, and see total progress at a glance on the dashboard — all without any real money movement. **Standalone: complete, usable goal-tracking feature on its own.**
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR10, NFR3

### Epic 32: Smart Allocation Suggestions
Users with multiple active projects can reorder them by priority and get a transparent, editable, opt-in suggestion each month for how to split their surplus across goals — never applied without explicit confirmation. **Standalone: builds on Epic 31's projects but Epic 31 does not require this epic to function.**
**FRs covered:** FR6, FR7, FR8, FR9, NFR4

---

## Epic 31: Savings Projects Foundation

Users can create named savings goals, log manual contributions toward them from any account, see exactly how each account's balance splits across goals, and see total progress at a glance on the dashboard — all without any real money movement.

### Story 31.1: Create and manage savings projects

As a Nixus user,
I want to create a named savings goal with a target amount and optional date,
so that I have a place to track progress toward a specific big purchase.

**Acceptance Criteria:**

**Given** I am on the Wealth section of the app
**When** I navigate to the new Projects sub-surface
**Then** I see a list of my active projects (empty state if none exist)

**Given** I am on the Projects list
**When** I create a project with a name and target amount (target date and priority optional)
**Then** the project is persisted and appears immediately in the list with $0 saved of the target

**Given** an existing project
**When** I edit its name, target amount, or target date
**Then** the changes are saved and reflected immediately in the list

**Given** an existing project
**When** I archive it
**Then** it disappears from the active list but its data is retained (not hard-deleted)

**And** every create/update/archive action writes an audit log entry with `entity_type = "project"`

### Story 31.2: Log and remove contributions to a project

As a Nixus user,
I want to log money I've set aside toward a project from a specific account,
so that I can track my progress without physically moving money.

**Acceptance Criteria:**

**Given** an existing active project
**When** I log a contribution specifying a source account, amount, and date
**Then** the contribution is saved, the project's "saved" total increases by that amount, and the source account's `balance_cents` is unchanged

**Given** a project with one or more logged contributions
**When** I view the project
**Then** I see saved amount, remaining amount, and percent complete, computed from the sum of its contributions

**Given** a logged contribution
**When** I delete it
**Then** the project's saved total decreases by that amount and the source account's `balance_cents` remains unchanged

**And** every contribution create/delete writes an audit log entry with `entity_type = "project_contribution"`

### Story 31.3: See how a project's contributions split an account's balance

As a Nixus user,
I want to see how much of an account's balance is earmarked for each project versus unallocated,
so that I don't mistake earmarked money for money I'm free to spend.

**Acceptance Criteria:**

**Given** an account with contributions logged toward one or more projects
**When** I view that account on the Accounts page
**Then** I see a breakdown showing unallocated balance plus one segment per project, summing exactly to the account's `balance_cents`

**Given** an account with no project contributions
**When** I view that account
**Then** no earmark breakdown is shown (clean empty state, not a degenerate single-segment bar)

**And** the breakdown reuses the existing stacked-bar + legend component already used for net-worth composition, introducing no new visual primitive

### Story 31.4: See total saved toward goals on the dashboard

As a Nixus user,
I want to see my total progress across all savings goals from the main dashboard,
so that I don't have to visit the Projects page to check in.

**Acceptance Criteria:**

**Given** I have at least one active project with contributions
**When** I view the Finance "Today" dashboard
**Then** I see a summary card showing the total amount saved across all active projects

**Given** I have no active projects
**When** I view the dashboard
**Then** the card is not shown (no empty/zero-value card clutter)

**Given** I log or delete a contribution
**When** the mutation succeeds
**Then** the dashboard card's figure updates without requiring a manual page refresh

### Story 31.5: Account deletion is blocked while it funds an active project

As a Nixus user,
I want to be prevented from deleting an account that still has money earmarked in a project,
so that I don't lose track of which project that money belonged to.

**Acceptance Criteria:**

**Given** an account with at least one logged project contribution
**When** I attempt to delete that account
**Then** the deletion is rejected with a clear, specific error message naming the affected project(s)

**Given** an account with no project contributions
**When** I delete it
**Then** the deletion proceeds exactly as it does today (no behavior change)

**And** the block is enforced at the database layer via the `project_contributions.account_id` foreign key (`ON DELETE RESTRICT`), not solely by application-level checks

---

## Epic 32: Smart Allocation Suggestions

Users with multiple active projects can reorder them by priority and get a transparent, editable, opt-in suggestion each month for how to split their surplus across goals — never applied without explicit confirmation.

### Story 32.1: Reorder project priority

As a Nixus user with multiple active goals,
I want to rank my projects by priority,
so that the app knows which goal matters most to me when suggesting how to split my savings.

**Acceptance Criteria:**

**Given** two or more active projects
**When** I reorder them (e.g. drag to reorder) on the Projects list
**Then** each project's priority value is persisted and the new order is reflected immediately

**Given** a freshly created project with no explicit priority set
**When** it is created
**Then** it defaults to the lowest priority (added to the end of the order)

### Story 32.2: Get a suggested monthly allocation across active projects

As a Nixus user who has already covered my emergency fund and debt,
I want the app to suggest how to split my monthly surplus across my active goals,
so that I don't have to do that math myself every month.

**Acceptance Criteria:**

**Given** my current financial-health waterfall step is `BuildEmergencyFund` or `PayHighInterestDebt`
**When** I request a suggested allocation
**Then** no suggestion is returned (empty/absent) — the app never proposes discretionary savings before the safety net is covered

**Given** my current waterfall step is `ContributeRegisteredAccounts` or `InvestSurplus` and I have active projects
**When** I request a suggested allocation
**Then** I receive a proposed amount per active project, weighted by priority and deadline urgency, summing to no more than my current average monthly surplus

**And** requesting a suggestion never writes any data — calling it repeatedly with no other changes returns the same result and creates zero database rows

### Story 32.3: Review and edit a suggested allocation before confirming

As a Nixus user reviewing a suggested allocation,
I want to see and adjust each project's proposed amount before anything is saved,
so that I stay in full control of my own money.

**Acceptance Criteria:**

**Given** a suggested allocation has been computed for my active projects
**When** I view the suggestion panel
**Then** I see every active project's proposed amount side by side, each independently editable

**Given** I edit one or more proposed amounts
**When** the edited total exceeds my available monthly surplus
**Then** I am blocked from proceeding until the total is within the available surplus

**Given** I edit proposed amounts within the available surplus
**When** I view the panel
**Then** nothing has been saved yet — editing amounts on screen creates no database rows

### Story 32.4: Confirm or skip a suggested allocation

As a Nixus user reviewing a suggested allocation,
I want to explicitly confirm or skip it,
so that money is only ever earmarked with my direct approval.

**Acceptance Criteria:**

**Given** a reviewed (possibly edited) suggested allocation
**When** I confirm it
**Then** one `project_contributions` row per project is created with `source = "suggested"`, each project's saved total updates accordingly, and an audit log entry is written for each

**Given** a reviewed suggested allocation
**When** I skip it instead of confirming
**Then** no `project_contributions` rows are created and no project's saved total changes

**And** confirming triggers the same dashboard/project-list cache invalidation as a manual contribution, so all views reflect the change immediately
