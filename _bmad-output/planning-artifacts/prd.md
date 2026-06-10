---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-e-01-discovery', 'step-e-02-review', 'step-e-03-edit', 'step-e-04-complete']
lastEdited: '2026-06-10'
editHistory:
  - date: '2026-06-10'
    changes: 'Added Transaction-Account Linking (FR90-FR94, NFR23): optional account selection when recording expenses or income with automatic liability-aware balance adjustment on create, edit, and delete; updated Executive Summary, Journey 2/5/6, Journey Requirements Summary, Product Scope (capabilities 3, 4, 10), FR12/FR35, Phase 3 deferrals; architecture in architecture-expense-income-account-linking.md'
  - date: '2026-03-16'
    changes: 'Added income tracking: new Income Management FRs (FR33-FR39), Journey 6 (Income Entry), updated Executive Summary, Success Criteria, Dashboard Journey, AI Chat Journey, Product Scope MVP, Dashboard FRs, AI Chat FRs'
  - date: '2026-05-18'
    changes: 'Added AI Section & Multi-Agent Chat FRs (FR40-FR48): dedicated AI sidebar section, multi-agent personality support, per-agent conversation history, conversation resume, FloatingChatBar last-used agent persistence; updated Executive Summary to mention multi-agent chat with persistent conversation history'
  - date: '2026-05-29'
    changes: 'Added Car Maintenance Tracking module (FR49-FR61): multi-vehicle maintenance schedules, default task templates (fluids, filters, spark plugs, suspension, tires, brakes), in-app alerts at 500 km/14 days before due, service logging with odometer auto-update, Journey 7, MVP scope item #10, dashboard and AI chat integration; standalone vehicle entities (not linked to passive assets); architect dependency for schedule interval data source'
  - date: '2026-05-29'
    changes: 'Codebase parity sync: added FR63-FR81 for recurring expenses, spending trends, year summary, net worth projection, onboarding wizard, import duplicate detection and merchant hints, backup/restore, values privacy, i18n, theme, AI credentials keyring, auto-updater, FHSA/multi-currency accounts, YTD dashboard card; updated Product Scope and journeys; noted partial multi-agent and OpenAI runtime gaps'
  - date: '2026-06-06'
    changes: 'Added Financial Decision Intelligence capability (FR83-FR89, NFR19-NFR22): deterministic emergency-fund health (months of runway vs configurable target), savings-capacity analysis (savings rate, surplus, top discretionary categories), and a guardrailed priority-waterfall next-best-action engine (emergency fund -> high-interest debt -> registered accounts TFSA/RRSP/FHSA -> invest surplus) surfaced on a dashboard card and dedicated Financial Health view; guidance is category-level and educational only with no specific securities and a not-professional-advice disclaimer; added Journey 9, MVP capability #14, updated Executive Summary, What Makes This Special, Success Criteria, and Phase 3 (conversational AI advisor + anomaly detection deferred)'
  - date: '2026-06-06'
    changes: 'Implementation parity sync for Financial Decision Intelligence and liability-aware net worth: marked capability #14 implemented; dashboard Financial Health card placement (above Top Categories); Financial Health section under Net Worth; FR86 CC debt buffer (15% of trailing avg monthly expenses for revolving balances); liability account types subtract from net worth (FR18/FR23/FR26); positive or negative owed-balance convention for credit cards; updated Journey 3 net worth formula and Journey 9 waterfall behavior notes'
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

nkbaz-finance is a personal finance desktop application (built with Tauri) that replaces manual spreadsheet tracking with an automation-first approach. Users build monthly budgets with grouped categories, track expenses across multiple accounts (CAD and USD), optionally link individual expenses and income entries to specific accounts so balances stay in sync automatically, monitor passive assets, manage recurring expense templates, track car maintenance schedules across multiple vehicles, analyze spending trends and year-to-date summaries, project net worth forward, and view net worth history over time — all in a single interface. A guided onboarding wizard helps new users set up budget, accounts, assets, income, and first import. Users set up income sources and record monthly earnings, enabling a complete cash flow picture — income versus expenses — that powers smarter AI recommendations. Beyond tracking, the app provides financial-decision intelligence: it gauges emergency-fund health (months of runway against a target), measures savings capacity, and recommends the next best action for surplus cash using an accepted priority waterfall (emergency fund → high-interest debt → tax-advantaged room → investing) — kept educational and category-level rather than prescribing specific investments. The app surfaces in-app alerts when vehicle maintenance is approaching or overdue, based on odometer and time thresholds. The core workflow is built around AI-powered credit card statement import: users upload a screenshot or PDF, and the system auto-categorizes transactions using Strand SDK and AWS Bedrock, with duplicate detection and learned merchant-category hints. An AI chat interface — supporting multiple agent personalities with persistent conversation history — provides natural language access to all financial data and operations. Built for personal use as a single-user, local-first desktop application with English and French localization.

The product solves a specific failure mode: financial tracking tools die when they demand effort. Spreadsheets work until the maintenance burden causes people to stop updating them. nkbaz-finance eliminates that friction by automating the most tedious part — data entry and categorization — starting with the highest-impact touchpoint (bi-weekly CC statements).

### What Makes This Special

- **Automation-first philosophy** — the product's core promise is removing manual effort. CC statement parsing via AI is the entry point, not a feature bolted on later.
- **Complete financial picture in one place** — budgeting, expense tracking, multi-account balances (assets and liabilities), optional transaction-to-account linking so cash movement and balances stay aligned, passive assets (real estate, business, vehicles), and net worth history by category (cash, crypto, housing, TFSA, RRSP). No juggling separate tools.
- **Pragmatic automation path** — screenshot/PDF upload over bank API integration. Easier to build, no third-party dependencies, accessible to any user who can take a photo. Bank APIs come later as an expansion of the automation model.
- **AI-native interaction** — conversational interface for querying and managing financial data, plus automated CC parsing. AI is woven into the product, not bolted on.
- **Cash flow visibility** — income tracking alongside expenses gives the AI full financial context for meaningful recommendations, not just spending data in isolation.
- **Proactive car maintenance** — multi-vehicle maintenance schedules with default industry-baseline templates and in-app alerts before service is due. No separate car app needed.
- **Financial analytics beyond the dashboard** — spending trends, year-to-date summaries, and forward net worth projection turn tracking data into planning insight.
- **Guidance, not just numbers** — built-in financial-decision intelligence gauges emergency-fund health, savings capacity, and the next best action for surplus cash using accepted financial-hygiene priorities. Deterministic and explainable, never black-box stock-picking.
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
- All owned vehicles have active maintenance schedules with accurate due-date tracking
- Maintenance alerts appear in-app when service is within 500 km or 14 days of due, or overdue
- Emergency fund coverage is always visible and accurate against the user's chosen target
- Every surplus-cash decision has a clear, data-backed next-best-action recommendation the user understands
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
| Vehicle maintenance coverage | 100% of owned vehicles tracked | Every vehicle has an active schedule |
| Maintenance alert timeliness | Alerts within 500 km or 14 days of due | Compare alert trigger date to due date/mileage |
| Emergency fund visibility | Always current | Coverage recalculates on balance/expense change |
| Financial guidance grounding | 100% of recommendations traceable to user data | Each recommendation cites the figures behind it |
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

Dev is setting up the app for the first time. The onboarding wizard walks him through five steps: budget groups, accounts, passive assets, income sources, and first CC import. He creates his budget — housing, food, transport, entertainment, subscriptions, savings — with monthly targets for each group. He adds his accounts: Wealthsimple (TFSA, RRSP, FHSA, non-registered, crypto), Desjardins (chequing, savings), Tangerine (CC, savings), plus a couple of US-dollar accounts.

Then the passive assets: his condo, his share of a business, his car. He enters current estimated values.

A month later, he logs a $120 grocery expense and links it to his Desjardins chequing account — the balance drops automatically. His pay deposit goes to the same account via an income entry with the account selected. He still updates his Wealthsimple TFSA and RRSP balances manually when he checks those apps. Adjusts the condo estimate after a comparable sold on his street.

**What this reveals:**
- Guided onboarding wizard for first-time setup
- Budget builder with category groups and monthly targets
- Account management (add/edit/remove, multiple types including FHSA, CAD/USD)
- Passive asset management (add/edit/remove, various asset classes)
- Manual balance entry remains available for all accounts
- Optional account link on expenses and income — when used, balances adjust automatically (subtract for expenses, add for income; liability-aware for credit cards)
- Simple, fast data entry — no friction on updates

### Journey 3: The Dashboard Glance

Dev opens the app mid-month just to check where things stand. The dashboard shows: budget status across all categories, total net worth with sparkline, year-to-date summary card, this month's income versus total expenses — the cash flow snapshot — a **Financial Health** summary card (emergency fund months, savings rate, next best action), and a maintenance alert badge showing his Civic is due for an oil change in 12 days. Lower on the page, **Top Categories by Spending** rounds out the glance. No clicks needed. He sees the number, closes the tab.

**What this reveals:**
- Dashboard as the landing page
- Net worth = sum of asset account balances + passive asset values **minus liability account balances** (credit cards and future liability types)
- Budget status at a glance (per category, overall)
- Income vs. expenses cash flow view
- Financial Health summary card for emergency fund, savings rate, and next-best action (links to Net Worth ▸ Financial Health)
- Maintenance alerts summary visible at a glance
- Zero-interaction read — everything visible without drilling in

### Journey 4: The CC Import Gone Wrong (Edge Case)

Dev uploads a CC statement screenshot but the image is blurry — taken at an angle. The AI extracts most transactions but flags three it can't read clearly. Dev sees the flagged items, manually enters them, and confirms. The system still saved him from entering the other 15 transactions by hand.

**What this reveals:**
- Graceful AI failure handling (partial extraction with flags)
- Manual entry fallback for unreadable items
- Error states that don't block the workflow

### Journey 5: The AI Chat Query

Dev wants to know how his restaurant spending this quarter compares to last quarter. Instead of navigating through expense views and doing mental math, he opens the AI chat and types: "How much did I spend on dining out in Q1 vs Q4 last year?"

The AI queries his data and responds with the breakdown. Dev follows up: "Am I spending more than I earn this month?" The AI pulls his recorded income and total expenses and responds: "You've spent 78% of this month's income with 10 days left. Your dining and entertainment categories are running hot — consider holding off on non-essentials." Dev then asks: "When is my Civic due for an oil change?" The AI responds with the due date and remaining mileage. Dev then says: "Add a $45 expense at Costco under Groceries for today from my Tangerine credit card." The AI confirms the details — including the optional linked account — and Dev approves the action. The expense is recorded and the card balance reflects the charge.

**What this reveals:**
- Natural language query interface for all financial data
- AI can answer comparative and analytical questions
- AI can answer maintenance schedule and due-date queries
- AI can perform write actions with user confirmation
- AI write actions can optionally specify a linked account (Phase 3 for chat; UI forms in MVP)
- Income-aware spending recommendations
- Conversational interaction as an alternative to UI navigation

### Journey 6: The Income Entry

It's payday. Dev opens nkbaz-finance and navigates to income. His salary source is already set up — "Employment – Employer Name." He enters this month's net amount: $4,250 (a bit higher than last month due to overtime) and selects his Desjardins chequing account. Confirms. His chequing balance increases by $4,250, the dashboard updates: income bar for the month, cash flow ratio refreshes, and the AI now knows exactly how much came in versus what went out.

Next month his pay is lower — back to the base $3,800. He updates accordingly, leaving the account unlinked this time because he already reconciled the balance manually. Over time, the app builds a complete picture of income variability alongside spending patterns.

**What this reveals:**
- Income source setup (name, type, recurring/variable)
- Monthly income entry with actual amounts
- Optional account link on income entries — when used, linked account balance increases automatically
- Income history over time
- Dashboard integration showing income vs. expenses
- AI context enrichment for recommendations

### Journey 7: The Car Maintenance Check-In

Dev registers his Honda Civic and Toyota RAV4 in the maintenance module — standalone vehicle records, separate from his passive asset entries. He enters each vehicle's make, model, year, and current odometer reading. The app pre-populates a default maintenance schedule: engine oil & filter, transmission fluid, brake fluid, coolant, tire rotation, air filters, spark plugs, suspension inspection, brake inspection, battery check, and wiper blades — each with industry-baseline km and month intervals.

He adjusts the Civic's oil change interval to match his owner's manual (10,000 km / 12 months instead of the default 8,000 km). A few weeks later, he opens the app and sees an amber alert on the dashboard: Civic oil change due in 11 days. At 495 km remaining, the alert persists until he gets the service done.

After the garage visit, Dev logs "Oil change completed" with today's date and odometer reading of 52,300 km — higher than the stored 51,850 km. The system updates the vehicle odometer to 52,300 km, shows a confirmation toast ("Odometer updated to 52,300 km based on service log"), and resets the oil change countdown.

**What this reveals:**
- Standalone vehicle registration (not linked to passive assets)
- Multi-vehicle independent schedules
- Default maintenance task templates with comprehensive fluid, filter, and inspection items
- Per-vehicle interval customization
- Manual odometer updates
- Service log entry with automatic odometer correction when log exceeds stored value
- User notification when odometer is auto-updated from a service log
- Dual-threshold evaluation (km or months, whichever comes first)
- In-app alerts at 500 km / 14 days before due and when overdue
- Dashboard surfacing of maintenance status

### Journey 8: Recurring Expenses & Financial Planning

Dev sets up recurring expense templates for his Netflix subscription and gym membership — merchant, amount, category, and day of month. Each time he opens the app, due recurring expenses auto-apply for the current month so his budget stays current without manual entry.

At year-end, he opens Year Summary to review total spending by category across the full year and compare monthly patterns. He checks Spending Trends to see whether restaurant spending climbed over the last 12 months. Curious about the future, he opens Net Worth Projection, sets growth assumptions for his TFSA/RRSP/FHSA, real estate, and vehicles, and views a 10-year forward projection based on his cash flow history.

Before leaving a coffee shop, he toggles "Hide values" in the sidebar so passersby can't read his net worth. He exports a database backup to an external drive for safekeeping.

**What this reveals:**
- Recurring expense template management
- Auto-apply recurring expenses on app launch
- Year-to-date and annual summary views
- Multi-month spending trend analysis
- Forward net worth projection with configurable assumptions
- Values privacy toggle
- Database backup/restore

### Journey 9: The Financial Health Check

Dev has been using nkbaz-finance for a few months — CC imports, income entries, and account balances are all current. He opens the new Financial Health view to figure out what to do with the cash piling up in his chequing account.

At the top: **Emergency Fund — "2.4 months of expenses."** His target is 6 months, so the progress ring sits amber at 40%. Below it, **Savings Capacity:** "You're averaging a $620 monthly surplus — a 14% savings rate. Your two largest discretionary categories are Dining Out and Subscriptions." Then the part he actually came for — **Next Best Action:** "Build your emergency fund. You have surplus cash, but less than three months of buffer. Prioritize topping up your savings before investing." A short "Why?" line explains it's computed from his liquid balances and trailing average expenses. No ticker symbols, no "buy this fund" — just the priority and the reasoning. A small footnote reminds him this is educational guidance, not professional financial advice.

A couple of months later his buffer crosses the 6-month mark. He opens the view again and the recommendation has shifted on its own: "Your emergency fund is funded. Next: contribute to your registered accounts (TFSA/RRSP/FHSA) before investing in non-registered accounts." Dev now knows the *category* of his next move — the specific picks remain his call.

When he carries a small statement balance on his credit card — $300 against ~$2,000 average monthly expenses — the app treats that as normal revolving use (within a 15% expense buffer) and does **not** block him on "pay down debt." A larger balance still surfaces step 2 until it is paid down or falls below the buffer.

**What this reveals:**
- Emergency fund coverage metric (liquid savings ÷ trailing average monthly expenses)
- Configurable emergency fund target with progress visualization
- Savings rate and average surplus/deficit calculation
- Top discretionary categories surfaced for "where to economize"
- Priority-waterfall next-best-action engine that adapts as finances change
- Revolving CC debt buffer — small statement balances (≤15% of trailing avg monthly expenses) do not block advancement past step 2
- Category-level, guardrailed guidance — no specific securities or products
- Plain-language reasoning ("Why?") behind each recommendation
- Educational-not-advice disclaimer
- Surfaced on both a dashboard summary card and a dedicated Financial Health view

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
| Optional account link on expenses/income | Journey 2, 6 |
| Automatic balance adjustment when linked | Journey 2, 5, 6 |
| Dashboard (budget + balances + net worth) | Journey 3 |
| Net worth = asset accounts + passive assets − liabilities | Journey 3 |
| Liability account types reduce net worth | Journey 2, 3 |
| Partial AI extraction + manual fallback | Journey 4 |
| AI chat for data queries | Journey 5 |
| AI chat for write actions with confirmation | Journey 5 |
| Income source setup | Journey 6 |
| Monthly income entry | Journey 6 |
| Income vs. expense dashboard view | Journey 3, 6 |
| Income-aware AI recommendations | Journey 5 |
| Vehicle registration for maintenance (standalone) | Journey 7 |
| Default maintenance task templates | Journey 7 |
| Per-vehicle interval customization | Journey 7 |
| Odometer tracking (manual + auto-update from service log) | Journey 7 |
| Service log with schedule reset | Journey 7 |
| In-app maintenance alerts (approaching + overdue) | Journey 3, 7 |
| Maintenance status and history per vehicle | Journey 7 |
| AI chat for maintenance queries | Journey 5, 7 |
| Dashboard maintenance alerts summary | Journey 3, 7 |
| Onboarding wizard | Journey 2 |
| Recurring expense templates | Journey 8 |
| Auto-apply recurring expenses | Journey 8 |
| Spending trends (multi-month) | Journey 8 |
| Year summary / YTD | Journey 3, 8 |
| Net worth projection | Journey 8 |
| Values privacy hide/show | Journey 8 |
| Database backup/restore | Journey 8 |
| Import duplicate detection | Journey 1, 4 |
| Merchant category hint learning | Journey 1 |
| Multi-currency accounts (CAD/USD) | Journey 2 |
| FHSA account type | Journey 2 |
| Emergency fund coverage metric | Journey 9 |
| Configurable emergency fund target | Journey 9 |
| Savings rate / surplus calculation | Journey 9 |
| Discretionary category surfacing | Journey 9 |
| Priority-waterfall next-best-action | Journey 9 |
| CC debt buffer for revolving balances | Journey 9 |
| Guardrailed category-level guidance | Journey 9 |
| Plain-language recommendation reasoning | Journey 9 |
| Financial Health dashboard card | Journey 3, 9 |

## Product Scope

### MVP (Phase 1)

**MVP Approach:** Problem-solving MVP — deliver the complete financial tracking replacement for Google Sheets. Core capabilities ship together because they form an interdependent system. Car maintenance tracking (capability #10) is specified but not yet implemented in codebase as of 2026-05-29.

**Resource Requirements:** Solo developer. No external dependencies beyond Strand SDK and AWS Bedrock.

**Must-Have Capabilities:**
1. **Monthly Budget Builder** — create/manage budgets with customizable category groups and targets
2. **AI-Powered CC Import** — upload screenshot/PDF, auto-extract and categorize transactions, duplicate detection, merchant hint learning
3. **Expense Tracking** — view, review, correct auto-categorized expenses; manual entry as fallback; optional account link with automatic balance adjustment; recurring expense templates with auto-apply
4. **Multi-Account Tracking** — track balances across multiple banks and account types (chequing, savings, credit card, TFSA, RRSP, FHSA, non-registered, crypto) in CAD or USD; balances updatable manually or via linked expenses/income
5. **Passive Asset Tracking** — track value of business, real estate, vehicles, other assets
6. **Dashboard** — budget status, spending by category, account balances, net worth sparkline, YTD card, cash flow, Financial Health summary card, maintenance alerts
7. **Net Worth History** — historical tracking split by category (cash, crypto, housing, TFSA, RRSP, FHSA, etc.)
8. **Financial Analytics** — spending trends (3/6/12 months), year summary, forward net worth projection
9. **AI Chat** — natural language queries and actions across all financial data
10. **Income Tracking** — set up income sources, record monthly income amounts with optional account link, view income history and cash flow (income vs. expenses)
11. **Car Maintenance Tracking** — register multiple vehicles (standalone entities), track odometer and service history, pre-populated maintenance task templates with editable intervals, in-app alerts when service is approaching or overdue *(specified, not yet implemented)*
12. **Onboarding Wizard** — guided first-run setup across budget, accounts, assets, income, and import
13. **Application Platform** — database backup/restore, values privacy toggle, EN/FR localization, light/dark/system theme, OS keychain AI credentials, auto-update check
14. **Financial Decision Intelligence** — emergency-fund health (months of runway vs. configurable target), savings-capacity analysis (savings rate, surplus, top discretionary categories), and a guardrailed priority-waterfall next-best-action engine (emergency fund → high-interest debt → registered accounts → invest surplus), surfaced on a dashboard card and a dedicated Financial Health section under Net Worth; guidance is category-level and educational only; CC debt buffer for normal revolving balances *(implemented 2026-06)*

**Related Deliverable (separate app):** Marketing website (`apps/web`) — landing page, download CTA, feature showcase, FAQ. Not part of desktop MVP but ships alongside the product.

Single-user only. No authentication required for MVP.

### Phase 2 (Growth)

- Multi-user authentication with isolated accounts for friends/family
- Bank API integrations for automatic balance syncing
- Cross-platform support (Windows, Linux) and/or mobile companion app

### Phase 3 (Expansion)

- Conversational AI advisor — AI chat reasons over the Financial Decision Intelligence metrics (emergency fund, savings rate, waterfall) to answer questions like "should I invest my surplus?" with grounded, non-prescriptive responses (deferred from MVP capability #14, which ships the deterministic engine and surfaces only)
- Smart insights — AI-driven spending-pattern analysis and anomaly detection
- Contribution-room-aware guidance — user-entered or tracked TFSA/RRSP/FHSA room feeding the waterfall recommendation (MVP ships generic registered-vs-non-registered guidance only; step 3 remains current while trailing surplus > 0)
- Additional liability account types — lines of credit, personal loans, mortgages (MVP: `credit_card` only, via shared `LIABILITY_ACCOUNT_TYPES`)
- Goal-based planning — set a target (e.g. "6-month fund by December") and track/coach toward it
- Automatic recurring expense detection from import history (distinct from user-defined recurring templates in MVP)
- Recurring expense templates with default linked account (MVP auto-applied recurring expenses remain unlinked)
- CC import bulk insert with account assignment (imported transactions remain unlinked in MVP)
- AI chat write actions with optional `account_id` on expense/income creation (UI forms ship first)
- Export/reporting capabilities
- Additional AI agent personalities beyond Budget Helper
- OpenAI as full runtime provider for chat and CC import (credentials UI exists; Bedrock required today)

### Risk Mitigation

**Technical Risks:** AI parsing accuracy is the single highest-risk item. Mitigation: manual entry fallback exists for every transaction. The app is useful even if AI accuracy starts below 95% — it still saves time vs. full manual entry.

**Maintenance Schedule Data Source:** Default task intervals require an architect decision — embedded industry-baseline library (MVP candidate) vs. manufacturer-specific lookup (Phase 2). User overrides per vehicle must work regardless of source. Owner's manual intervals supersede dealership upsell packages.

**Implementation Gaps (PRD vs. Codebase, 2026-05-29):** Car maintenance module (FR49-FR61) is specified but not implemented. Multi-agent AI infrastructure exists with one agent (`budget-helper`) shipped — FR41-FR43 partially met. OpenAI credentials can be stored but chat and import require AWS Bedrock at runtime.

**Market Risks:** N/A — personal project, no market validation needed.

**Resource Risks:** Solo developer. All MVP features are scoped as minimal implementations. Budget builder, account/asset tracking, and car maintenance are straightforward CRUD. The AI integration is the only complex piece.

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

### Maintenance Alert Evaluation

- Maintenance alert status evaluates on app launch and when a vehicle odometer is updated or a service is logged
- In-app alerts only for MVP — no OS-level push notifications
- Alert placement and visual treatment deferred to UX design workflow (dashboard card, sidebar badge, or dedicated Maintenance view)

### Localization & Theming

- Application supports English and French via i18n resource files
- User can switch theme: light, dark, or system preference
- Language and theme accessible from application sidebar

### Application Lifecycle

- System checks for application updates on launch (Tauri updater)
- User can export and import full SQLite database backup via native file dialogs
- User can hide/show all monetary values app-wide for privacy (sidebar toggle, persisted)

### AI Provider Configuration

- User can store AI provider credentials in OS keychain (AWS Bedrock access key/secret/region, OpenAI API key)
- Credentials managed via Settings → AI Provider page
- MVP runtime: CC import and AI chat execute via AWS Bedrock; OpenAI credential storage exists for future use

### Implementation Considerations

- Native file dialog (Tauri `dialog.open()`) for CC screenshots (image) and PDFs, with drag-and-drop as alternative
- Async job pattern for AI parsing — Rust backend submits to AI service, streams progress via Tauri events to frontend
- Client-side state management for budget views, account lists, and dashboard data
- Client-side routing within the Tauri webview (dashboard, budget, income, recurring, accounts, assets, net worth, spending trends, year summary, projection, import, maintenance, settings, chat)
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
- FR72: System can detect potential duplicate transactions during import when merchant, date, and amount match an existing expense
- FR73: System can learn merchant-to-category mappings from confirmed imports to improve future categorization accuracy

### Expense Tracking

- FR11: User can view all expenses for a given month, grouped by budget category
- FR12: User can manually add an expense entry (merchant, amount, category, date, optional account)
- FR13: User can edit or delete an existing expense
- FR14: User can manually enter transactions that the AI failed to extract
- FR63: User can create recurring expense templates with merchant, amount, category, and day of month
- FR64: User can edit, activate, deactivate, or delete recurring expense templates
- FR65: System auto-applies due recurring expenses on app launch for the current month
- FR66: User can manually trigger application of due recurring expenses from the Recurring Expenses view

### Transaction-Account Linking

- FR90: User can optionally link an expense or income entry to an account when creating or editing; account selection is never required and entries without a linked account behave as they do today
- FR91: When an expense is linked to an account, system automatically adjusts that account's balance by subtracting the expense amount; for liability accounts (credit cards in MVP), owed balance increases using the same positive/negative sign convention as manual balance entry (FR17)
- FR92: When an income entry is linked to an account, system automatically adjusts that account's balance by adding the income amount; for liability accounts (credit cards in MVP), owed balance decreases (e.g., card payments reduce debt)
- FR93: When a linked expense or income entry is edited, system atomically reverses the previous balance adjustment and applies the new adjustment in a single transaction
- FR94: When a linked expense or income entry is deleted, system reverses the balance adjustment on the linked account

**Implementation notes:** Architecture decisions in [architecture-expense-income-account-linking.md](architecture-expense-income-account-linking.md). Net worth snapshots (FR26) record after balance mutations. Recurring auto-apply, CC import, and AI chat write actions remain unlinked in MVP (see Phase 3).

### Account Management

- FR15: User can add a financial account with a name, institution, type (chequing, savings, credit card, TFSA, RRSP, FHSA, non-registered, crypto), and currency (CAD or USD)
- FR16: User can edit or remove an existing account
- FR17: User can update the current balance of any account
- FR18: User can view all accounts and their current balances in a single list, grouped by type with **liability account types** (credit cards in MVP) separated from assets; owed balances on liability accounts reduce net worth rather than increase it
- FR80: User can hold accounts in CAD or USD; net worth calculations handle mixed-currency portfolios (liability balances subtracted at stored cents — same mixed-currency limitation as assets)

### Income Management

- FR33: User can add an income source with a name and type (employment, freelance, investment, other)
- FR34: User can edit or remove an existing income source
- FR35: User can record a monthly income entry for a source with the amount received, date, and optional linked account
- FR36: User can view income history by source and by month
- FR37: User can view total income for the current month

### Passive Asset Tracking

- FR19: User can add a passive asset (real estate, vehicle, business ownership, etc.) with a name, type, and estimated value
- FR20: User can edit or remove an existing passive asset
- FR21: User can update the estimated value of any passive asset

### Dashboard

- FR22: User can view a dashboard showing budget status across all categories for the current month
- FR23: User can view total net worth on the dashboard: sum of asset account balances (chequing, savings, investment accounts) plus passive asset values **minus** liability account balances (credit cards in MVP)
- FR24: User can view spending breakdown by category on the dashboard
- FR25: User can view all account balances on the dashboard
- FR38: User can view income versus total expenses for the current month on the dashboard
- FR62: User can view a maintenance alerts summary on the dashboard showing the count of approaching and overdue items across all vehicles
- FR81: User can view a year-to-date summary card on the dashboard linking to the full year summary view

### Net Worth History

- FR26: System can record a net worth snapshot each time account balances or asset values change; snapshots subtract liability account balances from total and exclude liabilities from category breakdown
- FR27: User can view net worth history over time as a trend
- FR28: User can view net worth breakdown by category (cash, crypto, housing, TFSA, RRSP, FHSA, etc.); liability accounts are not included as positive breakdown categories

### Financial Analytics

- FR67: User can view spending trends over 3, 6, or 12 months with total spending chart and category breakdown table
- FR68: User can view year summary for a selected year with annual metrics, monthly spending chart, and category totals
- FR69: User can view forward net worth projection over 6 months to 20 years with configurable growth assumptions per asset category and cash flow history

### Onboarding

- FR70: System guides new users through a multi-step onboarding wizard (budget, accounts, assets, income, import)
- FR71: System redirects users to onboarding when no budget groups exist

### AI Chat

- FR29: User can ask natural language questions about any data in the system (budgets, expenses, income, accounts, assets, net worth history, vehicle maintenance schedules)
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

### Car Maintenance Management

- FR49: User can register a vehicle for maintenance tracking as a standalone entity (nickname, make, model, year, current odometer) — not linked to passive assets
- FR50: User can manage multiple vehicles with independent maintenance schedules
- FR51: System provides default maintenance task templates with industry-baseline intervals (km and months), including: engine oil & filter, transmission fluid, brake fluid, coolant, differential/transfer case fluid, power steering fluid, tire rotation, tire inspection, brake inspection, engine air filter, cabin air filter, spark plugs, suspension/steering inspection, battery check, and wiper blades
- FR52: User can customize the interval (km and/or months) for any maintenance task on any vehicle
- FR53: User can manually update the current odometer reading for a vehicle
- FR54: User can log a completed maintenance event (task, date, odometer at service)
- FR55: System recalculates next due date and mileage for a task after a service is logged
- FR56: When a logged service odometer exceeds the vehicle's stored odometer, system updates the vehicle odometer to the higher value and notifies the user
- FR57: System evaluates maintenance due status using whichever threshold comes first — km or time
- FR58: System displays in-app alerts when a maintenance task is within 500 km or 14 days of due, or overdue
- FR59: User can view maintenance status (upcoming, due, overdue) and service history per vehicle
- FR60: User can query maintenance schedules and due dates via AI chat
- FR61: System can answer maintenance data queries with accurate, up-to-date information from the database

**Architecture dependency:** FR51 default intervals require architect investigation to determine data source (embedded baseline library vs. external manufacturer lookup). FR52 user overrides must function regardless of the chosen source.

### Application Platform

- FR74: User can export a full database backup to a file via native save dialog
- FR75: User can import a database backup from a file via native open dialog, replacing current data
- FR76: User can hide or show all monetary values app-wide via a sidebar toggle (persisted across sessions)
- FR77: User can switch application language between English and French
- FR78: User can switch application theme between light, dark, and system preference
- FR79: User can configure and test AI provider credentials stored in the OS keychain (AWS Bedrock, OpenAI)
- FR82: System checks for application updates on launch and notifies the user when an update is available

### Financial Decision Intelligence

- FR83: System calculates the user's emergency fund coverage as liquid savings (chequing + savings account balances) divided by trailing average monthly expenses, expressed as months of runway
- FR84: User can set an emergency fund target in months (with 3–6 months suggested as guidance) and view progress toward that target
- FR85: System calculates the user's monthly savings rate ((income − expenses) ÷ income) and trailing-period average surplus/deficit, and surfaces the largest discretionary spending categories reducing savings capacity
- FR86: System evaluates the user's finances against a fixed priority waterfall — (1) build emergency fund, (2) pay down high-interest debt, (3) contribute to registered accounts (TFSA/RRSP/FHSA) before non-registered, (4) invest surplus — and recommends the single next-best-action category for the user's surplus cash. **MVP rules:** step 2 uses liability account balances (`credit_card` in MVP); step 2 is considered complete when total owed CC balance is zero **or** at/below **15% of trailing average monthly expenses** (revolving-statement buffer); step 3 is current while trailing monthly surplus > 0 (no contribution-room tracking); step 4 is current when steps 1–2 are complete and surplus ≤ 0
- FR87: System presents all guidance as category-level recommendations with plain-language reasoning tied to the user's data, and never recommends specific securities or financial products, nor guarantees returns
- FR88: User can open a dedicated Financial Health section under Net Worth (section sub-nav: Net Worth · Financial Health) showing emergency fund status, savings-capacity trend, and the prioritized action waterfall with explanations
- FR89: User can view a Financial Health summary card on the dashboard showing emergency fund coverage, savings rate, and the current next-best action; card appears above Top Categories by Spending and links to Net Worth ▸ Financial Health

**Guardrail:** FR86 ships generic registered-vs-non-registered guidance only; contribution-room awareness (user-entered or tracked TFSA/RRSP/FHSA limits) is deferred to Phase 3. Step 3 remains the current recommendation while trailing monthly surplus > 0 — the app cannot detect when registered room is fully used. Step 4 ("invest surplus") applies when steps 1–2 are complete and trailing surplus ≤ 0. Liability owed balances use `ABS(balance_cents)` so users may enter positive or negative amounts in the Accounts UI. The conversational AI advisor that reasons over these metrics in chat is Phase 3 — MVP delivers the deterministic engine plus dashboard card and Financial Health section.

## Non-Functional Requirements

### Performance

- NFR1: Dashboard loads and renders all data (budget status, account balances, net worth, Financial Health card) within 1 second on subsequent visits
- NFR2: Navigation between views within the desktop app completes instantly (no perceptible delay)
- NFR3: CC statement import provides progress feedback within 2 seconds of upload
- NFR4: AI parsing and categorization completes within 30 seconds for a typical CC statement (15-25 transactions)
- NFR5: AI chat responses return within 5 seconds for data queries

### Security

- NFR6: Financial data is stored encrypted at rest
- NFR7: All communication with external AI services uses HTTPS
- NFR8: File uploads are validated for type (image/PDF only) and size (maximum 20 MB) before processing

### Integration

- NFR9: System gracefully handles Strand SDK / AWS Bedrock service unavailability with clear error messaging
- NFR10: AI parsing failures do not block the user from manually entering transactions

### Data Integrity

- NFR11: Financial records (transactions, balances, net worth snapshots) are never silently lost or corrupted
- NFR12: Database supports backup and restore capability via user-initiated export/import (FR74, FR75)
- NFR13: Balance and net worth calculations are accurate to the cent; liability account balances subtract from net worth at face value (absolute owed amount)
- NFR23: Linked expense and income mutations (FR90–FR94) apply the transaction row and account balance adjustment atomically in a single database transaction — the two never diverge on partial failure

### Maintenance Alerts

- NFR14: Maintenance alert status evaluates within 1 second of app launch
- NFR15: Odometer auto-update from service log (FR56) completes within 1 second and displays user notification before the user navigates away

### Localization & Accessibility

- NFR16: All user-facing strings are available in English and French with no missing translation keys in shipped views
- NFR17: Values privacy toggle (FR76) applies to all monetary displays app-wide within 100ms of toggle

### Application Lifecycle

- NFR18: Auto-update check completes within 5 seconds of app launch without blocking dashboard render

### Financial Decision Intelligence

- NFR19: Financial Decision Intelligence recommendations are computed deterministically from stored user data (rule-based) — identical inputs always produce identical output; no generative or probabilistic model decides recommendations
- NFR20: Every recommendation is traceable to the underlying figures that produced it, and those figures are inspectable by the user
- NFR21: Financial Health calculations complete and render within 1 second on dashboard load and recalculate when account balances or expenses change
- NFR22: The Financial Health view and dashboard card display a disclaimer that guidance is educational and not professional financial advice
