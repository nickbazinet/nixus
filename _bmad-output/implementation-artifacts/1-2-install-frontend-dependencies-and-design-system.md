# Story 1.2: Install Frontend Dependencies & Design System

Status: review

## Story

As a developer,
I want Tailwind CSS, shadcn/ui, TanStack Router, TanStack Query, React Hook Form, and Recharts installed and configured,
So that all frontend libraries are ready for feature development.

## Acceptance Criteria

1. **Given** the scaffolded Tauri project from Story 1.1, **When** all frontend dependencies are installed and configured, **Then** Tailwind CSS processes utility classes correctly.
2. **Given** Tailwind CSS is configured, **When** running `npx shadcn@latest add button`, **Then** a shadcn/ui Button component is generated into `src/components/ui/button.tsx`.
3. **Given** TanStack Router is installed, **When** the app renders, **Then** a root layout route exists and routing is functional.
4. **Given** TanStack Query is installed, **When** the app renders, **Then** a `QueryClientProvider` wraps the app with a configured `QueryClient`.
5. **Given** the design system is configured, **When** inspecting `:root` CSS variables, **Then** the color system matches UX-DR13: `--background` (white #FFFFFF), `--foreground` (Slate 900 #0F172A), `--primary` (Teal 600 #0D9488), `--positive` (Emerald 600 #059669), `--warning` (Amber 500 #F59E0B), `--destructive` (Rose 500 #F43F5E), `--muted` (Slate 100 #F1F5F9), `--accent` (Teal 50 #F0FDFA).
6. **Given** the design system is configured, **When** inspecting the body font, **Then** typography uses Inter + system font stack for body and JetBrains Mono for monospace (UX-DR14).
7. **Given** all dependencies are configured, **When** the app renders in the Tauri window, **Then** it renders without console errors using the configured theme.

## Tasks / Subtasks

- [x] Task 1: Install and configure Tailwind CSS v4 (AC: #1)
  - [x] Install Tailwind CSS v4 and the Vite plugin: `npm install tailwindcss @tailwindcss/vite`
  - [x] Add `tailwindcss()` plugin to `vite.config.ts`
  - [x] Replace contents of `src/index.css` (or `src/styles.css`) with `@import "tailwindcss";`
  - [x] Add `@theme` block in `src/index.css` to define design tokens (colors, fonts) — see Dev Notes
  - [x] Verify a Tailwind utility class (e.g., `bg-primary`) renders correctly
- [x] Task 2: Install and configure shadcn/ui (AC: #2)
  - [x] Run `npx shadcn@latest init` and configure for the project (TypeScript, src/components/ui path)
  - [x] Verify `components.json` is created at the project root
  - [x] Run `npx shadcn@latest add button` to add the first component
  - [x] Verify `src/components/ui/button.tsx` exists and renders
- [x] Task 3: Install and configure TanStack Router (AC: #3)
  - [x] Install: `npm install @tanstack/react-router @tanstack/react-router-devtools`
  - [x] Install the Vite plugin: `npm install -D @tanstack/router-plugin`
  - [x] Add the TanStack Router Vite plugin to `vite.config.ts`
  - [x] Create `src/routes/__root.tsx` with a root layout component
  - [x] Create `src/routes/index.tsx` as the default route (simple placeholder page)
  - [x] Update `src/main.tsx` to use `createRouter` and `RouterProvider`
- [x] Task 4: Install and configure TanStack Query (AC: #4)
  - [x] Install: `npm install @tanstack/react-query @tanstack/react-query-devtools`
  - [x] Wrap the app in `QueryClientProvider` with a configured `QueryClient` in the root layout or `main.tsx`
- [x] Task 5: Install React Hook Form and Recharts (AC: #7)
  - [x] Install React Hook Form: `npm install react-hook-form`
  - [x] Install Recharts: `npm install recharts`
  - [x] No configuration needed — these are used per-component in later stories
- [x] Task 6: Configure design system color tokens and typography (AC: #5, #6)
  - [x] Define all semantic color CSS variables in `src/index.css` using `@theme` directives (Tailwind v4 CSS-first approach)
  - [x] Add Inter font (via Google Fonts `@import` or local file) and JetBrains Mono font
  - [x] Define `font-sans` and `font-mono` in the `@theme` block
  - [x] Apply base styles: body uses Inter, `.font-mono` class available for financial figures
- [x] Task 7: Write Playwright test for design system (AC: #5, #6, #7)
  - [x] Create `tests/design-system.spec.ts`
  - [x] Test that CSS variables are set on `:root` (e.g., `--primary` resolves to the Teal 600 value)
  - [x] Test that a rendered button uses the correct primary color
  - [x] Test that body text uses the Inter font family
  - [x] Test that the app renders without console errors
  - [x] Run `npx playwright test tests/design-system.spec.ts` and confirm all pass
- [x] Task 8: Clean up scaffold defaults
  - [x] Remove default scaffold CSS (App.css or equivalent) that conflicts with Tailwind
  - [x] Remove scaffold boilerplate content from App.tsx (React logo, default text) — replace with a minimal placeholder that uses the new design system
  - [x] Ensure `npm run tauri dev` launches with the new theme applied

## Dev Notes

### CRITICAL: Tailwind CSS v4 — CSS-First Configuration

Tailwind CSS v4 does NOT use `tailwind.config.js` or `tailwind.config.ts`. The architecture doc mentions `tailwind.config.ts` in the project structure — this is outdated for v4. All configuration is done via CSS `@theme` directives.

**Installation:**
```bash
npm install tailwindcss @tailwindcss/vite
```

**vite.config.ts** — add the Tailwind plugin:
```typescript
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    // ... existing plugins
  ],
});
```

**src/index.css** — the entire Tailwind + design system config lives here:
```css
@import "tailwindcss";

@theme {
  /* Colors — semantic tokens (UX-DR13) */
  --color-background: #FFFFFF;
  --color-foreground: #0F172A;
  --color-card: #FFFFFF;
  --color-border: #E2E8F0;
  --color-muted: #F1F5F9;
  --color-muted-foreground: #64748B;
  --color-primary: #0D9488;
  --color-accent: #F0FDFA;
  --color-positive: #059669;
  --color-warning: #F59E0B;
  --color-destructive: #F43F5E;

  /* Typography (UX-DR14) */
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
}
```

Additionally, set CSS custom properties on `:root` for shadcn/ui compatibility (shadcn reads `--primary`, `--background`, etc. as HSL or oklch values). The exact format depends on how `npx shadcn@latest init` configures the project — adapt the theme variables to match shadcn's expected format while keeping the color values from UX-DR13.

### shadcn/ui v4 Setup

```bash
npx shadcn@latest init
```

The CLI will ask configuration questions. Key choices:
- TypeScript: Yes
- Style: Default (or New York — whichever aligns better with the clean design)
- Base color: Slate
- CSS file: `src/index.css`
- Components path: `src/components/ui`
- Tailwind CSS: v4 (the CLI should detect this)

After init, add the Button component to verify:
```bash
npx shadcn@latest add button
```

### TanStack Router Setup

```bash
npm install @tanstack/react-router @tanstack/react-router-devtools
npm install -D @tanstack/router-plugin
```

Add the router plugin to `vite.config.ts`:
```typescript
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    tailwindcss(),
    // ...
  ],
});
```

Create the file-based route structure:
- `src/routes/__root.tsx` — root layout (renders `<Outlet />`)
- `src/routes/index.tsx` — dashboard placeholder (landing page)

The router plugin auto-generates `src/routeTree.gen.ts`. Do NOT manually edit that file.

### TanStack Query Setup

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

Create a `QueryClient` and wrap the app in `QueryClientProvider`. This can live in the root route layout or in `main.tsx`. The devtools component (`ReactQueryDevtools`) should be included in development only.

### Library Versions

| Library | Version | Install Command |
|---------|---------|-----------------|
| Tailwind CSS | v4.2.x | `npm install tailwindcss @tailwindcss/vite` |
| shadcn/ui CLI | v4.x | `npx shadcn@latest init` |
| TanStack Router | v1.167.x | `npm install @tanstack/react-router` |
| TanStack Query | v5.90.x | `npm install @tanstack/react-query` |
| React Hook Form | v7.71.x | `npm install react-hook-form` |
| Recharts | v3.8.x | `npm install recharts` |

### Fonts

Inter and JetBrains Mono can be loaded via Google Fonts:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
```

Alternatively, install as npm packages (`@fontsource/inter`, `@fontsource/jetbrains-mono`) for offline support in the desktop app. Offline fonts are preferred since this is a Tauri desktop app that may not always have network access.

### Scope Boundaries

**In scope:**
- Install and configure all 6 frontend libraries listed above
- Set up design system color tokens as CSS variables (UX-DR13)
- Set up typography (Inter + JetBrains Mono) (UX-DR14)
- Create root layout route and index route placeholders
- Clean up scaffold boilerplate
- Playwright test for design system verification

**Out of scope (handled by later stories):**
- Sidebar navigation and 7 route pages — Story 1.4
- rusqlite, migrations, error handling — Story 1.3
- Any feature components (DashboardMetricCard, etc.)
- Button variants beyond what shadcn provides by default — Story 1.4 will use button hierarchy (UX-DR15)
- Additional shadcn components beyond Button (add them as needed in feature stories)

### Project Structure Notes

Files to create:
- `src/index.css` — Tailwind v4 config + design tokens + font imports (replaces scaffold CSS)
- `src/routes/__root.tsx` — root layout with `<Outlet />`
- `src/routes/index.tsx` — placeholder index route
- `src/routeTree.gen.ts` — auto-generated by TanStack Router plugin (do not edit)
- `src/components/ui/button.tsx` — generated by shadcn CLI
- `components.json` — generated by shadcn CLI
- `tests/design-system.spec.ts` — Playwright test

Files to modify:
- `vite.config.ts` — add Tailwind and TanStack Router plugins
- `src/main.tsx` — integrate TanStack Router and Query providers
- `src/App.tsx` — may be replaced by root route layout; remove scaffold boilerplate
- `package.json` — new dependencies added by npm install

Files to delete:
- `src/App.css` (or equivalent scaffold CSS) — replaced by Tailwind
- Any scaffold-specific asset files (React logo SVG, etc.) if no longer referenced

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture, Project Structure]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Color System (UX-DR13), Typography (UX-DR14)]
- [Source: _bmad-output/implementation-artifacts/1-1-scaffold-tauri-desktop-application.md — Previous story context]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
None

### Completion Notes List
- Tailwind CSS v4 with @tailwindcss/vite plugin configured
- shadcn/ui initialized with Button component at src/components/ui/button.tsx
- TanStack Router with file-based routing (tanstackRouter vite plugin, __root.tsx, index.tsx)
- TanStack Query with QueryClientProvider wrapping the app
- React Hook Form and Recharts installed (no config needed)
- UX-DR13 color tokens set as CSS variables on :root
- UX-DR14 typography: Inter (sans) + JetBrains Mono (mono) via Google Fonts
- Scaffold boilerplate (App.css, App.tsx, react.svg) removed
- 5 Playwright tests passing

### File List
- vite.config.ts (modified)
- tsconfig.json (modified)
- package.json (modified)
- src/index.css (new)
- src/main.tsx (modified)
- src/routes/__root.tsx (new)
- src/routes/index.tsx (new)
- src/routeTree.gen.ts (auto-generated)
- src/components/ui/button.tsx (generated by shadcn)
- src/lib/utils.ts (generated by shadcn)
- components.json (generated by shadcn)
- tests/design-system.spec.ts (new)
- src/App.css (deleted)
- src/App.tsx (deleted)
- src/assets/react.svg (deleted)
