---
title: 'Fix Web CI Verify Stage & Implement S3/CloudFront Deployment'
slug: 'fix-web-ci-verify-deploy'
created: '2026-05-15'
status: 'Implementation Complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'ESLint 10 (flat config)'
  - 'typescript-eslint v8'
  - 'eslint-plugin-react-hooks v7'
  - 'globals'
  - 'GitHub Actions (ubuntu-latest)'
  - 'AWS CLI (pre-installed on ubuntu-latest runners)'
  - 'aws-actions/configure-aws-credentials@v4'
files_to_modify:
  - 'apps/web/package.json'
  - 'apps/web/eslint.config.js'
  - 'apps/web/src/components/AIDemo.tsx'
  - 'apps/web/src/components/ThemeToggle.tsx'
  - 'apps/web/src/features/download/useOSDetection.ts'
  - '.github/workflows/web-ci.yml'
code_patterns:
  - 'ESLint flat config (eslint.config.js)'
  - 'eslint-disable-next-line comments with justification (see analytics.ts)'
  - 'GitHub Actions job steps pattern (see existing verify job)'
  - 'pnpm --filter @nkbaz/web commands'
test_patterns:
  - 'No lint-specific tests — CI is the gate'
---

# Tech-Spec: Fix Web CI Verify Stage & Implement S3/CloudFront Deployment

**Created:** 2026-05-15

## Overview

### Problem Statement

1. ESLint is not installed or properly configured in `apps/web` — the `eslint.config.js` is a placeholder stub from Story 1.4. There is no `lint` script in `package.json` and no lint step in the CI verify stage. Running ESLint with proper TypeScript + React Hooks rules reveals **3 lint errors** (all `react-hooks/set-state-in-effect`) that must be suppressed with targeted disable comments.
2. The CI deploy job in `.github/workflows/web-ci.yml` is a stub `echo` placeholder — the web application is never deployed to AWS S3 or CloudFront.

### Solution

- Add ESLint deps to `apps/web/package.json`, configure real rules in `eslint.config.js`, suppress the 3 intentional violations with targeted disable comments, add a `lint` script, and add a lint step to the CI verify job.
- Replace the deploy stub with the full pipeline: checkout → setup pnpm/Node → install → build → AWS credentials → S3 sync → CloudFront invalidation.

### Scope

**In Scope:**
- `apps/web/package.json` — add ESLint devDependencies + `lint` script
- `apps/web/eslint.config.js` — replace placeholder with real config
- `apps/web/src/components/AIDemo.tsx` — add disable comment at line 163
- `apps/web/src/components/ThemeToggle.tsx` — add disable comment at line 30
- `apps/web/src/features/download/useOSDetection.ts` — add disable comment at line 46
- `.github/workflows/web-ci.yml` — add `lint` step to verify job; replace deploy stub

**Out of Scope:** Desktop app, cache-control headers, CDN domain changes

---

## Context for Development

### Codebase Patterns

- **ESLint config style**: flat config (`eslint.config.js`), already wired. Uses `export default` array.
- **ESLint disable pattern**: `// eslint-disable-next-line <rule> -- <reason>` (see `src/lib/analytics.ts` line with `no-console`). Follow this exact format for the 3 suppressions.
- **CI step pattern**: `pnpm --filter @nkbaz/web <script>` for all app-scoped commands (matching existing typecheck/test/build steps).
- **Deploy job isolation**: GitHub Actions jobs run in isolation — the deploy job must repeat checkout + pnpm/Node setup + `pnpm install` even though verify already did it.
- **Build output location**: `apps/web/.output/public` (confirmed via `lighthouserc.json` `staticDistDir: "./.output/public"`).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/web/eslint.config.js` | Replace placeholder |
| `apps/web/package.json` | Add ESLint deps + lint script |
| `apps/web/src/components/AIDemo.tsx` | Line 163: suppress `react-hooks/set-state-in-effect` |
| `apps/web/src/components/ThemeToggle.tsx` | Line 30: suppress `react-hooks/set-state-in-effect` |
| `apps/web/src/features/download/useOSDetection.ts` | Line 46: suppress `react-hooks/set-state-in-effect` |
| `.github/workflows/web-ci.yml` | Add lint step; replace deploy stub |
| `apps/web/src/lib/analytics.ts` | Reference for eslint-disable comment format |

### Technical Decisions

- **ESLint packages**: `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` — already installed into `apps/web/node_modules` (added during spec investigation). Just needs `package.json` devDependencies updated to match.
- **Rules**: `tseslint.configs.recommended` + `reactHooks.configs.recommended.rules` + `no-console: error`. The `no-console: error` rule is pre-anticipated by `analytics.ts`'s existing disable comment.
- **Why disable not downgrade**: The 3 violations are intentional, well-documented patterns (hydration fallback, mounted pattern, SSR-safe UA detection). Disabling at the call-site with a reason is the correct signal — not weakening the rule globally.
- **S3 sync**: `aws s3 sync apps/web/.output/public/ s3://nixus-web-cdn --delete` — the `--delete` removes stale files from the bucket on each deploy.
- **CloudFront invalidation**: `aws cloudfront create-invalidation --distribution-id E691EEFVS0K6N --paths "/*"` — wildcard clears the entire CDN cache.
- **AWS region**: `us-east-1` in the credentials action — CloudFront is global but the action requires a region; `us-east-1` is the standard choice for global AWS services.

---

## Implementation Plan

### Tasks

- [x] **Task 1: Update `apps/web/package.json`**
  - File: `apps/web/package.json`
  - Action: Add the following to `devDependencies`:
    ```json
    "eslint": "^10.3.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "globals": "^16.0.0",
    "typescript-eslint": "^8.59.3"
    ```
  - Action: Add to `scripts`:
    ```json
    "lint": "eslint 'src/**/*.{ts,tsx}'"
    ```
  - Notes: Packages are already present in `node_modules` from the investigation install. Adding them to `package.json` makes them reproducible.

- [x] **Task 2: Replace `apps/web/eslint.config.js`**
  - File: `apps/web/eslint.config.js`
  - Action: Replace the entire file contents with:
    ```js
    import tseslint from 'typescript-eslint';
    import reactHooks from 'eslint-plugin-react-hooks';
    import globals from 'globals';

    export default tseslint.config(
      {
        ignores: [
          'dist/**',
          '.output/**',
          '.nitro/**',
          '.tanstack/**',
          'node_modules/**',
          'src/routeTree.gen.ts',
          'src/lib/release.gen.ts',
        ],
      },
      ...tseslint.configs.recommended,
      {
        plugins: { 'react-hooks': reactHooks },
        rules: { ...reactHooks.configs.recommended.rules },
        languageOptions: { globals: { ...globals.browser } },
      },
      {
        rules: {
          'no-console': 'error',
        },
      },
    );
    ```
  - Notes: Spread `...tseslint.configs.recommended` because it returns an array; the outer `tseslint.config()` flattens it correctly.

- [x] **Task 3: Suppress lint error in `AIDemo.tsx`**
  - File: `apps/web/src/components/AIDemo.tsx`
  - Action: On the line immediately before `setIsVisible(true);` at line 163, add:
    ```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- defensive fallback when IntersectionObserver is unavailable at hydration time
    ```
  - Notes: This is in the early-return branch of the IntersectionObserver effect. The rule fires because `setState` is called synchronously in the effect body (not in a callback), but this is intentional — it's a one-time defensive guard.

- [x] **Task 4: Suppress lint error in `ThemeToggle.tsx`**
  - File: `apps/web/src/components/ThemeToggle.tsx`
  - Action: On the line immediately before `useEffect(() => setMounted(true), []);` at line 30, add:
    ```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard mounted pattern to prevent SSR/hydration flash with next-themes
    ```
  - Notes: This is the canonical pattern for avoiding hydration mismatch with `next-themes`. The `mounted` flag is deliberately set in an effect so it transitions from `false` (SSR) to `true` (client) exactly once after hydration.

- [x] **Task 5: Suppress lint error in `useOSDetection.ts`**
  - File: `apps/web/src/features/download/useOSDetection.ts`
  - Action: On the line immediately before `setOS(parseUserAgent(navigator.userAgent));` at line 46, add:
    ```ts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe: navigator.userAgent read only inside useEffect (browser-only), setState is synchronous and intentional
    ```
  - Notes: Reading `navigator.userAgent` in `useEffect` is the correct SSR-safe pattern. The setState call is synchronous and intentional — it runs once on mount to detect the OS.

- [x] **Task 6: Add lint step to CI verify job**
  - File: `.github/workflows/web-ci.yml`
  - Action: In the `verify` job, after the `Install dependencies` step and before the `Typecheck shared package` step, insert:
    ```yaml
    - name: Lint web app
      run: pnpm --filter @nkbaz/web lint
    ```

- [x] **Task 7: Replace deploy stub with real S3 + CloudFront deployment**
  - File: `.github/workflows/web-ci.yml`
  - Action: In the `deploy` job, replace the entire `steps:` block (currently just the echo placeholder) with:
    ```yaml
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build web app
        run: pnpm --filter @nkbaz/web build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Deploy to S3
        run: aws s3 sync apps/web/.output/public/ s3://nixus-web-cdn --delete

      - name: Invalidate CloudFront
        run: aws cloudfront create-invalidation --distribution-id E691EEFVS0K6N --paths "/*"
    ```
  - Notes: The `if:` condition and `needs: verify` on the job itself remain unchanged. Keep `timeout-minutes: 5` — raise to 10 if large asset syncs time out.

- [x] **Task 8: Verify locally before pushing**
  - Action: Run `pnpm --filter @nkbaz/web lint` — must exit 0 with no errors.
  - Action: Run `pnpm --filter @nkbaz/web typecheck` — must still pass.
  - Action: Run `pnpm --filter @nkbaz/web test` — must still pass.

### Acceptance Criteria

- [ ] **AC1 — Lint passes locally**
  Given `apps/web/package.json` has the `lint` script and ESLint deps,
  when `pnpm --filter @nkbaz/web lint` is run locally,
  then it exits 0 with 0 errors and 0 warnings.

- [ ] **AC2 — CI verify job includes lint step**
  Given a push to `master` touching `apps/web/**`,
  when the verify job runs in GitHub Actions,
  then a "Lint web app" step appears and passes (between "Install dependencies" and "Typecheck shared package").

- [ ] **AC3 — Existing verify checks still pass**
  Given the same push as AC2,
  when the verify job completes,
  then typecheck, unit tests, build, and Lighthouse CI all still pass as before.

- [ ] **AC4 — CI deploy job syncs to S3**
  Given the verify job passes on a push to `master`,
  when the deploy job runs,
  then the "Deploy to S3" step executes `aws s3 sync apps/web/.output/public/ s3://nixus-web-cdn --delete` and exits 0.

- [ ] **AC5 — CI deploy job invalidates CloudFront**
  Given the S3 sync step passes,
  when the "Invalidate CloudFront" step runs,
  then `aws cloudfront create-invalidation --distribution-id E691EEFVS0K6N --paths "/*"` exits 0.

- [ ] **AC6 — Deploy does not run on PRs**
  Given a PR is opened against `master`,
  when the CI workflow runs,
  then the deploy job is skipped (verify runs, deploy does not).

---

## Additional Context

### Dependencies

- ESLint packages (`eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`) are already present in `apps/web/node_modules` — the `package.json` update in Task 1 makes them reproducible for fresh installs and CI.
- `aws-actions/configure-aws-credentials@v4` is a GitHub-maintained action, no installation needed.
- AWS CLI is pre-installed on `ubuntu-latest` GitHub Actions runners — no explicit install step needed.
- GitHub secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` must exist in the repo's GitHub Settings → Secrets → Actions before the deploy step will succeed.

### Testing Strategy

No automated tests for CI/lint config changes. Verification is:
1. Run `pnpm --filter @nkbaz/web lint` locally → must exit 0 (Task 8).
2. Run `pnpm --filter @nkbaz/web typecheck && pnpm --filter @nkbaz/web test` → must still pass.
3. Push to `master` and observe the GitHub Actions run for both verify and deploy jobs.

### Notes

- The `analytics.ts` file already has `// eslint-disable-next-line no-console` — confirming `no-console: error` was the intended rule from the start.
- CloudFront distribution ID: `E691EEFVS0K6N` (the value `d2qtb4uo4upbx2.cloudfront.net` provided originally is the CloudFront *domain*, not the distribution ID).
- The deploy job `timeout-minutes: 5` may need to increase to `10` if `.output/public/` grows large with more prerendered pages.
- After a successful first deploy, verify the live site at the CloudFront domain to confirm assets are served correctly.
