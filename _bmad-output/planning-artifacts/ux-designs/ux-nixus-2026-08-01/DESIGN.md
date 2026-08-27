---
name: Nixus
description: Visual identity for Nixus — a local-first desktop app that removes the upkeep from tracking your money. Direction A "Quiet Ledger". Tailwind v4 + @base-ui/react via @nkbaz/shared/ui; this DESIGN.md defines the token layer that was previously absent, plus the brand-layer deltas on top of it.
status: final
updated: 2026-08-23
sources:
  - _bmad-output/planning-artifacts/product-brief-nkbaz-finance-2026-03-14.md
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/ux-design-specification-beta-page-2026-06-09.md
  - docs/images/nixus-logo.svg
  - packages/shared/src/styles/tokens.css
colors:
  # ---- Light (default surface) ----
  bg: '#FAF8F5'
  card: '#FFFFFF'
  chrome: '#F5F2EC'
  rail: '#F0ECE4'
  rail-line: '#E3DDD2'
  ink: '#1C1917'
  ink-dim: '#6B635A'
  ink-faint: '#71685F'
  line: '#E8E3DA'
  line-strong: '#D8D1C5'
  track: '#EFEAE1'
  hover: '#FBF9F6'
  ink-disabled: '#9C938A'
  rail-ink: '#71685F'
  rail-on: '#E7E2F7'
  rail-on-ink: '#5D56C5'
  focus-ring: '#5B54D6'
  brand: '#5B54D6'
  brand-ink: '#4A43BE'
  brand-on: '#FFFFFF'
  brand-soft: '#EFEDFB'
  good: '#15803D'
  good-bg: '#E8F3EA'
  good-ink: '#14672F'
  caution: '#B45309'
  caution-bg: '#FBF0DF'
  caution-ink: '#8F4208'
  over: '#BE123C'
  over-bg: '#FBE9ED'
  over-ink: '#9D0F33'
  neutral-bg: '#EFEAE1'
  neutral-ink: '#6B635A'
  # Entitlement — its own family, not status. Authoritative value in tokens.css.
  premium-ink: '#8A6304'
  chart-1: '#5A54D7'
  chart-2: '#AB7DD9'
  chart-3: '#B54AB5'
  chart-4: '#DB6D9B'
  chart-5: '#368580'
  chart-6: '#BA8741'
  chart-7: '#7F773F'
  chart-8: '#9B8F85'
  # ---- Dark ----
  bg-dark: '#17150F'
  card-dark: '#211E18'
  chrome-dark: '#1D1A14'
  rail-dark: '#141209'
  rail-line-dark: '#302A21'
  ink-dark: '#EDE9E1'
  ink-dim-dark: '#A79E91'
  ink-faint-dark: '#8E867A'
  line-dark: '#332E25'
  line-strong-dark: '#413A2E'
  track-dark: '#2C2721'
  hover-dark: '#282419'
  ink-disabled-dark: '#6F685E'
  rail-ink-dark: '#8E8271'
  rail-on-dark: '#2E2A44'
  rail-on-ink-dark: '#928AEF'
  focus-ring-dark: '#BDB8F5'
  brand-dark: '#A5A0F0'
  brand-ink-dark: '#BDB8F5'
  brand-on-dark: '#1E1B36'
  brand-soft-dark: '#2A2640'
  good-dark: '#4ADE80'
  good-bg-dark: '#1B2E20'
  good-ink-dark: '#6EE79A'
  caution-dark: '#FBBF24'
  caution-bg-dark: '#332813'
  caution-ink-dark: '#FCD34D'
  over-dark: '#FB7185'
  over-bg-dark: '#3A1B22'
  over-ink-dark: '#FDA4AF'
  neutral-bg-dark: '#2C2721'
  neutral-ink-dark: '#A79E91'
  premium-ink-dark: '#E9C46A'
  chart-1-dark: '#A4A0F0'
  chart-2-dark: '#A56DDD'
  chart-3-dark: '#DE8FDE'
  chart-4-dark: '#E1528E'
  chart-5-dark: '#41B9B1'
  chart-6-dark: '#B47B2A'
  chart-7-dark: '#B7AA50'
  chart-8-dark: '#968373'
  # ---- Identity (mode-independent) ----
  logo-stop-1: '#818CF8'
  logo-stop-2: '#A78BFA'
  logo-stop-3: '#F472B6'
typography:
  display:
    fontFamily: 'Inter'
    fontSize: 34px
    fontWeight: '600'
    lineHeight: '1.05'
    letterSpacing: -0.03em
  stat:
    fontFamily: 'Inter'
    fontSize: 26px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.025em
  h1:
    fontFamily: 'Inter'
    fontSize: 20px
    fontWeight: '650'
    lineHeight: '1.25'
    letterSpacing: -0.02em
  h2:
    fontFamily: 'Inter'
    fontSize: 16px
    fontWeight: '650'
    lineHeight: '1.3'
    letterSpacing: -0.015em
  h3:
    fontFamily: 'Inter'
    fontSize: 14px
    fontWeight: '650'
    lineHeight: '1.35'
    letterSpacing: -0.012em
  body:
    fontFamily: 'Inter'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'Inter'
    fontSize: 13.5px
    fontWeight: '550'
    lineHeight: '1.4'
  caption:
    fontFamily: 'Inter'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.45'
  column-head:
    fontFamily: 'Inter'
    fontSize: 13px
    fontWeight: '650'
    lineHeight: '1.35'
    letterSpacing: 0.01em
    note: 'Table column heads. Sentence case, NOT uppercase — these are scanned rapidly and uppercase costs letter-shape discrimination for the 40s-50s primary user.'
  micro:
    fontFamily: 'Inter'
    fontSize: 12px
    fontWeight: '650'
    lineHeight: '1.35'
    letterSpacing: 0.045em
    note: 'Uppercase. Badge text and short section eyebrows ONLY, max ~20 chars. Never column heads, never axis ticks, never prose.'
  money:
    fontFamily: 'Inter'
    fontWeight: '600'
    note: 'Not a size — a numeric treatment. font-variant-numeric tabular-nums + font-feature-settings "tnum" 1, applied at whatever role size the context calls for.'
rounded:
  sm: 4px
  md: 5px
  lg: 7px
  xl: 10px
  full: 9999px
  DEFAULT: 5px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  card-pad: 16px
  grid-gap: 12px
  page-x: 20px
  page-y: 20px
  section-gap: 24px
  rail-w: 52px
  rail-w-expanded: 192px
  target-min: 24px
  focus-ring-w: 2px
  focus-offset-w: 2px
components:
  card:
    background: '{colors.card}'
    border: '1px solid {colors.line}'
    radius: '{rounded.lg}'
    padding: '{spacing.card-pad}'
    shadow: 'none'
  stat:
    typography: '{typography.display}'
    color: '{colors.ink}'
    numeric: 'tabular'
  button-primary:
    background: '{colors.brand}'
    foreground: '{colors.brand-on}'
    radius: '{rounded.md}'
    typography: '{typography.label}'
  button-ghost:
    background: '{colors.card}'
    border: '1px solid {colors.line-strong}'
    foreground: '{colors.ink}'
    radius: '{rounded.md}'
  badge-over:
    background: '{colors.over-bg}'
    foreground: '{colors.over-ink}'
    radius: '{rounded.md}'
    typography: '{typography.micro}'
  badge-caution:
    background: '{colors.caution-bg}'
    foreground: '{colors.caution-ink}'
    radius: '{rounded.md}'
    typography: '{typography.micro}'
  badge-good:
    background: '{colors.good-bg}'
    foreground: '{colors.good-ink}'
    radius: '{rounded.md}'
    typography: '{typography.micro}'
  badge-neutral:
    background: '{colors.neutral-bg}'
    foreground: '{colors.neutral-ink}'
    radius: '{rounded.md}'
    typography: '{typography.micro}'
  badge-premium:
    foreground: '{colors.premium-ink}'
    border: '1px solid {colors.premium-ink}'
    background: 'transparent'
    radius: '{rounded.md}'
    typography: '{typography.micro}'
    note: 'Account-scoped entitlement only. Its unfilled outline distinguishes it structurally from the soft-filled status family; the word carries the meaning in forced colors.'
  account-trigger-entitled:
    icon-foreground: '{colors.premium-ink}'
    border: 'unchanged'
    background: 'unchanged'
    motion: 'none'
    note: 'A quiet, persistent gold account icon. Decorative and supplemental to badge-premium. Suppressed whenever session-expired or another account state takes precedence; the trigger keeps its ordinary transparent border so entitlement cannot be mistaken for focus.'
  meter:
    track: '{colors.track}'
    fill: '{colors.brand}'
    height: 7px
    radius: '{rounded.full}'
  table-head:
    typography: '{typography.column-head}'
    foreground: '{colors.ink-faint}'
    border-bottom: '1px solid {colors.line}'
  table-row:
    border-bottom: '1px solid {colors.line}'
    hover: '{colors.hover}'
  rail-item-active:
    background: '{colors.rail-on}'
    foreground: '{colors.rail-on-ink}'
    marker: '3px {colors.brand}'
  destination-active:
    foreground: '{colors.brand-ink}'
    border-bottom: '2px {colors.brand}'
  action-card:
    border-left: '3px solid {colors.brand}'
    background: '{colors.card}'
  logo-gradient:
    value: 'linear-gradient(135deg, {colors.logo-stop-1}, {colors.logo-stop-2} 50%, {colors.logo-stop-3})'
  focus-ring:
    ring: '{spacing.focus-ring-w} solid {colors.focus-ring}'
    offset: '{spacing.focus-offset-w} solid <local surface>'
    note: 'Always ring + surface-colored offset. The offset is what makes the ring legible on a brand-filled button; no single ring color can clear 3:1 against both card-dark and brand-dark.'
  disabled:
    foreground: '{colors.ink-disabled}'
    border: '1px solid {colors.line}'
    background: '{colors.card}'
    note: 'Visual dim is never sufficient on its own — aria-disabled or native disabled is required.'
  segmented-nav:
    active-background: '{colors.bg}'
    active-foreground: '{colors.ink}'
    inactive-foreground: '{colors.ink-dim}'
    radius: '{rounded.md} {rounded.md} 0 0'
    typography: '{typography.label}'
  bulk-bar:
    background: '{colors.brand-soft}'
    foreground: '{colors.brand-ink}'
    border-bottom: '1px solid {colors.line}'
  attention-row:
    dot: '7px {rounded.full}'
    typography: '{typography.caption}'
    note: 'Dot shape differentiates caution from over — caution is a ring, over is filled. Hue alone fails under deuteranopia.'
  checkbox:
    size: 15px
    radius: '{rounded.sm}'
    border: '1.5px solid {colors.line-strong}'
    checked-background: '{colors.brand}'
    hit-area: '{spacing.target-min}'
  inline-edit:
    resting: '1px dotted {colors.line-strong}'
    note: 'The dotted underline is the required resting affordance. A hover pencil is an optional addition, never a replacement.'
  slide-over:
    background: '{colors.card}'
    radius: '{rounded.xl}'
    shadow: 'permitted — floating layer'
  dialog:
    background: '{colors.card}'
    radius: '{rounded.xl}'
    shadow: 'permitted — floating layer'
  toast:
    background: '{colors.card}'
    border: '1px solid {colors.line-strong}'
    radius: '{rounded.lg}'
    shadow: 'permitted — floating layer'
  chart:
    ramp: '{colors.chart-1}..{colors.chart-8}'
    segment-divider: '1px solid {colors.card}'
    surface: '{colors.card}'
    note: 'Colors assigned by rank order, never pinned to category identity. The divider guarantees a perceivable boundary even between same-luminance steps.'
  empty-state:
    glyph-background: '{colors.track}'
    radius: '{rounded.lg}'
    typography: '{typography.h2}'
  template-picker:
    background: '{colors.card}'
    selected-border: '1px solid {colors.brand}'
    radius: '{rounded.lg}'
---

# Nixus — Design Spine

> Direction A "Quiet Ledger", chosen 2026-08-01 from three rendered directions — see [directions](.working/directions-3.html).
> Paired with [EXPERIENCE.md](./EXPERIENCE.md). **This spine wins on conflict with any mock, wireframe, or screenshot.**

## Brand & Style

Nixus removes the upkeep from staying on top of your money. The people it is for are not looking for a dashboard — they are looking for **relief**. They kept a spreadsheet until the maintenance burden beat them, and the emotional promise is *in control, relieved, confident*. Every visual decision here serves that, and the existing principle **"calm is the baseline"** is treated as a hard constraint rather than a sentiment.

The register is a **well-set financial statement**, not a developer dashboard. Warm paper rather than cold slate. Separation carried by hairlines and tone, never by shadow. Numbers are the loudest thing on any surface and nothing competes with them for attention. Where the product must show complexity it shows it *quietly* — density is earned by the user asking for it, never presented by default.

Two things this identity deliberately corrects.

**First, the app now looks like its own logo.** The Nixus mark is a gradient — `{colors.logo-stop-1}` periwinkle through `{colors.logo-stop-2}` violet to `{colors.logo-stop-3}` pink. The shipped app used flat indigo-600 on slate and never touched that warmth anywhere. `{colors.brand}` is the logo's periwinkle darkened just enough to pass AA on paper, and the chart ramp walks the logo's own gradient. Adopting the identity you already own is simultaneously the conservative choice and the corrective one.

**Second, "teal" is retired.** Three artifacts disagreed on the accent — the prior UX spec said teal, `tokens.css` said indigo, the logo said periwinkle-to-pink. That disagreement is the root cause of roughly 150 raw Tailwind palette classes in the codebase: with no authoritative answer, contributors reached for literal colors. **The logo is the source of truth.** There is now exactly one answer.

Nixus inherits component structure from `@base-ui/react` via `@nkbaz/shared/ui`. But unlike a typical brand-layer delta, this spine **defines the token layer from scratch** — the previous `tokens.css` carried colors, two font families, and a single radius, with no type scale, no spacing scale, no shadow scale, and no chart palette. That absence is why 336 of 374 font sizes in the app landed on 12px or 14px. There was nothing to reach for.

## Colors

**Neutrals are warm.** `{colors.bg}` is paper, not white; `{colors.ink}` is a warm near-black. The warmth is the single largest carrier of the calm register — the same layout in cool slate reads as a devtool. Dark mode keeps it: `{colors.bg-dark}` is a warm charcoal, not blue-black.

**Cards sit above the page, always.** `{colors.card}` is pure white against `{colors.bg}` paper; in dark, `{colors.card-dark}` is *lighter* than `{colors.bg-dark}`. This is a correction — the shipped tokens had `--card` identical to `--background` in light and identical to `--muted` in dark, so cards were visible only as a faint ring.

**`{colors.brand}` means brand and action. Nothing else.** Primary buttons, the active destination underline, the rail's active marker, links, the `{components.action-card}` accent, and the current-period bar in a chart. It does **not** mean "good," it does **not** mean "on track," and it is **not** a category color that happens to be first. Previously `--chart-1` was byte-identical to `--primary`, so purple simultaneously meant brand, clickable, and on-track — a user could never learn it.

**Status is a separate family, and never the sole signal.**

- **`{colors.good}`** — on track, funded, paid, completed. State only, never decorative.
- **`{colors.caution}`** — `due_soon`, `projected_due`, `stale`, approaching a target.
- **`{colors.over}`** — over budget, overdue, failed action, destructive confirm.
- **`{colors.neutral-ink}`** — a fixed commitment that has simply been met. A mortgage at 100% of target is **Paid**, not a warning.

Every status color is paired with a text label in the same badge. A user who cannot distinguish the hues loses nothing.

**`{colors.premium-ink}` is an entitlement, and entitlement is not status.** A premium Nixus Cloud account is a durable fact about the account — it did not succeed, it is not on track, and it demands nothing of the user. So it sits outside the status family entirely rather than borrowing `{colors.caution}`, which would be the tempting shortcut because both are goldish: amber already means attention-required everywhere else in this product, and reusing it would tell a paying user something is wrong. The gold is deliberately yellower (hue ~42) than caution's orange ochre (hue ~36) so the two do not read as the same signal, and retuning either family cannot silently restyle the other.

Three rules bind it. It is **ink only** — there is no `premium-bg`, because the entitlement never renders as a filled status pill; `{components.badge-premium}` uses an unfilled outline whose word carries the meaning. It is verified at **4.5:1 on all four surfaces**, exceeding both text and graphical floors. And it appears on exactly **two account-owned surfaces** — `{components.account-trigger-entitled}` and `{components.badge-premium}` — because a durable account fact repeated across the shell stops being information and becomes decoration.

**Charts are eight steps, they are not the status family, and their luminance alternates.** The ramp travels the logo's hue journey — periwinkle → violet → orchid → pink — then picks up a teal, a warm gold, an olive, and a warm neutral for the long tail.

Eight exists because the Accounts allocation bar has seven real segments — RRSP, TFSA, Non-Registered, Savings, FHSA, Chequing, Crypto — and the previous five-color ramp wrapped, producing two indistinguishable purples and two indistinguishable greens. Note also that `--chart-4` was previously identical to `--destructive`, so an ordinary spending category rendered in the error color.

**The alternating luminance is the important part, and it is a correction to an earlier draft of this spine.** A ramp that walks a gradient smoothly produces neighbours with nearly identical *luminance* — different hue, same lightness — which reproduces the exact indistinguishability problem it was meant to fix, and fails outright for a colorblind user. So the ramp deliberately zig-zags: odd steps are dark (4.35–5.70:1 on `{colors.card}`), even steps are light (3.15:1). Every adjacent pair is verified at **≥1.37:1 against each other** and every step at **≥3.15:1 against `{colors.card}`**.

Two consequences worth stating. Charts must sit on `{colors.card}`, not directly on `{colors.bg}` — the ramp is verified against card. And **segment order matters**: `{colors.chart-3}` and `{colors.chart-7}` share a luminance and are separated by hue alone, so they must never end up adjacent.

**Above five segments, label directly and drop the legend.** A legend the user must cross-reference is a failure, not a feature.

**Two binding rules make the ramp safe, because "no two steps share luminance" is impossible.** With eight steps alternating between a dark band (~4.5:1) and a light band (~3.15:1), any two steps *within* a band necessarily share luminance — repairing `{colors.chart-3}`/`{colors.chart-7}` only relocates the collision to `{colors.chart-2}`/`{colors.chart-8}`. Alternating separation and all-pairs-distinct are mutually exclusive at n=8. So the guarantee is structural instead:

1. **Colors are assigned by rank order — largest segment first. Never pinned to a category identity.** Rank ordering plus alternating luminance makes adjacency safe by construction.
2. **Every stacked or allocation chart draws a 1px `{colors.card}` divider between segments.** Each segment then has a ≥4.5:1 edge against its neighbour regardless of what colors land side by side, so the boundary is always perceivable — even for the `chart-3`/`chart-7` pair, which sit at exactly 1.00:1 to each other.

**Status colors are never used as chart fills**, and the reverse also holds.

### Contrast

Every token pair is verified computationally against its own background, in both modes: **4.5:1 for text, 3:1 for graphical objects and disabled states.** This is not a formality — `text-emerald-600` measured **3.88:1** on the old dark card and `text-teal-700` measured **2.67:1**. The app was failing contrast on positive financial figures, in the mode all of its own screenshots were taken in.

Because these margins are load-bearing and a 1% "warm this up" nudge can silently break them, **a contrast-regression check over this frontmatter belongs in CI.** It is a numbers-only test and costs almost nothing.

`{colors.ink-faint}` is the dimmest text token. It is verified at ≥4.6:1 against **all four** surfaces — `{colors.card}`, `{colors.bg}`, `{colors.chrome}`, and `{colors.rail}` — because it carries column heads and axis ticks, which are content, not decoration. An earlier draft verified it against card and page only, and it failed on chrome and rail at 4.06–4.29:1.

**The rail has its own three tokens** — `{colors.rail-ink}`, `{colors.rail-on}`, `{colors.rail-on-ink}` — because the rail expands to `{spacing.rail-w-expanded}` and renders real text labels, so its inks need the full 4.5:1 text treatment rather than icon-level 3:1. `{colors.rail-on}` is a tint and is verified as graphical only; the label on top of it is what carries text contrast.

**`{colors.ink-disabled}`** exists so that a disabled control is *perceivably* disabled — verified at 3:1 against `{colors.card}` and clearly distinct from enabled `{colors.ink}`. A visual dim is never sufficient alone: disabled controls also carry `aria-disabled` or the native `disabled` attribute.

**`{colors.focus-ring}` is always drawn as a ring plus a surface-colored offset**, per `{components.focus-ring}`. This is not stylistic. In dark mode a ring must clear 3:1 against both `{colors.card-dark}` (requiring luminance ≥ 0.140) and `{colors.brand-dark}` (requiring ≤ 0.098) — an empty solution set. No single hex exists. The offset separates ring from button so the ring only ever needs contrast against the surface, which makes it legible on a brand-filled primary button — the highest-traffic focusable element in the product.

### Windows High Contrast Mode

Windows is a first-class platform and `forced-colors: active` is **not** optional to handle. This system is unusually exposed to it: elevation is hairline-only, badge states are carried by soft background tints, and chart segments are flat fills — all three are exactly what HCM overrides. Under forced colors, card boundaries can vanish, the four badge tints collapse into one, and an allocation bar becomes a single undifferentiated block.

Requirements: system-color-mapped borders on cards, badges, and chart segments; explicit `forced-color-adjust` opt-outs only where a fill is semantically load-bearing; and **verification in a real Windows HCM session, not Chromium's emulation.** HCM users skew older and low-vision, which is the primary persona.

Avoid: gradients on surfaces, any raw Tailwind palette class, more than eight chart steps, color as the only carrier of meaning.

## Typography

**Inter throughout. No monospace for money, ever.**

The shipped app set every dollar figure in JetBrains Mono — 62 usages across 39 files — to buy column alignment. `{typography.money}` buys the same alignment with tabular figures and costs nothing in register. A code font on a mortgage payment is the strongest single mis-signal the product sends to someone who is nervous about money.

| Role | Size | Used for |
|---|---|---|
| `{typography.display}` | 34px | The one number that answers the surface's question. At most **one** per surface. |
| `{typography.stat}` | 26px | Secondary hero figures — a section total, a committed-per-month sum. |
| `{typography.h1}` | 20px | Surface title. |
| `{typography.h2}` | 16px | Section heading within a surface. |
| `{typography.h3}` | 14px | Card heading. |
| `{typography.body}` | 14px | Default reading size. |
| `{typography.label}` | 13.5px | Form labels, buttons, nav items, table cells. |
| `{typography.column-head}` | 13px | Table column heads. **Sentence case, not uppercase.** |
| `{typography.caption}` | 13px | Supporting sentences, axis ticks. **The floor for anything a user reads.** |
| `{typography.micro}` | 12px | Uppercase. **Badge text and short eyebrows only**, max ~20 characters. |

**10px and 11px are banned.** Five surfaces currently use 10px. For a primary user described as 40s–50s that is an age-appropriateness failure, not a stylistic one.

**Uppercase is restricted to badges.** An earlier draft put table column heads and axis ticks in 12px uppercase, which stacks three independent legibility penalties — small size, all-caps letter-shape loss, and a rapid-scan usage pattern — on the exact content a presbyopia-range user scans most often. Column heads are now 13px sentence case (`{typography.column-head}`) and axis ticks use `{typography.caption}`. The same reasoning that bans 10px applies at 12px when the text is scanned rather than read; 12px survives only for short, high-contrast, unambiguous badge labels.

**Arbitrary sizes are banned.** `text-[Npx]` does not appear in this system. Four separate files independently hand-rolled a `text-[32px]` hero; they all become `{components.stat}`. `<h1>` currently renders at two different sizes and `<h2>` at four.

Emphasis comes from **weight and size**, never color — colored text is reserved for status and links.

## Layout & Spacing

A 4-based scale, `{spacing.1}`–`{spacing.10}`, plus named tokens for the recurring cases: `{spacing.card-pad}`, `{spacing.grid-gap}`, `{spacing.page-x}`, `{spacing.section-gap}`.

**Every layout must hold at 1024 × 680** — the enforced minimum window; default is 1280 × 800. A three-column hero row is the widest structure permitted, collapsing to one column below 1100px.

The shell is a `{spacing.rail-w}` icon rail plus a fluid main column. **The scroll container is the main column, not an inner centered wrapper** — the current `overflow-y-auto` on the `max-w-[1280px] mx-auto` element puts the scrollbar *inside* the centered content, visible in the shipped dashboard screenshot. Page width is identical on every surface; AI routes do not get their own measure.

## Elevation & Depth

**`shadow: none`. This is a rule, not a default.**

Depth is carried by three devices only: a 1px `{colors.line}` hairline, a tonal step between `{colors.bg}` and `{colors.card}`, and — for genuinely floating layers (`{components.slide-over}`, `{components.dialog}`, `{components.toast}`, popover) — a single soft shadow permitted on **those four only**.

**The hairline is reinforcement; the tonal step is the actual boundary.** Hairlines measure 1.2–1.6:1 against their surfaces, which is correct for a decorative separator but means they are effectively invisible to a low-vision user. The real separation work is done by the `{colors.bg}` ↔ `{colors.card}` luminance step. This is stated so that nobody, under contrast pressure, "fixes" the hairline into a `shadow-sm` that this system bans — and so that the Windows High Contrast requirements above are understood as load-bearing rather than defensive.

This invalidates the 55 of 75 `<Card>` usages that override the component with `shadow-sm rounded-lg`, and the 16 files that hand-roll `div + rounded-lg border bg-card` rather than using `Card`. The elevation recipe lives **inside** the component; call sites never restate it.

## Shapes

Crisp, not soft: `{rounded.sm}` for inputs and checkboxes, `{rounded.md}` for buttons and badges, `{rounded.lg}` for cards, `{rounded.xl}` for slide-overs and dialogs, `{rounded.full}` for meters and dots only.

The restraint is deliberate. Large radii read "consumer app"; a financial statement is squarer. Corners are the one place this direction stays closer to the shipped app than to its own warmth.

## Components

Structure inherited from `@base-ui/react` via `@nkbaz/shared/ui`. This spine specifies visual treatment; behavior lives in `EXPERIENCE.md`.

- **`{components.card}`** — the only container. White on paper, hairline border, `{rounded.lg}`, `{spacing.card-pad}`, no shadow. Call sites pass content, never elevation.
- **`{components.stat}`** — the surface's headline number. Replaces four independently hand-rolled 32px heroes. Tabular always. Respects the hide-values mask.
- **`{components.button-primary}` / `{components.button-ghost}`** — brand fill for the one primary action per surface; hairline ghost for everything else.
- **Badges** — `{components.badge-over}`, `{components.badge-caution}`, `{components.badge-good}`, `{components.badge-neutral}`. The shipped `badge.tsx` has no positive or warning variant despite the tokens existing, which is precisely why status went raw-palette. Text is mandatory in every badge.
- **`{components.attention-row}`** — dot + name + figure + text badge. **The dot's shape differentiates status, not just its hue**: `caution` is a ring, `over` is filled. Amber and crimson are the single most confusable pair under deuteranopia and protanopia, and the dot column is the fastest scan path in a stacked list — so the badge text alone, while WCAG-sufficient, leaves a colorblind user with materially less signal on the scan.
- **`{components.meter}`** — 7px track, brand fill, pill ends. Replaces 8 hand-rolled `role="progressbar"` blocks. **Never a drag target.** If that ever changes, its hit area must expand independently of its 7px visual height.
- **`{components.table-head}` / `{components.table-row}`** — real `<table>` markup. The current `ExpenseList` renders a `<div>` of flex rows, which is why nothing in it can sort. Column heads use `{typography.column-head}`; numeric columns are right-aligned and tabular.
- **`{components.checkbox}`** — 15px visual box inside a `{spacing.target-min}` hit area. The dense box suits the register; the padded target means a low-tech-comfort user reviewing 40–80 imported rows is not hunting a 15px square.
- **`{components.inline-edit}`** — a dotted underline is the **required resting affordance**. A hover pencil may be added on top of it but never replaces it, because a keyboard-focus-only user with no pointer never triggers hover.
- **`{components.bulk-bar}`** — brand-tinted bar above a table when a selection exists.
- **`{components.segmented-nav}`** — sub-surface navigation within a destination. Active tab reads as continuous with the page beneath it.
- **`{components.slide-over}` / `{components.dialog}` / `{components.toast}`** — the floating layers. `{rounded.xl}`, shadow permitted.
- **`{components.chart}`** — rank-ordered ramp on `{colors.card}`, with the 1px segment divider.
- **`{components.empty-state}`** — glyph, one `{typography.h2}` line, one supporting sentence, one action.
- **`{components.template-picker}`** — renders portable template documents, not hardcoded options.
- **`{components.focus-ring}`** — ring plus surface-colored offset, on every interactive element.
- **`{components.disabled}`** — `{colors.ink-disabled}` plus `aria-disabled`. Never a dim alone.
- **`{components.rail-item-active}`** — the rail's active module: `{colors.rail-on}` tint, `{colors.rail-on-ink}` label, 3px `{colors.brand}` right marker.
- **`{components.destination-active}`** — a 2px brand underline. Four destinations, never more.
- **`{components.action-card}`** — a 3px brand left border, used **once** per surface, on the next-action card. Its scarcity is what makes it read as *do this*.
- **`{components.logo-gradient}`** — the identity. Permitted on the rail mark, the launch surface's `<h1>` wordmark (see below), the installer, and marketing. **Never** on a surface, card, button, or chart.

### Launch surface

The profile picker is the first thing every launch paints, and it is the one surface in this system that is a **landing composition** rather than a working surface: chrome-free by arrangement with the shell, no rail, no destination nav, no period. It gets its own note here because three of its decisions read as violations of the rules above until the reason is stated, and because **no new token is introduced for any of it.**

- **Two columns, asymmetric, action column first.** A fixed-measure action column beside a fluid decorative column, the pair centred. The gutter is `{spacing.10}` at the two-column size and `{spacing.section-gap}` once the composition stacks — the wider column gutter is deliberate, because at `{spacing.section-gap}` the two columns read as one crowded block, while the same value is correct as vertical separation between stacked sections. The two columns are the **same height** — the decorative panel follows the action column as the local list expands, because a short panel stranded beside a tall list reads as a layout bug. Two columns hold only while the effective width sustains them — at the `1024 × 680` minimum they do, and under OS text scaling (which shrinks the CSS viewport, not the type) they do not. **Below that the composition stacks, visual last, and the page scrolls.** It never clips, and it never scrolls horizontally.
- **`{typography.display}` carries a statement here, not a figure.** Everywhere else display is "the one number that answers the surface's question," at most one per surface. This surface has no figure at all — the thing that answers its question is a sentence — so the display role carries it, and the one-per-surface ceiling is unchanged.
- **The `<h1>` paints the brand rather than spelling it out, and it is the one heading in this system permitted to carry `{components.logo-gradient}`.** The greeting ends before the brand name and the wordmark completes it: the canonical mark followed by "ixus" set in `{typography.display}` with the gradient clipped to the type, the same lockup, kerning and treatment the rail mark uses. This is a deliberate, scoped amendment to the gradient rule above rather than a contradiction of it — the launch screen is a landing composition and the brand *is* its content, whereas a gradient on a working surface's chrome is still banned. Four consequences bind it. The mark is the wordmark's "N", so it is sized to the heading (`{spacing.8}`) and no second free-standing mark is drawn above it — the identity appears once in the action column. The gradient lands on the type only, never on a fill behind it, so the surface stays flat and `{colors.card}` and `{colors.bg}` are untouched. Because the mark is an `<svg>` and the type beside it is three letters, the heading carries the whole greeting as its accessible name and the lockup is `aria-hidden` — a heading that announced "Welcome to ixus" would be the route-change focus target on every launch. **And the gradient's pink end measures ~2.5:1 on `{colors.bg}`, which is intentional and permitted only because this is a logotype:** WCAG exempts text that is part of a brand name from contrast requirements, and the accessible name is what carries the greeting. The contrast check this spine puts in CI must exempt the wordmark by name rather than flatten it — the "fix" for a failing measurement here would be deleting the identity.
- **One `{components.button-primary}`, full width, `size=lg`.** Cloud sign-in is the primary action and the only brand fill on the screen. Account creation sits directly beneath it as a `link`-variant control — brand ink, no fill, self-centred, sharing the CTA's browser-return note because it leaves the app the same way. It is the same flow with a different Hosted UI entry, not a second action, so it never becomes a second filled button. Everything local is reached through a low-emphasis disclosure below both — a ghost trigger, hairline-separated, never a second filled button. `{typography.caption}` under the CTA carries the browser-return note, because the flow leaves the app and a user who is not told that reads the silent window as a dead button.
- **The separating rule uses `{colors.line-strong}`, not `{colors.line}`.** This hairline sits on `{colors.bg}` rather than inside a card, where `{colors.line}` measures **1.13:1** in light and effectively disappears; `{colors.line-strong}` measures 1.36:1 light and 1.95:1 dark. A call-site token choice — the global hairline value stays exactly as Elevation & Depth describes it, deliberately.
- **The decorative column is a diagram, not a texture.** It says *one app, several ways of working*: a Nixus hub holding the canonical mark, the two shipped modules (`Wallet`, `Car` — the rail's own icons) linked to it with solid `{colors.line-strong}` rules, and Nixus Cloud drawn as a **dashed, `{colors.ink-faint}` optional** fourth node. That asymmetry is the product: local works alone, cloud is additive. It is `aria-hidden` with nothing focusable, drawn from live DOM primitives and token classes — no raster asset, no shadow, and **no surface gradient: the mark's own gradient is the only one present**, which is `{components.logo-gradient}`'s existing rule rather than an exception to it. Node columns are `auto` and connector columns `1fr`, so the links meet the nodes by construction — a diagram whose lines stop short of its nodes reads as broken rather than connected. Never grey placeholder bars, which on a launch screen read as a skeleton that never resolves.

→ Composition reference — the spine wins on conflict with all of them:
[Onboarding](.working/key-onboarding.html) · [Transactions](.working/key-transactions.html) · [Financial Health](.working/key-financial-health.html) · [Settings](.working/key-settings.html) · [Direction exploration](.working/directions-3.html) · [Transactions scope comparison](.working/transactions-compare.html)

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use `{colors.brand}` for brand and action only | Use it for "good," "on track," or as chart color 1 |
| Set money in `{typography.money}` — Inter, tabular | Set money in a monospace font |
| Pair every status color with a text label | Rely on hue alone to carry meaning |
| Reach for `{colors.premium-ink}` for the entitlement | Reuse `{colors.caution}` because both are gold |
| Keep the entitlement on the account trigger and inside its menu | Repeat a durable account fact across unrelated surfaces |
| Differentiate `caution` from `over` by **shape** too | Assume amber and crimson read apart under CVD |
| Reach for a token | Write `emerald-600`, `teal-700`, `rose-500`, `amber-500` |
| Reach for a type role | Write `text-[32px]` or `text-[10px]` |
| Keep uppercase for badges | Set column heads or axis ticks in uppercase |
| Separate with hairlines and tone | Add `shadow-sm` to a card |
| Assign chart colors by **rank order** | Pin a chart color to a category identity |
| Draw the 1px segment divider | Let two same-luminance steps touch bare |
| Label chart segments directly above 5 | Ship a legend the user must cross-reference |
| Put charts on `{colors.card}` | Put charts directly on `{colors.bg}` |
| One `{typography.display}` figure per surface | Two huge numbers competing on one screen |
| Keep the gradient on the logo | Put the gradient on a surface or a button |
| Attach entitlement styling to the account it describes | Put account status beside the Nixus wordmark |
| Paint the launch `<h1>`'s brand as the mark plus "ixus" | Draw a second free-standing mark above a heading that already contains one |
| Let the launch composition stack when two columns stop holding | Ship a decorative column that clips or forces a sideways scroll |
| Build a decorative panel from the mark, hairlines and `{colors.brand-soft}` | Fill it with grey bars that read as a skeleton |
| Draw focus as ring **plus** surface offset | Assume one ring color works on a filled button |
| Give disabled controls a token **and** `aria-disabled` | Dim a control and call it disabled |
| Keep `{colors.ink-faint}` to card, page, chrome, rail | Reuse it on an unverified surface |
| Verify contrast in **both** modes, in CI | Assume a light-legible color survives dark |
| Handle `forced-colors` for Windows | Ship hairline-only elevation to HCM users untested |
| Design at 1024 × 680 first | Assume 1280 and let the minimum window break |
| Bundle woff2 fonts locally | `@import` Google Fonts in a local-first app |
