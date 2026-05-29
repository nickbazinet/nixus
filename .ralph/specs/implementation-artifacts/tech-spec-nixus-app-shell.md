---
title: 'Nixus app shell — sidebar modules + top bar + inner tab nav'
type: 'refactor'
created: '2026-03-31'
status: 'done'
baseline_commit: '553e083d'
context: []
---

# Nixus App Shell — Sidebar Modules + Top Bar + Inner Tab Nav

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current single sidebar mixes module navigation with page-level navigation. The app needs a scalable layout with a module-level sidebar, a top bar with user icon, and inner tab navigation for sub-pages — plus rebranding from "nkbaz-finance" to "Nixus".

**Approach:** Restructure the root layout into three zones: (1) a collapsible left sidebar with logo, module icons, and utility actions — expands on hover, (2) a top bar spanning the content area with a user icon, (3) horizontal tab navigation inside the content area for Finance sub-pages. Rename app to "Nixus" in sidebar logo and Tauri window title.

## Boundaries & Constraints

**Always:**
- Use Lucide React icons (already installed)
- Sidebar collapses to icon-only; expands on mouse hover (not click toggle)
- Logo shows "N" collapsed, "Nixus" expanded
- Keep all existing routes and functionality intact
- Utility actions (hide values, backup, restore, theme) stay in sidebar bottom

**Ask First:**
- Adding new modules beyond "Finance" to the sidebar
- Changing the color scheme or theme variables

**Never:**
- Remove any existing page/route
- Change the content or behavior of individual pages
- Add authentication or user profile functionality behind the user icon

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sidebar collapsed (default) | Mouse not over sidebar | Narrow sidebar showing "N" logo + Finance icon + utility icons | N/A |
| Sidebar expanded | Mouse hovers over sidebar | Sidebar widens showing "Nixus" + "Finance" label + utility labels | N/A |
| Active Finance module | User on any finance sub-page | Finance icon highlighted in sidebar, correct tab active in inner nav | N/A |
| Tab navigation | Click "Budget" tab | Navigates to /budget, "Budget" tab shows active state | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/__root.tsx` -- Root layout — restructure to 3-zone layout (sidebar + topbar + content with tabs)
- `src/components/shared/AppSidebar.tsx` -- Rewrite: module-level sidebar with logo, Finance module, utility actions, hover-expand
- `src/components/shared/TopBar.tsx` -- NEW: top bar with user icon (right)
- `src/components/shared/InnerTabNav.tsx` -- NEW: horizontal tab nav for Finance sub-pages
- `src-tauri/tauri.conf.json` -- Update window title to "Nixus"

## Tasks & Acceptance

**Execution:**
- [ ] `src-tauri/tauri.conf.json` -- Change window title from "nkbaz-finance" to "Nixus"
- [ ] `src/components/shared/AppSidebar.tsx` -- Rewrite as module sidebar: logo (N/Nixus), Finance module icon, utility actions at bottom. Hover-expand behavior (CSS group-hover or mouse events). Remove page-level nav items.
- [ ] `src/components/shared/TopBar.tsx` -- Create top bar component with user icon (CircleUser from Lucide) positioned top-right
- [ ] `src/components/shared/InnerTabNav.tsx` -- Create horizontal tab nav using existing navItems (Dashboard, Budget, Income, Accounts, Assets, Net Worth, Trends, Import, AI Chat) with TanStack Router Links and active states
- [ ] `src/routes/__root.tsx` -- Restructure layout: sidebar fixed left, right side has top bar + inner tab nav + content area with Outlet

**Acceptance Criteria:**
- Given the app loads, when the sidebar is not hovered, then it shows only icons (N logo, Finance icon, utility icons) in a narrow column
- Given the sidebar is hovered, when the mouse enters, then it expands to show "Nixus", "Finance" label, and utility labels
- Given any finance page is active, when viewing the inner content, then the correct tab is highlighted in the horizontal nav
- Given the Tauri window, when it opens, then the title bar shows "Nixus"

## Verification

**Commands:**
- `npm run build` -- expected: no TypeScript or build errors
- `npm run lint` -- expected: no lint errors

**Manual checks:**
- Sidebar collapses/expands on hover
- All Finance sub-page tabs navigate correctly
- Utility actions (hide values, backup, restore, theme) work from sidebar bottom
- Window title shows "Nixus"
