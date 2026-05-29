---
title: 'Restructure repository into pnpm monorepo'
type: 'refactor'
created: '2026-04-14'
status: 'done'
baseline_commit: 'eea67a66'
context: ['_bmad-output/planning-artifacts/architecture.md']
---

# Restructure repository into pnpm monorepo

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository is a flat Tauri desktop app. The platform architecture requires a monorepo with `apps/` and `packages/` to support the upcoming web app, API, and shared types package.

**Approach:** Migrate from npm to pnpm workspaces. Move all desktop app files into `apps/desktop/`. Create workspace root config and `packages/shared/` scaffold. Verify the desktop app still builds.

## Boundaries & Constraints

**Always:** Preserve all existing desktop app functionality — no code changes, only file moves and config updates. Keep `_bmad/`, `_bmad-output/`, `docs/`, `CLAUDE.md`, `README.md`, `.github/` at repo root.

**Ask First:** If any dependency fails to resolve after pnpm migration.

**Never:** Scaffold `apps/web/` or `apps/api/` in this spec — those are separate work. Do not modify any React/Rust source code. Do not change the desktop app's version number.

</frozen-after-approval>

## Code Map

- `package.json` -- current root package.json, becomes apps/desktop/package.json
- `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json` -- move to apps/desktop/ (relative paths stay valid)
- `components.json`, `playwright.config.ts`, `index.html` -- move to apps/desktop/
- `src/`, `src-tauri/`, `public/`, `tests/`, `dist/`, `test-results/` -- move to apps/desktop/
- `.gitignore` -- update path-specific entries for new structure
- `src-tauri/tauri.conf.json` -- update npm → pnpm in dev/build commands

## Tasks & Acceptance

**Execution:**
- [ ] Create `apps/desktop/` directory
- [ ] Move desktop files into `apps/desktop/`: `src/`, `src-tauri/`, `public/`, `tests/`, `test-results/`, `dist/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `components.json`, `playwright.config.ts`
- [ ] Move `package.json` to `apps/desktop/package.json` -- update name to `@nkbaz/desktop`
- [ ] `apps/desktop/src-tauri/tauri.conf.json` -- change `beforeDevCommand` and `beforeBuildCommand` from `npm run` to `pnpm run`
- [ ] `apps/desktop/playwright.config.ts` -- change `npm run dev` to `pnpm run dev` if referenced in webServer command
- [ ] Create root `pnpm-workspace.yaml` with `apps/*` and `packages/*`
- [ ] Create root `package.json` -- private workspace root with convenience scripts
- [ ] Create `packages/shared/` -- minimal scaffold: `package.json` (@nkbaz/shared), `tsconfig.json`, `src/index.ts` barrel export, `src/types/` directory
- [ ] Update `.gitignore` -- change `dist/`, `src-tauri/target/`, `src-tauri/gen/`, `src-tauri/.tauri-private-key*`, `test-results/`, `playwright-report/` to `apps/desktop/` prefixed paths
- [ ] Delete `node_modules/` and `package-lock.json` from root
- [ ] Run `pnpm install` from root
- [ ] Add `@nkbaz/shared` as dependency in `apps/desktop/package.json` via `workspace:*`

**Acceptance Criteria:**
- Given the restructured repo, when running `pnpm --filter @nkbaz/desktop dev` from root, then the Vite dev server starts on port 1420
- Given the restructured repo, when running `pnpm --filter @nkbaz/desktop tauri dev` from root, then the Tauri desktop app launches
- Given the restructured repo, when running `pnpm --filter @nkbaz/desktop build` from root, then TypeScript compiles and Vite builds to `apps/desktop/dist/`
- Given the restructured repo, when running `pnpm install` from root, then all workspace packages resolve without errors

## Verification

**Commands:**
- `pnpm install` -- expected: no errors, node_modules created at root and apps/desktop/
- `pnpm --filter @nkbaz/desktop dev` -- expected: Vite dev server starts on localhost:1420
- `pnpm --filter @nkbaz/desktop build` -- expected: successful build in apps/desktop/dist/
- `pnpm --filter @nkbaz/desktop tauri dev` -- expected: Tauri window opens with the app
