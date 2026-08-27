---
title: 'Mobile-responsive marketing site refactor'
type: 'refactor'
created: '2026-08-27'
status: 'done'
baseline_commit: '05f2525a094d574b52e2fb866dd245cba26c1c8f'
review_loop_iteration: 0
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On cellphone viewports, the sticky header's full mobile download block overlaps page content, the Beta destination disappears, display type and section spacing remain desktop-sized, and several controls miss the 44px touch-target standard. The result is technically overflow-safe but visually broken and unnecessarily long.

**Approach:** Preserve the existing “Quiet Ledger” brand and full marketing pitch while adding a deliberate phone/tablet responsive tier. Make the mobile header compact, scale typography and rhythm fluidly, keep interactions touch-safe, and lock the behavior with cross-route browser tests.

## Boundaries & Constraints

**Always:** Cover every English and French public route; preserve SSR/prerender and no-JS download links; keep desktop download behavior, localization, theme, accessibility, reduced motion, and design tokens intact; use mobile-first Tailwind v4 classes and web-local tokens; keep meaningful phone controls at least 44×44 CSS px.

**Ask First:** Any copy, palette, brand, route, dependency, shared-package token, desktop-app primitive, or external deployment/infrastructure change.

**Never:** Build a separate mobile site, hide the pitch on phones, migrate frameworks, edit `routeTree.gen.ts` or `release.gen.ts`, weaken desktop layouts, suppress hydration/type errors, or change CloudFront as part of this refactor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Phone routes | 320–430px, any EN/FR route | No overlap or horizontal overflow; compact header; readable type/rhythm | Test reports the offending route and element |
| Mobile download | iOS/Android UA | One full send-to-computer affordance in page content; no oversized duplicate in sticky header | Copy failure leaves email fallback usable |
| Unsupported desktop | Linux/unknown UA | Existing platform chooser and no-JS links remain usable | Preserve current fallback |
| Tablet | 640–1023px | Intermediate spacing/type scale without desktop crowding | Fall back to mobile-first layout |
| Desktop regression | 1280px+ macOS/Windows UA | Existing composition and direct OS download remain intact | Browser test fails on console/layout regression |

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md` -- authoritative brand spine; add marketing-specific responsive type, spacing, header, and touch rules before code uses them.
- `apps/web/src/styles/main.css` -- fixed 48/64px display and 20px lead tokens; define fluid web typography and phone defaults here.
- `apps/web/src/components/SiteHeader.tsx` -- fixed 80px header currently contains the 148px mobile CTA and hides Beta below `sm`.
- `apps/web/src/features/download/DownloadCTA.tsx` -- shared SSR/OS variants; split the oversized module while preserving analytics, links, and hydration shape.
- `apps/web/src/components/{Hero,ValuePillars,AIDemo,FeatureGrid,BetaSection,FAQ,DownloadBanner,LimitationsList,PreAlphaBanner,SiteFooter}.tsx` -- landing-page type, section rhythm, grids, and touch targets.
- `apps/web/src/components/{BetaPage,LegalPage}.tsx` and `apps/web/src/routes/{404,fr/404}.tsx` -- secondary-route responsive composition.
- `apps/web/playwright.config.ts`, `apps/web/tests/e2e/` -- currently desktop-only config and no E2E specs; add phone/tablet/desktop coverage.
- `.github/workflows/web-ci.yml` -- existing web gate omits Playwright; run responsive E2E in CI without altering deployment behavior.
- `apps/web/src/routeTree.gen.ts`, `apps/web/src/features/download/release.gen.ts` -- generated, read-only.

## Tasks & Acceptance

**Execution:**
- [x] `DESIGN.md` and `apps/web/src/styles/main.css` -- codify and implement the responsive web type, spacing, touch, and header contract.
- [x] `SiteHeader.tsx`, `DownloadCTA.tsx`, and their tests -- remove the full mobile CTA from sticky chrome, keep Beta reachable, preserve SSR/download semantics, and split responsibilities below the project LOC ceiling.
- [x] Landing and secondary-page components in the Code Map -- apply phone/tablet typography, spacing, alignment, media, and target sizing without changing content or desktop composition.
- [x] `playwright.config.ts` and `tests/e2e/*.spec.ts` -- add 320/375/390/430/768/1280 route, overflow, console, navigation, CTA, and desktop-regression checks.
- [x] `.github/workflows/web-ci.yml` -- install Chromium and execute the responsive E2E suite in the existing verification job.

**Acceptance Criteria:**
- Given each EN/FR route at 320, 375, 390, and 430px, when it renders and scrolls, then no element overlaps sticky chrome, clips, or exceeds the viewport.
- Given a mobile UA, when the header and hero render, then Beta remains reachable, header controls are touch-safe, and only page content shows the full send-to-computer CTA.
- Given 768px and 1280px viewports, when the same routes render, then layout scales progressively and desktop download/navigation behavior is unchanged.
- Given keyboard, reduced-motion, and 200% zoom modes, when visitors navigate, then focus, content order, and operability remain intact.
- Given CI verification, when the refactor is built, then lint, typecheck, unit, prerender, route, Playwright, and real-browser Lighthouse gates pass without console or hydration errors on the local production build.

## Design Notes

This is responsive compaction, not a visual redesign. The phone header should contain only brand/navigation utilities; the hero remains the single full mobile conversion affordance. Use fluid type and stepped section rhythm so 375px pages retain the same narrative without desktop-scale headings or dead space.

## Verification

**Commands:**
- `pnpm --filter @nixus/web lint && pnpm --filter @nixus/web generate && pnpm --filter @nixus/shared typecheck && pnpm --filter @nixus/shared test` -- expected: zero errors or warnings.
- `pnpm --filter @nixus/web typecheck && pnpm --filter @nixus/web test && pnpm --filter @nixus/web build` -- expected: clean strict build and unit suite.
- `pnpm --filter @nixus/web verify:prerender && pnpm --filter @nixus/web verify:routes && pnpm --filter @nixus/web test:e2e` -- expected: every route and viewport passes.
- Real Chrome against the production preview, mobile and desktop -- expected: Lighthouse 100 in Performance, Accessibility, Best Practices, and SEO; `/visual-qa` passes at 375/768/1280px.

## Spec Change Log

### 2026-08-27 — implementation

All five execution tasks complete. Every verification command passes: lint, generate, shared typecheck, shared contrast test (65), web typecheck, web unit (197), build, `verify:prerender` (10 routes), `verify:routes` (18 checks), `test:e2e` (183 passed / 33 tier-skipped across 6 viewports, two consecutive clean runs).

Three deviations and two acceptance gaps, recorded because they change how the spec should be read:

1. **E2E serves the production artifact, not `vite preview`.** Added `apps/web/scripts/preview-static.ts` (Node built-ins only, no dependency) which serves `.output/public` through the shipped `infra/cloudfront/spa-index-rewrite.js` with brotli/gzip and CloudFront-shaped cache headers, on port 4319 with `reuseExistingServer: false`. `vite preview` boots Nitro SSR on port 3000, where an unrelated process silently served its own pages to the suite and reported as a site-wide layout failure. Compression is load-bearing for measurement, not cosmetic: uncompressed, the 73 KB stylesheet read as 1.2 s of render blocking and mobile performance measured 63 instead of 89–96.

2. **`BetaPage.tsx` and `AIDemo.tsx` were split.** Not named in the task list, but both were already over or near the 250 pure-LOC ceiling and the responsive work added lines. `BetaPage` 264 → 133 (extracting `BetaFitCards`, `BetaScreenshots`, `BetaGetStarted`); `AIDemo` 208 → 174 (demo data to `content/aiDemo.ts`). `DownloadCTA` 287 → 56 as specified. No file now exceeds 174.

3. **The pre-alpha banner's "Learn more" moved inside its sentence.** As a sibling flex item it reserved ~130 px of the row, squeezing the message into 4–6 lines and making the banner 190 px tall at 375 px and ~250 px at 320 px — the "unnecessarily long" symptom the Intent names, above the fold. Inline it is ~80–95 px. It therefore keeps the sentence's line box instead of a 44 px box, which is the inline-prose exclusion `{marketing-web.tap-min}` states; the dismiss control remains 44 px.

**Acceptance gap — Lighthouse is not 100 in all four categories on `/`.** Median of 3 real-Chrome runs against the production preview: mobile `/` 89/96/100/92, desktop `/` 100/96/100/92, and 100/100/100/100 on `/beta` both form factors. All three shortfalls are pre-existing and out of this spec's boundaries:

- **Accessibility 96** — `color-contrast` fails on 10 AIDemo nodes because the demo's infinite fade loop leaves text at partial opacity (measured 0.13–0.63 mid-cycle), so axe composites washed-out foregrounds. Under `prefers-reduced-motion` every row is opacity 1, which `a11y-modes.spec.ts` asserts. Fixing it means changing the demo's animation or its raw-palette classes — a visual redesign, and "Ask First" for palette.
- **SEO 92** — `link-text` flags the banner's "Learn more" as non-descriptive on every route. The fix is new copy or a new `aria-label` string; copy is "Ask First".
- **Performance 89 mobile** — LCP 2.6–3.8 s from the 264 KB hero background webp, loaded through a CSS `before:bg-[url()]` pseudo-element so it is neither discoverable in the initial document nor `fetchpriority`-hinted. Both the asset and that mechanism are byte-identical to baseline `05f2525`.

The existing `lighthouserc.json` thresholds (a11y ≥ 0.7, best-practices ≥ 0.85, SEO ≥ 0.7, performance warn ≥ 0.9) are unchanged and still pass; tightening them would gate CI on the three pre-existing issues above.

### 2026-08-27 — review patches

Review removed dual colour-scheme hero preloads because a stored theme can disagree with the media query and Firefox reports the unused preload. Deployment now retains old fingerprinted assets so browser-cached HTML and open tabs cannot lose CSS or code chunks. The animated demo is hidden from assistive technology while its stable figure label provides the intended summary.

## Suggested Review Order

**Responsive design contract**

- Defines the mobile type, rhythm, chrome, and touch invariants.
  [`DESIGN.md:456`](../planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md#L456)

- Implements fluid web tokens without changing shared desktop primitives.
  [`main.css:62`](../../apps/web/src/styles/main.css#L62)

**Mobile chrome and conversion**

- Keeps navigation compact while preserving Beta, theme, and locale controls.
  [`SiteHeader.tsx:28`](../../apps/web/src/components/SiteHeader.tsx#L28)

- Routes OS-specific conversion through focused, reusable variants.
  [`DownloadCTA.tsx:76`](../../apps/web/src/features/download/DownloadCTA.tsx#L76)

**Hydration and accessibility**

- Places theme state inside the document and permits intentional prepaint attributes.
  [`__root.tsx:74`](../../apps/web/src/routes/__root.tsx#L74)

- Keeps animated visuals out of the accessibility tree behind one stable label.
  [`AIDemo.tsx:129`](../../apps/web/src/components/AIDemo.tsx#L129)

**Safe deployment**

- Publishes immutable assets before no-cache documents and retains prior hashes.
  [`web-ci.yml:180`](../../.github/workflows/web-ci.yml#L180)

- Waits for CloudFront invalidation before completing deployment.
  [`web-ci.yml:207`](../../.github/workflows/web-ci.yml#L207)

- Locks deployment ordering and cache policy as executable contracts.
  [`deploy-pipeline.test.ts:110`](../../apps/web/infra/deploy/deploy-pipeline.test.ts#L110)
