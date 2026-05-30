---
title: 'i18n Infrastructure with French/English and Locale-Aware Formatting'
type: 'feature'
created: '2026-04-07'
status: 'done'
baseline_commit: 'c0850480'
context:
  - docs/guidelines/warnings.md
---

# i18n Infrastructure with French/English and Locale-Aware Formatting

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app is English-only with hard-coded strings and en-US currency formatting. The user needs French/English support with a UI toggle.

**Approach:** Add react-i18next with JSON translation files (en/fr), a locale context with localStorage persistence, a language toggle in the sidebar, and locale-aware currency formatting. This spec covers infrastructure and shared components only — per-page translations are deferred.

## Boundaries & Constraints

**Always:** Use `useTranslation` hook pattern. Keep translation keys flat and namespaced (e.g., `nav.dashboard`, `sidebar.backup`). Currency formatting must respect the active locale (en-CA / fr-CA since the app uses CAD).

**Ask First:** Adding a third language. Changing currency (CAD/USD) based on locale.

**Never:** Database-backed locale storage (localStorage only for now). Server-side i18n. Translating user-generated content (account names, merchant names).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default locale | First visit, no localStorage | English (en) | N/A |
| Toggle to French | Click language button in sidebar | All shared strings switch to French, currency shows `1 234,56 $` | N/A |
| Persist across reload | Locale set to fr, reload app | French persists from localStorage | Falls back to en if read fails |
| Missing translation key | Key exists in en but not fr | Falls back to English string | N/A (i18next default) |

</frozen-after-approval>

## Code Map

- `src/lib/i18n.ts` -- i18next init config
- `src/locales/en.json` -- English translations (shared namespace only)
- `src/locales/fr.json` -- French translations (shared namespace only)
- `src/main.tsx` -- import i18n init
- `src/components/shared/AppSidebar.tsx` -- add language toggle button, translate labels
- `src/components/shared/TopBar.tsx` -- translate placeholder
- `src/components/shared/InnerTabNav.tsx` -- translate nav labels
- `src/components/shared/UpdateChecker.tsx` -- translate dialog strings
- `src/lib/formatCurrency.ts` -- accept locale param, format per locale
- `src/hooks/useFormatCurrency.ts` -- pass current locale to formatter

## Tasks & Acceptance

**Execution:**
- [ ] Install `i18next` and `react-i18next` -- core i18n framework
- [ ] `src/lib/i18n.ts` -- create i18next config with en/fr resources, localStorage language detector, fallback to en
- [ ] `src/locales/en.json` -- extract shared strings: sidebar labels, nav labels, topbar placeholder, update checker, common words (save, cancel, delete, etc.)
- [ ] `src/locales/fr.json` -- French translations matching en.json keys
- [ ] `src/main.tsx` -- import `src/lib/i18n.ts` (side-effect import to init before render)
- [ ] `src/components/shared/AppSidebar.tsx` -- add language toggle SidebarButton (Globe icon, cycles en/fr), replace hard-coded labels with `t()` calls
- [ ] `src/components/shared/TopBar.tsx` -- replace placeholder and aria-label with `t()` calls
- [ ] `src/components/shared/InnerTabNav.tsx` -- replace nav labels with `t()` calls
- [ ] `src/components/shared/UpdateChecker.tsx` -- replace dialog strings with `t()` calls
- [ ] `src/lib/formatCurrency.ts` -- add locale parameter, use `fr-CA`/`en-CA` for formatting, update accessible format for French ("dollars" vs "dollars")
- [ ] `src/hooks/useFormatCurrency.ts` -- read current i18n language, pass matching locale to formatCurrency

**Acceptance Criteria:**
- Given the app loads for the first time, when viewing any shared component, then all strings display in English
- Given the user clicks the language toggle in the sidebar, when the UI re-renders, then all shared component strings display in French and currency formats as `1 234,56 $`
- Given the user sets French and reloads, when the app loads, then French is restored from localStorage
- Given a translation key is missing in fr.json, when rendering, then the English fallback displays

## Verification

**Commands:**
- `npm run build` -- expected: no TypeScript/build errors
- `npm run check` -- expected: no lint errors

**Manual checks:**
- Toggle language in sidebar: all nav labels, sidebar labels, topbar placeholder switch between EN/FR
- Currency values display correctly in both locales (e.g., `$1,234.56` vs `1 234,56 $`)
