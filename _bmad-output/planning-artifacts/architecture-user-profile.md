---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  [
    'docs/project-context.md',
    '_bmad-output/planning-artifacts/architecture-login.md',
    '_bmad-output/planning-artifacts/architecture-credentials.md',
    '_bmad-output/planning-artifacts/architecture-entitlements-licensing.md',
    '_bmad-output/planning-artifacts/architecture.md',
    '_bmad-output/implementation-artifacts/27-3-header-profile-menu-and-minimalist-profile-view.md',
  ]
workflowType: 'architecture'
project_name: 'nixus'
user_name: 'dev'
date: '2026-08-10'
lastStep: 8
status: 'complete'
completedAt: '2026-08-10'
---

# Architecture Decision Document: User Profile Feature

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Feature Brief (working, no formal PRD)

- **Goal:** A "User Profile" surface reached from the existing top-right account dropdown, holding user demographic data that improves financial guidance (TFSA/RRSP room, tax-aware AI insight) beyond what transactional data alone can provide.
- **Access path:** Top-right account icon (existing `ProfileMenu`) → "Profile" item in the dropdown.
- **Fields:** first name, last name, date of birth, estimated yearly income bracket (with its currency), country and subdivision. Email displayed read-only from Cognito `id_token` claims.
- **Scope of audience:** nixus's product goal is worldwide availability. Location is therefore modelled as ISO 3166 country + subdivision, not a Canadian province list, even though the finance module's tax logic is currently Canada-specific.
- **Storage:** Local SQLite only. **Cloud sync is explicitly out of scope for this pass** — an earlier framing of this feature included cloud-synced profile data and was deliberately dropped to preserve the "your data never leaves your machine" guarantee.
- **Account scoping:** Profile requires an active session and is scoped to the authenticated Cognito `sub`. Signing out and signing in as a different account surfaces that account's own profile.
- **Brand groundwork:** The signed-out affordance is relabelled "Sign In with Nixus Cloud" to signal to users that an account is the gateway to non-local information, ahead of any sync being built.
- **Builds on:** `architecture-login.md` (Epics 26 & 27, shipped). The Cognito PKCE flow, keyring session storage, `AuthState`, `ProfileMenu`, and `AccountPromptDialog` all exist and work today. This feature is strictly additive to that foundation.
- **Explicitly not:** a resurrection of the superseded `architecture.md` DynamoDB + Lambda + API Gateway design (which specced `FR-P3: User profile management` and a `Users` table but was never implemented).

## Project Context Analysis

### Requirements Overview

**Functional Requirements (derived from working brief, no formal PRD):**

- FR1: A signed-in user opens the top-right account dropdown (existing `ProfileMenu`) and selects a new "Profile" item to reach a Profile surface.
- FR2: User views and edits profile fields: first name, last name, date of birth, estimated yearly income bracket (with the currency it is expressed in), country, and subdivision (state/province/region). Email is displayed read-only, sourced from the Cognito `id_token`.
- FR3: Profile data persists locally in SQLite, scoped to the authenticated Cognito `sub`, and survives app restart.
- FR4: Profile requires authentication. When no session exists, the Profile entry point is not shown and no profile data is readable. Signing out and signing in as a different account surfaces that account's own profile — never the previous one's.
- FR5: Profile data is available to other modules as a first-class domain read (TFSA contribution room from date of birth; income bracket and location as AI insight context). Consumers MUST degrade gracefully when no session or no profile exists, and Canada-specific logic MUST gate on `country_code == "CA"`.
- FR6: Cloud sync is out of scope for this pass. The `sub`-keyed model is already sync-shaped, so no destructive migration is required to add it later.
- FR7: The signed-out authentication affordance is relabelled to "Sign In with Nixus Cloud" (`profile.signIn`), and the account-prompt dialog's primary action aligns with the same brand term (`auth.createAccount`). "Nixus Cloud" is the canonical, forward-looking name for nixus's networked surface — it signals to the user that an account may involve non-local information, ahead of any sync existing.
- FR8: Copy must remain literally accurate for the current state: an account authenticates the user; no profile or financial data is transmitted. Existing `auth.promptBody` copy already satisfies this and must not drift out of alignment with the new label.

**Non-Functional Requirements:**

- NFR1: Local-first preserved for the _app_, not for this feature. Profile is the first intentionally account-gated surface in nixus. No existing functionality regresses for offline/no-account users — they simply have no profile.
- NFR2: No profile data leaves the machine. The README claim "your data never leaves your machine" remains literally true after this feature ships.
- NFR3: Account isolation — a profile row is reachable only via the currently authenticated `sub`. No code path may read a profile without an active session.
- NFR4: Sensitive-data lifecycle — profile rows are covered by the existing backup/restore and danger-zone delete-all-data paths. No PII survives a full wipe.
- NFR5: EN/FR i18n for all field labels and income bracket values. Country and subdivision display names come from the bundled ISO 3166 dataset's EN/FR fields rather than hand-written i18n keys.
- NFR6: Zero new external dependencies, Rust or npm. A checked-in generated ISO 3166 data file plus a dev-only regeneration script satisfies this — it is data and a script, not a runtime or build dependency.
- NFR7: Multi-account PII residency — profiles for previously signed-in accounts remain on the device unless explicitly purged. Retention behavior on sign-out is a decision recorded in Step 4, not left implicit.
- NFR8: Brand-term consistency — "Nixus Cloud" is untranslated in FR ("Se connecter avec Nixus Cloud"). The term is reserved for all future networked features; no synonym ("Nixus Sync", "Nixus Account", "Nixus Online") may be introduced elsewhere in desktop, web, or Cognito Managed Login branding.

### Scale & Complexity

- Primary domain: Desktop (Tauri 2 / React 19 / Rust / SQLite) — no external services, no new network surface
- Complexity level: Low-Medium — the feature itself is a single-table CRUD surface, but the auth↔SQLite coupling and per-account row scoping are new territory for this codebase
- Estimated architectural components: `profile_store.rs`, `commands/profile.rs`, `UserProfile` + `UpdateUserProfileInput` + `LocationCatalog` models, bundled ISO 3166 dataset, `hooks/useProfile.ts`, `routes/profile.tsx`, one dropdown menu item, shared `DatePicker` prop extension, EN/FR locale keys. **No SQLite migration** — see D2.

### Technical Constraints & Dependencies

- **Rule D8 is binding** (`lib/navigation.ts:9`): "no fifth destination, ever." The Profile surface cannot be a sidebar destination. It is either a standalone route outside the 4-destination IA (the `/settings` precedent) or a `settings.*` sub-surface.
- **Story 27.3 precedent:** the existing auth profile panel deliberately avoided a `routes/profile.tsx` file and created no `Avatar` primitive. This pass must either follow or explicitly overturn that decision — not silently diverge.
- **No image/file storage convention exists anywhere in the codebase.** No BLOB columns, no `app_data_dir` file writes for user content. Profile picture is therefore **out of scope**: generated initials are rendered in the existing dropdown instead. Revisit only if Google federated sign-in later yields a `picture` claim at zero storage cost.
- **E2E mock coupling** (`project-context.md:295`): `ProfileMenu` is always mounted via `TopBar`. Any new `invoke()` it performs must be added to every existing Playwright spec's Tauri mock switch, or those specs fall through to `Promise.reject("Unknown command")` and render the error state.
- **Audit logging** is mandatory on every SQLite create/update/delete (project rule 3). This constrained the design until D2 moved the profile out of SQLite entirely; see D10 for why audit logging does not apply to a file-backed store, and how that removes a PII path into backups.
- **Generic `config` KV table is not the right home.** `db/config.rs` is an untyped string key-value store used for flags (`ai_configured`, `onboarding_completed`) and is in `PRESERVED_TABLES`, so it survives delete-all — the opposite of what profile data requires.
- **Email is never persisted** — it is read from `id_token` claims at request time, per the existing rule in `commands/auth.rs` ("no profile field is ever persisted separately").
- **Locale files are flat dotted-key JSON**, not nested. A locale-parity unit test suite (`src/locales/__tests__/`) fails CI if any key exists in `en.json` without an `fr.json` counterpart. Every new profile key must be added to both files in the same change.
- **Backup is a whole-file SQLite copy.** `export_backup` runs `PRAGMA wal_checkpoint(TRUNCATE)` then `std::fs::copy` of `nkbaz-finance.db`, and `restore_from_file` swaps that file back with a safety-copy rollback. Excluding a single table from a backup is therefore not a filter — it requires post-copy scrubbing plus preserve-across-swap logic on the restore path. This constraint drove D2.
- **`danger_zone.rs` is self-enforcing for SQLite.** A test asserts `WIPE_TABLES + PRESERVED_TABLES` covers every table in the live schema, so a new table cannot be silently omitted. A non-SQLite store is invisible to that test, which is why D9 mandates a dedicated replacement test.
- **`insert_audit_log` requires `conn: &Connection` and `entity_id: i64`** — structurally unavailable to a file-backed store. See D10.

### Cross-Cutting Concerns Identified

- **Session-gated data access** — the profile read path depends on `get_auth_session` resolving to `LoggedIn`. This is the first coupling between the auth layer and a SQLite-backed domain, and it must be enforced in Rust (`commands/profile.rs` resolves `sub` itself from the stored session), never by frontend conditionals the webview could bypass.
- **Tenancy asymmetry** — profile data is account-scoped; all financial data is device-scoped with no user column. Signing in as a different account yields a different profile over identical financial data. Accepted and bounded for this pass; recorded here so future multi-account or household work does not treat it as a bug. Immediate consequence: when income bracket or location feeds AI insight over shared financial data, the values applied are those of the currently signed-in account.
- **Downstream consumers** — TFSA room calculation and AI prompt context become dependents of a _session-gated_ read, so both need a defined no-session / no-profile fallback.
- **Data lifecycle** — the profile must be excluded from backups but removed by delete-all. Under D2's file store, backup exclusion and restore survival are both structural (no code change), while delete-all coverage is explicit and requires its own test.
- **i18n** — bracket labels and date formatting are locale-sensitive (EN/FR); country and subdivision names ship as dataset fields, not translation keys.
- **Validation placement** — field validation (ISO date format, bracket allow-list, country/subdivision cross-validation, currency code) lives in `profile_store.rs`, not the command layer, mirroring the `commands/` → `db/` separation that project rule 3 mandates.
- **Brand surface spanning three codebases** — "Nixus Cloud" appears in `apps/desktop` locales, and will eventually need to match `apps/web` marketing copy and the AWS-side Cognito Managed Login branding. Desktop is the only surface changed in this pass; the other two are noted as follow-on alignment work, not silent debt.

## Starter Template Evaluation

### Primary Technology Domain

Existing brownfield desktop app (Tauri 2 / React 19 / Rust / SQLite) — no starter template applies. This is an additive feature on top of the shipped auth foundation from `architecture-login.md` (Epics 26 & 27).

### Technology Additions for This Feature

**New dependencies: none.** Zero Rust crates, zero npm packages. This is a deliberate constraint (NFR6), and it holds because every capability required already exists in the project:

| Capability | Provided by (existing) |
| --- | --- |
| Identity / `sub` resolution | `commands/auth.rs`, `credentials.rs` (keyring) |
| Local persistence | `rusqlite` 0.38 + `db/mod.rs` migration runner |
| Form state & validation | `react-hook-form` 7.71.2 |
| Text / label / select inputs | `@nixus/shared/ui` — `Input`, `Label`, `Select` |
| Date entry | `@nixus/shared/ui` — `DatePicker` / `Calendar` (see gap below) |
| Menu entry point | `@nixus/shared/ui` — `DropdownMenu` (already used by `ProfileMenu`) |
| Server-state & cache | `@tanstack/react-query` 5.90.21 |
| i18n | `i18next` 26.0.3 + flat EN/FR locale files |
| Toasts / errors | `sonner` via `@nixus/shared/ui` |

**Explicitly not adding:**

- No image/avatar library or storage layer — profile picture is out of scope.
- No date-parsing dependency — `date-fns` 4.1.0 is already present, and dates are stored as ISO 8601 `String` per project rule 4.
- No validation library (zod/yup) — validation lives in the Rust `db/` layer per the `db/account.rs` convention, with `react-hook-form`'s built-in rules for client-side affordances only.

### Inherited Foundation Gap: `DatePicker` year navigation

`packages/shared/src/ui/date-picker.tsx` accepts only `{ value, onChange, disabled, placeholder }` and sets `defaultMonth={dateValue}` internally. It exposes no year or decade navigation because it was built for transaction dates near the present. A date of birth is decades in the past, making the current control unusable for FR2.

`packages/shared/src/ui/calendar.tsx` is a thin pass-through of `React.ComponentProps<typeof DayPicker>`, so react-day-picker's `captionLayout="dropdown"` plus `startMonth` / `endMonth` bounds are already reachable one layer down — `DatePicker` simply does not forward them.

**Implication:** this feature requires a small, additive, backward-compatible prop extension to the shared `DatePicker` (optional passthrough props, existing call sites unchanged) rather than a new component or a new dependency. The concrete shape of that extension is decided in Step 4.

### Rationale

A feature that adds no dependencies and reuses an already-shipped identity layer is the lowest-risk shape available. The one foundation gap found (`DatePicker` year navigation) is resolved by extending a shared primitive rather than duplicating one locally, which keeps project rule 8 intact ("never duplicate a component that exists in `packages/shared/src/ui/`") and benefits any future date-of-birth-like field.

**Note:** No project initialization story is required — this is an additive feature on an existing codebase.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**

- Profile surface placement: dedicated `/profile` route with an in-route session guard (D1)
- Storage medium: per-account JSON document store outside SQLite (D2)
- Identity resolution: `sub` resolved in Rust, never accepted over IPC (D3)
- Command surface: single whole-document `save_user_profile`, no create/update pair (D4)
- Query-cache isolation across session changes (D5)
- Sign-out retention policy (D6)

**Important Decisions (Shape Architecture):**

- Income bracket and location representation and validation (D7, D8)
- Backup exclusion / delete-all inclusion (D9)
- No audit logging for profile mutations (D10)
- `ProfileMenu` adds navigation only, no new IPC (D11)
- Shared `DatePicker` prop extension (D12)
- Error variants reused, not added (D13)
- "Nixus Cloud" brand relabel (D14)

**Deferred Decisions (explicitly out of scope):**

- Cloud sync of profile data — the JSON document is already shaped as the eventual sync payload
- Profile picture and any `Avatar` primitive
- Per-account local purge affordance ("remove this account's data from this device")
- Additional fields: marital status, dependents, employment status, target retirement age
- `geo_catalog.rs` fetch-and-cache for volatile per-country data (see D8)
- Database encryption at rest (SQLCipher or equivalent) — raised as a separate project-level decision, see Confidentiality below
- `apps/web` and Cognito Managed Login brand alignment for "Nixus Cloud"
- International tax logic — this pass captures `country_code` so future logic can gate on it, but builds none

### Data Architecture

**D2 · Storage medium: per-account JSON document under `app_data_dir` — not SQLite.**

Driven by the requirement that backups exclude the profile while delete-all includes it. Keeping it in SQLite would require scrubbing rows _and_ audit rows from the copied backup file, rewriting `test_backup_copy_produces_identical_file`, and adding preserve-across-swap logic to `restore_from_file` — surgery on the most data-loss-critical path in the app. A file store gets both properties for free.

Two existing precedents establish this boundary, so it is reuse rather than invention:

- `credentials.rs` — user-scoped data deliberately outside SQLite, outside backups, outside the audit log
- `maintenance/catalog.rs` — JSON documents under `app_data_dir` with `meta.json`, `schema_version`, and atomic writes via `write_json_atomic`

**Consequences:** no migration `025`, no `user_profiles` table, no `db/profile.rs`, no upsert SQL, no audit logging. `db/mod.rs` `MIGRATIONS` is untouched.

**Layout:** `app_data_dir/profiles/<sub>.json`, one document per Cognito `sub`.

> **Superseded — see "Corrections to Prior Decisions" in Implementation Patterns.** This decision originally called for slugging the `sub` via `catalog.rs::make_slug`. That is a many-to-one mapping and could collide two accounts onto one file. The `sub` is **validated** against a charset allow-list and used verbatim instead.

**Document shape** (Rust model in `models/mod.rs`, deriving exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` per project rule 4):

```rust
pub struct UserProfile {
    pub schema_version: u32,               // 1
    pub cognito_sub: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<String>,        // ISO 8601 "YYYY-MM-DD", per project rule 4
    pub income_bracket: Option<String>,
    pub income_bracket_currency: Option<String>,
    pub country_code: Option<String>,
    pub subdivision_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct UpdateUserProfileInput { /* the seven Option fields */ }
```

**All profile fields are nullable.** The profile is progressive — the user fills in what they choose, and FR5 already requires consumers to degrade on missing values.

`cognito_sub` is stored _inside_ the document as well as being the filename. On read, a mismatch between the two means the file was copied between accounts or machines; the store treats that as "no profile" rather than returning another account's data. This is a cheap structural guard on NFR3.

**D7 · Income bracket carries its currency.**

- `income_bracket` — allow-list: `under_50k`, `50k_99k`, `100k_149k`, `150k_249k`, `250k_plus`
- `income_bracket_currency` — ISO 4217, defaulting to the app's current display currency at the time of entry

Deliberately _not_ aligned to statutory tax brackets, which change annually and would silently rot. Deliberately _not_ `_cents` integers — this is a categorical range, not a monetary amount, so project rule 1 does not apply. Display labels are i18n keys. Adding cut points later is additive with no data migration.

Currency-less buckets are actively harmful for a worldwide app: ¥100,000 and US$100,000 differ by more than two orders of magnitude, and the bracket exists specifically to improve AI reasoning. A bracket without a currency would cause confident reasoning at the wrong scale. Storing the currency alongside a currency-agnostic bucket set is one nullable field; per-currency bucket sets would be far more machinery for the same outcome.

**D8 · Location: `country_code` + `subdivision_code`, from a bundled ISO 3166 dataset.**

nixus's product goal is worldwide availability, so a Canada-only province list is wrong.

- `country_code` — `Option<String>`, ISO 3166-1 alpha-2, validated against the bundled dataset
- `subdivision_code` — `Option<String>`, ISO 3166-2, validated against the subdivisions _of the selected country_; omitted for countries without subdivisions. A subdivision without a country is rejected as `AppError::Validation { field: "subdivision_code" }`.

**Source: a checked-in generated data file, not a runtime API.** ~5,000 rows, a few hundred KB, changing roughly once every few years — and the app's existing auto-updater is already an adequate refresh channel, since each release re-ships the data. Fetching at runtime would add a network dependency, a cold-cache hole on first offline run for a validation-gating field, and third-party availability risk, in exchange for a refresh cadence faster than the data changes. Compounding it: no good free API serves ISO 3166-2 subdivisions (restcountries has countries but no subdivisions; GeoNames requires an account and rate-limits), so an API design would still bundle half the dataset.

NFR6 ("zero new dependencies") is preserved literally: this is a generated data file plus a documented dev-only regeneration script — no runtime crate, no npm package, no build-time fetch. Regeneration is a deliberate, reviewable commit.

**Display names come from the dataset's EN and FR fields**, not from i18n keys. Only the field labels are i18n keys — 5,000 hand-written translations would be untenable.

**Deferred: `geo_catalog.rs`** on the `maintenance/catalog.rs` fetch-and-cache pattern, for per-country data that genuinely is volatile (tax rules, currency metadata, holiday calendars). That is where TTL machinery earns its complexity; static ISO codes do not.

**Note for FR5 consumers:** the finance module is currently Canada-specific underneath (TFSA/RRSP/FHSA account types, CAD/USD with no FX conversion, Canadian tax logic). Consumers of `birth_date` for TFSA contribution room MUST gate on `country_code == "CA"` and degrade otherwise. The profile is what makes that gating possible, which is itself an argument for capturing `country_code` ahead of any international tax features.

**Date of birth validation** (in `profile_store.rs`, returning `AppError::Validation { field }`): parseable as ISO 8601 `YYYY-MM-DD`, not in the future, and implied age between 18 and 120.

**D9 · Lifecycle: excluded from backup, included in delete-all.**

- **Backup/restore: no code change.** `export_backup` copies `nkbaz-finance.db` only, so profiles are excluded automatically. `restore_from_file` swaps that same file, so profiles survive a restore untouched — which is also the desirable semantic: restoring a financial backup should not change who you are.
- **Delete-all: explicit.** `danger_zone` must remove the entire `app_data_dir/profiles/` directory. Because this store is invisible to the `WIPE_TABLES` / `PRESERVED_TABLES` coverage test, that machine-checked safety net does not apply — a dedicated test asserting the profiles directory is empty after delete-all is **required, not optional**.

**D10 · No audit logging for profile mutations.**

`insert_audit_log` requires a `Connection` and an `i64 entity_id`; a file-backed store has neither. This is consistent with both precedents — `credentials.rs` and `catalog.rs` mutate user-scoped state without audit entries. Project rule 3 governs SQLite domain mutations, which this no longer is.

**Beneficial side effect:** with no audit rows, profile values never enter `nkbaz-finance.db` at all, so they cannot leak into a backup through the audit trail. D9's requirement holds structurally rather than by careful scrubbing.

### Confidentiality & Data-at-Rest

- Profile documents are **plaintext JSON** with permissions restricted to the owning user (0600 on macOS; inherited user-profile ACLs on Windows), written via the atomic-write pattern already used by `maintenance/catalog.rs`.
- **This matches the existing project threat model, deliberately.** `nkbaz-finance.db` in the same directory is unencrypted and holds every transaction, balance, and net-worth figure — materially more sensitive than a name, a birthdate, a country, and a coarse income range. Encrypting only the profile would harden the least sensitive data while leaving the most sensitive in cleartext.
- The real protection boundary is OS-level: user-scoped file permissions plus full-disk encryption (FileVault / BitLocker). Recorded so this is an accepted position, not an unexamined default.
- **Rejected: OS keyring storage.** Windows caps credential blobs at 2,560 bytes, and keyring entries cannot be enumerated — making "delete every profile" impossible without maintaining a separate index of `sub` values, which defeats NFR4 and D9.
- **Deferred as a separate project-level decision: encryption at rest** covering `nkbaz-finance.db` and the profile store together. That is the coherent way to address confidentiality at rest; it is explicitly out of scope here and recorded so the concern is on file rather than dismissed.

### Authentication & Security

**D3 · The `sub` is resolved in Rust and never crosses IPC.**

`commands/profile.rs` obtains the current subject itself; `sub` is **not** added to `AuthState` and is **never** a command parameter. If the frontend could supply a `sub`, NFR3 account isolation would be a convention rather than an invariant.

To avoid duplicating the load/validate/refresh logic already in `get_auth_session`, `commands/auth.rs` gains one internal helper:

```rust
pub(crate) async fn current_subject() -> Result<String, AppError>
```

It follows the same keyring-load-and-refresh path and returns the `id_token` `sub` claim, or `AppError::Auth { recoverable: true }` when the state is `LoggedOut` or `SessionExpired`. This also retires the existing `#[allow(dead_code)]` on the `sub` extraction in `auth.rs` by giving it a real consumer.

**D6 · Sign-out retention: profile documents remain on disk.**

There is no cloud copy of this data. Purging on sign-out would permanently destroy a user's birthdate and bracket every time they signed out — unacceptable loss for a convenience gain. Documents persist keyed by `sub`, so signing back in restores the profile intact, and signing in as a different account surfaces that account's own document.

**Accepted cost:** on a shared device, a previous account's profile remains readable on disk by anyone with access to that OS user account. Mitigated by delete-all coverage (D9); a per-account purge affordance is listed as deferred.

**D13 · Errors: reuse, don't extend.** `AppError::Auth { message, recoverable }` for no-session, `AppError::Validation { message, field }` for field errors, `AppError::File` for IO failures. No new `AppError` variant is introduced.

### API & Communication Patterns

**D4 · Two commands, whole-document semantics.**

```rust
#[tauri::command(rename_all = "snake_case")]
pub async fn get_user_profile(app: AppHandle) -> Result<Option<UserProfile>, AppError>

#[tauri::command(rename_all = "snake_case")]
pub async fn save_user_profile(
    app: AppHandle,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<String>,
    income_bracket: Option<String>,
    income_bracket_currency: Option<String>,
    country_code: Option<String>,
    subdivision_code: Option<String>,
) -> Result<UserProfile, AppError>
```

No `create` / `update` pair: a document either exists or doesn't, and a single whole-document write covers both. `get_user_profile` returns `None` (→ `null`) when no document exists, and the form renders empty. Arguments are flat scalars per the `commands/account.rs` convention, with the `UpdateUserProfileInput` struct assembled inside the command. Both are `async` because `current_subject()` may refresh tokens.

Commands orchestrate only — `profile_store.rs` owns all file IO and validation, mirroring the `commands/` → `db/` separation mandated by project rule 3.

A read-only command supplies the location dataset to the form:

> **Superseded — see "Corrections to Prior Decisions" in Implementation Patterns.** The single `get_location_catalog` below is replaced by `get_countries()` and `get_subdivisions(country_code)`. Do not implement `get_location_catalog`.

```rust
#[tauri::command(rename_all = "snake_case")]
pub fn get_location_catalog() -> Result<LocationCatalog, AppError>
```

It reads the bundled generated dataset (no IO, no network) and is not session-gated — the country list is not user data.

### Frontend Architecture

**D1 · Dedicated `/profile` route — `apps/desktop/src/routes/profile.tsx`.**

This **explicitly overturns Story 27.3's decision** not to create `routes/profile.tsx`. That decision was correct for a three-line read-only panel; this is a multi-field validated form. Recorded as a deliberate reversal, not a silent divergence.

Rule D8 is respected: `/profile` sits outside the four-destination IA, exactly as `/settings` does. It is not added to `AppSidebar` or `DestinationNav`.

**Rejected: a section inside the settings route.** `/settings/ai-provider` switches four sub-surfaces via a `?section=` search param because `routeTree.gen.ts` cannot be hand-extended. Adding Profile there would place a session-gated segmented-nav item that appears and disappears inside a route that is otherwise session-agnostic.

**The guard lives in the route, not the menu.** `/profile` is a real URL reachable by back-button or direct navigation, so the route itself renders a "sign in required" state whenever `useAuthSession()` is not `LoggedIn`. Hiding the menu entry is UX, not enforcement — the Rust-side `current_subject()` check is the actual boundary.

**D5 · Query-cache isolation on session change.**

`queryKeys.profile = ["profile"] as const` in `lib/constants.ts` (top-level and flat, matching the dominant convention rather than the nested `auth.session` outlier).

`useSignOut` and the `auth:callback-received` handler in `useAuth.ts` must call **`queryClient.removeQueries({ queryKey: queryKeys.profile })`** — not `invalidateQueries`. Invalidation keeps stale data rendered while refetching, which would briefly show one account's name to another. This is the only place in the feature where account isolation can be broken by frontend code, so it is a hard requirement.

**D11 · `ProfileMenu` adds a navigation `Link` only — no new `invoke`.**

The "Profile" item is a router `Link` to `/profile` inside the existing `DropdownMenuContent`. Because this always-mounted component performs **no new IPC call**, no existing Playwright spec's Tauri mock requires updating — deliberately sidestepping the trap documented at `project-context.md:295`. All fetching happens inside the `/profile` route. This constraint must be preserved: do not move profile reads into `ProfileMenu`.

**Hooks:** `hooks/useProfile.ts` exporting `useUserProfile()`, `useSaveUserProfile()`, and `useLocationCatalog()`, one file per feature per the `useExpenses.ts` convention. Form state via `react-hook-form`; client-side rules are affordances only, with Rust validation as the authority.

**D12 · Shared `DatePicker` gains optional passthrough props.**

`packages/shared/src/ui/date-picker.tsx` currently exposes only `{ value, onChange, disabled, placeholder }` and sets `defaultMonth` internally, so a 1985 birthdate is unreachable. It gains optional `captionLayout`, `startMonth`, and `endMonth` props forwarded to `Calendar` (already a pass-through of `React.ComponentProps<typeof DayPicker>`). Additive and backward-compatible — existing call sites are unchanged. Reuse over duplication, per project rule 8.

**D14 · "Nixus Cloud" relabel.** `profile.signIn` → "Sign In with Nixus Cloud" / "Se connecter avec Nixus Cloud"; `auth.createAccount` → "Create Nixus Cloud Account" / "Créer un compte Nixus Cloud". Both `en.json` and `fr.json` in the same change — the locale-parity suite in `src/locales/__tests__/` fails CI on any key present in one file only. "Nixus Cloud" is untranslated in FR per NFR8.

### Infrastructure & Deployment

No change. No new AWS resources, no new external services, no new runtime dependencies, no version-bump implications beyond the normal release process. The existing Cognito user pool and custom domain (`auth.nixusapp.com`) are used exactly as they are today. The only new build-time artifact is the checked-in ISO 3166 dataset and its dev-only regeneration script.

### Decision Impact Analysis

**Implementation Sequence:**

1. `commands/auth.rs`: add `pub(crate) async fn current_subject()`, retiring the `#[allow(dead_code)]` on the existing `sub` extraction. No behavior change to existing auth commands — verify the shipped login flow still passes its E2E specs.
2. Generate and check in the ISO 3166 dataset plus its regeneration script; add the `LocationCatalog` model and `get_location_catalog` command.
3. `models/mod.rs`: `UserProfile`, `UpdateUserProfileInput`.
4. `profile_store.rs`: read/write/delete, atomic writes, `sub`-slug paths, `cognito_sub` mismatch guard, and all field validation (country/subdivision cross-validation, bracket allow-list, currency code, birthdate rules).
5. `commands/profile.rs`: `get_user_profile`, `save_user_profile`; register all new commands in `lib.rs`.
6. `danger_zone`: delete the `profiles/` directory, plus the required dedicated test.
7. `packages/shared/src/ui/date-picker.tsx`: additive passthrough props.
8. Frontend: `queryKeys.profile`, `lib/types.ts` mirrors, `hooks/useProfile.ts`, `routes/profile.tsx` with its session guard, `ProfileMenu` "Profile" `Link`.
9. `useAuth.ts`: `removeQueries` on sign-out and on `auth:callback-received`.
10. Locales: all new profile/bracket/label keys plus the D14 relabels, EN and FR together.

**Cross-Component Dependencies:**

- Step 1 unblocks steps 4–5; nothing else depends on it.
- Step 2 unblocks the form's country/subdivision fields and `profile_store.rs` validation — the same dataset is the authority on both sides, so it must be readable from Rust, not only from the frontend.
- D5's `removeQueries` requirement spans `useAuth.ts` and `useProfile.ts` — the isolation guarantee is only correct if both land together.
- D11's no-new-`invoke` constraint is what keeps the existing Playwright suite untouched. Violating it turns a contained feature into a change across every spec file.
- D9's delete-all extension is the only place the profile store touches existing behavior; everything else is purely additive.
- FR5 consumers (TFSA room, AI insight context) depend on `get_user_profile` and are **not** implemented in this pass — each must define a no-session / no-profile fallback, and Canada-specific logic must gate on `country_code == "CA"`.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

Naming, error, IPC, and query-key conventions are already dictated by `docs/project-context.md` and inherited unchanged. This section covers the decision points specific to a file-backed, session-scoped store that those rules do not address — the places where two agents would plausibly choose differently — plus two corrections to Step 4 decisions.

### Corrections to Prior Decisions

**Correction 1 — `sub` is validated, not slugged.** Step 4 (D2) specified sanitizing the `sub` into a filesystem-safe slug "using the same approach as `catalog.rs::make_slug`". That is wrong and dangerous here: slugging is a many-to-one mapping, so two distinct `sub` values could collapse to the same filename and one account would read another's profile — the exact failure NFR3 exists to prevent. `make_slug` is safe for vehicle makes (display strings, collisions harmless) and unsafe for identity keys.

Revised: `profile_store.rs` validates the `sub` against `^[A-Za-z0-9_-]{1,128}$` and uses it verbatim as the filename. Cognito subjects are UUIDs and always satisfy this. Anything else is rejected with `AppError::Validation { field: "cognito_sub" }` rather than transformed. **Validation over transformation, because transformation can collide.**

**Correction 2 — the location catalog is two commands, not one.** Step 4 specified a single `get_location_catalog`. Returning ~250 countries and ~5,000 subdivisions in one IPC payload to populate a two-field cascade is wasteful and awkward for the UI. Revised:

- `get_countries() -> Result<Vec<Country>, AppError>`
- `get_subdivisions(country_code: String) -> Result<Vec<Subdivision>, AppError>`

Both are synchronous, non-session-gated (the ISO list is not user data), and read from the same embedded dataset. `get_location_catalog` is **not** implemented.

### Naming Patterns

- **Rust module:** `src-tauri/src/profile_store.rs` — a top-level sibling to `credentials.rs`, **not** `db/profile.rs` (there is no SQLite involvement) and not a new `stores/` directory. It mirrors `credentials.rs`'s role exactly: the sole accessor for one non-SQLite, user-scoped store.
- **Store functions:** `load_profile(dir: &Path, sub: &str) -> Result<Option<UserProfile>, AppError>`, `save_profile(dir: &Path, sub: &str, input: &UpdateUserProfileInput) -> Result<UserProfile, AppError>`, `delete_all_profiles(dir: &Path) -> Result<(), AppError>`, `profiles_dir(app_data_dir: &Path) -> PathBuf`. Free functions taking an explicit directory — never resolving `app_data_dir` themselves — so they are unit-testable against a `tempfile` dir, matching how `db/backup.rs` tests are written.
- **Rust models:** `UserProfile`, `UpdateUserProfileInput`, `Country`, `Subdivision` in `models/mod.rs`, deriving exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`.
- **Commands:** `commands/profile.rs` — `get_user_profile`, `save_user_profile`, `get_countries`, `get_subdivisions`.
- **Components:** `components/profile/ProfileForm.tsx` and `components/profile/SignInRequired.tsx`, feature-grouped per the `components/{feature}/` convention. The route file itself holds no form logic.
- **Hook file:** `hooks/useProfile.ts` exporting `useUserProfile`, `useSaveUserProfile`, `useCountries`, `useSubdivisions`.
- **Query keys** in `lib/constants.ts`: `profile: ["profile"] as const`, `countries: ["countries"] as const`, `subdivisions: (countryCode: string) => ["subdivisions", countryCode] as const`. Flat and top-level, matching the dominant convention rather than the nested `auth.session` outlier.
- **i18n keys** extend the existing `profile.*` namespace (`profile.firstName`, `profile.incomeBracket`, `profile.bracketUnder50k`, …). Do **not** introduce a second namespace such as `userProfile.*` — `profile.signIn` and `profile.signOut` already live there.

### Structure Patterns

- **Dataset location:** `src-tauri/data/iso3166.json`, embedded with `include_str!` and parsed once into a `std::sync::OnceLock`. Parsing a few hundred KB on every `get_countries` call is avoidable and would be a plausible agent mistake.
- **Single source of truth.** The dataset is embedded in the Rust binary only. The frontend **must not** ship or import its own copy — it obtains countries and subdivisions solely through the two commands. Two copies would drift, and the Rust copy is the validation authority.
- **Regeneration:** `apps/desktop/scripts/generate-iso3166.mjs`, exposed as a `generate:iso3166` script in `apps/desktop/package.json`. Regenerating is a deliberate, reviewable commit — never a build step and never a runtime fetch.
- **Atomic writes:** `catalog.rs`'s private `write_json_atomic` is promoted into a new `src-tauri/src/json_store.rs` as `pub(crate)`, and `catalog.rs` is updated to use it. Two file-backed JSON stores must not carry two implementations of atomic write. `profile_store.rs` must not hand-roll `std::fs::write`.
- **Tests:** `profile_store.rs` gets `#[cfg(test)] mod tests` using `tempfile`, matching `db/backup.rs`. The profile page gets one new Playwright spec that stubs the new commands. Per D11, no existing spec is modified.

### Format Patterns

- **JSON document fields are `snake_case`** — serde default, matching the Rust struct and the project-wide "JSON / IPC fields: snake_case" rule.
- **Explicit anti-pattern:** `catalog.rs` applies `#[serde(rename_all = "camelCase")]` to `VehicleCatalogStatus`. That is a local exception and **must not be copied** into profile or location types. An agent reading `catalog.rs` as the template for this feature would plausibly inherit it.
- **Dates:** `birth_date` is an ISO 8601 `String` (`"1985-03-14"`), never a timestamp, per project rule 4.
- **Currency:** `income_bracket_currency` is an ISO 4217 uppercase code (`"CAD"`).
- **Absent values are `null`, never empty strings.** An empty text input maps to `None` before reaching Rust, so "unset" has exactly one representation. Otherwise `""` and `null` would both mean unset and every consumer would need to handle both.
- **No response wrapper.** Commands return the payload directly or `AppError`, matching every existing command.

### Communication Patterns

- **`profile_store.rs` is the sole accessor of the profiles directory**, exactly as `credentials.rs` is the sole accessor of the keyring. No command, and no other module, performs file IO under `profiles/` — including `danger_zone`, which must call `profile_store::delete_all_profiles` rather than removing the directory itself.
- **No new Tauri events.** Session changes already emit `auth:callback-received`; `useAuth.ts` reacts to it. The profile feature adds no event of its own.
- **Cache invalidation direction:** `useSaveUserProfile.onSuccess` invalidates `queryKeys.profile` only. Session transitions **remove** it (D5). Invalidate on data change, remove on identity change — these are different operations and must not be conflated.
- **`useCountries` / `useSubdivisions` use `staleTime: Infinity`.** The dataset cannot change while the app is running; refetching it is pure waste.

### Process Patterns

- **Corrupt document handling:** if a profile file exists but fails to parse, `load_profile` renames it to `<sub>.json.corrupt`, emits `tracing::warn!`, and returns `Ok(None)`. The page stays usable and the original bytes are preserved for recovery. Neither silent deletion nor a hard error is acceptable — one destroys data, the other bricks the page with no path out.
- **Missing file is `Ok(None)`, not an error.** "No profile yet" is the normal first-run state, not a failure.
- **Validation is server-authoritative.** `react-hook-form` rules exist for immediate affordance only; `profile_store.rs` re-validates everything. **Form field names are the `snake_case` IPC names** (`first_name`, `birth_date`, `country_code`), so an `AppError::Validation { field }` maps to `setError(field)` with no translation table between naming conventions.
- **Cascade reset:** changing `country_code` clears `subdivision_code` in the same form update. A subdivision from a previously selected country must never survive a country change — `profile_store.rs` would reject it, but the UI must not allow the invalid state to be submitted in the first place.
- **Loading and error states** follow existing TanStack Query handling; failures surface via `sonner` toasts as elsewhere in the app.
- **No `.unwrap()`** outside tests; `?` propagation with `AppError` throughout. No `console.log`; `tracing` on the Rust side.

### Enforcement Guidelines

**All AI agents implementing this feature MUST:**

- Route every read/write/delete under `profiles/` through `profile_store.rs` — never perform file IO on that directory from a command, from `danger_zone`, or anywhere else.
- Resolve the `sub` via `commands::auth::current_subject()` inside Rust. Never accept a `sub` as an IPC parameter, and never add it to `AuthState`.
- Validate the `sub` against the charset allow-list and use it verbatim as the filename. Never slug or otherwise transform it.
- Use `queryClient.removeQueries` — not `invalidateQueries` — for `queryKeys.profile` on every session transition.
- Add no new `invoke()` call to `ProfileMenu`, `TopBar`, or any always-mounted component.
- Add every new i18n key to both `en.json` and `fr.json` in the same change.
- Keep the ISO 3166 dataset in the Rust binary only; never ship a second copy to the frontend.
- Introduce no new `AppError` variant, no new npm package, and no new Rust crate.

### Pattern Examples

**Good:** `commands/profile.rs::save_user_profile` calls `auth::current_subject().await?`, then `profile_store::save_profile(&dir, &sub, &input)`. The command orchestrates; the store owns validation and IO.

**Anti-pattern:** `std::fs::write(app_data_dir.join("profiles").join(format!("{sub}.json")), json)` inline in a command — bypasses the sole-accessor boundary, the atomic-write helper, and `sub` validation in one line.

**Anti-pattern:** `save_user_profile(app, sub, ...)` accepting `sub` from the frontend — reduces account isolation from an invariant to a convention.

**Anti-pattern:** `queryClient.invalidateQueries({ queryKey: queryKeys.profile })` in `useSignOut` — leaves the previous account's data rendered during refetch.

**Anti-pattern:** copying `#[serde(rename_all = "camelCase")]` from `catalog.rs` onto `UserProfile`, breaking the project-wide `snake_case` IPC convention.

## Project Structure & Boundaries

### Delta to Existing Project Tree

```
apps/desktop/src-tauri/
├── Cargo.toml                      # UNCHANGED: zero new crates. `tempfile = "3"` already present.
├── data/
│   └── iso3166.json                # NEW: generated ISO 3166-1/-2 dataset, EN+FR display names.
│                                   #      Embedded via include_str!. Never fetched at runtime.
└── src/
    ├── lib.rs                      # MODIFIED: register get_user_profile, save_user_profile,
    │                               #           get_countries, get_subdivisions; declare
    │                               #           `mod profile_store;` and `mod json_store;`
    ├── json_store.rs               # NEW: pub(crate) write_json_atomic<T: Serialize>
    ├── profile_store.rs            # NEW: sole accessor of app_data_dir/profiles/
    │                               #      load_profile, save_profile, delete_all_profiles,
    │                               #      profiles_dir, sub charset validation, field validation
    ├── credentials.rs              # UNCHANGED
    ├── error.rs                    # UNCHANGED: no new AppError variant
    ├── maintenance/
    │   └── catalog.rs              # MODIFIED: private write_json_atomic removed; now uses
    │                               #           crate::json_store::write_json_atomic
    ├── models/
    │   └── mod.rs                  # MODIFIED: + UserProfile, UpdateUserProfileInput,
    │                               #           Country, Subdivision
    └── commands/
        ├── auth.rs                 # MODIFIED: + pub(crate) async fn current_subject();
        │                           #           retires #[allow(dead_code)] on sub extraction
        ├── danger_zone.rs          # MODIFIED: delete_all_data gains `app: AppHandle` and calls
        │                           #           profile_store::delete_all_profiles after wipe_all
        └── profile.rs              # NEW: get_user_profile, save_user_profile,
                                    #      get_countries, get_subdivisions

apps/desktop/
├── package.json                    # MODIFIED: + "generate:iso3166" script. No new dependencies.
├── scripts/
│   └── generate-iso3166.mjs        # NEW: dev-only regeneration of data/iso3166.json
├── src/
│   ├── lib/
│   │   ├── constants.ts            # MODIFIED: + queryKeys.profile, .countries, .subdivisions()
│   │   └── types.ts                # MODIFIED: + UserProfile, UpdateUserProfileInput,
│   │                               #           Country, Subdivision (mirror Rust shapes)
│   ├── hooks/
│   │   ├── useProfile.ts           # NEW: useUserProfile, useSaveUserProfile,
│   │   │                           #      useCountries, useSubdivisions
│   │   └── useAuth.ts              # MODIFIED: removeQueries(queryKeys.profile) on sign-out
│   │                               #           and on auth:callback-received
│   ├── components/
│   │   ├── auth/
│   │   │   └── ProfileMenu.tsx      # MODIFIED: + "Profile" DropdownMenuItem as a Link to
│   │   │                            #           /profile. NO new invoke() call.
│   │   └── profile/
│   │       ├── ProfileForm.tsx      # NEW: react-hook-form form, country→subdivision cascade
│   │       └── SignInRequired.tsx   # NEW: logged-out state for the /profile route
│   ├── routes/
│   │   └── profile.tsx              # NEW: /profile route + in-route session guard
│   └── locales/
│       ├── en.json                  # MODIFIED: profile.* form/bracket keys + D14 relabels
│       └── fr.json                  # MODIFIED: same keys, FR values (parity test enforced)
└── tests/
    └── profile.spec.ts              # NEW: Playwright spec stubbing the four new commands.
                                     #      No existing spec is modified (D11).

packages/shared/src/ui/
└── date-picker.tsx                 # MODIFIED: + optional captionLayout, startMonth, endMonth
                                    #           forwarded to Calendar. Backward-compatible.
```

**Not touched, deliberately:**

- `src-tauri/migrations/` and `db/mod.rs` `MIGRATIONS` — no schema change (D2).
- `db/danger_zone.rs` — `WIPE_TABLES` / `PRESERVED_TABLES` unchanged; the profile store is not a table.
- `db/backup.rs`, `commands/backup.rs` — backup exclusion and restore survival are structural (D9).
- `db/audit.rs` — no audit entries for profile mutations (D10).
- `components/shared/AppSidebar.tsx`, `DestinationNav.tsx`, `lib/navigation.ts` — rule D8; `/profile` is outside the four-destination IA.
- `components/auth/AccountPromptDialog.tsx` — only its i18n _values_ change (D14), not the component.
- Every existing `tests/*.spec.ts` — guaranteed by D11.

### Architectural Boundaries

**API Boundaries:**

- **External:** none. This feature makes no network call. The ISO dataset is embedded at build time; Cognito is contacted only through the pre-existing auth layer, and only when `current_subject()` needs a token refresh.
- **Internal:** `commands/profile.rs` is the only module invoking `auth::current_subject()` for profile purposes. `profile_store.rs` is the only module performing IO under `profiles/`. Neither boundary is crossed by any other file.

**Component Boundaries:**

- `ProfileMenu` is a pure navigation surface for this feature — it holds no profile state and makes no profile IPC call. `ProfileForm` and `SignInRequired` are the only components consuming `useProfile.ts`.
- `routes/profile.tsx` owns the session branch: `LoggedIn` → `ProfileForm`, anything else → `SignInRequired`. Neither child re-checks session state, so there is one decision point rather than two that can disagree.
- `useProfile.ts` is the sole frontend module invoking `get_user_profile`, `save_user_profile`, `get_countries`, `get_subdivisions`. No component calls `invoke` directly.

**Data Boundaries:**

- Profile data lives **only** in `app_data_dir/profiles/<sub>.json`. Never in SQLite, never in the keyring, never in `localStorage`/`sessionStorage`.
- Session tokens remain exclusively in the keyring via `credentials.rs`. The two stores share the `sub` as a join key and nothing else.
- Email is never persisted — read from `id_token` claims at request time.
- The ISO dataset is read-only, embedded, and identical for every account. It is the validation authority in Rust and a display source in the frontend; the frontend holds no second copy.
- `nkbaz-finance.db` is untouched by this feature. That is what makes backup exclusion structural rather than enforced by scrubbing.

### Requirements to Structure Mapping

| Requirement | Frontend | Rust Command | Supporting Module |
| --- | --- | --- | --- |
| FR1: Dropdown → Profile entry point | `ProfileMenu.tsx` (Link only) | — | — |
| FR2: View/edit profile fields | `routes/profile.tsx`, `ProfileForm.tsx`, `useProfile.ts` | `get_user_profile`, `save_user_profile`, `get_countries`, `get_subdivisions` | `profile_store.rs`, `data/iso3166.json` |
| FR3: Local persistence per `sub` | — | `save_user_profile` | `profile_store.rs`, `json_store.rs` |
| FR4: Auth required; per-account isolation | `routes/profile.tsx` guard, `SignInRequired.tsx`, `useAuth.ts` (`removeQueries`) | `current_subject()` in every profile command | `profile_store.rs` sub validation + `cognito_sub` mismatch guard |
| FR5: Available to other modules | not in this pass | `get_user_profile` | consumers must gate on `country_code == "CA"` for Canadian logic |
| FR6: Sync-shaped, sync not built | — | — | JSON document + `schema_version` |
| FR7/FR8: "Nixus Cloud" relabel | `en.json`, `fr.json` | — | — |
| NFR4: delete-all coverage | — | `delete_all_data` (+ `AppHandle`) | `profile_store::delete_all_profiles` + dedicated test |

**Cross-Cutting Concerns:**

- Identity: `commands/auth.rs::current_subject()` — the single resolution point.
- Atomic file writes: `json_store.rs` — shared by `profile_store.rs` and `catalog.rs`.
- Account isolation: enforced in Rust (`current_subject`, sub validation, `cognito_sub` mismatch guard) and in the frontend cache (`removeQueries`). Both layers required.
- i18n: `locales/en.json` + `locales/fr.json`, parity-tested.

### Integration Points

**Internal Communication:**

- Frontend → Rust: `invoke()` for the four new commands, via `useProfile.ts` only.
- Rust → Frontend: no new events. The existing `auth:callback-received` event drives profile cache removal through `useAuth.ts`.
- Rust → Rust: `commands/profile.rs` → `auth::current_subject()` → `credentials.rs` (keyring); `commands/profile.rs` → `profile_store.rs` → `json_store.rs` (filesystem).

**External Integrations:** none new. Cognito is reached only via the existing refresh path.

**Data Flow (read):** `/profile` route mounts → `useUserProfile()` → `get_user_profile` → `current_subject()` (keyring load, refresh if needed) → `profile_store::load_profile(dir, sub)` → `Option<UserProfile>` → form renders populated or empty.

**Data Flow (write):** `ProfileForm` submit → `useSaveUserProfile` → `save_user_profile` → `current_subject()` → `profile_store::save_profile` (validate → merge → `updated_at` → `json_store::write_json_atomic`) → `UserProfile` returned → `invalidateQueries(profile)`.

**Data Flow (identity change):** sign-out or `auth:callback-received` → `useAuth.ts` `removeQueries(queryKeys.profile)` → next `/profile` visit refetches for the new `sub`.

### File Organization Patterns

- **Configuration:** none. No new env vars, no new secrets, no new `tauri.conf.json` or capability entries — this feature adds no plugin and no permission.
- **Source organization:** exactly the existing conventions — `commands/{feature}.rs`, `components/{feature}/`, `hooks/use{Feature}.ts`, `routes/{feature}.tsx`. The only new organizational element is `src-tauri/data/`, justified by `include_str!` needing a checked-in file.
- **Test organization:** Rust unit tests inline via `#[cfg(test)] mod tests` with `tempfile` (matching `db/backup.rs`); one new Playwright spec in `tests/`; locale parity covered automatically by the existing suite in `src/locales/__tests__/`.
- **Asset organization:** no new static assets. `CircleUser` and any needed icons already exist in the bundled icon set.

### Development Workflow Integration

- **Dev server:** unchanged. `routes/profile.tsx` regenerates `routeTree.gen.ts` on the next dev/build run — never hand-edited.
- **Build:** `include_str!` pulls `data/iso3166.json` into the binary at compile time, so the dataset ships with the app and needs no packaging step.
- **Deployment:** unchanged. No infrastructure, no migration to run on upgrade. Because there is no schema change, downgrading to a prior app version leaves profile documents untouched and simply ignored.
- **Regeneration:** `pnpm --filter @nixus/desktop generate:iso3166` produces a reviewable diff on `data/iso3166.json`. Never wired into build or CI.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** The decisions form one consistent chain — session-gated route → Rust-resolved `sub` → validated filename → JSON document under `app_data_dir` → atomic write via a shared helper → TanStack Query cache removed on identity change. No step depends on a component not already decided. The one place two decisions initially pulled against each other (audit logging mandated by project rule 3 vs. a non-SQLite store) was resolved explicitly in D10 rather than left ambiguous.

**Pattern Consistency:** Naming, error handling, IPC field casing, and query-key conventions are inherited from `docs/project-context.md` rather than invented. Two divergence risks were caught and made explicit: `catalog.rs`'s `camelCase` serde exception (must not be copied) and `catalog.rs::make_slug` (must not be reused for identity keys — Correction 1).

**Structure Alignment:** The delta tree slots into existing directories with one new element (`src-tauri/data/`), justified by `include_str!`. Boundaries are structurally enforced rather than merely documented: `profile_store.rs` as sole directory accessor, `current_subject()` as sole identity resolver, `useProfile.ts` as sole `invoke` caller.

**Verified technical assumption:** `react-day-picker` is `^9.14.0` in both `packages/shared/package.json` and `apps/desktop/package.json`, so D12's `captionLayout` / `startMonth` / `endMonth` are the correct v9 prop names (v8's `fromDate`/`toDate`/`fromYear`/`toYear` do not apply).

### Requirements Coverage Validation ✅

**Functional Requirements:**

- FR1 (dropdown entry point) → `ProfileMenu` `DropdownMenuItem` rendering a `Link` ✅
- FR2 (view/edit fields) → `/profile` route + `ProfileForm` + four commands ✅
- FR3 (local per-`sub` persistence) → `profile_store.rs` + `json_store.rs` ✅
- FR4 (auth required, per-account isolation) → route guard + `current_subject()` + sub validation + `cognito_sub` mismatch guard + `removeQueries` ✅
- FR5 (available to other modules) → `get_user_profile`; consumers deferred with a documented `country_code == "CA"` gating requirement ✅
- FR6 (sync-shaped, sync unbuilt) → JSON document + `schema_version` ✅
- FR7/FR8 ("Nixus Cloud" relabel, copy stays accurate) → locale changes only ✅

**Non-Functional Requirements:**

- NFR1 (local-first app preserved) → no network call; app fully functional without a profile ✅
- NFR2 (nothing leaves the machine) → zero external calls ✅
- NFR3 (account isolation) → enforced at three layers (Rust identity, filename validation, in-document `cognito_sub` guard) plus frontend cache removal ✅
- NFR4 (delete-all coverage, no PII survives) → gap found and closed, see G2 below ⚠️→✅
- NFR5 (EN/FR i18n) → gap found and closed, see G6 below ⚠️→✅
- NFR6 (zero new dependencies) → verified: `tempfile = "3"` already present; `Cargo.toml` and `package.json` dependency lists unchanged ✅
- NFR7 (multi-account residency) → D6 decided explicitly with its cost recorded ✅
- NFR8 (brand-term consistency) → D14 + follow-on alignment noted as deferred ✅

### Implementation Readiness Validation ✅

**Decision Completeness:** All fourteen decisions carry rationale, and rejected alternatives are recorded with reasons (SQLite + backup surgery, OS keyring, runtime geo API, settings sub-surface). No "TBD" remains on a critical item.

**Structure Completeness:** The delta tree specifies every new and modified file down to function names, plus an explicit "not touched, deliberately" list — which is what prevents an agent from helpfully adding a migration or a `WIPE_TABLES` entry that must not exist.

**Pattern Completeness:** Naming, structure, format, communication, and process patterns are each covered, with concrete anti-patterns drawn from real code an agent would plausibly copy.

### Gap Analysis Results

**Critical Gaps (found and closed in place):**

**G1 — Replace vs. merge was ambiguous, and both readings were defensible.** D4 called the command "whole-document semantics" while the Step 6 data flow said "validate → merge". Two agents would implement two different behaviours, and the difference is user-visible: does `None` mean "clear this field" or "leave it alone"?

**Resolved: `save_user_profile` is a full replace.** The form always submits every field, so `None` means the field is cleared. Partial updates are not supported. `created_at` is the only value carried over from an existing document; `updated_at` is always set to now. If a partial-update need ever appears, it requires a new command, not an overloaded one.

**G2 — `.corrupt` and `.tmp` files would survive delete-all, violating NFR4.** The Step 5 corrupt-document pattern renames a bad file to `<sub>.json.corrupt`, and `write_json_atomic` writes a `.json.tmp` sibling that survives a mid-write crash. A `delete_all_profiles` implemented as "delete every `*.json`" would leave PII on disk after the user asked for everything to be deleted — the precise failure NFR4 exists to prevent, and one this document's own Step 5 pattern introduced.

**Resolved:** `delete_all_profiles` removes the **entire `profiles/` directory recursively** (`std::fs::remove_dir_all`, treating "already absent" as success), not a glob of `.json` files. The required delete-all test asserts the directory does not exist or is empty — not merely that no `.json` files remain.

**G3 — D7's currency default is unimplementable.** It specified defaulting `income_bracket_currency` to "the app's current display currency". No such value exists: the `config` table holds only `ai_provider`, `ai_configured`, `aws_region`, `onboarding_completed`, and `emergency_fund_target`; `useFormatCurrency` formats by locale (`en-CA` / `fr-CA`), not by a stored currency; and currency is a per-account property (CAD/USD) with no app-level notion and no FX conversion anywhere.

**Resolved:** `income_bracket_currency` is an **explicit field in the form**, a `Select` of ISO 4217 codes, with no derived default. It is **conditionally required**: setting `income_bracket` without `income_bracket_currency` is rejected as `AppError::Validation { field: "income_bracket_currency" }`. This mirrors the existing subdivision-without-country rule, giving the store one consistent conditional-requirement pattern rather than two ad-hoc ones. A currency without a bracket is permitted and inert.

**Important Gaps (found and closed in place):**

**G4 — The route guard was specified as a binary branch, but `AuthState` has three states plus a loading state.** As written, a signed-in user navigating directly to `/profile` would see a flash of "sign in required" while `useAuthSession` resolves, and `SessionExpired` had no defined rendering at all — while `current_subject()` returns `Err` for it, so the form would fail to load.

**Resolved:** `routes/profile.tsx` branches four ways — `isLoading` → skeleton (never `SignInRequired`); `LoggedIn` → `ProfileForm`; `LoggedOut` → `SignInRequired`; `SessionExpired` → `SignInRequired` with the existing `profile.sessionExpiredAction` copy. `ProfileMenu` already models a loading state, so this follows an established precedent rather than inventing one.

**G5 — `created_at` preservation was implied but never stated.** Under full-replace semantics (G1) an agent could plausibly regenerate `created_at` on every save, silently destroying it. **Resolved:** `save_profile` reads any existing document first and carries `created_at` forward verbatim; it is set only when the document is first created.

**G6 — French display names for ISO subdivisions will be incomplete.** No public ISO 3166-2 source provides FR names for every subdivision, so the dataset will have gaps — which would render as blank options in the FR locale, breaking NFR5 in practice rather than in principle. **Resolved:** the dataset carries `name_en` (required) and `name_fr` (optional); the frontend falls back to `name_en` when `name_fr` is absent. The regeneration script must guarantee `name_en` is always populated.

**G7 — `DropdownMenuItem` composition was unspecified.** Nesting an anchor inside a menu item breaks keyboard semantics with `@base-ui/react`. **Resolved:** use the established `render` prop pattern already used by `SegmentedNavItem` — `<DropdownMenuItem render={<Link to="/profile" data-testid="profile-menu-profile" />}>` — rather than wrapping or nesting.

**Regression Checks Required (inspected, low risk, must still be run):**

- `tests/auth.spec.ts` asserts on `profile-menu-panel`, `profile-menu-email`, `profile-menu-name`, and `profile-menu-sign-out` by `data-testid`, and its one count assertion (`profile-menu-name` → `toHaveCount(0)`) is unaffected by an added item. No assertion enumerates dropdown children generically, so adding the Profile item should not break it — **verify, do not assume.**
- `accessibility.spec.ts`, `navigation.spec.ts`, and `nav-qa.spec.ts` may enumerate routes or links. Adding `/profile` must be checked against them.
- `delete_all_data` gains an `AppHandle` parameter. Tauri injects it, so `invoke("delete_all_data")` is unchanged on the frontend — but any existing Rust test or direct caller of that function must be located and updated.
- `catalog.rs` loses its private `write_json_atomic` to `json_store.rs`. Its existing tests must still pass unchanged; this is a pure move, not a behaviour change.

**Nice-to-Have Gaps (accepted, not addressed):**

- No per-account "remove this account's profile from this device" affordance (deferred with D6).
- `.corrupt` files accumulate silently with no UI surfacing recovery. Acceptable: the alternative is a user-facing error state for a condition that should never occur.
- No migration path defined for `schema_version` 2 — correct to defer, since there is no second version to migrate to.

### Validation Issues Addressed

Three critical and four important gaps were fixed in place during this pass rather than deferred. Two were errors in this document's own earlier steps: G1 (contradictory replace/merge wording across Steps 4 and 6), and G2 (a data-retention hole created by Step 5's own corrupt-file pattern). G3 was an assumption about the codebase that turned out to be false on inspection. This is recorded rather than quietly corrected so future readers can see which decisions were revised and why.

### Architecture Completeness Checklist

**Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified (verified against code, not assumed)
- [x] Cross-cutting concerns mapped

**Architectural Decisions**

- [x] Critical decisions documented with rationale
- [x] Technology stack fully specified; versions verified where relied upon
- [x] Integration patterns defined
- [x] Rejected alternatives recorded with reasons

**Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented
- [x] Anti-patterns drawn from real code in this repo

**Project Structure**

- [x] Complete delta tree defined
- [x] "Not touched, deliberately" list defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High. The feature is well-bounded, adds no dependencies and no network surface, builds entirely on shipped auth infrastructure, and every non-obvious decision was checked against the actual codebase rather than assumed. Confidence is high _because_ validation found seven real gaps and closed them, not despite it.

**Key Strengths:**

- Zero new dependencies and zero new network surface — the smallest possible blast radius.
- Backup exclusion and restore survival are **structural consequences** of the storage choice rather than behaviours maintained by careful code, so they cannot regress.
- Account isolation is enforced in Rust at three independent points; the frontend cannot weaken it.
- D11's no-new-`invoke` constraint keeps the entire existing Playwright suite untouched, turning what could have been a repo-wide change into a contained one.

**Areas for Future Enhancement:**

- The JSON document is already shaped as a Nixus Cloud sync payload; adding sync should need no change to the storage layer, only a transport.
- `country_code` is the hook that makes country-gated financial logic possible, which the app will need as it expands beyond Canada.
- Encryption at rest, if pursued, should cover `nkbaz-finance.db` and the profile store together — never the profile alone.

### Implementation Handoff

**AI Agent Guidelines:**

- Follow the decisions in this document exactly, and read the "Corrections to Prior Decisions" and "Gap Analysis Results" sections — several Step 4 and Step 6 statements are superseded there.
- Never accept a `sub` over IPC; never slug it; never touch `profiles/` outside `profile_store.rs`.
- Use `removeQueries` for profile cache on session change, never `invalidateQueries`.
- Add no `invoke()` call to any always-mounted component.
- Introduce no new dependency, no new `AppError` variant, and no SQLite migration.

**First Implementation Priority:**

`commands/auth.rs::current_subject()` — it has no dependency on anything else in this feature, unblocks all four commands, and its correctness is the foundation of NFR3. Verify the shipped login flow's E2E specs still pass immediately after it lands, before building anything on top.

---

## Amendment (2026-08-10): one FR5 consumer pulled into scope

During epic planning (`epics-user-profile.md`), a product decision amended this document's position that FR5 consumers are "not implemented in this pass."

**Amended:** one thin consumer is now in scope — a **cumulative lifetime TFSA limit** display on the profile surface, adjacent to the date-of-birth field. Rationale: as originally scoped, this feature asked users for a birthdate and an income range while returning nothing, which is the standard profile-completion failure mode. Showing the derived figure at the moment the data is requested makes the value of providing it self-evident.

**Requirements added in `epics-user-profile.md`** (FR9, FR10, NFR9), summarized:

- Displayed only when `country_code == "CA"` and `birth_date` is set.
- Computes the sum of annual CRA TFSA limits from the year the user turned 18 (or 2009, whichever is later) through the current year. Amounts are `i64` cents per project rule 1.
- **Explicitly labelled as accumulated limit, not remaining room.** Remaining room requires lifetime contribution and withdrawal history, which nixus does not track. TFSA account balances must **not** be subtracted — a balance includes market growth and ignores withdrawals, so the result would be wrong in both directions.
- The annual-limits table is a checked-in Rust const declaring an explicit "known through year N" bound. Past that bound the figure is withheld, never extrapolated. Refreshed via app release, like the ISO 3166 dataset — but note it changes most years, unlike ISO codes.
- Degrades silently on missing date of birth, missing country, non-CA country, or a year beyond the table bound.

**Unaffected:** every storage, isolation, lifecycle, and boundary decision in this document stands unchanged. The TFSA module is a pure read-side consumer of `get_user_profile` and introduces no new storage, no new dependency, and no new network surface.

---

## Amendment (2026-08-11): FR9's placement moved off the profile surface, and a balance display gate added

Post-implementation product decision, superseding the placement half of the 2026-08-10 amendment.

**Placement moved.** The accumulated-TFSA-room figure no longer renders on `/profile`. It now renders on the two guidance surfaces:

- `/wealth/where-to-put-your-money` — `components/financial-health/TfsaRoomPanel.tsx`, a Card beside `ActionWaterfall`, `EmergencyFundPanel` and `SavingsCapacityPanel`.

The profile form now ends at Save: email (read-only), first name, last name, date of birth, income bracket, income currency, country, subdivision.

**Balance display gate added.** The figure is shown only when the user's total **CAD** TFSA account balance is strictly lower than the accumulated room. `balance >= room` withholds it silently.

- It is a **heuristic filter, not a calculation.** It does not prove room remains: someone could have contributed the maximum and then lost money in the market. So no difference, no subtraction, no remaining-room figure, and not the balance itself may be displayed — only the accumulated total, with the existing accumulated-not-remaining caption unchanged. The "balances must not be subtracted" prohibition above stands in full.
- **Currency correctness.** The accumulated limit is CAD, and Nixus never converts currencies, so the comparison sums only accounts with `account_type = 'tfsa' AND currency = 'CAD'`. `db/net_worth.rs`'s `tfsa_cents` is explicitly not reused — it ignores `currency`.

**Layering.** The gate lives in the **command layer**, which orchestrates: resolve session → load profile → compute the room via the pure `tfsa/` calculator → read the CAD TFSA balance via a new `db/account.rs::get_cad_tfsa_balance_cents` → return `None` if the gate fails. `src-tauri/src/tfsa/` remains pure: no `DbState`, no `Connection`, no `crate::db::`, no balance awareness. `get_tfsa_accumulated_limit` was extended rather than duplicated (nothing else consumed the ungated value); it gained a `State<'_, DbState>` parameter and keeps its name, `async`ness and `Result<Option<TfsaAccumulatedLimit>, AppError>` return.

**Unchanged.** Every Story 30.2 degradation rule still holds and the balance gate is one more silent-withholding condition beside them. Both target surfaces are reachable without a session, so the session-requiring command's `AppError::Auth` rejection must also be silent — no toast, no banner, no retry affordance. No migration, no new table, no audit-log call, no new dependency, no new i18n key: the three `profile.tfsa*` keys are reused verbatim.

### Amendment (2026-08-11, second revision): Insights placement reverted

The `/insights/trends` hint (`TfsaRoomHint.tsx`) was implemented and then **removed at the user's direction**: accumulated TFSA contribution room is not a spending trend, so a lifetime-limit figure above a monthly-spend chart is a category error regardless of how honestly it is captioned.

`/wealth/where-to-put-your-money` is now the figure's **only** home, sitting beside the "Contribute to registered accounts (TFSA/RRSP/FHSA)" waterfall rung it actually informs.

**Accepted consequence, recorded deliberately:** that surface is gated on three finished months of spending data, so a brand-new user who completes their profile sees no payoff for supplying a date of birth until they have imported enough history. This was the trade-off the Insights placement existed to avoid; it is accepted in exchange for the figure appearing only where it is actionable. If the empty-payoff problem later proves real, the correct fix is a placement on a wealth or dashboard surface that is not data-gated — not a return to Insights.

`components/financial-health/TfsaRoomHint.tsx` is deleted, `routes/insights.trends.tsx` is reverted to its pre-feature state, and the Insights assertions in `tests/tfsa-room.spec.ts` are removed. The wealth-surface coverage and the full Story 30.2 degradation matrix remain intact at 20 tests. No i18n key was orphaned — all three `profile.tfsa*` keys are still consumed by `TfsaRoomPanel.tsx`.
