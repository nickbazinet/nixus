---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
inputDocuments:
  - prd.md
  - architecture.md
  - ux-design-specification.md
scope: income-module
---

# nkbaz-finance - Income Module Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the nkbaz-finance Income Module, decomposing the income-related requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR33: User can add an income source with a name and type (employment, freelance, investment, other)
- FR34: User can edit or remove an existing income source
- FR35: User can record a monthly income entry for a source with the amount received and month
- FR36: User can view income history by source and by month
- FR37: User can view total income for the current month
- FR38: User can view income versus total expenses for the current month on the dashboard
- FR39: System can provide income-aware spending recommendations when the user has recorded income data

### NonFunctional Requirements

- NFR1: Dashboard loads and renders all data (budget status, account balances, net worth) within 1 second on subsequent visits — applies to cash flow card
- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay) — applies to Income page
- NFR11: Financial records (transactions, balances, net worth snapshots) are never silently lost or corrupted — applies to income entries
- NFR13: Balance and net worth calculations are accurate to the cent — applies to income amounts and cash flow calculations

### Additional Requirements

- Income monetary values stored as integer cents in SQLite (Architecture: financial precision pattern)
- Income module needs its own Rust db module (`db/income.rs`) and commands module (`commands/income.rs`) per feature-based organization pattern
- Frontend follows feature-based structure: `routes/income.tsx`, `components/income/`, `hooks/useIncome.ts`
- TanStack Query keys for income: `["income-sources"]`, `["income-entries", month]`, `["income-total", month]`
- All Tauri commands return `Result<T, AppError>` with typed errors
- IPC commands follow `snake_case` naming: `get_income_sources`, `create_income_source`, `update_income_source`, `delete_income_source`, `create_income_entry`, `update_income_entry`, `get_income_entries`, `get_income_total`
- Audit log entries for all income data changes (creates, updates, deletes)
- Database migration file for income tables (`income_sources`, `income_entries`)
- JSON field naming: `snake_case` (matches Rust structs). Monetary values as integer cents in JSON.
- Dates as ISO 8601 strings

### UX Design Requirements

- UX-DR1: CashFlowSummaryCard on dashboard — full-width card showing Income (emerald), Expenses (rose), Net (emerald/rose based on sign). Progress bar: emerald <90%, amber 90-100%, rose >100%. Clickable → navigates to Income page. Empty state: "No income recorded this month" with link to Income page.
- UX-DR2: Income page with two sections — Income Sources (top card with source list + "Add Source" button) and Monthly History (bottom card with table: Month, Source, Amount columns, sorted newest first, filterable by source via Select dropdown)
- UX-DR3: IncomeSourceRow component — source name (14px, 500 weight), type badge (Employment=teal, Freelance=sky, Investment=purple, Other=slate), last recorded amount (monospace, muted). Click row → inline amount field for current month entry. Enter to save. Hover reveals edit/delete icons.
- UX-DR4: IncomeEntryRow component — month label, source name (muted), amount (monospace, right-aligned, 500 weight). Hover reveals edit icon on amount. Click → inline Input for editing.
- UX-DR5: Onboarding Step 4 (Income Sources) — add source name + type only, no amount entry during onboarding. Skippable. Part of 5-step wizard: Budget → Accounts → Assets → Income → Import.
- UX-DR6: Empty states — Dashboard: "Record your income to see cash flow" + link. Income page no sources: "Add your first income source to start tracking cash flow" + button. Sources but no entries: "No income recorded yet. Click a source above to record this month's income."
- UX-DR7: Toast feedback on income recording — positive emerald styling, e.g. "Income recorded — $4,250 from Employment"
- UX-DR8: Sidebar navigation includes "Income" as 3rd item: Dashboard, Budget, Income, Accounts, Assets, Net Worth, Import, AI Chat
- UX-DR9: Income recording is a micro-win — instant history update, immediate dashboard cash flow refresh, positive emotional feedback

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR33 | Epic 9 | Add income source (name, type) |
| FR34 | Epic 9 | Edit/remove income source |
| FR35 | Epic 9 | Record monthly income entry |
| FR36 | Epic 9 | View income history by source/month |
| FR37 | Epic 9 | View total income for current month |
| FR38 | Epic 10 | Dashboard income vs. expenses |
| FR39 | Epic 12 | AI income-aware recommendations |

## Epic List

### Epic 9: Income Source & Entry Management
Users can set up income sources, record monthly income amounts, view income history, and see their current month total — the complete income tracking capability.
**FRs covered:** FR33, FR34, FR35, FR36, FR37
**UX-DRs addressed:** UX-DR2, UX-DR3, UX-DR4, UX-DR6 (income page empty states), UX-DR7, UX-DR8, UX-DR9

### Epic 10: Dashboard Cash Flow Integration
Users can see income versus expenses for the current month at a glance on the dashboard, answering "am I ahead or behind?"
**FRs covered:** FR38
**UX-DRs addressed:** UX-DR1, UX-DR6 (dashboard empty state)

### Epic 11: Onboarding Income Step
New users can set up their income sources as part of the initial onboarding wizard, so cash flow tracking is ready from day one.
**FRs covered:** None directly (UX-driven)
**UX-DRs addressed:** UX-DR5

### Epic 12: AI Income-Aware Recommendations
The AI chat can factor in income data when answering spending questions, providing contextual recommendations.
**FRs covered:** FR39

---

## Epic 9: Income Source & Entry Management

Users can set up income sources, record monthly income amounts, view income history, and see their current month total — the complete income tracking capability.

### Story 9.1: Income Source Management

As a user,
I want to create, edit, and delete income sources with a name and type,
So that I have my income streams set up for tracking.

**Acceptance Criteria:**

**Given** no income sources exist
**When** the user navigates to the Income page
**Then** an empty state is shown: "Add your first income source to start tracking cash flow" with an Add Source button

**Given** the user is on the Income page
**When** they click "Add Source"
**Then** an inline form appears with name (text input) and type (Select: Employment, Freelance, Investment, Other)
**And** pressing Enter saves the source, Escape cancels

**Given** an income source exists
**When** the user views the Income Sources card
**Then** each source displays: name (14px, 500 weight), type badge (Employment=teal, Freelance=sky, Investment=purple, Other=slate), and last recorded amount or "—"

**Given** the user hovers over an income source row
**When** edit/delete icons appear
**Then** clicking edit makes name and type inline-editable
**And** clicking delete shows a confirmation dialog before removing the source

**Given** the sidebar navigation
**When** the app renders
**Then** "Income" appears as the 3rd nav item (Dashboard, Budget, Income, Accounts, Assets, Net Worth, Import, AI Chat)

**Given** income monetary values
**When** stored in the database
**Then** amounts are stored as integer cents in SQLite with `snake_case` column names

### Story 9.2: Monthly Income Entry Recording

As a user,
I want to record my monthly income amount for each source,
So that I can track what I actually received each month.

**Acceptance Criteria:**

**Given** an income source exists
**When** the user clicks the source row
**Then** an inline amount field appears below the row with the current month label and a dollar-prefixed Input

**Given** the inline amount field is open
**When** the user enters an amount and presses Enter
**Then** the income entry is saved for the current month and source
**And** a toast confirms: "Income recorded — $4,250 from Employment" (emerald styling)
**And** the source row updates to show the recorded amount as "last recorded"
**And** the change is logged in the audit_log table

**Given** an income entry already exists for this source and month
**When** the user clicks the source row again
**Then** the existing amount is pre-filled in the inline field for editing

**Given** the income entry amount
**When** stored and transmitted
**Then** the amount is stored as integer cents and serialized as cents in JSON

### Story 9.3: Income History View & Current Month Total

As a user,
I want to view my income history by source and month and see my total income for the current month,
So that I can track my earnings over time.

**Acceptance Criteria:**

**Given** income entries exist
**When** the user views the Monthly History section
**Then** a table shows columns: Month ("March 2026" format), Source (muted), Amount (monospace, right-aligned, 500 weight)
**And** entries are sorted newest first

**Given** the monthly history table
**When** the user selects a source from the filter dropdown
**Then** only entries for that source are displayed

**Given** the user hovers over an income entry row
**When** the edit icon appears on the amount
**Then** clicking it makes the amount an inline Input for editing
**And** saving updates the entry and shows a toast confirmation

**Given** no income entries exist but sources do
**When** the user views the Monthly History section
**Then** an empty state shows: "No income recorded yet. Click a source above to record this month's income."

**Given** income entries exist for the current month
**When** the Income page header renders
**Then** the total income for the current month is displayed

---

## Epic 10: Dashboard Cash Flow Integration

Users can see income versus expenses for the current month at a glance on the dashboard, answering "am I ahead or behind?"

### Story 10.1: Cash Flow Summary Card on Dashboard

As a user,
I want to see my income versus total expenses for the current month on the dashboard,
So that I can instantly know whether I'm ahead or behind.

**Acceptance Criteria:**

**Given** income and expenses exist for the current month
**When** the dashboard loads
**Then** a full-width CashFlowSummaryCard displays: Income (emerald), Expenses (rose), Net (emerald if positive, rose if negative) — all monospace H3 18px
**And** a progress bar shows expenses as proportion of income (emerald <90%, amber 90-100%, rose >100%)
**And** the card loads within 1 second (NFR1)

**Given** the CashFlowSummaryCard
**When** the user clicks it
**Then** they navigate to the Income page

**Given** no income has been recorded for the current month
**When** the dashboard loads
**Then** the card shows "No income recorded this month" with a link to the Income page
**And** the progress bar is hidden

**Given** the card is rendered
**When** a screen reader accesses it
**Then** `role="link"` and `aria-label` describe the cash flow (e.g., "Cash Flow: $4,250 income, $3,180 expenses, net positive $1,070")
**And** the progress bar has `role="progressbar"` with `aria-valuenow`

---

## Epic 11: Onboarding Income Step

New users can set up their income sources as part of the initial onboarding wizard, so cash flow tracking is ready from day one.

### Story 11.1: Add Income Sources Step to Onboarding Wizard

As a new user,
I want to set up my income sources during onboarding,
So that I'm ready to record income without extra setup later.

**Acceptance Criteria:**

**Given** the user is going through the onboarding wizard
**When** they complete the Assets step (Step 3)
**Then** Step 4 "Income Sources" is presented with the prompt "Set up your income sources so we can track your cash flow"

**Given** the Income Sources onboarding step
**When** the user adds a source
**Then** they enter a name and select a type (Employment, Freelance, Investment, Other)
**And** the source is saved using the existing `create_income_source` command

**Given** the Income Sources onboarding step
**When** the user clicks "Skip"
**Then** they proceed to Step 5 (Import) without adding any sources

**Given** the onboarding wizard step indicator
**When** rendered
**Then** it shows 5 steps: Budget → Accounts → Assets → Income → Import

---

## Epic 12: AI Income-Aware Recommendations

The AI chat can factor in income data when answering spending questions, providing contextual recommendations.

### Story 12.1: Income-Aware AI Chat Context

As a user,
I want the AI to consider my income when answering spending questions,
So that I get recommendations relative to what I actually earn.

**Acceptance Criteria:**

**Given** the user has recorded income for the current month
**When** they ask a spending-related question in AI chat (e.g., "Am I spending more than I earn?")
**Then** the AI response incorporates income data (e.g., "You've spent 78% of this month's income with 10 days left")

**Given** the user has no income recorded
**When** they ask a spending question
**Then** the AI responds based on expenses only without fabricating income data
**And** may suggest recording income for better recommendations

**Given** the AI constructs a prompt
**When** income data is available
**Then** the current month's income total and source breakdown are included in the Bedrock prompt context
