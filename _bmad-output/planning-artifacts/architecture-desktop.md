---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-03-14'
inputDocuments:
  - product-brief-nkbaz-finance-2026-03-14.md
  - prd.md
  - prd-validation-report.md
  - ux-design-specification.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'dev'
date: '2026-03-14'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

**Module addenda:**
- [Car Maintenance (FR49–FR61)](architecture-car-maintenance.md) — vehicle maintenance schedules, alerts, service logging
- [Financial Decision Intelligence (FR83–FR89)](architecture-financial-decision-intelligence.md) — emergency fund health, savings capacity, guardrailed waterfall guidance
- [Credential Management](architecture-credentials.md) — AI provider credential storage and provider abstraction
- [Release Signing](architecture-release-signing.md) — Windows SignPath OSS signing, Tauri updater minisign, macOS deferral

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

32 FRs across 8 feature groups. The majority (FR1-4, FR11-21) are standard CRUD operations — budget categories, expenses, accounts, and assets. Architectural complexity concentrates in two areas:

- **AI-Powered Import (FR5-10):** Async pipeline — file upload → AI extraction → auto-categorization → exception flagging → user review → confirmation. Requires streaming progress updates from Rust backend to React frontend via Tauri IPC events.
- **AI Chat (FR29-32):** Conversational interface with both read (data queries) and write (actions with confirmation) capabilities. Requires the AI to have structured access to the full data model and a confirmation flow for mutations.

Dashboard (FR22-25) and Net Worth History (FR26-28) are read-heavy views that aggregate data from budgets, expenses, accounts, and assets — making the data model's referential integrity critical.

**Non-Functional Requirements:**

13 NFRs driving architectural decisions:

| NFR | Architectural Impact |
|-----|---------------------|
| NFR1: Dashboard < 1s load | SQLite queries must be efficient; consider pre-computed dashboard aggregates |
| NFR4: AI parsing < 30s | Async job pattern with progress streaming; timeout handling |
| NFR5: Chat responses < 5s | AI service latency management; streaming responses |
| NFR6: Encrypted at rest | Database encryption strategy (SQLCipher or equivalent) |
| NFR7: HTTPS for AI services | TLS configuration in Rust HTTP client |
| NFR8: File upload validation | Type + size validation before AI submission |
| NFR9: Graceful AI degradation | Fallback paths when Strand SDK / Bedrock unavailable |
| NFR10: AI failure non-blocking | Manual entry always available; partial extraction handled |
| NFR11: No silent data loss | Transaction safety, write-ahead logging, backup strategy |
| NFR12: Backup/restore | Database export/import capability |
| NFR13: Cent-accurate calculations | Integer storage for monetary values (cents), not floating point |

**Scale & Complexity:**

- Primary domain: Desktop application (Tauri — React frontend, Rust backend)
- Complexity level: Medium
- Estimated architectural components: ~8 (data layer, IPC layer, AI integration layer, file handling, state management, routing, UI component system, encryption)

### Technical Constraints & Dependencies

- **Tauri framework** — dictates the React + Rust split and IPC communication model
- **Strand SDK + AWS Bedrock** — external AI dependency for CC parsing and chat; requires AWS credentials and network access
- **SQLite** — local database, single-writer model, file-based storage
- **shadcn/ui + Tailwind** — frontend component and styling framework (from UX spec)
- **macOS primary, Windows compatible** — macOS is the primary development and testing target; Windows is architecturally supported (all stack choices are cross-platform) but not actively tested until Phase 2
- **Single-user, no auth** — no authentication layer for MVP; user isolation deferred to Phase 2
- **No server infrastructure** — all processing local except AI API calls

### Cross-Cutting Concerns Identified

1. **IPC Boundary Design** — Every feature involves Rust ↔ React communication. Needs a consistent command/event pattern: commands for request/response (CRUD operations), events for streaming (import progress, dashboard refresh).
2. **Financial Precision** — Monetary values stored as integers (cents) in SQLite, formatted for display in the frontend. This affects every component that reads or writes dollar amounts.
3. **AI Service Resilience** — Both import and chat depend on external AI services. Architecture must ensure the app remains fully functional (manual entry, all CRUD, dashboard) when AI is unavailable.
4. **Data Model Referential Integrity** — Budget categories are referenced by expenses (including AI-imported ones) and queried by AI chat. Accounts and assets feed net worth calculations. Cascading updates and deletion rules must be explicit.
5. **Encryption at Rest** — Affects the entire data layer. Must be transparent to application code above the database connection level.
6. **Error Handling Strategy** — Consistent error propagation from Rust backend through IPC to React UI. AI errors, database errors, and validation errors all need distinct handling paths that converge on the UX spec's inline, non-modal error patterns.

## Starter Template Evaluation

### Primary Technology Domain

Desktop Application (Tauri 2.x — React frontend, Rust backend) based on project requirements analysis.

### Starter Options Considered

**Option 1: Official `create-tauri-app` (Selected)**
The official Tauri scaffolding tool (v3). Creates a minimal Tauri 2 project with React + TypeScript + Vite. Clean foundation with no opinionated baggage — we make our own architectural decisions.

**Option 2: `MrLightful/create-tauri-react` (Rejected)**
Community template with Tauri + React + Vite + Tailwind + shadcn/ui pre-configured. Saves minor setup time but introduces maintenance risk and someone else's opinions.

**Option 3: `dannysmith/tauri-template` (Rejected)**
"Production-ready" community template with comprehensive tooling. Heavier starting point with patterns we may not need and maintenance risk.

### Selected Starter: Official `create-tauri-app`

**Rationale for Selection:**
- Official tool maintained by the Tauri team — guaranteed compatibility with latest Tauri 2.x
- Minimal, clean starting point — no inherited opinions or unused patterns
- Adding Tailwind + shadcn/ui is trivial (CLI commands)
- Full control over database layer, state management, and project structure
- For a solo developer with clear requirements, a clean slate is faster than stripping out unwanted decisions

**Initialization Command:**

```bash
npm create tauri-app@latest nkbaz-finance -- --template react-ts
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
- TypeScript (strict mode) for React frontend
- Rust for Tauri backend (`src-tauri/`)
- Vite as the frontend build tool and dev server

**Styling Solution:**
- None included — we add Tailwind CSS + shadcn/ui post-scaffold (per UX spec)

**Build Tooling:**
- Vite for frontend bundling and HMR
- Cargo for Rust compilation
- Tauri CLI for desktop app packaging

**Testing Framework:**
- None included — we add Playwright for E2E testing post-scaffold

**Code Organization:**
- `src/` — React frontend source
- `src-tauri/` — Rust backend source
- Standard Vite project structure with Tauri overlay

**Development Experience:**
- Vite dev server with hot module replacement
- Tauri dev mode with live reload
- TypeScript type checking

**Additional Setup Required Post-Scaffold:**
1. Tailwind CSS + shadcn/ui installation and configuration
2. Playwright testing setup
3. rusqlite integration in Rust backend
4. State management library (TBD in architecture decisions)
5. Client-side routing (TBD in architecture decisions)
6. Project structure refinement beyond scaffold defaults
7. ESLint + Prettier configuration

**Note:** Project initialization using this command should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data storage: SQLite via rusqlite with embedded SQL migrations
- AI integration: AWS Bedrock via `aws-sdk-bedrockruntime` Rust SDK (no Strand SDK)
- IPC patterns: Tauri commands (CRUD) + events (streaming)
- Frontend state: TanStack Query (data) + lightweight UI state
- Routing: TanStack Router

**Important Decisions (Shape Architecture):**
- Financial precision: Integer cents storage
- Error handling: Typed Rust error enums → structured frontend errors
- Form handling: React Hook Form
- Logging: `tracing` crate + audit log table
- Backup: SQLite file copy via native dialog

**Deferred Decisions (Post-MVP):**
- Authentication (Phase 2 multi-user)
- CI/CD pipeline (manual builds for now)
- Cross-platform builds (Windows/Linux)
- External monitoring/error tracking

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | SQLite via rusqlite | Local-first desktop app; single file, bundled in binary, no system dependency |
| Migrations | Embedded SQL files | Version-numbered `.sql` files applied on startup with `schema_version` table. Simple, explicit, no ORM dependency |
| Monetary values | Integer (cents) | Avoid floating-point precision issues for financial calculations (NFR13) |
| Validation | Rust backend as source of truth | All data validated in Rust before SQLite write; frontend does lightweight UX validation for immediate feedback |
| Caching | None (SQLite is local) | Single-user local database is fast enough without a caching layer; dashboard aggregates computed on query |
| Audit trail | `audit_log` table in SQLite | Records financial data changes (balance updates, transaction edits, imports) for NFR11 compliance |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Authentication | None (MVP) | Single-user desktop app; deferred to Phase 2 |
| Encryption at rest | OS-level (FileVault on macOS, BitLocker on Windows) | Relies on OS full-disk encryption; zero application code required. Users must enable their OS encryption for data-at-rest protection. |
| AWS credentials | Environment variables | Simple; loaded by AWS SDK for Rust automatically from standard `AWS_*` env vars |
| File upload validation | Rust backend | Type (image/PDF) and size validation before AI submission (NFR8) |

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IPC commands | Tauri invoke (request/response) | All CRUD operations, data queries, AI chat messages |
| IPC events | Tauri event emitter (pub/sub) | AI import progress streaming (uploading → extracting → categorizing → done) |
| Error handling | Typed Rust error enums | `DatabaseError`, `ValidationError`, `AiServiceError`, `FileError` — serialize to structured JSON for frontend inline error rendering |
| AI service client | `aws-sdk-bedrockruntime` (Rust) | Native Rust SDK for AWS Bedrock; async via Tokio; no Strand SDK (Python-only, no Rust support) |
| CC parsing | Direct Bedrock API calls from Rust | Custom prompts + structured output parsing; file → Bedrock → parsed transactions |
| AI chat | Direct Bedrock API calls from Rust | Conversational queries with database context; streaming responses via Tauri events |

### Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State management (data) | TanStack Query | Treats IPC commands like API calls; built-in caching, refetching, loading/error states; handles dashboard refresh after import |
| State management (UI) | React Context or Zustand (lightweight) | Sidebar state, chat bar open/closed, active modals — thin layer for non-data UI state |
| Routing | TanStack Router | Type-safe routing; pairs well with TanStack Query; 7 flat routes (Dashboard, Budget, Accounts, Assets, Net Worth, Import, Chat) |
| Forms | React Hook Form | Multi-field forms (onboarding, account creation, budget setup); inline edits use simple controlled inputs |
| Design system | shadcn/ui + Tailwind CSS | Per UX spec; components copied into project, full ownership |
| Charts | Recharts | Per UX spec; net worth trends, budget progress, sparklines |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build & distribution | Tauri native bundling (.dmg/.app on macOS, .msi/.exe on Windows) | Cross-platform; built-in to Tauri CLI |
| CI/CD | Manual local builds | Personal project, small user base; automated pipeline deferred |
| App data location | Tauri `appDataDir()` | OS-standard location for SQLite database and logs |
| App configuration | SQLite `config` table | AI model selection, default currency, user preferences — queryable from both Rust and AI chat |
| Logging (Rust) | `tracing` crate | Standard Rust logging; output to file in app data directory |
| Logging (frontend) | Console (dev only) | No external monitoring needed for personal app |
| Backup (NFR12) | SQLite file copy | Tauri command copies database file to user-chosen location via native save dialog; restore = replace file |

### Decision Impact Analysis

**Implementation Sequence:**
1. Scaffold Tauri + React + TypeScript (create-tauri-app)
2. Add Tailwind + shadcn/ui + TanStack Router + TanStack Query + React Hook Form
3. Set up rusqlite with migration system and initial schema
4. Implement IPC command/event patterns with typed errors
5. Build CRUD features (budget, accounts, assets, expenses)
6. Integrate `aws-sdk-bedrockruntime` for CC import pipeline
7. Build dashboard aggregation queries
8. Add AI chat with Bedrock integration
9. Add net worth snapshot system
10. Add backup/restore, audit logging, Playwright tests

**Cross-Component Dependencies:**
- TanStack Query wraps all IPC commands — must be set up before any feature work
- Typed error enums in Rust define the contract for frontend error rendering
- Budget categories are referenced by expenses, import results, and AI chat — schema must be stable before dependent features
- Net worth snapshots depend on accounts + assets being implemented first
- AI import and AI chat both use the Bedrock client — share the Rust service layer

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database Naming Conventions:**
- Tables: `snake_case`, plural — `budget_categories`, `expenses`, `accounts`, `passive_assets`, `net_worth_snapshots`, `audit_log`
- Columns: `snake_case` — `category_id`, `created_at`, `estimated_value`
- Foreign keys: `{referenced_table_singular}_id` — `budget_category_id`, `account_id`
- Indexes: `idx_{table}_{columns}` — `idx_expenses_category_id`

**Rust Code Naming:**
- Structs: `PascalCase` — `BudgetCategory`, `Expense`, `ImportResult`
- Functions: `snake_case` — `get_budget_categories`, `create_expense`
- Modules: `snake_case` — `budget`, `import`, `ai_service`
- Tauri commands: `snake_case` — `#[tauri::command] fn get_budget_categories()`

**TypeScript/React Code Naming:**
- Components: `PascalCase` files and names — `DashboardMetricCard.tsx`
- Hooks: `camelCase` with `use` prefix — `useBudgetCategories.ts`
- Utilities: `camelCase` — `formatCurrency.ts`
- Types/interfaces: `PascalCase` — `BudgetCategory`, `Expense`

**IPC Command Names:**
- `snake_case` matching the Rust function — `get_budget_categories`, `create_expense`, `import_cc_statement`

**Tauri Event Names:**
- `kebab-case` with namespace — `import:progress`, `import:complete`, `import:error`, `chat:response-chunk`

### Structure Patterns

**Frontend Organization (feature-based):**

```
src/
├── components/
│   ├── ui/              # shadcn components (generated, untouched)
│   ├── dashboard/       # DashboardMetricCard, BudgetCategoryRow, etc.
│   ├── import/          # ImportProgressStepper, TransactionReviewCard, etc.
│   ├── budget/          # Budget-specific components
│   ├── accounts/        # Account-specific components
│   ├── assets/          # Asset-specific components
│   ├── net-worth/       # NetWorthBreakdownBar, etc.
│   ├── chat/            # ChatMessageBubble, FloatingChatBar, etc.
│   └── shared/          # Components used across features (e.g., MoneyInput)
├── hooks/               # Custom hooks (useInvoke, useBudget, etc.)
├── lib/                 # Utilities (formatCurrency, constants, types)
├── routes/              # TanStack Router route definitions
└── App.tsx
```

**Rust Backend Organization:**

```
src-tauri/
├── src/
│   ├── main.rs          # Tauri setup, command registration
│   ├── db/
│   │   ├── mod.rs       # Database connection, migration runner
│   │   ├── budget.rs    # Budget/category queries
│   │   ├── expense.rs   # Expense queries
│   │   ├── account.rs   # Account queries
│   │   ├── asset.rs     # Passive asset queries
│   │   ├── net_worth.rs # Net worth snapshot queries
│   │   └── audit.rs     # Audit log queries
│   ├── commands/
│   │   ├── mod.rs       # Command exports
│   │   ├── budget.rs    # Budget Tauri commands
│   │   ├── expense.rs   # Expense Tauri commands
│   │   ├── account.rs   # Account Tauri commands
│   │   ├── asset.rs     # Asset Tauri commands
│   │   ├── net_worth.rs # Net worth Tauri commands
│   │   ├── import.rs    # CC import Tauri commands
│   │   ├── chat.rs      # AI chat Tauri commands
│   │   └── backup.rs    # Backup/restore commands
│   ├── ai/
│   │   ├── mod.rs       # Shared Bedrock client setup
│   │   ├── cc_parser.rs # CC statement parsing logic + prompts
│   │   └── chat.rs      # AI chat logic + prompts
│   ├── models/
│   │   └── mod.rs       # Shared Rust structs (BudgetCategory, Expense, etc.)
│   └── error.rs         # Typed error enums
├── migrations/
│   ├── 001_initial.sql
│   └── ...
└── Cargo.toml
```

**Tests:**
- Playwright E2E tests in `tests/` at the project root
- Rust unit tests co-located in each module (`#[cfg(test)] mod tests`)

**Key rules:**
- One Tauri command file per feature domain
- One db query file per feature domain
- Commands call db functions — commands don't contain SQL directly
- Models shared across commands and db layer
- AI service is its own module, not mixed into commands

### Format Patterns

**IPC Response Format:**

All Tauri commands return `Result<T, AppError>` in Rust. On the TypeScript side:

```typescript
// Success — TanStack Query receives the data directly
{ id: 1, name: "Groceries", target_cents: 70000 }

// Error — caught by TanStack Query's error handling
{ error: { type: "validation", message: "Category name required", field?: "name" } }
{ error: { type: "database", message: "Failed to save expense" } }
{ error: { type: "ai_service", message: "Bedrock unavailable", recoverable: true } }
{ error: { type: "file", message: "Only images and PDFs supported" } }
```

**Data Exchange Between Rust ↔ React:**
- JSON field naming: `snake_case` (matches Rust structs, serde default). TypeScript types mirror this — no camelCase conversion at the boundary.
- Dates: ISO 8601 strings (`"2026-03-14"` for dates, `"2026-03-14T10:30:00Z"` for timestamps)
- Monetary values: Integer cents in JSON (`70000` not `700.00`). Frontend formats for display (`$700.00`).
- Nulls: Explicit `null` for missing optional fields, not omitted keys
- Booleans: `true`/`false` (standard JSON)

**Tauri Event Payload Format:**

```typescript
// Import progress events
{ stage: "extracting" | "categorizing" | "done", progress?: number, message?: string }

// Import result
{ transactions: [...], flagged_count: number, auto_count: number }

// Chat response streaming
{ chunk: string, done: boolean }
```

**Display Formatting (frontend only):**
- Currency: `$1,234.56` — formatted from cents using a shared `formatCurrency()` utility
- Dates: `"March 14, 2026"` (full) or `"Mar 14"` (compact) per UX spec
- Percentages: `"82%"` with trend arrow prefix (`"↑ 2.3%"` / `"↓ 1.1%"`)

### Communication Patterns

**TanStack Query Patterns:**
- Query keys follow a consistent namespace: `["budgets", month]`, `["expenses", budgetId]`, `["accounts"]`, `["dashboard"]`, `["net-worth", period]`
- All IPC calls wrapped in a shared `invoke` helper that handles error deserialization
- Mutations invalidate related queries — e.g., creating an expense invalidates `["expenses"]` and `["dashboard"]`

**Tauri Event Patterns:**
- Import progress uses dedicated stepper component driven by Tauri events (not TanStack Query)
- Chat streaming uses Tauri events for response chunks
- Dashboard refresh after import uses TanStack Query invalidation (not events)

### Process Patterns

**Error Handling Flow:**
1. Rust command returns `Err(AppError::Validation { message, field })` (or Database, AiService, File variants)
2. Tauri serializes to JSON error on the frontend
3. TanStack Query catches it in `onError` / `error` state
4. Component renders inline error per UX spec (no modals, no red banners for recoverable errors)
5. AI service errors always include `recoverable: true` and a user-facing message with next step ("Add transactions manually")

**Loading State Patterns:**
- TanStack Query's `isLoading` / `isPending` drives skeleton states on cards (per UX spec)
- No global loading spinner — each card/section manages its own loading state

**Logging Patterns (Rust):**
- `tracing::info!` for normal operations (import started, expense created)
- `tracing::warn!` for recoverable issues (AI partial extraction, retry)
- `tracing::error!` for failures (database error, AI service down)
- Audit log table for financial data changes — separate from tracing, persisted in SQLite

### Enforcement Guidelines

**All AI Agents MUST:**
1. Use `snake_case` for all database columns, Rust functions, IPC command names, and JSON fields
2. Use `PascalCase` for React components, TypeScript types, and Rust structs
3. Store monetary values as integer cents — never floating point
4. Return `Result<T, AppError>` from all Tauri commands — never panic or unwrap in command handlers
5. Place SQL in `db/` modules, never in `commands/` — commands call db functions
6. Invalidate relevant TanStack Query keys after every mutation
7. Handle AI service errors with `recoverable: true` and a manual fallback path
8. Log financial data changes to the `audit_log` table
9. Follow the feature-based file organization — one domain per file in both `commands/` and `db/`
10. Use ISO 8601 for all date serialization; format for display only in the frontend

**Anti-Patterns to Avoid:**
- Mixing camelCase and snake_case in JSON payloads
- Storing dollar amounts as floats (e.g., `700.00` instead of `70000` cents)
- Putting SQL queries directly in Tauri command handlers
- Using `unwrap()` or `expect()` in command handlers (use `?` with AppError)
- Creating global loading states instead of per-component states
- Showing modal error dialogs for recoverable errors
- Hardcoding format strings instead of using shared utilities (`formatCurrency`, `formatDate`)

## Project Structure & Boundaries

### Complete Project Directory Structure

```
nkbaz-finance/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── components.json              # shadcn/ui config
├── .env.example                 # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
├── .gitignore
├── playwright.config.ts
│
├── src/                         # React frontend
│   ├── App.tsx                  # Root component, TanStack Query + Router providers
│   ├── main.tsx                 # Entry point, Tauri bootstrap
│   ├── index.css                # Tailwind directives, CSS variables (shadcn theme)
│   ├── routeTree.gen.ts         # TanStack Router generated route tree
│   ├── components/
│   │   ├── ui/                  # shadcn components (generated, never manually edited)
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── table.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── form.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── command.tsx       # cmdk for floating chat bar
│   │   │   ├── sheet.tsx
│   │   │   ├── alert.tsx
│   │   │   └── chart.tsx         # Recharts wrapper
│   │   ├── dashboard/
│   │   │   ├── DashboardMetricCard.tsx
│   │   │   └── BudgetCategoryRow.tsx
│   │   ├── import/
│   │   │   ├── ImportProgressStepper.tsx
│   │   │   ├── TransactionReviewCard.tsx
│   │   │   └── AutoCategorizedSummary.tsx
│   │   ├── budget/
│   │   │   └── BudgetGroupCard.tsx
│   │   ├── accounts/
│   │   │   └── AccountRow.tsx
│   │   ├── assets/
│   │   │   └── AssetRow.tsx
│   │   ├── net-worth/
│   │   │   └── NetWorthBreakdownBar.tsx
│   │   ├── chat/
│   │   │   ├── ChatMessageBubble.tsx
│   │   │   └── FloatingChatBar.tsx
│   │   ├── onboarding/
│   │   │   └── OnboardingWizard.tsx
│   │   └── shared/
│   │       ├── MoneyInput.tsx
│   │       ├── AppSidebar.tsx
│   │       └── PageHeader.tsx
│   ├── hooks/
│   │   ├── useInvoke.ts          # Shared IPC invoke wrapper for TanStack Query
│   │   ├── useTauriEvent.ts      # Shared Tauri event listener hook
│   │   ├── useBudget.ts
│   │   ├── useExpenses.ts
│   │   ├── useAccounts.ts
│   │   ├── useAssets.ts
│   │   ├── useNetWorth.ts
│   │   ├── useImport.ts
│   │   └── useChat.ts
│   ├── lib/
│   │   ├── formatCurrency.ts     # Cents → "$1,234.56"
│   │   ├── formatDate.ts         # ISO → "March 14, 2026" / "Mar 14"
│   │   ├── constants.ts          # Query keys, event names, route paths
│   │   └── types.ts              # Shared TypeScript types mirroring Rust models
│   └── routes/
│       ├── __root.tsx            # Root layout (sidebar + main content area)
│       ├── index.tsx             # Dashboard (landing page)
│       ├── budget.tsx
│       ├── accounts.tsx
│       ├── assets.tsx
│       ├── net-worth.tsx
│       ├── import.tsx
│       └── chat.tsx
│
├── src-tauri/                   # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json          # Tauri config (window size, app name, permissions)
│   ├── build.rs
│   ├── icons/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── ...
│   └── src/
│       ├── main.rs              # Tauri setup, command registration, DB init
│       ├── error.rs             # AppError enum (Validation, Database, AiService, File)
│       ├── models/
│       │   └── mod.rs           # BudgetCategory, Expense, Account, Asset, NetWorthSnapshot, etc.
│       ├── db/
│       │   ├── mod.rs           # Connection pool, migration runner
│       │   ├── budget.rs        # Budget + category CRUD queries
│       │   ├── expense.rs       # Expense CRUD queries
│       │   ├── account.rs       # Account CRUD queries
│       │   ├── asset.rs         # Passive asset CRUD queries
│       │   ├── net_worth.rs     # Net worth snapshot queries
│       │   ├── dashboard.rs     # Dashboard aggregation queries
│       │   └── audit.rs         # Audit log insert/query
│       ├── commands/
│       │   ├── mod.rs           # Command exports (all pub fns registered in main.rs)
│       │   ├── budget.rs        # get_budgets, create_budget, update_budget, etc.
│       │   ├── expense.rs       # get_expenses, create_expense, update_expense, etc.
│       │   ├── account.rs       # get_accounts, create_account, update_balance, etc.
│       │   ├── asset.rs         # get_assets, create_asset, update_value, etc.
│       │   ├── net_worth.rs     # get_net_worth_history, get_net_worth_breakdown
│       │   ├── import.rs        # import_cc_statement (triggers AI pipeline, emits events)
│       │   ├── chat.rs          # send_chat_message (calls Bedrock, returns/streams response)
│       │   └── backup.rs        # export_backup, import_backup
│       └── ai/
│           ├── mod.rs           # Bedrock client initialization, shared config
│           ├── cc_parser.rs     # CC statement parsing: image/PDF → transactions
│           └── chat.rs          # Chat: query intent → DB query → natural language response
│
└── tests/                       # Playwright E2E tests
    ├── fixtures/
    │   ├── sample-cc-statement.png
    │   └── sample-cc-statement.pdf
    ├── dashboard.spec.ts
    ├── budget.spec.ts
    ├── import.spec.ts
    ├── accounts.spec.ts
    ├── assets.spec.ts
    ├── net-worth.spec.ts
    └── chat.spec.ts
```

### Architectural Boundaries

**IPC Boundary (Rust ↔ React):**
- React frontend NEVER accesses SQLite directly — all data flows through Tauri commands
- Rust backend NEVER renders UI — it returns data and emits events
- The `commands/` layer is the single entry point from frontend to backend
- Commands validate input, call `db/` for data, call `ai/` for AI operations, return `Result<T, AppError>`

**Data Access Boundary:**
- Only `db/` modules execute SQL queries
- `commands/` call `db/` functions — never write SQL inline
- `ai/` modules call Bedrock — never access the database directly (they receive data from commands)
- `models/` structs are shared across `commands/`, `db/`, and `ai/`

**AI Service Boundary:**
- `ai/` module owns all Bedrock communication
- `ai/cc_parser.rs` receives raw file bytes + budget categories, returns parsed transactions
- `ai/chat.rs` receives user message + relevant DB context (passed by command), returns AI response
- AI modules never query the database — commands fetch context and pass it in

**Frontend Component Boundary:**
- `components/ui/` — shadcn primitives, never modified manually
- `components/{feature}/` — domain components, composed from shadcn primitives
- `components/shared/` — cross-feature components (MoneyInput, AppSidebar, PageHeader)
- `hooks/` — data fetching and event listening, one hook file per feature domain
- `routes/` — page-level components that compose feature components

### Requirements to Structure Mapping

| FR Group | Frontend | Rust Commands | Rust DB | AI |
|----------|----------|---------------|---------|-----|
| Budget Management (FR1-4) | `routes/budget.tsx`, `components/budget/`, `hooks/useBudget.ts` | `commands/budget.rs` | `db/budget.rs` | — |
| AI CC Import (FR5-10) | `routes/import.tsx`, `components/import/`, `hooks/useImport.ts` | `commands/import.rs` | `db/expense.rs` | `ai/cc_parser.rs` |
| Expense Tracking (FR11-14) | `routes/budget.tsx` (expense list within budget view), `hooks/useExpenses.ts` | `commands/expense.rs` | `db/expense.rs` | — |
| Account Management (FR15-18) | `routes/accounts.tsx`, `components/accounts/`, `hooks/useAccounts.ts` | `commands/account.rs` | `db/account.rs` | — |
| Passive Assets (FR19-21) | `routes/assets.tsx`, `components/assets/`, `hooks/useAssets.ts` | `commands/asset.rs` | `db/asset.rs` | — |
| Dashboard (FR22-25) | `routes/index.tsx`, `components/dashboard/`, `hooks/useBudget.ts` + `useAccounts.ts` + `useNetWorth.ts` | `commands/budget.rs` + `commands/account.rs` + `commands/net_worth.rs` | `db/dashboard.rs` | — |
| Net Worth History (FR26-28) | `routes/net-worth.tsx`, `components/net-worth/`, `hooks/useNetWorth.ts` | `commands/net_worth.rs` | `db/net_worth.rs` | — |
| AI Chat (FR29-32) | `routes/chat.tsx`, `components/chat/`, `hooks/useChat.ts` | `commands/chat.rs` | (queries via commands) | `ai/chat.rs` |

### Data Flow

**CC Import Flow:**
```
User drops file → React (useImport hook)
  → invoke("import_cc_statement", { file_path }) → Rust commands/import.rs
    → validate file type/size (error.rs if invalid)
    → emit event "import:progress" { stage: "extracting" }
    → ai/cc_parser.rs → Bedrock API (send image/PDF + budget categories)
    → emit event "import:progress" { stage: "categorizing" }
    → receive parsed transactions from Bedrock
    → emit event "import:complete" { transactions, flagged_count, auto_count }
  → React renders TransactionReviewCards for flagged items
  → User resolves flags, clicks Confirm
  → invoke("confirm_import", { transactions }) → Rust commands/import.rs
    → db/expense.rs inserts all expenses
    → db/audit.rs logs the import
    → db/net_worth.rs triggers snapshot if balances changed
  → React invalidates ["expenses"], ["dashboard"], ["budgets"] query keys
```

**AI Chat Flow:**
```
User types message → React (useChat hook)
  → invoke("send_chat_message", { message, conversation_id })
  → Rust commands/chat.rs
    → determine intent (data query vs. write action)
    → if data query: fetch relevant data from db/, pass to ai/chat.rs
    → ai/chat.rs → Bedrock API (message + DB context)
    → stream response chunks via "chat:response-chunk" events
    → if write action: return confirmation card (action details)
      → User confirms → invoke("execute_chat_action", { action })
      → commands/chat.rs calls appropriate db/ function
      → db/audit.rs logs the action
```

**Dashboard Load Flow:**
```
User opens app → React routes/index.tsx
  → TanStack Query fires parallel queries:
    → invoke("get_budget_summary", { month }) → db/dashboard.rs
    → invoke("get_account_balances") → db/account.rs
    → invoke("get_net_worth_current") → db/net_worth.rs
  → All return within 1s (NFR1)
  → Dashboard renders with data from all three queries
```

### Development Workflow

- **Dev server:** `npm run tauri dev` — starts Vite HMR + Tauri dev window simultaneously
- **Build:** `npm run tauri build` — produces `.dmg` / `.app` for macOS
- **Tests:** `npx playwright test` — runs E2E tests against the built app
- **Rust tests:** `cd src-tauri && cargo test` — runs unit tests in Rust modules

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are compatible. rusqlite (sync) runs on Tauri's command thread pool without blocking the UI. aws-sdk-bedrockruntime shares Tauri's Tokio runtime. TanStack Query + Router + React Hook Form + shadcn/ui form a cohesive frontend stack.

**Pattern Consistency:** snake_case flows end-to-end from database columns through Rust structs through JSON to TypeScript types. PascalCase consistent for component and struct naming. Feature-based organization mirrors across frontend and backend.

**Structure Alignment:** Project directory structure physically enforces all architectural boundaries (IPC, data access, AI service, component).

### Requirements Coverage Validation

**Functional Requirements:** 32/32 FRs fully covered. Every FR group maps to specific frontend routes, Rust commands, and database modules.

**Non-Functional Requirements:** 13/13 NFRs addressed. Performance NFRs leverage local SQLite + parallel queries. Security NFRs handled via OS encryption + HTTPS. Reliability NFRs covered by audit logging + backup.

### Implementation Readiness Validation

**Decision Completeness:** All critical decisions documented with specific technology choices. No ambiguous "TBD" items remain.

**Structure Completeness:** Full project tree defined with every file and directory. Requirements-to-structure mapping provides explicit guidance.

**Pattern Completeness:** 10 enforcement rules + 7 anti-patterns cover all identified conflict points. Naming, structure, format, communication, and process patterns all specified.

### Gap Analysis Results

No critical or important gaps. Three minor observations:

1. **SQLite WAL mode** — should be set in `db/mod.rs` on connection open for NFR11 (write-ahead logging). Implementation detail, not architecture gap.
2. **Chat conversation tables** — `chat_conversations` and `chat_messages` tables needed for FR29-32 multi-turn support. Naturally belongs in `db/chat.rs`.
3. **Onboarding detection** — TanStack Query returns empty budget → route to onboarding wizard. Logic detail, not architecture gap.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with technology choices
- [x] Technology stack fully specified
- [x] Integration patterns defined (IPC commands + events)
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established (database, Rust, TypeScript, IPC, events)
- [x] Structure patterns defined (feature-based, both frontend and backend)
- [x] Communication patterns specified (TanStack Query, Tauri events, error flow)
- [x] Process patterns documented (error handling, loading states, logging)

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established (IPC, data access, AI service, frontend)
- [x] Integration points mapped (data flows for import, chat, dashboard)
- [x] Requirements to structure mapping complete (all 32 FRs mapped)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Clean separation of concerns — Rust backend owns data + AI, React frontend owns rendering
- Feature-based organization mirrors across both stacks — easy to find related code
- Typed error handling flows end-to-end from Rust to React
- TanStack Query as the data layer eliminates manual cache management
- Data flows documented for the three critical paths (import, chat, dashboard)

**Areas for Future Enhancement:**
- CI/CD pipeline (deferred — manual builds for MVP)
- Authentication layer (Phase 2 multi-user)
- Windows testing and distribution (Phase 2 — architecture is already cross-platform)
- Performance monitoring / error tracking (post-MVP)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
```bash
npm create tauri-app@latest nkbaz-finance -- --template react-ts
```
Then: Tailwind + shadcn/ui + TanStack Router + TanStack Query + React Hook Form + rusqlite setup.
