---
stepsCompleted: [1, 2, 3]
inputDocuments:
  [
    '_bmad-output/specs/spec-local-profiles-nixus-cloud/SPEC.md',
    '_bmad-output/specs/spec-local-profiles-nixus-cloud/brownfield.md',
    '_bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md',
    '_bmad-output/planning-artifacts/architecture-login.md',
    '_bmad-output/planning-artifacts/architecture-user-profile.md',
    '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md',
    '_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/EXPERIENCE.md',
  ]
---

# nixus - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the **Local Profiles & Nixus Cloud (Step 1)** feature, decomposing `SPEC.md`'s capabilities and `ARCHITECTURE-SPINE.md`'s architectural decisions into implementable stories. No formal PRD exists for this feature — it was scoped via `bmad-spec` (capabilities CAP-1..CAP-6 below serve as the functional requirements) and `bmad-architecture` (14 ADs, feature-altitude spine).

## Requirements Inventory

### Functional Requirements

FR1 (CAP-1): On every app launch, before reaching the dashboard, the user is presented with a dedicated, chrome-free picker screen — no sidebar/top bar, styled consistently with the rest of the app — listing every local profile on this machine, plus a "Log in with Nixus Cloud" action. No launch path bypasses it; there is no "remember last profile" shortcut.

FR2 (CAP-2): On first launch after this feature ships, an existing user's entire current dataset (finance, car, settings, onboarding state) is automatically migrated, with no user action, into a profile named "Default" that appears in the picker — nothing missing, nothing duplicated, app behaves exactly as before once opened.

FR3 (CAP-3): A user can have more than one local profile on one machine, each with a completely isolated dataset (finance, car, settings, onboarding state, and its own AI-provider/keyring credentials); switching profiles never mixes or leaks data or credentials between them.

FR4 (CAP-4): From the picker, choosing "Log in with Nixus Cloud" runs the existing, unmodified Cognito sign-in/sign-up flow and lands the user on a local profile associated with that Nixus Cloud account. Completing sign-in adds (or reopens) a profile tagged to that account; signing in again with the same account reopens that same profile rather than duplicating it.

FR5 (CAP-5): From within an active local (not yet cloud-linked) profile, the top-right account menu offers "Migrate to Nixus Cloud" in place of today's "Sign In with Nixus Cloud" entry point. It runs the same unchanged Cognito flow and, on success, creates a new, separate profile linked to that account containing a copy of the local profile's data as of that moment — the original profile is left untouched and remains in the picker as a fallback. Later signing out of that Nixus Cloud account leaves the migrated profile marked cloud-linked-but-signed-out (never reverts to plain local); signing back in with the same account reattaches it.

FR6 (CAP-6): From the picker screen, a user can manually create a new, empty, unlinked local profile beyond Default and any cloud-derived ones, immediately usable and switchable like any other profile.

### NonFunctional Requirements

NFR1: No data leaves the machine, for any profile including cloud-linked ones — no network call transmits financial, car, or profile data anywhere. The only network calls this feature makes are Cognito's existing `/oauth2/authorize` and `/oauth2/token` endpoints (ARCHITECTURE-SPINE.md AD-14).

NFR2: The existing Cognito PKCE flow (`start_login`/`complete_auth_callback`/`get_auth_session`/`sign_out`, loopback-redirect callback) is reused exactly as-is for both "Log in with Nixus Cloud" and "Migrate to Nixus Cloud" — no change to the Cognito hosted UI, app client, scopes, or OAuth grant (AD-11).

NFR3: The existing demographic "Profile" feature (name/DOB/income/location, keyed by Cognito `sub`, at `/profile`) is a distinct concept from the new "local profile" (dataset-selection) concept and must never be confused in naming, code, or UI copy (AD-13).

NFR4: The picker screen's visual style must match the existing app's design system (dark theme, `@nixus/shared/ui` primitives, per DESIGN.md/EXPERIENCE.md) — not a generic OS-native or unstyled dialog. It is a dedicated, chrome-free view, not a route rendered inside the existing app shell (AD-14).

NFR5: Migration of the existing single dataset into "Default" is fully automatic, one-time, and lossless, with zero file movement (AD-2, AD-4).

NFR6: Existing single-profile users are never forced through Cognito or required to create a Nixus Cloud account to keep using the app exactly as before.

NFR7: Local-profile identity is a new, purely local concept, independent of the Cognito `sub` — a cloud-linked profile records the `sub` as an attribute, never as its identity/directory key (AD-2).

NFR8: AI-provider credentials and other keyring-backed settings are per-profile — switching profiles never exposes one profile's AI/API keys to another (AD-8).

NFR9: The picker is shown on every launch unconditionally — no "last used profile" memory or skip-ahead shortcut (AD-14).

NFR10: No `select_dataset` (switch), backup, danger-zone, or import operation may ever target Default's directory as a whole (only specifically named files within it) — the registry and every other profile live in that same directory and must never be at risk (AD-2, AD-5).

### Additional Requirements

- **Path authority (AD-5):** All `app_data_dir` resolution funnels through `datasets.rs`'s three functions (`global_root()`, `dataset_dir(app, id)`, `active_dataset_dir()`) — the 7 existing independent call sites (`lib.rs`, `backup.rs`, `danger_zone.rs`, `profile.rs`, `import.rs`, `maintenance.rs`, `mod.rs::get_db_status`) are all re-pointed, not just the 5 originally known.
- **Active-dataset state (AD-6a/6b/6c):** `DbState` becomes `Mutex<ActiveDataset{id, conn}>` — no connection exists before a profile is selected; ~125 existing `State<DbState>` access sites gain a guard. Switching is all-or-nothing (open+migrate the target before swapping) and always emits `dataset:switched { dataset_id, kind }`, including the first selection of a run.
- **Registry (AD-3):** `datasets.json` at the global root is the picker's sole source of truth, one schema, one writer lock (shared with `select_dataset` and the OAuth-callback writer), with explicit missing-vs-corrupt handling and per-read id re-validation.
- **Login/Migrate branching (AD-11/AD-12):** `start_login` carries a `LoginIntent` (`Login` | `Migrate{source_id}`) bound to the existing `auth_listener.rs` PKCE-attempt lifetime. Login finds-or-creates a cloud-linked dataset by `cognito_sub` (most-recent tie-break). Migrate copies the source `.db` file (post-`wal_checkpoint`, main file only) and its per-dataset AI-provider keyring entries into a new dataset, aborting if the source is no longer active when the callback resolves.
- **Keyring naming (AD-8):** AI/AWS key service name is the unchanged literal `"Nixus"` for Default, `"Nixus-<uuid>"` for every other dataset — same UUID string as the directory name, never re-cased or slugged.
- **Cognito session scope (AD-9, explicit non-goal this pass):** stays one global keyring slot / `SESSION_CACHE`, not per-profile. Cloud-linked signed-in/out display is derived via `commands::auth::current_subject()` compared to the stored `cognito_sub` (AD-10) — never via `AuthState`'s wire shape.
- **Picker routing (AD-14):** New `routes/picker.tsx`, chrome-free via a conditional shell skip in `__root.tsx`; `AccountPromptDialog.tsx` and its dedicated i18n-parity test are deleted, not left dormant. Every existing Playwright spec's Tauri mock switch needs a case added for the new root-level `invoke()` (~30 spec files, no shared mock helper today).
- **Frontend cache/state (AD-7):** `queryClient.clear()` on every `dataset:switched`, plus known `localStorage`-backed per-dataset state (import draft, onboarding/setup-banner dismissal flags in `DangerZone.tsx`/`SetupIncompleteBanner.tsx`/`CarOnboardingChecklist.tsx`) must not leak across a switch.
- **CAP-6 labeling (AD-2):** manually-created profiles get an auto-generated `"Local Profile <n>"` label — no free-text input (SPEC non-goal).
- **i18n (Consistency Conventions):** new strings live under a `datasets.*` namespace, added to `en.json`/`fr.json` together; `auth.promptTitle/Body/FutureFeatures/createAccount/continueOffline` and `profile.signIn` are retired in the same change as `AccountPromptDialog`'s deletion.

### UX Design Requirements

UX-DR1: The picker reuses `@nixus/shared/ui` primitives and the existing dark-theme design tokens (`DESIGN.md`) exactly as the rest of the app — no OS-native dialog, no parallel design system.

UX-DR2: The picker is a dedicated full-screen view with no sidebar/`TopBar`/`DestinationNav` (`EXPERIENCE.md`'s shell pattern does not apply here) — closer to a login/splash screen than an in-app route.

UX-DR3: `ProfileMenu.tsx`'s existing dropdown pattern is extended, not replaced: local-dataset context shows "Migrate to Nixus Cloud"; cloud-linked context shows a signed-in/signed-out badge plus the existing sign-out action — no new menu component.

> **Note:** No picker-specific mockup or Key-Flow walkthrough exists in `ux-nixus-2026-08-01` (that spine's scope is the Finance module + app shell, predating this feature). UX-DR1–3 are the only extractable, actionable requirements; layout/copy specifics are left to story-level acceptance criteria and existing conventions (mirroring how `OnboardingWizard.tsx`'s centered-column pattern was built without a dedicated UX spec). Flagged for the user's awareness, not treated as a blocker.

### FR Coverage Map

FR1: Epic 33 (picker gate + local profile list) / Epic 35 (completes the "Log in with Nixus Cloud" action)
FR2: Epic 33 - Default auto-migration
FR3: Epic 34 - Multiple isolated local profiles
FR4: Epic 35 - Log in with Nixus Cloud
FR5: Epic 35 - Migrate to Nixus Cloud
FR6: Epic 34 - Create additional local profiles

## Epic List

### Epic 33: Local Profile Foundation — Picker, Default Migration & Dataset Infrastructure
Users launch the app to a dedicated, chrome-free picker showing their existing data safely and automatically migrated into a "Default" profile — opening it works exactly as before, with nothing lost or duplicated. Builds the path-authority, active-dataset-lock, and registry foundation every later epic depends on.
**FRs covered:** FR1 (partial — picker gate + local list), FR2

### Epic 34: Multiple Isolated Local Profiles
Users can create additional local profiles from the picker and switch freely between them, with financial data, settings, onboarding state, and AI-provider credentials never leaking across profiles.
**FRs covered:** FR3, FR6

### Epic 35: Nixus Cloud Login & Migration
Users can sign in with a Nixus Cloud account from the picker (landing on a dedicated cloud-linked profile) and migrate any local profile's data to a new cloud-linked profile via the account menu — original left untouched, reattaches correctly on repeat sign-in.
**FRs covered:** FR1 (completes the Cloud action), FR4, FR5

## Epic 33: Local Profile Foundation — Picker, Default Migration & Dataset Infrastructure

Users launch the app to a dedicated, chrome-free picker showing their existing data safely and automatically migrated into a "Default" profile — opening it works exactly as before, with nothing lost or duplicated. Builds the path-authority, active-dataset-lock, and registry foundation every later epic depends on. **FRs covered:** FR1 (partial), FR2. **Relevant ADs:** AD-1–AD-7, AD-13, AD-14. **NFRs:** NFR3, NFR4, NFR5, NFR6, NFR7, NFR9, NFR10.

### Story 33.1: Dataset path authority replaces every independent `app_data_dir` call site

As a developer,
I want a single `datasets.rs` module owning `global_root()`, `dataset_dir(app, id)`, and `active_dataset_dir()`,
So that no code can ever read or write the wrong dataset's files by computing its own path.

**Acceptance Criteria:**

**Given** the app is running
**When** any of `lib.rs`, `commands/backup.rs`, `commands/danger_zone.rs`, `commands/profile.rs`, `commands/import.rs`, `commands/maintenance.rs`, or `commands/mod.rs::get_db_status` needs a filesystem path
**Then** it resolves that path exclusively via `datasets::global_root()` or `datasets::dataset_dir()`/`active_dataset_dir()` (per AD-5's call-site table) — no module outside `datasets.rs` calls `app.path().app_data_dir()` directly
**And** `dataset_dir(app, id)` is pure and lock-free (returns `global_root()` for `id == "default"`, else `global_root().join("datasets").join(id)`), while `active_dataset_dir()` is fallible and returns `AppError::NotConfigured` when no dataset is active
**And** `get_db_status` returns the real active dataset's resolved path instead of today's hardcoded literal
**And** the existing Rust test suite (including `wipe_list_covers_every_table_in_the_schema`) passes unmodified

### Story 33.2: Dataset registry with bootstrap migration to Default

As an existing Nixus user,
I want my current data to be automatically recognized as my "Default" profile the first time I launch after this update,
So that I lose nothing and don't have to do anything to keep using the app.

**Acceptance Criteria:**

**Given** `datasets.json` does not yet exist and `nkbaz-finance.db` already exists at `app_data_dir` root
**When** the app starts
**Then** `datasets.json` is created at `global_root()` with exactly one entry (`id: "default"`, `label: "Default"`, `kind: "local"`, `is_default: true`, `cognito_sub: null`, `linked_from: null`, `created_at`) and zero files are moved, copied, or renamed

**Given** `datasets.json` does not yet exist and no `nkbaz-finance.db` exists (fresh install)
**When** the app starts
**Then** the same single Default entry is created, with the database created lazily at the root on first access, exactly as today

**Given** `datasets.json` exists but fails to parse
**When** the app starts
**Then** a hard, user-visible error is surfaced and the file is never silently recreated (which would orphan every non-default dataset already on disk)

**Given** any create/read/write against `datasets.json`
**When** it happens
**Then** it goes through one in-process lock (AD-3) via the atomic-write helper, and every entry's `id` is re-validated against the filesystem-safe charset on read, skipping (and logging) any entry that fails validation rather than failing the whole load

### Story 33.3: Active-dataset state and the locked hot-swap (`select_dataset`)

As a user,
I want switching between profiles to feel instant and never touch the wrong profile's data,
So that I can trust the app never mixes up my data.

**Acceptance Criteria:**

**Given** the app has just started and no profile has been selected yet
**When** any command that needs database access is invoked
**Then** it returns `AppError::NotConfigured` rather than silently defaulting to the Default profile

**Given** a valid `dataset_id` from the registry
**When** `select_dataset(id)` is called
**Then** the target's directory is resolved and its database is opened and migrated *before* anything about the current state changes, and only on success are the active id and the open connection swapped together as one atomic step (AD-6a/AD-6b)
**And** on any failure during that process, the previous active dataset (or "none") is left completely untouched and an error is returned
**And** a `dataset:switched { dataset_id, kind }` event is emitted on every successful call, including the very first selection of a run

**Given** `select_dataset` is switching datasets
**When** `commands/backup.rs`, `commands/import.rs`, or `commands/danger_zone.rs`'s connection access runs concurrently
**Then** they cannot observe a state where the resolved path and the open connection disagree (single guarded acquisition per AD-6b, never two separate ones)

### Story 33.4: The launch-time picker screen

As a user,
I want to see a dedicated, styled screen listing my profiles every time I open the app,
So that I always know which data I'm about to work with.

**Acceptance Criteria:**

**Given** the app launches
**When** the root route resolves
**Then** the user is redirected to `/picker` before the dashboard, onboarding wizard, or any other view can render, with no sidebar/`TopBar`/`DestinationNav` visible
**And** this redirect happens every single launch — nothing is remembered from a prior session (NFR9)

**Given** the picker is showing
**When** it loads
**Then** it lists every entry from the dataset registry (via a new `list_datasets` command), styled with the existing `@nixus/shared/ui` primitives and dark-theme tokens — no OS-native dialog (NFR4)
**And** a "Log in with Nixus Cloud" action is visible in the layout (its click handler is wired in Epic 35 — this story only needs it present and disabled/inert if Epic 35 hasn't landed yet)

### Story 33.5: Choosing a profile opens the app scoped to it

As a user,
I want picking my profile from the launch screen to open the app exactly as if nothing else exists,
So that I can trust I'm looking at the right data.

**Acceptance Criteria:**

**Given** the picker is showing at least one profile
**When** the user clicks a profile
**Then** `select_dataset` is called, and on success the frontend calls `queryClient.clear()` and navigates into the dashboard (or the onboarding wizard, per that dataset's own `onboarding_completed` state) — never a raw page reload

**Given** a user has just picked the Default profile for the first time after upgrading
**When** the dashboard renders
**Then** every pre-existing record (finance, car, settings, onboarding state) is present, unchanged, and the app behaves exactly as it did before this feature shipped (FR2)

**Given** `AccountPromptDialog.tsx` and its dedicated i18n-parity test exist today
**When** this story ships
**Then** both are deleted, and the `auth.promptTitle`/`promptBody`/`promptFutureFeatures`/`createAccount`/`continueOffline` locale keys are removed from both `en.json` and `fr.json` in the same change

### Story 33.6: Existing E2E suite keeps passing with the new launch gate

As a developer,
I want every existing Playwright spec to keep passing after the picker becomes the app's real entry point,
So that this feature doesn't silently break the test suite.

**Acceptance Criteria:**

**Given** the picker gate now performs a root-level `invoke()` (e.g. `get_active_dataset`/`list_datasets`) before any other route renders
**When** any of the ~30 existing Playwright specs run
**Then** each spec's Tauri mock switch has a case added for the new command(s), and the full existing suite passes without a single spec falling into its `Promise.reject("Unknown command")` fallback
**And** at least one new spec exists covering: launch → picker renders → select Default → dashboard renders with pre-existing data intact

## Epic 34: Multiple Isolated Local Profiles

Users can create additional local profiles from the picker and switch freely between them, with financial data, settings, onboarding state, and AI-provider credentials never leaking across profiles. **FRs covered:** FR3, FR6. **Relevant ADs:** AD-2, AD-5 (import.rs), AD-7 (extended), AD-8. **NFRs:** NFR8, NFR10 (continued).

### Story 34.1: Create additional local profiles from the picker

As a user,
I want to create a brand-new, empty local profile from the launch screen,
So that I can keep a separate workspace on this machine without touching my existing data.

**Acceptance Criteria:**

**Given** the picker is showing
**When** the user chooses "+ New local profile"
**Then** a new dataset is created via `create_dataset` — a fresh UUID directory with its own migrated, empty `nkbaz-finance.db` — and appended to the registry under the same single writer lock as every other mutator (AD-3)
**And** its label is auto-generated as `"Local Profile <n>"` (n = count of existing non-default, non-cloud-linked profiles + 1), with no free-text label input anywhere in the UI (SPEC non-goal)
**And** the new profile appears in the picker list immediately and is selectable exactly like any other profile

**Given** a freshly created local profile
**When** it is opened for the first time
**Then** it starts fully unonboarded and goes through the same onboarding wizard as a first-ever install, since its dataset is genuinely empty

### Story 34.2: AI-provider credentials become per-profile

As a user with more than one local profile,
I want each profile to have its own AI-provider API keys,
So that configuring an AI key in one profile never exposes it to another.

**Acceptance Criteria:**

**Given** the Default profile already has an AI-provider key configured today
**When** this story ships
**Then** Default's key keeps working with zero migration — its keyring service name stays the unchanged literal `"nkbaz-finance"`

**Given** a non-default profile (created via Story 34.1)
**When** an AI-provider key is saved for it
**Then** `credentials.rs` stores it under service name `"Nixus-<dataset_id>"`, using the exact same UUID string as the profile's directory name — never re-cased or slugged (AD-8)
**And** `credentials.rs` remains the only module that touches `keyring_core::Entry` — no new call site bypasses it

**Given** two local profiles, each with a different AI-provider key configured
**When** the user switches from one to the other
**Then** the AI settings screen shows only the active profile's key (or none, if unconfigured) — never the other profile's

### Story 34.3: Per-dataset financial data stays isolated across backup, import, and danger-zone

As a user,
I want backup/restore, statement import, and "delete all data" to only ever affect the profile I'm currently using,
So that one profile's actions can never damage another's data.

**Acceptance Criteria:**

**Given** two local profiles, each with different financial data
**When** the user runs "export backup" or "delete all data" while Profile A is active
**Then** only Profile A's `nkbaz-finance.db` (and, for delete-all, Profile A's SQL tables via the currently-open connection) is affected — Profile B's data is provably untouched afterward
**And** the existing `wipe_list_covers_every_table_in_the_schema` test still passes, unmodified, against whichever profile is active

**Given** a statement import is staged while Profile A is active
**When** the user switches to Profile B before finishing the import
**Then** the staged import file is not visible to or usable from Profile B (import staging resolves via `active_dataset_dir()`, per AD-5)

**Given** "delete all data" is run from any profile
**When** the operation completes
**Then** the demographic `/profile` data (keyed by Cognito `sub`) is still wiped machine-wide exactly as it is today — this is an intentional, unchanged behavior, not a regression to flag

### Story 34.4: No frontend-persisted state survives a profile switch

As a user,
I want in-progress work and dismissed banners from one profile to never show up in another,
So that switching profiles feels like a clean, complete change of context.

**Acceptance Criteria:**

**Given** an in-progress statement import draft (`components/import/importDraft.ts`, `localStorage`-backed) exists in Profile A
**When** the user switches to Profile B
**Then** Profile B shows no trace of Profile A's import draft

**Given** onboarding/setup-banner dismissal flags in `DangerZone.tsx`, `SetupIncompleteBanner.tsx`, or `CarOnboardingChecklist.tsx` are set in Profile A
**When** the user switches to Profile B
**Then** Profile B's banners/checklists reflect its own state, not Profile A's
**And** the `dataset:switched` listener's `queryClient.clear()` (Story 33.5) plus this story's `localStorage` sweep together cover every known per-dataset frontend state (AD-7)

### Story 34.5: End-to-end isolation verification across repeated switching

As a user,
I want to be confident that creating and using a second profile never alters my first one,
So that I can rely on profiles being genuinely separate.

**Acceptance Criteria:**

**Given** the Default profile has existing data and a second local profile is created (Story 34.1)
**When** the user populates the second profile with its own finance/car records and AI key, then switches back to Default, then back to the second profile, repeatedly
**Then** at no point does either profile's data, settings, onboarding state, or AI key appear in the other — verified by an automated Playwright spec covering create → populate → switch → verify → switch back → verify (CAP-3's own success criterion, stated literally)

## Epic 35: Nixus Cloud Login & Migration

Users can sign in with a Nixus Cloud account from the picker (landing on a dedicated cloud-linked profile) and migrate any local profile's data to a new cloud-linked profile via the account menu — original left untouched, reattaches correctly on repeat sign-in. **FRs covered:** FR1 (completes the Cloud action), FR4, FR5. **Relevant ADs:** AD-9–AD-12, AD-14. **NFRs:** NFR1, NFR2.

### Story 35.1: `LoginIntent` carries Login vs Migrate across the unchanged OAuth round-trip

As a developer,
I want the existing Cognito sign-in flow to carry one extra piece of context without changing any of its OAuth mechanics,
So that Login and Migrate can branch safely after a successful sign-in.

**Acceptance Criteria:**

**Given** `start_login` is called
**When** it is invoked with a `LoginIntent` (`Login`, or `Migrate` carrying a source dataset id)
**Then** that intent is stored in `commands/auth_listener.rs` alongside the existing PKCE `state`/verifier, sharing that listener's exact single-request/5-minute-timeout lifetime — it can never outlive the attempt it belongs to
**And** PKCE, the `state` CSRF check, the token exchange, and `credentials.rs`'s session storage are provably unchanged (the existing login E2E coverage from `architecture-login.md` still passes with no modification)

**Given** the legacy `nixus://auth/callback` deep-link fallback fires instead of the loopback redirect
**When** `complete_auth_callback` handles it
**Then** it carries no intent and always behaves as `LoginIntent::Login`

### Story 35.2: "Log in with Nixus Cloud" from the picker

As a user,
I want to sign in with my Nixus Cloud account from the launch screen,
So that I land on the profile tied to that account, whether it's new or one I've used before.

**Acceptance Criteria:**

**Given** the picker's "Log in with Nixus Cloud" action (present but inert since Story 33.4)
**When** the user clicks it
**Then** `start_login(LoginIntent::Login)` runs the exact same Cognito Hosted UI flow as today's sign-in, unchanged

**Given** a successful callback and no existing cloud-linked dataset for that account's `cognito_sub`
**When** the post-callback handler runs
**Then** a new dataset is created, tagged `kind: "cloud-linked"`, `cognito_sub`, and `label` set to the account's email from the `id_token`, then selected — landing the user in its (empty) dashboard

**Given** a successful callback and one or more existing cloud-linked datasets already match that `cognito_sub`
**When** the post-callback handler runs
**Then** the most-recently-created matching dataset is selected — signing in again with the same account reopens that same profile rather than duplicating it (FR4's explicit success criterion)

### Story 35.3: "Migrate to Nixus Cloud" from within a local profile

As a user working in a local profile,
I want to migrate a copy of my data to a new Nixus Cloud account without losing my original profile,
So that I can move to the cloud without any risk to what I already have.

**Acceptance Criteria:**

**Given** the active profile is local (`kind: "local"`)
**When** the account menu is opened
**Then** it shows "Migrate to Nixus Cloud" in place of "Sign In with Nixus Cloud", triggering `start_login(LoginIntent::Migrate{source: active_id})`

**Given** a successful callback for a Migrate intent
**When** the post-callback handler runs
**Then** it first confirms the source dataset is still the one active (aborting with an error and creating nothing if the user switched away during the browser round-trip), then creates a new dataset, copies the source's `nkbaz-finance.db` (post-checkpoint, main file only — never a `-wal`/`-shm` sidecar) into it, copies the source's per-dataset AI-provider keyring entries by their known, enumerated key names, tags the new dataset `kind: "cloud-linked"` with `cognito_sub`, `label`, and `linked_from: source_id`, and selects it

**Given** a migration just completed
**When** the picker or "switch profile" is opened afterward
**Then** the original local profile is still listed, completely untouched — same data, same AI keys, never deleted or converted (FR5's explicit success criterion)

### Story 35.4: Cloud-linked profiles show whether their account is currently signed in

As a user with a cloud-linked profile,
I want to see whether I'm currently signed into its Nixus Cloud account,
So that I know whether "sign out" or signing in again is what I need.

**Acceptance Criteria:**

**Given** the active profile is cloud-linked (`kind: "cloud-linked"`)
**When** the account menu renders
**Then** it shows a signed-in badge if `commands::auth::current_subject()` matches the profile's stored `cognito_sub`, or a signed-out badge otherwise — with no new Rust state and no change to `AuthState`'s wire shape (AD-10)

**Given** a signed-in cloud-linked profile
**When** the user clicks the existing "Sign out" action
**Then** it behaves exactly as it does today, and the profile immediately shows as signed-out (never reverting to a plain local profile)

**Given** a cloud-linked profile shown as signed-out
**When** the user signs back in with the same Nixus Cloud account (from the picker or this profile's menu)
**Then** the profile reattaches and shows signed-in again — never duplicated (FR5's reattach criterion)

### Story 35.5: i18n cleanup for the new Cloud entry points

As a French- or English-speaking user,
I want every new or changed label in this feature to be correctly translated,
So that the app never shows an untranslated or broken string.

**Acceptance Criteria:**

**Given** the picker, the "Migrate to Nixus Cloud" label, and the signed-in/out badge all need new copy
**When** those keys are added
**Then** they live under a new `datasets.*` namespace, and every key is added to both `en.json` and `fr.json` in the same change (existing locale-parity CI suite passes)

**Given** `profile.signIn` no longer has any caller once ProfileMenu's local-dataset case always shows "Migrate to Nixus Cloud"
**When** this story ships
**Then** `profile.signIn` is removed from both locale files, alongside the `AccountPromptDialog` keys already retired in Story 33.5

### Story 35.6: Verify no data leaves the machine

As a privacy-conscious user,
I want confirmation that logging in or migrating to Nixus Cloud never transmits my financial or profile data anywhere,
So that the "your data never leaves your machine" claim stays true for cloud-linked profiles too.

**Acceptance Criteria:**

**Given** a full Login flow (Story 35.2) and a full Migrate flow (Story 35.3) each run end-to-end
**When** network traffic is inspected during both
**Then** the only calls made are Cognito's existing `/oauth2/authorize` and `/oauth2/token` endpoints — no new endpoint, and no financial, car, or profile payload is ever sent (NFR1)
**And** an automated test or documented manual verification captures this as evidence, not just an assumption
