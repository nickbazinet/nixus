# Story 16.3: Maintenance Page, Navigation & Add Vehicle

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a dedicated maintenance page accessible from the app navigation where I can add my first vehicle,
So that I can start tracking maintenance without leaving the finance app.

## Acceptance Criteria

1. **Given** the app renders InnerTabNav
   **When** the accounts/assets tab group is displayed
   **Then** a Maintenance tab appears after Assets and before Net Worth with Wrench icon and `nav.maintenance` label (UX-DR2)
   **And** clicking it navigates to `/maintenance` instantly (NFR2)

2. **Given** no vehicles exist
   **When** the user navigates to `/maintenance`
   **Then** an empty state shows "No vehicles tracked yet." with centered Wrench icon and "Add Vehicle" primary CTA (UX-DR9)
   **And** optional muted helper: "Maintenance tracking is separate from asset values in Net Worth." (UX-DR10)

3. **Given** the user clicks "Add Vehicle"
   **When** the SlideOver opens
   **Then** `AddVehicleForm` shows nickname (required), make, model, year (optional), odometer km (required, min 0) (UX-DR3)
   **And** on save, `create_vehicle` is invoked and a success toast shows `maintenance.toast.vehicleCreated`
   **And** TanStack Query keys `["maintenance"]` and `["maintenance-alerts"]` are invalidated

4. **Given** one or more vehicles exist
   **When** the maintenance page loads
   **Then** PageHeader shows "Maintenance" title, "{n} vehicles tracked" subtitle, and "Add Vehicle" button
   **And** vehicles render as stacked `VehicleCard` components, newest first

5. **Given** the maintenance page
   **When** loading data
   **Then** skeleton cards display (`data-testid` on key elements) matching assets page loading pattern

6. **Given** all maintenance UI strings
   **When** rendered in EN and FR
   **Then** no raw `task_type_key` values appear — all labels use i18n keys under `maintenance.*` (NFR16)

## Tasks / Subtasks

- [x] Task 1: Add TypeScript types and query keys (AC: #3, #4)
  - [x] Add `Vehicle`, `CreateVehicleInput`, and related types to `apps/desktop/src/lib/types.ts` matching Story 16.2 IPC shapes
  - [x] Add to `apps/desktop/src/lib/constants.ts`:
    - `maintenance: ["maintenance"] as const`
    - `maintenanceVehicle: (vehicleId: number) => ["maintenance", vehicleId] as const`
    - `maintenanceAlerts: ["maintenance-alerts"] as const`

- [x] Task 2: Create `useMaintenance` hook (AC: #3, #4, #5)
  - [x] New file: `apps/desktop/src/hooks/useMaintenance.ts`
  - [x] `useMaintenance()` — `useQuery` calling `invoke<Vehicle[]>("get_vehicles")` with key `queryKeys.maintenance`
  - [x] `useCreateVehicle()` — mutation calling `invoke<Vehicle>("create_vehicle", { ... })`, invalidates `queryKeys.maintenance` and `queryKeys.maintenanceAlerts`, shows `maintenance.toast.vehicleCreated` on success
  - [x] Follow `useAssets.ts` mutation/toast/invalidation patterns exactly

- [x] Task 3: Add InnerTabNav Maintenance tab (AC: #1)
  - [x] Modify `apps/desktop/src/components/shared/InnerTabNav.tsx`
  - [x] Import `Wrench` from `lucide-react`
  - [x] Insert `{ to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench }` in the accounts/assets group **after** `/assets`, **before** `/net-worth`
  - [x] Do **not** add a sidebar nav item — InnerTabNav only (architecture D8)

- [x] Task 4: Create `AddVehicleForm` (AC: #3)
  - [x] New file: `apps/desktop/src/components/maintenance/AddVehicleForm.tsx`
  - [x] React Hook Form with fields: nickname (required text), make (optional text), model (optional text), year (optional integer), odometer_km (required integer, min 0)
  - [x] Inline validation errors; no decimals on odometer
  - [x] Submit via `useCreateVehicle()`; close SlideOver on success
  - [x] `data-testid="add-vehicle-form"`
  - [x] Mirror `AddAssetForm.tsx` structure (form layout, Label/Input, Button footer) — use SlideOver wrapper from parent, not inline Card

- [x] Task 5: Create header-only `VehicleCard` stub (AC: #4)
  - [x] New file: `apps/desktop/src/components/maintenance/VehicleCard.tsx`
  - [x] Display: nickname (H3), make/model/year (muted, 12px), odometer as monospace integer km with thousands separator + " km" suffix
  - [x] **Out of scope for this story:** task rows, expand/collapse body, odometer inline edit, service history — deferred to Stories 16.4 and 17.x
  - [x] `data-testid={`vehicle-card-${vehicle.id}`}`

- [x] Task 6: Build `/maintenance` route (AC: #2, #4, #5)
  - [x] New file: `apps/desktop/src/routes/maintenance.tsx` with `createFileRoute("/maintenance")`
  - [x] PageHeader: title `maintenance.title`, subtitle `maintenance.subtitle` with `{ count: vehicles.length }` when vehicles exist
  - [x] "Add Vehicle" primary button (Plus icon) in header actions — opens SlideOver
  - [x] Empty state: Wrench icon (centered, muted), `maintenance.emptyTitle`, optional `maintenance.emptyHelper` (UX-DR10), Add Vehicle CTA — mirror `assets.tsx` empty state pattern
  - [x] Loading: skeleton card with 3 pulse rows — mirror `assets.tsx` `data-testid="assets-skeleton"` pattern as `maintenance-skeleton`
  - [x] Vehicle list: `space-y-4` stacked `VehicleCard` components, newest first (backend sorts; frontend preserves order)
  - [x] SlideOver wrapping `AddVehicleForm` — mirror assets SlideOver pattern (`data-testid="vehicle-slide-over"`)
  - [x] Do **not** manually edit `routeTree.gen.ts` — TanStack Router codegen regenerates on dev/build

- [x] Task 7: Add i18n keys EN + FR (AC: #6)
  - [x] `apps/desktop/src/locales/en.json` and `fr.json`:
    - `nav.maintenance`
    - `maintenance.title`, `maintenance.subtitle`, `maintenance.addVehicle`
    - `maintenance.emptyTitle`, `maintenance.emptyHelper`
    - `maintenance.fields.nickname`, `maintenance.fields.make`, `maintenance.fields.model`, `maintenance.fields.year`, `maintenance.fields.odometer`
    - `maintenance.validation.nicknameRequired`, `maintenance.validation.odometerRequired`, `maintenance.validation.odometerMin`
    - `maintenance.toast.vehicleCreated`
  - [x] Task name keys (`maintenance.tasks.*`) are **not** required in this story — no task rows rendered yet; add in Story 16.4

## Dev Notes

### Critical Dependencies — Stories 16.1 and 16.2 Must Be Complete

**Story 16.1 (implemented — commit `056943e`):**
- Migration `018_maintenance_tables.sql` creates `vehicles`, `maintenance_tasks`, `maintenance_service_logs`
- `maintenance/defaults.rs` — 15 `DEFAULT_TASKS`, `ALERT_KM_THRESHOLD` (500), `ALERT_DAYS_THRESHOLD` (14)
- `maintenance/evaluator.rs` — dual-threshold status engine with unit tests
- `db/maintenance.rs` — module skeleton registered in `db/mod.rs`

**Story 16.2 (required before this story):**
- `db/maintenance.rs` — full query implementations (currently stub: "full implementations added in Story 16.2")
- `commands/maintenance.rs` — at minimum `create_vehicle` and `get_vehicles` registered in `lib.rs`
- `create_vehicle` seeds 15 tasks from `DEFAULT_TASKS`; `get_vehicles` returns newest first
- Rust models: `Vehicle`, `CreateVehicleInput` in `models/mod.rs`

**If Story 16.2 is not merged:** implement IPC commands first or stub `invoke` calls will fail at runtime.

### Scope Boundaries (Do Not Over-Implement)

| In scope (16.3) | Deferred |
|-----------------|----------|
| InnerTabNav tab + `/maintenance` route | Dashboard `MaintenanceAlertCard` (18.1) |
| Empty state + skeleton loading | `MaintenanceTaskRow` + status badges (16.4) |
| Add Vehicle SlideOver + form | Task list expand/collapse (16.4) |
| Header-only `VehicleCard` listing | Odometer inline edit (17.2) |
| `useMaintenance` + `useCreateVehicle` | Log service, edit intervals (17.x) |
| i18n for page/form/nav/toast | Full `maintenance.tasks.*` keys (16.4) |
| Invalidate `["maintenance-alerts"]` on create | `useMaintenanceAlerts` hook (18.1) |

Frontend **never** computes task due status — all status math stays in Rust `evaluator.rs` (architecture enforcement).

### TypeScript Types (Expected from Story 16.2)

```typescript
interface Vehicle {
  id: number;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometer_km: number;
  created_at: string;
  updated_at: string;
}

interface CreateVehicleInput {
  nickname: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  odometer_km: number;
}
```

If Story 16.2 returns `VehicleWithTasks` from `get_vehicle`, use plain `Vehicle[]` from `get_vehicles` for the list page.

### InnerTabNav Modification Pattern

Current accounts/assets group in `InnerTabNav.tsx` (lines 33–37):

```typescript
[
  { to: "/accounts", labelKey: "nav.accounts", icon: Landmark },
  { to: "/assets", labelKey: "nav.assets", icon: Gem },
  { to: "/net-worth", labelKey: "nav.netWorth", icon: TrendingUp },
],
```

Insert Maintenance between Assets and Net Worth:

```typescript
{ to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
```

### Route File Pattern

Follow `assets.tsx`:

```typescript
export const Route = createFileRoute("/maintenance")({
  component: MaintenancePage,
});
```

File location: `apps/desktop/src/routes/maintenance.tsx` → auto-generates `/maintenance` in route tree.

### Reference Implementation: Assets Page

Copy patterns from `apps/desktop/src/routes/assets.tsx`:
- `PageHeader` with title, subtitle, actions
- Empty state: centered icon + title + description + primary CTA inside `Card`/`CardContent`
- Skeleton: `Card` with 3 animated pulse rows, `data-testid` attribute
- SlideOver from `@nixus/shared` wrapping form component
- `useState` for `showForm` boolean toggling SlideOver open state

### AddVehicleForm Pattern

Mirror `apps/desktop/src/components/assets/AddAssetForm.tsx`:
- React Hook Form, `mode: "onSubmit"`
- Required field validation with inline `{errors.field.message}`
- Odometer: plain `Input type="number"` with `min={0}` and `step={1}` — **not** MoneyInput (odometer is integer km, not cents)
- Year: optional `Input type="number"` with reasonable min/max (1900–2100) matching DB CHECK constraint
- Toast on success via mutation `onSuccess` in hook (not in form) — same as assets

### Odometer Display Helper

Format odometer for display only (no computation):

```typescript
function formatOdometer(km: number): string {
  return `${km.toLocaleString()} km`;
}
```

Use `font-mono` class on odometer text per UX spec.

### Passive Asset Separation (UX-DR10)

- Do **not** import from `components/assets/` or link to passive assets
- Do **not** suggest converting passive asset vehicles to maintenance vehicles
- Optional empty-state helper text only: `maintenance.emptyHelper` — muted, max-width centered

### TanStack Query Invalidation

On `create_vehicle` success, invalidate:
- `queryKeys.maintenance` — refreshes vehicle list
- `queryKeys.maintenanceAlerts` — prepares for Story 18.1 dashboard card (command may not exist yet; invalidation is harmless)

Do **not** invalidate net worth or assets query keys — maintenance vehicles are unrelated to passive assets.

### i18n Key Examples

```json
// en.json (additions)
"nav.maintenance": "Maintenance",
"maintenance.title": "Maintenance",
"maintenance.subtitle": "{{count}} vehicles tracked",
"maintenance.addVehicle": "Add Vehicle",
"maintenance.emptyTitle": "No vehicles tracked yet.",
"maintenance.emptyHelper": "Maintenance tracking is separate from asset values in Net Worth.",
"maintenance.toast.vehicleCreated": "Vehicle added — maintenance schedule created."
```

French equivalents required in `fr.json` — no missing keys in shipped views (NFR16).

### data-testid Conventions

| Element | test id |
|---------|---------|
| Page skeleton | `maintenance-skeleton` |
| Empty state | `maintenance-empty-state` |
| Add Vehicle button (header) | `add-vehicle-button` |
| SlideOver | `vehicle-slide-over` |
| Form | `add-vehicle-form` |
| Vehicle card | `vehicle-card-{id}` |

### Project Structure Notes

New files align with architecture-car-maintenance.md D8:

```
apps/desktop/src/
├── routes/maintenance.tsx              # NEW
├── components/maintenance/
│   ├── AddVehicleForm.tsx              # NEW
│   └── VehicleCard.tsx                 # NEW (header-only stub)
├── hooks/useMaintenance.ts             # NEW
├── lib/types.ts                        # MODIFY
├── lib/constants.ts                    # MODIFY
├── locales/en.json                     # MODIFY
├── locales/fr.json                     # MODIFY
└── components/shared/InnerTabNav.tsx   # MODIFY
```

### Testing

No Playwright E2E required in this story — full maintenance E2E is Story 18.2. Manual verification:
1. Maintenance tab visible after Assets in InnerTabNav
2. `/maintenance` loads empty state with Wrench icon
3. Add Vehicle SlideOver opens, validates required fields, creates vehicle via IPC
4. Vehicle card appears after save; toast shows
5. Switch locale EN ↔ FR — no raw keys visible
6. Skeleton shows briefly on first load

### Anti-Patterns (Do Not)

- Add maintenance to AppSidebar — use InnerTabNav only
- Use MoneyInput for odometer — integer km, not cents
- Compute task status or due dates in frontend
- Link maintenance vehicles to `passive_assets`
- Import task row components prematurely (Story 16.4)
- Store display task names in DB or render raw `task_type_key`
- Manually edit `routeTree.gen.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics-car-maintenance.md#story-163-maintenance-page-navigation--add-vehicle]
- [Source: _bmad-output/planning-artifacts/architecture-car-maintenance.md#d8-maintenance-view-structure]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#car-maintenance-module-added-2026-05-29]
- [Source: apps/desktop/src/routes/assets.tsx — empty state, skeleton, SlideOver patterns]
- [Source: apps/desktop/src/components/assets/AddAssetForm.tsx — form pattern]
- [Source: apps/desktop/src/hooks/useAssets.ts — TanStack Query hook pattern]
- [Source: apps/desktop/src/components/shared/InnerTabNav.tsx — tab insertion point]

## Dev Agent Record

### Agent Model Used

Composer

### Debug Log References

- Quality gates: `tsc --noEmit` pass; `cargo check` + `cargo test` (75 tests) pass
- Playwright: 8 new maintenance tests + updated navigation tests pass; full suite 171/194 pass (23 pre-existing failures in chat/ai-navigation/budget/design-system/import/net-worth — unrelated to this story)

### Completion Notes List

- Implemented Maintenance InnerTabNav tab (Wrench icon) between Assets and Net Worth
- Built `/maintenance` route with empty state, skeleton loading, vehicle list, and Add Vehicle SlideOver
- Added `useMaintenance` / `useCreateVehicle` hooks with query invalidation and success toast
- Added EN/FR i18n keys for all maintenance UI strings
- Added Playwright coverage in `tests/maintenance.spec.ts`; updated `tests/navigation.spec.ts` for Maintenance tab and removed stale Import InnerTabNav entry

### File List

- apps/desktop/src/lib/types.ts
- apps/desktop/src/lib/constants.ts
- apps/desktop/src/hooks/useMaintenance.ts
- apps/desktop/src/components/shared/InnerTabNav.tsx
- apps/desktop/src/components/maintenance/AddVehicleForm.tsx
- apps/desktop/src/components/maintenance/VehicleCard.tsx
- apps/desktop/src/routes/maintenance.tsx
- apps/desktop/src/locales/en.json
- apps/desktop/src/locales/fr.json
- apps/desktop/tests/maintenance.spec.ts
- apps/desktop/tests/navigation.spec.ts

## Change Log

- 2026-05-29: Story 16.3 — Maintenance page, navigation tab, Add Vehicle form, VehicleCard stub, hooks, i18n, and Playwright tests
