# Story 20.1: NHTSA Vehicle Catalog Cache and Form Comboboxes

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to pick my vehicle's make and model from a searchable list when the app has synced catalog data,
So that my garage stays consistent and I avoid typos, while still being able to enter details manually when offline.

**Scope:** NHTSA vPIC catalog cache (Rust), three new IPC commands, background startup refresh, searchable combobox UX in `AddVehicleForm` and `EditVehicleForm`, i18n, and Playwright coverage for catalog + fallback paths. **No SQLite schema migration.** Vehicle identity fields remain optional `make`, `model`, `year` in the existing `vehicles` table.

## Acceptance Criteria

1. **Given** the app starts with network access and no catalog cache (or cache older than 180 days)
   **When** the background catalog sync runs
   **Then** makes are fetched from NHTSA vPIC `GetMakesForVehicleType/car` and stored under `{app_data_dir}/vehicle_catalog/` (D9)
   **And** startup is not blocked — sync runs in a background task after the app is interactive

2. **Given** a valid makes cache exists on disk
   **When** the user opens Add Vehicle or Edit Vehicle
   **Then** make and model fields render as searchable comboboxes (year → make → model cascade)
   **And** model options for a selected make+year are loaded via `get_vehicle_models` (lazy fetch + cache when online)

3. **Given** no catalog cache exists (first launch offline or refresh failed with empty cache)
   **When** the user opens Add Vehicle or Edit Vehicle
   **Then** make and model remain free-text inputs (current behavior preserved)

4. **Given** a catalog-backed form is displayed
   **When** the user selects "Enter manually" (or equivalent i18n control)
   **Then** make and model switch to free-text fields without losing other form values

5. **Given** `get_vehicle_catalog_status`, `get_vehicle_makes`, and `get_vehicle_models` Tauri commands
   **When** invoked from the frontend
   **Then** they follow existing IPC patterns (snake_case, typed errors, TanStack Query hooks)
   **And** stale cache is served when refresh fails but cached data exists

6. **Given** catalog UI strings
   **When** rendered in EN and FR
   **Then** all new keys exist under `maintenance.catalog.*` (NFR16)

7. **Given** Playwright E2E coverage
   **When** catalog IPC is mocked as available
   **Then** a test verifies combobox selection persists on save
   **And** existing free-text vehicle registration path remains tested when catalog is unavailable

## Tasks / Subtasks

- [ ] Task 1: Add `reqwest` dependency and catalog module skeleton (AC: #1, #5)
  - [ ] Add to `apps/desktop/src-tauri/Cargo.toml`: `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }` (already in `Cargo.lock` transitively via `async-openai`; add as **direct** dependency for NHTSA HTTP)
  - [ ] Create `apps/desktop/src-tauri/src/maintenance/catalog.rs`
  - [ ] Add `pub mod catalog;` to `apps/desktop/src-tauri/src/maintenance/mod.rs`
  - [ ] Define constants: `CATALOG_TTL_DAYS = 180`, `NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/"`, `SCHEMA_VERSION = 1`
  - [ ] Define cache paths relative to app data dir:
    - `{app_data_dir}/vehicle_catalog/meta.json`
    - `{app_data_dir}/vehicle_catalog/makes.json`
    - `{app_data_dir}/vehicle_catalog/models/{make_slug}_{year}.json`
  - [ ] Define serde types: `CatalogMeta`, `CachedMakes`, `CachedModels`, `VehicleCatalogStatus`, `VehicleMake`, `VehicleModel`

- [ ] Task 2: Implement cache read/write, TTL, and make-slug normalization (AC: #1, #5)
  - [ ] `catalog_dir(app_data_dir) -> PathBuf` — create dir on write
  - [ ] `make_slug(make: &str) -> String` — lowercase, trim, replace non-alphanumeric with `_`, collapse repeats (e.g. `"Mercedes-Benz"` → `"mercedes_benz"`)
  - [ ] `read_meta`, `write_meta`, `read_makes`, `write_makes`, `read_models`, `write_models`
  - [ ] `is_cache_stale(meta) -> bool` — true when missing or `cached_at + ttl_days` elapsed
  - [ ] `get_catalog_status(app_data_dir) -> VehicleCatalogStatus` — `{ available: bool, cached_at?: string, stale: bool }`
    - `available = true` when `makes.json` exists and parses with non-empty makes list
    - `stale = true` when meta exists but TTL expired (still serve if file exists)
  - [ ] Rust unit tests: slug normalization, TTL edge cases (day 179 vs 181), stale-but-available status

- [ ] Task 3: Implement NHTSA fetch + background refresh (AC: #1, #5)
  - [ ] `fetch_makes_from_nhtsa() -> Result<Vec<VehicleMake>, AppError>` — GET `{NHTSA_BASE}GetMakesForVehicleType/car?format=json`
  - [ ] Parse `Results[].MakeName` (ignore empty names); sort makes alphabetically case-insensitive before cache write
  - [ ] `fetch_models_from_nhtsa(make: &str, year: i32) -> Result<Vec<VehicleModel>, AppError>` — GET `{NHTSA_BASE}GetModelsForMakeYear/make/{urlencoded_make}/modelyear/{year}?format=json`
  - [ ] Parse `Results[].Model_Name`; dedupe; sort alphabetically
  - [ ] `refresh_makes_cache(app_data_dir) -> Result<(), AppError>` — fetch, write `makes.json` + update `meta.json` atomically (write temp file then rename)
  - [ ] `get_or_fetch_models(app_data_dir, make: &str, year: i32) -> Result<Vec<VehicleModel>, AppError>` — read cache file first; if missing and online, fetch + write cache; if offline and missing, return empty vec (not hard error)
  - [ ] `spawn_background_catalog_refresh(app_data_dir: PathBuf)` — called from `lib.rs` setup **after** DB init, mirroring recurring apply spawn pattern (lines 58–83)
  - [ ] Refresh only when: network reachable (attempt fetch; on failure log + retain stale) AND (`meta.json` missing OR stale)
  - [ ] **Do NOT** prefetch all model files on startup — makes only
  - [ ] **Do NOT** block `setup()` — use `tauri::async_runtime::spawn`
  - [ ] Log outcomes via `tracing::info!` / `tracing::error!` — never panic on catalog failure

- [ ] Task 4: Add IPC commands (AC: #2, #3, #5)
  - [ ] Extend `apps/desktop/src-tauri/src/commands/maintenance.rs`:
    - `get_vehicle_catalog_status(app: AppHandle) -> Result<VehicleCatalogStatus, AppError>`
    - `get_vehicle_makes(app: AppHandle) -> Result<Vec<VehicleMake>, AppError>` — returns cached makes or empty vec
    - `get_vehicle_models(app: AppHandle, make: String, year: i32) -> Result<Vec<VehicleModel>, AppError>` — lazy fetch + cache
  - [ ] Resolve `app_data_dir` via `app.path().app_data_dir()` (same pattern as `commands/backup.rs`)
  - [ ] Register all three commands in `apps/desktop/src-tauri/src/lib.rs` `invoke_handler!`
  - [ ] Validate `year` 1900–2100 and non-empty trimmed `make` for `get_vehicle_models`; return `AppError::Validation` on bad input
  - [ ] No SQL, no `DbState` lock required for catalog commands

- [ ] Task 5: TypeScript types, query keys, and hooks (AC: #2, #5)
  - [ ] Add to `apps/desktop/src/lib/types.ts`:
    ```typescript
    interface VehicleCatalogStatus {
      available: boolean;
      cached_at?: string;
      stale: boolean;
    }
    interface VehicleMake { name: string; }
    interface VehicleModel { name: string; }
    ```
  - [ ] Add to `apps/desktop/src/lib/constants.ts`:
    - `vehicleCatalog: ["vehicle-catalog"] as const`
    - `vehicleMakes: ["vehicle-catalog", "makes"] as const`
    - `vehicleModels: (make: string, year: number) => ["vehicle-catalog", "models", make, year] as const`
  - [ ] Create `apps/desktop/src/hooks/useVehicleCatalog.ts`:
    - `useVehicleCatalogStatus()` — `invoke("get_vehicle_catalog_status")`, staleTime 5 min
    - `useVehicleMakes(enabled: boolean)` — only fetch when catalog `available`
    - `useVehicleModels(make: string | null, year: number | null, enabled: boolean)` — enabled when make+year set and catalog available

- [ ] Task 6: Shared catalog form fields component (AC: #2, #3, #4)
  - [ ] Create `apps/desktop/src/components/maintenance/VehicleCatalogFields.tsx`
  - [ ] Props: `make`, `model`, `year` values + onChange callbacks; optional `initialManualMode` for edit form
  - [ ] On mount: call `useVehicleCatalogStatus()` — if `!available`, render current free-text `Input` fields (preserve existing labels/testids)
  - [ ] When catalog available (default mode):
    - Year: number `Input` (1900–2100) — **unchanged from today**
    - Make: searchable combobox — `Popover` + filter `Input` + scrollable list (reuse `@nixus/shared` `Popover`, `Input`, `Button`; **no Combobox primitive exists in shared package**)
    - Model: searchable combobox — disabled until year + make selected; loads via `useVehicleModels`
    - Show muted hint when `stale === true`: `maintenance.catalog.staleHint`
  - [ ] "Enter manually" link/button toggles to free-text make/model; "Use catalog" toggles back — preserve year + odometer/other fields
  - [ ] `data-testid`: `vehicle-catalog-make`, `vehicle-catalog-model`, `vehicle-catalog-manual-toggle`, `vehicle-catalog-mode-manual`, `vehicle-catalog-mode-catalog`
  - [ ] Selected make/model values stored as plain strings (exact NHTSA spelling) — backend `derive_vehicle_nickname` handles display label

- [ ] Task 7: Integrate into AddVehicleForm and EditVehicleForm (AC: #2, #3, #4)
  - [ ] Modify `apps/desktop/src/components/maintenance/AddVehicleForm.tsx` — replace inline make/model/year inputs with `VehicleCatalogFields`; keep odometer validation unchanged
  - [ ] Modify `apps/desktop/src/components/maintenance/EditVehicleForm.tsx` — same integration; pre-fill from `vehicle.make/model/year`
  - [ ] If user had manually entered values not in catalog, default to manual mode when opening edit (compare against catalog list optional — simplest: manual mode when existing make not in cached makes list)
  - [ ] **Do NOT** add nickname field — nickname remains server-derived via `derive_vehicle_nickname` (Story 16.2+)
  - [ ] **Do NOT** change `create_vehicle` / `update_vehicle` IPC signatures

- [ ] Task 8: i18n EN + FR (AC: #6)
  - [ ] Add keys to `apps/desktop/src/locales/en.json` and `fr.json` under `maintenance.catalog.*`:
    - `maintenance.catalog.enterManually` — "Enter manually"
    - `maintenance.catalog.useCatalog` — "Use catalog"
    - `maintenance.catalog.searchMake` — "Search makes…"
    - `maintenance.catalog.searchModel` — "Search models…"
    - `maintenance.catalog.selectMakeFirst` — "Select a make first"
    - `maintenance.catalog.selectYearFirst` — "Enter a year first"
    - `maintenance.catalog.noMakes` — "No makes available"
    - `maintenance.catalog.noModels` — "No models found for this make and year"
    - `maintenance.catalog.loadingModels` — "Loading models…"
    - `maintenance.catalog.staleHint` — "Catalog data may be outdated — still usable offline"
    - `maintenance.catalog.unavailableHint` — "Catalog unavailable — enter make and model manually"
  - [ ] Add i18n parity test entry in `apps/desktop/src/locales/__tests__/maintenance-i18n.test.ts` for new keys

- [ ] Task 9: Playwright E2E tests (AC: #7)
  - [ ] Extend `apps/desktop/tests/maintenance.spec.ts` mock (`setupMaintenanceTauriMock` / `setupTauriMock`) with handlers:
    - `get_vehicle_catalog_status` → `{ available: true, cached_at: "2026-01-01", stale: false }` or `{ available: false }`
    - `get_vehicle_makes` → `[{ name: "Honda" }, { name: "Toyota" }]`
    - `get_vehicle_models` → filter by make/year args, e.g. Honda 2020 → `[{ name: "Civic" }, { name: "Accord" }]`
  - [ ] **Catalog path test:** open Add Vehicle → select year 2020 → pick Honda → pick Civic from combobox → save → verify vehicle card shows "2020 Honda Civic"
  - [ ] **Fallback path test:** mock `available: false` → fill make/model as free text (existing `createVehicle` helper pattern) → save succeeds
  - [ ] **Manual toggle test:** catalog available → click "Enter manually" → type custom make → save persists custom values
  - [ ] Preserve all existing maintenance.spec.ts tests — catalog mocks must not break inbox/garage flows

- [ ] Task 10: Verification gates (AC: #1–#7)
  - [ ] `cd apps/desktop/src-tauri && RUSTFLAGS="-D warnings" cargo test` — catalog unit tests pass, zero warnings
  - [ ] `pnpm --filter @nkbaz/desktop exec tsc --noEmit`
  - [ ] `pnpm --filter @nkbaz/desktop exec playwright test tests/maintenance.spec.ts`

## Dev Notes

### Architecture Compliance — D9 (Vehicle Make/Model Catalog)

[Source: `_bmad-output/planning-artifacts/architecture-car-maintenance.md` § D9]

| Requirement | Implementation |
|-------------|----------------|
| NHTSA base URL | `https://vpic.nhtsa.dot.gov/api/vehicles/` |
| Makes endpoint | `GetMakesForVehicleType/car?format=json` |
| Models endpoint | `GetModelsForMakeYear/make/{make}/modelyear/{year}?format=json` |
| Cache location | `{app_data_dir}/vehicle_catalog/` alongside `nkbaz-finance.db` |
| TTL | 180 days (6 months) in `meta.json` |
| Startup refresh | Non-blocking background task |
| Stale on failure | Serve stale cache; free-text only when no usable cache |
| Manual fallback | Always available via toggle, even when catalog loaded |
| IPC commands | `get_vehicle_catalog_status`, `get_vehicle_makes`, `get_vehicle_models` |
| Rust module | `maintenance/catalog.rs` |
| No schema change | `make`, `model`, `year` stay optional on `vehicles` table |
| Not in SQLite backup | Catalog is regenerable; exclude from backup logic (no backup.rs changes needed) |

**Scope distinction from D1:** D1 rejected external APIs for **maintenance interval baselines**. D9 is **vehicle identity only** — maintenance schedules remain in `defaults.rs`. Do not conflate catalog with interval lookup.

### NHTSA Response Shapes (verify during implementation)

Expected JSON (vPIC standard):

```json
// GetMakesForVehicleType
{ "Count": N, "Results": [{ "MakeId": 123, "MakeName": "HONDA" }, ...] }

// GetModelsForMakeYear
{ "Count": N, "Results": [{ "Make_ID": 123, "Make_Name": "HONDA", "Model_ID": 456, "Model_Name": "Civic" }, ...] }
```

Store/display **`MakeName` / `Model_Name`** as the canonical string. URL-encode make in the path segment. Handle HTTP errors, empty `Results`, and malformed JSON gracefully — log and return `AppError::External` or empty vec as appropriate; never crash the app.

### App Data Directory Pattern

Follow `commands/backup.rs`:

```rust
let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| AppError::File { message: e.to_string() })?;
```

Database lives at `{app_data_dir}/nkbaz-finance.db` per `db/mod.rs`. Catalog cache is a **sibling directory**, not inside SQLite.

### Background Refresh Pattern

Mirror existing startup spawn in `lib.rs` (recurring apply):

```rust
let catalog_dir = app_data_dir.clone();
tauri::async_runtime::spawn(async move {
    maintenance::catalog::spawn_background_catalog_refresh(catalog_dir);
});
```

Place **after** DB initialization and AI client init. Catalog refresh must **not** acquire `DbState` mutex — avoids blocking NFR14 dashboard alert evaluation.

### Current Form Baseline (Do Not Regress)

`AddVehicleForm.tsx` and `EditVehicleForm.tsx` currently use plain `Input` for make, model, year. Odometer validation is integer-only with inline errors. Nickname is **not** collected in the form — backend derives it:

```rust
// maintenance/display.rs
derive_vehicle_nickname(make, model, year) // e.g. "2020 Honda Civic"
```

[Source: `apps/desktop/src-tauri/src/maintenance/display.rs`]

`create_vehicle` IPC accepts `odometer_km`, `make`, `model`, `year` only — no signature changes in this story.

### Combobox UX (No Existing Primitive)

The shared package exports `Select`, `Popover`, `Input` — **not** a searchable Combobox. Build a lightweight searchable list:

1. Trigger button shows selected value or placeholder
2. Popover contains filter input + scrollable options
3. Filter client-side on cached makes/models (lists are bounded — NHTSA returns hundreds of makes, tens of models per make/year)
4. Match existing form styling: `space-y-1.5`, `Label`, `h-8` inputs per `select.tsx` / `AddVehicleForm`

Do **not** add `@radix-ui/react-combobox` or new npm deps without justification — keep in feature folder.

### TanStack Query Guidelines

| Query key | When to fetch | staleTime |
|-----------|---------------|-----------|
| `vehicleCatalog` | Form mount | 5 minutes |
| `vehicleMakes` | Catalog available | 30 minutes (disk-backed) |
| `vehicleModels` | make + year selected | 30 minutes per make+year |

Catalog mutations do not invalidate maintenance vehicle queries — separate concern.

### Previous Story Intelligence

**Story 16.3 (Add Vehicle form patterns):**
- SlideOver wraps form in parent route — do not move SlideOver into catalog component
- `data-testid="add-vehicle-form"` must remain on form element
- Playwright uses `getByLabel("Make")`, `getByLabel("Model")`, `getByLabel("Year")` — preserve `Label htmlFor` + accessible labels when swapping to combobox
- Success toast: `maintenance.toast.vehicleCreated`; invalidates `["maintenance"]` and `["maintenance-alerts"]`

**Story 16.2 (Vehicle IPC):**
- Validation: year 1900–2100, odometer >= 0
- `update_vehicle` updates nickname when make/model/year change via `derive_vehicle_nickname`

**Story 18.2 (E2E):**
- `maintenance.spec.ts` has extensive mock IPC — extend, do not replace
- `createVehicle()` helper fills make/model/year as text — keep working for fallback test

**Epics 16–19 status:** Implementation exists in working tree; this story is additive UX + cache layer on top of stable vehicle CRUD.

### Critical Anti-Patterns (DO NOT)

| Anti-pattern | Why |
|--------------|-----|
| Block app startup on NHTSA fetch | Violates D9 + NFR14; use background spawn |
| Prefetch all make×year model files | Thousands of API calls; lazy fetch on selection only |
| Remove free-text fallback | Required for offline / empty cache / edge makes |
| Remove "Enter manually" when catalog loaded | Explicit D9 UX requirement |
| Store catalog in SQLite | D9 specifies filesystem cache under app data dir |
| Add migration for make/model | Fields already exist in `018_maintenance_tables.sql` |
| Put HTTP logic in `commands/maintenance.rs` | Belongs in `maintenance/catalog.rs`; commands are thin wrappers |
| Change `create_vehicle` to require catalog IDs | Store plain strings only |
| Add nickname field to form | Server derives nickname; breaks existing UX |
| Use wrong cache path (`_bmad-output`, project root, temp dir) | Must be `{app_data_dir}/vehicle_catalog/` |
| Fail vehicle save when catalog offline | Catalog is optional enhancement only |
| Duplicate `derive_vehicle_nickname` in frontend | Single source in Rust `display.rs` |

### File Structure (Expected Changes)

```
apps/desktop/
├── src/
│   ├── components/maintenance/
│   │   ├── AddVehicleForm.tsx              # MODIFY — use VehicleCatalogFields
│   │   ├── EditVehicleForm.tsx             # MODIFY — use VehicleCatalogFields
│   │   └── VehicleCatalogFields.tsx        # NEW
│   ├── hooks/
│   │   └── useVehicleCatalog.ts            # NEW
│   ├── lib/
│   │   ├── types.ts                        # MODIFY — catalog types
│   │   └── constants.ts                    # MODIFY — query keys
│   └── locales/
│       ├── en.json                         # MODIFY — maintenance.catalog.*
│       ├── fr.json                         # MODIFY
│       └── __tests__/maintenance-i18n.test.ts  # MODIFY
├── tests/
│   └── maintenance.spec.ts                 # MODIFY — catalog + fallback E2E
└── src-tauri/
    ├── Cargo.toml                          # MODIFY — add reqwest
    └── src/
        ├── lib.rs                          # MODIFY — register IPC + background spawn
        ├── maintenance/
        │   ├── mod.rs                      # MODIFY — pub mod catalog
        │   └── catalog.rs                  # NEW
        └── commands/
            └── maintenance.rs              # MODIFY — 3 catalog commands
```

**Files explicitly NOT modified:** `passive_assets`, `migrations/`, `backup.rs`, `evaluator.rs`, `defaults.rs`, AI chat tools.

### Testing Requirements

**Rust (`#[cfg(test)]` in `catalog.rs`):**
- `make_slug` normalization table (spaces, hyphens, unicode-safe fallback)
- TTL: fresh meta → not stale; meta aged 181 days → stale
- `get_catalog_status`: no files → `available: false`; makes.json present → `available: true`
- Optional: mock HTTP with `wiremock` — **not required** if fetch functions are thin; prefer testing cache/TTL/slug logic

**Playwright:**
- Catalog combobox happy path saves correct make/model/year
- Unavailable catalog preserves text input behavior
- Manual toggle preserves values across mode switch
- Existing maintenance tests still pass

**Manual smoke:**
1. First launch online → background fetch → reopen Add Vehicle → comboboxes appear
2. Airplane mode with existing cache → comboboxes work offline
3. Airplane mode without cache → free-text fields
4. Edit vehicle → change make via catalog → nickname updates on save

### cache file examples

**meta.json:**
```json
{ "cached_at": "2026-05-30T12:00:00Z", "ttl_days": 180, "schema_version": 1 }
```

**makes.json:**
```json
{ "makes": [{ "name": "Honda" }, { "name": "Toyota" }] }
```

**models/honda_2020.json:**
```json
{ "make": "Honda", "year": 2020, "models": [{ "name": "Civic" }, { "name": "Accord" }] }
```

### References

- [Source: `_bmad-output/planning-artifacts/epics-car-maintenance.md` § Epic 20, Story 20.1]
- [Source: `_bmad-output/planning-artifacts/architecture-car-maintenance.md` § D9]
- [Source: `_bmad-output/implementation-artifacts/16-3-maintenance-page-navigation-and-add-vehicle.md` — AddVehicleForm patterns]
- [Source: `_bmad-output/implementation-artifacts/16-2-vehicle-registration-and-crud-commands.md` — vehicle IPC]
- [Source: `apps/desktop/src-tauri/src/lib.rs` — startup background task pattern]
- [Source: `apps/desktop/src-tauri/src/commands/backup.rs` — app_data_dir resolution]
- [Source: `apps/desktop/src-tauri/src/db/mod.rs` — app data dir + SQLite path]
- [Source: `apps/desktop/src/components/maintenance/AddVehicleForm.tsx` — current free-text baseline]
- [Source: `apps/desktop/tests/maintenance.spec.ts` — E2E mock + createVehicle helper]
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-05-30: Story 20.1 created — NHTSA catalog cache, IPC commands, combobox UX, i18n, E2E guardrails (ready-for-dev)
