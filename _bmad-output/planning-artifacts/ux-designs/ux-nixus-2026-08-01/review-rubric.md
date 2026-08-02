# Spine Pair Review — nixus

## Overall verdict

The token layer and color/typography discipline in DESIGN.md are genuinely strong — computationally-verified contrast, a real correction history, and 73/10/6/14/15 tokens/roles/radii/spacing/components all present and internally consistent. But the pair is not yet a clean contract for downstream consumers: one component's frontmatter tokens don't resolve (`rail-on` / `rail-on-ink`), roughly a third of the components named in EXPERIENCE.md's behavioral table have no visual counterpart in DESIGN.md, and — most importantly — only 2 of 8 in-scope PRD journeys have a Key Flow walkthrough, leaving the flagship Financial Health feature, AI chat, Income entry, and the Today/Dashboard landing surface without an end-to-end narrative a builder can follow. Treat this as adequate-with-gaps, not ready-to-build-from.

## 1. Flow coverage — thin

Checked the `sources` frontmatter of both files against PRD "User Journeys" (J1–J9). Scope excludes Car (J7), correctly omitted per task instructions. In-scope: J1 CC Import, J2 Setup/Linking, J3 Dashboard Glance, J4 Import Gone Wrong, J5 AI Chat Query, J6 Income Entry, J8 Recurring/Insights/Projection/Backup, J9 Financial Health Check. EXPERIENCE.md ships exactly two Key Flows: "First ten minutes" (covers J1 fully, J2's onboarding slice, J4's failure path) and "Where did the money go in March?" (a net-new Transactions flow, not a PRD journey).

### Findings
- **critical** J9 (Financial Health Check) has no Key Flow. The PRD gives this a full worked example (emergency-fund ring, savings-capacity line, waterfall shift, revolving-debt buffer) and EXPERIENCE.md treats it as the product's differentiator (Data Honesty Contract, `data_sufficient` state, permanent disclaimer) but never walks a protagonist through opening the view, seeing the ring, reading "Why?", or watching the recommendation change months later (PRD `prd.md:227-247`; EXPERIENCE.md Key Flows, `EXPERIENCE.md:248-276`). *Fix:* add a Key Flow for Financial Health with the ring→reasoning→disclaimer beat as its climax and a failure path for `data_sufficient: false`.
- **high** J5 (AI Chat Query) has no Key Flow despite an entire "AI Contract" section of behavioral rules (starter prompts, confidence threshold, merchant memory, write-confirmation). A downstream builder gets rules but no worked conversation (PRD `prd.md:161-175`; EXPERIENCE.md `EXPERIENCE.md:204-217`). *Fix:* add a Key Flow dramatizing a multi-turn query + a confirmed write action, per PRD Journey 5.
- **high** J6 (Income Entry) is not covered anywhere beyond being absorbed into the Spending destination's table cell (`EXPERIENCE.md:50`). No Component Pattern, no State row, no Key Flow — the thinnest-covered in-scope journey. *Fix:* at minimum give Income a State Patterns row (empty/first-source) and consider a short Key Flow given the PRD gives it a full worked example (`prd.md:176-189`).
- **medium** J8 (Recurring, Spending Trends, Year Summary, Projection, hide-values, backup) has no Key Flow. Insights layouts are honestly flagged as undesigned in Open Items, which mitigates that slice, but Recurring, hide-values, and backup/restore are otherwise specified (Component Patterns, State Patterns) and still lack a walkthrough. *Fix:* either fold into an existing flow or add "Insights sub-surfaces" to Open Items' acknowledged-gap list explicitly (currently only the layouts are flagged as gaps, not the flow).
- **medium** J3 (Dashboard Glance / Today) is behaviorally covered across IA, State Patterns, and Component Patterns rows but never gets a Key Flow walkthrough, unusual for the app's literal landing surface. *Fix:* a short flow would cost little and would anchor the Stat/Next-action-card/Attention-list rules to a concrete moment.
- **low** Flow 2 ("Where did the money go") is not a PRD journey at all — it's justified by Decision Log Entry 15 (Transactions scope), but a reader cross-checking flows against `sources` will not find it as a named requirement. Not a defect, just worth a one-line provenance note.

## 2. Token completeness — adequate

Extracted all 73 color tokens (light/dark pairs all present, verified 1:1), 10 typography roles, 6 radii, 14 spacing entries, 15 component specs, and every `{path.to.token}` reference in both files' prose.

### Findings
- **critical** `{colors.rail-on}` and `{colors.rail-on-ink}`, referenced inside the `components.rail-item-active` frontmatter block, do not exist anywhere in the `colors` token list (DESIGN.md:222-224 referencing a colors block that runs DESIGN.md:13-89). This is a broken reference inside the machine-readable frontmatter itself, not just prose — a resolver would fail on the rail's active-state component. *Fix:* add `rail-on` / `rail-on-ink` (light + dark) to `colors`, or repoint the component to an existing pair such as `brand-soft` / `brand-ink`.
- **medium** The rail's hover/focus-expanded width (192px, `EXPERIENCE.md:58`) has no corresponding token in DESIGN.md's `spacing`, even though the collapsed width (`{spacing.rail-w}` = 52px) is tokenized and DESIGN.md's own Do's/Don'ts explicitly bans hardcoded pixel values ("Reach for a token" / don't "Write `text-[32px]`", `DESIGN.md:359`). *Fix:* add `spacing.rail-w-expanded: 192px` and reference it from EXPERIENCE.md.
- **low** `chart-1, chart-2, chart-4, chart-5, chart-6, chart-8` are defined and contrast-verified (per decision log Entry 19) but never referenced via `{colors.chart-N}` syntax in either file's prose — only `chart-3` and `chart-7` are cited (for the adjacency warning). Not broken, just under-cited; a consumer implementing the eight-step ramp has to infer the other six from the frontmatter alone.
- Contrast targets: stated and load-bearing combinations are explicit and computed (4.5:1 text / 3:1 graphical in both modes, chart steps ≥3.15:1 on card, adjacent separation ≥1.37:1) — this is a strength, not a finding.

## 3. Component coverage — thin

Extracted every component name used anywhere in either file (DESIGN.md `components` frontmatter + Components section; EXPERIENCE.md Component Patterns table) and cross-checked for a row in both.

### Findings
- **high** Nine components get real behavioral rules in EXPERIENCE.md's Component Patterns table but **no visual entry** in DESIGN.md's `components` frontmatter or Components section: **Segmented sub-nav**, **Bulk bar**, **Attention list**, **Inline edit**, **Slide-over**, **Dialog**, **Chart** (color story exists, but no `components.chart` token entry despite Card/Stat/Badge/Meter all having one), **Empty state**, **Starter-template picker** (`EXPERIENCE.md:145-158` vs `DESIGN.md:334-347`). A builder gets *how it behaves* with no *how it looks* for a third of the named components. *Fix:* add `components.segmented-nav`, `components.bulk-bar`, `components.dialog`, `components.slide-over`, `components.chart`, `components.empty-state` at minimum — Slide-over and Dialog currently get only a one-line radius mention in the Shapes section (`DESIGN.md:330`), not a Components row.
- **medium** `Toast` is used repeatedly in EXPERIENCE.md (inline-edit confirmation, `aria-live` on toasts, import events) but has no Component Patterns row of its own and no DESIGN.md visual entry — it's referenced only as a behavior, never specified as a component in either file.
- **medium** DESIGN.md's `{components.card}` has no corresponding behavioral row in EXPERIENCE.md's Component Patterns table (it's the universal container, used everywhere, but never gets its own behavioral rules — e.g., is a card ever clickable as a whole, does it ever collapse). Buttons (`button-primary`/`button-ghost`) and the four badge variants have the same gap — visual spec exists, no dedicated behavioral row (status-badge behavior is implied by the Status Vocabulary table but never stated as click/hover rules).
- **low** Naming is not always identical across files even where intent matches: DESIGN's `table-head`/`table-row` maps to EXPERIENCE's "Transaction table" row, and DESIGN's `destination-active` maps to EXPERIENCE's "Destination nav" — semantically fine, but a literal cross-reference search (e.g. grepping for "destination-active") from EXPERIENCE.md would fail since the EXPERIENCE table never uses the token name as its row label.

## 4. State coverage — adequate

Walked every IA surface (Today; Spending▸Budget/Transactions/Income/Recurring; Wealth▸Accounts/Assets/Net Worth/Financial Health; Insights▸Trends/Year Summary/Projection; Import; AI chat; Settings; Onboarding) against the State Patterns table (`EXPERIENCE.md:164-180`).

### Findings
- **medium** No state row for **Income** (empty/no sources yet), **Recurring** (no templates yet), or **Assets** (empty list) — all three are named, in-scope IA surfaces with zero acknowledgment as design gaps (unlike Insights and Settings, which Open Items explicitly flags as undesigned). *Fix:* either add rows or add these three to Open Items so the omission reads as a decision rather than an oversight.
- **medium** No state for **Net Worth** when a user has zero snapshots (new-user cold start) — Data Honesty Contract states net worth is event-driven/discrete but never says what the chart looks like at zero events, and this isn't the same case as the Next-action card's `data_sufficient: false` (that's specific to Financial Health, not the Net Worth trend chart itself).
- **low** Insights sub-surfaces and Settings correctly have no state rows, but this is because Open Items already flags both as undesigned (`EXPERIENCE.md:299-300`) — self-aware, not a silent gap. No fix needed beyond what's already logged.
- Strength: the Import states (in-progress / review / commit-failed) and the `data_sufficient: false` framing are unusually rigorous — real product research (draft persistence across app restart, auto-deselected duplicates) rather than generic placeholders.

## 5. Visual reference coverage — adequate

Verified `.working/directions-3.html` and `.working/transactions-compare.html` exist and are linked from both spines.

### Findings
- **low** "Spines win on conflict" is stated **twice per file** (top blockquote + inline composition-reference callout, both files) — four total restatements across the pair for what the task expects stated once. Not harmful, mildly redundant.
- **medium** `transactions-compare.html` is linked from EXPERIENCE.md only at the Information Architecture section (`EXPERIENCE.md:71`), bundled generically with `directions-3.html` under "Composition reference," rather than at the Component Patterns "Transaction table" row (`EXPERIENCE.md:147`) or the Data Honesty Contract table where its findings (no running balance, merchant-substring search) actually land. A reader looking for *why* the Transactions table is shaped the way it is won't find the pointer next to the relevant rule.
- **low** `directions-3.html` is named specifically in DESIGN.md's top blockquote ("three rendered directions," `DESIGN.md:238`) but both files' inline "Composition reference" callouts just list the two filenames without saying which illustrates which decision — someone unfamiliar with the decision log would not know `transactions-compare.html` is about table-variant scope rather than visual direction.
- No orphans: both files are referenced in both spines at least once, and both carry the required "historical artifact, spine wins" notice per Decision Log Entry 20.

## 6. Bloat & overspecification — adequate, with one real issue

DESIGN.md's prose is dense but consistently tied to a rationale (why a color exists, what it corrects) rather than restating sources — consistent with the spec's allowance for editorial voice in DESIGN.md.

### Findings
- **medium** EXPERIENCE.md is more rhetorical than a behavioral contract should be in several places outside Key Flows (where narrative voice is expected by the shape). Examples: "**The north-star question is...** This section is the answer to it." (`EXPERIENCE.md:184`); "That is the abandonment risk, and it is not recoverable by polish." (`EXPERIENCE.md:186`); "This constraint and the four-destination model agree with each other; that is why the model is affordable." (`EXPERIENCE.md:56`); "The product's differentiator is trust." (`EXPERIENCE.md:125`). These read as decision-log argumentation rather than extractable rules, and a story-dev consumer has to separate persuasion from contract. *Fix:* keep the rule, cut the justification sentence, or move justification to the decision log (which already has it in most cases).
- **low** No FR/persona restatement bloat — sources are cited by number/name (FR70, FR8, FR29) rather than quoted at length. Good discipline.
- **low** Colors section prose-vs-table: acceptable per design-md-spec's explicit "per-color story" requirement; not a violation despite being long.

## 7. Inheritance discipline — adequate, with one broken link

### Findings
- All 12 distinct files across both `sources` frontmatter blocks resolve on disk — verified with a direct existence check (product brief, PRD, both UX specs, both tokens/logo files, PRD validation report, four architecture docs, market research doc all present).
- **critical** (duplicate of §2) `{colors.rail-on}` / `{colors.rail-on-ink}` do not resolve — the one genuine inheritance break found. See §2.
- FR references are verbatim and accurate: FR70 ("multi-step onboarding wizard (budget, accounts, assets, income, import)"), FR8, and FR29 ("any data in the system") all match `prd.md` wording exactly.
- Glossary is consistent: Marie's persona description, TFSA/RRSP/FHSA (and FR CELI/REER/CELIAPP), and the four destination names (Today/Spending/Wealth/Insights) match verbatim between the decision log and both spines.
- Token counts match exactly what the decision log claims (73 colors / 10 typography roles / 6 radii / 14 spacing tokens / 15 components) — verified by direct count, a good sign the spines weren't hand-edited out of sync with the stated total.

## 8. Shape fit — adequate

### Findings
- DESIGN.md's eight body sections appear in exactly the canonical order (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts). No violation.
- All eight EXPERIENCE.md required-default sections are present (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) and appear in that relative order — the five invented sections are interspersed between them by topical adjacency (Status Vocabulary/Money Rules/Data Honesty after Voice and Tone; Onboarding & Seeding/AI Contract after State Patterns) rather than appended at the end, which is a mild deviation from the paired example's convention (Drift appends its extras — Responsive & Platform, Inspiration & Anti-patterns — immediately before Key Flows). Not a hard violation since no spec file constrains EXPERIENCE.md ordering, but worth naming.
- The five invented sections all earn their place: Status Vocabulary, Money & Number Rules, and Data Honesty Contract each prevent a specific, named implementation error (raw badge misuse, monospace money, a fabricated running-balance column); Onboarding & Seeding and AI Contract each carry a load-bearing, previously-undocumented number (0.8 confidence threshold; the 60–80-click abandonment finding). Backend Prerequisites and Open Items are unusually honest bookkeeping sections that most spines skip. None read as filler.
- **high** "**Inspiration & Anti-patterns**" is missing entirely, despite two independent sources for it: the decision log records rejected visual directions (B "Soft Focus," C "Clear Slate," Decision Log Entry 12) and the retired `ux-design-specification.md` — one of EXPERIENCE.md's own `sources` — carried a full "UX Pattern Analysis & Inspiration" section with "Inspiring Products Analysis," "Transferable UX Patterns," and "Anti-Patterns to Avoid" (`ux-design-specification.md:138-201`) that is never carried forward, referenced, or explicitly retired. What currently exists instead is scattered: a single "named anti-pattern" mention for modal stacking (`EXPERIENCE.md:154`), rejected onboarding shape buried in Foundation's supersession note, and rejected color/typography choices buried in Decision Log entries 4–6 that never surface in either spine. A downstream consumer has no single place to see "what not to build and why," which both the paired example and the retired source establish as expected content. *Fix:* add an "Inspiration & Anti-patterns" section to EXPERIENCE.md consolidating: retired monospace money, retired teal/indigo, retired 5-step wizard, retired "Warning"-at-75%-badge, banned running-balance column, and the market-research source's competitor takeaways (currently cited as a `sources` entry but never surfaced in body prose at all).

## Mechanical notes

- **Broken token reference:** `{colors.rail-on}` / `{colors.rail-on-ink}` (DESIGN.md:223-224) — cited in §2 and §7.
- **Untokenized hardcoded value:** rail hover-expand width `192px` (EXPERIENCE.md:58) has no DESIGN.md token, contradicting DESIGN.md's own "reach for a token" rule.
- **All 12 `sources` files across both frontmatter blocks resolve on disk** — no missing-file breaks.
- **All 73 color tokens have a complete light/dark pair** — verified programmatically, zero orphans either direction.
- **Frontmatter token totals match the decision log's claimed counts exactly** (73/10/6/14/15) — no drift between log and shipped spine.
- **`chart-1, chart-2, chart-4, chart-5, chart-6, chart-8`** are defined and contrast-verified but never cited via `{colors.chart-N}` in prose (only chart-3/chart-7 are, for the adjacency warning) — not broken, just uncited.
- **Naming drift, not breakage:** EXPERIENCE.md Component Patterns row labels ("Transaction table," "Destination nav") don't literally match the DESIGN.md token names they visually correspond to (`table-head`/`table-row`, `destination-active`) — a grep-based cross-reference would miss the pairing even though the intent is consistent.
- **`.working/` visual references:** both files exist, both are linked from both spines, both carry the required "historical artifact, spine wins" notice — no orphans, but `transactions-compare.html`'s citation in EXPERIENCE.md sits at the IA section rather than next to the Transaction table / Data Honesty rules it actually informs.
