# Story 1.1: Scaffold Tauri Desktop Application

Status: review

## Story

As a developer,
I want a working Tauri application scaffolded with React + TypeScript + Vite,
So that I have the foundation to build all features on.

## Acceptance Criteria

1. **Given** a fresh project directory, **When** the Tauri app is initialized with `create-tauri-app` using the React + TypeScript template, **Then** the app launches a native desktop window with the default React page.
2. **Given** the scaffolded app, **When** the Vite dev server runs, **Then** hot module replacement works correctly.
3. **Given** the scaffolded app, **When** the Rust backend compiles, **Then** it compiles without errors.
4. **Given** the scaffolded app, **When** inspecting the project structure, **Then** it matches `src/` (React) and `src-tauri/` (Rust).
5. **Given** Playwright is set up, **When** running `npx playwright test tests/app-launch.spec.ts`, **Then** the test verifies the app window opens and the default React page renders content.

## Tasks / Subtasks

- [x] Task 1: Scaffold Tauri application (AC: #1, #2, #3, #4)
  - [x] Run `npm create tauri-app@latest` with React + TypeScript template in the project root
  - [x] Verify `npm run tauri dev` launches the native window with the default React page
  - [x] Verify Vite HMR works (edit a component, see it update)
  - [x] Verify Rust backend compiles without errors
  - [x] Verify project structure: `src/` (React), `src-tauri/` (Rust), `package.json`, `vite.config.ts`, `tsconfig.json`
- [x] Task 2: Set up Playwright for E2E testing (AC: #5)
  - [x] Install Playwright: `npm init playwright@latest`
  - [x] Configure `playwright.config.ts` to test against the Vite dev server (see Dev Notes below for Tauri-specific approach)
  - [x] Write `tests/app-launch.spec.ts` that verifies the default React page renders content
  - [x] Run `npx playwright test tests/app-launch.spec.ts` and confirm it passes

## Dev Notes

### Scaffold Command

```bash
npm create tauri-app@latest nkbaz-finance -- --template react-ts
```

This creates a Tauri 2.x project with React + TypeScript + Vite. The scaffolded output lands in a `nkbaz-finance/` subdirectory. Since the project root is already `nkbaz-finance/`, either:
- Run from the parent directory and let it create the folder, then move contents up, OR
- Run from the project root with `.` as the project name if supported

Verify after scaffold:
- `package.json` exists with Tauri dependencies
- `src/` contains React entry point (`main.tsx`, `App.tsx`)
- `src-tauri/` contains `Cargo.toml`, `tauri.conf.json`, `src/main.rs`
- `vite.config.ts` exists

### Tauri Version

Tauri 2.x is current stable (~2.10.x). The scaffold tool (`create-tauri-app`) will pull the latest 2.x automatically. Do NOT use Tauri v1.

### Playwright + Tauri Testing Strategy

Playwright **cannot** drive the Tauri native window on macOS (no WKWebView driver). The correct approach:

1. Configure `playwright.config.ts` with `webServer` pointing to the Vite dev server (`npm run dev` or the Vite-only dev command)
2. Tests run against `http://localhost:1420` (default Vite port for Tauri projects) in a real browser
3. For tests that call Tauri IPC (`@tauri-apps/api` invoke), mock the `window.__TAURI__` object — but Story 1.1 has no IPC calls, so no mocking needed yet
4. Install only Chromium browser to keep it lightweight: `npx playwright install chromium`

Example `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  webServer: {
    command: 'npm run dev',  // Vite dev server only (not tauri dev)
    port: 1420,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:1420',
  },
});
```

Note: The `npm run dev` script must start ONLY the Vite dev server (not `tauri dev`). Check `package.json` — the scaffold may set `"dev": "vite"` or `"dev": "tauri dev"`. If it's `tauri dev`, add a separate script like `"dev:web": "vite"` and use that in the Playwright config.

Example `tests/app-launch.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('default React page renders content', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).not.toBeEmpty();
});
```

### Scope Boundaries

**In scope:** Scaffold + Playwright setup only. The default scaffold content (React logo, boilerplate) is fine — no need to customize it.

**Out of scope (handled by later stories):**
- Tailwind CSS, shadcn/ui, design system → Story 1.2
- rusqlite, migrations, error handling → Story 1.3
- Sidebar navigation, routing, app shell → Story 1.4
- Do NOT install any additional frontend dependencies beyond what the scaffold and Playwright provide
- Do NOT modify the default React components
- Do NOT set up TanStack Router, TanStack Query, or any other libraries

### Project Structure After This Story

```
nkbaz-finance/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── src/                    # React frontend (scaffold defaults)
│   ├── main.tsx
│   ├── App.tsx
│   ├── App.css
│   └── ...
├── src-tauri/              # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   └── src/
│       └── main.rs
├── tests/                  # Playwright E2E tests
│   └── app-launch.spec.ts
├── _bmad/                  # (pre-existing, do not modify)
├── _bmad-output/           # (pre-existing, do not modify)
└── docs/                   # (pre-existing, do not modify)
```

### Existing Files in Project Root

The project root already contains `_bmad/`, `_bmad-output/`, `.claude/`, `.cursor/`, and `docs/` directories. The scaffold must coexist with these — do NOT delete them.

### Target Architecture Reference

The full target project structure (for all 8 epics) is defined in [Source: _bmad-output/planning-artifacts/architecture.md]. Story 1.1 only creates the scaffold foundation — subsequent stories build toward the full structure.

### References

- [Source: _bmad-output/planning-artifacts/epics.md - Epic 1, Story 1.1]
- [Source: _bmad-output/planning-artifacts/architecture.md - Technical Stack, Project Structure, Testing]
- [Source: _bmad-output/planning-artifacts/prd.md - Technical Requirements, NFRs]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None

### Completion Notes List
- Scaffolded Tauri 2.x app with React 19 + TypeScript + Vite 7
- Installed Rust toolchain (rustc 1.94.0)
- Rust backend compiles without errors
- Playwright configured against Vite dev server on port 1420
- E2E test passes: default React page renders content

### File List
- package.json (new)
- tsconfig.json (new)
- tsconfig.node.json (new)
- vite.config.ts (new)
- index.html (new)
- playwright.config.ts (new)
- src/main.tsx (new)
- src/App.tsx (new)
- src/App.css (new)
- src/vite-env.d.ts (new)
- src/assets/ (new)
- src-tauri/Cargo.toml (new)
- src-tauri/tauri.conf.json (new)
- src-tauri/build.rs (new)
- src-tauri/src/main.rs (new)
- src-tauri/src/lib.rs (new)
- src-tauri/icons/ (new)
- tests/app-launch.spec.ts (new)
- public/ (new)
