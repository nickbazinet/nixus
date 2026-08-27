---
title: 'Restore hero image preloads for GitHub Actions job 98631539207'
type: 'bugfix'
created: '2026-08-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '90a54e6ed5b9901ae5193aad72086e9904c27716'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Web CI deterministically fails the three Playwright `dev-*` projects because the English home page renders a CSS-backed hero without declaring either hero background as an image preload. The browser finds zero `link[rel=preload][as=image]` elements where the established contract requires two colour-scheme alternatives.

**Approach:** Define the two backdrop preload descriptors beside the `Hero` component that owns their asset paths, then merge them into the head configuration of the English and French home routes that render that component. Preserve the existing test as the failing-first regression proof.

## Boundaries & Constraints

**Always:** Keep the preload hrefs identical to the CSS background URLs; declare one light and one dark `prefers-color-scheme` media condition; use high fetch priority; apply the descriptors only to routes that render `Hero`; preserve strict TypeScript and existing TanStack Router head patterns.

**Ask First:** Any change to hero visuals, theme behavior, asset files, route structure, or the scope of the existing E2E contract.

**Never:** Remove or weaken the failing test; add global preloads to heroless routes; change the shared SEO helper to know about a component-specific asset; add dependencies; modify generated route files; include the incomplete prerender-verifier scaffolding in this focused CI fix.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Light preference | Home route with light colour scheme | Two preloads are declared; only the light media query matches and its image is requested | Existing Playwright assertion fails on missing, duplicate, or unused preload |
| Dark preference | Home route with dark colour scheme | Two preloads are declared; only the dark media query matches and its image is eligible for early fetch | Browser media query prevents the inactive variant from downloading |
| Heroless route | Any route without `Hero` | No hero background preload is emitted | Route-local head composition prevents global leakage |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/Hero.tsx:25-31` -- owns the hero and the canonical `/hero-bg-light.webp` and `/hero-bg-dark.webp` CSS URLs; export colocated immutable preload descriptors here.
- `apps/web/src/routes/index.tsx:13-16` -- English home route renders `Hero`; merge the descriptors into `buildMeta({ locale: "en" }).links`.
- `apps/web/src/routes/fr/index.tsx:13-16` -- French home route renders the same `Hero`; apply the identical route-local head contract.
- `apps/web/tests/e2e/dev-console.spec.ts:62-102` -- existing failing-first browser contract verifies count, media matching, priority, actual request, and absence of unused-preload warnings; read-only.
- `apps/web/src/lib/meta.ts:55-119` -- general SEO helper; read-only because hero performance metadata is component-specific.
- `apps/web/scripts/verify-prerender.ts:78-123` -- comment describes an unimplemented static check; explicitly out of scope for this CI failure.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/Hero.tsx` -- export immutable light/dark image preload descriptors next to the hero asset usage so URLs and performance metadata stay coupled.
- [x] `apps/web/src/routes/index.tsx` -- append hero descriptors to the English home route head without altering standard metadata.
- [x] `apps/web/src/routes/fr/index.tsx` -- append the same descriptors to the French home route head for parity.

**Acceptance Criteria:**
- Given any of the three `dev-*` Playwright projects, when `/` loads, then exactly two high-priority hero image preloads exist, exactly one media query matches, its image is requested, and Chromium reports no unused preload warning.
- Given the web package, when lint, typecheck, unit tests, build, prerender verification, route verification, and the full E2E suite run, then every command exits successfully.
- Given the final diff, when reviewed, then no test weakening, unrelated redesign, generated-file edit, dependency change, or heroless-route preload is present.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @nixus/web lint` -- expected: zero lint errors.
- `pnpm --filter @nixus/web typecheck` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/web test` -- expected: all unit tests pass.
- `pnpm --filter @nixus/web build` -- expected: production prerender build exits zero.
- `pnpm --filter @nixus/web verify:prerender` -- expected: all static HTML contracts pass.
- `pnpm --filter @nixus/web verify:routes` -- expected: edge rewrite contract passes.
- `pnpm --filter @nixus/web exec playwright test --project=dev-pixel --project=dev-tablet --project=dev-desktop -g "requests every hero preload"` -- expected: the three previously failing cases pass.
- `pnpm --filter @nixus/web test:e2e` -- expected: complete responsive browser suite passes.

## Suggested Review Order

**Preload contract**

- Colocate immutable descriptors with the CSS assets they accelerate.
  [`Hero.tsx:10`](../../apps/web/src/components/Hero.tsx#L10)

**Route binding**

- Attach preloads only to the English route that renders the hero.
  [`index.tsx:13`](../../apps/web/src/routes/index.tsx#L13)

- Preserve identical preload behavior on the French home route.
  [`fr/index.tsx:13`](../../apps/web/src/routes/fr/index.tsx#L13)

**Deferred hardening**

- Record theme-override and static-verifier decisions outside this focused fix.
  [`deferred-work.md:370`](deferred-work.md#L370)
