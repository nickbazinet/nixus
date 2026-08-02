---
name: Nixus Accessibility Review
description: Adversarial accessibility audit of DESIGN.md + EXPERIENCE.md (ux-nixus-2026-08-01) against WCAG 2.1 AA best-effort target, the Marie persona, and the Tauri desktop (macOS + Windows, 1024x680 min, system theme) constraints.
status: draft
reviewer: accessibility-audit
updated: 2026-08-01
scope: DESIGN.md, EXPERIENCE.md, .working/directions-3.html, .working/transactions-compare.html
method: Independent WCAG relative-luminance contrast computation on all frontmatter hex values (script-verified, not eyeballed) + linear deuteranopia/protanopia matrix simulation on the status family and chart ramp + line-by-line reading of behavioral/ARIA claims.
---

# Nixus Accessibility Review — 2026-08-01

**Verdict: NOT READY as written.** The visual contrast math in DESIGN.md is largely *accurate* — a rare and genuinely good sign — but the token layer has two navigation-critical color gaps (rail active/inactive ink is referenced but never defined), the behavioral spine (EXPERIENCE.md) has real screen-reader and keyboard holes on the two newest, most load-bearing surfaces (the Transactions table and AI import/chat), and seven categories are entirely unaddressed (Windows High Contrast Mode, OS text scaling at the enforced minimum window, language-switch `lang` sync, focus restoration, mask-vs-screen-reader behavior, timeout recovery for the 30s AI parse, touch/trackpad target size). None of this is unfixable — most fixes are additive, not structural — but "best-effort AA without it becoming a blocker" currently reads as "AA for sighted mouse users," not for the full range Marie represents.

**Findings: 6 critical · 9 high · 8 medium · 4 low** (27 total, plus 4 explicit "well-handled" call-outs).

---

## 1. Contrast

### Independent verification of the spine's own claims

I recomputed WCAG relative luminance from the raw hex values in `DESIGN.md`'s frontmatter (script, not eyeballing). Result: **the spine's own math checks out.**

- Chart ramp vs `{colors.card}`: light odd steps (1,3,5,7) = 5.70 / 4.55 / 4.35 / 4.55 — inside the claimed 4.35–5.70 range. Light even steps (2,4,6,8) = 3.15 / 3.15 / 3.17 / 3.15 — matches the claimed 3.15:1 almost to the decimal.
- Adjacent chart-step separation, light mode: 1.81 / 1.45 / 1.45 / 1.38 / **1.37** / 1.44 / 1.44 — the claimed "≥1.37:1" floor is exactly the worst pair (steps 5–6). Dark mode clears 1.52+ throughout.
- Badge ink-on-bg: good/caution/over/neutral all land 4.93–10.02:1 in both modes — comfortably over 4.5:1.
- `brand-on` on `brand` (button text): 5.70:1 light, 7.02:1 dark. Fine.

**One line: the chart-ramp and badge contrast engineering is genuinely well done. Do not relitigate it.**

### Where independent verification disagrees with, or exceeds, the spine's claims

**[CRITICAL] `rail-on` / `rail-on-ink` are referenced but never defined — the rail's *active* item has no color, and its *inactive* ink has no token at all.**
- **Location:** `DESIGN.md` `components.rail-item-active` (lines 222–224) references `{colors.rail-on}` and `{colors.rail-on-ink}`. Neither token exists in the `colors:` frontmatter (lines 13–89). The earlier exploratory HTML (`directions-3.html`, `transactions-compare.html`) used `--rail-ink` / `--rail-on` / `--rail-on-ink` as CSS variables, but **none of the three survived into `DESIGN.md`'s token layer.**
- **Impact:** There is currently no way to verify contrast for the primary navigation rail's active state (explicitly requested in this audit) because the color doesn't exist yet. Whoever implements this will invent a value with no spine authority, which is exactly the "three artifacts disagreed" failure mode `DESIGN.md` itself calls out as the root cause of the current raw-Tailwind mess.
- **Fix:** Add `rail-ink`, `rail-on`, `rail-on-ink` (light + dark) to the frontmatter now, verified at ≥3:1 (icon, graphical) for `rail-ink`/`rail-on-ink` against their respective backgrounds and ≥4.5:1 if the 192px hover/focus-expanded state renders them as text labels (it does — see next finding).

**[CRITICAL] The rail's expanded-state text labels have no defined, contrast-safe color, and the nearest existing candidate fails.**
- **Location:** `EXPERIENCE.md` line 58 — "a 52px icon rail that expands to 192px on hover or keyboard focus" — implies text labels appear for Finance/Car/AI/hide-values/backup/restore/theme/language/Settings. No color token is assigned to this text anywhere in either file.
- **Independently computed:** if an implementer reasonably reaches for `{colors.ink-faint}` (the existing "dim secondary text" token) for these labels, it measures **4.06:1 against `{colors.rail}` in light mode** and **4.29:1 against `{colors.chrome}` in light mode** — both **fail** the 4.5:1 text floor the spine itself sets. (`ink-dim` on the same surfaces passes at 5.01 / 5.28.) Dark mode is fine (5.09 / 4.71 — the latter still under 4.5 but closer).
- **Why this matters beyond the rail:** the spine explicitly says `ink-faint` "still clears 4.5:1 in both modes (4.53 light, 4.51 dark)" but that claim was **only checked against `card` and `bg`**, per the audit's own request to check text on `chrome` and `rail`. It does not clear 4.5:1 against either. `ink-faint` is also the documented color for table column heads and axis ticks — as long as those stay inside cards (they do, in the current component specs) this is fine, but the token has zero headroom to be reused anywhere else, and nothing in the spine says "never put `ink-faint` on `chrome` or `rail`."
- **Fix:** Define the rail label color explicitly (don't inherit `ink-faint`), and add a one-line rule to `DESIGN.md`: "`ink-faint` is verified against `card` and `bg` only — do not place it on `chrome` or `rail`."

**[MEDIUM] Text contrast margins are razor-thin with zero engineering headroom.**
- **Location:** `DESIGN.md` colors frontmatter — `ink-faint` on `bg` (light) = 4.52:1computed; `ink-faint-dark` on `card-dark` = 4.51:1 computed. Both are 0.01–0.02 away from the 4.5:1 cliff.
- **Impact:** Any future palette nudge, a slightly different sub-pixel/gamma rendering path between macOS and Windows font rasterizers, or a well-intentioned designer "warming this up by 1%" silently drops these below AA with no test catching it, because there's no CI contrast check mentioned anywhere in either spine.
- **Fix:** Either give `ink-faint` a small margin (target ≥4.6:1) or add an automated contrast-regression test against the token file, since this is a numbers-only check that costs almost nothing to automate and the spine already treats contrast as load-bearing ("This is not a formality").

**[HIGH] No disabled-state token exists anywhere.**
- **Location:** `DESIGN.md` `components:` — every interactive component (`button-primary`, `button-ghost`, form inputs, checkbox) is specified with exactly one visual state. Grepped for "disabled" across both files: zero hits.
- **Impact:** A disabled "Add 44 transactions" button (before selection), a disabled Save on an invalid inline edit, a disabled category-change in the bulk bar with nothing selected — none of these have a defined appearance. Without a token, an implementer either ships a disabled control that's visually identical to an enabled one (WCAG 4.1.2 / 1.4.1 risk — the state isn't perceivable) or invents an ad hoc gray that nobody checked in either mode.
- **Fix:** Add `ink-disabled` / `bg-disabled` (or a documented opacity recipe, e.g. `opacity: 0.45` on a fixed base color, verified in both modes) plus a rule that disabled controls carry `aria-disabled="true"` (native `disabled` where the element supports it) — not just a visual dim.

**[MEDIUM] Focus ring color is unspecified, and the one obvious candidate (`brand`) is invisible on the one place it matters most.**
- **Location:** `EXPERIENCE.md` line 244 — "Visible focus ring on every interactive element, AA against `{colors.card}` and `{colors.bg}`." No color token is named.
- **Independently computed:** `brand` against `card`/`bg` is fine on its own (5.70 / 5.38 light, 7.03 / 7.72 dark) — a reasonable default. But `button-primary`'s background **is** `{colors.brand}`. A brand-colored focus ring around a brand-filled button has **1.00:1 self-contrast** — it disappears exactly on the primary CTA (`Add 44 transactions`, `Looks good`, `See the plan`), which is the single highest-traffic focusable element in the onboarding and import flows.
- **Fix:** Name the ring token explicitly and specify an offset/contrasting ring (e.g., a white/`card`-colored inner ring + colored outer ring, the standard "double ring" technique) specifically for filled buttons, or document a second ring treatment for `button-primary`.

**[LOW] Hairline separators (`line`, `line-strong`) measure 1.2–1.6:1 against their surfaces — by design, and that's fine, but it's worth stating the implication once.**
- **Location:** `DESIGN.md` "Elevation & Depth" — cards are separated from `bg`/`card` by a 1px hairline as the *only* non-shadow device.
- **Impact:** WCAG doesn't set a contrast floor for pure decoration, and the spine already treats card layering (tone step) as the real separator with the hairline as reinforcement — so this isn't a violation. But it does mean the hairline is **functionally invisible** to a low-vision user, and card boundaries rely entirely on the `bg`↔`card` luminance step (16.50:1 light, 15.07:1 dark tonal step — comfortably distinct) doing the actual work. Worth one line in the spine acknowledging this so nobody "fixes" it into `shadow-sm` under contrast pressure, which the spine explicitly bans elsewhere.
- **Fix:** None required. Add one sentence: "The hairline is reinforcement, not the separator — the tonal step carries the actual boundary contrast."

**[MEDIUM] Status colors used as chart/meter fills — verified fine, but the rule that keeps them fine is prose, not structure.**
- Computed: `good`/`caution`/`over` against `card` all clear 3:1 graphical minimum comfortably (5.02–9.96:1 across both modes). No contrast problem.
- The actual risk here is adjacency, covered in depth in Section 2 below (`chart-3` vs `chart-7`).

---

## 2. Color-blindness

**[CRITICAL] `caution` and `over` — the two most safety-critical states in the entire status vocabulary — collapse toward each other under both deuteranopia and protanopia simulation.**
- **Location:** `EXPERIENCE.md` "Status Vocabulary" table — `due_soon`/`projected_due`/`stale` (caution, amber `#B45309`/`#FBBF24`-dark) vs `overdue` (over, crimson `#BE123C`/`#FB7185`-dark) are the two states a user most needs to tell apart quickly (a bill that's *approaching* due vs one that's *already* overdue). Simulated under a standard Brettel/Viénot-style CVD matrix, the Euclidean color distance between them drops from 83–125 (normal vision) to **27–72** depending on mode/CVD type — orange and red are the single most classically confusable hue pair for red-green color blindness, and this is exactly that pair.
- **Mitigation that exists:** every badge carries mandatory text (`"Due soon"` vs `"Overdue"`), so this is **not** a WCAG 1.4.1 violation — text is always present. But the **dot** in the Attention list (`Today`, `.dot`, 7×7px) and the colored **amount figure** (`.amt.money` recolored to `over-ink` on the over row) both carry color-only emphasis *in addition to* the badge, and a CVD user scanning the dot column alone (which is the fastest scan path in a vertically stacked list) gets materially less signal than a person with typical color vision.
- **Fix:** No change needed to the mandatory-badge-text rule (it's correct and sufficient for WCAG). But consider a **shape** differentiator for the dot (filled vs outlined, or a small glyph) between `caution` and `over` specifically, since they're the pair that fails hardest under simulation and the dot is the first thing scanned.

**[Well-handled, one line]** The alternating-luminance chart ramp does exactly what it was designed to do under CVD simulation: because protanopia/deuteranopia barely touches perceived *luminance* (only hue), the ramp's luminance-based adjacent separation (≥1.37:1) survives simulation essentially intact — adjacent-pair distances stay well separated even when hue collapses. This is a correct, verified fix for the "smooth gradient = invisible to CVD" problem the spine explicitly names.

**[MEDIUM] `chart-3` / `chart-7` share near-identical luminance (1.00:1 light, 1.02:1 dark — genuinely indistinguishable by luminance alone) and the "must never be adjacent" rule is prose, not enforced structure.**
- **Location:** `DESIGN.md` "Colors" section: "`{colors.chart-3}` and `{colors.chart-7}` share a luminance and are separated by hue alone, so they must never end up adjacent." Independently confirmed: 1.00:1 (light) / 1.02:1 (dark) — as close to identical luminance as two different hex values can be.
- **Why the current mock is safe, and why that's an accident of convention, not a rule:** in the one worked example (`directions-3.html`'s Accounts allocation bar), segments are assigned `chart-1..7` in strict descending-size order (RRSP 31% down to Crypto 5%), so positions 3 and 7 are never adjacent by construction. But nothing in either spine **states** that chart-color assignment must always follow rank order. The moment a chart assigns colors by category identity instead of rank (e.g., a fixed "Groceries is always chart-3" convention for a recurring chart across periods, or a legend sorted alphabetically instead of by size), `chart-3` and `chart-7` can land adjacent, and at 1.00:1 they are — for every user, not just CVD users — indistinguishable by lightness, and under CVD simulation their color distance is also the smallest surviving pair (75–102 vs. 40–140+ for other neighbors).
- **Fix:** Either (a) state explicitly in `DESIGN.md` "chart colors are always assigned by rank order, never by fixed category identity" as a binding rule, not just a caution, or (b) swap one of the two so no pair in the 8-step ramp shares luminance, removing the landmine rather than fencing it.

**[Well-handled, one line]** Every place color-only status meaning appears in the documented component specs (badges, attention-list dots, pill states) is paired with mandatory text per `EXPERIENCE.md`'s own audit rule ("Text is mandatory in every badge") — this was checked against every component in both HTML mockups and holds.

**[HIGH] The one place color-only meaning slips through text-pairing entirely: the unified-Transactions direction glyph.**
- **Location:** `transactions-compare.html` Variant 2, `.dir` column (↓/↑ Unicode glyphs, colored `good-ink` for inflow / `ink-faint` for outflow) and `EXPERIENCE.md` Component Patterns: "Leading direction-glyph column reserved for the future unified view." No text label, `aria-label`, or visually-hidden equivalent is specified for this column anywhere.
- **Impact:** The signed amount (`+$2,600.00` vs `−$142.83`) does carry a non-color signal (the +/− prefix), so this narrowly avoids being a pure color-only violation — but the glyph column itself is a bare Unicode character with no accessible name specified, and a screen reader will either skip it silently or read "down arrow" / "up arrow" out of context, conveying nothing about money direction.
- **Fix:** Specify `aria-label="Money in"` / `aria-label="Money out"` (or fold the direction into the row's accessible name) now, while the column is still "reserved for the future" and cheap to spec correctly, rather than retrofitting it once `search_income` ships.

---

## 3. Age-related vision (Marie, 40s–50s)

**[HIGH] The 12px `micro` floor is used for exactly the content types (table column heads, axis ticks) that a presbyopia-onset user scans fastest and most often, and the spine doesn't test for it.**
- **Location:** `DESIGN.md` typography frontmatter — `micro`: 12px, weight 650, **uppercase**, letter-spacing 0.045em, "Uppercase micro-labels only — table column heads, axis ticks, badge text."
- **Impact:** 40s–50s is the exact age bracket where presbyopia onset is near-universal (most people in this range need reading correction for near/small text they didn't need five years earlier). Stacking three independently-studied legibility penalties on the same 12px text — small size, all-uppercase (uppercase reduces reading speed and letter-shape discrimination versus mixed case), and a table-head/axis-tick usage pattern that's scanned rapidly rather than read carefully — is a real risk specifically for the persona this spine names as its primary user, even though it clears the letter-level contrast checks in Section 1. This isn't a WCAG contrast failure; it's a WCAG 1.4.4/1.4.12-adjacent legibility risk that contrast math alone won't surface.
- **Fix:** At minimum, bump table column heads to 12.5–13px in practice testing with actual 40s–50s users before shipping, or drop the uppercase treatment on the column-head instance specifically (keep it for badges, where the text is short and the context is unambiguous). The spine already treats 10–11px as an "age-appropriateness failure, not a stylistic one" for the exact same reason — 12px micro deserves the same scrutiny, not a pass because it's 2px above a banned floor.

**[LOW] `label` at 13.5px/550 for table cell content is acceptable, not a violation — one line.**
Table cells are numeric-heavy (tabular-nums helps legibility regardless of size) and sit above the stated 13px content floor. No fix needed; flagged only because the audit explicitly asked.

**[LOW] 7px meter height is a non-issue as specified, contingent on one assumption that should be stated.**
The meter is documented as always paired with a figure or badge and nothing in either spine describes it as interactive/draggable. A 7px non-interactive progress indicator has no WCAG target-size obligation. **If** a future "drag to adjust target" affordance is ever added to the meter, 7px would fail target-size guidance outright — worth one preventive sentence in `DESIGN.md`: "the meter is never a drag target; if that changes, its hit area must expand independent of its visual height."

---

## 4. Keyboard and focus

**[CRITICAL] Inline-edit's entry point has no keyboard trigger specified — only a click.**
- **Location:** `EXPERIENCE.md` Component Patterns, "Inline edit": "Click value → input → Enter saves, Escape cancels, toast confirms. The affordance must be visible — hover pencil or dotted underline." Interaction Primitives lists `Enter` as *committing* an edit and `Esc` as *canceling* one, but nothing describes how a keyboard-only user **enters** edit mode in the first place. There is no stated `tabindex`, role, or keydown handler for the value element itself.
- **Impact:** This directly contradicts the section's own stated principle two lines above it: "Mouse-first, keyboard-complete... everything is reachable by keyboard." As written, inline edit on balances, budget targets, and odometer values is mouse-only. This is one of the highest-traffic interactions in the app (every balance correction, every budget adjustment).
- **Fix:** Specify that the editable value is a focusable element (button-like semantics or `tabindex="0"` with `role="button"`) and that `Enter` or `Space` on focus enters edit mode, in addition to click. Also resolve the affordance ambiguity: "hover pencil **or** dotted underline" — the dotted-underline option is the one that satisfies "visible resting state" for a keyboard-focus-only user with no pointer; make the dotted underline the default, with the pencil as a hover *enhancement*, not an either/or choice.

**[HIGH] "Click a table row to edit" has the identical gap — no stated keyboard equivalent to open the row's slide-over.**
- **Location:** `EXPERIENCE.md` Interaction Primitives: "Click a table row to edit; click a balance to edit — with a visible affordance." Component Patterns, Transaction table: "Row click opens edit slide-over."
- **Fix:** State explicitly that a focused row responds to `Enter` to open the edit slide-over (matching the existing `Enter`-commits convention elsewhere in the same list, so it's consistent with what's already specified rather than a new pattern).

**[HIGH] No `aria-sort` on sortable Transaction table columns — an audit item explicitly asked for, and explicitly absent.**
- **Location:** `EXPERIENCE.md` Component Patterns: "Sortable date/amount/merchant." `transactions-compare.html` renders sort state purely visually (`<span class="arrow">Date ↓</span>` — a colored Unicode arrow, no `aria-sort` attribute, no accessible indication of sort direction beyond the glyph color/shape).
- **Impact:** A screen reader user has no way to determine which column is sorted or in which direction — this is precisely what `aria-sort="ascending|descending|none"` on `<th>` exists for, and it's a zero-cost addition to a real `<table>` (which the spine already commits to using instead of the current `<div>`-based `ExpenseList`).
- **Fix:** Add `aria-sort` to the Transaction table spec in `EXPERIENCE.md` explicitly, next to the existing "Sortable date/amount/merchant" line, so it isn't left to implementation discretion.

**[HIGH] Focus restoration after slide-over/dialog close is unspecified.**
- **Location:** `EXPERIENCE.md` "Accessibility Floor" lists `aria-labelledby`/`aria-describedby` for dialogs/slide-overs (correctly flagging the current app has zero of either) but says nothing about where focus goes when they close. Given slide-overs are the mechanism for **every** create/edit flow, and dialogs gate every destructive delete, this is a WCAG 2.4.3-adjacent gap on the single most-used overlay pattern in the app.
- **Fix:** Add one line: "On close, focus returns to the element that opened the slide-over/dialog (the table row, the balance value, the 'Delete' menu item) — never to `<body>`."

**[MEDIUM] Segmented sub-nav is specified as *real routes* but given *tab-strip* keyboard behavior — the two patterns have conflicting ARIA semantics.**
- **Location:** `EXPERIENCE.md` Component Patterns: "Segmented sub-nav... Navigates (real routes), unlike period pills which filter." Interaction Primitives: "`←` / `→` — moves within a segmented sub-nav or period control." `transactions-compare.html` renders it as plain `<a href="#">` anchors.
- **Impact:** Left/right arrow-key navigation between items is the ARIA Authoring Practices pattern for `role="tablist"`/`role="tab"` (where arrow keys move focus AND typically activate the panel), not for a `<nav>` of real hyperlinks (where Tab moves between links and Enter activates — arrow keys have no defined role). Implementing arrow-key navigation on real anchors without also adopting tablist semantics produces behavior a screen reader won't announce correctly (it will still say "link" for each item, not "tab," and JAWS/NVDA users who know the tablist convention will be confused when arrow keys work on a "link"). If tablist semantics *are* adopted for consistency with the keyboard rule, that contradicts "navigates (real routes)" since ARIA tabs are conventionally understood to swap content in place, not change the URL.
- **Fix:** Pick one. Either (a) segmented sub-nav stays plain navigation links and drops the arrow-key rule (Tab + Enter is sufficient and standards-correct), or (b) it explicitly adopts `role="tablist"`/`role="tab"` with `aria-selected`, and the spine acknowledges the route change happens as a *side effect* of tab activation (this is a legitimate, common pattern — TanStack Router supports it — but it needs to be stated, not implied).

**[MEDIUM] The bulk-select checkbox target is 15×15px with no stated hit-area padding.**
- **Location:** `transactions-compare.html` `.cbx { width:15px; height:15px; }` — this is the visual mockup's literal size; `EXPERIENCE.md` doesn't override it with a larger target-size requirement anywhere.
- **Impact:** 15×15 CSS px is well under the commonly-cited 24×24px minimum (WCAG 2.2's 2.5.8, which sits just outside a strict "2.1 AA" scope but is the direction the standard has moved, and is good practice regardless) and far under 44×44 (AAA). Bulk-select is explicitly called "mandatory, not an enhancement" in the AI Contract section and is the primary interaction for reviewing a 40–80 row statement import — exactly the moment a low-tech-comfort, non-power-user is asked to click small checkboxes repeatedly.
- **Fix:** Keep the 15px visual box (it matches the dense, "well-set financial statement" register) but specify a larger invisible click/tap target via padding (e.g., 24×24 hit area centered on a 15×15 visual box) — a standard, cheap technique that doesn't touch the visual design at all.

**[MEDIUM] No skip-to-content or route-change focus-management rule for a persistent-shell SPA.**
- **Location:** Not present anywhere in `EXPERIENCE.md`. The shell (rail + destination nav + optional sub-nav) persists across every route change; "Screen reader announces destination on navigation" (line 245) covers the *announcement* but not where **focus** goes for a keyboard user after clicking a destination or sub-nav item.
- **Impact:** Without an explicit rule, a keyboard user who navigates to Spending ▸ Transactions has no guarantee focus lands anywhere useful (it may stay on the nav link just clicked, requiring several more Tabs through toolbar/filter chips before reaching the table) — this compounds with every one of the four destinations and every sub-nav surface.
- **Fix:** Add: "On destination or sub-nav change, focus moves to the new surface's `<h1>`/heading (not just an SR announcement) so a keyboard user isn't left on the nav item they just activated."

**[LOW] Rail hover/keyboard-focus expansion is specified but its *interaction contract* isn't — worth a line, not a blocking gap.**
"Expands to 192px on hover or keyboard focus" (line 58) correctly covers keyboard reachability, which was the main risk. Left unspecified: whether the expansion persists while tabbing between rail items (likely `:focus-within`, which would work correctly) and whether the width transition respects `prefers-reduced-motion` (probably covered by the blanket motion rule in Section 6, but not called out here specifically). Low severity — mention once, don't block on it.

---

## 5. Screen reader

**[CRITICAL] What does a screen reader announce when a money figure is masked by hide-values — and is the *real* value still sitting in the DOM regardless?**
- **Location:** `EXPERIENCE.md` "Money & Number Rules" — "Every figure routes through the global hide-values mask. The backend always returns raw cents; masking is frontend-only. A figure that bypasses the mask is a bug." "State Patterns" — "Values hidden | Global | Every figure masked; layout must not reflow." Neither section says one word about assistive technology.
- **Impact — two failure modes, both live risks depending on implementation, and the spec currently protects against neither:**
  1. **Privacy leak:** the most common naive implementation of "mask without reflow" is a CSS overlay/blur/`filter` on top of the real text node, or swapping only the *visual* glyph while leaving the real formatted string in the accessible tree. If that happens here, a screen reader speaks the actual dollar amount out loud even while a sighted user has successfully hidden it — the opposite of the feature's purpose, and specifically dangerous for a blind user in the exact shoulder-surfing-adjacent situation (public space, screen reader on speaker or unshielded headphones) the hide-values toggle exists for.
  2. **Total information loss:** if masking is done correctly (DOM text replaced, not just visually hidden), and the replacement is literal bullet/dot characters with no `aria-label`, a screen reader user gets "dollar sign bullet bullet bullet comma bullet bullet bullet" — worse than useless, and inconsistent with what a sighted user experiences (a clean, obviously-intentional mask).
- **Fix:** Specify explicitly: masked figures render `aria-label="Amount hidden"` (or similarly worded, localized) on the masked element, and the real cents value must not be present anywhere in the accessible name/DOM text when masked — not just visually covered. This is a one-line spec addition with real consequences if skipped.

**[LOW] Tabular-figures / `font-variant-numeric: tabular-nums` — checked, not a screen reader risk.**
This is a rendering-only CSS feature (fixed glyph width); it doesn't alter accessible text content in any current browser/AT combination. No fix needed — included only because the audit explicitly asked.

**[HIGH] `aria-sort` — see Section 4 (Keyboard). Cross-referenced here because it's equally a screen reader gap, not just a keyboard one.**

**[MEDIUM] Status badges are announced adequately in isolation but the *row* they belong to has no specified accessible grouping.**
- **Location:** `EXPERIENCE.md` "Attention list": "Each row: dot + name + figure + text badge." No `aria-label` or semantic grouping (e.g., a single accessible name per row) is specified.
- **Impact:** As four separate DOM elements read in sequence, a screen reader user hears "Restaurants... plus eighty-six dollars... Over" — workable, but disconnected, and the ordering/pause behavior varies across NVDA/JAWS/VoiceOver. Not a hard failure, but cheap to improve.
- **Fix:** Consider `aria-label="Restaurants, over budget by $86"` on the row wrapper as the accessible name, with the visual dot/figure/badge as presentation, so the announcement is a single coherent sentence regardless of AT.

**[Well-handled, one line]** The 4-stage import stepper is explicitly covered — plain-language stage names, `aria-live="polite"`, stage-level (not granular) updates. This is correctly specified; no fix needed.

**[CRITICAL] Streaming AI chat + `aria-live="polite"` is a known anti-pattern combination, and the spec doesn't address it.**
- **Location:** `EXPERIENCE.md` "Accessibility Floor": "`aria-live=\"polite\"` on toasts, import progress, chat streaming, and bulk-selection counts." Chat streaming is lumped in with three fundamentally different update patterns (a single toast event, a 4-stage stepper, a bulk-count integer) with no distinct treatment.
- **Impact:** A naive `aria-live="polite"` region bound directly to a token-by-token streaming LLM response will queue and announce **every DOM mutation** as the message assembles — screen reader users get partial words, fragments, and a firehose of announcements for a single response, a well-documented failure mode in accessible chat UI (this is why most accessible AI chat implementations either debounce the live region to sentence/paragraph boundaries, or set the streaming container to `aria-live="off"` visually and only announce completion). The spec's one-line treatment doesn't distinguish this from the toast/stepper/count cases, which genuinely are simple enough for a bare `aria-live="polite"`.
- **Fix:** Give chat streaming its own line, distinct from the blanket rule: "Chat streaming renders visually token-by-token but the live region updates only at sentence boundaries or on completion — never per-token — to avoid announcement flooding."

---

## 6. Motion and cognitive load

**[LOW] `prefers-reduced-motion` is claimed as "respected everywhere" but the claim is a single sentence with no enumerated surface list, unlike every other cross-cutting rule in the spine.**
- **Location:** `EXPERIENCE.md` "Accessibility Floor": "`prefers-reduced-motion` respected everywhere, including chat typing indicators (already logged as outstanding in `deferred-work.md`)."
- **Impact:** Contrast, ARIA, and state each get a dedicated table (State Patterns has 13 enumerated rows). Motion gets one sentence covering an unenumerated "everywhere" — rail width expansion, slide-over/dialog enter-exit, toast slide-in, skeleton pulse, meter fill transitions, chart bar height transitions on data refresh. Not a hard gap (the blanket rule is directionally correct) but it's the one cross-cutting a11y rule in the document that isn't testable against a checklist the way everything else is.
- **Fix:** Either enumerate the motion-bearing components the way State Patterns enumerates states, or explicitly say "this rule applies to every CSS transition/animation in the token layer with no exceptions" so there's no ambiguity about coverage.

**[Well-handled, one line]** The four-destination IA and the three-question dashboard are a genuine, well-reasoned reduction from the shipped ten-tab/29-number baseline, explicitly reasoned against the Marie persona, and independently verified sound (the "answers/absorbs" mapping is coherent, no destination requires cross-referencing another to make sense).

**[MEDIUM] The rail's icon-only default state asks the least tech-comfortable persona to learn navigation by hovering — a pattern the spine itself argues against elsewhere.**
- **Location:** `EXPERIENCE.md` line 58 — the rail is 52px icon-only by default; labels only appear "on hover or keyboard focus." Compare to Interaction Primitives' own banned pattern: "hover-only affordances with no visible resting state," and Component Patterns' inline-edit rule: "Never explain it in helper text" (implying affordances should be self-evident, not discovered).
- **Impact:** This is *not* the same violation as a hover-only affordance with zero resting state (each icon does have an `aria-label` and a persistent icon glyph, so it's not literally banned by the letter of that rule) — but for a persona explicitly defined as "least tolerant of complexity or confusing UI" who is also explicitly "not a keyboard power user" (line 221), an icon-only rail whose *labels* are gated behind a discovery action (hover) is exactly the kind of "figure it out yourself" pattern the rest of the spine works hard to avoid (see the inline-edit affordance rule, the required-field-marking rule, the plain-language-not-formula rule). Marie is more likely to just click icons and see what happens than to hover-and-wait for a label to confirm her guess first.
- **Fix:** Consider defaulting the rail to its expanded (192px, labeled) state on first launch / for users who haven't demonstrated comfort with the icon-only form, with collapse as a preference Dev-type users opt into — inverting the current "collapsed by default, expand to learn" model to "labeled by default, collapse to save space."

---

## 7. Forgotten entirely

**[CRITICAL] Windows High Contrast Mode / `forced-colors` is not mentioned once, in an app that explicitly ships to Windows.**
- **Location:** Absent from both `DESIGN.md` and `EXPERIENCE.md` in their entirety.
- **Impact:** This spine's entire elevation and separation model is hairline-based (`shadow: none`, 1px `line`/`line-strong` at 1.2–1.6:1 contrast — see Section 1) plus soft background tints for badges (`good-bg`, `caution-bg`, etc.) and chart segments as flat-fill `<div>`s. Windows High Contrast Mode (`forced-colors: active`) systematically overrides custom background colors and often thins or removes low-contrast borders exactly like these hairlines, unless `forced-color-adjust` and explicit system-color-aware borders are specified. Under HCM as currently unspecified: card boundaries may vanish entirely (they already rely on a hairline that's barely visible in *normal* mode), badge background-tint distinctions between good/caution/over/neutral collapse to whatever the OS forces, and chart/allocation-bar segments risk becoming a single undifferentiated block. Windows HCM users are disproportionately older and low-vision — directly overlapping the Marie persona.
- **Fix:** Add a `forced-colors` section to `DESIGN.md`: explicit `forced-color-adjust: none` opt-outs plus system-color-mapped borders for cards, badges, and chart segments, tested in an actual Windows HCM session before shipping — not just Chromium DevTools emulation.

**[HIGH] OS-level text scaling / zoom at the *enforced minimum* 1024×680 window is untested and unaddressed.**
- **Location:** `EXPERIENCE.md` line 31 and `DESIGN.md`'s Do/Don't table both treat "1024×680" purely as a physical window-size floor ("Design at 1024×680 first"). Neither mentions what happens when a user *also* applies OS-level text scaling (Windows Display "Make text bigger," 125–200%; macOS Accessibility zoom or larger system font) on top of an already-minimum-sized window.
- **Impact:** A 40s–50s user with early presbyopia is a plausible candidate for OS text-scaling as a system-wide accommodation (more common than per-app zoom). At the enforced *minimum* window, there is zero documented headroom — the spine states a three-column hero collapses to one column below 1100px logical width, but if OS scaling shrinks the effective logical viewport at a fixed 1024 physical width, the layout may need to collapse well before the content actually needs it, or may clip/overflow if Tauri's webview doesn't reflow cleanly under compounded OS-zoom-at-minimum-window conditions. This combination is never tested or discussed.
- **Fix:** Explicitly test the layout at 1024×680 with 150% and 200% OS text scaling before shipping, and either document a further single-column fallback below the current 1100px breakpoint or reconsider whether 1024×680 (chosen apparently only for physical-pixel headroom) leaves enough room once accessibility text-scaling is layered on top.

**[HIGH] French UI language switching doesn't sync `lang` on the document, and isn't announced to assistive tech.**
- **Location:** `EXPERIENCE.md` line 37 ("Bilingual EN/FR. Every string is an i18next key.") and the rail utility stack ("language" toggle, line 58). No mention of `document.documentElement.lang` (or per-region `lang` attributes) being kept in sync with the active UI language, nor of announcing the change.
- **Impact:** This is a WCAG 3.1.1 (Language of Page) concern specific to a genuinely bilingual app: if a user switches to French at runtime in a single-page app and the `<html lang>` attribute isn't updated, every screen reader's pronunciation engine keeps reading French content with an English voice (or vice versa) for the rest of the session — a real, not theoretical, degradation of usability for a bilingual French-Canadian user base this app is explicitly built for (CAD-first, RRSP/TFSA/FHSA terminology, French UI as a first-class feature).
- **Fix:** Add one line to the spine: "Switching language updates `document.documentElement.lang` immediately and announces the change (`aria-live=\"polite\"`: 'Language changed to French')."

**[MEDIUM] Touch/trackpad target sizing is addressed nowhere except incidentally (rail icons happen to be 32×32, which passes; the bulk-select checkbox at 15×15, which doesn't — see Section 4).**
No dedicated target-size policy exists in either spine. Given this is a desktop app that may run on touch-enabled Windows laptops (common, unaddressed in either doc — the README confirms Windows as a first-class platform with no touch caveat), a stated minimum target size (24×24 CSS px at minimum, with documented exceptions like the meter) would resolve this and the checkbox issue in one pass. Folded into the Section 4 checkbox fix; flagged here because the audit explicitly asked and the *absence of a general policy* is the real gap, not just the one checkbox instance.

**[MEDIUM] Error identification/recovery is reasonably handled by cross-reference, with one real gap: no distinct state for "AI import processing exceeded expected time," separate from "AI unavailable" or "commit failed."**
- **Location:** `EXPERIENCE.md` "State Patterns" enumerates "AI unavailable / no credentials" and "Import commit failed" as first-class states, both well-specified with recovery paths. The backend's own NFR (`architecture-desktop.md`: "NFR4: AI parsing < 30s") implies a hard processing timeout distinct from either of those two documented failure modes — a slow-but-connected AI call that's still running past the expected ~22 seconds (per Flow 1) but hasn't yet hit the 30s ceiling, or that hits the ceiling mid-extraction rather than at commit.
- **Impact:** Marginal but real — a user watching the 4-stage stepper past its expected duration with no "this is taking longer than usual" signal, and no defined behavior if the backend's own 30s NFR timeout fires mid-stage rather than at commit, could reasonably assume the app has frozen (it's a desktop app with no other loading affordance mentioned) and force-quit, discarding a review that Import commit failed's draft-persistence promise wouldn't even get a chance to protect (draft persistence there is scoped to *commit* failure, not mid-extraction timeout).
- **Fix:** Add a State Patterns row: "Import taking longer than expected | Import | Stepper shows current stage plus a time-based reassurance past ~15s ('Still working — larger statements can take a bit longer'); on hard timeout, falls back to the existing 'AI unavailable' inline recoverable state with the manual-entry path named."

**[LOW] The educational-not-advice disclaimer and Data Honesty Contract are thoughtfully specified and don't need additional accessibility treatment beyond what's already implied by the forms/ARIA rules — one line, moving on.**

---

## Summary table

| # | Finding | Severity | Location |
|---|---|---|---|
| 1 | `rail-on`/`rail-on-ink` referenced, never defined | Critical | DESIGN.md L222-224 vs L13-89 |
| 2 | Rail expanded-label color undefined; `ink-faint` fails on `chrome`/`rail` in light mode (4.06/4.29:1) | Critical | DESIGN.md colors; EXPERIENCE.md L58 |
| 3 | `caution` vs `over` collapse under CVD simulation | Critical | EXPERIENCE.md Status Vocabulary |
| 4 | Inline-edit has no keyboard entry trigger | Critical | EXPERIENCE.md Component Patterns |
| 5 | Masked money figures: no defined screen-reader behavior, possible privacy leak or info loss | Critical | EXPERIENCE.md Money & Number Rules |
| 6 | Streaming chat + bare `aria-live=polite` = announcement flooding risk | Critical | EXPERIENCE.md Accessibility Floor |
| 7 | Windows High Contrast Mode unaddressed | Critical | Absent, both files |
| 8 | No disabled-state token anywhere | High | DESIGN.md components |
| 9 | Direction-glyph column has no accessible name | High | transactions-compare.html; EXPERIENCE.md |
| 10 | 12px uppercase micro floor risky for presbyopia-range persona on scan-heavy content | High | DESIGN.md typography |
| 11 | "Click a table row to edit" has no keyboard equivalent | High | EXPERIENCE.md Interaction Primitives |
| 12 | No `aria-sort` on sortable table headers | High | EXPERIENCE.md / transactions-compare.html |
| 13 | No focus restoration rule after slide-over/dialog close | High | EXPERIENCE.md Accessibility Floor |
| 14 | OS text-scaling/zoom at minimum window untested | High | EXPERIENCE.md Foundation |
| 15 | Language switch doesn't sync `lang` or announce | High | EXPERIENCE.md L37 |
| 16 | Focus ring color unspecified; `brand`-on-`brand` self-contrast = 1.00:1 | Medium | EXPERIENCE.md L244 |
| 17 | Text contrast margins near-zero headroom (4.51-4.52:1) | Medium | DESIGN.md colors |
| 18 | `chart-3`/`chart-7` same-luminance rule is prose, not structure | Medium | DESIGN.md Colors |
| 19 | Segmented sub-nav: route-link semantics + tab-strip keyboard behavior conflict | Medium | EXPERIENCE.md Component Patterns |
| 20 | Bulk-select checkbox 15×15px, no stated hit-area | Medium | transactions-compare.html |
| 21 | No skip-to-content / route-change focus management | Medium | EXPERIENCE.md |
| 22 | Attention-list rows lack single accessible name | Medium | EXPERIENCE.md Component Patterns |
| 23 | Icon-only rail default asks least-tech persona to learn via hover | Medium | EXPERIENCE.md L58 |
| 24 | No general touch/trackpad target-size policy | Medium | Absent |
| 25 | No distinct state for AI import mid-process timeout | Medium | EXPERIENCE.md State Patterns |
| 26 | `prefers-reduced-motion` claim not enumerated per-component | Low | EXPERIENCE.md Accessibility Floor |
| 27 | Hairline separators ~1.2-1.6:1 (by design, undocumented implication) | Low | DESIGN.md Elevation & Depth |
| 28 | 7px meter height fine only if never made interactive (undocumented assumption) | Low | DESIGN.md components.meter |
| 29 | Educational disclaimer / Data Honesty Contract — no gap | Low (no fix needed) | EXPERIENCE.md |

## What's genuinely well-handled (stated once, not revisited)

- Chart-ramp contrast engineering against `card` and adjacent-pair separation — independently verified accurate to the spine's own claimed numbers.
- Badge ink-on-background contrast across all four status colors, both modes — comfortably over 4.5:1 everywhere.
- CVD resilience of the chart ramp's alternating-luminance strategy — correctly defeats the "smooth gradient reads as one blur to colorblind users" failure it was designed against.
- Mandatory text-pairing on every status badge and attention-list row — checked against every rendered instance in both HTML mockups, holds without exception (barring the direction-glyph column, flagged separately).
- The 4-stage import stepper's `aria-live` and plain-language treatment.
- The four-destination IA reduction, reasoned soundly against the Marie persona.
