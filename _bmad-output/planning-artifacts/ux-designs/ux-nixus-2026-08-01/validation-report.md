# Validation Report — Nixus

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/EXPERIENCE.md`
- **Run at:** 2026-08-01
- **Lenses:** rubric walker · accessibility audit · Marie persona lens (3 parallel subagents)

## Overall verdict

Three lenses ran in parallel against the first draft of the spine pair: a rubric walker, an adversarial accessibility audit that independently recomputed every contrast ratio, and a persona lens reading the spec as Marie. Between them they produced **72 findings — 9 critical, 21 high**. All three independently confirmed the same strength (the token layer's contrast engineering is sound and verified) and all three found the same class of weakness: the spine committed load-bearing decisions in prose without committing them in structure.

The most serious finding was not a token or an ARIA gap but a **self-contradiction**. Flow 1's walkthrough had the dashboard greet a first-time user with "3.2 months of expenses covered" six minutes after a single statement import and zero entered balances — a figure the app cannot know, and precisely the "appearing to know something it has not earned" failure this spine indicts the old onboarding for, two sections after defining `data_sufficient: false` to prevent it. The persona lens named it as the single most likely close-the-app moment. It is fixed: on day one the insufficient-data state is now the correct and only honest state.

Two reviewer recommendations were **rejected on evidence** after being tested computationally, and replaced with structural alternatives. "Remove the same-luminance chart collision" is impossible at n=8 — an alternating ramp has four steps per luminance band, so repairing 3-vs-7 only relocates the collision to 2-vs-8. And no single focus-ring hex exists that clears 3:1 against both `card-dark` and `brand-dark`; the required luminance ranges are disjoint (≥0.140 and ≤0.098). Rank-order assignment plus a 1px segment divider, and a ring-plus-surface-offset, replace them.

Of 72 findings, **61 are resolved in the spines**, 8 are carried into Open Items as explicit research or scope decisions, and 3 required no change. Two whole capabilities were added that no prior artifact mentioned: **CSV export** — the deepest trust prerequisite for a spreadsheet user, distinct from backup/restore — and **Windows High Contrast Mode**, on a first-class platform whose elevation model is hairline-only.

## Category verdicts

- Flow coverage — **thin** → resolved (2 → 4 Key Flows)
- Token completeness — **adequate** → resolved (1 broken ref fixed, 10 tokens added)
- Component coverage — **thin** → resolved (15 → 28 components)
- State coverage — **adequate** → resolved (13 → 20 states)
- Visual reference coverage — **adequate** → resolved (4 mocks added, citations relocated)
- Bloat & overspecification — **adequate** → resolved (rhetoric trimmed)
- Inheritance discipline — **adequate** → resolved (token names inlined in behavioural rows)
- Shape fit — **adequate** → resolved (Inspiration & Anti-patterns added)

## Findings by severity

### Critical (9)

**[Marie + Rubric]** — A figure the app could not know, six minutes in (§ Flow 1 step 7)
The dashboard rendered "3.2 months of expenses covered" for a user who had imported one statement and entered zero balances, contradicting `data_sufficient: false` defined two sections earlier. Marie's verdict: *"it told me how many months of savings I had and I hadn't even told it what my savings were, so I wasn't sure if I believed the rest of it after that."*
Fix: Flow 1 step 7 now lands on the insufficient-data state with a 1-of-3 progress indicator and no figure, plus an explicit note in the flow explaining why. **Resolved.**

**[Rubric]** — J9 Financial Health had no Key Flow (§ Key Flows)
The product's differentiator had a full PRD worked example and an entire Data Honesty Contract built around it, but no protagonist ever opened the view.
Fix: added Flow 3, with the greyed-out step 4 answering the question she actually arrived with as the climax. **Resolved.**

**[Rubric + A11y]** — `colors.rail-on` / `rail-on-ink` referenced but never defined (DESIGN.md `components.rail-item-active`)
A broken reference inside the machine-readable frontmatter, on the primary navigation rail. A resolver would fail; an implementer would invent a value — the exact failure this spine blames for the existing raw-palette mess.
Fix: added `rail-ink`, `rail-on`, `rail-on-ink` in both modes, verified at 4.5:1 as text because the rail expands to 192px and renders real labels. **Resolved.**

**[Marie]** — "Net for June" would be read as a balance change (transactions-compare.html)
Eleven years of spreadsheet habit is a running balance. The caveat existed only as a note to the builder, never as user-facing copy.
Fix: a net figure is now always labelled against what it is not — "money in − money out — not your account balance." **Resolved.**

**[A11y]** — Masked money figures had no screen-reader behaviour (§ Money & Number Rules)
Two live failure modes: a CSS blur leaves the real amount readable aloud — worst in exactly the public-space scenario the toggle exists for — or a bullet replacement announces "dollar sign bullet bullet bullet."
Fix: masked elements carry a localized "Amount hidden" label; the true value must not remain in the DOM text or accessible name. **Resolved.**

**[A11y]** — Streaming chat bound to a plain live region (§ Accessibility Floor)
Lumped with toasts, stepper, and counts. A live region on a token-by-token LLM stream announces every mutation — partial words, a firehose per response.
Fix: given its own rule — renders per-token visually, announces only at sentence boundaries or completion. **Resolved.**

**[A11y]** — Inline edit had no keyboard entry trigger (§ Component Patterns)
Contradicted the section's own "keyboard-complete" principle two lines above. The highest-traffic interaction in the app was mouse-only.
Fix: the value is a focusable control; `Enter`/`Space` enters edit mode. The dotted underline is now the required resting affordance, not an alternative to a hover pencil. **Resolved.**

**[A11y]** — `caution` and `over` collapse under CVD simulation (§ Status Vocabulary)
Amber against crimson is the most confusable pair for red-green colour blindness, and these are the two states a user most needs to separate. Badge text made it WCAG-sufficient, but the dot column — the fastest scan path — carried hue alone.
Fix: `over` is a filled dot, `caution` is a ring. **Resolved.**

**[A11y]** — Windows High Contrast Mode unaddressed (absent from both files)
Hairline-only elevation, tint-based badges, and flat-fill chart segments are precisely what `forced-colors` overrides. HCM users skew older and low-vision — the primary persona.
Fix: added a forced-colors section — system-colour-mapped borders, scoped opt-outs, verification in a real Windows session rather than DevTools emulation. **Resolved.**

### High (21)

**[Rubric]** — J5 AI chat had no Key Flow → added Flow 4 (Dev via `⌘K`, write-confirmation card as the climax). **Resolved.**
**[Rubric]** — J6 Income entry uncovered entirely → added empty state; income now in the CSV export set and the Transactions reserved shape. **Resolved.**
**[Rubric]** — Nine components had behaviour but no visual spec → all nine added, plus `checkbox`, `toast`, `focus-ring`, `disabled`. **Resolved.**
**[Rubric]** — "Inspiration & Anti-patterns" missing entirely → added: carried-forward patterns, eleven retired decisions, five rejected-on-principle items. **Resolved.**
**[A11y]** — No disabled-state token anywhere → added `ink-disabled` (3:1 verified) plus `components.disabled`, with `aria-disabled` mandatory. **Resolved.**
**[A11y]** — `ink-faint` failed on chrome and rail (4.06–4.29:1) → re-solved against all four surfaces at ≥4.6:1 with an explicit scope rule. **Resolved.**
**[A11y]** — 12px uppercase on scan-heavy content → added `typography.column-head` at 13px sentence case; axis ticks moved to `caption`; 12px uppercase is badges only. **Resolved.**
**[A11y]** — No `aria-sort` on sortable headers → required on every sortable `<th>`. **Resolved.**
**[A11y]** — No focus restoration after overlay close → focus returns to the opening element, never `<body>`. **Resolved.**
**[A11y]** — Language switch didn't sync `lang` → updates `document.documentElement.lang` immediately and announces. **Resolved.**
**[A11y]** — OS text scaling at the minimum window untested → testing at 125/150/200% at 1024×680 is now a stated requirement. **Resolved.**
**[A11y]** — Direction-glyph column had no accessible name → `aria-label` "Money in"/"Money out" specified while the column is still reserved. **Resolved.**
**[A11y]** — "Click a table row to edit" had no keyboard equivalent → `Enter` on a focused row opens the slide-over. **Resolved.**
**[Marie]** — No data export mentioned anywhere → added "Getting Your Data Out": per-surface CSV honouring active filters, no AI, no account, no network. **Resolved.**
**[Marie]** — "Variable spending" / "fixed commitments" as user-facing labels → renamed to "What you can change" / "Bills you can't easily change"; added a list of engineering-only words. **Resolved.**
**[Marie]** — "Duplicates excluded" vs "auto-deselected" → standardised on "3 likely duplicates found — unchecked. Review if you want them." "Excluded" retired. **Resolved.**
**[Marie]** — Bare "Stale" badge beside an unexplained age → badges never render a bare adjective; reads "Updated 6 weeks ago." **Resolved.**
**[Marie]** — Acronym wall on the allocation card → the expansion rule now covers charts explicitly, since a bar has no "first mention" to attach to. **Resolved.**

### Medium (16)

Resolved: focus-ring colour unspecified (ring + surface offset) · 192px rail width untokenized · contrast margins with no CI guard · Toast unspecified · Card/button/badge behavioural rows missing · no empty state for Income, Recurring, Assets · no zero/one-snapshot net-worth state · no AI-import slow state · scope-comparison mock cited in the wrong section · EXPERIENCE.md rhetorical outside Key Flows · segmented sub-nav semantics conflict (chose plain links, arrow keys unbound) · 15px checkbox hit area (24px) · no route-change focus or skip link · attention rows announced as fragments · icon-only rail default (now labelled on first run) · card headers reading as parental ("Needs a look", "Suggested next step") · welcome screen introducing API keys · "Projected due" ambiguity · two trust hedges stacked (disclaimer weight now calibrated per surface).

Carried to Open Items: **"Wealth" destination label** — *"Wealth is Warren Buffett. I have a mortgage and a car loan."* A credit-card balance is the opposite of wealth, and that is where she must look for it. The four-destination *structure* is evidenced by the existing nav clusters; the *labels* are evidenced by nothing. This is a user-research task, not a desk ruling.

### Low (12)

Resolved: "spine wins on conflict" stated four times → consolidated · component row labels don't match token names → tokens inlined · `prefers-reduced-motion` not enumerated → blanket rule with component list · hairline near-invisibility → documented as reinforcement, not separator · meter interactivity assumption → stated as never draggable · template names don't map to every household → "Bending It To Fit" added · "from import" badge inference → tooltip states it outright.

Carried: multi-year comparison and spreadsheet-style ad-hoc tabs → named as known gaps. Flow 2's non-PRD provenance → left deliberately, recorded in the log. Tabular figures, the `label` size for table cells, and the disclaimer's ARIA treatment → verified as non-issues, no change.

## Verification (computational, not asserted)

- All **83 colour tokens** pass: text ≥4.5:1 on card, page, chrome, and rail in both modes; badge ink ≥4.5:1; button fill ≥4.5:1; disabled and focus ring ≥3:1; chart steps ≥3:1 on card with ≥1.35:1 adjacent separation.
- **246 token references** across both files resolve. Zero broken.
- **Light/dark pairing complete** — 40 base tokens, zero missing counterparts.
- Frontmatter grew 73→83 colours, 10→11 type roles, 14→18 spacing tokens, 15→28 components.

## Decisions this validation forced that no reviewer raised

The Settings mock, built during the same pass, surfaced one: **template export must be amount-free by construction.** If community template sharing is the eventual goal, a template carrying someone's mortgage payment is a privacy incident waiting to happen — it cannot depend on user diligence.

## Reviewer files

- `review-rubric.md` — 94 lines, 8 categories, 24 findings
- `review-accessibility.md` — 263 lines, 29 findings, independent luminance + CVD simulation
- `review-marie.md` — 205 lines, 16 findings, persona walkthrough
