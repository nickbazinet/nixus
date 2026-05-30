# Story 1.4: Build App Shell with Sidebar Navigation & Routing

Status: review

## Story

As a user,
I want a desktop application with a dark sidebar navigation and page routing,
So that I can navigate between all sections of the app.

## Acceptance Criteria

1. **Given** the app is launched, **When** the main window renders, **Then** a dark sidebar (240px fixed) displays 7 nav items with icons and labels: Dashboard, Budget, Accounts, Assets, Net Worth, Import, AI Chat (UX-DR1).
2. **Given** the sidebar is visible, **When** a nav item is the active route, **Then** it shows teal text with a right border accent.
3. **Given** a nav item is clicked, **When** the navigation completes, **Then** the corresponding page renders via TanStack Router.
4. **Given** any page is rendered, **When** the page header area is visible, **Then** it displays an H1 title matching the page name (UX-DR23).
5. **Given** the app window is rendered, **When** inspecting the main content area, **Then** it is fluid with max-width 1280px, centered (UX-DR21).
6. **Given** the Tauri window config, **When** the user tries to resize the window below 1024x680, **Then** the window enforces a minimum size of 1024x680 pixels.
7. **Given** the button components are available, **When** buttons are rendered, **Then** button hierarchy follows UX-DR15: Primary (teal filled), Outline, Ghost, Destructive (rose).
8. **Given** any page route is rendered, **When** inspecting the content area, **Then** placeholder content is displayed for each route.

## Tasks / Subtasks

- [x] Task 1: Enforce minimum window size in Tauri config (AC: #6)
  - [x] Edit `src-tauri/tauri.conf.json` to set `minWidth: 1024` and `minHeight: 680` on the main window
  - [x] Optionally set a default window size (e.g., 1280x800)
  - [x] Verify the window cannot be resized smaller than 1024x680
- [x] Task 2: Create the AppSidebar component (AC: #1, #2)
  - [x] Create `src/components/shared/AppSidebar.tsx`
  - [x] Implement a 240px fixed-width dark sidebar (`bg-slate-900` or equivalent dark color)
  - [x] Add 7 navigation items with icons and labels:
    - Dashboard (layout-dashboard or home icon)
    - Budget (wallet or pie-chart icon)
    - Accounts (building or landmark icon)
    - Assets (gem or briefcase icon)
    - Net Worth (trending-up or chart icon)
    - Import (upload or file-up icon)
    - AI Chat (message-square or bot icon)
  - [x] Install an icon library: `npm install lucide-react` (recommended for shadcn/ui projects)
  - [x] Use `<Link>` from TanStack Router for each nav item
  - [x] Style active nav item: teal text color (`text-primary`) + 3px right border in teal
  - [x] Style inactive nav items: `text-slate-400`, hover → `text-slate-200`
  - [x] Use semantic `<nav>` element with `aria-label="Main navigation"`
- [x] Task 3: Create the PageHeader component (AC: #4)
  - [x] Create `src/components/shared/PageHeader.tsx`
  - [x] Accept props: `title` (string, required), `subtitle` (string, optional), `actions` (ReactNode, optional — for right-side buttons)
  - [x] Render H1 at 24px/600 weight (H1 from type scale), optional subtitle below in muted text
  - [x] Right-aligned slot for page-level action buttons
  - [x] No breadcrumbs (UX-DR23: sidebar provides location context)
- [x] Task 4: Create the root layout with sidebar + content area (AC: #5)
  - [x] Update `src/routes/__root.tsx` to render the app shell layout:
    - Flex container: sidebar (fixed 240px) + main content area (fluid)
    - Main content area: `max-w-[1280px] mx-auto` with padding (`p-6` or `p-8`)
    - `<Outlet />` renders inside the main content area
  - [x] Ensure the sidebar and page structure render immediately (no loading state for the shell)
- [x] Task 5: Create all 7 route pages with placeholders (AC: #3, #4, #8)
  - [x] Create/update `src/routes/index.tsx` — Dashboard page with `<PageHeader title="Dashboard" />`
  - [x] Create `src/routes/budget.tsx` — Budget page with `<PageHeader title="Budget" />`
  - [x] Create `src/routes/accounts.tsx` — Accounts page with `<PageHeader title="Accounts" />`
  - [x] Create `src/routes/assets.tsx` — Assets page with `<PageHeader title="Assets" />`
  - [x] Create `src/routes/net-worth.tsx` — Net Worth page with `<PageHeader title="Net Worth" />`
  - [x] Create `src/routes/import.tsx` — Import page with `<PageHeader title="Import" />`
  - [x] Create `src/routes/chat.tsx` — AI Chat page with `<PageHeader title="AI Chat" />`
  - [x] Each page shows a simple placeholder message (e.g., "Dashboard content coming soon")
- [x] Task 6: Configure button variants (AC: #7)
  - [x] Verify or adjust the shadcn Button component (`src/components/ui/button.tsx`) to support these variants matching UX-DR15:
    - `default` (Primary): teal filled background (`bg-primary text-white`)
    - `outline`: border with no fill
    - `ghost`: no border, no fill, subtle hover
    - `destructive`: rose filled background
  - [x] If shadcn's default button variants don't match the teal/rose colors, override the CSS variables or variant styles
- [x] Task 7: Write Playwright navigation tests (AC: #1, #2, #3, #4, #5)
  - [x] Create `tests/navigation.spec.ts`
  - [x] Test: Sidebar renders with all 7 nav items visible (Dashboard, Budget, Accounts, Assets, Net Worth, Import, AI Chat)
  - [x] Test: Clicking each nav item navigates to the correct page and the active state updates (teal text + right border)
  - [x] Test: Each page displays its H1 title in the page header
  - [x] Test: The main content area has max-width 1280px
  - [x] Run `npx playwright test tests/navigation.spec.ts` and confirm all pass

## Dev Notes

### Sidebar Design (UX-DR1)

The sidebar is always visible, fixed at 240px. It does NOT collapse — there is no 64px icon-only mode (UX spec says "Fixed 240px at all window sizes. Does not collapse.").

**Visual spec:**
- Dark background: Slate 900 (#0F172A) or similar dark neutral
- Full height of the viewport
- Nav items: icon (20px) + label, left-padded, vertically stacked
- Active item: teal text (`--primary` #0D9488) + right border (3px solid teal)
- Inactive items: Slate 400 text, hover to Slate 200
- Clicking the already-active item does nothing (no reload)
- App name/logo area at the top (optional — "nkbaz-finance" in small text or logo)

### Page Header Pattern (UX-DR23)

Every page has:
- H1 title (24px, 600 weight, `--foreground` color)
- Optional subtitle (muted text, smaller)
- Right-aligned page-level actions (buttons) — empty for now, wired up in feature stories

### Content Layout (UX-DR21)

- Main content area fills remaining width after the 240px sidebar
- Content within is constrained to `max-width: 1280px` and centered with auto margins
- Internal padding: `p-6` (24px) for breathing room
- No media queries needed — fluid layout within 784px (1024 - 240) to unlimited

### Minimum Window Size

In `src-tauri/tauri.conf.json`, under the window configuration:
```json
{
  "app": {
    "windows": [
      {
        "title": "nkbaz-finance",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 680
      }
    ]
  }
}
```

The exact JSON path depends on Tauri 2.x config structure — check the existing `tauri.conf.json` for the correct nesting.

### TanStack Router — Route File Conventions

TanStack Router with the Vite plugin uses file-based routing. Route files in `src/routes/` are auto-detected:
- `__root.tsx` — root layout (always renders, wraps all pages)
- `index.tsx` — matches `/` (Dashboard)
- `budget.tsx` — matches `/budget`
- `accounts.tsx` — matches `/accounts`
- `assets.tsx` — matches `/assets`
- `net-worth.tsx` — matches `/net-worth`
- `import.tsx` — matches `/import`
- `chat.tsx` — matches `/chat`

Each route file exports a `Route` created with `createFileRoute` and a component. The route tree is auto-generated — do not edit `routeTree.gen.ts`.

To detect the active route for sidebar highlighting, use TanStack Router's `useMatchRoute()` or `Link` component's `activeProps`.

### Icon Library

Use `lucide-react` — it integrates cleanly with shadcn/ui and provides all needed icons:
```bash
npm install lucide-react
```

Suggested icon mapping:
| Nav Item | Icon | Lucide Name |
|----------|------|-------------|
| Dashboard | Grid layout | `LayoutDashboard` |
| Budget | Wallet | `Wallet` |
| Accounts | Building columns | `Landmark` |
| Assets | Diamond | `Gem` |
| Net Worth | Upward trend | `TrendingUp` |
| Import | Upload | `Upload` |
| AI Chat | Message bubble | `MessageSquare` |

### Button Hierarchy (UX-DR15)

shadcn/ui's Button component comes with variants. Ensure they map to:
- **Primary** (teal filled): one per visible context — the main action
- **Outline**: secondary actions — bordered, no fill
- **Ghost**: tertiary/navigation — no border, subtle hover
- **Destructive** (rose): delete/dangerous actions — only in confirmation dialogs

The shadcn default uses a blue/purple primary. Override with teal by adjusting the `--primary` CSS variable (already done in Story 1.2). Verify the button renders with teal after the CSS variable is set.

### Scope Boundaries

**In scope:**
- Dark sidebar with 7 nav items, icons, labels, and active state
- PageHeader component with title, subtitle, actions slot
- Root layout with sidebar + content area
- 7 route pages with placeholder content and page headers
- Minimum window size enforcement (Tauri config)
- Button variant verification (teal primary, rose destructive)
- Playwright navigation tests
- `lucide-react` icon library installation

**Out of scope (handled by later stories):**
- Dashboard cards, charts, metric data — Epic 5
- Budget management UI (forms, progress bars, month nav) — Epic 2
- Account/Asset forms and inline editing — Epic 4
- Import flow UI — Epic 6
- AI Chat UI — Epic 7
- Floating Cmd+K chat bar — Epic 7
- Onboarding wizard — Epic 8
- Empty state patterns (UX-DR19) — implemented per feature
- Skeleton loading states — implemented per feature

### Project Structure Notes

Files to create:
- `src/components/shared/AppSidebar.tsx` — sidebar navigation component
- `src/components/shared/PageHeader.tsx` — page header component
- `src/routes/budget.tsx` — Budget page route
- `src/routes/accounts.tsx` — Accounts page route
- `src/routes/assets.tsx` — Assets page route
- `src/routes/net-worth.tsx` — Net Worth page route
- `src/routes/import.tsx` — Import page route
- `src/routes/chat.tsx` — AI Chat page route
- `tests/navigation.spec.ts` — Playwright navigation tests

Files to modify:
- `src/routes/__root.tsx` — add sidebar + content area layout
- `src/routes/index.tsx` — add PageHeader, update placeholder content
- `src-tauri/tauri.conf.json` — add minWidth/minHeight
- `src/components/ui/button.tsx` — verify/adjust variants for teal/rose colors (if needed)
- `package.json` — add lucide-react dependency

### Alignment with Architecture

This story creates the shared components listed in the architecture doc:
- `src/components/shared/AppSidebar.tsx`
- `src/components/shared/PageHeader.tsx`

And the route files:
- `src/routes/__root.tsx` (root layout)
- `src/routes/index.tsx` (Dashboard)
- `src/routes/budget.tsx`
- `src/routes/accounts.tsx`
- `src/routes/assets.tsx`
- `src/routes/net-worth.tsx`
- `src/routes/import.tsx`
- `src/routes/chat.tsx`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.4]
- [Source: _bmad-output/planning-artifacts/architecture.md — Frontend Architecture, Project Structure, Routing]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Sidebar (UX-DR1), Page Header (UX-DR23), Layout (UX-DR21), Buttons (UX-DR15), Responsive (min 1024x680)]
- [Source: _bmad-output/implementation-artifacts/1-1-scaffold-tauri-desktop-application.md — Scaffold context]
- [Source: _bmad-output/implementation-artifacts/1-2-install-frontend-dependencies-and-design-system.md — Dependencies and design system setup]
- [Source: _bmad-output/implementation-artifacts/1-3-set-up-rust-backend-with-sqlite-and-error-handling.md — Backend setup]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Tailwind CSS v4 returns colors in oklab format rather than rgb; adjusted Playwright test to compare active vs inactive link colors and check border-right-width instead of exact color values.

### Completion Notes List
- Task 1: Set minWidth: 1024, minHeight: 680, default 1280x800 in tauri.conf.json
- Task 2: Created AppSidebar with 7 nav items using lucide-react icons, TanStack Router Links with activeProps for teal active state + 3px right border. Dark bg uses #0F172A (Slate 900).
- Task 3: Created PageHeader with title (h1 text-2xl font-semibold), optional subtitle, optional right-aligned actions slot.
- Task 4: Updated __root.tsx with flex layout: fixed 240px sidebar + fluid main area with max-w-[1280px] mx-auto p-6.
- Task 5: Created all 7 route pages (index, budget, accounts, assets, net-worth, import, chat) with PageHeader and placeholder text.
- Task 6: Verified existing shadcn Button component already supports default (teal via --primary), outline, ghost, destructive (rose via --destructive) variants. No changes needed.
- Task 7: Created tests/navigation.spec.ts with 4 tests covering sidebar nav items, navigation + active state, page headers, and content max-width. All 9 tests pass.
- Updated design-system.spec.ts to expect "Dashboard" h1 instead of "nkbaz-finance" after index page change.
- lucide-react was already installed (v0.577.0 in package.json).

### File List
- src-tauri/tauri.conf.json (modified)
- src/components/shared/AppSidebar.tsx (created)
- src/components/shared/PageHeader.tsx (created)
- src/routes/__root.tsx (modified)
- src/routes/index.tsx (modified)
- src/routes/budget.tsx (created)
- src/routes/accounts.tsx (created)
- src/routes/assets.tsx (created)
- src/routes/net-worth.tsx (created)
- src/routes/import.tsx (created)
- src/routes/chat.tsx (created)
- src/routeTree.gen.ts (auto-generated by TanStack Router plugin)
- tests/navigation.spec.ts (created)
- tests/design-system.spec.ts (modified)
