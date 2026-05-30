---
title: 'Pre-alpha disclosure notice for the marketing site'
type: 'feature'
created: '2026-05-14'
status: 'done'
baseline_commit: '68cae68dbeb398b0d263a4bae8bccf09677a387f'
context: []
---

# Pre-alpha disclosure notice for the marketing site

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Visitors to the Nixus marketing site (`apps/web/`) have no clear, prominent signal that the product is at a pre-alpha maturity level, so they may install expecting beta-grade stability and be surprised by rough edges.

**Approach:** Add a dismissible top-of-page announcement bar with a brief pre-alpha message and a "Learn more" link that scrolls to a new FAQ entry explaining what pre-alpha means. Also add a small "Pre-alpha" label to the site footer. Dismissal persists across visits via `localStorage`. Hydration-safe (no flash for returning dismissed visitors).

## Boundaries & Constraints

**Always:**
- Render the bar above the existing `SiteHeader` and outside the sticky header layer (it must not become sticky itself; once scrolled past, it stays gone).
- Honor `prefers-reduced-motion` for any transitions.
- Localize all copy through i18n (EN + FR), matching the existing key conventions (`preAlpha.*`).
- Use an inline pre-hydration script (mirroring the existing theme `FLASH_MITIGATION` pattern in `__root.tsx`) to set a `data-pre-alpha-dismissed` attribute on `<html>` from `localStorage`, so the bar is CSS-hidden on first paint for returning dismissed visitors.
- The bar must be keyboard-accessible: `role="region"`, labelled, focusable close button with translated `aria-label`.
- LocalStorage key: `nixus.preAlphaDismissed`. Value `"1"` means dismissed; absence means show.
- Footer label is purely visual — not a link, not dismissible.

**Ask First:**
- Changing the dismissal storage key or semantics (e.g., adding expiry).
- Adding visibility analytics (impression/dismissal tracking) — not in scope unless requested.
- Adding the notice anywhere other than the bar / FAQ / footer.

**Never:**
- Modal dialogs, toasts, or interstitial blockers.
- Re-show after dismissal within the same browser profile.
- A second copy of the bar inside `/fr/` route (the existing root layout serves both locales).
- A hard dependency on JS to know the message exists (the bar must SSR with full copy visible to readers without JS / before hydration; only dismissal requires JS).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First-time visitor | `localStorage.getItem("nixus.preAlphaDismissed") === null` | Bar visible on first paint; remains until dismissed. | N/A |
| Returning dismissed visitor | `localStorage.getItem("nixus.preAlphaDismissed") === "1"` | Bar hidden on first paint (no flash). Inline pre-hydration script applies `data-pre-alpha-dismissed="1"` to `<html>`; CSS hides the bar via that attribute. | N/A |
| Visitor clicks close (×) | Bar mounted, click on close button | Bar disappears immediately; `localStorage.setItem("nixus.preAlphaDismissed", "1")`; `data-pre-alpha-dismissed="1"` applied to `<html>`. | If `localStorage` access throws (privacy mode), still hide for the session via React state; do not crash. |
| Visitor clicks "Learn more" | Anchor `href="#faq-pre-alpha"` | Smooth-scroll (or instant if `prefers-reduced-motion: reduce`) to FAQ; FAQ accordion entry `preAlpha` auto-opens. | If the FAQ section is absent (e.g., future page without `<FAQ />`), the anchor is a no-op — acceptable. |
| SSR / no JS | Server render | Bar renders visible with full copy; close button is a `<button>` that is inert without JS (harmless). | N/A |
| French locale (`/fr/`) | `i18n.language === "fr"` | Bar copy renders in French. | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/routes/__root.tsx` -- inject pre-hydration script (mirrors existing `FLASH_MITIGATION`); mount `<PreAlphaBanner />` above `<SiteHeader />` inside `ShellInner`.
- `apps/web/src/components/PreAlphaBanner.tsx` -- new component; renders the bar, handles dismiss + localStorage.
- `apps/web/src/components/PreAlphaBanner.test.tsx` -- new vitest spec covering render, dismiss persistence, hydration-safe attribute hiding, and i18n keys.
- `apps/web/src/components/SiteFooter.tsx` -- add a small "Pre-alpha" label (i18n key `footer.preAlphaLabel`) in the existing nav row, before or after the email link.
- `apps/web/src/components/SiteFooter.test.tsx` -- assert the label renders with the translated text.
- `apps/web/src/components/FAQ.test.tsx` -- assert the new `preAlpha` entry renders and its anchor id `faq-pre-alpha` is present (or that opening it via the URL hash works).
- `apps/web/src/content/faq.ts` -- add `"preAlpha"` to `FAQEntryId`, prepend `{ id: "preAlpha" }` to `faqEntries` so it appears first.
- `apps/web/src/components/FAQ.tsx` -- add `id="faq-pre-alpha"` to the `preAlpha` `AccordionItem` so the banner's `#faq-pre-alpha` anchor lands on it; if the URL hash matches on mount, force-open that item.
- `apps/web/src/locales/en.json` -- add `preAlpha.banner.message`, `preAlpha.banner.learnMore`, `preAlpha.banner.dismissAria`, `footer.preAlphaLabel`, `faq.preAlpha.question`, `faq.preAlpha.answer`.
- `apps/web/src/locales/fr.json` -- French equivalents of the above keys.
- `apps/web/src/styles/main.css` (or nearest global stylesheet — verify during impl) -- add `html[data-pre-alpha-dismissed="1"] [data-pre-alpha-banner] { display: none }` so the pre-hydration script hides the bar without React.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/locales/en.json` -- add new keys -- copy lives here, referenced by every consumer.
- [ ] `apps/web/src/locales/fr.json` -- add new keys -- French parity required by site contract.
- [ ] `apps/web/src/components/PreAlphaBanner.tsx` -- create banner component (icon from `lucide-react`: `AlertTriangle`, sized `size-4`, brand-aligned amber tint; root has `data-pre-alpha-banner` and `data-testid="pre-alpha-banner"`).
- [ ] `apps/web/src/components/PreAlphaBanner.test.tsx` -- cover: renders message, dismiss button writes `localStorage` and unmounts/hides, close button has translated `aria-label`, no crash when `localStorage` throws.
- [ ] `apps/web/src/styles/main.css` -- add the `html[data-pre-alpha-dismissed="1"] [data-pre-alpha-banner] { display:none }` rule.
- [ ] `apps/web/src/routes/__root.tsx` -- extend the inline pre-hydration script to also read `nixus.preAlphaDismissed` and set `data-pre-alpha-dismissed="1"` on `<html>` when present; mount `<PreAlphaBanner />` immediately above `<SiteHeader />` in `ShellInner`.
- [ ] `apps/web/src/content/faq.ts` -- add `"preAlpha"` to `FAQEntryId` and prepend entry so it sits first in the list.
- [ ] `apps/web/src/components/FAQ.tsx` -- pass `id="faq-pre-alpha"` to the `preAlpha` `AccordionItem`; on mount, if `window.location.hash === "#faq-pre-alpha"`, open that item (extend the Accordion `value` prop to controlled mode only if needed; otherwise rely on `defaultValue`).
- [ ] `apps/web/src/components/FAQ.test.tsx` -- assert the `preAlpha` entry renders the translated question and its accordion item element has `id="faq-pre-alpha"`.
- [ ] `apps/web/src/components/SiteFooter.tsx` -- render `<span>{t("footer.preAlphaLabel")}</span>` inside the nav cluster (as a non-link sibling of the GitHub/email links), styled with the existing `text-muted-foreground` and a small separator on `md:` viewports to match the GitHub/email layout.
- [ ] `apps/web/src/components/SiteFooter.test.tsx` -- assert the label renders.

**Acceptance Criteria:**
- Given a first-time visitor lands on `/`, when the page loads, then the announcement bar is visible above the site header with the EN message, an `AlertTriangle` icon, a "Learn more" link, and a close (×) button.
- Given a first-time visitor lands on `/fr/`, when the page loads, then the bar copy and dismiss aria-label render in French.
- Given the bar is visible, when the visitor clicks ×, then the bar disappears, `localStorage.getItem("nixus.preAlphaDismissed")` equals `"1"`, and reloading the page does not re-show the bar (no flash on reload).
- Given the visitor has previously dismissed the bar, when the page loads, then there is no visible bar at any point (asserted by checking that the rendered HTML element with `data-pre-alpha-banner` is hidden via the `html[data-pre-alpha-dismissed="1"]` CSS rule before hydration).
- Given the bar is visible, when the visitor clicks "Learn more", then the page scrolls to the FAQ section and the `preAlpha` accordion entry is open.
- Given the site footer renders on any page, when inspected, then a "Pre-alpha" (or FR equivalent) label is present in the nav row.
- Given the visitor's browser blocks `localStorage` access, when they click ×, then the bar still hides for the session and no uncaught exception is thrown.

## Spec Change Log

## Design Notes

**Hydration-safe hiding (mirrors existing theme pattern).** `__root.tsx` already injects an inline pre-hydration script for theme to avoid a dark/light flash. We extend that same script (or add a sibling one — implementer choice) to read `nixus.preAlphaDismissed` and set `data-pre-alpha-dismissed="1"` on `<html>`. A CSS rule then hides the banner before React mounts. This avoids the standard React hydration mismatch (server always renders the bar visible; client decides to hide via attribute + CSS, not by changing the rendered tree).

**Copy (EN, suggested — final wording can be refined during impl, all in i18n):**
- `preAlpha.banner.message`: "Nixus is pre-alpha — expect rough edges and breaking changes."
- `preAlpha.banner.learnMore`: "Learn more"
- `preAlpha.banner.dismissAria`: "Dismiss pre-alpha notice"
- `footer.preAlphaLabel`: "Pre-alpha"
- `faq.preAlpha.question`: "What does 'pre-alpha' mean?"
- `faq.preAlpha.answer`: "Nixus is at a pre-alpha stage: the core flows work, but you should expect bugs, missing features, and breaking changes between releases. Your data stays local, and auto-update keeps you on the newest build."

**Copy (FR, suggested):**
- `preAlpha.banner.message`: "Nixus est en pré-alpha — attendez-vous à des aspérités et à des changements cassants."
- `preAlpha.banner.learnMore`: "En savoir plus"
- `preAlpha.banner.dismissAria`: "Fermer l'avis pré-alpha"
- `footer.preAlphaLabel`: "Pré-alpha"
- `faq.preAlpha.question`: "Que signifie « pré-alpha » ?"
- `faq.preAlpha.answer`: "Nixus est en pré-alpha : les fonctionnalités principales marchent, mais attendez-vous à des bugs, à des fonctionnalités manquantes, et à des changements cassants entre versions. Vos données restent locales, et la mise à jour automatique vous garde sur la dernière version."

**Visual style:** thin (~36–44px) bar, full-width, amber-tinted background (`bg-amber-50 dark:bg-amber-900/30`, `border-b border-amber-200/60 dark:border-amber-800/40`, `text-amber-900 dark:text-amber-100`), centered content max-width matching the header, `AlertTriangle` icon left, message middle (compact), "Learn more" link + × button right. Mobile: wraps to two rows with × pinned right.

## Verification

**Commands:**
- `pnpm --filter @nkbaz/web typecheck` -- expected: no errors.
- `pnpm --filter @nkbaz/web test` -- expected: all vitest specs pass, including new `PreAlphaBanner.test.tsx` and updated `SiteFooter.test.tsx` / `FAQ.test.tsx`.
- `pnpm --filter @nkbaz/web build` -- expected: clean build, no SSR warnings about hydration mismatches.

**Manual checks:**
- `pnpm --filter @nkbaz/web dev`, open `http://localhost:3000/`. First load shows the bar; reload after dismiss shows no flash. Toggle `/fr/`, confirm FR copy. Resize to mobile width, confirm bar wraps cleanly. Click "Learn more", confirm scroll + accordion open. Verify footer "Pre-alpha" label on both locales. Verify dark mode tint reads correctly.
