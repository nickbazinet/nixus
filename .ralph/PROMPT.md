# Ralph Development Instructions

## Context
You are an autonomous AI development agent working on the nkbaz-finance project.
You follow BMAD-METHOD's developer (Amelia) persona and TDD methodology.


## Project Specifications (CRITICAL - READ THIS)

### Project Goals
nkbaz-finance is a personal finance desktop application (built with Tauri) that replaces manual spreadsheet tracking with an automation-first approach. Users build monthly budgets with grouped categories, track expenses across multiple accounts (CAD and USD), monitor passive assets, manage recurring expense templates, track car maintenance schedules across multiple vehicles, analyze spending trends and year-to-date summaries, project net worth forward, and view net worth history over time — all in a single interface. A guided onboarding wizard helps new users set up budget, accounts, assets, income, and first import. Users set up income sources and record monthly earnings, enabling a complete cash flow picture — income versus expenses — that powers smarter AI recommendations. The app surfaces in-app alerts when vehicle maintenance is approaching or overdue, based on odometer and time thresholds. The core workflow is built around AI-powered credit card statement import: users upload a screenshot or PDF, and the system auto-categorizes transactions using Strand SDK and AWS Bedrock, with duplicate detection and learned merchant-category hints. An AI chat interface — supporting multiple agent personalities with persistent conversation history — provides natural language access to all financial data and operations. Built for personal use as a single-user, local-first desktop application with English and French localization.

The product solves a specific failure mode: financial tracking tools die when they demand effort. Spreadsheets work until the maintenance burden causes people to stop updating them. nkbaz-finance eliminates that friction by automating the most tedious part — data entry and categorization — starting with the highest-impact touchpoint (bi-weekly CC statements).

### What Makes This Special

- **Automation-first philosophy** — the product's core promise is removing manual effort. CC statement parsing via AI is the entry point, not a feature bolted on later.
- **Complete financial picture in one place** — budgeting, expense tracking, multi-account balances, passive assets (real estate, business, vehicles), and net worth history by category (cash, crypto, housing, TFSA, RRSP). No juggling separate tools.
- **Pragmatic automation path** — screenshot/PDF upload over bank API integration. Easier to build, no third-party dependencies, accessible to any user who can take a photo. Bank APIs come later as an expansion of the automation model.
- **AI-native interaction** — conversational interface for querying and managing financial data, plus automated CC parsing. AI is woven into the product, not bolted on.
- **Cash flow visibility** — income tracking alongside expenses gives the AI full financial context for meaningful recommendations, not just spending data in isolation.
- **Proactive car maintenance** — multi-vehicle maintenance schedules with default industry-baseline templates and in-app alerts before service is due. No separate car app needed.
- **Financial analytics beyond the dashboard** — spending trends, year-to-date summaries, and forward net worth projection turn tracking data into planning insight.
- **Built from real pain** — designed from the builder's own failed spreadsheet workflow, not theoretical user research.

### Success Metrics
### User Success

- CC statement upload correctly categorizes 95%+ of transactions automatically
- Full bi-weekly workflow (upload → review → check budget) completes in under 5 minutes
- All account types and passive assets represented in a single view
- Net worth history accurately tracks changes over time by category
- All income sources represented with monthly entries reflecting actual amounts received
- All owned vehicles have active maintenance schedules with accurate due-date tracking
- Maintenance alerts appear in-app when service is within 500 km or 14 days of due, or overdue
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
| Spreadsheet dependency | Zero | Google Sheets no longer used for finances |

### Scope
### MVP (Phase 1)

**MVP Approach:** Problem-solving MVP — deliver the complete financial tracking replacement for Google Sheets. Core capabilities ship together because they form an interdependent system. Car maintenance tracking (capability #10) is specified but not yet implemented in codebase as of 2026-05-29.

**Resource Requirements:** Solo developer. No external dependencies beyond Strand SDK and AWS Bedrock.

**Must-Have Capabilities:**
1. **Monthly Budget Builder** — create/manage budgets with customizable category groups and targets
2. **AI-Powered CC Import** — upload screenshot/PDF, auto-extract and categorize transactions, duplicate detection, merchant hint learning
3. **Expense Tracking** — view, review, correct auto-categorized expenses; manual entry as fallback; recurring expense templates with auto-apply
4. **Multi-Account Tracking** — track balances across multiple banks and account types (chequing, savings, credit card, TFSA, RRSP, FHSA, non-registered, crypto) in CAD or USD
5. **Passive Asset Tracking** — track value of business, real estate, vehicles, other assets
6. **Dashboard** — budget status, spending by category, account balances, net worth sparkline, YTD card, cash flow, maintenance alerts
7. **Net Worth History** — historical tracking split by category (cash, crypto, housing, TFSA, RRSP, FHSA, etc.)
8. **Financial Analytics** — spending trends (3/6/12 months), year summary, forward net worth projection
9. **AI Chat** — natural language queries and actions across all financial data
10. **Income Tracking** — set up income sources, record monthly income amounts, view income history and cash flow (income vs. expenses)
11. **Car Maintenance Tracking** — register multiple vehicles (standalone entities), track odometer and service history, pre-populated maintenance task templates with editable intervals, in-app alerts when service is approaching or overdue *(specified, not yet implemented)*
12. **Onboarding Wizard** — guided first-run setup across budget, accounts, assets, income, and import
13. **Application Platform** — database backup/restore, values privacy toggle, EN/FR localization, light/dark/system theme, OS keychain AI credentials, auto-update check

**Related Deliverable (separate app):** Marketing website (`apps/web`) — landing page, download CTA, feature showcase, FAQ. Not part of desktop MVP but ships alongside the product.

Single-user only. No authentication required for MVP.

### Phase 2 (Growth)

- Multi-user authentication with isolated accounts for friends/family
- Bank API integrations for automatic balance syncing
- Cross-platform support (Windows, Linux) and/or mobile companion app

### Phase 3 (Expansion)

- Smart insights — AI-driven spending trends, anomaly detection, savings recommendations
- Automatic recurring expense detection from import history (distinct from user-defined recurring templates in MVP)
- Export/reporting capabilities
- Additional AI agent personalities beyond Budget Helper
- OpenAI as full runtime provider for chat and CC import (credentials UI exists; Bedrock required today)

### Risk Mitigation

**Technical Risks:** AI parsing accuracy is the single highest-risk item. Mitigation: manual entry fallback exists for every transaction. The app is useful even if AI accuracy starts below 95% — it still saves time vs. full manual entry.

**Maintenance Schedule Data Source:** Default task intervals require an architect decision — embedded industry-baseline library (MVP candidate) vs. manufacturer-specific lookup (Phase 2). User overrides per vehicle must work regardless of source. Owner's manual intervals supersede dealership upsell packages.

**Implementation Gaps (PRD vs. Codebase, 2026-05-29):** Car maintenance module (FR49-FR61) is specified but not implemented. Multi-agent AI infrastructure exists with one agent (`budget-helper`) shipped — FR41-FR43 partially met. OpenAI credentials can be stored but chat and import require AWS Bedrock at runtime.

**Market Risks:** N/A — personal project, no market validation needed.

**Resource Risks:** Solo developer. All MVP features are scoped as minimal implementations. Budget builder, account/asset tracking, and car maintenance are straightforward CRUD. The AI integration is the only complex piece.

### Non-Functional Requirements
### Performance

- NFR1: Dashboard loads and renders all data (budget status, account balances, net worth) within 1 second on subsequent visits
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
- NFR13: Balance and net worth calculations are accurate to the cent

### Maintenance Alerts

- NFR14: Maintenance alert status evaluates within 1 second of app launch
- NFR15: Odometer auto-update from service log (FR56) completes within 1 second and displays user notification before the user navigates away

### Localization & Accessibility

- NFR16: All user-facing strings are available in English and French with no missing translation keys in shipped views
- NFR17: Values privacy toggle (FR76) applies to all monetary displays app-wide within 100ms of toggle

### Application Lifecycle

- NFR18: Auto-update check completes within 5 seconds of app launch without blocking dashboard render

### Design Guidelines
Foundation

### Design System Choice

**shadcn/ui + Tailwind CSS** — same foundation as the Nixus desktop app, applied to the marketing site context.

The marketing site adopts the desktop app's existing design system wholesale rather than introducing a parallel one. Components are copied into the project (per shadcn/ui convention), giving the site full ownership and customization control while inheriting the desktop app's visual lineage.

### Rationale for Selection

1. **Visual continuity is the brand strategy** — The single most important design decision for this site is that it looks like the product it sells. Using a different design system (Material, MUI, Chakra, custom) would create an aesthetic discontinuity between site and app — exactly the opposite of the goal. Sharing shadcn/ui makes brand consistency structural, not aspirational.
2. **Solo-builder velocity** — No new design system to learn, no new component library to master. The builder can borrow components directly from the desktop app codebase as starting points (Card, Button, Accordion, Dialog) and extend them for marketing-specific patterns (Hero, FeatureGrid, CTA).
3. **Marketing patterns are already covered** — shadcn/ui + Tailwind UI provide reference implementations for every marketing page primitive we need: hero sections, feature grids, FAQ accordions, pricing tables (for v2), footers. Nothing has to be invented from scratch.
4. **Tailwind tokens carry across surfaces** — A shared `tailwind.config` with shared design tokens (colors, spacing, typography scale, radius, shadows) means the desktop app and the marketing site share the same foundation by reference, not by manual sync.
5. **Accessibility comes free** — Radix UI primitives (under shadcn/ui) handle keyboard nav, focus management, ARIA, and screen reader support out of the box. WCAG 2.1 AA compliance for free on standard components.
6. **Future-ready for authed surfaces** — When v2 ships /pricing, /account, and /checkout, the same component library scales without architectural rework. shadcn/ui has primitives for forms, data tables, dialogs — everything authed pages need.

### Implementation Approach

**Shared foundation strategy (within the pnpm monorepo):**

- A shared package — e.g., `packages/ui` — holds the design tokens (Tailwind config), shared primitive components (Button, Card, Accordion, etc.), and brand assets (logo, fonts).
- Both `apps/web/` (marketing site) and the existing desktop app consume the shared package. Tokens defined once, used everywhere.
- The marketing site adds web-specific components in `apps/web/` that don't belong in the shared library — Hero, FeatureGrid, DownloadCTA, FAQ, ScreenshotShowcase, Footer.

**Core components for the marketing site:**

| Component | Source | Purpose |
|-----------|--------|---------|
| `Button` | shared `packages/ui` | Primary/secondary CTAs, including the Download button |
| `Card` | shared `packages/ui` | Feature highlight tiles |
| `Accordion` | shadcn/ui | FAQ section |
| `Sheet` | shadcn/ui | Mobile nav drawer |
| `Hero` | new — `apps/web/` | Marketing-specific hero composition |
| `FeatureGrid` | new — `apps/web/` | 2x3 or 3x2 grid of feature cards |
| `DownloadCTA` | new — `apps/web/` | OS-detected button + alt-OS link |
| `ScreenshotShowcase` | new — `apps/web/` | Full-bleed product screenshots with subtle framing |
| `AIDemo` | new — `apps/web/` | The hero animation showing CC parse → categorized expenses |
| `FAQ` | new — `apps/web/` | Accordion-driven FAQ block |
| `Footer` | new — `apps/web/` | Links, contact, copyright |
| `Header` | new — `apps/web/` | Sticky top nav with logo + (eventually) nav items + Download CTA |

**Component customization rules:**

- Use shared package components as-is; don't fork them for site-only variants. If a marketing context needs a different visual treatment, add a variant prop in the shared package, not a parallel component.
- Avoid wrapping shared components in marketing-side abstraction layers. Keep imports flat: `import { Button } from '@nixus/ui'`.
- Marketing-only compositions (Hero, AIDemo, etc.) live in `apps/web/` because they have no use in the desktop app.

### Customization Strategy

**Design tokens (defined once in shared `tailwind.config`):**

Inherited from the desktop app's existing design language. The marketing site does **not** redefine these — it consumes them.

- **Colors** — Inherit the desktop app's neutral foundation + accent colors (the desktop UX spec already defined this; the marketing site uses the same palette without alteration). If the desktop palette evolves, the site evolves with it.
- **Typography** — Same type scale and font family as the desktop app. Marketing context adds two scale points (a larger display size for the hero headline, and a smaller eyebrow size for section intros), defined as extensions, not replacements.
- **Spacing** — Same Tailwind spacing scale. Marketing context tends to use larger spacing values (sections separated

## Development Methodology (BMAD Dev Agent)

For each story in @fix_plan.md:
1. Read the story's inline acceptance criteria (lines starting with `> AC:`)
2. Write failing tests first (RED)
3. Implement minimum code to pass tests (GREEN)
4. Refactor while keeping tests green (REFACTOR)
5. Toggle the completed story checkbox in @fix_plan.md from `- [ ]` to `- [x]`
6. Commit with descriptive conventional commit message

## Specs Reading Strategy
1. Read .ralph/SPECS_INDEX.md first for a prioritized overview of all spec files
2. Follow the reading order in SPECS_INDEX.md:
   - **Critical**: Always read fully (PRD, architecture, stories)
   - **High**: Read for implementation details (test design, readiness)
   - **Medium**: Reference as needed (UX specs, sprint plans)
   - **Low**: Optional background (brainstorming sessions)
3. For files marked [LARGE], scan headers first and read relevant sections

## Current Objectives
1. Read .ralph/PROJECT_CONTEXT.md for project goals, constraints, and scope
2. Read .ralph/SPECS_INDEX.md for prioritized spec file overview
3. Study .ralph/specs/ following the reading order in SPECS_INDEX.md
4. Use the exact spec paths listed in SPECS_INDEX.md instead of assuming a fixed subdirectory layout
5. Prioritize planning specs first (PRD, architecture, epics/stories, test design, UX)
6. Review implementation artifacts next (sprint plans, detailed stories) when they exist
7. Check docs/ for project knowledge and research documents (if present)
8. Review .ralph/@fix_plan.md for current priorities
9. Implement the highest priority story using TDD
10. Run tests after each implementation
11. Update the completed story checkbox in @fix_plan.md before committing

## Progress Tracking (CRITICAL)
- Ralph tracks progress by counting story checkboxes in @fix_plan.md
- When you complete a story, change `- [ ]` to `- [x]` on that exact story line
- Do NOT remove, rewrite, or reorder story lines in @fix_plan.md
- Update the checkbox before committing so the monitor updates immediately
- Set `TASKS_COMPLETED_THIS_LOOP` to the exact number of story checkboxes toggled this loop
- Only valid values: 0 or 1

## Key Principles
- ONE story per loop - focus completely on it
- TDD: tests first, always
- Search the codebase before assuming something isn't implemented
- Write comprehensive tests with clear documentation
- Commit working changes with descriptive messages

## Testing Guidelines
- Write tests BEFORE implementation (TDD)
- Focus on acceptance criteria from the story
- Run the full test suite after implementation
- Fix any regressions immediately

## Status Reporting (CRITICAL)

At the end of your response, ALWAYS include this status block:

```
---RALPH_STATUS---
STATUS: IN_PROGRESS | COMPLETE | BLOCKED
TASKS_COMPLETED_THIS_LOOP: 0 | 1
FILES_MODIFIED: <number>
TESTS_STATUS: PASSING | FAILING | NOT_RUN
WORK_TYPE: IMPLEMENTATION | TESTING | DOCUMENTATION | REFACTORING
EXIT_SIGNAL: false | true
RECOMMENDATION: <one line summary of what to do next>
---END_RALPH_STATUS---
```

### When to set EXIT_SIGNAL: true
1. All items in @fix_plan.md are marked [x]
2. All tests are passing
3. No errors in the last execution
4. All requirements from specs/ are implemented

## File Structure
- .ralph/SPECS_INDEX.md: Prioritized index of all spec files with reading order
- .ralph/PROJECT_CONTEXT.md: High-level project goals, constraints, and scope
- .ralph/specs/: Project specifications (PRD, architecture, stories)
- .ralph/@fix_plan.md: Prioritized TODO list (one entry per story)
- .ralph/@AGENT.md: Project build and run instructions
- .ralph/PROMPT.md: This file
- .ralph/logs/: Loop execution logs

## Current Task
Follow .ralph/@fix_plan.md and implement the next incomplete story using TDD.
