---
workflow: create-ux-design
mode: focused-pass
stepsCompleted: [1, 2, 7, 10, 11, 13]
status: ready-for-implementation
project_name: nixus-marketing-site-beta-page
scope: "/beta and /fr/beta only"
date: 2026-06-09
author: Nbazinet
facilitator: Sally (UX Designer)
inputDocuments:
  - product-brief-nixus-marketing-site-2026-04-25.md
  - ux-design-specification-nixus-marketing-site-2026-04-25.md
  - architecture-web.md
  - docs/planning/beta-validation-roadmap-june-2026.html
  - apps/web/src/components/BetaSection.tsx
  - apps/web/src/locales/en.json
  - apps/web/src/locales/fr.json
visualMockup: ux-beta-page-mockup.html
---

# UX Design Specification — `/beta` page

**Author:** Nbazinet · **Facilitator:** Sally (UX Designer)  
**Date:** 2026-06-09  
**Routes:** `/beta` (EN) · `/fr/beta` (FR)

---

## Executive summary

The `/beta` page is a **single-purpose handoff document** for people you invite personally. It answers four questions in under two minutes:

1. Is this for me?
2. What am I actually getting?
3. How do I install it safely?
4. How do I tell you when something breaks?

**Not a second homepage.** No feature grid, no AI demo animation, no marketing funnel. Public-facing content only — nothing about internal roadmap, Discord, or developer workflows.

**Visual mockup:** open [`ux-beta-page-mockup.html`](./ux-beta-page-mockup.html) in a browser.

---

## Primary persona

**Marie, 42 — spreadsheet tracker**

- Gets a personal link from a friend on her phone at lunch
- Needs trust before installing on her laptop tonight
- Will not join Discord or GitHub Issues
- Comfortable with email: “Something confused me on the budget screen”

**Success:** She downloads, opens once, and emails you one honest friction report within a week.

---

## Information architecture

One scroll. Max content width `720px` (matches existing `BetaSection`).

| # | Section | Purpose |
|---|---------|---------|
| 1 | **Hero** | What this is + download CTA |
| 2 | **Is this for you?** | Self-qualification (for / not for) |
| 3 | **See it in action** | 2–3 screenshots (demo data) |
| 4 | **What to expect** | Limitations list (reuse existing i18n) |
| 5 | **Get started** | Download + first-launch install notes |
| 6 | **Give feedback** | Email-first; no chat app required |
| 7 | **Quick questions** | 3 FAQ items + link to full FAQ on home |

**Excluded (public beta page):** pricing, changelog (until Week 4), GitHub as primary CTA, community links, internal validation metrics.

---

## Relationship to `/#beta`

| Surface | Role |
|---------|------|
| Homepage `/#beta` | Short limitations + invite for organic visitors |
| **`/beta`** | Full shareable URL for outreach DMs |

Homepage `#beta` gains one line at the bottom: *“Full beta guide →”* linking to `/beta`. Pre-alpha banner “Learn more” should point to `/beta` when on non-home routes (already route-aware in `PreAlphaBanner` — update target from `#beta` to `/beta`).

---

## Section specs & copy direction

### 1. Hero

| Element | EN | FR notes |
|---------|----|----|
| Eyebrow | `Pre-alpha beta` | `Bêta pré-alpha` |
| H1 | `Try Nixus — honest preview` | `Essayer Nixus — aperçu honnête` |
| Lead | One sentence: local-first desktop app, built by one person, looking for 2–3 spreadsheet users. | Mirror builder voice; FR adds QC francophone welcome (reuse `beta.invite.body` tone) |
| CTA | `DownloadCTA` (OS-detected) | Same component |

### 2. Is this for you?

Two cards, side-by-side on `md+`, stacked on mobile.

**Good fit if you…**
- Track personal finances in a spreadsheet today
- Use macOS or Windows on a desktop or laptop
- Can upload credit card statements (screenshot or PDF) instead of bank sync
- Are okay with rough edges and will tell me what breaks

**Not for you if you…**
- Need automatic bank connection
- Want a mobile app
- Need tax, legal, or investment advice
- Expect polished, supported software today

### 3. See it in action

Three screenshot slots (implementation uses real assets, demo data only):

1. **Budget overview** — “Monthly budget at a glance”
2. **AI import** — “Upload a statement, get categorized expenses”
3. **Net worth** — “Accounts and assets in one view”

Each: subtle card frame, caption below, descriptive alt text. No sensitive data.

### 4. What to expect

**Reuse** `beta.limitations.*` keys from `en.json` / `fr.json` via shared `LimitationsList` component extracted from `BetaSection`. Do not duplicate copy.

Heading: existing `beta.limitations.heading`  
Intro: existing `beta.limitations.intro`

### 5. Get started

Numbered list (compact):

1. **Download** — repeat `DownloadCTA`
2. **Install** — one line each for Gatekeeper (macOS) and SmartScreen (Windows); link “Full install help” → home `#download` or install instructions section
3. **First open** — “No web signup — your data stays on your machine”

Mobile visitors: show existing “Visit on a Mac or PC” + copy/email link pattern from `DownloadCTA`.

### 6. Give feedback

Card treatment (same visual as current beta invite card):

| Element | Content |
|---------|---------|
| Heading | `How to give feedback` |
| Body | No Discord or chat app required. Email works — read personally. Pre-alpha, not a support desk. |
| Prompt | Most useful: *“What almost made you close it in the first 10 minutes?”* |
| Primary CTA | `Email feedback` → `mailto:support@…?subject=Nixus beta feedback` |
| Secondary | Optional later: simple form link (Tally) — defer to post-June |

Reuse `BETA_SUPPORT_EMAIL` from `@/content/limitations`.

### 7. Quick questions

Accordion with 3 items (reuse FAQ content keys):

- Does this connect to my bank? → `faq.bankConnection.*`
- Where is my data stored? → `faq.dataStorage.*`
- Is it free? → `faq.isItFree.*`

Footer link: “More questions →” home page FAQ anchor.

---

## Navigation & chrome

**Header:** Add `Beta` nav link → `/beta` (EN) or `/fr/beta` (FR). Minimal — logo left, Beta + Download right (matches Linear-style future nav from parent UX spec).

**Footer:** Unchanged (GitHub, email, pre-alpha label).

**Meta (EN):**
- Title: `Nixus beta — try the pre-alpha personal finance app`
- Description: `Local-first desktop app for spreadsheet users. Honest limitations, download, and how to give feedback by email.`

**Meta (FR):** Parallel translation.

**Sitemap:** Add `/beta` and `/fr/beta`.

---

## Component strategy

| Component | Action |
|-----------|--------|
| `BetaPage` | New route composition in `apps/web/src/routes/beta.tsx` + `fr/beta.tsx` |
| `LimitationsList` | Extract from `BetaSection` — shared by home `#beta` and `/beta` |
| `BetaInviteCard` / `BetaFeedbackCard` | Extract or extend invite card for feedback section |
| `AudienceFitCards` | New — for/not-for two-column block |
| `BetaScreenshotGallery` | New — 2–3 framed screenshots |
| `BetaGetStartedSteps` | New — numbered install steps |
| `DownloadCTA` | Reuse unchanged |
| `FAQ` | Reuse single-item accordion or extract 3-item subset |

**i18n:** New namespace keys under `betaPage.*` in `en.json` / `fr.json`. Limitations and FAQ subsets reference existing keys where possible.

---

## Responsive & accessibility

- Single column on mobile; two-column fit cards from `md` breakpoint
- Screenshot gallery: horizontal scroll on small screens OR stacked — prefer stacked for clarity
- All CTAs are real `<a href>` (download, mailto) — works without JS
- Section headings use proper `h1` (page) → `h2` (sections) → `h3` (cards)
- Screenshot alt text describes UI, not marketing fluff
- Focus rings match existing site (`focus-visible:ring-3`)

---

## Emotional design

**Tone:** Calm, honest, builder voice — same as homepage.  
**Feeling:** “This person is being straight with me” — not “join our community.”  
**Anti-patterns:** Discord invite, email gate before download, fake social proof, stock photos, “AI-powered” repeated.

---

## Outreach snippet (Week 3)

> Everything about the beta in one place: **yoursite.com/beta**  
> Download, what to expect, and how to reach me if something’s confusing. No chat app required.

FR: **yoursite.com/fr/beta**

---

## Implementation checklist

- [ ] Routes `/beta` + `/fr/beta` with `buildMeta`
- [ ] Extract `LimitationsList` from `BetaSection`
- [ ] New i18n keys `betaPage.*`
- [ ] 2–3 screenshot assets in `public/` (demo data)
- [ ] Header “Beta” link
- [ ] Pre-alpha banner → `/beta` on non-home routes
- [ ] Sitemap entries
- [ ] Homepage `#beta` → “Full beta guide” link
- [ ] Playwright smoke: page renders, mailto + download present

**Estimated effort:** 2–3 hours (matches Week 2 roadmap budget).

---

## Sally’s sign-off

This is the URL you paste in personal messages. Marie gets everything she needs without feeling like she joined a gamer Discord or read developer docs. Ship `/beta` first; `/docs` can wait until you have technical contributors asking for setup guides.
