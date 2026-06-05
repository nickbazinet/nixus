---
title: 'Marketing site polish: S3 downloads, themes, i18n, branding'
slug: 'web-marketing-polish'
created: '2026-04-26'
stepsCompleted: [1, 2, 3, 4]
status: 'ready-for-dev'
tech_stack:
  - 'TanStack Start v1 (Vite + React 19 prerender)'
  - 'next-themes (theme management; mirrors desktop)'
  - 'i18next + react-i18next + i18next-browser-languagedetector (mirrors desktop)'
  - 'Tailwind CSS v4 (CSS-first, design tokens in @nkbaz/shared)'
  - 'Vitest 3 + jsdom + @testing-library/react'
  - '@resvg/resvg-js (SVG → PNG generation; already used for OG image)'
files_to_modify:
  - 'apps/web/src/features/download/release.types.ts'
  - 'apps/web/src/features/download/release.ts'
  - 'apps/web/src/features/download/release.test.ts'
  - 'apps/web/src/features/download/DownloadCTA.tsx'
  - 'apps/web/src/components/SiteHeader.tsx'
  - 'apps/web/src/components/SiteHeader.test.tsx'
  - 'apps/web/src/components/SiteFooter.tsx'
  - 'apps/web/src/components/SiteFooter.test.tsx'
  - 'apps/web/src/components/InstallInstructions.tsx'
  - 'apps/web/src/components/Hero.tsx'
  - 'apps/web/src/components/AIDemo.tsx'
  - 'apps/web/src/components/FeatureGrid.tsx'
  - 'apps/web/src/components/FAQ.tsx'
  - 'apps/web/src/content/hero.ts'
  - 'apps/web/src/content/features.ts'
  - 'apps/web/src/content/faq.ts'
  - 'apps/web/src/lib/meta.ts'
  - 'apps/web/src/lib/i18n.ts (NEW)'
  - 'apps/web/src/lib/theme.ts (NEW, optional helpers)'
  - 'apps/web/src/locales/en.json (NEW)'
  - 'apps/web/src/locales/fr.json (NEW)'
  - 'apps/web/src/components/ThemeToggle.tsx (NEW)'
  - 'apps/web/src/components/LanguageToggle.tsx (NEW)'
  - 'apps/web/src/routes/__root.tsx'
  - 'apps/web/src/routes/index.tsx'
  - 'apps/web/src/routes/404.tsx'
  - 'apps/web/src/routes/fr/index.tsx (NEW)'
  - 'apps/web/src/routes/fr/route.tsx (NEW, FR layout if needed)'
  - 'apps/web/scripts/fetch-release.ts'
  - 'apps/web/scripts/generate-og-image.ts'
  - 'apps/web/scripts/generate-favicons.ts (NEW)'
  - 'apps/web/public/favicon.ico (NEW)'
  - 'apps/web/public/favicon.svg (NEW)'
  - 'apps/web/public/apple-touch-icon.png (NEW)'
  - 'apps/web/public/icon-192.png (NEW)'
  - 'apps/web/public/icon-512.png (NEW)'
  - 'apps/web/package.json'
code_patterns:
  - 'Mirror desktop apps/desktop/src/lib/i18n.ts for i18next config'
  - 'Mirror desktop apps/desktop/src/main.tsx for ThemeProvider setup'
  - 'Mirror desktop apps/desktop/src/locales/{en,fr}.json key structure (dot-namespaced)'
  - 'next-themes flash mitigation via inline <script> in __root.tsx HTML head'
  - 'Locale-specific routes via TanStack Router file-based: src/routes/fr/index.tsx'
  - 'Per-route head() returns localized title/description/meta + canonical/alternate links'
test_patterns:
  - 'Vitest run-once unit tests, co-located *.test.ts(x)'
  - 'Mock release.gen.ts via vi.mock when testing DownloadCTA against fixed metadata'
  - 'Mock useTheme via vi.mock or wrapping in <ThemeProvider>'
  - 'Mock useTranslation via render wrapper that provides I18nextProvider with test resources'
  - 'Snapshot prerendered HTML for /fr/ (smoke test that French content lands)'
---

# Tech-Spec: Marketing site polish: S3 downloads, themes, i18n, branding

**Created:** 2026-04-26

## Overview

### Problem Statement

The Nixus marketing site (`apps/web/`) ships with several placeholder values that need finalization before public launch:

1. **Distribution** — Download CTAs point to GitHub Releases (which 404 today since no releases exist) rather than a controlled, predictable S3 bucket the user can populate independently of GitHub.
2. **Theming** — Light-only mode. The desktop app supports light/dark/system via `next-themes`; the marketing site doesn't yet, creating a visual disconnect between the install-and-launch experience.
3. **Language** — English-only content. The desktop app ships with FR/EN via `i18next`; the marketing site can't reach French-Canadian visitors who form a meaningful slice of the target audience.
4. **Contact** — Email placeholders use `support@nixus.nicolasbazinet.net` (a domain that isn't owned yet), preventing real visitor outreach.
5. **Footer** — Attribution line uses "Built in Canada by Nbazinet" voice that's too informal for a public-facing footer.
6. **Favicon** — A placeholder favicon (or no favicon at all in some browsers) means the brand mark doesn't render in tabs, bookmarks, or PWA install prompts.
7. **Header logo** — At 28px (`size-7`) the wordmark is visually small relative to the hero / CTA below; doesn't match the brand presence the desktop sidebar establishes.

These issues are individually small but bundled together they're the gating list before the site can ship publicly.

### Solution

Apply seven targeted, mostly mechanical changes that mirror the desktop app's already-proven patterns wherever they apply:

- **S3 distribution** — Replace `release.gen.ts`'s GitHub Releases asset URLs with an S3-bucket source (`nixus-downloads` bucket). The fetcher reads a `latest.json` metadata file in the bucket to learn the current version + asset filenames, falls back to a stub if the bucket is unreachable.
- **next-themes** — Add `<ThemeProvider>` to the root layout. Build a 3-option `<ThemeToggle>` (Light / Dark / System) sourced from the desktop's existing menu pattern.
- **i18next** — Copy desktop's `i18n.ts` config into `apps/web/src/lib/i18n.ts`. Build a `<LanguageToggle>` next to the theme toggle. Translate every user-visible string into FR. Prerender both `/` (en) and `/fr/` (fr) as static HTML for SEO (Option B from the question pass).
- **Branding/copy** — Email everywhere → `support@nixus.nicolasbazinet.net`. Footer → `Copyright © Nixus 2026 — All rights reserved`. Header logo → `size-9` (36px) with header height bumped to `h-20` (80px). Favicon set generated from the canonical `NixusLogo` SVG.

All work is contained to `apps/web/` and `packages/shared/` — the desktop app is not modified.

### Scope

**In Scope:**
- S3 bucket integration (URL plumbing only — bucket creation done by the user)
- `latest.json` metadata file contract (consumed by build-time fetcher)
- next-themes integration (provider, toggle, hydration flash mitigation)
- i18next integration (config, two locale files, both pre-translated)
- Per-locale prerendered routes: `/` (English) and `/fr/` (French)
- Translation of every user-visible string in: SiteHeader, SiteFooter, Hero, AIDemo, FeatureGrid, FAQ, InstallInstructions, DownloadCTA (mobile message + Linux note), 404 page, meta tags, OG image text content
- ThemeToggle and LanguageToggle components placed in the sticky header (not in mobile drawer; v1 has no nav drawer)
- Email update: `support@nixus.nicolasbazinet.net` in footer, FAQ "Who built this?" answer, FAQ "Still have questions?" line, InstallInstructions "Need help?" line, meta description (if mentioned), `mailto:` links
- Footer copyright: "Copyright © Nixus 2026 — All rights reserved"
- Header logo: `<NixusLogo />` at `size-9`, header height `h-20`
- Favicon set: `favicon.ico` (multi-resolution), `favicon.svg` (modern browsers), `apple-touch-icon.png` (180×180), `icon-192.png` + `icon-512.png` (PWA), generated by a script that re-uses `@resvg/resvg-js` (same pattern as OG image)

**Out of Scope:**
- Creating the actual S3 bucket (user creates manually after spec is locked)
- Uploading the binary files to S3 (user does this; we just plumb the URLs)
- AWS CloudFront distribution / custom subdomain
- DNS configuration for `nixus.nicolasbazinet.net`
- Real desktop app screenshots (deferred — Story 3.4)
- Builder bio copy (deferred — Story 3.5)
- Cross-browser / cross-OS / a11y manual sweeps (deferred — Stories 4.4–4.6)
- Per-page OG images (one OG image serves both locales; OG `og:locale` set per-route)
- Languages beyond English + French (Spanish, German, etc. deferred)
- Server-side rendering (we stay static-prerender-only via TanStack Start)
- A locale toggle that auto-detects from `Accept-Language` header (we mirror the desktop's localStorage-only detection)
- Lighthouse threshold retighten (deferred — was relaxed in Story 1.4 due to placeholder content)

## Context for Development

### Codebase Patterns

**Existing pattern: i18next setup (mirror exactly)**

`apps/desktop/src/lib/i18n.ts`:
```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: "en",
    load: "languageOnly",
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
    interpolation: { escapeValue: false },
  });
```

The web version will need a small adaptation: when on the `/fr/` route, force the language to `fr` regardless of localStorage (so SSR matches what the prerender baked in). Use `i18n.changeLanguage('fr')` from the fr layout's loader, or set `lng: 'fr'` directly via init for fr-prerendered pages.

**Existing pattern: ThemeProvider mount (mirror exactly)**

`apps/desktop/src/main.tsx`:
```tsx
import { ThemeProvider } from "next-themes";

<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  ...
</ThemeProvider>
```

The web version mounts this in `apps/web/src/routes/__root.tsx` as the outermost wrapper inside the route's `component`. **Hydration flash:** next-themes recommends an inline `<script>` tag in the document head that reads localStorage and applies the `class` attribute before React hydrates. TanStack Start's prerender lets us inject this via the route's `head.scripts` array.

**Existing pattern: Locale file shape (mirror dot-namespaced keys)**

`apps/desktop/src/locales/en.json` uses keys like `"nav.dashboard"`, `"sidebar.collapseSidebar"`, `"sidebar.backupSaved": "Backup saved to {{path}}"`. Match this convention for marketing-site keys: `"hero.headline"`, `"hero.subhead"`, `"footer.copyright"`, `"faq.bankConnection.question"`, `"faq.bankConnection.answer"`.

**Existing pattern: SVG → PNG generation (mirror OG image script)**

`apps/web/scripts/generate-og-image.ts` already uses `@resvg/resvg-js` to render an SVG to PNG. Mirror this pattern for the favicon set: one source SVG (the `NixusLogo` geometry), rendered at 16/32/48/180/192/512 pixels. The `favicon.ico` is multi-resolution; can be assembled via a tiny ICO-encoder library OR by emitting a single 32×32 PNG and renaming (most browsers tolerate `.ico` containing a PNG nowadays, though some old browsers don't — pick the simpler path unless we need IE compat, which we don't per NFR-W6).

**Existing pattern: Build-time release fetcher (already in place)**

`apps/web/src/features/download/release.ts` currently fetches GitHub Releases. We're swapping the source to S3. The fetcher's external contract (writes `release.gen.ts`, exposes `ReleaseMetadata` shape) stays the same; only the network call inside changes.

**Existing pattern: Per-route head() in TanStack Start**

`apps/web/src/routes/index.tsx` already uses `head: () => buildMeta()` to set per-route meta tags. The new fr route does the same with localized values. Route definitions are file-based; `apps/web/src/routes/fr/index.tsx` becomes the FR homepage automatically.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/desktop/src/lib/i18n.ts` | Source-of-truth i18next config to mirror for the web app |
| `apps/desktop/src/locales/en.json` | Reference for dot-namespaced key structure and parameterized strings (`{{path}}`) |
| `apps/desktop/src/locales/fr.json` | Reference for FR translation tone and conventions |
| `apps/desktop/src/main.tsx` | ThemeProvider mount pattern (`attribute="class" defaultTheme="system" enableSystem`) |
| `apps/desktop/src/components/shared/AppSidebar.tsx` (lines 30–40 + theme toggle subtree) | Source for the 3-option theme toggle styling and labels (Light / Dark / System) |
| `apps/web/src/features/download/release.ts` | Existing fetcher; adapt the internal HTTP call to point at S3 instead of GitHub |
| `apps/web/scripts/generate-og-image.ts` | Pattern reference for `@resvg/resvg-js`-based PNG generation (favicon script will mirror) |
| `apps/web/src/routes/__root.tsx` | Where the ThemeProvider + I18nProvider mount; where the flash-mitigation script lives |
| `apps/web/src/routes/index.tsx` | Existing English homepage; FR homepage at `apps/web/src/routes/fr/index.tsx` mirrors its structure |
| `apps/web/src/lib/meta.ts` | Per-route meta builder; needs to accept a `locale` param for OG locale + alternate-language `<link rel="alternate">` |
| `packages/shared/src/ui/nixus-logo.tsx` | Canonical SVG geometry to feed the favicon-generator script |

### Technical Decisions

**TD-1: S3 bucket name = `nixus-downloads`**
- Public bucket, hosted in AWS default region (`us-east-1`) for fastest global CloudFront fallback if added later
- Confirmed by user
- File naming: `Nixus-latest.dmg` (macOS), `Nixus-latest.msi` (Windows)
- A `latest.json` metadata file in the bucket carries the version + filename + published_at so the marketing site CTA can show a version label
- Public-read ACL on objects; bucket itself can be private with public-read on object level
- Direct S3 URLs of shape `https://nixus-downloads.s3.amazonaws.com/Nixus-latest.dmg` (works without CloudFront; HTTPS supported)

**TD-2: `latest.json` schema**
The fetcher reads:
```json
{
  "version": "0.2.1",
  "tag": "v0.2.1",
  "published_at": "2026-04-25T00:00:00.000Z",
  "assets": {
    "macos": { "filename": "Nixus-latest.dmg", "size_bytes": 0 },
    "windows": { "filename": "Nixus-latest.msi", "size_bytes": 0 }
  }
}
```
The fetcher constructs full URLs by prepending the bucket base URL to filename. If `latest.json` is missing or malformed, it emits a stub (same behavior as the GitHub fallback).

**TD-3: S3 fetcher fallback chain**
1. Try `https://nixus-downloads.s3.amazonaws.com/latest.json` (the live metadata)
2. If unreachable / malformed: emit stub pointing at `https://nixus-downloads.s3.amazonaws.com/` (the bucket root) — visitor sees a directory listing or 403; not great but the site still builds
3. The `VITE_PINNED_RELEASE_TAG` env var is dropped (no longer relevant — there's no GitHub tag space; pinning is implicit via what the user uploads to the bucket)

**TD-4: ThemeProvider mount = root route component**
- `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` wraps `<DownloadStateProvider>` at the top of `__root.tsx`'s component
- Hydration flash mitigation: inline a small synchronous `<script>` in the document `<head>` (via TanStack Start's `head.scripts` array) that reads localStorage `theme` and applies `document.documentElement.classList` before React hydrates. Standard `next-themes` pattern.

**TD-5: Theme toggle UI = dropdown in sticky header**
- Sits to the LEFT of the Download CTA in the sticky header (so the Download CTA stays the rightmost emphasis)
- 3 options: Light / Dark / System (mirror desktop's labels)
- Built from `<DropdownMenu>` + `<DropdownMenuTrigger>` + `<DropdownMenuContent>` from `@nkbaz/shared`
- Trigger shows the current-theme icon (sun/moon/monitor from `lucide-react`)
- `aria-label` translated per i18n
- On mobile (< 640px): the toggle icon stays in the header (small enough to fit alongside the language toggle and Download CTA)

**TD-6: i18n initialization differs per route**
- Default route (`/`) lets `LanguageDetector` pick from localStorage (mirrors desktop)
- `/fr/` routes use a `loader` (or `beforeLoad`) that calls `i18n.changeLanguage('fr')` to force French regardless of localStorage. This makes the URL the source of truth for the prerendered language.
- The `<LanguageToggle>` switches by navigating between `/` and `/fr/` (full route navigation, NOT just `i18n.changeLanguage`) so the URL stays in sync with the displayed language and search engines see the correct content per URL.

**TD-7: Locale routing structure**
```
src/routes/
├── __root.tsx          # ThemeProvider + I18nProvider + DownloadStateProvider; renders SiteHeader + Outlet + SiteFooter
├── index.tsx           # English homepage (existing)
├── 404.tsx             # English 404 (existing)
└── fr/
    ├── index.tsx       # French homepage (NEW; mirrors index.tsx but with locale='fr' meta)
    └── 404.tsx         # French 404 (NEW; optional — TanStack Router falls back to /404 by default; we explicitly add the FR variant for SEO)
```

**TD-8: Translation key namespacing**
- `header.*` — header-related (logo aria-label, theme/lang toggle labels, Download CTA labels at the header size)
- `hero.*` — hero copy (headline, subhead, eyebrow)
- `aiDemo.*` — AI demo title bar text, summary banner, screen reader aria-label
- `features.*` — each feature has `features.<id>.title` and `features.<id>.description`
- `faq.*` — each entry has `faq.<id>.question` and `faq.<id>.answer`. Inline link labels: `faq.<id>.links.<index>`
- `installInstructions.*` — heading, instructions per OS, "Need help?" line
- `downloadCta.*` — OS-specific labels, mobile message, Linux note, choose-platform fallback
- `siteFooter.*` — copyright, links text
- `meta.*` — title, description (used by buildMeta for both routes)

**TD-9: OG image — single image, two routes**
- One `og-image.png` covers both locales (the image itself is mostly visual, no language-specific text)
- The OG image script keeps its current text content ("Personal finance, automated." in English) since it's a brand image, not a per-locale message
- IF we want a French OG image later, we'd add `og-image-fr.png` and wire `/fr/` to use it — but this is **out of scope for v1**
- Per-route meta sets `og:locale` correctly (`en_US` for `/`, `fr_CA` for `/fr/`) and adds `og:locale:alternate` pointing at the other

**TD-10: SEO — alternate-language link tags**
Each route's `<head>` includes:
- `<link rel="canonical" href="https://nixus.nicolasbazinet.net/">` (or `/fr/`)
- `<link rel="alternate" hreflang="en" href="https://nixus.nicolasbazinet.net/">`
- `<link rel="alternate" hreflang="fr" href="https://nixus.nicolasbazinet.net/fr/">`
- `<link rel="alternate" hreflang="x-default" href="https://nixus.nicolasbazinet.net/">`

This is the standard pattern Google honors for locale-targeted content.

**TD-11: Favicon generation strategy**
- Script: `apps/web/scripts/generate-favicons.ts`
- Source: the canonical SVG geometry from `packages/shared/src/ui/nixus-logo.tsx` (translated into a standalone SVG string in the script — same gradient + pillars + diagonal)
- Outputs:
  - `apps/web/public/favicon.svg` — the source SVG, copied verbatim (modern browsers prefer this)
  - `apps/web/public/favicon.ico` — single 32×32 PNG renamed to `.ico` (sufficient for v1; fully proper multi-resolution `.ico` requires a small ICO-encoder lib like `sharp-ico` or hand-encoding — defer unless v2 needs IE/legacy)
  - `apps/web/public/apple-touch-icon.png` — 180×180 PNG, transparent background
  - `apps/web/public/icon-192.png` — 192×192 PNG (Android home-screen)
  - `apps/web/public/icon-512.png` — 512×512 PNG (Android splash / PWA)
- All transparent backgrounds (the N-mark looks correct on any browser tab strip color)
- Add `<link>` tags in `__root.tsx` head pointing at all variants
- Generation script runs once (commit outputs); regenerable via `pnpm --filter @nkbaz/web generate-favicons` if the brand mark evolves

**TD-12: Header layout adjustment**
- Header height: `h-16` → `h-20` (64px → 80px)
- Logo size: `size-7` → `size-9` (28px → 36px)
- "ixus" wordmark text size: `text-lg` → `text-xl` (18px → 20px) to match the larger N-mark visually
- Spacing inside the logo composition unchanged (`-ml-0.5 mb-px`)
- The new `<ThemeToggle>` and `<LanguageToggle>` sit between the logo and the Download CTA, with 8–12px gap. Mobile spacing tighter.

**TD-13: Test impact**
- Existing 116 tests: most still pass; tests that assert hardcoded English strings (e.g., FAQ test asserting "Does this connect to my bank?") need to be updated to query by translation key OR by both EN and FR variants
- New tests:
  - `apps/web/src/lib/i18n.test.ts` — config loads, EN/FR resources resolve
  - `apps/web/src/components/ThemeToggle.test.tsx` — 3 options, click sets theme via next-themes, current option is highlighted
  - `apps/web/src/components/LanguageToggle.test.tsx` — 2 options, navigating sets the URL correctly
  - `apps/web/src/routes/fr/index.test.tsx` (or e2e) — French homepage renders French strings (smoke test)
  - Favicon script — manual test (no unit test; it's a one-shot SVG-to-PNG)
- Estimated test count after changes: ~135 (116 + 5 new + minor updates to existing)

## Implementation Plan

### Tasks

Tasks are ordered by dependency. Each is a discrete unit of work, sized for one logical commit. File paths are absolute from the repo root.

#### Phase 1 — i18n + theme plumbing (no UI changes yet)

- [ ] **T1: Add i18n + next-themes runtime dependencies**
  - File: `apps/web/package.json`
  - Action: Add `i18next: ^26.0.3`, `react-i18next: ^17.0.2`, `i18next-browser-languagedetector: ^8.2.1`, `next-themes: ^0.4.6` to `dependencies`. Run `pnpm install` from the repo root to refresh lock + workspace links.
  - Notes: Versions match desktop pins exactly so a future shared dep upgrade lands in lockstep.

- [ ] **T2: Create i18next config**
  - File: `apps/web/src/lib/i18n.ts` (NEW)
  - Action: Mirror `apps/desktop/src/lib/i18n.ts` line-for-line, swapping the `@/locales/*` import paths to point at the web app's locale files.
  - Notes: Keep `LanguageDetector` order as `["localStorage"]` and key as `"i18nextLng"` for parity with the desktop. The FR-route's per-route language override (T16) lives in the route loader, not here.

- [ ] **T3: Seed English locale file**
  - File: `apps/web/src/locales/en.json` (NEW)
  - Action: Populate with every key documented in the "Translation key inventory" section above. Keys use dot-namespacing (`hero.headline`, `faq.bankConnection.question`, etc.). Values come from extracting current strings out of `apps/web/src/components/*.tsx`, `apps/web/src/content/*.ts`, `apps/web/src/features/download/DownloadCTA.tsx`, and `apps/web/src/lib/meta.ts`.
  - Notes: ~70 keys total. Match the exact existing English copy verbatim — this task does NOT rewrite copy, only relocates it.

- [ ] **T4: Seed French locale file**
  - File: `apps/web/src/locales/fr.json` (NEW)
  - Action: Translate every key in `en.json` into Canadian French, matching the tone reference of `apps/desktop/src/locales/fr.json` (formal-but-not-stiff "Vous" register; brand keywords stay English).
  - Notes: Keys identical to en.json. Strings explicitly NOT translated: brand names ("Nixus", "Nbazinet"), AI demo merchant names (Costco, Tim Hortons, Petro-Canada, Tangerine, Wealthsimple, Netflix), CAD currency amounts.

#### Phase 2 — Theme + i18n providers + toggles

- [ ] **T5: Mount providers + flash-mitigation script in root layout**
  - File: `apps/web/src/routes/__root.tsx`
  - Action: Inside the existing `Route` definition, add a `scripts` entry to the `head()` return: an inline-content script that reads `localStorage.getItem('theme')` + `prefers-color-scheme` and applies `document.documentElement.classList.add('dark')` synchronously. Wrap the existing `RootDocument` body content with `<I18nextProvider i18n={i18n}>` (importing `i18n` from `@/lib/i18n`) and `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>`. Order: `ThemeProvider` outermost, then `I18nextProvider`, then existing `DownloadStateProvider`.
  - Notes: If TanStack Start's `head.scripts` doesn't accept inline `children` content, fall back to mounting a `<script dangerouslySetInnerHTML>` directly in the `<head>` JSX of `RootDocument`. The script MUST run before React hydrates — never `defer` / `async`.

- [ ] **T6: Build ThemeToggle component**
  - File: `apps/web/src/components/ThemeToggle.tsx` (NEW)
  - Action: Component using `<DropdownMenu>` from `@nkbaz/shared`. Trigger: an icon-only button (lucide `Sun` / `Moon` / `Monitor` reflecting current `theme` from `useTheme()`), with `aria-label={t('header.themeToggle')}`. Three menu items (Light / Dark / System), each calls `setTheme()` from next-themes and is marked active when matching. Uses translation keys for all labels.
  - Notes: Test file `ThemeToggle.test.tsx` mocks `next-themes/useTheme` and `react-i18next/useTranslation`; verifies all 3 options are visible and clicking each calls `setTheme` with the right value.

- [ ] **T7: Build LanguageToggle component**
  - File: `apps/web/src/components/LanguageToggle.tsx` (NEW)
  - Action: Component using `<DropdownMenu>` with 2 options (English / Français). Each option is a `<a href>` to the current path on the alternate locale (compute by reading `useLocation()` from TanStack Router and toggling the `/fr` prefix). Trigger: lucide `Globe` icon button with `aria-label={t('header.languageToggle')}`.
  - Notes: Use real `<a href>` navigation (NOT just `i18n.changeLanguage`) so the URL stays in sync with the prerendered locale. localStorage `i18nextLng` is updated by the LanguageDetector when it sees the new language on page load. Test verifies the alt-locale URLs are correct from both `/` and `/fr/` starting points.

#### Phase 3 — Component UI swap to translation keys

- [ ] **T8: Resize header logo + mount toggles**
  - File: `apps/web/src/components/SiteHeader.tsx`, `apps/web/src/components/SiteHeader.test.tsx`
  - Action: Bump header height `h-16` → `h-20`. Bump `<NixusLogo>` size `size-7` → `size-9`. Bump "ixus" wordmark `text-lg` → `text-xl`. Mount `<ThemeToggle />` and `<LanguageToggle />` to the LEFT of the existing `<DownloadCTA size="sm" />` with `gap-2 md:gap-3` between them. Update `aria-label` on the brand link to use `t('header.brandHome')`. Update the existing test assertions to query toggles by their aria-labels (translated).
  - Notes: At < 360px width, the toggles + CTA may need to stack or compact; verify visually.

- [ ] **T9: Translate Hero copy**
  - File: `apps/web/src/components/Hero.tsx`, `apps/web/src/content/hero.ts`
  - Action: Remove the `heroContent` const exports from `content/hero.ts`. The `<Hero>` component now accepts no copy props — it pulls headline/subhead via `useTranslation()` and `t('hero.headline')` / `t('hero.subhead')`. The route's `index.tsx` simplifies to `<Hero />` (no props).
  - Notes: This pattern repeats for content-driven components. Keep the file `content/hero.ts` for data-shape ergonomics but it now exports only types or constants that aren't user-visible (e.g., layout choices).

- [ ] **T10: Translate AIDemo strings**
  - File: `apps/web/src/components/AIDemo.tsx`
  - Action: Replace hardcoded "Statement", "Categorized", `aria-label`, and the summary banner ("5 transactions categorized in 2.4 seconds") with `t()` calls. Use interpolation for the summary: `t('aiDemo.summary', { count: 5, seconds: 2.4 })`. Translate category badge labels (Groceries / Dining Out / Gas / Subscriptions / Investing) via `t('aiDemo.category.<key>')`.
  - Notes: Merchant names (Costco, Tim Hortons, etc.) and dollar amounts in the demo data stay literal. The `data-testid` attributes stay unchanged so existing tests still resolve.

- [ ] **T11: Translate FeatureGrid + content**
  - File: `apps/web/src/components/FeatureGrid.tsx`, `apps/web/src/content/features.ts`
  - Action: In `content/features.ts`, change the `Feature` type from `{ title: string, description: string, icon }` to `{ id: string, icon }`. Each entry's id is a stable kebab-case slug (`ai-import`, `budget`, etc.). The component now reads `t(\`features.\${id}.title\`)` and `t(\`features.\${id}.description\`)`.
  - Notes: Update existing test assertions to query by translated text via test wrapper (or check they still match the EN values).

- [ ] **T12: Translate FAQ + content**
  - File: `apps/web/src/components/FAQ.tsx`, `apps/web/src/content/faq.ts`
  - Action: In `content/faq.ts`, the `FAQEntry` type drops `question` + `answer` string fields, keeps `id` + `links`. The links array's `label` becomes a translation key reference (e.g., `labelKey: 'faq.installSafety.linkInspect'`) so labels translate too. The component reads `t(\`faq.\${id}.question\`)` and `t(\`faq.\${id}.answer\`)`. Section headings ("Frequently asked", "Still have questions?") also via `t()`.
  - Notes: The `mailto:` href on the contact link does NOT translate — it's a real URL. The visible label `support@nixus.nicolasbazinet.net` is in the translation file but identical EN/FR (it's an email address).

- [ ] **T13: Translate InstallInstructions**
  - File: `apps/web/src/components/InstallInstructions.tsx`
  - Action: Translate the "Your Nixus download is starting" heading, "macOS"/"Windows" tab labels, both per-OS body strings (using `<Trans>` from react-i18next so the `<strong>` tags render correctly inside the translated content), and the "Need help?" line.
  - Notes: The OS pane bodies contain inline bold spans (`<strong>System Settings → Privacy & Security</strong>` etc.). Use `<Trans i18nKey="installInstructions.macosBody" components={{ strong: <strong /> }} />` to keep the HTML structure inside the translation string. The `<email />` component slot can render the support email link if useful.

- [ ] **T14: Translate DownloadCTA**
  - File: `apps/web/src/features/download/DownloadCTA.tsx`
  - Action: Replace every hardcoded English string (button labels, mobile message, Linux note, "Send to my computer", "Copy link", "Copied!", "Email me a link", version label format, alt-OS link text) with `t()` calls. Use interpolation for version: `t('download.versionLabel', { version: release.version })`. Use interpolation for alt-OS: `t('download.altOsLink', { os: t(\`header.\${otherOs}\`) })` — where `header.macos` and `header.windows` provide localized OS names.
  - Notes: Keep the analytics event names (e.g., `download.clicked`) untranslated — those are system-internal identifiers, not user-visible strings.

- [ ] **T15: Update SiteFooter copy + email**
  - File: `apps/web/src/components/SiteFooter.tsx`, `apps/web/src/components/SiteFooter.test.tsx`
  - Action: Remove "Built in Canada by Nbazinet · © 2026" line. Add `t('footer.copyright')` line below or in place of it. Replace the visible `support@nixus.nicolasbazinet.net` text and `mailto:support@nixus.nicolasbazinet.net` href with `support@nixus.nicolasbazinet.net`. Translate `aria-label="Footer"` and the GitHub link label via `t()`. Update tests: remove "Built in Canada by Nbazinet" assertion, add "Copyright © Nixus 2026" assertion against the EN translation, add a second test rendering with a French test wrapper that asserts the FR equivalent.
  - Notes: GitHub URL stays as `https://github.com/nickbazinet/n-finance` (not translated; it's a URL).

#### Phase 4 — Per-locale prerendered routes

- [ ] **T16: Create French homepage route**
  - File: `apps/web/src/routes/fr/index.tsx` (NEW)
  - Action: Mirror the structure of `apps/web/src/routes/index.tsx`. Use `createFileRoute('/fr/')`. Add a `beforeLoad: () => i18n.changeLanguage('fr')` (await it so the prerender pass renders FR content). The component renders the same composition as the EN homepage: `<Hero />`, `<AIDemo />`, `<FeatureGrid />`, `<FAQ />`, `<InstallInstructions />`. The route's `head: () => buildMeta({ locale: 'fr', path: '/fr/' })`.
  - Notes: TanStack Start's prerender will discover this route via `crawlLinks: true` once the `<LanguageToggle>` from EN renders an `<a href="/fr/">`. No manual `prerender.routes` config needed.

- [ ] **T17: Create French 404 route (optional polish)**
  - File: `apps/web/src/routes/fr/404.tsx` (NEW)
  - Action: Mirror `apps/web/src/routes/404.tsx` with FR meta override. Component renders the same back-to-home link but the link points at `/fr/` instead of `/`.
  - Notes: Without this, FR-context unmatched URLs serve the EN 404. Acceptable for v1; this task is the polish move and can be deferred if other tasks slip.

- [ ] **T18: Add locale support to meta builder**
  - File: `apps/web/src/lib/meta.ts`, `apps/web/src/lib/meta.test.ts`
  - Action: Extend `MetaInput` type with `locale?: 'en' | 'fr'` (default `'en'`). `buildMeta` returns localized title/description by reading `t('meta.home.title')` etc. through the i18n instance. `og:locale` becomes `en_US` or `fr_CA` based on `locale`. Add `<link rel="alternate" hreflang="en" href="https://nixus.nicolasbazinet.net/">`, `hreflang="fr" href="https://nixus.nicolasbazinet.net/fr/"`, and `hreflang="x-default" href="https://nixus.nicolasbazinet.net/"` to the `links` array. Canonical and `og:url` use the locale-prefixed path. Add tests for both locales' outputs.
  - Notes: `buildMeta` runs at prerender time (Node), not client. Make sure the i18n instance is initialized + has the correct language set when `buildMeta({ locale: 'fr' })` is called. If that's awkward to wire, the function can accept the resolved strings directly: `buildMeta({ locale, title, description })` with the route handlers calling `t()` themselves and passing the resolved values.

- [ ] **T19: Update existing EN routes to declare locale**
  - File: `apps/web/src/routes/index.tsx`, `apps/web/src/routes/404.tsx`
  - Action: Update `head: () => buildMeta(...)` calls to pass `locale: 'en'` explicitly so the alternate-language link tags emit correctly.
  - Notes: Trivial 1-line change per file.

#### Phase 5 — S3 download distribution

- [ ] **T20: Update release types if needed**
  - File: `apps/web/src/features/download/release.types.ts`
  - Action: Verify the existing `ReleaseMetadata` shape works for S3 metadata. Likely no changes — `version`, `tag`, `published_at`, `assets.macos.url`, `assets.windows.url`, `is_stub` map cleanly to S3 too. If anything changes (e.g., dropping `tag` since S3 has no tags), document the diff.
  - Notes: Keep the type stable so DownloadCTA doesn't need to change.

- [ ] **T21: Rewrite release fetcher to consume S3 metadata**
  - File: `apps/web/src/features/download/release.ts`
  - Action: Replace the GitHub API call with `fetch('https://nixus-downloads.s3.amazonaws.com/latest.json')`. Parse the response JSON; validate it has `version`, `assets.macos.filename`, `assets.windows.filename`. Construct each asset's URL as `${BUCKET_BASE}/${asset.filename}`. Drop `VITE_PINNED_RELEASE_TAG` and `GITHUB_TOKEN` logic (S3 is public, no pinning needed). On any error (404, network, parse), emit a stub via the existing fallback path with URLs pointing at the bucket root (`https://nixus-downloads.s3.amazonaws.com/`).
  - Notes: Keep all logging behavior intact (`[release-fetcher]` prefix, stderr warnings on errors). The fetcher's external contract — the typed `ReleaseMetadata` written to `release.gen.ts` — is preserved so DownloadCTA needs no changes.

- [ ] **T22: Update release fetcher tests**
  - File: `apps/web/src/features/download/release.test.ts`
  - Action: Replace GitHub fixtures with S3 `latest.json` fixtures. Cover: happy path (valid JSON, both assets present), missing `latest.json` (404), malformed JSON, missing `assets.macos`, missing `assets.windows`, network error (fetch throws), schema drift (extra fields ignored), error → stub fallback. Drop tests for `GITHUB_TOKEN` auth and `VITE_PINNED_RELEASE_TAG` pinning.
  - Notes: ~10 tests previously; expect ~10 again after rewrite. `vi.fn()` mocks `globalThis.fetch` to return controlled JSON.

- [ ] **T23: Verify DownloadCTA works with S3 URLs (no code change expected)**
  - File: `apps/web/src/features/download/DownloadCTA.tsx`
  - Action: Run the existing DownloadCTA test suite. Inspect `release.gen.ts` output after a `pnpm fetch-release` run. Confirm the rendered `<a href>` points at `https://nixus-downloads.s3.amazonaws.com/Nixus-latest.dmg` (or stub fallback to bucket root if `latest.json` missing).
  - Notes: If any test breaks because it asserts a GitHub URL, update the assertion to assert the S3 URL pattern.

#### Phase 6 — Branding (favicon)

- [ ] **T24: Build favicon generation script**
  - File: `apps/web/scripts/generate-favicons.ts` (NEW)
  - Action: Mirror the structure of `apps/web/scripts/generate-og-image.ts`. The script defines the canonical Nixus N-mark SVG inline (same gradient + pillars + diagonal as `packages/shared/src/ui/nixus-logo.tsx`). Render the SVG at multiple sizes via `@resvg/resvg-js`: 16, 32, 48, 180, 192, 512. Outputs:
    - `apps/web/public/favicon.svg` (the source SVG, written verbatim)
    - `apps/web/public/favicon.ico` (32×32 PNG renamed to `.ico` — sufficient for modern browsers per NFR-W6)
    - `apps/web/public/apple-touch-icon.png` (180×180)
    - `apps/web/public/icon-192.png` (192×192)
    - `apps/web/public/icon-512.png` (512×512)
  - Notes: All transparent backgrounds. The SVG geometry source-of-truth lives in `nixus-logo.tsx` — duplicating it in the script is intentional (build script can't import React components). Add a comment cross-referencing the logo source.

- [ ] **T25: Add npm script**
  - File: `apps/web/package.json`
  - Action: Add `"generate-favicons": "tsx scripts/generate-favicons.ts"` to the `scripts` block.
  - Notes: Keep separate from `prebuild` — favicons are committed to git, regenerated on demand only.

- [ ] **T26: Run script + commit outputs**
  - File: `apps/web/public/{favicon.ico,favicon.svg,apple-touch-icon.png,icon-192.png,icon-512.png}` (NEW; commit as binary assets)
  - Action: Run `pnpm --filter @nkbaz/web generate-favicons`. Verify all 5 output files are produced and look correct (transparent background, N-mark visible, no rendering artifacts). Commit them.
  - Notes: Manual sanity check — open one in Preview/image viewer.

- [ ] **T27: Wire favicon link tags in root head**
  - File: `apps/web/src/routes/__root.tsx`
  - Action: Add to the root route's `head.links` array: `{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }`, `{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }`, `{ rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }`. Optionally: a `manifest.json` for PWA icons (defer if not needed).
  - Notes: Browsers honor SVG favicons when supported (Chrome 80+, Firefox 41+, Safari 16+) and fall back to `.ico` automatically.

#### Phase 7 — Email replacement + final verification

- [ ] **T28: Site-wide email replacement (catch any leftovers)**
  - File: any matching `apps/web/src/**/*.{ts,tsx}` and `apps/web/src/locales/*.json`
  - Action: After T15 (footer) and T12 (FAQ) complete, run `grep -r "support@nixus.nicolasbazinet.net" apps/web/` from repo root to verify zero matches remain. The S3 work and i18n work should naturally cover all places, but run this as a final sweep. Replace any leftover with `support@nixus.nicolasbazinet.net`.
  - Notes: Includes any references in JSDoc comments, file headers, or test fixtures. Comments are non-user-visible but still worth updating for consistency.

- [ ] **T29: Run full verification suite**
  - File: N/A
  - Action: From repo root, run in sequence: `pnpm --filter @nkbaz/web typecheck`, `pnpm --filter @nkbaz/web test`, `pnpm --filter @nkbaz/web build`, `pnpm --filter @nkbaz/desktop build`. Then inspect the prerendered HTML at `apps/web/.output/public/index.html` and `apps/web/.output/public/fr/index.html` and confirm: (a) hreflang link tags present in both, (b) `<html lang>` is `en` and `fr` respectively, (c) representative French strings appear in the FR file, (d) S3 URLs appear in the Download CTA href, (e) favicon link tags in both heads.
  - Notes: This is a verification step only — no code changes. Document any failure as a follow-up task.

- [ ] **T30: Manual smoke pass in dev**
  - File: N/A
  - Action: `pnpm --filter @nkbaz/web dev`, open http://localhost:3000/ in browser. Verify: (a) theme toggle has 3 options, switching changes appearance immediately, (b) language toggle navigates to /fr/ on click, (c) /fr/ renders French content with the `<html lang="fr">` attribute, (d) hard-reload with `localStorage.theme = 'dark'` set produces dark mode on first paint (no flash), (e) browser tab shows the Nixus N-mark favicon, (f) keyboard navigation (Tab) reaches both new toggles.
  - Notes: Document any UX issues as polish follow-ups (don't block the spec on minor visual tweaks).

### Acceptance Criteria

**AC-1: S3 download URLs**

- **Given** the user has uploaded `Nixus-latest.dmg`, `Nixus-latest.msi`, and `latest.json` to the `nixus-downloads` S3 bucket
- **When** the marketing site builds (`pnpm --filter @nkbaz/web build`)
- **Then** `release.gen.ts` is generated containing the bucket-prefixed URLs and the version from `latest.json`
- **And** the prerendered Download CTA in `.output/public/index.html` links directly to `https://nixus-downloads.s3.amazonaws.com/Nixus-latest.dmg` and `.msi`
- **And** when `latest.json` is missing or malformed, the build does not fail; a stub is emitted with URLs pointing at the bucket root

**AC-2: next-themes works without flash**

- **Given** a returning visitor has `theme: dark` in localStorage
- **When** they load the site
- **Then** the page renders in dark mode immediately on first paint (no light-mode flash visible)
- **And** the inline head script applies the correct `class` to `<html>` before React hydrates
- **And** clicking the `<ThemeToggle>` in the sticky header changes the theme without page reload
- **And** the toggle has 3 options (Light / Dark / System), with the current option visually marked
- **And** the toggle's labels are translated per the active locale

**AC-3: i18n works on `/` (en) and `/fr/` (fr) prerendered routes**

- **Given** a visitor lands on `/` in any browser
- **When** the page hydrates
- **Then** all visible content renders in English
- **And** the prerendered HTML at `.output/public/index.html` already contains the English content (visible to crawlers without JS)

- **Given** a visitor lands on `/fr/`
- **When** the page hydrates
- **Then** all visible content renders in French
- **And** the prerendered HTML at `.output/public/fr/index.html` contains the French content
- **And** the `<html lang>` attribute is `fr`

- **Given** the visitor clicks the `<LanguageToggle>`
- **When** they select the alternate language
- **Then** the URL navigates between `/` and `/fr/` (real navigation, not just a `i18n.changeLanguage` call)
- **And** localStorage `i18nextLng` is updated to match the selected language

- **Given** SEO consideration
- **When** crawlers visit either locale's prerendered HTML
- **Then** they see `<link rel="alternate" hreflang="en" href=".../">`, `<link rel="alternate" hreflang="fr" href=".../fr/">`, `<link rel="alternate" hreflang="x-default" href=".../">`, plus the correct `og:locale`

**AC-4: All visible strings translated**

- **Given** a visitor on `/fr/`
- **When** they scroll the entire homepage
- **Then** the SiteHeader, Hero, AIDemo title bar + summary, FeatureGrid (titles + descriptions), FAQ (questions + answers + link labels + "Still have questions?" line), InstallInstructions (heading + tabs + per-OS instructions + "Need help?"), DownloadCTA (button labels + mobile message + Linux note + send-to-computer affordance), SiteFooter (links, copyright) all render in French
- **And** the `<title>`, `<meta name="description">`, `og:title`, `og:description`, and `twitter:title`/`twitter:description` are localized
- **And** the only non-translated strings in the visitor's view are: brand names (Nixus, Nbazinet), merchant names in the AI demo (Costco, Tim Hortons, Petro-Canada, Tangerine, Wealthsimple, Netflix), and CAD currency amounts

**AC-5: Email replacement**

- **Given** the search-and-replace is complete
- **When** I grep `support@nixus.nicolasbazinet.net` across `apps/web/src/`
- **Then** zero matches are returned
- **And** the visible footer link, FAQ "Who built this?" answer, FAQ "Still have questions?" line, and InstallInstructions "Need help?" link all show `support@nixus.nicolasbazinet.net`
- **And** the `mailto:` href on every relevant link is `mailto:support@nixus.nicolasbazinet.net`

**AC-6: Footer copyright**

- **Given** the SiteFooter renders
- **When** I read the copyright line
- **Then** it shows "Copyright © Nixus 2026 — All rights reserved" (translated)
- **And** "Built in Canada by Nbazinet" is no longer present anywhere on the page

**AC-7: Header logo larger**

- **Given** the sticky header renders
- **When** I inspect the DOM
- **Then** the header has class `h-20` (80px height)
- **And** the `<NixusLogo>` element has class `size-9` (36px)
- **And** the "ixus" wordmark text has class `text-xl` (20px)
- **And** the visual proportions feel correct on desktop and mobile (no overlap, no cropping at < 360px width)

**AC-8: Favicon set**

- **Given** the build output
- **When** I list `apps/web/.output/public/`
- **Then** these files exist: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- **And** the rendered `<head>` contains `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`, `<link rel="icon" type="image/x-icon" href="/favicon.ico">`, `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`
- **And** when I open the prerendered site in a browser tab, the Nixus N-mark renders in the tab strip
- **And** when I add the site to the iOS home screen, the apple-touch-icon shows the N-mark

**AC-9: All tests + builds green**

- `pnpm --filter @nkbaz/web typecheck` — passes
- `pnpm --filter @nkbaz/web test` — all tests pass (~135 expected)
- `pnpm --filter @nkbaz/web build` — passes; emits both `/` and `/fr/` prerendered HTML
- `pnpm --filter @nkbaz/desktop build` — passes (no regression)

**AC-10: Theme + i18n compose without conflict (integration)**

- **Given** a visitor on `/fr/` with `localStorage.theme = 'dark'` set from a prior session
- **When** the page loads
- **Then** the page renders in French AND in dark mode simultaneously (no flash, no incorrect default)
- **And** clicking the theme toggle to switch to "Light" preserves the FR locale (does not navigate)
- **And** clicking the language toggle to switch to EN navigates to `/` and preserves the dark theme (localStorage `theme` unchanged)

**AC-11: Error handling — S3 unreachable**

- **Given** the build runs and the S3 bucket is unreachable (network error, bucket doesn't exist yet, or `latest.json` returns 404)
- **When** `pnpm --filter @nkbaz/web build` executes
- **Then** the build does NOT fail
- **And** `release.gen.ts` is emitted with `is_stub: true`, version `"unreleased"`, and asset URLs pointing at the bucket root
- **And** a clear `[release-fetcher]` warning is logged to stderr describing the failure
- **And** the prerendered HTML still contains a working Download CTA (linking to the bucket root)

**AC-12: Error handling — malformed `latest.json`**

- **Given** the bucket has a `latest.json` file with missing required fields (e.g., no `assets.macos.filename`)
- **When** the fetcher parses it
- **Then** the fetcher emits a stub with a clear warning, NOT a partial result
- **And** the build completes successfully

**AC-13: Edge case — first-time visitor (no localStorage)**

- **Given** a visitor with empty localStorage lands on `/`
- **When** the page hydrates
- **Then** the theme defaults to `system` (resolves to dark or light based on `prefers-color-scheme`)
- **And** the i18n language defaults to `en` (per the `fallbackLng: 'en'` config)
- **And** the page renders without flash regardless of which system theme resolves

**AC-14: Edge case — visitor on `/fr/` with English localStorage**

- **Given** a visitor with `localStorage.i18nextLng = 'en'` navigates directly to `/fr/`
- **When** the page hydrates
- **Then** the page renders in French (the URL is the source of truth, NOT localStorage)
- **And** the route's `beforeLoad` `i18n.changeLanguage('fr')` updates localStorage to `fr` so subsequent EN-prefixed navigations don't bounce back

**AC-15: SEO — alternate-language tags emitted on both routes**

- **Given** the prerendered output of `/` and `/fr/`
- **When** a crawler reads the `<head>` of each page
- **Then** both pages contain three `<link rel="alternate">` tags: `hreflang="en"` → `https://nixus.nicolasbazinet.net/`, `hreflang="fr"` → `https://nixus.nicolasbazinet.net/fr/`, `hreflang="x-default"` → `https://nixus.nicolasbazinet.net/`
- **And** each page's `<link rel="canonical">` points at its own URL
- **And** each page's `og:locale` matches the route (`en_US` for `/`, `fr_CA` for `/fr/`) with `og:locale:alternate` pointing at the other

## Additional Context

### Dependencies

**New runtime deps (apps/web):**
- `i18next@^26.0.3` (match desktop pin)
- `react-i18next@^17.0.2` (verified — desktop uses this exact version)
- `i18next-browser-languagedetector@^8.2.1` (match desktop pin)
- `next-themes@^0.4.6` (match desktop pin)

**No new dev deps** — `@resvg/resvg-js` already installed for the OG image script.

**Out-of-tree assumptions:**
- The user creates `nixus-downloads` S3 bucket with public-read access (or configures CloudFront fronting it later)
- The user uploads `Nixus-latest.dmg`, `Nixus-latest.msi`, and `latest.json` (matching the documented schema) to the bucket
- The mailto domain `nixus.nicolasbazinet.net` is owned and the `support@` mailbox is configured to receive

### Testing Strategy

**Unit tests (Vitest + jsdom):**
- All new components (ThemeToggle, LanguageToggle) get unit tests
- All updated content components get tests checking that translation keys resolve correctly (use a custom test wrapper that provides `<I18nextProvider>` with both `en` and `fr` resources)
- Existing tests that asserted hardcoded English strings get updated to query by `aria-label`, `data-testid`, or assert against the translation function

**Integration coverage:**
- Snapshot the prerendered HTML for `/` and `/fr/` after `pnpm build` and verify representative French strings appear in `.output/public/fr/index.html`
- Verify alternate-language `<link>` tags are present in both prerenders

**Manual verifications (one-time, before commit):**
- Open the site in dev mode, toggle theme between Light/Dark/System, verify no flash
- Click the language toggle, verify URL changes between `/` and `/fr/`
- Open dev tools, set localStorage `theme: dark`, hard-reload the site, verify dark mode renders on first paint
- Inspect a tab strip (browser, not dev tools) and confirm the favicon renders
- Cross-check `/fr/` content against `apps/desktop/src/locales/fr.json` for tone consistency

### Notes

**Risk: Dual-vite / dual-vitest issue**
The web app uses Vitest 3 + Vite 7; the desktop uses Vitest 2 + Vite 5 (transitively). Story 1.4's follow-up fix dropped `@vitejs/plugin-react` from `vitest.config.ts` to side-step a type conflict. We're not adding any new vitest config in this batch, so this risk doesn't recur.

**Risk: i18next changeLanguage in TanStack Start loaders**
`i18n.changeLanguage` is async and side-effect-y. If the FR route's `beforeLoad` doesn't await the language change, hydration could briefly show English before flipping to French. Mitigation: await the change in the loader, OR set `lng: 'fr'` directly in a separate `i18n` instance for the FR routes (cleaner but more code).

**Risk: next-themes flash on prerendered pages**
Next-themes was designed for Next.js's app/pages model, where the framework's HTML head injection makes flash mitigation easy. TanStack Start's `head.scripts` array supports this but the script must execute synchronously before React hydrates. Verify the `defer` flag is NOT set on the flash-mitigation script (it must run BEFORE the React bundle).

**Risk: Favicon.ico format compatibility**
A "PNG renamed to .ico" works in all major modern browsers but breaks in IE11 and some legacy WebViews. We don't support those (NFR-W6 limits to last 2 versions of Chrome/Firefox/Safari/Edge), so this is acceptable. If we ever need legacy compat, swap in `sharp-ico` or pre-encode a real multi-resolution ICO.

**Risk: Lighthouse SEO regression**
The pre-existing TanStack Router invariant flagged in Story 4.2 might worsen with two locale routes. Re-run Lighthouse after Phase 4 to confirm SEO score doesn't drop further. If it does, document and defer.

**Tone for FR translation:**
- Match desktop's FR tone (formal-but-not-stiff Canadian French; "Vous" form for any future user-addressing strings)
- Brand keywords stay in English (Nixus, AI, GitHub) — don't translate to "IA"
- Currency stays in CAD format ("$1 234,56" with French locale formatting if shown)

### Step 2 Investigation Findings

**Confirmed dependency versions (matching desktop exactly):**
- `i18next@^26.0.3`
- `react-i18next@^17.0.2`
- `i18next-browser-languagedetector@^8.2.1`
- `next-themes@^0.4.6`

**Confirmed flash-mitigation injection point:**
`apps/web/src/routes/__root.tsx` already returns a `head: () => ({ meta, links })` object from `createRootRoute`. The next-themes flash script will be added as an entry in a new `scripts` array on that head config. The script runs synchronously before React hydrates because TanStack Start renders head children inline in the prerendered HTML's `<head>`. Pattern (illustrative):

```ts
head: () => ({
  meta: [...],
  links: [...],
  scripts: [
    {
      // No `defer` / `async`: must run before hydration to avoid flash
      children: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark');}}catch(e){}})();`,
    },
  ],
}),
```

If TanStack Start's `head.scripts` doesn't accept a `children` field for inline content, fall back to the `useEffect`-mounted approach used for Cloudflare Analytics in `__root.tsx`. The `useEffect` runs AFTER hydration and therefore can't fully prevent flash — pursue the `head.scripts` approach first; the useEffect is a degraded fallback.

**Confirmed locale routing:**
- `vite.config.ts` has `tanstackStart({ prerender: { enabled: true, crawlLinks: true } })`
- With `crawlLinks: true`, the prerender step crawls every internal link reachable from `/`. As long as the EN homepage's `<LanguageToggle>` renders an `<a href="/fr/">`, the FR route is auto-discovered and emitted as `.output/public/fr/index.html` — no manual `routes` config needed.
- The 404 route works the same way; `/fr/404` would only be prerendered if linked, otherwise `/404` (English) serves all unmatched URLs. Since `/fr/` is a real prerendered route and unmatched URLs go to the catch-all 404, FR-context unmatched URLs land on the EN 404. Acceptable for v1; an explicit `/fr/404.tsx` is optional polish.

**Translation key inventory (file-by-file):**

The complete set of user-visible strings to extract into `en.json` / `fr.json`. Keys use dot-namespacing per the desktop convention.

```jsonc
// apps/web/src/locales/en.json (sketch — full strings filled in during T3)
{
  // SiteHeader
  "header.brandHome": "Nixus — home",
  "header.themeToggle": "Toggle theme",
  "header.themeLight": "Light",
  "header.themeDark": "Dark",
  "header.themeSystem": "System",
  "header.languageToggle": "Toggle language",
  "header.languageEnglish": "English",
  "header.languageFrench": "Français",

  // Hero
  "hero.headline": "Your spreadsheet's replacement, finally.",
  "hero.subhead": "Drop in a credit card statement. Watch it categorize itself. See your full financial picture in one place — budget, accounts, assets, net worth.",

  // AIDemo
  "aiDemo.titlebarLabel": "Nixus — AI Import",
  "aiDemo.figureAria": "AI parsing demo: a credit card statement becomes categorized expenses in seconds",
  "aiDemo.statementHeading": "Statement",
  "aiDemo.categorizedHeading": "Categorized",
  "aiDemo.summary": "{{count}} transactions categorized in {{seconds}} seconds",
  "aiDemo.category.groceries": "Groceries",
  "aiDemo.category.diningOut": "Dining Out",
  "aiDemo.category.gas": "Gas",
  "aiDemo.category.subscriptions": "Subscriptions",
  "aiDemo.category.investing": "Investing",

  // FeatureGrid
  "features.eyebrow": "What's inside",
  "features.heading": "Everything tracked. Nothing manual.",
  "features.subhead": "Built around the data entry you actually hate — and removes it.",
  "features.aiImport.title": "AI Statement Import",
  "features.aiImport.description": "Upload a CC screenshot or PDF, get categorized expenses in seconds.",
  "features.budget.title": "Budget Builder",
  "features.budget.description": "Monthly budgets with category groups. See where you stand at a glance.",
  "features.accounts.title": "Multi-Account Tracking",
  "features.accounts.description": "Banks, credit cards, and investment accounts in a single view.",
  "features.assets.title": "Passive Asset Tracking",
  "features.assets.description": "Add real estate, vehicles, and business equity. The full picture.",
  "features.netWorth.title": "Net Worth History",
  "features.netWorth.description": "Track cash, TFSA, RRSP, crypto, and assets over time — by category.",
  "features.aiChat.title": "AI Chat",
  "features.aiChat.description": "Ask \"how much on groceries this month?\" and get an instant answer.",

  // FAQ
  "faq.eyebrow": "Questions",
  "faq.heading": "Frequently asked",
  "faq.stillHaveQuestions": "Still have questions?",
  "faq.bankConnection.question": "Does this connect to my bank?",
  "faq.bankConnection.answer": "No, by design. You upload a credit card statement (a screenshot or PDF) and the AI parses it. Nixus never asks for your bank login, never connects to Plaid, and doesn't pull data from your accounts. You stay in control.",
  "faq.installSafety.question": "Is this safe to install?",
  "faq.installSafety.answer": "Nixus is open source — you can inspect the code on GitHub. First-launch warnings (macOS Gatekeeper, Windows SmartScreen) are normal for apps not yet signed by Apple or trusted by Microsoft's reputation system. Install instructions appear after you click Download.",
  "faq.installSafety.linkInspect": "Inspect on GitHub",
  "faq.isItFree.question": "Is it free?",
  "faq.isItFree.answer": "Yes, free for now. The plan is a free tier plus paid modules later — the AI import feature is the most likely first paid module. When that ships, existing users will see clear pricing — no surprise charges.",
  "faq.dataStorage.question": "Where is my data stored?",
  "faq.dataStorage.answer": "Locally on your machine. The AI feature sends a credit card statement to AWS Bedrock for parsing only — that request is one-shot and isn't retained. Your budget data, accounts, and net worth never leave your computer.",
  "faq.linuxSupport.question": "Is Linux supported?",
  "faq.linuxSupport.answer": "Not in the alpha version. Linux support is on the roadmap but not committed. The macOS build may run via compatibility layers but isn't officially tested.",
  "faq.mobileSupport.question": "What about mobile?",
  "faq.mobileSupport.answer": "Nixus is a desktop app (macOS and Windows). There's no mobile app planned for the alpha version — the focus is on getting the desktop experience right first.",
  "faq.whoBuilt.question": "Who built this?",
  "faq.whoBuilt.answer": "One person — built because spreadsheets stopped scaling for my own finances. You can find me on GitHub, or reach out by email.",
  "faq.whoBuilt.linkGithub": "GitHub",
  "faq.whoBuilt.linkEmail": "support@nixus.nicolasbazinet.net",
  "faq.howToUpdate.question": "How do I update?",
  "faq.howToUpdate.answer": "Nothing to do — Nixus checks for updates automatically and installs them in the background. You'll always have the latest version next time you open the app.",

  // InstallInstructions
  "installInstructions.heading": "Your Nixus download is starting",
  "installInstructions.tabMacos": "macOS",
  "installInstructions.tabWindows": "Windows",
  "installInstructions.macosBody": "Once the .dmg finishes downloading, double-click it to open. The first launch shows \"Nixus is from an unidentified developer.\" Open <strong>System Settings → Privacy & Security</strong>, scroll to the bottom, and click <strong>Open Anyway</strong>. This is normal for apps not distributed through the Mac App Store.",
  "installInstructions.windowsBody": "Once the .msi finishes downloading, run it. Windows SmartScreen may warn that the publisher isn't recognized. Click <strong>More info → Run anyway</strong> to install. This is expected for new apps until they build a Microsoft reputation score.",
  "installInstructions.needHelp": "Need help?",

  // DownloadCTA
  "download.macos": "Download for macOS",
  "download.windows": "Download for Windows",
  "download.choosePlatform": "Choose your platform",
  "download.visitOnDesktop": "Visit on a Mac or PC to download",
  "download.versionLabel": "v{{version}}",
  "download.altOsLink": "Or download for {{os}}",
  "download.sendToComputer": "Send to my computer",
  "download.copyLink": "Copy link",
  "download.copied": "Copied!",
  "download.emailMeLink": "Email me a link",
  "download.linuxNote": "Looking for Linux? See our FAQ.",

  // SiteFooter
  "footer.aria": "Footer",
  "footer.linkGithub": "GitHub",
  "footer.linkContact": "support@nixus.nicolasbazinet.net",
  "footer.copyright": "Copyright © Nixus 2026 — All rights reserved",

  // 404
  "notFound.heading": "Page not found",
  "notFound.body": "The page you were looking for doesn't exist on Nixus.",
  "notFound.backHome": "Back to home",

  // Meta (per-route)
  "meta.home.title": "Nixus — Personal finance, automated",
  "meta.home.description": "Desktop personal finance app that replaces your spreadsheet. Drop in a credit card statement, watch the AI categorize it. Budget, accounts, net worth.",
  "meta.notFound.title": "Page not found — Nixus",
  "meta.notFound.description": "This page does not exist on Nixus."
}
```

**Estimated FR-translation effort:** ~70 keys, each one-liner or short paragraph. ~15 minutes of bulk translation work; the desktop's existing FR tone provides the reference voice.

**Strings explicitly NOT translated:**
- Brand names: "Nixus", "Nbazinet"
- AI demo merchant names: "Costco", "Tim Hortons", "Petro-Canada", "Tangerine", "Wealthsimple", "Netflix" (these are brand-specific data, kept literal)
- Dollar amounts in the AI demo: numerical values stay as-is; CAD currency formatting is universal
- The "ixus" gradient text in the wordmark (it's the second half of "Nixus" — keeping it untranslated keeps the brand consistent across surfaces)
- File extensions and command names in install instructions (.dmg, .msi, "Open Anyway", "Run anyway") — these are OS-language native, not Nixus copy

**S3 fetcher diff scope (T21):**
- Replace the GitHub API call (`https://api.github.com/repos/.../releases/...`) with an S3 metadata fetch (`https://nixus-downloads.s3.amazonaws.com/latest.json`)
- Drop logic that walks GitHub `assets[]` to find macOS/Windows binaries (matched by extension/filename pattern)
- Replace with: parse `latest.json` directly; assets URLs constructed as `${BUCKET_BASE}/${asset.filename}`
- Bucket base URL becomes a constant: `const BUCKET_BASE = "https://nixus-downloads.s3.amazonaws.com"` (no env var needed for v1; if region or domain changes later, parameterize)
- Drop `VITE_PINNED_RELEASE_TAG` env var support — no GitHub tag space; "pinning" now means "user uploads a different latest.json"
- Drop the `GITHUB_TOKEN` authenticated-fetch logic — S3 public-read bucket needs no auth
- The fetcher's external contract (return type `ReleaseMetadata`, stub-on-error fallback) is preserved — DownloadCTA shouldn't need to change

**Verification of crawl-prerender for /fr/:**
With `crawlLinks: true` already configured, the build's prerender step automatically discovers `/fr/` once the `<LanguageToggle>` from EN routes renders an `<a href="/fr/">`. Confirmed by reading `vite.config.ts`. No additional `prerender.routes` config needed.
