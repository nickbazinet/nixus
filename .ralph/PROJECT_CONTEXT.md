# nkbaz-finance — Project Context

## Project Goals

nkbaz-finance is a personal finance desktop application (built with Tauri) that replaces manual spreadsheet tracking with an automation-first approach. Users build monthly budgets with grouped categories, track expenses across multiple accounts, monitor passive assets, and view net worth history over time — all in a single interface. Users set up income sources and record monthly earnings, enabling a complete cash flow picture — income versus expenses — that powers smarter AI recommendations. The core workflow is built around AI-powered credit card statement import: users upload a screenshot or PDF, and the system auto-categorizes transactions using Strand SDK and AWS Bedrock. An AI chat interface provides natural language access to all financial data and operations. Built for personal use as a single-user, local-first desktop application.

The product solves a specific failure mode: financial tracking tools die when they demand effort. Spreadsheets work until the maintenance burden causes people to stop updating them. nkbaz-finance eliminates that friction by automating the most tedious part — data entry and categorization — starting with the highest-impact touchpoint (bi-weekly CC statements).

### What Makes This Special

- **Automation-first philosophy** — the product's core promise is removing manual effort. CC statement parsing via AI is the entry point, not a feature bolted on later.
- **Complete financial picture in one place** — budgeting, expense tracking, multi-account balances, passive assets (real estate, business, vehicles), and net worth history by category (cash, crypto, housing, TFSA, RRSP). No juggling separate tools.
- **Pragmatic automation path** — screenshot/PDF upload over bank API integration. Easier to build, no third-party dependencies, accessible to any user who can take a photo. Bank APIs come later as an expansion of the automation model.
- **AI-native interaction** — conversational interface for querying and managing financial data, plus automated CC parsing. AI is woven into the product, not bolted on.
- **Cash flow visibility** — income tracking alongside expenses gives the AI full financial context for meaningful recommendations, not just spending data in isolation.
- **Built from real pain** — designed from the builder's own failed spreadsheet workflow, not theoretical user research.

## Success Metrics

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

## Scope Boundaries

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

## Design Guidelines

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
