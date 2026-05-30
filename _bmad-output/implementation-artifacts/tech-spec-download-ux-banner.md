---
title: 'Download UX: slide-down banner below hero'
type: 'feature'
created: '2026-05-15'
status: 'done'
baseline_commit: '615bf5d5ed985a9095634e42446448cbd4ad17a1'
context: []
---

# Download UX: slide-down banner below hero

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After clicking Download, installation instructions appear at the very bottom of the page (after the FAQ section), requiring the user to scroll far to find them. The heading "Your Nixus download is starting" is generic and tells nothing about what to do next. Windows copy incorrectly says `.msi` — the asset is an `.exe`.

**Approach:** Replace the bottom-of-page `InstallInstructions` section with a compact banner that slides open directly below the Hero when a download is clicked. The banner shows only the clicked OS's instruction inline (no tabs), with clear actionable copy. Position it between `<Hero />` and `<AIDemo />` in both routes so no scrolling is required.

## Boundaries & Constraints

**Always:** Use existing `DownloadStateContext` (`hasClicked`, `clickedOS`) for state — do not introduce new state. Support both `en` and `fr` locales. Show the clicked OS instruction directly without requiring any additional user action (no tab click, no scroll). Keep `data-testid` attributes on key elements for test coverage.

**Ask First:** Whether to add a dismiss/close button on the banner.

**Never:** Introduce new animation libraries (use Tailwind CSS only). Break SSR/hydration behavior. Affect the mobile or Linux CTA variants. Modify `DownloadStateContext` or `DownloadCTA`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| macOS download clicked | `hasClicked=true`, `clickedOS='macos'` | Banner animates open below Hero; macOS instruction shown | N/A |
| Windows download clicked | `hasClicked=true`, `clickedOS='windows'` | Banner animates open below Hero; Windows instruction with `.exe` shown | N/A |
| No click yet | `hasClicked=false` | Banner is collapsed/invisible; no layout space consumed | N/A |
| Second click (other OS) | `clickedOS` changes | Banner stays open; instruction updates to new OS | N/A |
| `clickedOS` is null but `hasClicked=true` | Unexpected state | Fall back to macOS instruction | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/InstallInstructions.tsx` — existing component to replace with `DownloadBanner.tsx`
- `apps/web/src/components/InstallInstructions.test.tsx` — existing tests to replace with `DownloadBanner.test.tsx`
- `apps/web/src/routes/index.tsx` — renders page sections; move/replace `<InstallInstructions />` → `<DownloadBanner />`
- `apps/web/src/routes/fr/index.tsx` — French route; same change
- `apps/web/src/locales/en.json` — add `downloadBanner.*` keys
- `apps/web/src/locales/fr.json` — add French `downloadBanner.*` keys
- `apps/web/src/features/download/DownloadStateContext.tsx` — read-only reference; provides `hasClicked` + `clickedOS`

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/locales/en.json` -- add keys: `downloadBanner.heading = "Download started"`, `downloadBanner.macosBody = "When macOS shows \"unidentified developer,\" open <strong>System Settings → Privacy & Security</strong> and click <strong>Open Anyway</strong>. Normal for apps outside the Mac App Store."`, `downloadBanner.windowsBody = "When SmartScreen appears, click <strong>More info → Run anyway</strong> to install the .exe. Expected for new apps until they build a Microsoft trust score."`, `downloadBanner.needHelp = "Need help?"` -- new i18n namespace for banner
- [ ] `apps/web/src/locales/fr.json` -- add French equivalents of all `downloadBanner.*` keys; `windowsBody` must reference `.exe` not `.msi` -- parity with English
- [ ] `apps/web/src/components/DownloadBanner.tsx` -- create new component; always renders a grid-row-animated wrapper (`grid-rows-[0fr]` → `grid-rows-[1fr]` on `hasClicked`), inner `div` has `overflow-hidden`; content: `bg-muted/50 border-y` strip spanning full width, constrained inner div `max-w-[960px]`; heading from `downloadBanner.heading`, body from `downloadBanner.${clickedOS ?? 'macos'}Body` via `<Trans>`; support email link with `data-testid="download-banner-help"`; outer wrapper `data-testid="download-banner"` -- replaces InstallInstructions with banner-style UX
- [ ] `apps/web/src/components/InstallInstructions.tsx` -- delete file -- replaced by DownloadBanner
- [ ] `apps/web/src/components/DownloadBanner.test.tsx` -- create tests covering: (a) wrapper present in DOM but collapsed when `hasClicked=false`, (b) content visible when `hasClicked=true` with macOS instruction, (c) Windows instruction shown when `clickedOS='windows'`, (d) help mailto link present; use same `Seeder` + `renderWithProviders` pattern from old test file -- new test coverage for DownloadBanner
- [ ] `apps/web/src/components/InstallInstructions.test.tsx` -- delete file -- replaced by DownloadBanner.test.tsx
- [ ] `apps/web/src/routes/index.tsx` -- replace `import { InstallInstructions }` with `import { DownloadBanner }` from `@/components/DownloadBanner`; move render from bottom (after `<FAQ />`) to between `<Hero />` and `<AIDemo />` -- new placement removes need to scroll
- [ ] `apps/web/src/routes/fr/index.tsx` -- same import + placement change as index.tsx -- French route parity

**Acceptance Criteria:**
- Given the homepage loads with no prior click, when the page renders, then `data-testid="download-banner"` is present in the DOM but the banner occupies no visible height (collapsed).
- Given a user clicks the macOS download button, when `hasClicked` becomes true with `clickedOS='macos'`, then the banner animates open below the Hero without scrolling and shows the macOS Gatekeeper instruction.
- Given a user clicks the Windows download button, when the banner opens, then the instruction copy references `.exe` (not `.msi`).
- Given the French locale is active, when the banner opens, then French copy is shown with `.exe` in the Windows instruction.
- Given the banner is open, when `clickedOS` changes (user clicked the other OS), then the banner body updates to show the new OS instruction.

## Design Notes

**Slide-down animation:** Use CSS grid-row trick — no JS height measurement needed:
```tsx
<div className={cn(
  "grid transition-[grid-template-rows] duration-500 ease-out",
  hasClicked ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
)}>
  <div className="overflow-hidden"> {/* inner div prevents bleed */}
    {/* banner content */}
  </div>
</div>
```
The outer wrapper is always in the DOM (important: do NOT conditionally return null), so React can animate the transition. `aria-hidden={!hasClicked}` hides it from assistive tech when collapsed.

**No tabs:** `clickedOS` is already known from context — render only the relevant OS body. Fall back to `'macos'` if `clickedOS` is null.

## Verification

**Commands:**
- `pnpm --filter @nkbaz/web typecheck` -- expected: no type errors
- `pnpm --filter @nkbaz/web test` -- expected: all tests pass including new DownloadBanner.test.tsx
