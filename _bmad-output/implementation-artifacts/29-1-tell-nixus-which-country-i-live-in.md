# Story 29.1: Tell Nixus which country I live in

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user anywhere in the world,
I want to select my country from a complete list that works offline,
so that Nixus can tailor guidance to where I actually live.

## Acceptance Criteria

1. **Given** I am on `/profile`
   **When** I open the country selector
   **Then** I see every ISO 3166-1 country, sorted for browsing, with no network request made

2. **Given** the app is running with no internet connection on a fresh install
   **When** I open the country selector
   **Then** the full list still appears, because the dataset is embedded in the binary via `include_str!`

3. **Given** the dataset is parsed
   **When** `get_countries` is called repeatedly
   **Then** parsing happens once via `std::sync::OnceLock`, not per call

4. **Given** I am viewing the app in French
   **When** I open the country selector
   **Then** country names display their French values where the dataset provides `name_fr`
   **And** they fall back to `name_en` where `name_fr` is absent, never rendering blank

5. **Given** I select a country and press Save
   **When** the document is written
   **Then** `country_code` holds the ISO 3166-1 alpha-2 code

6. **Given** a `country_code` not present in the bundled dataset is submitted
   **When** validation runs in `profile_store.rs`
   **Then** it is rejected as `AppError::Validation { field: "country_code" }`

7. **Given** the dataset needs refreshing
   **When** a maintainer runs `pnpm --filter @nixus/desktop generate:iso3166`
   **Then** `src-tauri/data/iso3166.json` is regenerated as a reviewable diff
   **And** every entry has a non-empty `name_en`
   **And** the script is not wired into the build or CI, and the app never fetches this data at runtime

8. **Given** the frontend needs country data
   **When** the implementation is inspected
   **Then** the frontend ships no second copy of the dataset and obtains it only via `get_countries`
   **And** `useCountries` uses `staleTime: Infinity`

## Tasks / Subtasks

- [x] **Task 1 — Record the canonical ISO 3166 source, then write the dev-only generation script** (AC: #7)
  - [x] Choose exactly one canonical source for both ISO 3166-1 (countries) and ISO 3166-2 (subdivisions) with EN and FR names, and write the chosen source URL/package plus the retrieval date into the "Canonical source of record" subsection of this story's Dev Notes below (replace the placeholder line) **and** into the generated file's metadata header (see Task 2). Reproducibility is the point: a future regeneration must be able to hit the same source and produce a comparable diff.
  - [x] Create `apps/desktop/scripts/generate-iso3166.mjs`. The directory `apps/desktop/scripts/` **does not exist yet** — create it. This is the first script in it.
  - [x] The script is plain Node ESM (`.mjs`), uses only Node built-ins (`node:fs`, `node:path`, and `fetch`, which is global in Node 18+). **No new npm package may be added** (NFR6) — not as a `dependency`, not as a `devDependency`.
  - [x] The script writes `apps/desktop/src-tauri/data/iso3166.json` (create the `data/` directory). It is the only writer of that file.
  - [x] Emit `countries` sorted ascending by `code`, and each country's `subdivisions` sorted ascending by `code`. Stable ordering is what makes a regeneration a reviewable diff instead of a reshuffle.
  - [x] Emit with 2-space indentation and a trailing newline, so the diff is line-oriented.
  - [x] **Hard guarantee:** the script must fail with a non-zero exit code and write nothing if any country or subdivision would have a missing, empty, or whitespace-only `name_en`. This is the mechanism behind AC #7's "every entry has a non-empty `name_en`" and behind the EN-fallback contract in AC #4 (G6). A partial write followed by a manual fix is not acceptable.
  - [x] Omit `name_fr` entirely (do not emit `null`, do not emit `""`) when no French name is available for an entry. FR coverage will be incomplete — that is expected and planned for (G6), not a defect to paper over.
  - [x] Omit `subdivisions` entirely for countries that have none, rather than emitting `[]`.
  - [x] Put a header comment block at the top of the `.mjs` file naming the canonical source, the fact that this is dev-only, and that regeneration is a deliberate reviewable commit.

- [x] **Task 2 — Generate and check in `src-tauri/data/iso3166.json`** (AC: #2, #7)
  - [x] Run the script and commit the produced `apps/desktop/src-tauri/data/iso3166.json`. The file is checked in — the Rust build reads it at compile time via `include_str!`, so a missing file is a compile error, not a runtime one.
  - [x] The file must carry the metadata header keys `_source`, `_source_retrieved_at`, and `_generated_by` (see "Dataset JSON schema" in Dev Notes). JSON has no comment syntax, so these underscore-prefixed keys **are** the comment header required by Task 1. Serde ignores unknown fields by default, so they cost nothing on the Rust side.
  - [x] Verify by inspection that every `name_en` in the committed file is non-empty.

- [x] **Task 3 — Add the `generate:iso3166` script entry to `apps/desktop/package.json`** (AC: #7)
  - [x] Add `"generate:iso3166": "node scripts/generate-iso3166.mjs"` to the `scripts` block, after `"test:watch"` (the block currently ends there — see the quoted block in Dev Notes).
  - [x] Do **not** add it to `dev`, `build`, `tauri`, or any `pre*`/`post*` lifecycle hook. Do **not** reference it from any workflow under `.github/`. Regeneration is a human action producing a reviewable commit.
  - [x] Do not touch `dependencies` or `devDependencies` (NFR6).

- [x] **Task 4 — Add the `Country` and `Subdivision` models plus the dataset parse types** (AC: #3, #5)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add `Country { code: String, name_en: String, name_fr: Option<String> }` and `Subdivision { code: String, name_en: String, name_fr: Option<String> }`.
  - [x] Add the dataset parse types `Iso3166Dataset { countries: Vec<CountryEntry> }` and `CountryEntry { code, name_en, name_fr, #[serde(default)] subdivisions: Vec<Subdivision> }`.
  - [x] All four derive **exactly** `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields (project rule 4). Do **not** add `#[serde(rename_all = "camelCase")]` — see the explicit anti-pattern in Dev Notes.
  - [x] `Subdivision` is added in this story even though `get_subdivisions` is Story 29.2, because `CountryEntry` needs it to parse the dataset. It is genuinely read here (as `CountryEntry.subdivisions`), so no `#[allow(dead_code)]` is required or permitted.

- [x] **Task 5 — Load the dataset once in `profile_store.rs`** (AC: #2, #3)
  - [x] In `apps/desktop/src-tauri/src/profile_store.rs` (created by Story 28.2), add `const ISO3166_JSON: &str = include_str!("../data/iso3166.json");` and `static ISO3166: OnceLock<Iso3166Dataset> = OnceLock::new();`.
  - [x] Add `pub(crate) fn dataset() -> &'static Iso3166Dataset` using `ISO3166.get_or_init(...)`. Parsing a few hundred KB on every call is avoidable and is exactly the mistake the architecture calls out.
  - [x] `get_or_init` cannot return a `Result`. On a parse failure, log with `tracing::error!` and fall back to an empty `Iso3166Dataset { countries: Vec::new() }`. This cannot happen in practice — the file is checked in and `include_str!` is compile-time — and the alternative would be a `.unwrap()`, which is forbidden outside tests. Do not use `expect`.
  - [x] Add `pub(crate) fn countries() -> Vec<Country>` mapping each `CountryEntry` to a `Country` (dropping `subdivisions`, which must not cross IPC in this story).
  - [x] Add `pub(crate) fn country_exists(code: &str) -> bool` for the validation path.
  - [x] Do **not** create a new Rust module for this. See "Where the dataset loader lives" in Project Structure Notes for why `profile_store.rs` is the correct host and why an `iso3166.rs` module was rejected.

- [x] **Task 6 — Add the `get_countries` command** (AC: #1, #2, #3)
  - [x] In `apps/desktop/src-tauri/src/commands/profile.rs` (created by Story 28.2), add `#[tauri::command(rename_all = "snake_case")] pub fn get_countries() -> Result<Vec<Country>, AppError>` delegating to `profile_store::countries()`.
  - [x] It is **synchronous** (`pub fn`, not `pub async fn`) — there is no IO and no token refresh.
  - [x] It is **not session-gated**: it must not call `auth::current_subject()`. The ISO 3166 list is not user data. Every other command in this file is session-gated; this one deliberately is not, and that asymmetry is intentional.
  - [x] Do **not** implement `get_location_catalog`. It is superseded by architecture Correction 2 and must not exist.
  - [x] Do **not** implement `get_subdivisions` — that is Story 29.2.
  - [x] Register `commands::profile::get_countries` in `lib.rs`'s `tauri::generate_handler![...]`, alongside the profile commands registered by Story 28.2. `mod profile_store;` is already declared there by Story 28.2 — verify, do not re-add.

- [x] **Task 7 — Validate `country_code` against the dataset in `profile_store.rs`** (AC: #6)
  - [x] In the existing validation function added by Story 28.2, reject any `Some(code)` where `!country_exists(code)` as `AppError::Validation { message: format!("Invalid country code: {code}"), field: Some("country_code".to_string()) }`.
  - [x] Follow the exact allow-list style of `db/account.rs::insert_account` (quoted in Dev Notes) — same `format!` message shape, same `field: Some(...)`.
  - [x] `None` is valid and clears the field. All profile fields are nullable.
  - [x] Validation lives in `profile_store.rs`, never in the command layer. The command orchestrates only.
  - [x] Rust is the authority. A `country_code` that the frontend never offered must still be rejected here.
  - [x] Do **not** add `subdivision_code` cross-validation in this story — that is Story 29.2.

- [x] **Task 8 — Rust unit tests** (AC: #3, #6)
  - [x] In `profile_store.rs`'s existing `#[cfg(test)] mod tests` (established by Story 28.2 with `tempfile`), add: a test that saving with a valid country code (`"CA"`) succeeds and round-trips `country_code`; a test that an unknown code (`"ZZ"`) is rejected as `AppError::Validation` with `field == Some("country_code")`; and a test that `dataset()` called twice returns the **same** allocation, asserted with `std::ptr::eq(dataset(), dataset())` — that is what proves the `OnceLock` initializes once rather than per call.
  - [x] Add a test asserting the parsed dataset is non-empty and that every country has a non-empty `name_en`, so a bad regeneration fails `cargo test` rather than shipping blank options.
  - [x] `.unwrap()` is permitted inside tests only.

- [x] **Task 9 — Frontend types, query key, and hook** (AC: #8)
  - [x] In `apps/desktop/src/lib/types.ts`, add `Country` and `Subdivision` mirroring the Rust shapes with `snake_case` fields (`code`, `name_en`, `name_fr?`).
  - [x] In `apps/desktop/src/lib/constants.ts`, add `countries: ["countries"] as const` to `queryKeys` — flat and top-level, matching the dominant convention, not nested like the `auth.session` outlier.
  - [x] In `apps/desktop/src/hooks/useProfile.ts` (created by Story 28.2), add `useCountries()` — a `useQuery` with `queryKey: queryKeys.countries`, `queryFn: () => invoke<Country[]>("get_countries")`, and `staleTime: Infinity`. The dataset cannot change while the app runs; refetching it is pure waste.
  - [x] Do not add `useSubdivisions` — Story 29.2.
  - [x] The frontend must contain **no copy of the dataset**: no `.json` import, no hardcoded country array, no generated TS module. `get_countries` is the only source.

- [x] **Task 10 — Add the country `Select` to `ProfileForm.tsx`** (AC: #1, #4, #5)
  - [x] In `apps/desktop/src/components/profile/ProfileForm.tsx` (created by Story 28.2), add a `country_code` field. The form field name **is** the `snake_case` IPC name, so an `AppError::Validation { field: "country_code" }` maps straight to `setError("country_code")` with no translation table.
  - [x] Use the shared `Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem` primitives from `@nixus/shared` wrapped in a `react-hook-form` `Controller`, exactly as `components/accounts/AddAccountForm.tsx` does (quoted in Dev Notes). Do **not** build a new select, a combobox, or an autocomplete — project rule 8 forbids duplicating a component that exists in `packages/shared/src/ui/`.
  - [x] Compute the display label as `name_fr ?? name_en` when the active language is French, and `name_en` otherwise — **never** render an empty label (AC #4, G6). Implement the fallback with `??` on the optional field, not with a truthiness check that a legitimately non-empty value could not fail anyway; the point is that `undefined` resolves to `name_en`.
  - [x] Sort the options by resolved display label using `new Intl.Collator(i18n.language)` so the list is browsable in the active locale (AC #1's "sorted for browsing"). Do not rely on the dataset's `code` ordering for display — that ordering exists for diff stability, not for humans.
  - [x] Include an explicit "not specified" option that maps to `null` so the field can be cleared. Empty string is never a stored value — absent means `null` (architecture Format Patterns).
  - [x] Include the new field in the existing submit payload. Save is a **full replace** (G1): omitting `country_code` from the payload would clear it.
  - [x] Country names come from the dataset, **not** from i18n keys — 250 hand-written translations are untenable and NFR5 explicitly routes them through the dataset.

- [x] **Task 11 — i18n keys in both locale files** (AC: #4)
  - [x] Add to **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json`, in the same change: `profile.country` (field label), `profile.countryPlaceholder` (unselected trigger text), `profile.countryUnset` (the explicit "not specified" option label).
  - [x] These are the **only** new keys. No country name is a key.
  - [x] The locale files are flat dotted-key JSON, not nested.
  - [x] The locale-parity suite (`apps/desktop/src/locales/__tests__/profile-i18n.test.ts` and siblings) **fails CI on any key present in one file only**. Both files must land together.
  - [x] Pending/ellipsis copy in this namespace uses the single-character ellipsis `…`, not three periods — the existing suite asserts this for `profile.loading`; match the convention if any new string needs one.
  - [x] Run `pnpm --filter @nixus/desktop test` and confirm the parity suite passes.

- [x] **Task 12 — Verify the no-network and no-dependency invariants** (AC: #2, #7, #8)
  - [x] `git diff` `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Cargo.lock`, `apps/desktop/package.json` (`dependencies`/`devDependencies`), and `pnpm-lock.yaml` — all must be free of dependency changes (NFR6). Only `package.json`'s `scripts` block changes.
  - [x] Grep the Rust diff for `reqwest`, `fetch`, and any URL literal: the runtime code must contain none. `NHTSA_BASE`-style constants belong to `catalog.rs` and must not be imitated here.
  - [x] Confirm the only network call in the whole change lives inside `scripts/generate-iso3166.mjs`, which never executes as part of `dev`, `build`, `tauri build`, or CI.
  - [x] `cargo build` and `cargo clippy` produce **zero** warnings; `pnpm --filter @nixus/desktop build` (i.e. `tsc && vite build`) produces zero warnings. `noUnusedLocals`/`noUnusedParameters` are on and warnings fail CI (project rule 9, `docs/guidelines/warnings.md`).
  - [x] Confirm no SQLite migration was added, `MIGRATIONS` is unchanged, `WIPE_TABLES`/`PRESERVED_TABLES` are unchanged, and no `insert_audit_log` call was added. This story touches no database at all.

## Dev Notes

### Dependency and sequencing

- **Depends on Story 28.2.** That story creates `src-tauri/src/profile_store.rs`, `src-tauri/src/commands/profile.rs`, `src-tauri/src/json_store.rs`, `src/hooks/useProfile.ts`, and `src/components/profile/ProfileForm.tsx`, and registers the profile commands in `lib.rs`. This story **extends** all of those files; it creates none of them. If any is missing, 28.2 has not landed and this story cannot start.
- **Does not depend on Story 29.2** (subdivision selector). 29.2 depends on this one. Do not build any part of 29.2 here — no `get_subdivisions` command, no `useSubdivisions` hook, no `queryKeys.subdivisions`, no subdivision `Select`, no `subdivision_code` cross-validation.
- **Not in scope:** Story 29.3's income bracket and currency, and Epic 30's TFSA accumulated-limit work.
- Epic 30 gates its TFSA display on `country_code == "CA"`, which is why capturing `country_code` here is what makes country-gated logic possible at all. It does not license building any of that logic in this story.

[Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)` — "29.1→28.2; 29.2→29.1"]

### Canonical source of record

> **Canonical source: the Debian `iso-codes` project, pinned to tag `v4.20.1`.** Retrieved **2026-08-11**.
>
> | Role | URL |
> | --- | --- |
> | ISO 3166-1, English | `https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/v4.20.1/data/iso_3166-1.json` |
> | ISO 3166-2, English | `https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/v4.20.1/data/iso_3166-2.json` |
> | ISO 3166-1, French | `https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/v4.20.1/iso_3166-1/fr.po` |
> | ISO 3166-2, French | `https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/v4.20.1/iso_3166-2/fr.po` |
>
> One source covering both parts with EN and FR, as the constraint below prefers. The URLs are pinned
> to a **release tag, not `main`**, so a regeneration a year from now against the same tag reproduces
> the same bytes; bumping `ISO_CODES_REF` in the script is the deliberate act that refreshes the data.
>
> **Transformations applied:**
>
> - `name_en` ← `iso_3166-1.json`'s `name` (the short display name, not `official_name`) and
>   `iso_3166-2.json`'s `name`.
> - `name_fr` ← the gettext `msgstr` of the catalogue entry whose extracted comment claims the
>   `Name for <CODE>` role — alpha-3 for countries, the ISO 3166-2 code for subdivisions. The join is
>   on the **code**, never on the English string. One comment line can merge several roles
>   (`#. Name for HUN, Official name for HUN`), so the parser splits comma-separated roles and accepts
>   the bare `Name for` role only; `Official name for` and `Common name for` are longer variants, not
>   display names.
> - `name_fr` is **omitted** when the `msgstr` is empty **or** the entry is `fuzzy`-flagged. A fuzzy
>   gettext translation is a machine guess copied from a similar string and in this catalogue they are
>   frequently plain wrong — `BW-FR` "Francistown" carries `msgstr "Francisco Morazán"`. Dropping them
>   is what keeps "do not fabricate a French name" literally true; those entries fall through to the
>   guaranteed-non-empty `name_en`.
> - Countries with no subdivisions omit the `subdivisions` key entirely (49 of 249).
>
> **Coverage achieved:** `name_en` 100% (249/249 countries, 5046/5046 subdivisions — the script exits
> non-zero rather than emit a blank). `name_fr` **100.0% of countries (249/249)** and **77.5% of
> subdivisions (3911/5046)**.


Constraints on the choice: a single source covering both ISO 3166-1 and ISO 3166-2 with EN and (partial) FR names is preferred over stitching two sources. FR coverage will be incomplete regardless — that is G6, and the EN fallback exists precisely for it. Do **not** add an npm package to obtain the data; fetch-and-transform inside the dev script using Node built-ins.

### Why this dataset is bundled and not fetched — and why `catalog.rs` is the wrong template

`apps/desktop/src-tauri/src/maintenance/catalog.rs` is the closest existing precedent for reference data in this codebase, and it does the **opposite** of what this story requires. It fetches from NHTSA over the network with a TTL cache:

```rust
pub const CATALOG_TTL_DAYS: i64 = 180;
pub const NHTSA_BASE: &str = "https://vpic.nhtsa.dot.gov/api/vehicles/";
pub const SCHEMA_VERSION: u32 = 1;
```

```rust
pub async fn fetch_makes_from_nhtsa() -> Result<Vec<VehicleMake>, AppError> {
    let url = format!("{NHTSA_BASE}GetMakesForVehicleType/car?format=json");
    let client = reqwest::Client::new();
```

```rust
fn is_cache_stale(meta: &CatalogMeta) -> bool {
    let ttl = Duration::days(meta.ttl_days);
    Utc::now() > cached_at + ttl
}
```

Read it for the *shape* of a reference-data module, then deliberately diverge. This story adds **no** `reqwest` call, **no** TTL, **no** `meta.json`, and **no** `spawn_background_catalog_refresh`. The reasons, all of which should survive review:

- **The data barely changes.** ~250 countries and ~5,000 subdivisions, a few hundred KB. ISO 3166 changes on the order of once a decade. A 180-day TTL would be a refresh cadence orders of magnitude faster than the data moves.
- **The auto-updater is already an adequate refresh channel.** Every release re-ships the embedded file, so the data refreshes exactly as often as the app does — which is far more often than ISO 3166 changes.
- **A cold cache on first offline run would be fatal here, unlike for vehicle makes.** `country_code` gates validation: with an empty catalog, `country_exists` returns `false` for everything and the user cannot fill the field at all. Vehicle makes degrade to "pick from nothing, type it yourself"; a validated enum degrades to "unfillable". AC #2 makes this an explicit requirement.
- **No good free API serves ISO 3166-2 subdivisions.** restcountries has countries but no subdivisions; GeoNames requires an account and rate-limits. An API-backed design would still have to bundle half the dataset, so it buys network risk for nothing.
- **NFR6 is preserved literally.** A checked-in generated data file plus a dev-only script is data and a script — not a runtime crate, not an npm package, not a build-time fetch.

**Explicit anti-pattern to not inherit from this file.** `catalog.rs` applies a `camelCase` rename that is a local exception and must not be copied onto the location or profile types:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleCatalogStatus {
    pub available: bool,
    pub cached_at: Option<String>,
    pub stale: bool,
}
```

`Country` and `Subdivision` use serde-default `snake_case`, matching the project-wide "JSON / IPC fields: snake_case" rule. An agent using `catalog.rs` as the template for this feature would plausibly inherit the rename; do not.

**Also do not reuse `catalog.rs::make_slug`** for anything in the profile feature — it is a many-to-one mapping and architecture Correction 1 rejects it for identity keys. Nothing in this story needs it.

[Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture` (D8); `#Format Patterns`; `#Corrections to Prior Decisions`]

### Dataset JSON schema — exact shape

`apps/desktop/src-tauri/data/iso3166.json`:

```json
{
  "_source": "<canonical ISO 3166 source recorded in Task 1>",
  "_source_retrieved_at": "2026-08-10",
  "_generated_by": "apps/desktop/scripts/generate-iso3166.mjs — dev-only; run `pnpm --filter @nixus/desktop generate:iso3166`. Never fetched at runtime, never wired into build or CI.",
  "countries": [
    {
      "code": "CA",
      "name_en": "Canada",
      "name_fr": "Canada",
      "subdivisions": [
        { "code": "CA-QC", "name_en": "Quebec", "name_fr": "Québec" },
        { "code": "CA-ON", "name_en": "Ontario" }
      ]
    },
    {
      "code": "JP",
      "name_en": "Japan",
      "name_fr": "Japon",
      "subdivisions": [{ "code": "JP-13", "name_en": "Tokyo" }]
    }
  ]
}
```

Field contract:

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `_source` | yes | string | Canonical source identifier. Human metadata; ignored by Rust. |
| `_source_retrieved_at` | yes | string | ISO 8601 `YYYY-MM-DD`. Human metadata; ignored by Rust. |
| `_generated_by` | yes | string | Script path plus the dev-only / never-at-runtime statement. Human metadata; ignored by Rust. |
| `countries` | yes | array | Sorted ascending by `code`. |
| `countries[].code` | yes | string | ISO 3166-1 **alpha-2**, uppercase (`"CA"`). This is the value stored in `country_code`. |
| `countries[].name_en` | **yes, non-empty** | string | Guaranteed by the generation script, which fails rather than emit a blank. |
| `countries[].name_fr` | no | string | **Omitted entirely** when unavailable — never `null`, never `""`. |
| `countries[].subdivisions` | no | array | Omitted entirely when the country has none. Sorted ascending by `code`. |
| `subdivisions[].code` | yes | string | ISO 3166-2 (`"CA-QC"`). |
| `subdivisions[].name_en` | **yes, non-empty** | string | Same guarantee as country `name_en`. |
| `subdivisions[].name_fr` | no | string | Same omission rule. |

The three `_`-prefixed keys are the "comment header" required by Task 1 — JSON has no comment syntax, and serde ignores unknown fields by default, so they are free on the Rust side. **Do not model them in `Iso3166Dataset`**: an unread struct field is a dead-code warning, and project rule 9 plus `docs/guidelines/warnings.md` make warnings a CI failure.

The nesting is deliberate: subdivisions live under their country so that Story 29.2's `get_subdivisions(country_code)` is an index lookup rather than a filter over a flat 5,000-row list. It also means the IPC model and the file model differ — `Country` carries no `subdivisions` field, so `get_countries` never ships 5,000 rows to populate a 250-row select (architecture Correction 2's whole reason for existing).

[Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns`; `#Gap Analysis Results` (G6)]

### Rust model derive conventions

From `apps/desktop/src-tauri/src/models/mod.rs` — every model uses the identical derive and `snake_case` fields:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetGroup {
    pub id: i64,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBudgetCategory {
    pub group_id: i64,
    pub name: String,
    pub target_cents: i64,
}
```

Add, in the same file and with the same derive, no extra serde attributes:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Country {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subdivision {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountryEntry {
    pub code: String,
    pub name_en: String,
    pub name_fr: Option<String>,
    #[serde(default)]
    pub subdivisions: Vec<Subdivision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Iso3166Dataset {
    pub countries: Vec<CountryEntry>,
}
```

`#[serde(default)]` on `subdivisions` is what lets the file omit the key for subdivision-less countries. `name_fr: Option<String>` plus an omitted key deserializes to `None` — that is the G6 gap, handled by fallback rather than by forcing a translation that does not exist.

[Source: `docs/project-context.md#4. Rust Model Structs`]

### Dataset loading — `OnceLock`, not per-call parse

Shape to implement in `profile_store.rs`:

```rust
use std::sync::OnceLock;

use crate::models::{Country, Iso3166Dataset};

const ISO3166_JSON: &str = include_str!("../data/iso3166.json");
static ISO3166: OnceLock<Iso3166Dataset> = OnceLock::new();

pub(crate) fn dataset() -> &'static Iso3166Dataset {
    ISO3166.get_or_init(|| {
        serde_json::from_str(ISO3166_JSON).unwrap_or_else(|e| {
            // The file is checked in and embedded at compile time, so this is unreachable in a
            // shipped binary; an empty dataset keeps the process alive instead of panicking.
            tracing::error!("Failed to parse bundled iso3166.json: {}", e);
            Iso3166Dataset { countries: Vec::new() }
        })
    })
}
```

`include_str!` resolves relative to the **source file**, so from `src/profile_store.rs` the path is `"../data/iso3166.json"` → `src-tauri/data/iso3166.json`. Getting this path wrong is a compile error, which is the desired failure mode.

`get_or_init` takes an infallible closure, so a `Result` cannot be returned from it. `unwrap_or_else` with a `tracing::error!` and an empty dataset is the correct discharge: no `.unwrap()`, no `.expect()`, no panic (project rule: `?` propagation with `AppError`, `.unwrap()` only in tests).

`countries()` maps to the IPC model and drops `subdivisions`:

```rust
pub(crate) fn countries() -> Vec<Country> {
    dataset()
        .countries
        .iter()
        .map(|c| Country {
            code: c.code.clone(),
            name_en: c.name_en.clone(),
            name_fr: c.name_fr.clone(),
        })
        .collect()
}

pub(crate) fn country_exists(code: &str) -> bool {
    dataset().countries.iter().any(|c| c.code == code)
}
```

[Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns` — "embedded with `include_str!` and parsed once into a `std::sync::OnceLock`. Parsing a few hundred KB on every `get_countries` call is avoidable and would be a plausible agent mistake."]

### Validation style to mirror

`apps/desktop/src-tauri/src/db/account.rs` is the allow-list validation precedent `profile_store.rs` must follow — a module-level `const` slice plus a `contains` check returning a field-scoped `AppError::Validation`:

```rust
const VALID_ACCOUNT_TYPES: &[&str] = &[
    "chequing",
    "savings",
    "credit_card",
    "tfsa",
    "rrsp",
    "fhsa",
    "non_registered",
    "crypto",
];

const VALID_CURRENCIES: &[&str] = &["CAD", "USD"];
```

```rust
pub fn insert_account(conn: &Connection, input: &CreateAccountInput) -> Result<Account, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Account name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid account type: {}", input.account_type),
            field: Some("account_type".to_string()),
        });
    }

    if !VALID_CURRENCIES.contains(&input.currency.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid currency: {}", input.currency),
            field: Some("currency".to_string()),
        });
    }
```

The country check is the same pattern with the dataset standing in for the `const` slice — a `&[&str]` of 250 codes would be a second copy of data the binary already embeds:

```rust
if let Some(code) = input.country_code.as_deref() {
    if !country_exists(code) {
        return Err(AppError::Validation {
            message: format!("Invalid country code: {code}"),
            field: Some("country_code".to_string()),
        });
    }
}
```

Note `field: Some("country_code")` matches the form field name exactly — form field names are the `snake_case` IPC names, so `setError(field)` needs no translation table. No new `AppError` variant: `Validation { message, field }` already exists and must be reused.

[Source: `apps/desktop/src-tauri/src/db/account.rs`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Process Patterns`, `#Authentication & Security` (D13)]

### Command shape and registration

`apps/desktop/src-tauri/src/commands/account.rs` shows the convention — flat scalar arguments, the `rename_all` attribute on every command, `Result<T, AppError>`, and thin orchestration:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_accounts(state: State<DbState>) -> Result<Vec<Account>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    account_db::get_all_accounts(&conn)
}
```

`get_countries` is the same shape minus the state lock — no `DbState`, no `AppHandle`, no `async`:

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_countries() -> Result<Vec<Country>, AppError> {
    Ok(crate::profile_store::countries())
}
```

It returns `Result` even though it cannot currently fail, because every command in this codebase returns `Result<T, AppError>` and Story 29.2's `get_subdivisions` genuinely can fail. Consistency over micro-optimisation.

Registration in `apps/desktop/src-tauri/src/lib.rs` follows the existing flat list inside `tauri::generate_handler![...]`:

```rust
        .invoke_handler(tauri::generate_handler![
            ...
            commands::account::create_account,
            commands::account::get_accounts,
            ...
            commands::maintenance::get_vehicle_makes,
            commands::maintenance::get_vehicle_models,
```

Add `commands::profile::get_countries` next to the profile commands registered by Story 28.2. Module declarations sit at the top of the same file:

```rust
mod ai;
mod budget;
mod commands;
mod credentials;
mod db;
mod error;
mod financial_health;
mod maintenance;
mod models;
```

`mod profile_store;` is added there by Story 28.2 — verify it is present rather than adding a duplicate.

[Source: `apps/desktop/src-tauri/src/commands/account.rs`; `apps/desktop/src-tauri/src/lib.rs`; `docs/project-context.md#2. Tauri IPC Commands`]

### The shared `Select` primitive — use it, do not rebuild it

`packages/shared/src/ui/select.tsx` exports `Select`, `SelectContent`, `SelectGroup`, `SelectGroupLabel`, `SelectItem`, `SelectTrigger`, `SelectValue`, built on `@base-ui/react/select`:

```tsx
import { Select as SelectPrimitive } from "@base-ui/react/select"

function Select<Value>({ ...props }: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item data-slot="select-item" className={cn(..., className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center text-brand-ink">
        <CheckIcon className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}
```

The `SelectContent` popup is already scroll-capped (`max-h-[min(var(--available-height),16rem)] ... overflow-y-auto`), so a 250-item country list needs no new scroll container.

Real usage to copy — the account-type and currency selects in `apps/desktop/src/components/accounts/AddAccountForm.tsx`. Note the `Controller` wrapper, the `items` prop fed the same array the children map over, and the i18n-resolved labels built in the component body:

```tsx
import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";

const CURRENCY_VALUES = [
  { value: "CAD", key: "accounts.currencyCAD" },
  { value: "USD", key: "accounts.currencyUSD" },
];

export function AddAccountForm({ onClose }: AddAccountFormProps) {
  const { t } = useTranslation();
  const CURRENCY_OPTIONS = CURRENCY_VALUES.map((o) => ({
    value: o.value,
    label: t(o.key),
  }));
```

```tsx
      <div className="space-y-1.5">
        <Label htmlFor="account-currency">{t("common.currency")}</Label>
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={CURRENCY_OPTIONS}
            >
              <SelectTrigger id="account-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
```

The country field is structurally identical, with two differences: the option array comes from `useCountries()` rather than a local `const`, and the label comes from the dataset rather than `t()`:

```tsx
const { i18n, t } = useTranslation();
const { data: countries } = useCountries();

const COUNTRY_OPTIONS = useMemo(() => {
  const collator = new Intl.Collator(i18n.language);
  const options = (countries ?? []).map((c) => ({
    value: c.code,
    // G6: FR coverage is incomplete by design; EN is the guaranteed non-empty field.
    label: i18n.language.startsWith("fr") ? (c.name_fr ?? c.name_en) : c.name_en,
  }));
  options.sort((a, b) => collator.compare(a.label, b.label));
  return [{ value: "", label: t("profile.countryUnset") }, ...options];
}, [countries, i18n.language, t]);
```

The `""` sentinel exists only inside the control; map it to `null` on submit. `""` is never a stored value — absent is `null`, with exactly one representation.

[Source: `packages/shared/src/ui/select.tsx`; `apps/desktop/src/components/accounts/AddAccountForm.tsx`; `docs/project-context.md#8. Shared UI Components`]

### Hook conventions

`apps/desktop/src/hooks/useAccounts.ts` is the convention: `queryKeys` imported from `@/lib/constants`, `invoke<T>` typed with the mirrored IPC type, one file per feature exporting several hooks:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import type { Account, CreateAccountInput } from "@/lib/types";

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => invoke<Account[]>("get_accounts"),
  });
}
```

`apps/desktop/src/hooks/useAiConfig.ts` shows the pattern **not** to copy — it hardcodes its key:

```typescript
export function useAiConfig() {
  return useQuery({
    queryKey: ["ai-config"],
    queryFn: () => invoke<AiConfig>("get_ai_config"),
  });
}
```

That is a pre-existing outlier; project rule 6 requires all keys in `queryKeys`. `useCountries` must import from `queryKeys`, not inline the array.

Target:

```typescript
export function useCountries() {
  return useQuery({
    queryKey: queryKeys.countries,
    queryFn: () => invoke<Country[]>("get_countries"),
    // The dataset is embedded in the binary and cannot change while the app is running.
    staleTime: Infinity,
  });
}
```

[Source: `apps/desktop/src/hooks/useAccounts.ts`; `apps/desktop/src/hooks/useAiConfig.ts`; `docs/project-context.md#6. TanStack Query Keys`]

### Query key shape

`apps/desktop/src/lib/constants.ts` — flat, top-level, kebab-case string arrays, with `auth` as the single nested outlier:

```typescript
export const queryKeys = {
  budgetGroups: ["budget-groups"] as const,
  ...
  accounts: ["accounts"] as const,
  assets: ["assets"] as const,
  ...
  vehicleCatalog: ["vehicle-catalog"] as const,
  vehicleMakes: ["vehicle-catalog", "makes"] as const,
  financialHealth: ["financial-health"] as const,
  auth: {
    session: ["auth", "session"] as const,
  },
};
```

Add `countries: ["countries"] as const` as a top-level entry. Do not nest it under a `location` or `profile` object — the dominant convention is flat, and `auth.session` is the exception, not the model.

[Source: `apps/desktop/src/lib/constants.ts`]

### `package.json` — exactly where the script entry goes

`apps/desktop/package.json` currently:

```json
{
  "name": "@nixus/desktop",
  "private": true,
  "version": "0.3.2",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
```

`generate:iso3166` goes in as the last entry of `scripts`, after `test:watch`. `"type": "module"` is already set, so the `.mjs` extension is belt-and-braces rather than required — keep it anyway, matching the architecture's named path.

`apps/desktop/scripts/` **does not exist** (`ls apps/desktop/scripts` → "No such file or directory"). Task 1 creates it; this is the first script in the desktop app.

Do not touch `version` — this story is not a release and the three-file version-bump rule does not apply.

[Source: `apps/desktop/package.json`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns`]

### i18n keys — field labels only

New keys, added to **both** `apps/desktop/src/locales/en.json` and `apps/desktop/src/locales/fr.json` in the same change:

| Key | EN | FR |
| --- | --- | --- |
| `profile.country` | Country | Pays |
| `profile.countryPlaceholder` | Select a country | Sélectionner un pays |
| `profile.countryUnset` | Not specified | Non spécifié |

That is the complete list. **No country name is a translation key** — names come from the dataset's `name_en` / `name_fr`, per NFR5. Roughly 250 hand-written country translations (and 5,000 subdivisions in 29.2) are untenable, which is the entire reason the dataset carries display names.

The existing `profile.*` namespace already holds `profile.signIn`, `profile.accountMenu`, `profile.loading`, `profile.signedInAs`, `profile.signOut`, `profile.sessionExpired`, `profile.sessionExpiredAction`. Extend it; do not introduce a second namespace such as `userProfile.*` or `location.*`.

Locale files are **flat dotted-key JSON**, not nested. The parity suite at `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` enumerates `profile.`-prefixed keys across both files and fails CI on a one-sided key — a French-only or English-only addition breaks the build, so both files land together. Ellipsis copy in this namespace uses `…`, not `...` (the suite asserts it for `profile.loading`).

[Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts`; `_bmad-output/planning-artifacts/architecture-user-profile.md#Technical Constraints & Dependencies`]

### Explicit invariants — each is a task above, not a suggestion

1. **No runtime network call.** No `reqwest`, no `fetch`, no URL literal anywhere in the shipped code path. The only network access in this change is inside `scripts/generate-iso3166.mjs`.
2. **No new dependency.** Zero Rust crates, zero npm packages, dev or otherwise (NFR6). `Cargo.toml`, `Cargo.lock`, `package.json`'s dependency blocks, and `pnpm-lock.yaml` are all unchanged.
3. **One copy of the dataset, in the Rust binary.** The frontend imports no JSON, hardcodes no country array, generates no TS module. Two copies would drift and Rust is the validation authority.
4. **Rust is the validation authority.** The frontend's select is an affordance; `profile_store.rs` re-validates and rejects anything not in the dataset.
5. **`get_location_catalog` does not exist.** Superseded by Correction 2. Do not implement it, do not name anything after it.
6. **`get_countries` is not session-gated.** No `current_subject()` call. The ISO list is not user data.
7. **The generation script is dev-only.** Never a build step, never in CI, never invoked by the app.
8. **`name_en` is always non-empty; the UI always falls back to it.** No option ever renders blank in French (G6).
9. **No SQLite anything.** No migration, no table, no `db/` module, no `insert_audit_log`, no `WIPE_TABLES` change.
10. **No 29.2 / 29.3 / Epic 30 scope.** No subdivision selector, no income bracket, no TFSA.
11. **Zero compilation warnings**, Rust and TypeScript (project rule 9, `docs/guidelines/warnings.md`).

### Testing standards summary

- **Rust unit tests** live inline in `#[cfg(test)] mod tests` inside `profile_store.rs`, using `tempfile` for the profiles directory, matching the pattern Story 28.2 established from `db/backup.rs`. Required cases: valid country code round-trips; unknown code rejected as `AppError::Validation` with `field == Some("country_code")`; `std::ptr::eq(dataset(), dataset())` proving the `OnceLock` initializes once; dataset non-empty with every `name_en` non-empty.
- `.unwrap()` is permitted in tests only.
- **No new Playwright spec is required by this story.** Story 28.2 adds `apps/desktop/tests/profile.spec.ts`; extend its Tauri mock switch with a `get_countries` case returning a small fixture array so the profile page renders the field. Because `ProfileMenu` still performs no `invoke`, **no other existing spec's mock needs a `get_countries` case** — the trap at `docs/project-context.md:295` stays sidestepped. Verify this rather than assume it.
- **Locale parity** is covered automatically by the existing `src/locales/__tests__/` suite. Run `pnpm --filter @nixus/desktop test`.
- Desktop E2E runs against the plain Vite dev server (port 1420) with `window.__TAURI_INTERNALS__.invoke` stubbed per-spec — there is no real IPC layer in that suite, so `get_countries` must be stubbed, not exercised.
- Regression: run `cargo test` (the `catalog.rs` tests must still pass — this story does not touch that file) and the full Playwright suite.

### Project Structure Notes

**Files created:**

| Path | Purpose |
| --- | --- |
| `apps/desktop/src-tauri/data/iso3166.json` | Generated, checked-in ISO 3166-1/-2 dataset with EN + partial FR names. Embedded via `include_str!`. |
| `apps/desktop/scripts/generate-iso3166.mjs` | Dev-only regeneration script. First file in a new `apps/desktop/scripts/` directory. |

**Files modified:**

| Path | Change |
| --- | --- |
| `apps/desktop/package.json` | `+ "generate:iso3166"` in `scripts` only. No dependency change. |
| `apps/desktop/src-tauri/src/models/mod.rs` | `+ Country`, `Subdivision`, `CountryEntry`, `Iso3166Dataset`. |
| `apps/desktop/src-tauri/src/profile_store.rs` | `+ include_str!` const, `OnceLock`, `dataset()`, `countries()`, `country_exists()`, `country_code` validation, tests. |
| `apps/desktop/src-tauri/src/commands/profile.rs` | `+ get_countries` (sync, not session-gated). |
| `apps/desktop/src-tauri/src/lib.rs` | `+ commands::profile::get_countries` in `generate_handler!`. |
| `apps/desktop/src/lib/types.ts` | `+ Country`, `Subdivision`. |
| `apps/desktop/src/lib/constants.ts` | `+ queryKeys.countries`. |
| `apps/desktop/src/hooks/useProfile.ts` | `+ useCountries` with `staleTime: Infinity`. |
| `apps/desktop/src/components/profile/ProfileForm.tsx` | `+ country_code` `Select` field with FR→EN label fallback. |
| `apps/desktop/src/locales/en.json` | `+ 3` `profile.*` keys. |
| `apps/desktop/src/locales/fr.json` | Same 3 keys, FR values. |
| `apps/desktop/tests/profile.spec.ts` | `+ get_countries` case in the existing spec's Tauri mock. |

**Not touched, deliberately:** `src-tauri/Cargo.toml`, `Cargo.lock`, `pnpm-lock.yaml`, `src-tauri/migrations/`, `db/mod.rs` (`MIGRATIONS`), `db/danger_zone.rs`, `db/backup.rs`, `db/audit.rs`, `maintenance/catalog.rs`, `credentials.rs`, `error.rs`, `json_store.rs`, `packages/shared/src/ui/*`, `components/auth/ProfileMenu.tsx`, `routes/profile.tsx`, `lib/navigation.ts`, `AppSidebar.tsx`, `DestinationNav.tsx`, `tauri.conf.json`, and every existing `tests/*.spec.ts` other than `profile.spec.ts`.

**Where the dataset loader lives — a decision the architecture leaves open.** The architecture mandates `include_str!` + `OnceLock` and states that `country_code` validation lives in `profile_store.rs`, but never names the module hosting the `OnceLock`. Two agents would plausibly differ, so this story fixes it: **the loader lives in `profile_store.rs`**, exposed as `pub(crate) fn dataset()`, `countries()`, and `country_exists()`. Rationale — `profile_store.rs` must read the dataset anyway to validate, it is already in the architecture's delta tree, and `commands/profile.rs` calling `profile_store::countries()` preserves the "commands orchestrate only, the store owns validation" separation that project rule 3 mandates. **Rejected:** a new `src-tauri/src/iso3166.rs` module — it would add a module the delta tree does not list, and split the dataset away from its only consumer that has a correctness requirement on it.

**One new organizational element beyond the delta tree:** none. `src-tauri/data/` and `apps/desktop/scripts/` are both explicitly listed in the architecture's delta tree; they simply do not exist on disk yet.

**Variance from `catalog.rs`, stated rather than silent.** This story's reference-data module intentionally diverges from the only existing reference-data precedent (fetch + TTL + `meta.json` + `camelCase` serde). The rationale is recorded in Dev Notes above so a reviewer sees a decision, not an oversight.

### References

- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Story 29.1: Tell Nixus which country I live in` — acceptance criteria, copied faithfully]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory` — FR2, FR5; NFR5 (EN/FR with EN fallback), NFR6 (zero new dependencies)]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements` — bundled dataset, `include_str!` + `OnceLock`, dev-only `generate:iso3166`, Rust as validation authority, no second frontend copy, no SQLite work, no new `AppError` variant, serde casing, testing and regression obligations]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Validation Notes (step-04)` — forward-dependency check: `29.1→28.2`, `29.2→29.1`; Epic 30 consumes `country_code` from 29.1]
- [Source: `_bmad-output/planning-artifacts/epics-user-profile.md#Epic 29: Location & Income Context` — "Country selection works worldwide and entirely offline"]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture` — D8: `country_code` + `subdivision_code` from a bundled ISO 3166 dataset; why a checked-in file rather than a runtime API; display names from the dataset, not i18n keys]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Corrections to Prior Decisions` — Correction 2: `get_location_catalog` is replaced by `get_countries` / `get_subdivisions` and is **not** implemented; Correction 1: never slug an identity key]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Gap Analysis Results` — G6: FR subdivision/country names will be incomplete; `name_en` required, `name_fr` optional, EN fallback in the UI, script must guarantee `name_en`]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Structure Patterns` — dataset at `src-tauri/data/iso3166.json`; single source of truth; regeneration script path and `generate:iso3166` entry]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Format Patterns` — serde-default `snake_case`; `catalog.rs`'s `camelCase` is a local exception that must not be copied; absent values are `null`, never `""`]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Communication Patterns` — `useCountries` / `useSubdivisions` use `staleTime: Infinity`]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Enforcement Guidelines` — dataset in the Rust binary only; no new crate or npm package; every i18n key in both locale files]
- [Source: `_bmad-output/planning-artifacts/architecture-user-profile.md#Development Workflow Integration` — `include_str!` pulls the dataset in at compile time; regeneration never wired into build or CI]
- [Source: `docs/project-context.md#2. Tauri IPC Commands` — `rename_all = "snake_case"`, `Result<T, AppError>`, register in `lib.rs`]
- [Source: `docs/project-context.md#3. Database Operations Belong in db/ Only` — commands orchestrate; validation and data access belong in the lower layer]
- [Source: `docs/project-context.md#4. Rust Model Structs` — exact derive, `snake_case` fields, models in `models/mod.rs`]
- [Source: `docs/project-context.md#5. Error Handling (AppError)` — reuse `AppError`; never create ad-hoc error types]
- [Source: `docs/project-context.md#6. TanStack Query Keys` — all keys in `lib/constants.ts`]
- [Source: `docs/project-context.md#8. Shared UI Components` — check `@nixus/shared/ui` first; never duplicate an existing primitive]
- [Source: `docs/project-context.md#9. Compilation Warnings Policy` and `docs/guidelines/warnings.md` — zero warnings, Rust and TypeScript]
- [Source: `docs/project-context.md#Testing Rules` — desktop E2E stubs `invoke` per-spec; the always-mounted-component mock trap at line 295]
- [Source: `apps/desktop/src-tauri/src/maintenance/catalog.rs` — fetch + TTL reference-data precedent this story deliberately diverges from; the `camelCase` anti-pattern; `make_slug`]
- [Source: `apps/desktop/src-tauri/src/db/account.rs` — allow-list validation style with field-scoped `AppError::Validation`]
- [Source: `apps/desktop/src-tauri/src/commands/account.rs` — command shape and thin orchestration]
- [Source: `apps/desktop/src-tauri/src/lib.rs` — module declarations and `tauri::generate_handler!` registration]
- [Source: `apps/desktop/src-tauri/src/models/mod.rs` — model derive conventions]
- [Source: `packages/shared/src/ui/select.tsx` — the `Select` primitive the country field must use]
- [Source: `apps/desktop/src/components/accounts/AddAccountForm.tsx` — real `Controller` + `Select` usage for account type and currency]
- [Source: `apps/desktop/src/hooks/useAccounts.ts`, `apps/desktop/src/hooks/useAiConfig.ts` — hook conventions, and the hardcoded-key outlier not to copy]
- [Source: `apps/desktop/src/lib/constants.ts` — `queryKeys` shape, flat and top-level]
- [Source: `apps/desktop/package.json` — `scripts` block; `apps/desktop/scripts/` does not yet exist]
- [Source: `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — locale-parity suite that fails CI on one-sided keys]
- [Source: `_bmad-output/implementation-artifacts/28-2-record-my-name-so-its-remembered-next-time.md` — creates `profile_store.rs`, `commands/profile.rs`, `useProfile.ts`, `ProfileForm.tsx`, and `tests/profile.spec.ts` that this story extends]

## Dev Agent Record

### Agent Model Used

`amazon-bedrock/us.anthropic.claude-opus-5`

### Debug Log References

- `node scripts/generate-iso3166.mjs` — first run produced 96.8% country FR coverage. Root cause: the
  `.po` extracted comment can merge roles for one shared `msgstr` (`#. Name for HUN, Official name for
  HUN`), which a `^#\. Name for (\S+)$` anchor misses. Parsing comma-separated roles instead lifted
  country coverage to 100.0% and subdivision coverage from 72.6% to 77.5%.
- Determinism confirmed by regenerating over the committed file and diffing: byte-identical.
- `playwright test` full run: 371 passed, 1 failed —
  `maintenance.spec.ts › Maintenance Interval Editing › customizing task on vehicle A does not change
  vehicle B same task type`, on a `vehicle-slide-over` visibility timeout inside the `createVehicle`
  helper. Re-run in isolation: passed in 4.8s. A pre-existing load flake in a spec this story does not
  touch, not a regression.

### Completion Notes List

- **Dataset.** `apps/desktop/src-tauri/data/iso3166.json` — **582,705 bytes (569 KiB), 25,748 lines,
  249 countries, 5,046 subdivisions**. `name_en` coverage 100% (enforced: the script exits non-zero
  and writes nothing rather than emit a blank). `name_fr` coverage **100.0% of countries** and
  **77.5% of subdivisions**; the 1,135 subdivisions without a French name fall through to `name_en` in
  the UI, which is G6 working as designed rather than a defect. No `null` and no `""` `name_fr` value
  exists in the file — the key is omitted.
- **Binary size, reported not silently optimised.** The `include_str!` payload is 569 KiB of static
  UTF-8 in `.rodata`, against an installer already in the tens of MB. Not compressed, not sharded, not
  trimmed: an offline-available validated enum is the requirement (AC #2), and 569 KiB is the honest
  price. Countries and subdivisions ship in one file because Story 29.2's `get_subdivisions` needs the
  nesting; `get_countries` still crosses IPC with 249 rows, never 5,046, because `Country` has no
  `subdivisions` field (architecture Correction 2).
- **Source pinned to a tag, not a branch.** `ISO_CODES_REF = "v4.20.1"`. Regeneration against the same
  tag is byte-reproducible; refreshing the data is an explicit `ISO_CODES_REF` bump in a reviewable
  commit.
- **Fuzzy French translations dropped.** 746 `fuzzy` entries in `iso_3166-2/fr.po` are machine guesses
  copied from similar strings and are frequently wrong (`BW-FR` "Francistown" → `msgstr "Francisco
  Morazán"`). Skipping them is what makes "never fabricate a French name" literally true.
- **`get_countries` is synchronous and deliberately not session-gated** — no `current_subject()` call.
  The asymmetry against every other command in `commands/profile.rs` is intentional and commented at
  the call site. `get_location_catalog` was not implemented and does not exist.
- **Validation is normalize-then-check.** `country_code` is normalized before validation, so `"   "`
  clears the field rather than being rejected as an unknown code; `None` is valid. Unknown codes fail
  as `AppError::Validation { field: Some("country_code") }`, reusing the existing variant — no new
  `AppError` variant, no `subdivision_code` cross-validation (that is 29.2).
- **`profile.countryPlaceholder` and `profile.countryUnset` are semantically distinct**, not
  duplicates: the unset control value is `null` (no matching `items` entry), so the trigger renders the
  *placeholder* when nothing is chosen, while `countryUnset` is the explicit dropdown option that
  clears the field back to `null`. The trigger is therefore never blank. The form-local `""` sentinel
  converts to `null` at submit — absent has exactly one stored representation.
- **Test-file edits are additive.** `profile-i18n.test.ts`'s `REQUIRED_KEYS` gained the three new keys
  (its `declares every profile key it ships` assertion is exact-match, so a new key must be declared).
  `profile.spec.ts`'s `FUTURE_PROFILE_COMMANDS` dropped `get_countries`, which this story now ships,
  and kept `get_subdivisions`. No assertion was weakened or removed.
- **No other spec needed a `get_countries` case.** `ProfileForm` is the only consumer and it mounts
  only behind the `/profile` route; `profile.spec.ts` is the only spec that navigates there (verified
  by grep, not assumed), so the always-mounted-component mock trap at `project-context.md:295` stays
  sidestepped.
- **Invariants verified.** `Cargo.toml`, `Cargo.lock`, and `pnpm-lock.yaml` are byte-unchanged;
  `package.json` changed in its `scripts` block only. No `reqwest`, no `fetch`, and no URL literal in
  any Rust file this story touched. `generate:iso3166` is referenced from nowhere but the `scripts`
  block and the dataset's own metadata header — no `.github/` workflow, no lifecycle hook. No
  migration, no `MIGRATIONS`/`WIPE_TABLES` change, no `insert_audit_log` call, no `db/` edit.

**Verification output**

| Gate | Baseline | Result |
| --- | --- | --- |
| `cargo test` | 385 passed, 0 failed | **391 passed, 0 failed** (+6 new) |
| `cargo clippy --all-targets` | 1 warning (`commands/backup.rs:106`) | **1 warning, same one** — no new warning |
| `tsc --noEmit` | clean | **clean, exit 0** |
| `pnpm test` (vitest) | 168 passed | **171 passed** (+3 locale-parity cases) |
| `playwright test` | 366 passed | **371 passed, 1 pre-existing `maintenance.spec.ts` flake** that passes in isolation (372 total, +6 new) |
| `pnpm build` | chunk-size advisory | same pre-existing JS chunk advisory; zero TS warnings |

### File List

**Created**

- `apps/desktop/scripts/generate-iso3166.mjs`
- `apps/desktop/src-tauri/data/iso3166.json`

**Modified**

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/src/models/mod.rs`
- `apps/desktop/src-tauri/src/profile_store.rs`
- `apps/desktop/src-tauri/src/commands/profile.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/lib/types.ts`
- `apps/desktop/src/lib/constants.ts`
- `apps/desktop/src/hooks/useProfile.ts`
- `apps/desktop/src/components/profile/ProfileForm.tsx`
- `apps/desktop/src/locales/en.json`
- `apps/desktop/src/locales/fr.json`
- `apps/desktop/src/locales/__tests__/profile-i18n.test.ts`
- `apps/desktop/tests/profile.spec.ts`
- `_bmad-output/implementation-artifacts/29-1-tell-nixus-which-country-i-live-in.md`

