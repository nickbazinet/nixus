# Story 4.3: Add, Edit, and View Passive Assets

Status: review

## Story

As a user,
I want to add passive assets (real estate, vehicles, business) with name, type, and estimated value,
So that I can include non-liquid assets in my financial picture.

## Acceptance Criteria

1. **Given** the user navigates to the Assets page, **When** the user clicks "Add Asset", **Then** a form appears with fields: asset name, type (real estate, vehicle, business, other), and estimated value (MoneyInput).
2. **Given** the user fills out the Add Asset form and submits, **When** the asset is saved, **Then** the `passive_assets` table stores the record and a success toast confirms the asset was added.
3. **Given** assets exist, **When** the user views the Assets page, **Then** all assets are displayed using the AccountRow component variant (UX-DR8) with each row showing asset name, type (muted), and estimated value (monospace).
4. **Given** the user clicks an asset's value, **When** the value becomes an inline editable MoneyInput field, **Then** pressing Enter saves the updated value and shows a toast, and pressing Escape cancels without saving.
5. **Given** the user hovers over an asset row, **When** edit/delete actions are revealed, **Then** the user can edit asset details (name, type) or delete the asset with a confirmation dialog.
6. **Given** an asset's value is updated, **When** the save completes, **Then** an entry is written to the `audit_log` table recording the old value, new value, asset ID, and timestamp.
7. **Given** no assets exist, **When** the user views the Assets page, **Then** an empty state is shown: "No assets yet. Add your first asset." with an Add Asset button.
8. **Given** the Assets page loads, **When** data is being fetched, **Then** skeleton loading states are shown matching the row layout.
9. **Given** Playwright tests exist, **When** running `npx playwright test tests/assets.spec.ts`, **Then** all tests pass.

## Tasks / Subtasks

- [x] Task 1: Create `passive_assets` database migration (AC: #2)
  - [x] Create migration SQL file in `src-tauri/migrations/` with the `passive_assets` table: `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `name` (TEXT NOT NULL), `asset_type` (TEXT NOT NULL), `value_cents` (INTEGER NOT NULL DEFAULT 0), `created_at` (TEXT NOT NULL DEFAULT current_timestamp), `updated_at` (TEXT NOT NULL DEFAULT current_timestamp)
  - [x] Verify migration runs on app startup
- [x] Task 2: Implement Rust db layer for passive assets (AC: #2, #3, #4, #5, #6)
  - [x] Create `src-tauri/src/db/asset.rs` with functions: `insert_asset`, `get_all_assets`, `get_asset_by_id`, `update_asset_value`, `update_asset`, `delete_asset`
  - [x] `update_asset_value` returns old and new values for audit logging
  - [x] Add PassiveAsset and CreateAssetInput structs to `src-tauri/src/models/mod.rs`
  - [x] Register module in `db/mod.rs`
- [x] Task 3: Implement Rust Tauri commands for passive assets (AC: #2, #3, #4, #5, #6)
  - [x] Create `src-tauri/src/commands/asset.rs` with commands: `create_asset`, `get_assets`, `update_asset_value`, `update_asset`, `delete_asset`
  - [x] `create_asset` validates required fields (name, asset_type, value_cents) and returns `Result<PassiveAsset, AppError>`
  - [x] `update_asset_value` validates input, calls db function, writes audit log entry (entity_type: "passive_asset", action: "value_update"), returns updated asset
  - [x] `update_asset` validates input, calls db function, returns updated asset
  - [x] `delete_asset` calls db function, returns success
  - [x] Register commands in `main.rs`
- [x] Task 4: Add TypeScript types for passive assets (AC: #3)
  - [x] Add `PassiveAsset`, `CreateAssetInput`, `UpdateAssetInput`, `UpdateAssetValueInput` types to `src/lib/types.ts`
  - [x] Add query key `["assets"]` to `src/lib/constants.ts`
- [x] Task 5: Create `useAssets` hook (AC: #3, #4, #5)
  - [x] Create `src/hooks/useAssets.ts` with TanStack Query `useQuery` for `get_assets`
  - [x] Add `useCreateAsset` mutation — calls `create_asset`, invalidates `["assets"]`, shows success toast
  - [x] Add `useUpdateAssetValue` mutation — calls `update_asset_value`, invalidates `["assets"]`, shows toast
  - [x] Add `useUpdateAsset` mutation — calls `update_asset`, invalidates `["assets"]`
  - [x] Add `useDeleteAsset` mutation — calls `delete_asset`, invalidates `["assets"]`, shows toast
- [x] Task 6: Build Add Asset form (AC: #1)
  - [x] Create `src/components/assets/AddAssetForm.tsx` using React Hook Form
  - [x] Fields: name (text input), asset_type (Select dropdown: real estate, vehicle, business, other), estimated value (MoneyInput)
  - [x] Validation: name required, value required; show inline error messages
  - [x] Submit calls `useCreateAsset` mutation
- [x] Task 7: Reuse AccountRow component for assets (AC: #3, #4, #5)
  - [x] Created dedicated `AssetRow` component following the same visual pattern as AccountRow
  - [x] Asset-specific: shows type only (no currency), no negative balance handling
  - [x] Inline value editing uses the same pattern as balance editing (click -> MoneyInput -> Enter/Escape)
  - [x] Hover-to-reveal edit/delete actions use the same pattern as accounts
- [x] Task 8: Build Assets page route (AC: #1, #3, #7, #8)
  - [x] Create or update `src/routes/assets.tsx`
  - [x] Page header: "Assets" title with "Add Asset" button
  - [x] List of AssetRow components from `useAssets` query
  - [x] Empty state: "No assets yet. Add your first asset." with Add Asset button
  - [x] Skeleton loading state while data fetches
- [x] Task 9: Write Playwright E2E tests (AC: #9)
  - [x] Create `tests/assets.spec.ts`
  - [x] Test: Assets page displays with "Add Asset" button
  - [x] Test: Adding an asset with name, type, and value shows it in the list with formatted value
  - [x] Test: Clicking an asset's value makes it inline-editable; Enter saves, Escape cancels
  - [x] Test: Hover reveals edit/delete actions; delete shows confirmation and removes the asset
  - [x] Test: Success toasts appear for add and edit operations
  - [x] Test: Empty state shows message and button when no assets exist
  - [x] Run `npx playwright test tests/assets.spec.ts` and confirm all tests pass

## Dev Notes

### Database Schema

```sql
CREATE TABLE passive_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  value_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Valid `asset_type` values: `real_estate`, `vehicle`, `business`, `other`. Store as lowercase snake_case strings; display with proper labels in the UI (e.g., `real_estate` -> "Real Estate").

Note: No `institution` or `currency` columns — passive assets are simpler than financial accounts. Values are always in the user's primary currency.

### Rust Models

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct PassiveAsset {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value_cents: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAssetInput {
    pub name: String,
    pub asset_type: String,
    pub value_cents: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAssetInput {
    pub name: Option<String>,
    pub asset_type: Option<String>,
}
```

### Tauri Commands

- `create_asset(input: CreateAssetInput) -> Result<PassiveAsset, AppError>` — validates, inserts, returns created asset
- `get_assets() -> Result<Vec<PassiveAsset>, AppError>` — returns all passive assets ordered by name
- `update_asset_value(id: i64, value_cents: i64) -> Result<PassiveAsset, AppError>` — updates value, writes audit log, returns updated asset
- `update_asset(id: i64, input: UpdateAssetInput) -> Result<PassiveAsset, AppError>` — updates name/type
- `delete_asset(id: i64) -> Result<(), AppError>` — deletes asset

### AccountRow Component Reuse

Per UX-DR8, the AccountRow component is used for both financial accounts and passive assets with different type labels. The component should accept props that distinguish between the two:

```typescript
interface AccountRowProps {
  name: string;
  typeLabel: string;        // "Chequing · CAD" for accounts, "Real Estate" for assets
  valueCents: i64;
  onValueChange: (cents: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  showNegativeInRose?: boolean;  // true for accounts, false for assets
}
```

If the AccountRow from Story 4.1/4.2 was built with only account-specific props, refactor it to accept generic props. The Assets page passes asset-specific data through the same component interface.

### Audit Log for Value Changes

Same pattern as Story 4.2 balance updates:
```
entity_type: "passive_asset"
entity_id: 5
action: "value_update"
old_value: "45000000"
new_value: "47500000"
```

The `audit_log` table should already exist from Story 4.2. If Story 4.2 has not been implemented yet, include the audit_log migration in this story.

### TanStack Query Keys

- `["assets"]` — list all passive assets

### Scope Boundaries

**In scope:** Migration, full Rust CRUD, Add Asset form, Assets page route, AccountRow reuse for assets, inline value editing, hover edit/delete actions, audit log for value changes, Playwright tests.

**Out of scope:** Net worth snapshot trigger on value change (Epic 5). Dashboard "Assets" card aggregation (Epic 5). Currency conversion (all asset values in primary currency).

### Dependency on Prior Stories

- **Story 4.1 (AccountRow component):** This story reuses AccountRow. If Story 4.1 is not yet complete, the asset variant may need to be built standalone and merged later.
- **Story 4.2 (inline editing + audit_log):** This story reuses the inline editing pattern and audit_log table. If Story 4.2 is not yet complete, include the MoneyInput component and audit_log migration in this story.

### Project Structure Notes

Files created or modified in this story:
- `src-tauri/migrations/NNN_passive_assets.sql` (new)
- `src-tauri/src/models/mod.rs` (add PassiveAsset, CreateAssetInput, UpdateAssetInput structs)
- `src-tauri/src/db/asset.rs` (new)
- `src-tauri/src/db/mod.rs` (register asset module)
- `src-tauri/src/commands/asset.rs` (new)
- `src-tauri/src/commands/mod.rs` (register asset commands)
- `src-tauri/src/main.rs` (register commands)
- `src/lib/types.ts` (add PassiveAsset types)
- `src/lib/constants.ts` (add query key)
- `src/hooks/useAssets.ts` (new)
- `src/components/assets/AddAssetForm.tsx` (new)
- `src/components/accounts/AccountRow.tsx` (may need refactor for variant support)
- `src/routes/assets.tsx` (new or update)
- `tests/assets.spec.ts` (new)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture, Passive Asset Queries, Frontend Organization]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — AccountRow Variants (UX-DR8), Inline Editing, Financial Inputs, Empty States]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Playwright `fill()` causes blur on MoneyInput when input has existing value, breaking inline edit. Fixed by removing onBlur save handler (save only on Enter). Also used useRef for draft value to avoid stale closure issues.

### Completion Notes List
- Created `007_passive_assets.sql` migration
- Created `db/asset.rs` with full CRUD + value update with audit logging
- Created `commands/asset.rs` with 5 Tauri commands
- Added PassiveAsset, CreateAssetInput, UpdateAssetInput models to Rust and TypeScript
- Created `useAssets.ts` hook with 5 TanStack Query hooks (query + 4 mutations)
- Created `AssetRow` component with inline value editing, hover-to-reveal edit/delete, delete confirmation dialog
- Created `AddAssetForm` and `EditAssetForm` components
- Updated Assets page route with full implementation
- 8 Playwright E2E tests covering all acceptance criteria
- Also improved AccountRow and AssetRow inline editing by using useRef to avoid stale closure issues with MoneyInput onChange
- Full suite: 70 tests, 0 regressions

### File List
- `src-tauri/migrations/007_passive_assets.sql` (new)
- `src-tauri/src/db/asset.rs` (new)
- `src-tauri/src/db/mod.rs` (modified — added asset module + migration)
- `src-tauri/src/models/mod.rs` (modified — added PassiveAsset, CreateAssetInput, UpdateAssetInput)
- `src-tauri/src/commands/asset.rs` (new)
- `src-tauri/src/commands/mod.rs` (modified — added asset module)
- `src-tauri/src/lib.rs` (modified — registered 5 asset commands)
- `src/lib/types.ts` (modified — added PassiveAsset types)
- `src/lib/constants.ts` (modified — added assets query key)
- `src/hooks/useAssets.ts` (new)
- `src/components/assets/AssetRow.tsx` (new)
- `src/components/assets/AddAssetForm.tsx` (new)
- `src/components/assets/EditAssetForm.tsx` (new)
- `src/routes/assets.tsx` (modified — full implementation)
- `src/components/accounts/AccountRow.tsx` (modified — improved inline edit with useRef, removed onBlur save)
- `tests/assets.spec.ts` (new)
