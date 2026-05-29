---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - prd.md
  - architecture.md
  - ux-design-specification.md
---

# nkbaz-finance - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for nkbaz-finance, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: User can create a monthly budget with customizable category groups
- FR2: User can set monthly spending targets for each budget category
- FR3: User can edit budget categories, groups, and targets
- FR4: User can view budget status showing spent vs. target for each category in the current month
- FR5: User can upload a credit card statement as a screenshot (image) or PDF
- FR6: System can extract individual transactions from an uploaded CC statement using AWS Bedrock
- FR7: System can auto-categorize extracted transactions into the user's budget categories
- FR8: System can flag transactions it is uncertain about for user review
- FR9: User can review and correct AI-categorized transactions before confirming
- FR10: System can report real-time progress of the import process (uploading → extracting → categorizing → done)
- FR11: User can view all expenses for a given month, grouped by budget category
- FR12: User can manually add an expense entry (merchant, amount, category, date)
- FR13: User can edit or delete an existing expense
- FR14: User can manually enter transactions that the AI failed to extract
- FR15: User can add a financial account (bank, investment, crypto, etc.) with a name, institution, type, and currency
- FR16: User can edit or remove an existing account
- FR17: User can update the current balance of any account
- FR18: User can view all accounts and their current balances in a single list
- FR19: User can add a passive asset (real estate, vehicle, business ownership, etc.) with a name, type, and estimated value
- FR20: User can edit or remove an existing passive asset
- FR21: User can update the estimated value of any passive asset
- FR22: User can view a dashboard showing budget status across all categories for the current month
- FR23: User can view total net worth (sum of all account balances + all passive asset values) on the dashboard
- FR24: User can view spending breakdown by category on the dashboard
- FR25: User can view all account balances on the dashboard
- FR26: System can record a net worth snapshot each time account balances or asset values change
- FR27: User can view net worth history over time as a trend
- FR28: User can view net worth breakdown by category (cash, crypto, housing, TFSA, RRSP, etc.)
- FR29: User can ask natural language questions about any data in the system
- FR30: System can answer data queries with accurate, up-to-date information from the database
- FR31: User can perform actions through chat (e.g., add expenses, update balances, modify budget categories)
- FR32: System can confirm actions with the user before executing write operations

### NonFunctional Requirements

- NFR1: Dashboard loads and renders all data within 1 second on subsequent visits
- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay)
- NFR3: CC statement import provides progress feedback within 2 seconds of upload
- NFR4: AI parsing and categorization completes within 30 seconds for a typical CC statement (15-25 transactions)
- NFR5: AI chat responses return within 5 seconds for data queries
- NFR6: Financial data is stored encrypted at rest (OS-level: FileVault/BitLocker)
- NFR7: All communication with external AI services uses HTTPS
- NFR8: File uploads are validated for type (image/PDF only) and size before processing
- NFR9: System gracefully handles AWS Bedrock service unavailability with clear error messaging
- NFR10: AI parsing failures do not block the user from manually entering transactions
- NFR11: Financial records (transactions, balances, net worth snapshots) are never silently lost or corrupted
- NFR12: Database supports backup and restore capability
- NFR13: Balance and net worth calculations are accurate to the cent (integer cents storage)

### Additional Requirements

- Starter template: `create-tauri-app` with `react-ts` template — project initialization as Epic 1 Story 1
- Post-scaffold setup: Tailwind CSS + shadcn/ui + TanStack Router + TanStack Query + React Hook Form + Recharts
- Rust backend: rusqlite with embedded SQL migrations (version-numbered `.sql` files, `schema_version` table)
- AI integration: AWS Bedrock via `aws-sdk-bedrockruntime` Rust SDK (no Strand SDK — Python-only, no Rust support)
- IPC patterns: Tauri commands for CRUD (request/response), Tauri events for streaming (import progress, chat responses)
- Frontend state: TanStack Query for data, React Context or Zustand for lightweight UI state
- Routing: TanStack Router with 7 flat routes
- Forms: React Hook Form for multi-field forms; inline controlled inputs for simple edits
- Error handling: Typed Rust error enums (`AppError` with `Validation`, `Database`, `AiService`, `File` variants) → structured JSON for frontend
- Monetary values: Integer cents storage in SQLite, formatted for display in frontend via `formatCurrency()` utility
- JSON field naming: `snake_case` end-to-end (Rust → JSON → TypeScript types)
- Audit log: `audit_log` table in SQLite for financial data changes
- Logging: `tracing` crate in Rust backend
- Backup/restore: SQLite file copy via native save dialog
- AWS credentials: Environment variables (`AWS_*` env vars)
- App data location: Tauri `appDataDir()` for SQLite database and logs
- SQLite WAL mode: Set on connection open for write-ahead logging
- Chat persistence: `chat_conversations` and `chat_messages` tables for multi-turn support
- Onboarding detection: Empty budget → redirect to OnboardingWizard

### UX Design Requirements

- UX-DR1: Implement dark sidebar navigation (240px fixed) with icon + label for 7 nav items (Dashboard, Budget, Accounts, Assets, Net Worth, Import, AI Chat), teal active state with right border accent
- UX-DR2: Implement spacious card-based dashboard layout — 2-column hero cards (Net Worth + Budget Remaining, `p-8`, 40px monospace values) and 3-column secondary cards (Cash, Investments, Assets, `p-8`, 24px values)
- UX-DR3: Build DashboardMetricCard component — card title (muted), value (Display/H1 monospace), trend indicator (arrow + percentage), optional sparkline/progress bar. Hero and Secondary variants. Clickable with `role="link"`.
- UX-DR4: Build BudgetCategoryRow component — category label, progress bar (8-10px, colored by status: teal <75%, amber 75-100%, rose >100%), "spent / target" monospace text, status badge. Hover expands to show recent transactions.
- UX-DR5: Build ImportProgressStepper component — 4 horizontal steps (Uploaded → Extracted → Categorized → Review) with status icons (checkmark/spinner/empty), connector arrows. `role="progressbar"` with `aria-valuenow`.
- UX-DR6: Build TransactionReviewCard component — merchant name, amount (monospace right-aligned), "AI suggests:" label + category Select dropdown. Warning-styled border, shifts to positive when resolved.
- UX-DR7: Build AutoCategorizedSummary component — checkmark + count text ("15 transactions auto-categorized"), expand toggle to show full editable transaction list. `aria-expanded` on toggle.
- UX-DR8: Build AccountRow component with inline-editable balance — account name, type + currency (muted), balance (monospace). Hover reveals edit icon, click balance to edit in place, Enter to save, Escape to cancel.
- UX-DR9: Build NetWorthBreakdownBar component — stacked horizontal bar (proportional colored segments per category), legend grid below (name, color dot, dollar amount, percentage). Hover tooltips on segments.
- UX-DR10: Build ChatMessageBubble component — user messages (teal bg, white text, right-aligned), AI messages (muted bg, left-aligned). AI messages may contain formatted data tables and action confirmation cards. `role="log"` container with `aria-live="polite"`.
- UX-DR11: Build FloatingChatBar component (Cmd+K overlay) — based on shadcn Command (cmdk), with response display area and "Open in full chat" link. Focus trapped, ESC closes, `role="dialog"`.
- UX-DR12: Build OnboardingWizard component — 4-step horizontal indicator (Budget → Accounts → Assets → Import), card-based forms per step, Next/Skip/Back navigation. Steps 2-4 skippable. `role="tablist"` + `role="tabpanel"`.
- UX-DR13: Implement color system with CSS variables — semantic tokens: `--background` (white), `--foreground` (Slate 900), `--primary` (Teal 600), `--positive` (Emerald 600), `--warning` (Amber 500), `--destructive` (Rose 500), `--muted` (Slate 100), `--accent` (Teal 50). All text meets WCAG 2.1 AA 4.5:1 contrast.
- UX-DR14: Implement typography system — Inter + system font stack for body, JetBrains Mono for financial figures. Type scale from Display (32px) to Caption (12px). Dollar amounts always monospace with consistent digit widths.
- UX-DR15: Implement button hierarchy — Primary (teal filled, one per context), Outline (secondary), Ghost (tertiary/navigation), Destructive (rose, confirmation dialogs only). Never two primary buttons in same visual group.
- UX-DR16: Implement feedback patterns — Success toasts (bottom-right, auto-dismiss 4s, green border), inline error alerts (rose border, below triggering element), warning badges (amber, informational), skeleton loading states (pulsing gray blocks matching card layouts).
- UX-DR17: Implement inline editing pattern for balance updates and budget targets — click value → Input field → Enter to save, Escape to cancel → Toast confirms save. No modals for edits.
- UX-DR18: Implement financial input patterns — monospace font in inputs, auto-format with commas on blur, currency symbol prefix inside input, negative values in rose color, integer cents storage with frontend display formatting.
- UX-DR19: Implement empty state patterns — first-time redirect to OnboardingWizard, post-onboarding empty cards show single-line message + action button (e.g., "No expenses yet. Import your first CC statement." + Import button).
- UX-DR20: Implement CC import completion screen — centered summary with checkmark animation, three stats (total amount, categories affected, budget remaining), "View Dashboard" primary CTA + "Import Another" secondary link.
- UX-DR21: Implement responsive layout within Tauri window — minimum 1024×680px enforced, fluid CSS Grid with `auto-fit`/`minmax()` for card grids, content max-width 1280px centered, no media queries needed.
- UX-DR22: Implement accessibility features — `prefers-reduced-motion` support for all animations, keyboard navigation for all interactive elements, ARIA labels on all custom components, semantic HTML (nav, main, section, headings), VoiceOver compatibility.
- UX-DR23: Implement page header pattern — every page has H1 title + optional subtitle, right-side page-level actions (Import button on dashboard, Add Category on budget). No breadcrumbs.
- UX-DR24: Implement sub-navigation tabs — Budget page: month tabs (← Feb | March 2026 | Apr →), Net Worth page: period tabs (6M | 1Y | ALL). Tabs filter current view without URL change.
- UX-DR25: Implement data display patterns — financial amounts always monospace with $ and 2 decimals, trend indicators (↑ emerald / ↓ rose / flat muted), dates as "March 14, 2026" (full) or "Mar 14" (short), tables with hover highlight, right-aligned numeric columns, no pagination (scroll within card).

### FR Coverage Map

- FR1: Epic 2 — Create monthly budget with category groups
- FR2: Epic 2 — Set monthly spending targets per category
- FR3: Epic 2 — Edit budget categories, groups, and targets
- FR4: Epic 2 — View budget status (spent vs. target)
- FR5: Epic 6 — Upload CC statement (screenshot/PDF)
- FR6: Epic 6 — AI extraction of transactions from CC statement
- FR7: Epic 6 — AI auto-categorization into budget categories
- FR8: Epic 6 — Flag uncertain transactions for review
- FR9: Epic 6 — Review and correct AI-categorized transactions
- FR10: Epic 6 — Real-time import progress reporting
- FR11: Epic 3 — View expenses by month grouped by category
- FR12: Epic 3 — Manually add expense entry
- FR13: Epic 3 — Edit or delete existing expense
- FR14: Epic 3 — Manual entry for AI-failed transactions
- FR15: Epic 4 — Add financial account with details
- FR16: Epic 4 — Edit or remove account
- FR17: Epic 4 — Update account balance
- FR18: Epic 4 — View all accounts and balances
- FR19: Epic 4 — Add passive asset with details
- FR20: Epic 4 — Edit or remove passive asset
- FR21: Epic 4 — Update passive asset value
- FR22: Epic 5 — Dashboard budget status across categories
- FR23: Epic 5 — Dashboard total net worth
- FR24: Epic 5 — Dashboard spending breakdown by category
- FR25: Epic 5 — Dashboard account balances
- FR26: Epic 5 — Record net worth snapshots on balance/value change
- FR27: Epic 5 — View net worth history over time
- FR28: Epic 5 — View net worth breakdown by category
- FR29: Epic 7 — Natural language questions about financial data
- FR30: Epic 7 — AI answers data queries from database
- FR31: Epic 7 — Perform actions through chat
- FR32: Epic 7 — Confirm actions before executing writes

## Epic List

### Epic 1: Project Foundation & App Shell
Set up the Tauri desktop application with React frontend, Rust backend, SQLite database, design system, and navigation shell. The user sees a working app with sidebar navigation and the core design language in place.
**FRs covered:** None (infrastructure). Covers Additional Requirements (starter template, post-scaffold setup, database migrations, error handling, IPC patterns) + UX-DR1, UX-DR13, UX-DR14, UX-DR15, UX-DR21.

### Epic 2: Budget Management
User can create a monthly budget with customizable category groups, set spending targets, edit categories and targets, and view budget status showing spent vs. target for each category.
**FRs covered:** FR1, FR2, FR3, FR4
**UX:** UX-DR4, UX-DR17, UX-DR18, UX-DR24, UX-DR23, UX-DR25

### Epic 3: Expense Tracking
User can view, add, edit, and delete expenses. Expenses link to budget categories and the budget view reflects actual spending. Manual entry provides a complete tracking workflow independent of AI.
**FRs covered:** FR11, FR12, FR13, FR14
**UX:** UX-DR16, UX-DR25

### Epic 4: Account & Asset Management
User can manage all financial accounts (bank, investment, crypto) and passive assets (real estate, vehicles, business). Add, edit, remove, and update balances/values with inline editing.
**FRs covered:** FR15, FR16, FR17, FR18, FR19, FR20, FR21
**UX:** UX-DR8, UX-DR17

### Epic 5: Dashboard & Net Worth
User sees their complete financial picture at a glance — budget status, account balances, spending breakdown, and total net worth. Net worth snapshots are recorded automatically and viewable as history with category breakdown.
**FRs covered:** FR22, FR23, FR24, FR25, FR26, FR27, FR28
**UX:** UX-DR2, UX-DR3, UX-DR9, UX-DR19, UX-DR23, UX-DR24

### Epic 6: AI-Powered CC Import
User uploads a CC statement (screenshot/PDF), AI extracts and categorizes transactions, user reviews flagged exceptions, confirms, and the budget updates. The core automation loop.
**FRs covered:** FR5, FR6, FR7, FR8, FR9, FR10
**UX:** UX-DR5, UX-DR6, UX-DR7, UX-DR20

### Epic 7: AI Chat
User can query financial data in natural language and perform write actions with confirmation. Includes dedicated chat page and floating Cmd+K bar accessible from any view.
**FRs covered:** FR29, FR30, FR31, FR32
**UX:** UX-DR10, UX-DR11

### Epic 8: Onboarding & Polish
First-time setup wizard guides users through budget creation, account setup, asset entry, and optional first import. Backup/restore, audit logging, and accessibility polish complete the app.
**FRs covered:** None directly. Covers NFR11 (audit log), NFR12 (backup/restore) + UX-DR12, UX-DR19, UX-DR22.

---

## Epic 1: Project Foundation & App Shell

Set up the Tauri desktop application with React frontend, Rust backend, SQLite database, design system, and navigation shell. The user sees a working app with sidebar navigation and the core design language in place.

### Story 1.1: Scaffold Tauri Desktop Application

As a developer,
I want a working Tauri application scaffolded with React + TypeScript + Vite,
So that I have the foundation to build all features on.

**Acceptance Criteria:**

**Given** a fresh project directory
**When** the Tauri app is initialized with `create-tauri-app` using the `react-ts` template
**Then** the app launches a native desktop window with the default React page
**And** Vite dev server runs with hot module replacement
**And** the Rust backend compiles without errors
**And** the project structure matches `src/` (React) and `src-tauri/` (Rust)

**Testing:**
- Set up Playwright with `playwright.config.ts` at the project root
- Write and run a Playwright test (`tests/app-launch.spec.ts`) that verifies the app window opens and the default React page renders content

### Story 1.2: Install Frontend Dependencies & Design System

As a developer,
I want Tailwind CSS, shadcn/ui, TanStack Router, TanStack Query, React Hook Form, and Recharts installed and configured,
So that all frontend libraries are ready for feature development.

**Acceptance Criteria:**

**Given** the scaffolded Tauri project from Story 1.1
**When** all frontend dependencies are installed and configured
**Then** Tailwind CSS processes utility classes correctly
**And** shadcn/ui components can be added via CLI (`npx shadcn@latest add button`)
**And** TanStack Router is configured with a root layout route
**And** TanStack Query provider wraps the app with a QueryClient
**And** the color system uses CSS variables matching UX-DR13 (`--background` white, `--foreground` Slate 900, `--primary` Teal 600, `--positive` Emerald 600, `--warning` Amber 500, `--destructive` Rose 500, `--muted` Slate 100, `--accent` Teal 50)
**And** typography uses Inter + system font stack for body and JetBrains Mono for monospace (UX-DR14)
**And** the app renders in the Tauri window with the configured theme

**Testing:**
- Write and run a Playwright test (`tests/design-system.spec.ts`) that verifies:
  - CSS variables are set on `:root` (e.g., `--primary` resolves to Teal 600)
  - A rendered button uses the correct teal primary color
  - Body text uses the Inter font family
  - The app renders without console errors

### Story 1.3: Set Up Rust Backend with SQLite & Error Handling

As a developer,
I want rusqlite integrated with a migration system and typed error handling,
So that the data layer is ready for feature development.

**Acceptance Criteria:**

**Given** the Tauri project with frontend configured
**When** the Rust backend is set up with rusqlite
**Then** a SQLite database is created in Tauri `appDataDir()` on first launch
**And** WAL mode is enabled on connection open
**And** a `schema_version` table tracks applied migrations
**And** version-numbered `.sql` migration files in `migrations/` are applied in order on startup
**And** an `AppError` enum exists with `Validation`, `Database`, `AiService`, `File` variants
**And** all errors serialize to structured JSON for the frontend
**And** the `tracing` crate is configured to log to a file in the app data directory
**And** an `audit_log` table is created via migration with columns: `id`, `action` (create/update/delete), `entity_type` (expense/account/asset/import), `entity_id`, `details_json` (before/after values), `created_at`
**And** audit log entries are append-only (no UPDATE or DELETE allowed on this table)

### Story 1.4: Build App Shell with Sidebar Navigation & Routing

As a user,
I want a desktop application with a dark sidebar navigation and page routing,
So that I can navigate between all sections of the app.

**Acceptance Criteria:**

**Given** the app is launched
**When** the main window renders
**Then** a dark sidebar (240px fixed) displays 7 nav items with icons and labels: Dashboard, Budget, Accounts, Assets, Net Worth, Import, AI Chat (UX-DR1)
**And** the active nav item shows teal text with a right border accent
**And** clicking a nav item routes to the corresponding page via TanStack Router
**And** each page displays a page header with H1 title (UX-DR23)
**And** the main content area is fluid with max-width 1280px, centered (UX-DR21)
**And** the minimum window size is 1024×680px enforced by Tauri config
**And** button hierarchy follows UX-DR15 (Primary teal, Outline, Ghost, Destructive rose)
**And** page content areas show placeholder content for each route

**Testing:**
- Write and run Playwright tests (`tests/navigation.spec.ts`) that verify:
  - Sidebar renders with all 7 nav items visible (Dashboard, Budget, Accounts, Assets, Net Worth, Import, AI Chat)
  - Clicking each nav item navigates to the correct page and updates the active state (teal text + right border)
  - Each page displays its H1 title in the page header
  - The main content area has max-width 1280px
  - All tests pass by executing `npx playwright test tests/navigation.spec.ts`

---

## Epic 2: Budget Management

User can create a monthly budget with customizable category groups, set spending targets, edit categories and targets, and view budget status showing spent vs. target for each category.

### Story 2.1: Create Budget with Category Groups and Targets

As a user,
I want to create a monthly budget with named category groups and individual categories with spending targets,
So that I can plan my monthly spending.

**Acceptance Criteria:**

**Given** the user navigates to the Budget page
**When** the user creates a new budget category group (e.g., "Essentials")
**Then** the group is saved to the database with a `budget_groups` table created via migration
**And** the user can add categories to the group (e.g., "Housing", "Food") with monthly targets in dollars
**And** categories are stored in a `budget_categories` table with `group_id`, `name`, and `target_cents` (integer) columns
**And** monetary inputs use the MoneyInput pattern (UX-DR18): monospace font, currency prefix, auto-format with commas on blur
**And** the form uses React Hook Form with validation (name required, target > 0)
**And** a success toast confirms each save (UX-DR16)

**Given** a budget with categories exists
**When** the user views the Budget page
**Then** categories are displayed grouped under their group headings
**And** each category shows the target amount formatted as `$X,XXX.XX` (monospace, UX-DR25)

**Testing:**
- Write and run Playwright tests (`tests/budget.spec.ts`) that verify:
  - User can create a budget group and see it appear on the page
  - User can add a category with a dollar target to a group
  - Category displays with the formatted target amount in monospace
  - Form validation prevents saving without a name or with target ≤ 0
  - Success toast appears after saving
  - All tests pass by executing `npx playwright test tests/budget.spec.ts`

### Story 2.2: Edit and Delete Budget Categories, Groups, and Targets

As a user,
I want to edit category names, targets, and group names, or delete categories and groups,
So that I can adjust my budget as needs change.

**Acceptance Criteria:**

**Given** the user views a budget category
**When** the user clicks the target amount
**Then** the value becomes an inline editable input field (UX-DR17)
**And** pressing Enter saves the updated target and shows a success toast
**And** pressing Escape cancels the edit without saving

**Given** the user wants to rename a category or group
**When** the user edits the name
**Then** the name updates in the database and the UI reflects the change immediately

**Given** the user wants to delete a category
**When** the user triggers the delete action
**Then** a destructive confirmation dialog appears (UX-DR15)
**And** confirming deletes the category from the database

**Given** the user wants to delete a group
**When** the group still contains categories
**Then** the system prevents deletion and shows an inline error: "Remove all categories first"

**Testing:**
- Write and run Playwright tests (append to `tests/budget.spec.ts`) that verify:
  - Clicking a target amount makes it editable inline
  - Pressing Enter saves the new value and shows a success toast
  - Pressing Escape reverts the value without saving
  - Deleting a category shows a confirmation dialog; confirming removes it from the page
  - Deleting a group with categories shows the "Remove all categories first" error
  - All tests pass by executing `npx playwright test tests/budget.spec.ts`

### Story 2.3: View Budget Status with Progress Bars

As a user,
I want to see how much I've spent vs. my target for each budget category in the current month,
So that I can track my spending against my plan.

**Acceptance Criteria:**

**Given** the user has a budget with categories and targets
**When** the user views the Budget page for the current month
**Then** each category displays using the BudgetCategoryRow component (UX-DR4)
**And** a progress bar (8-10px height) shows spent vs. target, colored by status: teal (<75%), amber (75-100%), rose (>100%)
**And** "spent / target" amounts are displayed in monospace (e.g., "$523.45 / $700.00")
**And** a status badge shows the category state (on track, warning, over budget)
**And** the page header shows "Budget" with the current month (UX-DR23)

**Given** no expenses exist yet for the current month
**When** the user views the Budget page
**Then** all progress bars show 0% with teal color
**And** spent amounts show "$0.00"

**Testing:**
- Write and run Playwright tests (append to `tests/budget.spec.ts`) that verify:
  - Budget categories display with a progress bar element
  - Progress bar color is teal when spent < 75% of target
  - "spent / target" text is visible in monospace format
  - Status badge text reflects the correct state (on track, warning, over)
  - With no expenses, all progress bars show 0% and spent shows "$0.00"
  - All tests pass by executing `npx playwright test tests/budget.spec.ts`

### Story 2.4: Navigate Budget by Month

As a user,
I want to navigate between months on the Budget page,
So that I can review budget status for any month.

**Acceptance Criteria:**

**Given** the user is on the Budget page
**When** the user uses the month navigation tabs (UX-DR24)
**Then** left/right arrows (← Feb | **March 2026** | Apr →) allow moving between months
**And** the current month is highlighted and displayed as the active tab
**And** budget categories and their spent amounts update to reflect the selected month
**And** tabs filter the view without changing the URL
**And** the budget structure (groups, categories, targets) carries forward to all months

**Testing:**
- Write and run Playwright tests (append to `tests/budget.spec.ts`) that verify:
  - Month navigation arrows (← / →) are visible and clickable
  - Clicking the right arrow advances to the next month and updates the displayed month label
  - Clicking the left arrow goes back to the previous month
  - Budget categories remain visible after navigating months
  - All tests pass by executing `npx playwright test tests/budget.spec.ts`

---

## Epic 3: Expense Tracking

User can view, add, edit, and delete expenses. Expenses link to budget categories and the budget view reflects actual spending. Manual entry provides a complete tracking workflow independent of AI.

### Story 3.1: Manually Add an Expense

As a user,
I want to manually add an expense entry with merchant, amount, category, and date,
So that I can track spending that isn't imported from CC statements.

**Acceptance Criteria:**

**Given** the user is on the Budget page or a category detail view
**When** the user clicks an "Add Expense" action
**Then** a form appears with fields for merchant name, amount (MoneyInput, UX-DR18), category (Select dropdown, pre-selected if adding from a category), and date (defaults to today)
**And** the `expenses` table is created via migration with columns: `id`, `merchant`, `amount_cents` (integer), `budget_category_id`, `date`, `source` (manual/import), `created_at`
**And** submitting the form saves the expense and shows a success toast (UX-DR16)
**And** the budget category's spent amount updates immediately via TanStack Query invalidation
**And** validation requires merchant name, amount > 0, and a selected category

**Testing:**
- Write and run Playwright tests (`tests/expenses.spec.ts`) that verify:
  - Clicking "Add Expense" opens a form with merchant, amount, category, and date fields
  - Submitting a valid expense shows a success toast and the expense appears in the category
  - The budget category's spent amount updates after adding the expense
  - Form validation prevents submission with empty merchant or zero amount
  - All tests pass by executing `npx playwright test tests/expenses.spec.ts`

### Story 3.2: View Expenses by Month Grouped by Category

As a user,
I want to view all expenses for a given month grouped by budget category,
So that I can see where my money went.

**Acceptance Criteria:**

**Given** expenses exist for the selected month
**When** the user expands a budget category row (hover to expand, UX-DR4)
**Then** recent transactions for that category are displayed below the category row
**And** each expense shows merchant name, amount (monospace, right-aligned), and date (short format "Mar 14", UX-DR25)
**And** the table has hover highlight on rows (accent background)
**And** numerical columns are right-aligned

**Given** no expenses exist for a category in the selected month
**When** the user expands that category
**Then** a message displays "No expenses this month"

**Testing:**
- Write and run Playwright tests (append to `tests/expenses.spec.ts`) that verify:
  - Expanding a budget category row reveals the transaction list below it
  - Each expense row shows merchant name, amount (right-aligned), and date
  - Expanding a category with no expenses shows "No expenses this month"
  - All tests pass by executing `npx playwright test tests/expenses.spec.ts`

### Story 3.3: Edit and Delete Expenses

As a user,
I want to edit or delete existing expenses,
So that I can correct mistakes or remove duplicates.

**Acceptance Criteria:**

**Given** the user views an expense in the transaction list
**When** the user hovers over the expense row
**Then** edit and delete action icons appear (contextual actions on hover, UX pattern)

**Given** the user clicks edit on an expense
**When** the edit form appears
**Then** fields are pre-populated with the expense's current values
**And** the user can modify merchant, amount, category, or date
**And** saving updates the expense and shows a success toast
**And** the budget category's spent amount recalculates via TanStack Query invalidation

**Given** the user clicks delete on an expense
**When** the confirmation dialog appears
**Then** confirming deletes the expense from the database
**And** the budget category's spent amount recalculates
**And** a success toast confirms "Expense deleted"

**Testing:**
- Write and run Playwright tests (append to `tests/expenses.spec.ts`) that verify:
  - Hovering over an expense row reveals edit and delete action icons
  - Clicking edit opens the form pre-populated with the expense's values
  - Saving an edited expense updates the displayed values and shows a success toast
  - Clicking delete shows a confirmation dialog; confirming removes the expense from the list
  - After deleting an expense, the budget category's spent amount decreases
  - All tests pass by executing `npx playwright test tests/expenses.spec.ts`

---

## Epic 4: Account & Asset Management

User can manage all financial accounts (bank, investment, crypto) and passive assets (real estate, vehicles, business). Add, edit, remove, and update balances/values with inline editing.

### Story 4.1: Add and View Financial Accounts

As a user,
I want to add financial accounts with name, institution, type, and currency, and view them in a list,
So that I can track all my bank, investment, and crypto accounts in one place.

**Acceptance Criteria:**

**Given** the user navigates to the Accounts page
**When** the user clicks "Add Account"
**Then** a form appears with fields: account name, institution, type (chequing, savings, TFSA, RRSP, non-registered, crypto, credit card), and currency (CAD/USD)
**And** the `accounts` table is created via migration with columns: `id`, `name`, `institution`, `account_type`, `currency`, `balance_cents` (integer, default 0), `created_at`, `updated_at`
**And** submitting saves the account with initial balance of $0.00
**And** a success toast confirms the account was added

**Given** accounts exist
**When** the user views the Accounts page
**Then** all accounts are displayed using the AccountRow component (UX-DR8)
**And** each row shows account name, type + currency (muted), and balance (monospace)
**And** the page header shows "Accounts" with an "Add Account" action button (UX-DR23)

**Testing:**
- Write and run Playwright tests (`tests/accounts.spec.ts`) that verify:
  - Accounts page displays with "Add Account" button in the page header
  - Clicking "Add Account" opens a form with name, institution, type, and currency fields
  - Submitting creates the account and it appears in the list with $0.00 balance
  - Account row shows name, type + currency (muted text), and balance in monospace
  - Success toast appears after adding
  - All tests pass by executing `npx playwright test tests/accounts.spec.ts`

### Story 4.2: Edit, Remove, and Update Account Balances

As a user,
I want to edit account details, update balances inline, and remove accounts,
So that I can keep my account information current.

**Acceptance Criteria:**

**Given** the user views an account in the list
**When** the user clicks the balance amount
**Then** the balance becomes an inline editable MoneyInput field (UX-DR17)
**And** pressing Enter saves the new balance (integer cents in database) and shows a toast: "Balance updated to $X,XXX.XX"
**And** pressing Escape cancels without saving
**And** negative balances are allowed (credit card debt) and displayed in rose color (UX-DR18)

**Given** the user wants to edit account details (name, institution, type)
**When** the user triggers the edit action (hover to reveal, UX pattern)
**Then** the account details are editable and saved on confirmation

**Given** the user wants to remove an account
**When** the user triggers delete
**Then** a destructive confirmation dialog appears
**And** confirming removes the account from the database

**Testing:**
- Write and run Playwright tests (append to `tests/accounts.spec.ts`) that verify:
  - Clicking an account's balance makes it an editable input field
  - Typing a new value and pressing Enter updates the displayed balance and shows a toast
  - Pressing Escape reverts the balance without saving
  - Negative balances display in rose color
  - Hovering reveals edit/delete actions; deleting shows confirmation dialog and removes the account
  - All tests pass by executing `npx playwright test tests/accounts.spec.ts`

### Story 4.3: Add, Edit, and View Passive Assets

As a user,
I want to add passive assets (real estate, vehicles, business) with name, type, and estimated value,
So that I can include non-liquid assets in my financial picture.

**Acceptance Criteria:**

**Given** the user navigates to the Assets page
**When** the user clicks "Add Asset"
**Then** a form appears with fields: asset name, type (real estate, vehicle, business, other), and estimated value (MoneyInput)
**And** the `passive_assets` table is created via migration with columns: `id`, `name`, `asset_type`, `value_cents` (integer), `created_at`, `updated_at`
**And** submitting saves the asset and shows a success toast

**Given** assets exist
**When** the user views the Assets page
**Then** all assets are displayed using the AccountRow component variant (same component, different type labels, UX-DR8)
**And** each row shows asset name, type (muted), and estimated value (monospace)

**Given** the user clicks an asset's value
**When** the value becomes an inline editable field (UX-DR17)
**Then** Enter saves the updated value and shows a toast
**And** the user can also edit asset details or remove the asset via hover actions

**Testing:**
- Write and run Playwright tests (`tests/assets.spec.ts`) that verify:
  - Assets page displays with "Add Asset" button
  - Adding an asset with name, type, and value shows it in the list with formatted value
  - Clicking an asset's value makes it inline-editable; Enter saves, Escape cancels
  - Hover reveals edit/delete actions; delete shows confirmation and removes the asset
  - Success toasts appear for add and edit operations
  - All tests pass by executing `npx playwright test tests/assets.spec.ts`

---

## Epic 5: Dashboard & Net Worth

User sees their complete financial picture at a glance — budget status, account balances, spending breakdown, and total net worth. Net worth snapshots are recorded automatically and viewable as history with category breakdown.

### Story 5.1: Build Dashboard with Budget Status and Account Balances

As a user,
I want to see my budget status and account balances on the dashboard when I open the app,
So that I get a complete financial snapshot at a glance.

**Acceptance Criteria:**

**Given** the user opens the app or navigates to Dashboard
**When** the dashboard loads
**Then** the dashboard is the landing page (default route)
**And** a hero card shows "Budget Remaining" with the total remaining budget for the current month (DashboardMetricCard hero variant, UX-DR3)
**And** budget categories are displayed below with progress bars (BudgetCategoryRow, UX-DR4) showing top categories by spending
**And** the page header shows "Dashboard" with an "Import Statement" action button (UX-DR23)
**And** all data loads via parallel TanStack Query calls within 1 second (NFR1)
**And** cards show skeleton loading states while data fetches (UX-DR16)

**Given** no budget or expenses exist
**When** the dashboard loads
**Then** empty state cards display with action prompts (UX-DR19): "No budget yet. Create your first budget." with a link to Budget page

**Testing:**
- Write and run Playwright tests (`tests/dashboard.spec.ts`) that verify:
  - Dashboard is the landing page when the app opens (with data seeded)
  - "Budget Remaining" hero card is visible with a formatted dollar amount
  - Budget category rows with progress bars are displayed
  - "Import Statement" button is visible in the page header
  - Skeleton loading states appear briefly before data renders
  - With empty database, empty state message and action link are visible
  - All tests pass by executing `npx playwright test tests/dashboard.spec.ts`

### Story 5.2: Dashboard Net Worth and Spending Breakdown

As a user,
I want to see my total net worth and spending breakdown by category on the dashboard,
So that I understand my complete financial position and where money is going.

**Acceptance Criteria:**

**Given** the user has accounts, assets, and expenses
**When** the dashboard loads
**Then** a hero card shows "Net Worth" as the sum of all account balances + all passive asset values (DashboardMetricCard hero variant, UX-DR3, FR23)
**And** the net worth card includes a sparkline trend showing recent history (Recharts)
**And** 3 secondary cards show Cash (sum of chequing/savings), Investments (TFSA/RRSP/non-registered/crypto), and Assets (passive assets) totals (DashboardMetricCard secondary variant, UX-DR2)
**And** a spending breakdown section shows expenses by category for the current month (FR24)
**And** all account balances are visible on the dashboard (FR25)
**And** the dashboard grid uses 2-column hero + 3-column secondary layout (UX-DR2)
**And** clicking hero cards navigates to their detail pages (Net Worth, Budget)

**Testing:**
- Write and run Playwright tests (append to `tests/dashboard.spec.ts`) that verify:
  - "Net Worth" hero card displays with a formatted dollar amount
  - 3 secondary cards (Cash, Investments, Assets) are visible with values
  - Spending breakdown section shows expense categories
  - Dashboard uses 2-column hero + 3-column secondary grid layout
  - Clicking the Net Worth hero card navigates to the Net Worth page
  - Clicking the Budget hero card navigates to the Budget page
  - All tests pass by executing `npx playwright test tests/dashboard.spec.ts`

### Story 5.3: Net Worth Snapshot Recording

As a user,
I want the system to automatically record my net worth whenever account balances or asset values change,
So that I have a historical record of my financial progress.

**Acceptance Criteria:**

**Given** the user updates an account balance or asset value
**When** the balance/value is saved
**Then** the system records a net worth snapshot in the `net_worth_snapshots` table (created via migration) with columns: `id`, `total_cents`, `snapshot_date`, `breakdown_json` (JSON string with per-category totals), `created_at`
**And** the snapshot includes a breakdown by category: cash, crypto, housing, TFSA, RRSP, non-registered, business, vehicles, other
**And** each account's contribution is mapped to a category based on its `account_type`
**And** calculations are accurate to the cent using integer arithmetic (NFR13)
**And** the snapshot is also recorded after CC import confirmation (expenses affect budget but not net worth directly — net worth updates when balances change)

### Story 5.4: Net Worth History Page with Trend Chart

As a user,
I want to view my net worth history over time as a trend chart with category breakdown,
So that I can see how my financial position has changed.

**Acceptance Criteria:**

**Given** the user navigates to the Net Worth page
**When** net worth snapshots exist
**Then** a large trend line chart (Recharts) shows net worth over time (FR27)
**And** the page header shows "Net Worth" with the current total (UX-DR23)
**And** period tabs allow filtering: 6M, 1Y, ALL (UX-DR24)
**And** a NetWorthBreakdownBar (UX-DR9) shows the current composition as a stacked horizontal bar with proportional colored segments per category
**And** a legend grid below shows each category: name, color dot, dollar amount, percentage
**And** hovering a segment shows a tooltip with category name, amount, and percentage
**And** trend indicators show direction (↑ emerald / ↓ rose) with absolute and percentage change (UX-DR25)

**Given** no snapshots exist
**When** the user views the Net Worth page
**Then** an empty state shows "No net worth history yet. Add accounts and assets to start tracking." (UX-DR19)

**Testing:**
- Write and run Playwright tests (`tests/net-worth.spec.ts`) that verify:
  - Net Worth page displays with H1 title and current total
  - Trend chart element is rendered (Recharts canvas/SVG present)
  - Period tabs (6M, 1Y, ALL) are visible and clickable
  - NetWorthBreakdownBar renders with colored segments and a legend grid below
  - Hovering a segment shows a tooltip with category details
  - With no snapshots, empty state message is visible
  - All tests pass by executing `npx playwright test tests/net-worth.spec.ts`

---

## Epic 6: AI-Powered CC Import

User uploads a CC statement (screenshot/PDF), AI extracts and categorizes transactions, user reviews flagged exceptions, confirms, and the budget updates. The core automation loop.

### Story 6.1: File Upload and Validation

As a user,
I want to upload a credit card statement as a screenshot or PDF,
So that I can begin the automated import process.

**Acceptance Criteria:**

**Given** the user navigates to the Import page or clicks "Import Statement" on the dashboard
**When** the Import page loads
**Then** a large drag-and-drop upload zone is displayed, centered in content
**And** clicking the zone opens the native Tauri file dialog (`dialog.open()`) filtered to images (PNG, JPG) and PDFs
**And** the user can also drag and drop a file onto the zone

**Given** the user selects a file
**When** the file is submitted
**Then** the Rust backend validates file type (image/PDF only) and size (NFR8)
**And** invalid files show an inline error below the upload zone: "Only images and PDFs supported" (UX-DR16)
**And** valid files proceed to the AI processing pipeline

**Testing:**
- Write and run Playwright tests (`tests/import.spec.ts`) that verify:
  - Import page displays a drag-and-drop upload zone centered in content
  - Clicking the upload zone triggers a file selection interaction
  - Uploading an invalid file type shows inline error "Only images and PDFs supported"
  - All tests pass by executing `npx playwright test tests/import.spec.ts`

### Story 6.2: AI Extraction and Categorization Pipeline

As a user,
I want the system to extract transactions from my CC statement and auto-categorize them,
So that I don't have to manually enter each transaction.

**Acceptance Criteria:**

**Given** a valid file has been uploaded
**When** the AI processing begins
**Then** the ImportProgressStepper component (UX-DR5) shows 4 stages: Uploading → Extracting → Categorizing → Done
**And** progress updates stream via Tauri events (`import:progress`) in real-time (NFR3)
**And** the Rust backend sends the file to AWS Bedrock via `aws-sdk-bedrockruntime` with the user's budget categories as context
**And** Bedrock returns parsed transactions with merchant, amount, date, and suggested category
**And** the system flags transactions where AI confidence is low for user review (FR8)
**And** processing completes within 30 seconds for a typical 15-25 transaction statement (NFR4)
**And** all communication with Bedrock uses HTTPS (NFR7)

**Given** the AI service is unavailable
**When** the import fails
**Then** an inline alert shows "Import is temporarily unavailable. You can add transactions manually." with a link to manual expense entry (NFR9, NFR10)
**And** the workflow is not blocked — the user can still use the app

**Given** the AI can only partially extract transactions (blurry image)
**When** some transactions cannot be read
**Then** successfully extracted transactions proceed normally
**And** unreadable transactions are listed as "couldn't be read" with inline manual entry fields (FR14)

**Testing:**
- ⚠️ **AI integration tests deferred** — requires AWS credentials to be configured before running
- Write Playwright tests (append to `tests/import.spec.ts`) that verify UI components with mocked backend responses:
  - ImportProgressStepper renders 4 stages with correct labels
  - Progress transitions between stages (Uploading → Extracting → Categorizing → Done)
  - When AI service is unavailable, inline alert shows "Import is temporarily unavailable" with manual entry link
- Run full E2E import tests after AWS credentials are configured

### Story 6.3: Transaction Review and Confirmation

As a user,
I want to review AI-categorized transactions and correct any mistakes before importing,
So that my budget data is accurate.

**Acceptance Criteria:**

**Given** AI processing is complete
**When** the review screen appears
**Then** a summary header shows "X transactions extracted — Y auto-categorized, Z need review"
**And** auto-categorized transactions are displayed in a collapsed AutoCategorizedSummary (UX-DR7) with checkmark + count, expandable to show all with editable categories
**And** flagged transactions are displayed as TransactionReviewCards (UX-DR6) with merchant name, amount (monospace right-aligned), and a category Select dropdown pre-selected with the AI's best guess
**And** resolving a flagged transaction changes its card border from warning to positive styling

**Given** all flagged transactions have been resolved
**When** the user clicks the "Import X transactions" confirm button
**Then** the button is enabled only when all flagged items have a category selected
**And** all transactions are saved to the `expenses` table with `source: 'import'`
**And** an audit log entry records the import
**And** TanStack Query invalidates `["expenses"]`, `["dashboard"]`, and `["budgets"]` query keys

**Given** the import is confirmed
**When** the completion screen appears (UX-DR20)
**Then** a centered summary shows a checkmark animation, total amount imported, categories affected, and budget remaining
**And** "View Dashboard" primary CTA navigates to the dashboard
**And** "Import Another" secondary link returns to the upload zone

**Testing:**
- ⚠️ **Full E2E import flow tests deferred** — requires AWS credentials to be configured
- Write Playwright tests (append to `tests/import.spec.ts`) that verify review UI with mocked import data:
  - Summary header shows transaction counts ("X auto-categorized, Y need review")
  - AutoCategorizedSummary renders collapsed with count; clicking expand shows the transaction list
  - TransactionReviewCards display with merchant name, amount, and category dropdown
  - Selecting a category on a flagged card changes its border from warning to positive
  - Confirm button is disabled until all flagged items are resolved; enabled after
  - Completion screen shows checkmark, stats, "View Dashboard" CTA, and "Import Another" link
  - Clicking "View Dashboard" navigates to the dashboard
- Run full E2E import-to-dashboard tests after AWS credentials are configured

---

## Epic 7: AI Chat

User can query financial data in natural language and perform write actions with confirmation. Includes dedicated chat page and floating Cmd+K bar accessible from any view.

### Story 7.1: AI Chat Page with Data Queries

As a user,
I want to ask natural language questions about my financial data and receive accurate answers,
So that I can quickly get insights without navigating through multiple views.

**Acceptance Criteria:**

**Given** the user navigates to the AI Chat page
**When** the chat interface loads
**Then** a ChatGPT-style interface displays with a message input area at the bottom
**And** the `chat_conversations` and `chat_messages` tables are created via migration for conversation persistence
**And** conversation history is displayed with ChatMessageBubble components (UX-DR10): user messages (teal bg, white text, right-aligned), AI messages (muted bg, left-aligned)
**And** the message container has `role="log"` with `aria-live="polite"`

**Given** the user types a data query (e.g., "How much did I spend on dining out this month?")
**When** the message is sent
**Then** the Rust backend receives the message via Tauri command, fetches relevant data from the database, and sends it with the query to AWS Bedrock
**And** the AI response streams via Tauri events (`chat:response-chunk`) and renders progressively
**And** responses include formatted data (monospace for financial figures, tables for comparisons)
**And** responses return within 5 seconds for data queries (NFR5)

**Testing:**
- ⚠️ **AI integration tests deferred** — requires AWS credentials to be configured
- Write Playwright tests (`tests/chat.spec.ts`) that verify UI structure with mocked responses:
  - Chat page renders with a message input area at the bottom
  - User messages appear right-aligned with teal background
  - AI messages appear left-aligned with muted background
  - Message container has correct ARIA attributes (`role="log"`, `aria-live="polite"`)
  - Typing a message and pressing Enter sends it (message appears in chat)
- Run full E2E chat query tests after AWS credentials are configured

### Story 7.2: AI Chat Write Actions with Confirmation

As a user,
I want to perform actions through chat (add expenses, update balances) with confirmation before execution,
So that I can manage my finances conversationally.

**Acceptance Criteria:**

**Given** the user types an action request (e.g., "Add a $45 expense at Costco under Groceries for today")
**When** the AI parses the intent as a write action
**Then** the AI responds with a confirmation card embedded in the chat message showing exactly what will happen: action type, merchant, amount, category, date
**And** the confirmation card has "Confirm" and "Cancel" buttons

**Given** the user clicks "Confirm" on an action card
**When** the action is executed
**Then** the Rust backend performs the write operation (e.g., creates the expense)
**And** an audit log entry records the action
**And** a success message appears in the chat: "Done. $45.00 expense added to Groceries."
**And** relevant TanStack Query keys are invalidated

**Given** the user clicks "Cancel"
**When** the action is cancelled
**Then** a message confirms "Action cancelled" and the chat continues normally

**Testing:**
- ⚠️ **AI integration tests deferred** — requires AWS credentials to be configured
- Write Playwright tests (append to `tests/chat.spec.ts`) that verify confirmation UI with mocked action responses:
  - An action confirmation card renders within a chat message with action details
  - Confirmation card has "Confirm" and "Cancel" buttons
  - Clicking "Cancel" shows "Action cancelled" message in chat
- Run full E2E write action tests (confirm → verify data change) after AWS credentials are configured

### Story 7.3: Floating Chat Bar (Cmd+K)

As a user,
I want a quick-access floating chat bar triggered by Cmd+K from any page,
So that I can ask questions or perform actions without leaving my current view.

**Acceptance Criteria:**

**Given** the user is on any page in the app
**When** the user presses Cmd+K
**Then** the FloatingChatBar component (UX-DR11) appears as a centered overlay with backdrop blur
**And** the input field is auto-focused
**And** an ESC keyboard shortcut badge is shown to close
**And** focus is trapped within the overlay (`role="dialog"`)

**Given** the user types a query in the floating bar
**When** the AI responds
**Then** the response appears inline below the input within the overlay
**And** for complex multi-turn queries, an "Open in full chat" link transitions to the dedicated Chat page with conversation context preserved

**Given** the user presses Escape or clicks outside the overlay
**When** the bar closes
**Then** focus returns to the previously focused element on the page

**Testing:**
- Write and run Playwright tests (append to `tests/chat.spec.ts`) that verify:
  - Pressing Cmd+K opens the floating chat bar overlay
  - Overlay appears centered with backdrop blur and auto-focused input
  - ESC keyboard shortcut badge is visible
  - Pressing Escape closes the overlay
  - "Open in full chat" link is visible and navigates to the Chat page
  - Focus returns to the previously focused element after closing
  - All tests pass by executing `npx playwright test tests/chat.spec.ts`

---

## Epic 8: Onboarding & Polish

First-time setup wizard guides users through budget creation, account setup, asset entry, and optional first import. Backup/restore, audit logging, and accessibility polish complete the app.

### Story 8.1: First-Time Onboarding Wizard

As a first-time user,
I want a guided setup wizard to create my budget, add accounts, and add assets,
So that I can get started with the app quickly.

**Acceptance Criteria:**

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

**Testing:**
- Write and run Playwright tests (`tests/onboarding.spec.ts`) that verify:
  - With an empty database, the app redirects to the onboarding wizard (not the dashboard)
  - 4-step horizontal indicator shows Budget → Accounts → Assets → Import
  - Step 1 (Budget) allows creating a group and category; clicking "Next" advances to Step 2
  - Steps 2-4 show a "Skip" button that advances to the next step
  - "Back" button returns to the previous step
  - After completing onboarding, user lands on the Dashboard
  - On next app launch (with data), the dashboard loads directly (no onboarding redirect)
  - All tests pass by executing `npx playwright test tests/onboarding.spec.ts`

### Story 8.2: Database Backup and Restore

As a user,
I want to backup and restore my financial database,
So that I never lose my financial data.

**Acceptance Criteria:**

**Given** the user triggers a backup action (from app settings or menu)
**When** the backup is initiated
**Then** a Tauri command copies the SQLite database file to a user-chosen location via the native save dialog
**And** a success toast confirms "Backup saved to [path]"

**Given** the user triggers a restore action
**When** the user selects a backup file via native file dialog
**Then** the current database is replaced with the backup file
**And** the app reloads with the restored data
**And** a success toast confirms "Database restored"

**Given** an invalid or corrupted file is selected for restore
**When** the restore is attempted
**Then** an inline error shows "Invalid backup file" and the current database is not modified

### Story 8.3: Audit Logging for Financial Data Changes

As a developer,
I want all financial data change operations to write to the audit_log table,
So that financial records are traceable.

> Note: The `audit_log` table migration is created in Story 1.3 (database foundation).

**Acceptance Criteria:**

**Given** any financial data is created, updated, or deleted (expenses, account balances, asset values, imports)
**When** the write operation completes
**Then** an entry is written to the `audit_log` table with the appropriate `action`, `entity_type`, `entity_id`, and `details_json` (before/after values)
**And** audit log entries are never deleted or modified (append-only)
**And** the audit log is included in database backups (NFR11)

### Story 8.4: Accessibility Polish

As a user,
I want the app to be accessible via keyboard and screen reader,
So that I can use it comfortably with assistive technologies.

**Acceptance Criteria:**

**Given** the app is running
**When** the user navigates with keyboard only
**Then** all interactive elements are reachable via Tab in a logical order (left-to-right, top-to-bottom)
**And** Enter/Space activates buttons and links
**And** Escape closes all overlays (floating chat, dialogs)
**And** focus rings are visible on all interactive elements (UX-DR22)

**Given** the app has animations (import completion checkmark, budget bar transitions)
**When** the user has `prefers-reduced-motion` enabled in OS settings
**Then** all animations are disabled — elements appear in final state without transitions (UX-DR22)

**Given** the app is used with VoiceOver on macOS
**When** screen reader reads the interface
**Then** all custom components have descriptive `aria-label` attributes
**And** semantic HTML is used throughout (nav, main, section, headings)
**And** financial amounts include currency in screen reader text ("487,230 dollars")
**And** the chat message container announces new messages via `aria-live="polite"`
**And** the import progress stepper announces stage changes

**Testing:**
- Write and run Playwright tests (`tests/accessibility.spec.ts`) that verify:
  - All interactive elements are reachable via Tab key in a logical sequence
  - Pressing Escape closes the floating chat bar overlay
  - Focus rings are visible on focused interactive elements (check computed outline style)
  - Semantic HTML is used: `nav` element for sidebar, `main` for content area, `h1` for page titles
  - All custom components have `aria-label` attributes (spot-check DashboardMetricCard, AccountRow, BudgetCategoryRow)
  - Chat message container has `role="log"` and `aria-live="polite"`
  - All tests pass by executing `npx playwright test tests/accessibility.spec.ts`
