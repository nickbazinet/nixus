---
name: Nixus Experience
description: Information architecture, behavior, states, interactions, and accessibility for the Nixus desktop app. Scope — Finance module + app shell.
status: final
updated: 2026-08-01
design_spine: ./DESIGN.md
scope: Finance module and app shell. Car/Garage inherits the shell; not specified here.
primary_user: Marie — spreadsheet tracker, 40s–50s, least tolerant of complexity or confusing UI. Plus first-time budgeters trying to get control of their finances.
sources:
  - _bmad-output/planning-artifacts/product-brief-nkbaz-finance-2026-03-14.md
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/prd-validation-report.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/ux-design-specification-beta-page-2026-06-09.md
  - _bmad-output/planning-artifacts/architecture-desktop.md
  - _bmad-output/planning-artifacts/architecture-financial-decision-intelligence.md
  - _bmad-output/planning-artifacts/architecture-expense-income-account-linking.md
  - _bmad-output/planning-artifacts/architecture-alerts-notifications.md
  - _bmad-output/planning-artifacts/research/market-canadian-pf-mint-alternatives-research-2026-06-09.md
---

# Nixus — Experience Spine

> Paired with [DESIGN.md](./DESIGN.md), which owns the visual identity. Tokens are referenced by name in curly-brace path form — `colors.brand`, `typography.display`, `components.card`.
> **This spine wins on conflict with any mock, wireframe, or prior spec.**

## Foundation

Single-window Tauri 2 desktop app, macOS and Windows. React 19 + TanStack Router (file-based) + TanStack Query, Rust/SQLite backend. UI structure inherits from `@base-ui/react` via `@nkbaz/shared/ui`; `DESIGN.md` is the visual reference.

**Window:** default 1280 × 800, **enforced minimum 1024 × 680**. Every layout in this spine is designed at the minimum first.

**Local-first is a product promise, not an implementation detail.** All CRUD, budgeting, accounts, assets, net worth, and financial health work fully offline. Only two features touch the network — AI statement import and AI chat — and neither may ever block a task.

**Theme is `system` by default.** Light and dark are equal citizens; a pattern that only works in one mode is not shipped.

**Bilingual EN/FR.** Every string is an i18next key. Labels must survive French expansion at 1024px width.

**One user, one machine, no account.** No login, no sync, no household sharing. Nothing in this spine may imply otherwise.

This spine **supersedes** `ux-design-specification.md` in three places, all logged in `.decision-log.md`: the primary user (power user → Marie), money typography (monospace → tabular Inter), and the onboarding wizard (5 sequential steps → one fork).

## Information Architecture

Ten Finance tabs collapse to **four destinations**. This is not an invention — `InnerTabNav.tsx` already grouped the ten into four divider-separated clusters. The correct structure was already discovered; it was expressed as visual grouping instead of navigation, so the user still paid a ten-item scan cost. Cluster membership is unchanged.

| Destination | Answers | Absorbs | Route |
|---|---|---|---|
| **Today** | Am I OK this month? | Dashboard | `/` |
| **Spending** | Where does it go, and what can I change? | Budget · **Transactions** · Income · Recurring | `/spending/*` |
| **Wealth** | What do I own? | Accounts · Assets · Net Worth · Financial Health | `/wealth/*` |
| **Insights** | What's changing? | Spending Trends · Year Summary · Projection | `/insights/*` |

Within a destination, sub-surfaces are a **segmented sub-nav** on a layout route with `<Outlet/>` — the established `/net-worth` → `/net-worth/financial-health` pattern.

**Architecture rule D8 is binding: no new top-level rail item and no fifth destination, ever.** New capability nests inside an existing destination. Transactions is a sub-nav inside Spending, not an eleventh tab.

**Shell:** a 52px icon rail that expands to 192px on hover or keyboard focus, carrying the three modules (Finance · Car · AI) plus a utility stack (hide values, backup, restore, theme, language, Settings). The rail is module-level; destinations are Finance-level.

| Also reachable | From |
|---|---|
| Import | Primary action on Today and Spending; not a destination |
| AI chat | Rail module, plus `⌘K` from anywhere |
| Settings | Rail utility stack. Four sub-surfaces: General · Reading statements · Your data · About |
| Onboarding | `beforeLoad` redirect when no budget exists |

**Period is global.** One period context, mirrored to a URL search param so back/forward work, rendered once in the destination header. Today, Spending, and Insights all read it. The shipped app holds month in three independent `useState` hooks (`index.tsx:42`, `budget.tsx:38`, `income.tsx:33`), so choosing March on Today and clicking Budget silently returns you to June — "review last month" is structurally broken, and it is the first question a spreadsheet user asks.

No breadcrumbs. Rail plus destination plus sub-nav is the full location model.

→ Composition reference — the spine wins on conflict with all of them:
[Onboarding fork](.working/key-onboarding.html) · [Transactions, full detail](.working/key-transactions.html) · [Where to put your money](.working/key-financial-health.html) · [Settings](.working/key-settings.html)
Historical exploration, superseded token values: [three directions](.working/directions-3.html) · [Transactions scope comparison](.working/transactions-compare.html)

## Voice and Tone

Microcopy. Brand voice lives in `DESIGN.md.Brand & Style`. The register is the beta page's, verbatim: *"calm, honest, builder voice"* — *"this person is being straight with me."*

**Plain language first; the math goes in a tooltip.** Marie is the least complexity-tolerant user in the brief and every formula on screen is a small exit.

| Do | Don't |
|---|---|
| "You're saving 18% of what you earn" ⓘ | "Average monthly surplus ÷ average monthly income, based on completed months" |
| "3.2 months of spending covered" | "{{liquid}} liquid savings ÷ {{expenses}} average monthly expenses" |
| "$1,038.77 left for the next 12 days" | "Remaining discretionary allocation" |
| "Bills you can't easily change" / "What you can change" | "Fixed commitments" / "Variable spending" |
| "Money in − money out, not your balance" | "Net flow" |
| "3 likely duplicates found — unchecked. Review if you want them." | "3 duplicates excluded" |
| "TFSA balance · updated 6 weeks ago" | "TFSA balance · 6 wks · Stale" |
| "Reading your statement → Finding transactions → Sorting into categories → Done" | "Uploading… Extracting… Categorizing… Done" |
| "Your car" | "Fleet status" |
| "Tax-free savings (TFSA)" on first mention | "TFSA / RRSP / FHSA" with no explanation anywhere |
| "We couldn't read this line — add it yourself?" | "Extraction failed for row 14" |
| "We'll remember these for next month" | "Merchant-category mappings persisted" |
| "Paid" on a fixed cost at 100% of target | "Warning" on a mortgage at exactly its target |
| "Search merchants" | "Search" (it only matches the merchant field) |
| "Based on your completed months, January to May" | "Trailing 5-month average" |

**No `÷`, no `×`, no raw formulas in UI copy.** Ever.

**Certain words are engineering vocabulary and never reach the screen:** *fixed / variable, trailing, net flow, allocation, discretionary, liquid, data-sufficient*. They are precise and useful in this spine and in code. They are not words Marie uses about her own money.

**Registered-account acronyms get an expansion.** On a prose surface, on first mention. On a chart or allocation bar — where there is no "first mention" to attach to — the expansion goes in the row label or a persistent legend note, because a bar labelled `RRSP · TFSA · FHSA · Non-Registered` with no expansion anywhere is exactly the acronym wall this rule exists to prevent. FR uses CELI / REER / CELIAPP.

**Never manufacture enthusiasm.** No exclamation marks on financial figures, no "Great job!", no celebratory animation. Existing principles: *"earn delight, don't manufacture it"*, *"pragmatic over precious."*

**Do not imply she has been failing.** The user is often mildly embarrassed about her finances; the product's job is to state facts, not to grade her. Card headers are neutral nouns rather than questions that imply a verdict: **"Needs a look"** not "What needs attention?"; **"Suggested next step"** not "What should I do?". The badges underneath already read as facts. "Can I spend?" survives as-is — it is the user's own question, not the app's judgement of her.

## Status Vocabulary

One vocabulary across every module. Taken verbatim from `architecture-alerts-notifications.md` rather than invented — the alert pipeline already established it, priority-ordered.

| Status | Means | Token |
|---|---|---|
| `overdue` | Past due, needs action now | `{colors.over}`, filled dot |
| `due_soon` | Approaching, act this period | `{colors.caution}`, ring dot |
| `projected_due` | Expected, based on the recurring pattern | `{colors.caution}`, ring dot |
| `stale` | Data too old to trust | `{colors.caution}`, ring dot |
| `paid` / `on_track` | Satisfied, nothing to do | `{colors.neutral-ink}` / `{colors.good}` |

"Upcoming" is **not** in the vocabulary. Neither is a bare "Warning."

**Shape carries status as well as hue.** `caution` and `over` are the two states a user most needs to tell apart — a bill approaching due versus one already overdue — and amber against crimson is the single most confusable pair under deuteranopia and protanopia. Badge text makes this WCAG-sufficient, but the dot column is the fastest scan path in a stacked list, so `over` is a **filled** dot and `caution` is a **ring**.

**`projected_due` needs a clarifier the first time it appears** on a surface — "expected, based on your recurring pattern" — because "projected" is forecasting language a first-time reader cannot distinguish from `due_soon`. Prefer keeping it backend-only where `due_soon` would serve.

**Badges never render a bare adjective.** `stale` reads "Updated 6 weeks ago", not "Stale" beside an unexplained age.

**Budget pacing is fixed-vs-variable aware.** The shipped app badges any category at ≥75% of target as "Warning," which is why a mortgage at exactly `$1,650.00 / $1,650.00` reads as a problem. Bills that don't move (mortgage, insurance, utilities) are **expected** to reach 100% and render `paid`. Only changeable categories (groceries, restaurants, fuel) can be `due_soon` or `overdue`. On screen these two groups are labelled **"Bills you can't easily change"** and **"What you can change"**.

## Money & Number Rules

- Stored as integer cents everywhere; formatted only at the render edge.
- Always tabular figures (`{typography.money}`). Never a monospace family.
- **Every figure routes through the global hide-values mask.** The backend always returns raw cents; masking is frontend-only. A figure that bypasses the mask is a bug.
- **A masked figure must be masked in the accessible tree too.** The masked element carries a localized `aria-label` of "Amount hidden" and **the real value must not remain in the DOM text or accessible name.** Two failure modes are otherwise live: a CSS blur or overlay leaves the true amount readable by a screen reader — the exact opposite of the feature's purpose, and worst in the public-space scenario the toggle exists for — or a bullet-character replacement with no label announces "dollar sign bullet bullet bullet comma bullet bullet bullet."
- Liability balances always display as a **positive amount owed**. The internal sign convention never surfaces.
- **CAD and USD coexist unconverted.** No FX anywhere. A mixed-currency total is never summed into one number.
- Rounded axis ticks, one format per axis. Never `$0.0 / $850.0 / $1.7K / $2.6K`.
- Months on an axis read `Dec '25`, not `Dec 25` — the latter parses as a date.
- Signed amounts use a formatter from day one, so the unified Transactions view is a data change rather than a redesign.
- **A net figure is always labelled against the thing it is not.** "Money in − money out — not your account balance." A spreadsheet user's most practised habit is reading a running balance, so an unqualified "Net for June: +$3,824.39" will be read as a balance change. This is the single most consequential misreading available in the product.

## Data Honesty Contract

Places where a plausible-looking UI would misrepresent the data. All are prohibited.

| Prohibited | Because |
|---|---|
| A running-balance column on any transaction list | No balance-history table exists. `accounts.balance_cents` is current-value only. |
| An unqualified net figure | See Money Rules — it will be read as a balance. |
| Implying continuous net-worth tracking | `net_worth_snapshots` are discrete, captured on balance-changing events. Chart points are events, not days. |
| Presenting financial health as live | It is a **trailing average over completed months, excluding the current partial month.** Every surface showing it says so in plain words: "Based on your completed months, January to May." |
| Showing *any* financial-health figure before `data_sufficient` | A number the app cannot yet know is the exact failure the old onboarding was guilty of. See State Patterns and Flow 1. |
| A search placeholder reading just "Search" | Matching is merchant-substring only. No FTS index; it cannot find a category or a note. |
| An empty account cell with no explanation | Import- and recurring-generated expenses carry **no** `account_id` while manual ones can. "—" is paired with a reason badge — `from import` / `recurring` — and a tooltip that states it outright: "imports can't be linked to an account yet." The badge alone requires the user to infer the causal link. |
| Silently allowing manual balance edits *and* linked transactions | Produces drift and double-counting. The linking UI carries an inline explanation. |
| Any app-level "your data is encrypted" claim | Encryption is OS-level disk encryption only. |

The **educational-not-advice disclaimer** is permanent, always-visible UI on every financial-health surface. Not dismissible, not fine print.

**But its weight is calibrated to the surface.** On Wealth ▸ Where to put your money, it is a full sentence — the user came looking for guidance and deserves the caveat in full. On Today's suggested-next-step card it is a compact `ⓘ educational, not advice` affordance that expands on demand. A full disclaimer sitting beside the very first recommendation a user ever receives, in the same session where she is already being asked to trust an AI-categorized statement she didn't verify, stacks two hedges in ten minutes and reads as the app retracting itself.

## Getting Your Data Out

The primary user has owned a spreadsheet file for eleven years. Her deepest habit is not budgeting — it is **that the data is hers, in a format she can always open.** Adopting Nixus without a guaranteed exit is a larger commitment than she agreed to, and this is the kind of question that, asked and unanswered, ends the relationship on principle even when everything else works.

- **CSV export is a first-class feature, not a convenience.** Transactions, income, budget, accounts, assets, and net-worth history each export to CSV from their own surface, honouring the active filters.
- **It is distinct from backup/restore.** Backup is disaster recovery for a binary database file; export is *her data, in her tool*. Shipping only backup does not satisfy this.
- Export never requires AI, an account, or a network.
- Stated plainly where she'll look for it: **"Your data is yours — export any of this to a spreadsheet at any time."**
- Exported money is a plain decimal number, unformatted and unmasked, because the destination is a spreadsheet.

## Bending It To Fit

A spreadsheet is infinitely flexible; a structured app is not. That trade is what buys automatic categorization, and it is worth it — but the moment the user hits a wall where the app's shape doesn't match how she thinks about her money, credibility is gone for a spreadsheet veteran.

- **Categories and groups are freely renameable, mergeable, movable, and deletable**, at any time, with no ceremony. This is stated at the point of first contact — on the template picker — not discovered later: *"You can add, remove, or rename anything afterwards. This just saves you typing."*
- Starter templates are a starting point, never a commitment. Their names (Renting · Own a home · Home and a car) are approximations, and the copy says so.
- Deleting a category asks what happens to its transactions rather than blocking or silently orphaning them.
- **Known gaps, named rather than left silent:** multi-year comparison beyond Year Summary, and the ad-hoc side-sheets a spreadsheet accretes (a big-purchases tracker, a who-owes-me-money tab). Neither is in this scope. Both are the kind of thing a beta tester will name in the friction report, and it is better to have already heard it.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Destination nav (`{components.destination-active}`) | Shell | Four items, always. Active = brand underline. Period selector at the right, rendered once. On change, focus moves to the new surface's `<h1>` — not left on the nav item just activated. |
| Segmented sub-nav (`{components.segmented-nav}`) | Within a destination | **Real navigation links, not an ARIA tablist.** `Tab` moves between them, `Enter` activates. Arrow keys are *not* bound — arrow-key movement is the tablist convention, and applying it to real anchors produces something a screen reader still announces as "link," confusing anyone who knows the pattern. Never more than five items. |
| Transaction table (`{components.table-head}` / `{components.table-row}`) — see [full detail](.working/key-transactions.html) and [scope comparison](.working/transactions-compare.html) | Spending ▸ Transactions | Real `<table>`. Sortable date/amount/merchant, each `<th>` carrying **`aria-sort="ascending \| descending \| none"`** — the visual arrow alone leaves a screen reader user unable to tell what is sorted. Row is focusable; `Enter` opens the edit slide-over, matching the click. Header checkbox selects the page and renders **indeterminate** when partially selected. Leading direction-glyph column reserved for the unified view; when populated, each glyph carries `aria-label` "Money in" / "Money out". |
| Bulk bar (`{components.bulk-bar}`) | Any multi-select list | Appears on first selection. States the count **and the selected sum** — "4 selected · $498.61" — because a count alone doesn't tell you whether you're about to delete $12 or $1,200. Offers change-category / link-to-account / delete. `Esc` clears. Announced via `aria-live="polite"`. |
| Checkbox (`{components.checkbox}`) | Tables, import review | 15px visual box in a `{spacing.target-min}` hit area. Supports indeterminate. |
| Stat (`{components.stat}`) | Today, section headers | One `{typography.display}` per surface. Maskable. Always tabular. |
| Next-action card (`{components.action-card}`) — see [Where to put your money](.working/key-financial-health.html) | Today, Financial Health | At most **one** per surface. Renders `current_step` from the backend and never re-derives it. Carries the plain-language trailing-period note and the calibrated disclaimer. |
| Attention list (`{components.attention-row}`) | Today | Rows sorted by status-vocabulary priority. Each row: dot + name + figure + text badge. The row wrapper carries a **single accessible name** — `aria-label="Restaurants, over budget by $86"` — with dot, figure, and badge presentational, so the announcement is one coherent sentence rather than four disconnected fragments whose order varies by screen reader. |
| Inline edit (`{components.inline-edit}`) | Balances, targets, amounts, odometer | The value is a **focusable control**. `Enter` or `Space` enters edit mode; `Enter` saves, `Esc` cancels, toast confirms. Click also enters edit mode. The dotted underline is the required resting affordance — a hover pencil may be added but never replaces it, since a keyboard user never hovers. Never explained in helper text. |
| Slide-over (`{components.slide-over}`) | Create and edit | All create/edit flows. Never nested. `aria-labelledby` + `aria-describedby` required. **On close, focus returns to the element that opened it** — the row, the value, the button — never to `<body>`. |
| Dialog (`{components.dialog}`) | Destructive confirms only | Delete account / asset / vehicle. Same labelling and focus-return rules as slide-over. Modal-heavy workflows remain a named anti-pattern. |
| Toast (`{components.toast}`) | Save confirmations, recoverable failures | One at a time, auto-dismissing, `aria-live="polite"`. Never carries the only copy of an error a user must act on — that goes inline. |
| Card (`{components.card}`) | Every container | Presentational by default. A card is only clickable when it is a link to a detail surface, and then the whole card is one focusable target with one accessible name — never a card with competing inner click targets. |
| Buttons (`{components.button-primary}` / `{components.button-ghost}`) | Everywhere | One primary per surface. Disabled state uses `{components.disabled}` **and** `aria-disabled`; a dim alone is not a state. |
| Badges | Status everywhere | Text always present. Never interactive — a badge is a label, not a filter control. |
| Meter (`{components.meter}`) | Budget, savings cushion | Never the only indicator of state — always paired with a figure or badge. `role="progressbar"` with `aria-valuenow`. Never draggable. |
| Chart (`{components.chart}`) | Insights, Today, Wealth | Direct labels above five series. Rank-ordered colors, 1px segment dividers. Fixed/changeable toggle wherever a bill would pin the scale. Data available as a table equivalent for screen readers. |
| Empty state (`{components.empty-state}`) | Everywhere | One sentence plus one primary action. Never a blank card. |
| Starter-template picker (`{components.template-picker}`) — see [onboarding](.working/key-onboarding.html) | Onboarding, Settings | Renders template documents, not hardcoded options. Import-from-file always available. States that everything is editable afterwards. |

**Required primitives that do not yet exist** in `@nkbaz/shared/ui` and are prerequisites for the above: `Table`, `Skeleton` (53 hand-rolled `animate-pulse` blocks today), `EmptyState` (6+ hand-rolled), `Progress` (8 hand-rolled), `Switch` (the Recurring page instructs users to "toggle a template off" and no toggle exists; Settings needs three), `Checkbox` (why bulk-select is impossible today), `Alert`, `Combobox`, `DateRangePicker`, `Pagination`.

`sheet.tsx` and `slide-over.tsx` both exist — two competing off-canvas patterns. **Keep `slide-over.tsx`, delete `sheet.tsx`.**

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Cold load | Every card | Per-card `Skeleton`, never a global spinner. **Row count matches the real content count** — hardcoded 2–3 rows is why nearly every list shifts on load. Chrome (toolbar, headers, footer) resolves first; only cells are skeletons. `aria-busy`, never announced as content. |
| First launch, no budget | App open | `beforeLoad` redirect to onboarding. The shipped `useEffect` gate (`index.tsx:34-38`) renders an empty dashboard for one frame first. |
| Not enough history | Next-action card, Financial Health | `data_sufficient: false` is a **first-class state, not an error**: "Come back in a couple of months — to suggest what to do next, Nixus needs about three finished months of spending to see a pattern. You have one so far." Plus a progress indicator (1 of 3) and an Import CTA. **No financial-health figure renders in this state.** |
| No transactions match | Transactions | "Nothing matches 'costco' in February." Plus "Nixus searches merchant names only — not categories or notes." Filters stay visible; one Clear filters action. |
| Empty category | Budget row | One line + Add expense. |
| No income sources yet | Spending ▸ Income | "No income recorded yet. Add where your money comes from — a job, a side business, a pension." + Add a source. |
| No recurring templates yet | Spending ▸ Recurring | "No repeating bills yet. Add the ones that come every month and Nixus will fill them in for you." + Add a bill. |
| No assets yet | Wealth ▸ What you own | "Nothing here yet. Add a home, a car, or a business stake to see it in your net worth." + Add. Explains why it matters rather than just naming the gap. |
| No net-worth snapshots yet | Wealth ▸ Net worth | Not an error and not an empty chart axis. "Your first snapshot is taken when you enter account balances." + Add an account. A chart with one point never renders as a trend line. |
| One snapshot only | Wealth ▸ Net worth | A single labelled point with the honest caption "One snapshot so far — a line appears once there are two." Never interpolated. |
| AI unavailable / no credentials | Import, chat | Inline, non-modal, `recoverable: true`. Always names the manual path: "Add transactions manually." **Never blocks.** |
| Import in progress | Import | 4-stage stepper driven by real Tauri events. Plain-language stage names. `aria-live="polite"` at stage level, not per-tick. |
| Import slower than expected | Import | Past ~15s the stepper adds reassurance — "Still working. Larger statements take a bit longer." On hard timeout at the 30s NFR ceiling it degrades to the AI-unavailable state with the manual path named. Without this, a user watching a stepper past its expected duration on a desktop app with no other loading affordance reasonably concludes it has frozen and force-quits — discarding work that the commit-failure draft promise does not yet cover, because that protection is scoped to commit, not mid-extraction. |
| Import review | Import | Auto-categorized collapsed with a count; sub-0.8 confidence surfaced. Likely duplicates **auto-deselected**, described as "3 likely duplicates found — unchecked. Review if you want them." The word is never "excluded" — reversibility has to be legible in three words, without opening a panel to discover nothing was deleted. Unreadable lines are an explicit invitation, not a blank form. |
| Import commit failed | Import | Review state persists as a local draft surviving failure **and app restart**. Retry from the reviewed state. Never discard the batch. |
| Stale account balance | Accounts, Today | `stale` ring badge + "Updated 6 weeks ago" as adjacent text, never a bare adjective beside an age. |
| Values hidden | Global | Every figure masked, in the DOM and the accessible tree. Layout must not reflow. |
| Offline | Global | No indicator. Everything except AI works; silence is the correct signal. |
| Recoverable error | Any | Inline in place. No modal. |
| Disabled control | Any | `{components.disabled}` plus `aria-disabled`. Where a control is disabled for a reason the user can fix, the reason is adjacent — never a dead button with no explanation. |

## Onboarding & Seeding

The shipped wizard asks for a budget from absolute zero as step 1 — no seed logic exists anywhere in the Rust backend — at roughly **60–80 clicks and 50 field entries** for a realistic 15–20 category household budget. Import, the acknowledged killer feature, sits at step 5 behind four screens of manual entry.

**New shape — one fork, then done:**

1. **Welcome.** What Nixus is, what it isn't (no bank sync, desktop only, AI needs your own key), and the **required tray explanation**: "Nixus stays in your menu bar so reminders keep working."
2. **The fork — "Do you have a statement handy?"**
   - **Import it** *(happy path)* → AI extracts and categorizes → **proposes a budget from what you actually spent**.
   - **Pick a starting point** *(no AI needed)* → Renter · Homeowner · Homeowner with car. ~12 pre-filled Canadian categories with editable targets.
   - **Start from scratch** *(secondary, for Dev)*.
3. **Confirm.** "Here's a budget based on what you actually spent. Adjust anything?" One primary button.
4. **Done** → land on Today.

**Accounts, Assets, and Income leave the wizard** and become optional prompt cards on Today. They were four screens standing between Marie and the moment that makes her stay.

The template path is **not optional**. AI is bring-your-own-key; a user with no credentials must still reach a budget in about two clicks.

**Starter templates are portable versioned documents** — schema plus a `version` field — never hardcoded Rust constants. Import-from-file ships now; sharing UI does not. This exists because community-shared templates are an intended future direction, and retrofitting a format after seeding is hardcoded is the expensive path. Exchange stays file-based: no account, no server, ever.

## AI Contract

The existing principle is *"automation earns trust — show the AI's work."* The import stepper already honours it. These rules keep it honoured.

- **Confidence threshold is 0.8**, now documented. Above → auto-categorized, collapsed, counted. Below → surfaced for review. (No spec previously defined a number; the implementation already used 0.8.)
- **Merchant memory is required.** Categorizing "METRO" teaches the app. Review shrinks every month, and that is the difference between a demo and a habit.
- **Identical merchants group.** "4 × TIM HORTONS — categorize once."
- **Bulk review is mandatory**, not an enhancement: select-all, multi-assign, auto-deselected duplicates. A real statement is 40–80 rows and the shipped review has zero bulk affordances.
- Amount fields in review use the shared money input, never a bare `<input type="number">`.
- **Chat gets starter prompts seeded from the user's real data** — "How am I tracking this month?", "What changed vs. May?" A blank box immediately after being told AI is a headline feature makes the user guess.
- Chat states its data freshness: "based on your data through Jun 28."
- **Markdown rendering must set `remarkGfm({ singleTilde: false })`.** With the default, `~$430` meaning *approximately* renders as struck-through — the AI appears to cross out dollar amounts. This is visible in the shipped README screenshot.
- **The waterfall is deterministic and backend-owned.** The frontend renders `current_step` and never re-derives a recommendation.
- Never a product name, ticker, or allocation percentage. Account *types* only.

## Interaction Primitives

**Mouse-first, keyboard-complete.** Marie is not a keyboard power user; Dev is. Defaults suit the mouse, and **everything is reachable by keyboard** — which means every mouse-only affordance in this spine has a stated keyboard equivalent, not an implied one.

- `⌘K` / `Ctrl+K` — AI command bar, global.
- `Esc` — closes the topmost overlay; clears a bulk selection.
- `Tab` — order matches reading order on every surface. Moves between segmented sub-nav items.
- `Enter` / `Space` on a focused value — **enters** inline-edit mode. `Enter` then saves, `Esc` cancels.
- `Enter` on a focused table row — opens the edit slide-over, matching the click.
- `Enter` on a focused nav or sub-nav link — navigates.
- A skip link precedes the rail, moving focus to the surface heading.
- **On any route change, focus moves to the new surface's `<h1>`.** The shell persists, so without this a keyboard user who activates a destination is left on the nav item and must tab through the rail, destination nav, sub-nav, toolbar, and filter chips before reaching content — compounding across all four destinations.
- **On overlay close, focus returns to the element that opened it.**
- **Minimum interactive target is `{spacing.target-min}` (24px)**, hit area independent of visual size. Documented exception: the meter, which is never interactive.

**Banned:** hover-only affordances with no visible resting state · modal stacks deeper than one · infinite scroll (paginate) · a destructive action as a peer of a primary action in the same row (`Delete vehicle` currently sits beside `Edit vehicle` — demote to overflow) · validate-on-submit-only with no required-field markers (all four sampled forms use `mode: "onSubmit"`, so a user fills five fields, clicks Save, and *then* learns what was wrong — mark required fields and validate on blur) · arrow-key navigation on elements that are semantically links.

**The rail opens labelled on first run.** It collapses to icons only once the user has been through onboarding, and the collapsed state is a preference. The shipped default — 52px icons, labels gated behind hover — asks the least tech-comfortable user to learn navigation by discovery, which is the same "figure it out yourself" pattern this spine bans for inline edit and required fields. Labelled-by-default, collapse-to-save-space is the correct inversion.

## Accessibility Floor

Behavioral. Contrast lives in `DESIGN.md`. Target is the PRD's *"best-effort WCAG 2.1 AA without it becoming a blocker."*

**Contrast and color**
- 4.5:1 text, 3:1 graphical, verified in both modes, checked in CI. Non-negotiable: positive financial figures currently fail in dark mode.
- **Color is never the only signal.** Every status badge carries text, and `caution` versus `over` differ in dot *shape* as well as hue.
- 13px is the floor for anything read as content; 12px uppercase is permitted for badges only.

**Keyboard and focus**
- Every interactive element has a visible `{components.focus-ring}` — ring plus surface-colored offset, so it survives on a brand-filled button.
- Focus order matches reading order; focus returns on overlay close; focus moves to the heading on route change; a skip link precedes the rail.
- `aria-sort` on every sortable column header.

**Screen reader**
- Every icon-only control keeps its `aria-label` — currently 13/13, do not regress.
- Forms: `htmlFor` on every label, `aria-invalid` + `aria-describedby` on every error, required state announced.
- Dialogs and slide-overs need `aria-labelledby` and `aria-describedby` — currently **0** of each in the app.
- Destination announced on navigation: "Spending, Transactions, 214 rows."
- Attention-list rows announce as one sentence, not four fragments.
- Masked figures announce "Amount hidden" and do not leak the value.
- **Chat streaming is not a plain live region.** It renders token-by-token visually, but the live region updates only at sentence boundaries or on completion. A live region bound to a streaming LLM response announces every DOM mutation — partial words, fragments, a firehose per response. Toasts, the import stepper, and bulk counts are simple enough for a bare `aria-live="polite"`; streaming is not, and lumping them together is the documented failure mode.
- Charts expose a table equivalent.

**Platform**
- **Windows High Contrast Mode (`forced-colors: active`) is a required pass, not a nicety.** See `DESIGN.md` — hairline-only elevation and tint-based badges are exactly what HCM overrides. Verified in a real Windows session, not DevTools emulation. HCM users skew older and low-vision, overlapping the primary persona directly.
- **OS text scaling is tested at 125%, 150%, and 200% *at the 1024 × 680 minimum window*** — the compounding case, which is the realistic one for a presbyopia-range user who scales system-wide rather than per-app. The layout must reflow, not clip. If it cannot hold, the minimum window is wrong, not the user.
- Touch-capable Windows laptops are in scope for target sizing.

**Language and motion**
- Switching language updates `document.documentElement.lang` immediately and announces the change. Without it, a screen reader keeps reading French content with an English voice for the rest of the session — a real degradation for the French-Canadian users this product explicitly courts.
- **`prefers-reduced-motion` applies to every transition and animation in the token layer, with no exceptions** — rail expansion, slide-over and dialog enter/exit, toast slide-in, skeleton pulse, meter fill, chart bar transitions, and chat typing indicators (already logged as outstanding in `deferred-work.md`). Stated as a blanket rule with no carve-outs so coverage is unambiguous.

## Inspiration & Anti-patterns

What not to build, and why. Consolidated here because it was previously scattered across supersession notes and the decision log, leaving no single place a builder could check.

**Carried forward**
- **From the shipped app's own import flow:** the four-stage stepper driven by real events. It is the one place the product already honours "automation earns trust," and it is the model for every long operation.
- **From the shipped Garage module:** the `overdue / due_soon / projected_due / stale` status vocabulary. Reused verbatim across Finance rather than reinvented.
- **From the shipped modal discipline:** slide-over for create/edit, dialog for destructive confirm, zero modal nesting across 22 surfaces. Preserved as-is.
- **From the market research:** *"acknowledge limitations first"* as a trust rule, and *"spreadsheet upgrade without Plaid"* as the positioning. Bank-sync breakage is the single most-cited abandonment driver among Canadian PF tools — which is why the honest "no bank connection" statement leads onboarding rather than hiding in a FAQ.

**Retired, and not to be reintroduced**
| Rejected | Why |
|---|---|
| Monospace for money | A code font on a mortgage payment. Tabular figures buy the same alignment at no cost in register. |
| "Teal" as the accent | Named in the prior UX spec, contradicted by both the tokens and the logo. Three answers is why ~150 raw palette classes exist. |
| Flat indigo-600 on cold slate | The default AI-scaffold palette. Zero ownership, wrong emotional register. |
| The 5-step onboarding wizard | 60–80 clicks before the app does anything. Buried the killer feature at step 5. |
| "Warning" at ≥75% of any target | Badges a mortgage at exactly its target as a problem. |
| A 10-item flat tab bar | The clusters already existed as dividers; they just weren't navigation. |
| A running-balance column | The data cannot support it. See Data Honesty Contract. |
| A smooth-gradient chart ramp | Adjacent segments shared luminance — the defect it was meant to fix. |
| Card and page at the same color | Cards were visible only as a faint ring, in both modes. |
| Google Fonts at runtime | A local-first app phoning out to Google on every launch. |
| Icon-only rail by default | Gates labels behind hover for the least tech-comfortable user. |

**Rejected on principle, though tempting**
- **Streaks, scores, and grades.** No "financial health score," no letter grade, no streak. The user is often mildly embarrassed about her finances; a score is a verdict. The waterfall gives one concrete next step instead — that is the whole design.
- **Gamified savings encouragement.** No confetti when a category comes in under target. *Earn delight, don't manufacture it.*
- **Generative advice.** The waterfall is deterministic and backend-owned precisely so identical inputs always produce identical output. An LLM deciding what someone should do with their money is not a feature this product ships.
- **A notification that nags.** Alerts are quiet by default, OS push is opt-in, every alert is dismissible and snoozable. There is no badge count pressuring the user to open the app.
- **Automatic bank sync.** Not a scope cut to regret — it is the thing the target user is fleeing.

## Key Flows

### Flow 1 — First ten minutes (Marie, 42, Tuesday evening, laptop on the kitchen table)

A friend sent her a link at lunch. She has a Visa statement PDF in her downloads folder and about fifteen minutes of patience.

1. She opens Nixus. First paint is the welcome screen — not an empty dashboard, because the gate runs in `beforeLoad`. It tells her plainly: no bank connection, her data stays on her machine. And it explains the tray with the reassurance first: *"Nixus stays open in your menu bar — that's what lets it remind you about bills when the window is closed. Nothing leaves your computer."* Nothing here mentions API keys.
2. **"Do you have a statement handy?"** She does. She picks the PDF.
3. The stepper narrates in plain language: *Reading your statement → Finding transactions → Sorting into categories → Done.* Twenty-two seconds.
4. **47 transactions found. 41 already sorted.** Three likely duplicates are unchecked with a note offering review — *found and unchecked*, never "excluded." Six need her: four Tim Hortons charges grouped into one row she can categorize once, a Pharmaprix she assigns to Health, and one line the AI couldn't read, which asks her to fill it in rather than presenting a blank form.
5. She clicks **Add 44 transactions.** A quiet line reads: *We'll remember these for next month.*
6. **Climax:** the next screen says *"Here's a budget based on what you actually spent. Adjust anything?"* — twelve categories, already filled in, with her real numbers in them. She raises Groceries by fifty dollars, leaves everything else, and clicks **Looks good.** She has a working budget and a month of categorized history, and **she has not typed a single category name.**
7. Today loads. It tells her what it actually knows: *$1,038.77 left for the next 12 days*, and that Restaurants is over by $86 — both derived entirely from the statement she just imported. Where a suggested next step will eventually sit, there is instead: *"Come back in a couple of months — to suggest what to do next, Nixus needs about three finished months of spending. You have one so far,"* with a 1-of-3 indicator. **No savings-cushion figure appears**, because she has not entered a single account balance and the app does not yet know. Beneath it, one optional prompt: *Add your accounts to see your net worth.*

Failure: no AI credentials configured → the fork's second option, **Pick a starting point**, reaches the same budget in two clicks, and the import prompt moves to Today for later. Failure: `confirm_import` errors → her six corrections persist as a local draft that survives restart, and she retries from the reviewed state. Failure: extraction runs long → past 15 seconds the stepper says *"Still working. Larger statements take a bit longer."*

> **Why step 7 is written this way.** An earlier draft of this flow had Today greet her with "3.2 months of expenses covered" and a next-action card telling her to build an emergency fund. That number cannot exist — she had imported one statement and entered zero balances. It is precisely the failure this spine indicts the old onboarding for: the app appearing to know something about her it has not earned. The `data_sufficient: false` state is not a degraded fallback; **on day one it is the correct and only honest state.** A product whose pitch is "this person is being straight with me" cannot open with a figure the user can tell is invented.

### Flow 2 — "Where did the money go in March?" (Marie, three weeks later, Sunday morning)

Her credit card bill looks higher than she expected and she wants to check something specific.

1. She opens Nixus and clicks **Spending**, then **Transactions**.
2. She types `metro` into the search box — the placeholder says *Search merchants*, so she knows what it will and won't find.
3. She sets the date range to March and clicks the **Amount** column header to sort largest first.
4. There it is — one $312 Metro charge she doesn't recognise, sitting in Groceries.
5. She clicks the row; a slide-over opens. She recategorizes it to Household, saves, and focus returns to the row she came from.
6. **Climax:** she notices two rows with a dash in the Account column and a small `from import` badge. She hovers it: *"imports can't be linked to an account yet."* **She was not confused, and she did not email about it.** Then the footer: *What you can change — $389.61. Bills — $1,836.00.* The part she has any say over is separated from the part she doesn't.

Failure: filters match nothing → "Nothing matches 'costco' in February", the merchant-only caveat, filters retained, one Clear filters action. Failure: more than 100 matches → real paging, because `offset` was added; without it she could only ever see her most recent 100 rows.

### Flow 3 — "Am I saving enough?" (Marie, four months in, a Saturday in October)

She has imported four statements and entered her chequing, savings, and TFSA balances. She has been wondering whether she should be putting money into her TFSA or just leaving it in savings.

1. She clicks **Wealth**, then the sub-nav item **Where to put your money** — not "Financial Health," because she isn't looking for a health score.
2. The surface leads with what she asked: *3.2 months of spending covered*, and underneath, in words, where that came from — *"$14,320 in chequing and savings, against $4,455 of spending in a typical month"*, and *"Based on your completed months, June to September. This month isn't finished, so it isn't counted."* No `÷` anywhere.
3. To the left, five steps in order. Step 1 is checked. **Step 2 is the only one highlighted** — *Build up to six months* — with the concrete arithmetic already done for her: *"about $8,940 more, roughly $745 a month for a year."*
4. She reads down and sees **step 4, "Put money into tax-sheltered accounts,"** greyed out with *"Comes after your savings cushion is full."* That is the answer to the question she actually came with, and it's the answer she didn't expect.
5. She clicks **Why this before investing?** and gets two sentences, not a lecture.
6. **Climax:** she scrolls to *Where you'd find the money* — Restaurants $268/mo, Shopping $194/mo, Subscriptions $87/mo — and *"trimming these by a third would cover about $183 of your $745 monthly goal."* The advice stops being abstract. **It names three of her own numbers and does the subtraction for her**, which is the thing her spreadsheet never did. A permanent line at the bottom notes this is educational, not advice.

Failure: fewer than three completed months → the `data_sufficient: false` state, with the 1-of-3 progress indicator, and no figures. Failure: she has a large credit-card balance → the waterfall reorders itself and step 3 becomes the highlighted one; the frontend renders `current_step` and never decides this itself.

### Flow 4 — Asking rather than reading (Dev, bi-weekly, statement day)

Dev keeps six accounts and wants a specific answer fast, without navigating.

1. `⌘K`. The command bar opens over whatever surface he's on, with starter chips seeded from his real data: *How am I tracking this month?* · *What changed vs. May?* · *Can I afford $2k in July?*
2. He types his own instead: "how much did I spend on restaurants each month this year." The reply streams in — visually token-by-token, announced to assistive tech only at sentence boundaries.
3. The answer arrives with a footer: *based on your data through Oct 28.* Approximate figures render as "about $260" — never `~$260`, which the markdown renderer would strike through.
4. He follows up: "add a $48 dinner at Kinka on the 26th to Restaurants."
5. **Climax:** the AI does not write anything. It renders a **confirmation card** — merchant, amount, category, date — and waits. He checks the date, clicks Add, and gets a toast. The write happened because he approved it, not because the model decided to.

Failure: no credentials → an inline, non-modal, recoverable message naming the manual path; the rest of the app is untouched. Failure: the request exceeds 5s → the streaming indicator persists and respects `prefers-reduced-motion`; no timeout dialog.

## Backend Prerequisites

Surfaces in this spine that cannot ship until the data layer changes. Recorded so the spine is honest about what it is promising.

| Needed for | Change |
|---|---|
| Transactions paging | `offset` (or cursor) on `search_expenses` — `limit` is clamped 1–100 with no offset today |
| Sortable columns | Sort by amount and merchant |
| Category filter | `category_id IN (…)` |
| Account filter | Expose the existing `account_id` column as a filter |
| Budget from import | Propose-budget-from-categorized-transactions |
| Starter templates | Versioned template document format + import-from-file |
| Template export | Amount-stripped export — a shared template must be amount-free **by construction**, not by user diligence, or the first community template someone posts leaks their mortgage payment |
| CSV export | Per-surface CSV export honouring active filters, for Transactions, income, budget, accounts, assets, net-worth history |
| Merchant memory | Persist merchant → category mappings |
| Import resilience | Persist review draft across failure and restart; distinguish mid-extraction timeout from commit failure |
| Category management | Rename / merge / move / delete with a stated destination for orphaned transactions |
| Unified Transactions *(future)* | `search_income` — **does not exist at all** today |

## Open Items

- **FR70 must be rewritten** — it specifies the retired five-step wizard.
- **FR8 now has a number** (0.8); the PRD should adopt it.
- **FR29's "any data in the system"** remains unbounded; the chat surface needs a scoped capability list, flagged in `prd-validation-report.md`.
- **`epics.md` is stale** (7 nav items, 4-step wizard) and was not used as IA input.
- **Insights** sub-surfaces (Spending Trends, Year Summary, Projection) are FR-mandated with zero recorded design. Structure is set here; layouts are not. Multi-year comparison is unaddressed.
- **"Wealth" needs validating with real users before it is locked.** The four-destination *structure* is evidenced by the existing `InnerTabNav` clusters; the *labels* are not evidenced by anything. "Wealth" is the one most likely to alienate the named persona — a user with a mortgage and a car loan may not accept it as a word about herself, and a credit-card balance is the opposite of wealth. Candidates to test: *Accounts · My money · Net worth*. This is a research task, not a desk decision.
- **"Insights"** is vaguer and therefore safer, but promises nothing specific. Revisit once its sub-surfaces are designed.
- **French labels** for the four destinations need confirmation at 1024px.
- **`financialHealth.*` stays as the i18n namespace**, but no user-facing string says "Financial Health." The sub-nav label is "Where to put your money."
- `[ASSUMPTION]` — the three starter templates are Renting / Own a home / Home and a car. Category lists not yet drafted.
- `[ASSUMPTION]` — Settings sub-surfaces are General · Reading statements · Your data · About, per the mock. Not validated.
