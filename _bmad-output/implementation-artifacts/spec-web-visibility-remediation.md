---
title: 'Repair Nixus website visibility signals'
type: 'bugfix'
created: '2026-08-21'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'af0b4b5'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `nixusapp.com` serves the marketing site while declaring another hostname canonical, and prerender/CDN defects expose duplicate or wrong-language HTML to crawlers. Google consequently lacks a consistent, authoritative Nixus website identity.

**Approach:** Make `nixusapp.com` the single repository-defined public identity, make locale output deterministic, add truthful entity structured data, and provide a tested CloudFront URI rewrite artifact and operator runbook for the infrastructure changes that cannot safely execute from this repository.

## Boundaries & Constraints

**Always:** Preserve English and French routes; use test-first changes; keep support email addresses unchanged; keep all new canonical, Open Graph, hreflang, sitemap, and JSON-LD URLs consistent; leave unrelated dirty desktop/profile files untouched.

**Ask First:** Any live AWS, DNS, Search Console, email-domain, deployment-secret, or redirect-distribution mutation; any change to desktop bundle identity.

**Never:** Fabricate ratings, reviews, social accounts, or `SoftwareApplication` eligibility data; add AI-specific SEO files unsupported by Google; modify historical planning artifacts or generated `.output` files; commit or revert the user's unrelated work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Canonical home | `/` or `/fr/` prerender | Self-canonical URL on `nixusapp.com`, matching locale and hreflang | Build verification fails on drift |
| Canonical content page | `/beta` or `/fr/beta` | Stable canonical path without duplicate-host references | Build verification fails on drift |
| Locale isolation | English page rendered after French page | English HTML/body remains English; French remains French | Regression test reproduces order change |
| Static route rewrite | Extensionless route | CloudFront function maps to the matching `index.html` object | Offline route verifier fails if object is absent |
| Asset request | URI with file extension | URI remains unchanged | Unit test rejects accidental rewrite |
| Unknown route | Missing extensionless path | Rewrites to a missing object so CloudFront can return real 404 | Runbook removes 200 homepage fallback only after function association |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/meta.ts` -- canonical, Open Graph, Twitter, and hreflang source of truth; currently hardcodes the old host.
- `apps/web/src/routes/__root.tsx` -- HTML language and site-wide head scripts; currently reads mutable i18n state.
- `apps/web/src/routes/{index,beta,404}.tsx`, `apps/web/src/routes/fr/*.tsx` -- route loaders that must set locale deterministically.
- `apps/web/src/lib/i18n.ts` -- initial path-language detection; reuse a segment-safe locale helper.
- `apps/web/public/{robots.txt,sitemap.xml}` -- crawler discovery files currently listing the old host.
- `apps/web/src/lib/{meta,robots,sitemap}.test.ts` -- existing SEO tests and natural regression seams.
- `apps/web/scripts/generate-og-image.ts` -- visible old hostname embedded in the generated social image.
- `.github/workflows/web-ci.yml` -- build/deploy pipeline; add offline prerender and route contract gates, not live AWS mutation.
- `apps/web/infra/cloudfront/` -- new versioned viewer-request rewrite function; no infrastructure-as-code exists today.
- `README.md` -- public project links still reinforce the old website hostname.
- `apps/desktop/**`, existing modified implementation artifacts -- read-only and out of scope.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/localePaths.ts`, route files, and tests -- derive locale from route boundaries and reset i18n before each prerender so output is order-independent.
- [x] `apps/web/src/lib/meta.ts`, static crawler files, tests, and OG generator -- migrate all website identity URLs to `https://nixusapp.com` with consistent root trailing slash behavior.
- [x] `apps/web/src/lib/jsonLd.ts` and tests -- emit valid `WebSite` and `Organization` JSON-LD using only verified project facts.
- [x] `apps/web/scripts/verify-prerender.ts` and CI -- inspect built HTML for language, canonical, hreflang, and parseable JSON-LD contracts.
- [x] `apps/web/infra/cloudfront/spa-index-rewrite.js`, tests, route verifier, and runbook -- version and prove the route rewrite while documenting safe live rollout and rollback.
- [x] `README.md` -- replace old marketing links while preserving the existing support mailbox.

**Acceptance Criteria:**
- Given a production build, when every public route is inspected, then its HTML language, body locale, canonical URL, Open Graph URL, hreflang links, and JSON-LD agree on the route and `nixusapp.com`.
- Given sitemap routes and static output, when the edge rewrite verifier runs, then every rewritten object exists and asset URIs remain unchanged.
- Given an unknown extensionless route, when the rewrite function runs, then it does not map the request to the homepage.
- Given the full web quality gates, when lint, typecheck, tests, build, prerender verification, and route verification run, then all exit successfully.

## Spec Change Log

- 2026-08-21 — Implementation finding: the Nitro prerender runs with concurrency 12 against the single i18next module instance, so resetting the singleton per route (this spec's stated approach) is necessary but not sufficient — a sibling page can move the language between `beforeLoad` and render. Locale isolation is therefore enforced two ways: every route still pins the singleton via `applyRouteLocale`, and `__root.tsx` renders through a locale-pinned `i18nForLocale(locale)` clone derived from the route path, so the rendered tree cannot read another page's locale. Regression proven red-then-green in `src/lib/i18n.test.tsx`.
- 2026-08-21 — Root canonical now carries a single trailing slash (`https://nixusapp.com/`). Before this change canonical/og:url emitted the bare origin while hreflang and the sitemap emitted `/`, which is itself a duplicate-URL signal.
- 2026-08-21 — Site identity constants moved to a new leaf module `apps/web/src/lib/site.ts` so `meta`, `jsonLd`, `i18n` and `localePaths` can share them without an import cycle. `meta.ts` re-exports `SITE` and `Locale`, so no existing importer changed.
- 2026-08-21 — `.env.example` (`VITE_SITE_URL`) and the `DownloadCTA` share-link expectation were also on the retired host; both migrated. Support mailbox `support@nixus.nicolasbazinet.net` left untouched everywhere, including in the new `Organization` JSON-LD node.

## Design Notes

CloudFront currently maps origin errors to `/index.html` with HTTP 200. The repository can ship and test a viewer-request function, but associating it and removing the custom error fallback are live infrastructure changes. The runbook must require function association first, then true 404 handling, then path-preserving redirection from the old hostname.

## Verification

**Commands:**
- `pnpm --filter @nixus/web lint` -- expected: no lint errors.
- `pnpm --filter @nixus/web typecheck` -- expected: no TypeScript errors.
- `pnpm --filter @nixus/web test` -- expected: all unit tests pass.
- `pnpm --filter @nixus/web build` -- expected: all EN/FR routes prerender.
- `pnpm --filter @nixus/web verify:prerender` -- expected: locale and SEO contracts pass against generated HTML.
- `pnpm --filter @nixus/web verify:routes` -- expected: rewritten sitemap routes resolve to generated objects.
