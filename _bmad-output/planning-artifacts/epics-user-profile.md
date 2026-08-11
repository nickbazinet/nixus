---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
requirementsConfirmed: true
epicsApproved: true
storiesApproved: true
validated: true
inputDocuments:
  - architecture-user-profile.md
  - architecture-login.md
  - architecture-credentials.md
  - docs/project-context.md
  - epics-login.md
scope: user-profile
parentDocument: architecture-desktop.md
---

# nixus - User Profile Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the nixus User Profile feature, decomposing the requirements embedded in `architecture-user-profile.md` into implementable stories. Scoped addendum — parent epics live in `epics.md`; this file follows the same pattern as `epics-login.md`, `epics-car-maintenance.md`, and `epics-budget-templates.md`.

**No PRD exists for this feature and none is planned.** `architecture-user-profile.md` carries a confirmed working brief plus its own numbered FR1–FR8 / NFR1–NFR8 set (see its "Project Context Analysis" section), and that set is the authoritative requirements source used below. **These identifiers are user-profile-scoped**: they are local to `architecture-user-profile.md` and are _not_ the global PRD's FR/NFR numbers (which cover budget management). Wherever this document says "FR2" it means "user-profile FR2".

**FR9, FR10, and NFR9 originate in this document, not in the architecture.** During epic planning the product decision was taken to pull one downstream consumer of profile data into scope — the TFSA cumulative-limit display — so that the feature delivers visible user value on release rather than collecting data with no payoff. `architecture-user-profile.md` states that FR5 consumers are "not implemented in this pass"; that statement is amended by this document. See the Documentation Obligations section.

**No UX design specification exists for this feature.** `ux-design-specification.md` predates it and contains no UX-DRs for a profile route, profile form, or the TFSA display. UX decisions already fixed in `architecture-user-profile.md` (dropdown entry point, dedicated `/profile` route, four-way session guard, no avatar primitive) are carried into acceptance criteria verbatim. Form layout, field grouping, and empty-state copy are **not specified anywhere** and are flagged for decision inside the relevant story rather than invented here.

**Epic numbering starts at 28.** Existing epics run through 27 (`epic-27: done` in `sprint-status.yaml`).

## Requirements Inventory

### Functional Requirements

- FR1: A signed-in user opens the top-right account dropdown (existing `ProfileMenu`) and selects a new "Profile" item to reach a Profile surface.
- FR2: User views and edits profile fields: first name, last name, date of birth, estimated yearly income bracket (with the currency it is expressed in), country, and subdivision (state/province/region). Email is displayed read-only, sourced from the Cognito `id_token`.
- FR3: Profile data persists locally, scoped to the authenticated Cognito `sub`, and survives app restart.
- FR4: Profile requires authentication. When no session exists, the Profile entry point is not shown and no profile data is readable. Signing out and signing in as a different account surfaces that account's own profile — never the previous one's.
- FR5: Profile data is available to other modules as a first-class domain read. Consumers MUST degrade gracefully when no session or no profile exists, and Canada-specific logic MUST gate on `country_code == "CA"`.
- FR6: Cloud sync is out of scope for this pass. The `sub`-keyed JSON document is already sync-shaped, so no destructive migration is required to add it later.
- FR7: The signed-out authentication affordance is relabelled to "Sign In with Nixus Cloud" (`profile.signIn`), and the account-prompt dialog's primary action aligns with the same brand term (`auth.createAccount`).
- FR8: Copy must remain literally accurate for the current state: an account authenticates the user; no profile or financial data is transmitted.
- FR9: When `country_code == "CA"` and `birth_date` is set, the profile surface displays the user's cumulative lifetime TFSA contribution limit, computed from date of birth. It is explicitly labelled as accumulated limit — **not** remaining room — with a note that contributions and withdrawals are not tracked.
- FR10: The TFSA calculation degrades gracefully: no date of birth, no country, a non-CA country, or a current year beyond the known-limits table → the figure is not displayed and nothing errors.

### NonFunctional Requirements

- NFR1: Local-first preserved for the _app_, not for this feature. Profile is the first intentionally account-gated surface in nixus. No existing functionality regresses for offline/no-account users — they simply have no profile.
- NFR2: No profile data leaves the machine. The README claim "your data never leaves your machine" remains literally true after this feature ships.
- NFR3: Account isolation — a profile document is reachable only via the currently authenticated `sub`. No code path may read a profile without an active session.
- NFR4: Sensitive-data lifecycle — no profile PII survives the danger-zone delete-all path, including `.corrupt` and `.tmp` leftovers.
- NFR5: EN/FR i18n for all field labels and income bracket values. Country and subdivision display names come from the bundled ISO 3166 dataset's EN/FR fields, with EN fallback where FR is absent.
- NFR6: Zero new external dependencies, Rust or npm. Checked-in generated data files plus dev-only regeneration scripts satisfy this — they are data and scripts, not runtime or build dependencies.
- NFR7: Multi-account PII residency — profiles for previously signed-in accounts remain on the device by deliberate decision (D6), because there is no cloud copy to restore from.
- NFR8: Brand-term consistency — "Nixus Cloud" is untranslated in FR ("Se connecter avec Nixus Cloud"). The term is reserved for all future networked features; no synonym ("Nixus Sync", "Nixus Account", "Nixus Online") may be introduced elsewhere in desktop, web, or Cognito Managed Login branding.
- NFR9: The annual TFSA limits table declares the last year it covers. Behaviour past that boundary is defined and non-guessing (the figure is withheld, not extrapolated), and the table is refreshed via app release like the ISO dataset.
- Inherited: all user-facing strings available in English and French with no missing translation keys in shipped views (platform-wide i18n rule from `docs/project-context.md`).

### Additional Requirements

- **Not a greenfield starter:** extend the existing Tauri 2 / React 19 / Rust desktop app at `apps/desktop/` — no scaffolding story. No starter template applies.
- **No new dependencies:** zero Rust crates, zero npm packages. `tempfile = "3"` is already a dependency; `react-day-picker` is already `^9.14.0`. `Cargo.toml` dependency list is unchanged.
- **No SQLite work at all:** no migration, no table, no `db/` module. `db/mod.rs`'s `MIGRATIONS` array and `db/danger_zone.rs`'s `WIPE_TABLES` / `PRESERVED_TABLES` are untouched. Storage is `app_data_dir/profiles/<sub>.json`, one JSON document per Cognito `sub` (architecture D2).
- **New Rust modules:** `profile_store.rs` (the sole accessor of `profiles/`, mirroring `credentials.rs`'s sole-accessor role) and `json_store.rs` (`pub(crate) write_json_atomic`, moved out of `maintenance/catalog.rs` so two file stores do not carry two implementations).
- **New Rust models** in `models/mod.rs`, deriving exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` with `snake_case` fields: `UserProfile { schema_version, cognito_sub, first_name, last_name, birth_date, income_bracket, income_bracket_currency, country_code, subdivision_code, created_at, updated_at }`, `UpdateUserProfileInput`, `Country`, `Subdivision`. All profile fields are `Option`; `birth_date` is an ISO 8601 `String`.
- **New IPC surface** in `commands/profile.rs`, all `#[tauri::command(rename_all = "snake_case")]` returning `Result<T, AppError>` with no panics: `get_user_profile`, `save_user_profile`, `get_countries`, `get_subdivisions` — all registered in `lib.rs`'s `tauri::generate_handler!`.
- **New auth helper:** `commands/auth.rs::current_subject() -> Result<String, AppError>`, reusing the existing keyring-load-and-refresh path and returning the `id_token` `sub` claim. `sub` is **never** an IPC parameter and is **never** added to `AuthState`. This retires the existing `#[allow(dead_code)]` on the `sub` extraction.
- **`sub` is validated, never slugged:** `^[A-Za-z0-9_-]{1,128}$`, used verbatim as the filename. Slugging is many-to-one and could collide two accounts onto one file (architecture Correction 1). Non-conforming values are rejected as `AppError::Validation { field: "cognito_sub" }`.
- **In-document integrity guard:** `cognito_sub` is stored inside the document as well as being the filename. A mismatch on read is treated as "no profile" rather than returning another account's data.
- **Full-replace save semantics:** `save_user_profile` replaces the whole document. `None` means the field is cleared, not unchanged. `created_at` is carried forward verbatim from any existing document; `updated_at` is always set to now. Partial updates are not supported (architecture G1, G5).
- **Delete-all coverage:** `delete_all_data` gains an `app: AppHandle` parameter (Tauri-injected, so `invoke("delete_all_data")` is unchanged on the frontend) and calls `profile_store::delete_all_profiles`, which removes the entire `profiles/` directory **recursively** — treating "already absent" as success. A glob of `*.json` is insufficient because `.corrupt` and `.tmp` files would survive (architecture G2). A dedicated test is **required**, because `danger_zone`'s machine-checked table-coverage test cannot see a non-SQLite store.
- **Bundled ISO 3166 dataset** at `src-tauri/data/iso3166.json`, embedded with `include_str!` and parsed once into a `std::sync::OnceLock`. `name_en` is required; `name_fr` is optional with EN fallback in the UI. Regenerated by a dev-only script (`apps/desktop/scripts/generate-iso3166.mjs`, exposed as `generate:iso3166`) — **never fetched at runtime and never wired into build or CI**. Rust is the validation authority; the frontend ships no second copy and obtains data only through `get_countries` / `get_subdivisions`.
- **Conditional validation rules** in `profile_store.rs`: `income_bracket` without `income_bracket_currency` is rejected; `subdivision_code` without `country_code` is rejected; `subdivision_code` must belong to the selected `country_code`. Date of birth must parse as ISO 8601 `YYYY-MM-DD`, not be in the future, and imply an age between 18 and 120.
- **Income bracket allow-list:** `under_50k`, `50k_99k`, `100k_149k`, `150k_249k`, `250k_plus`. Deliberately not aligned to statutory tax brackets, and deliberately not `_cents` integers — it is a categorical range, so project rule 1 does not apply. `income_bracket_currency` is an ISO 4217 uppercase code with **no derived default** (no app-level display currency exists).
- **No new `AppError` variant:** reuse `Auth { message, recoverable }` for no-session, `Validation { message, field }` for field errors, `File` for IO failures.
- **No audit logging** for profile mutations: `insert_audit_log` requires a `Connection` and an `i64 entity_id`, which a file-backed store has neither of. Consistent with `credentials.rs` and `catalog.rs`. Side benefit — profile values never enter `nkbaz-finance.db`, so they cannot leak into a backup via the audit trail.
- **Backup and restore code is untouched:** `export_backup` copies `nkbaz-finance.db` only, so profiles are excluded automatically; `restore_from_file` swaps that same file, so profiles survive a restore. Both properties are structural consequences of the storage choice, not behaviours maintained by code.
- **`/profile` is a new route** (`apps/desktop/src/routes/profile.tsx`), explicitly overturning Story 27.3's decision not to create it. Architecture rule D8 holds: `/profile` is outside the four-destination IA and is **not** added to `AppSidebar`, `DestinationNav`, or `lib/navigation.ts`.
- **Route guard is four-way, and lives in the route:** `isLoading` → skeleton (never the signed-out state); `LoggedIn` → form; `LoggedOut` → sign-in state; `SessionExpired` → sign-in state using the existing `profile.sessionExpiredAction` copy. Hiding the menu item is UX, not enforcement — the Rust-side `current_subject()` check is the actual boundary.
- **Cache isolation:** `useSignOut` and the `auth:callback-received` handler must call `queryClient.removeQueries({ queryKey: queryKeys.profile })`, **not** `invalidateQueries` — invalidation leaves stale data rendered while refetching, briefly showing one account's data to another.
- **`ProfileMenu` adds no `invoke`:** the Profile entry is `<DropdownMenuItem render={<Link to="/profile" />}>`, following the `render`-prop pattern already used by `SegmentedNavItem` (nesting an anchor breaks keyboard semantics with `@base-ui/react`). Because this always-mounted component performs no new IPC call, **no existing Playwright spec's Tauri mock requires updating** — the trap documented at `project-context.md:295` is deliberately sidestepped. Profile reads must not be moved into `ProfileMenu`.
- **Frontend structure:** `hooks/useProfile.ts` (`useUserProfile`, `useSaveUserProfile`, `useCountries`, `useSubdivisions`), `components/profile/ProfileForm.tsx`, `components/profile/SignInRequired.tsx`. New query keys in `lib/constants.ts`: `profile: ["profile"]`, `countries: ["countries"]`, `subdivisions: (countryCode) => ["subdivisions", countryCode]` — flat and top-level. `useCountries` / `useSubdivisions` use `staleTime: Infinity`.
- **Form field names are the `snake_case` IPC names** (`first_name`, `birth_date`, `country_code`), so `AppError::Validation { field }` maps directly to `setError(field)` with no translation table. Changing `country_code` clears `subdivision_code` in the same form update.
- **Shared `DatePicker` extension:** `packages/shared/src/ui/date-picker.tsx` gains optional `captionLayout`, `startMonth`, and `endMonth` props forwarded to `Calendar`. Additive and backward-compatible — existing call sites unchanged. Required because the current control has no year navigation and a birthdate is decades in the past. `react-day-picker` is `^9.14.0`, so these are the correct v9 prop names.
- **TFSA calculation:** a new Rust module computing the cumulative lifetime TFSA limit from date of birth — sum of annual CRA limits from the year the user turned 18 (or 2009, whichever is later) through the current year. Amounts are `i64` cents with a `_cents` suffix (project rule 1). The annual-limits table is a checked-in Rust const carrying an explicit "known through year N" bound. No TFSA account balance is subtracted: contributions and withdrawals are not tracked, so remaining room is not computable and must not be presented as if it were.
- **TFSA IPC surface (Epic 30):** one additional session-gated command, `get_tfsa_accumulated_limit() -> Result<Option<TfsaAccumulatedLimit>, AppError>`, returning `{ total_cents, eligible_from_year, known_through_year }` or `None` when the figure must be withheld. All eligibility and degradation logic lives in Rust so the frontend cannot produce a divergent number; the frontend renders the value or nothing. Query key `tfsaAccumulatedLimit: ["tfsa-accumulated-limit"]`, invalidated after a profile save and **removed** (not invalidated) on session transitions alongside `queryKeys.profile`.
- **Corrupt-document handling:** if a profile file exists but fails to parse, `load_profile` renames it to `<sub>.json.corrupt`, emits `tracing::warn!`, and returns `Ok(None)`. A missing file is `Ok(None)`, not an error.
- **Data-at-rest posture:** profile documents are plaintext JSON with owner-only permissions, consistent with the unencrypted `nkbaz-finance.db` beside them. Encryption at rest is a separate project-level decision covering both stores, explicitly out of scope.
- **Serde casing:** profile and location types use serde-default `snake_case`. `catalog.rs`'s `#[serde(rename_all = "camelCase")]` on `VehicleCatalogStatus` is a local exception and must **not** be copied.
- **Testing:** Rust unit tests inline via `#[cfg(test)] mod tests` using `tempfile` (matching `db/backup.rs`); one new Playwright spec in `apps/desktop/tests/`; locale parity covered automatically by the existing suite in `src/locales/__tests__/`. Desktop E2E runs against the Vite dev server with `invoke` stubbed per-spec — there is no real IPC layer in that suite.
- **Regression checks required:** `tests/auth.spec.ts` (asserts on `profile-menu-*` testids), `accessibility.spec.ts`, `navigation.spec.ts`, `nav-qa.spec.ts` (may enumerate routes/links), the existing `catalog.rs` tests (its `write_json_atomic` move must be behaviour-neutral), and any existing Rust test or direct caller of `delete_all_data`.
- **No configuration changes:** no new env vars, no new secrets, no `tauri.conf.json` change, no new capability entry, no new plugin, no new AWS resource.

### UX Design Requirements

No feature-specific UX design specification exists — this section is intentionally empty of UX-DRs. The UX constraints that _are_ fixed come from `architecture-user-profile.md`'s decisions and appear as acceptance criteria in the surface epic:

- Entry point is a "Profile" item in the existing top-right account dropdown, visible only when signed in.
- The Profile surface is a dedicated `/profile` route, not a dropdown panel and not a settings sub-surface.
- No avatar or profile picture, and no `Avatar` primitive is added to `packages/shared/src/ui/` (upholding Story 27.3 AC 10). Profile picture is out of scope.
- The four-way session guard rendering is fixed (loading skeleton / form / sign-in / session-expired).
- Date of birth uses the shared `DatePicker` with year navigation, not free-text entry.
- The TFSA figure appears on the profile surface adjacent to date of birth, so the value of providing the field is visible at the moment it is requested.

**Flagged for decision inside stories, not invented here:** form section grouping and field order, first-visit empty-state copy, save-affordance behaviour (explicit save button versus autosave), and the exact wording of the TFSA accumulated-limit caveat.

### Documentation Obligations

- `architecture-user-profile.md` states in its Requirements-to-Structure map and FR5 notes that downstream consumers are "not implemented in this pass". That is **amended by this document**: the TFSA cumulative-limit display (FR9, FR10, NFR9) is in scope for this feature's epics. An amendment note must be appended to the architecture document so the two do not contradict.
- "Nixus Cloud" brand alignment in `apps/web` marketing copy and in Cognito Managed Login branding remains outstanding follow-on work, tracked as deferred rather than silent debt.


### Validation Notes (step-04)

**FR/NFR traceability:** every FR and NFR was traced to at least one named acceptance criterion, not merely to an epic. Two gaps were found and closed during this pass:

- **FR6 (sync-shaped document) had no acceptance criterion.** It was mapped to Epic 28 but no story asserted that `schema_version` is written. An AC was added to Story 28.2 covering `schema_version: 1`, the in-document `cognito_sub`, and forward-version handling.
- **NFR7 (retention on sign-out) had no acceptance criterion.** Story 28.2 tested that a *different* account sees its own data, but nothing tested that the *same* account's profile survives a sign-out — which is the entire point of decision D6. An AC was added.

**Sequencing constraint (compliant, but must not be reordered):** Epic 30 consumes `birth_date` from Story 28.3 and `country_code` from Story 29.1. Building on previous epics is permitted, but Epic 30 must not be scheduled before Epic 29 — without a country the figure would be permanently withheld and the epic would appear broken rather than degraded.

**Story sizing exception, accepted deliberately:** Story 28.2 is materially larger than the others. It carries `current_subject()`, `json_store.rs`, `profile_store.rs`, `commands/profile.rs`, the hooks layer, and account-isolation cache removal. Splitting it was considered and rejected: every smaller split either produces a story with no user value (forbidden by the epic design principles) or defers `removeQueries` to a later story, which would ship a real cross-account data leak in the interim. Large-but-correct was chosen over small-but-broken.

**No starter template and no schema work:** the architecture confirms a brownfield extension of `apps/desktop/`, so no scaffolding story exists. No story creates or alters a SQLite table, so the "create entities only when needed" principle is satisfied trivially.

**Forward-dependency check:** all ten stories were walked in order. 28.1 depends on already-shipped code only; 28.2→28.1; 28.3→28.2; 28.4→28.2; 28.5 is independent; 29.1→28.2; 29.2→29.1; 29.3→28.2; 30.1→28.3 and 29.1; 30.2→30.1. No story depends on a later story.

### FR Coverage Map

| FR | Epic | Coverage |
| --- | --- | --- |
| FR1 | 28 | Profile item in the account dropdown navigating to `/profile` |
| FR2 | 28, 29 | Name + date of birth in Epic 28; income bracket, currency, country, subdivision in Epic 29 |
| FR3 | 28 | `sub`-scoped JSON document, survives restart |
| FR4 | 28 | Route guard, `current_subject()`, query-cache removal on session change |
| FR5 | 29 | Profile readable as a first-class domain read; the first consumer arrives in Epic 30 |
| FR6 | 28 | Sync-shaped document with `schema_version` |
| FR7 | 28 | "Sign In with Nixus Cloud" relabel |
| FR8 | 28 | Copy accuracy verified against the relabel |
| FR9 | 30 | Cumulative lifetime TFSA limit display |
| FR10 | 30 | Graceful degradation on missing or out-of-range inputs |

**NFR coverage:** NFR1–NFR8 are addressed in Epic 28 (with NFR5 extended by Epic 29's dataset EN/FR fallback and NFR6 re-asserted there). NFR9 is addressed in Epic 30.

All ten functional requirements and all nine non-functional requirements are mapped to an epic.

## Epic List

Three epics, organized by user value rather than technical layer. Each ships something a user can see and use, and each builds on — but does not require — the epics after it.

Note on slicing: `architecture-user-profile.md`'s Implementation Sequence is ordered by technical layer (Rust foundation → dataset → frontend). That order is preserved as the dependency order here, but the epics are cut along user value instead, because a "Rust storage foundation" epic would deliver nothing shippable on its own.

### Epic 28: Your Nixus Cloud Profile

A signed-in user can open Profile from the account menu, record their name and date of birth, and trust that it stays theirs — persisted per account, invisible when signed out, and removed when they wipe their data. The sign-in affordance is relabelled "Sign In with Nixus Cloud", setting the expectation that an account is the gateway to non-local features.

**Ships standalone:** a working, account-isolated, persistent profile. Nothing in Epic 29 or 30 is required for this to be useful.

**FRs covered:** FR1, FR2 (partial — name and date of birth), FR3, FR4, FR6, FR7, FR8
**NFRs covered:** NFR1, NFR2, NFR3, NFR4, NFR5, NFR6, NFR7, NFR8

**Implementation notes:** Carries the entire storage foundation — `profile_store.rs`, `json_store.rs` (extracted from `catalog.rs`), `commands/auth.rs::current_subject()`, and `commands/profile.rs` (`get_user_profile`, `save_user_profile`) — plus the `/profile` route with its four-way session guard, the `ProfileMenu` navigation item, delete-all coverage with its mandatory dedicated test, and the additive shared `DatePicker` year-navigation props. This is deliberately the largest epic: every invariant the later epics depend on (Rust-side `sub` resolution, filename validation, cache isolation, recursive delete) is established here, and a partially built store would not be shippable.

### Epic 29: Location & Income Context

The user completes their profile with country, subdivision, and an income bracket expressed in their own currency — the context that lets Nixus reason about their situation instead of guessing. Country selection works worldwide and entirely offline.

**Ships standalone:** the profile becomes complete. Even before any consumer exists, the user has told Nixus where they live and roughly what they earn, which AI chat and future guidance can draw on.

**FRs covered:** FR2 (completion — income bracket, currency, country, subdivision), FR5
**NFRs covered:** NFR5 (dataset EN/FR display names with EN fallback), NFR6

**Implementation notes:** Bundled ISO 3166 dataset at `src-tauri/data/iso3166.json` with its dev-only regeneration script, the `get_countries` / `get_subdivisions` commands, conditional validation (income bracket requires a currency; a subdivision requires a country and must belong to it), and the country→subdivision cascade reset in the form.

### Epic 30: TFSA Room Visibility

A Canadian user sees, immediately beside the date of birth they just entered, how much lifetime TFSA room they have accumulated — the payoff that makes filling in the profile worthwhile, and the answer to "why does it want my birthday?". Honestly labelled as accumulated limit rather than remaining room, because Nixus does not track contributions or withdrawals.

**Ships standalone:** the first real return on profile data.

**FRs covered:** FR9, FR10
**NFRs covered:** NFR9

**Implementation notes:** Builds on `birth_date` (Epic 28) and `country_code` (Epic 29); required by neither. A new Rust module computes the sum of annual CRA TFSA limits from the year the user turned 18 (or 2009, whichever is later) through the current year, in `i64` cents. The annual-limits table is a checked-in Rust const declaring an explicit "known through year N" bound, withholding the figure rather than extrapolating past it. **TFSA account balances must not be subtracted** — a balance includes market growth and ignores withdrawals, so remaining room is not computable from available data.

**Known maintenance commitment:** the CRA limits table goes stale most Januaries. The "known through year N" bound prevents a silently wrong figure, but the table must actually be bumped each year that a new limit is announced.

---

## Epic 28: Your Nixus Cloud Profile

A signed-in user can open Profile from the account menu, record their name and date of birth, and trust that it stays theirs — persisted per account, invisible when signed out, and removed when they wipe their data. The sign-in affordance is relabelled "Sign In with Nixus Cloud", setting the expectation that an account is the gateway to non-local features.

**Sequencing note:** Story 28.1 deliberately ships the page before any data. It relies only on the already-shipped `useAuthSession`, so it requires no Rust work and is immediately verifiable, which keeps Story 28.2 from having to build everything at once.

**Resolved UX decision (was flagged open):** the profile form uses an **explicit Save button**, not autosave. Validation is server-authoritative and field-scoped, which requires a discrete submit to map errors back to fields.

### Story 28.1: Reach my profile from the account menu

As a signed-in Nixus user,
I want a Profile item in my account dropdown that opens a profile page,
So that I have a place to see and manage who I am in Nixus.

**Acceptance Criteria:**

**Given** I am signed in
**When** I open the account dropdown in the top-right
**Then** I see a "Profile" item alongside "Sign out"
**And** selecting it navigates me to `/profile`

**Given** the Profile item is rendered
**When** the dropdown mounts
**Then** `ProfileMenu` makes no new `invoke()` call of any kind
**And** the item is a `DropdownMenuItem render={<Link to="/profile" />}`, not a nested anchor
**And** no existing Playwright spec's Tauri mock requires a new command case

**Given** I am not signed in
**When** I look at the top-right of the app
**Then** I see the sign-in button with no dropdown and no Profile item

**Given** I navigate directly to `/profile` while my session is still resolving
**When** the page renders
**Then** I see a loading skeleton
**And** I never see the signed-out state flash before the signed-in state

**Given** I navigate directly to `/profile` while signed out
**When** the page renders
**Then** I see a "sign in required" state with a sign-in action
**And** no profile data is requested or displayed

**Given** my session has expired
**When** I open `/profile`
**Then** I see the sign-in required state using the existing `profile.sessionExpiredAction` copy

**Given** I am signed in and on `/profile`
**When** the page renders
**Then** my email is displayed read-only, sourced from the existing session
**And** `/profile` does not appear in the sidebar or destination navigation

**Given** the route file is added
**When** `accessibility.spec.ts`, `navigation.spec.ts`, and `nav-qa.spec.ts` run
**Then** they still pass, and `routeTree.gen.ts` is regenerated rather than hand-edited

### Story 28.2: Record my name so it's remembered next time

As a signed-in Nixus user,
I want to enter my first and last name on my profile and have it saved,
So that Nixus knows who I am and I never have to re-enter it.

**Acceptance Criteria:**

**Given** I am signed in with no profile yet
**When** I open `/profile`
**Then** the name fields are empty and no error is shown
**And** `get_user_profile` returns `null` rather than failing

**Given** I enter a first and last name
**When** I press Save
**Then** the values persist to `app_data_dir/profiles/<sub>.json`
**And** they are still there after I quit and relaunch the app

**Given** a save occurs
**When** the document is written
**Then** it is written atomically via the shared `write_json_atomic` helper in the new `json_store.rs`
**And** `maintenance/catalog.rs` uses that same helper, with its existing tests still passing unchanged

**Given** any profile command runs
**When** it needs to know which account is active
**Then** it resolves the `sub` itself via `commands::auth::current_subject()`
**And** `sub` is never accepted as an IPC parameter and is never added to `AuthState`

**Given** a resolved `sub`
**When** it is used as a filename
**Then** it is validated against `^[A-Za-z0-9_-]{1,128}$` and used verbatim
**And** it is never slugged or otherwise transformed
**And** a non-conforming value is rejected as `AppError::Validation { field: "cognito_sub" }`

**Given** a profile document whose internal `cognito_sub` does not match its filename
**When** it is read
**Then** it is treated as "no profile" rather than returning another account's data

**Given** a profile document that exists but cannot be parsed
**When** I open `/profile`
**Then** the page renders with empty fields rather than an error
**And** the unparseable file is renamed to `<sub>.json.corrupt` and a warning is logged
**And** the original bytes are not deleted

**Given** I sign out and sign in as a different account
**When** I open `/profile`
**Then** I see that account's own name, never the previous account's
**And** the cached profile query was removed with `removeQueries`, not `invalidateQueries`

**Given** I have a saved profile and I clear a name field and press Save
**When** the document is written
**Then** the field is cleared — save is a full replace, and `None` means empty
**And** `created_at` is carried forward unchanged while `updated_at` is set to now

**Given** I sign out and sign back in as the **same** account
**When** I open `/profile`
**Then** my name is still there, because profile documents are retained on sign-out (NFR7)
**And** no profile data was deleted at any point during sign-out

**Given** a profile document is written for the first time
**When** its contents are inspected
**Then** it contains `schema_version: 1` and its own `cognito_sub` (FR6)
**And** a document read with an unrecognized future `schema_version` is treated as "no profile" rather than parsed optimistically

**Given** no session exists
**When** `get_user_profile` or `save_user_profile` is invoked
**Then** it returns `AppError::Auth { recoverable: true }` and touches no file

**Given** the feature is complete
**When** the repository is inspected
**Then** no SQLite migration was added, `MIGRATIONS` is unchanged, no audit-log entry is written, and no new crate or npm package was introduced

### Story 28.3: Record my date of birth without fighting the calendar

As a signed-in Nixus user,
I want to set my date of birth using a date picker I can actually navigate decades with,
So that Nixus can use my age for age-dependent guidance later.

**Acceptance Criteria:**

**Given** I am on `/profile`
**When** I open the date-of-birth picker
**Then** I can jump directly to a year decades in the past without clicking month-by-month
**And** the picker is the shared `@nixus/shared/ui` `DatePicker`, not a locally duplicated component

**Given** the shared `DatePicker` gains `captionLayout`, `startMonth`, and `endMonth`
**When** existing call sites are checked
**Then** all of them compile and behave unchanged, because the new props are optional

**Given** I pick a valid date of birth and press Save
**When** the document is written
**Then** `birth_date` is stored as an ISO 8601 `"YYYY-MM-DD"` string, never a timestamp

**Given** I submit a date in the future
**When** validation runs in `profile_store.rs`
**Then** it is rejected as `AppError::Validation { field: "birth_date" }`
**And** the message is surfaced against the date-of-birth field in the form

**Given** I submit a date implying an age under 18 or over 120
**When** validation runs
**Then** it is rejected with the same field-scoped error

**Given** validation fails on the Rust side
**When** the error reaches the form
**Then** the `field` value maps directly to the form field name with no translation table, because form field names are the `snake_case` IPC names

**Given** I clear my date of birth and press Save
**When** the document is written
**Then** `birth_date` is `null` and no error occurs

### Story 28.4: Wiping my data removes my profile too

As a Nixus user who has asked to delete all my data,
I want my profile deleted along with everything else,
So that "delete all data" means what it says.

**Acceptance Criteria:**

**Given** I have a saved profile
**When** I run the danger-zone delete-all-data action
**Then** my profile document is gone from disk

**Given** the profiles directory contains `.json`, `.json.corrupt`, and `.json.tmp` files
**When** delete-all runs
**Then** the entire `profiles/` directory is removed recursively
**And** no leftover file of any extension survives

**Given** the profiles directory does not exist
**When** delete-all runs
**Then** it succeeds rather than erroring

**Given** `delete_all_data` needs the app data directory
**When** its signature is changed to accept `app: AppHandle`
**Then** the frontend's `invoke("delete_all_data")` call is unchanged, because Tauri injects the handle
**And** any existing Rust test or direct caller of that function is located and updated

**Given** the profile store is invisible to `danger_zone`'s table-coverage test
**When** the story is complete
**Then** a dedicated test asserts the profiles directory is absent or empty after delete-all
**And** deletion is performed by `profile_store::delete_all_profiles`, not by `danger_zone` touching the filesystem itself

**Given** I export a backup and restore it on another machine
**When** the restore completes
**Then** no profile data travelled with the backup, and my local profile is untouched

### Story 28.5: Understand that an account means Nixus Cloud

As a Nixus user deciding whether to create an account,
I want the sign-in affordance to say "Sign In with Nixus Cloud",
So that I understand an account is the gateway to features that aren't purely local.

**Acceptance Criteria:**

**Given** I am signed out
**When** I look at the top-right affordance
**Then** it reads "Sign In with Nixus Cloud" in English and "Se connecter avec Nixus Cloud" in French
**And** "Nixus Cloud" is not translated

**Given** the account-prompt dialog appears at launch
**When** I read its primary action
**Then** it uses the same "Nixus Cloud" brand term

**Given** the dialog body copy is reviewed alongside the new label
**When** compared against current behaviour
**Then** it remains literally accurate: an account authenticates me, and no profile or financial data is transmitted

**Given** new or changed i18n keys
**When** the locale parity suite runs
**Then** every key exists in both `en.json` and `fr.json` and the suite passes

**Given** the relabel lands
**When** `tests/auth.spec.ts` runs
**Then** it still passes, with any label assertion updated to the new copy

---

## Epic 29: Location & Income Context

The user completes their profile with country, subdivision, and an income bracket expressed in their own currency — the context that lets Nixus reason about their situation instead of guessing. Country selection works worldwide and entirely offline.

### Story 29.1: Tell Nixus which country I live in

As a Nixus user anywhere in the world,
I want to select my country from a complete list that works offline,
So that Nixus can tailor guidance to where I actually live.

**Acceptance Criteria:**

**Given** I am on `/profile`
**When** I open the country selector
**Then** I see every ISO 3166-1 country, sorted for browsing, with no network request made

**Given** the app is running with no internet connection on a fresh install
**When** I open the country selector
**Then** the full list still appears, because the dataset is embedded in the binary via `include_str!`

**Given** the dataset is parsed
**When** `get_countries` is called repeatedly
**Then** parsing happens once via `std::sync::OnceLock`, not per call

**Given** I am viewing the app in French
**When** I open the country selector
**Then** country names display their French values where the dataset provides `name_fr`
**And** they fall back to `name_en` where `name_fr` is absent, never rendering blank

**Given** I select a country and press Save
**When** the document is written
**Then** `country_code` holds the ISO 3166-1 alpha-2 code

**Given** a `country_code` not present in the bundled dataset is submitted
**When** validation runs in `profile_store.rs`
**Then** it is rejected as `AppError::Validation { field: "country_code" }`

**Given** the dataset needs refreshing
**When** a maintainer runs `pnpm --filter @nixus/desktop generate:iso3166`
**Then** `src-tauri/data/iso3166.json` is regenerated as a reviewable diff
**And** every entry has a non-empty `name_en`
**And** the script is not wired into the build or CI, and the app never fetches this data at runtime

**Given** the frontend needs country data
**When** the implementation is inspected
**Then** the frontend ships no second copy of the dataset and obtains it only via `get_countries`
**And** `useCountries` uses `staleTime: Infinity`

### Story 29.2: Tell Nixus which state or province I'm in

As a Nixus user in a country with subdivisions,
I want to select my state, province, or region after choosing my country,
So that Nixus can apply guidance that varies within my country.

**Acceptance Criteria:**

**Given** I have selected a country that has subdivisions
**When** I open the subdivision selector
**Then** I see only that country's ISO 3166-2 subdivisions

**Given** I have selected a country with no subdivisions in the dataset
**When** I look at the form
**Then** the subdivision field is not offered

**Given** I have not selected a country
**When** I look at the form
**Then** the subdivision field is unavailable rather than showing a global list

**Given** I have selected a subdivision and then change my country
**When** the country changes
**Then** the subdivision selection is cleared in the same form update
**And** I cannot submit a subdivision belonging to a previously selected country

**Given** a `subdivision_code` is submitted with no `country_code`
**When** validation runs
**Then** it is rejected as `AppError::Validation { field: "subdivision_code" }`

**Given** a `subdivision_code` is submitted that does not belong to the submitted `country_code`
**When** validation runs
**Then** it is rejected with the same field-scoped error

**Given** I am viewing the app in French
**When** I open the subdivision selector
**Then** names display `name_fr` where present and fall back to `name_en` otherwise

**Given** subdivisions are fetched for a country
**When** the query key is inspected
**Then** it is `["subdivisions", countryCode]` with `staleTime: Infinity`, so switching back to a previously viewed country makes no new call

### Story 29.3: Give Nixus a rough sense of my income

As a Nixus user who hasn't entered all my income data yet,
I want to pick an approximate yearly income bracket and say which currency it's in,
So that Nixus can reason about my situation at the right scale without me itemizing everything.

**Acceptance Criteria:**

**Given** I am on `/profile`
**When** I open the income bracket selector
**Then** I see five ranges: under 50k, 50k–99k, 100k–149k, 150k–249k, and 250k or more
**And** each label is translated in English and French

**Given** I select an income bracket
**When** I look at the form
**Then** a currency selector is presented with no pre-filled guess, because Nixus has no app-level display currency

**Given** I select a bracket but no currency
**When** I press Save
**Then** it is rejected as `AppError::Validation { field: "income_bracket_currency" }`
**And** the error is surfaced against the currency field

**Given** I select a currency but no bracket
**When** I press Save
**Then** it saves successfully and the currency is inert

**Given** I select both and press Save
**When** the document is written
**Then** `income_bracket` holds one of the five allow-listed codes
**And** `income_bracket_currency` holds an uppercase ISO 4217 code

**Given** an `income_bracket` value outside the allow-list is submitted
**When** validation runs
**Then** it is rejected as `AppError::Validation { field: "income_bracket" }`

**Given** the bracket is stored
**When** the implementation is inspected
**Then** it is a categorical string code, not an `_cents` integer, because it is a range rather than a monetary amount

---

## Epic 30: TFSA Room Visibility

A Canadian user sees, immediately beside the date of birth they just entered, how much lifetime TFSA room they have accumulated — the payoff that makes filling in the profile worthwhile, and the answer to "why does it want my birthday?". Honestly labelled as accumulated limit rather than remaining room, because Nixus does not track contributions or withdrawals.

### Story 30.1: See how much TFSA room I've accumulated

As a Canadian Nixus user who has entered my date of birth,
I want to see the total TFSA contribution room I've accumulated over my lifetime,
So that entering my birthday gives me something useful right away.

**Acceptance Criteria:**

**Given** my country is Canada and my date of birth is set
**When** I view `/profile`
**Then** I see my cumulative lifetime TFSA limit displayed near the date-of-birth field

**Given** the figure is displayed
**When** I read its label and supporting text
**Then** it is described as the total room I have accumulated, explicitly **not** as remaining room
**And** it states that Nixus does not track my contributions or withdrawals
**And** both label and note are translated in English and French

**Given** I was born in 1985
**When** the calculation runs
**Then** it sums annual CRA limits from 2009 onward, because I turned 18 before TFSAs existed

**Given** I was born in 2000
**When** the calculation runs
**Then** it sums annual limits from the year I turned 18 onward, not from 2009

**Given** the calculation completes
**When** the value is returned
**Then** it is an `i64` in cents with a `_cents` suffixed field name

**Given** the calculation module is implemented
**When** its tests run
**Then** they cover the pre-1991 birth year, a birth year after 2009, a user who turns 18 in the current year, and the first year past the limits table's bound

**Given** I change my date of birth or country and press Save
**When** the save succeeds
**Then** the displayed figure refreshes rather than showing a stale value

**Given** the calculation needs the limits table
**When** the implementation is inspected
**Then** the table is a checked-in Rust const declaring the last year it covers
**And** the computation happens in Rust, so the frontend cannot produce a divergent number

### Story 30.2: Never be shown a misleading TFSA number

As a Nixus user,
I want the TFSA figure withheld whenever Nixus cannot compute it honestly,
So that I never make a financial decision on a number that is quietly wrong.

**Acceptance Criteria:**

**Given** my country is not Canada
**When** I view `/profile`
**Then** no TFSA figure is shown and nothing errors

**Given** I have not set a country
**When** I view `/profile`
**Then** no TFSA figure is shown

**Given** my country is Canada but my date of birth is not set
**When** I view `/profile`
**Then** no TFSA figure is shown, and the date-of-birth field is what invites me to provide it

**Given** the current year is later than the limits table's declared bound
**When** the calculation runs
**Then** the figure is withheld rather than extrapolated from the last known limit
**And** the behaviour is covered by a test that pins the table bound

**Given** I have a TFSA account with a balance recorded in Nixus
**When** the figure is computed
**Then** that balance is **not** subtracted, because a balance includes market growth and ignores withdrawals, so remaining room is not computable from available data

**Given** I have no session
**When** the TFSA figure is requested
**Then** it returns `AppError::Auth { recoverable: true }` like every other profile read

**Given** I sign out and sign in as a different account
**When** I view `/profile`
**Then** any previously displayed figure is gone rather than carried over from the previous account
