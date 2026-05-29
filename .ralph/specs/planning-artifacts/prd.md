---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-e-01-discovery', 'step-e-02-review', 'step-e-03-edit']
lastEdited: '2026-05-18'
editHistory:
  - date: '2026-03-16'
    changes: 'Added income tracking: new Income Management FRs (FR33-FR39), Journey 6 (Income Entry), updated Executive Summary, Success Criteria, Dashboard Journey, AI Chat Journey, Product Scope MVP, Dashboard FRs, AI Chat FRs'
  - date: '2026-05-18'
    changes: 'Added AI Section & Multi-Agent Chat FRs (FR40-FR48): dedicated AI sidebar section, multi-agent personality support, per-agent conversation history, conversation resume, FloatingChatBar last-used agent persistence; updated Executive Summary to mention multi-agent chat with persistent conversation history'
inputDocuments: ['product-brief-nkbaz-finance-2026-03-14.md']
workflowType: 'prd'
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 0
classification:
  projectType: desktop_app
  domain: fintech
  complexity: medium
  projectContext: greenfield
---

# Product Requirements Document - nkbaz-finance

**Author:** dev
**Date:** 2026-03-14

## Executive Summary

nkbaz-finance is a personal finance desktop application (built with Tauri) that replaces manual spreadsheet tracking with an automation-first approach. Users build monthly budgets with grouped categories, track expenses across multiple accounts, monitor passive assets, and view net worth history over time — all in a single interface. Users set up income sources and record monthly earnings, enabling a complete cash flow picture — income versus expenses — that powers smarter AI recommendations. The core workflow is built around AI-powered credit card statement import: users upload a screenshot or PDF, and the system auto-categorizes transactions using Strand SDK and AWS Bedrock. An AI chat interface — supporting multiple agent personalities with persistent conversation history — provides natural language access to all financial data and operations. Built for personal use as a single-user, local-first desktop application.

The product solves a specific failure mode: financial tracking tools die when they demand effort. Spreadsheets work until the maintenance burden causes people to stop updating them. nkbaz-finance eliminates that friction by automating the most tedious part — data entry and categorization — starting with the highest-impact touchpoint (bi-weekly CC statements).

### What Makes This Special

- **Automation-first philosophy** — the product's core promise is removing manual effort. CC statement parsing via AI is the entry point, not a feature bolted on later.
- **Complete financial picture in one place** — budgeting, expense tracking, multi-account balances, passive assets (real estate, business, vehicles), and net worth history by category (cash, crypto, housing, TFSA, RRSP). No juggling separate tools.
- **Pragmatic automation path** — screenshot/PDF upload over bank API integration. Easier to build, no third-party dependencies, accessible to any user who can take a photo. Bank APIs come later as an expansion of the automation model.
- **AI-native interaction** — conversational interface for querying and managing financial data, plus automated CC parsing. AI is woven into the product, not bolted on.
- **Cash flow visibility** — income tracking alongside expenses gives the AI full financial context for meaningful recommendations, not just spending data in isolation.
- **Built from real pain** — designed from the builder's own failed spreadsheet workflow, not theoretical user research.

## Project Classification

- **Project Type:** Desktop Application (Tauri — React frontend, Rust backend)
- **Domain:** Fintech — Personal Finance
- **Complexity:** Medium — no payment processing, no regulatory compliance, no bank API integrations in MVP. Complexity sits in AI parsing accuracy and multi-account data modeling.
- **Project Context:** Greenfield — new build from scratch

## Success Criteria

### User Success

- CC statement upload correctly categorizes 95%+ of transactions automatically
- Full bi-weekly workflow (upload → review → check budget) completes in under 5 minutes
- All account types and passive assets represented in a single view
- Net worth history accurately tracks changes over time by category
- All income sources represented with monthly entries reflecting actual amounts received
- Google Sheets is fully replaced — no longer needed for finance tracking

### Business Success

N/A — personal project built to solve a personal problem. No commercial, growth, or adoption goals.

### Technical Success

- AI-powered CC parsing returns results reliably via Strand SDK + AWS Bedrock
- Application is stable and data is not lost between sessions
- Performance is responsive for a single-user workload

### Measurable Outcomes

| Outcome | Target | How to Measure |
|---------|--------|----------------|
| CC categorization accuracy | 95%+ | Correct categories vs. manual corrections needed |
| Budget tracking completeness | 100% of months tracked | No gaps in monthly budget data |
| Time to update finances | < 5 min per bi-weekly session | From upload to reviewed dashboard |
| Account coverage | All accounts represented | Every bank/investment/asset reflected |
| Income tracking completeness | 100% of months have income recorded | No gaps in monthly income data |
| Spreadsheet dependency | Zero | Google Sheets no longer used for finances |

## User Journeys

### Journey 1: The Bi-Weekly CC Import (Core Loop)

Dev sits down on a Saturday morning with coffee. Two weeks of spending on the credit card — time to update finances.

He opens nkbaz-finance, hits upload, and drops in a screenshot of his Tangerine CC statement. The AI chews on it for a few seconds, then presents a categorized breakdown: groceries, gas, restaurants, subscriptions — all mapped to his budget categories.

A couple of flagged items need a quick look — a new merchant the AI hasn't seen before, and a transaction that could be either "Entertainment" or "Dining Out." Dev taps the right categories, confirms. Done.

The dashboard updates instantly: budget bars shift, spending-by-category refreshes, and he can see he's 80% through his food budget with two weeks left in the month. The whole thing took 2 minutes.

**What this reveals:**
- Upload interface (screenshot/PDF drag-and-drop)
- AI parsing + categorization pipeline (Strand SDK + Bedrock)
- Exception-based review UI (only show what needs attention)
- Real-time dashboard update after import
- Budget category mapping and progress visualization

### Journey 2: The Setup & Maintenance Flow

Dev is setting up the app for the first time. He creates his budget — housing, food, transport, entertainment, subscriptions, savings — with monthly targets for each group. He adds his accounts: Wealthsimple (TFSA, RRSP, non-registered, crypto), Desjardins (chequing, savings), Tangerine (CC, savings), plus a couple of US-dollar accounts.

Then the passive assets: his condo, his share of a business, his car. He enters current estimated values.

A month later, he updates his Wealthsimple balances after checking the app — types in the new TFSA and RRSP numbers. Adjusts the condo estimate after a comparable sold on his street.

**What this reveals:**
- Budget builder with category groups and monthly targets
- Account management (add/edit/remove, multiple types)
- Passive asset management (add/edit/remove, various asset classes)
- Manual balance entry for all non-CC accounts
- Simple, fast data entry — no friction on updates

### Journey 3: The Dashboard Glance

Dev opens the app mid-month just to check where things stand. The dashboard shows: budget status across all categories, total balances by account, total net worth, and this month's income versus total expenses — the cash flow snapshot. No clicks needed. He sees the number, closes the tab.

**What this reveals:**
- Dashboard as the landing page
- Net worth = sum of all account balances + all passive asset values
- Budget status at a glance (per category, overall)
- Income vs. expenses cash flow view
- Zero-interaction read — everything visible without drilling in

### Journey 4: The CC Import Gone Wrong (Edge Case)

Dev uploads a CC statement screenshot but the image is blurry — taken at an angle. The AI extracts most transactions but flags three it can't read clearly. Dev sees the flagged items, manually enters them, and confirms. The system still saved him from entering the other 15 transactions by hand.

**What this reveals:**
- Graceful AI failure handling (partial extraction with flags)
- Manual entry fallback for unreadable items
- Error states that don't block the workflow

### Journey 5: The AI Chat Query

Dev wants to know how his restaurant spending this quarter compares to last quarter. Instead of navigating through expense views and doing mental math, he opens the AI chat and types: "How much did I spend on dining out in Q1 vs Q4 last year?"

The AI queries his data and responds with the breakdown. Dev follows up: "Am I spending more than I earn this month?" The AI pulls his recorded income and total expenses and responds: "You've spent 78% of this month's income with 10 days left. Your dining and entertainment categories are running hot — consider holding off on non-essentials." Dev then says: "Add a $45 expense at Costco under Groceries for today." The AI confirms the details and Dev approves the action.

**What this reveals:**
- Natural language query interface for all financial data
- AI can answer comparative and analytical questions
- AI can perform write actions with user confirmation
- Income-aware spending recommendations
- Conversational interaction as an alternative to UI navigation

### Journey 6: The Income Entry

It's payday. Dev opens nkbaz-finance and navigates to income. His salary source is already set up — "Employment – Employer Name." He enters this month's net amount: $4,250 (a bit higher than last month due to overtime). Confirms. The dashboard updates: income bar for the month, cash flow ratio refreshes, and the AI now knows exactly how much came in versus what went out.

Next month his pay is lower — back to the base $3,800. He updates accordingly. Over time, the app builds a complete picture of income variability alongside spending patterns.

**What this reveals:**
- Income source setup (name, type, recurring/variable)
- Monthly income entry with actual amounts
- Income history over time
- Dashboard integration showing income vs. expenses
- AI context enrichment for recommendations

### Journey Requirements Summary

| Capability | Revealed By |
|-----------|-------------|
| CC statement upload (screenshot/PDF) | Journey 1, 4 |
| AI parsing + auto-categorization | Journey 1, 4 |
| Exception-based review UI | Journey 1 |
| Budget builder with category groups | Journey 2 |
| Multi-account management | Journey 2 |
| Passive asset tracking | Journey 2 |
| Manual balance entry | Journey 2 |
| Dashboard (budget + balances + net worth) | Journey 3 |
| Net worth = accounts + passive assets | Journey 3 |
| Partial AI extraction + manual fallback | Journey 4 |
| AI chat for data queries | Journey 5 |
| AI chat for write actions with confirmation | Journey 5 |
| Income source setup | Journey 6 |
| Monthly income entry | Journey 6 |
| Income vs. expense dashboard view | Journey 3, 6 |
| Income-aware AI recommendations | Journey 5 |

## Product Scope

### MVP (Phase 1)

**MVP Approach:** Problem-solving MVP — deliver the complete financial tracking replacement for Google Sheets in a single release. All 8 core features ship together because they form an interdependent system.

**Resource Requirements:** Solo developer. No external dependencies beyond Strand SDK and AWS Bedrock.

**Must-Have Capabilities:**
1. **Monthly Budget Builder** — create/manage budgets with customizable category groups and targets
2. **AI-Powered CC Import** — upload screenshot/PDF, auto-extract and categorize transactions
3. **Expense Tracking** — view, review, correct auto-categorized expenses; manual entry as fallback
4. **Multi-Account Tracking** — track balances across multiple banks and account types
5. **Passive Asset Tracking** — track value of business, real estate, vehicles, other assets
6. **Dashboard** — budget status, spending by category, account balances, net worth
7. **Net Worth History** — historical tracking split by category (cash, crypto, housing, TFSA, RRSP, etc.)
8. **AI Chat** — natural language queries and actions across all financial data
9. **Income Tracking** — set up income sources, record monthly income amounts, view income history and cash flow (income vs. expenses)

Single-user only. No authentication required for MVP.

### Phase 2 (Growth)

- Multi-user authentication with isolated accounts for friends/family
- Bank API integrations for automatic balance syncing
- Cross-platform support (Windows, Linux) and/or mobile companion app

### Phase 3 (Expansion)

- Smart insights — AI-driven spending trends, anomaly detection, savings recommendations
- Recurring expense detection and prediction
- Export/reporting capabilities

### Risk Mitigation

**Technical Risks:** AI parsing accuracy is the single highest-risk item. Mitigation: manual entry fallback exists for every transaction. The app is useful even if AI accuracy starts below 95% — it still saves time vs. full manual entry.

**Market Risks:** N/A — personal project, no market validation needed.

**Resource Risks:** Solo developer. All MVP features are scoped as minimal implementations. Budget builder and account/asset tracking are straightforward CRUD. The AI integration is the only complex piece.

## Desktop Application Specific Requirements

### Project-Type Overview

nkbaz-finance is a Tauri desktop application with a React frontend and Rust backend, serving as a personal finance dashboard. The app is primarily data-display and data-entry oriented, with an AI-powered async workflow (CC statement parsing) and a conversational AI interface as the core interaction patterns. Data is stored locally on the user's machine.

### Technical Architecture Considerations

**Application Type:** Tauri desktop app — React + shadcn/ui frontend rendered in the OS native webview, Rust backend for data storage and system integration
**Rendering:** Client-side rendering within the Tauri webview
**Data Storage:** Local database (SQLite or similar) managed by the Rust backend — no remote server required for MVP

### Platform Support

| Platform | Support Level |
|----------|--------------|
| macOS | Primary — latest 2 major versions |
| Windows | Future consideration |
| Linux | Future consideration |

### Window & Layout

- Minimum window size: 1024px × 680px (enforced by Tauri)
- Desktop-only — no mobile or tablet layouts
- Fluid layout within the native window, max content width 1280px

### SEO Strategy

Not applicable — desktop application, no web-facing content.

### Accessibility

Best-effort WCAG 2.1 AA compliance without it becoming a blocker:
- Semantic HTML elements (nav, main, section, headings)
- Keyboard navigability for core workflows
- Sufficient color contrast on dashboard elements
- ARIA labels on interactive components
- Screen reader compatibility (VoiceOver on macOS) — good practices followed

### Real-Time Communication

Tauri IPC (inter-process communication) between React frontend and Rust backend for:
- **CC import progress** — live status updates during AI parsing (uploading → extracting → categorizing → done)
- **Dashboard refresh** — updated budget/balance data after import completes

Not required for account/asset balance updates (manual entry, standard request/response).

### Implementation Considerations

- Native file dialog (Tauri `dialog.open()`) for CC screenshots (image) and PDFs, with drag-and-drop as alternative
- Async job pattern for AI parsing — Rust backend submits to AI service, streams progress via Tauri events to frontend
- Client-side state management for budget views, account lists, and dashboard data
- Client-side routing within the Tauri webview (dashboard, budget, accounts, import, chat)
- Global keyboard shortcut registration via Tauri (Cmd+K for AI chat)

## Functional Requirements

### Budget Management

- FR1: User can create a monthly budget with customizable category groups
- FR2: User can set monthly spending targets for each budget category
- FR3: User can edit budget categories, groups, and targets
- FR4: User can view budget status showing spent vs. target for each category in the current month

### AI-Powered Expense Import

- FR5: User can upload a credit card statement as a screenshot (image) or PDF
- FR6: System can extract individual transactions from an uploaded CC statement using Strand SDK + AWS Bedrock
- FR7: System can auto-categorize extracted transactions into the user's budget categories
- FR8: System can flag transactions it is uncertain about for user review
- FR9: User can review and correct AI-categorized transactions before confirming
- FR10: System can report real-time progress of the import process (uploading → extracting → categorizing → done)

### Expense Tracking

- FR11: User can view all expenses for a given month, grouped by budget category
- FR12: User can manually add an expense entry (merchant, amount, category, date)
- FR13: User can edit or delete an existing expense
- FR14: User can manually enter transactions that the AI failed to extract

### Account Management

- FR15: User can add a financial account (bank, investment, crypto, etc.) with a name, institution, type, and currency
- FR16: User can edit or remove an existing account
- FR17: User can update the current balance of any account
- FR18: User can view all accounts and their current balances in a single list

### Income Management

- FR33: User can add an income source with a name and type (employment, freelance, investment, other)
- FR34: User can edit or remove an existing income source
- FR35: User can record a monthly income entry for a source with the amount received and month
- FR36: User can view income history by source and by month
- FR37: User can view total income for the current month

### Passive Asset Tracking

- FR19: User can add a passive asset (real estate, vehicle, business ownership, etc.) with a name, type, and estimated value
- FR20: User can edit or remove an existing passive asset
- FR21: User can update the estimated value of any passive asset

### Dashboard

- FR22: User can view a dashboard showing budget status across all categories for the current month
- FR23: User can view total net worth (sum of all account balances + all passive asset values) on the dashboard
- FR24: User can view spending breakdown by category on the dashboard
- FR25: User can view all account balances on the dashboard
- FR38: User can view income versus total expenses for the current month on the dashboard

### Net Worth History

- FR26: System can record a net worth snapshot each time account balances or asset values change
- FR27: User can view net worth history over time as a trend
- FR28: User can view net worth breakdown by category (cash, crypto, housing, TFSA, RRSP, etc.)

### AI Chat

- FR29: User can ask natural language questions about any data in the system (budgets, expenses, income, accounts, assets, net worth history)
- FR30: System can answer data queries with accurate, up-to-date information from the database
- FR31: User can perform actions through chat (e.g., add expenses, update balances, modify budget categories)
- FR32: System can confirm actions with the user before executing write operations
- FR39: System can provide income-aware spending recommendations when the user has recorded income data

### AI Section & Multi-Agent Chat

- FR40: User can navigate to a dedicated "AI" section in the app from the sidebar, alongside the existing Finance module
- FR41: User can view an AI landing page that displays all available AI agent personalities as selectable cards
- FR42: User can select a specific AI agent from the landing page and begin a new conversation with it
- FR43: Each AI agent has a distinct identity defined by a hardcoded name, persona description, and system prompt
- FR44: User can view a list of past conversations scoped to the selected agent, sorted by most recent, from within the agent chat view
- FR45: User can resume any past conversation with an AI agent and continue the exchange where it left off
- FR46: User can start a new conversation from within an agent chat view without leaving the agent context
- FR47: System permanently associates each conversation with the agent identity it was started under; conversations are never shared across agents
- FR48: FloatingChatBar (Cmd+K) opens pre-set to the last agent the user interacted with, persisted across sessions via localStorage

## Non-Functional Requirements

### Performance

- NFR1: Dashboard loads and renders all data (budget status, account balances, net worth) within 1 second on subsequent visits
- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay)
- NFR3: CC statement import provides progress feedback within 2 seconds of upload
- NFR4: AI parsing and categorization completes within 30 seconds for a typical CC statement (15-25 transactions)
- NFR5: AI chat responses return within 5 seconds for data queries

### Security

- NFR6: Financial data is stored encrypted at rest
- NFR7: All communication with external AI services uses HTTPS
- NFR8: File uploads are validated for type (image/PDF only) and size before processing

### Integration

- NFR9: System gracefully handles Strand SDK / AWS Bedrock service unavailability with clear error messaging
- NFR10: AI parsing failures do not block the user from manually entering transactions

### Data Integrity

- NFR11: Financial records (transactions, balances, net worth snapshots) are never silently lost or corrupted
- NFR12: Database supports backup and restore capability
- NFR13: Balance and net worth calculations are accurate to the cent
