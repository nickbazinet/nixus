---
name: 'Reconcile-inputs review — spine vs SPEC + brownfield'
type: architecture-review
lens: reconcile-inputs
target: _bmad-output/planning-artifacts/architecture/architecture-nixus-2026-08-18/ARCHITECTURE-SPINE.md
inputs:
  - _bmad-output/specs/spec-local-profiles-nixus-cloud/SPEC.md
  - _bmad-output/specs/spec-local-profiles-nixus-cloud/brownfield.md
verdict: gaps-found
created: '2026-08-18'
---

# Reconcile-inputs Review — ARCHITECTURE-SPINE.md vs SPEC.md + brownfield.md

Scope: every capability (CAP-1..CAP-6), every constraint, every non-goal, every assumption, the
success signal, and every load-bearing fact in `brownfield.md`. Legend: **COVERED** (an AD or the
Capability Map binds it explicitly) / **PARTIAL** (addressed but a load-bearing sub-clause is
unstated or only implied) / **MISSING** (spine is silent) / **DRIFT** (spine says something that
conflicts with an input, or with itself).

No source document was modified. No new architectural decisions are proposed here — gaps only.

---

## 1. Capabilities

### CAP-1 — Launch picker — **PARTIAL**

| Sub-clause (SPEC wording) | Status | Where |
| --- | --- | --- |
| "dedicated, chrome-free picker screen — no sidebar/top bar" | COVERED | AD-14: `routes/picker.tsx` renders without sidebar/`TopBar`/`DestinationNav`; `__root.tsx` conditional shell skip |
| "styled consistently with the rest of the app, more like a login page than an in-app view" | **MISSING** | No AD mentions design-system conformance. AD-14 is purely structural (which chrome is skipped). See Constraint C4. |
| "listing every local profile on this machine" | COVERED | AD-3 (`datasets.json` sole source of truth for the picker) |
| "plus a 'Log in with Nixus Cloud' action" | COVERED | AD-14 (action named explicitly), Structural Seed `picker.tsx` comment, AD-11/AD-12 |
| success: "Every launch shows this dedicated screen first, with the normal app shell not rendered" | COVERED | AD-14 |
| success: "choosing a profile opens the app scoped to that profile's data" | COVERED | AD-6 (`select_dataset`), AD-5 (path authority), AD-7 (cache clear) |
| success: "no launch path bypasses the picker" | PARTIAL | AD-14 names dashboard, onboarding wizard, and `AccountPromptDialog` as paths that must not be reached first. But the gate is placed in `__root.tsx`, while `brownfield.md` L26 states `routes/index.tsx`'s `beforeLoad` is *"the single point a profile-picker gate would need to sit in front of."* The spine neither cites nor reconciles that existing `beforeLoad`/`check_onboarding_status` gate, and does not state the ordering (picker gate → onboarding gate). See Brownfield F14. |
| success: "there is no 'remember last profile' shortcut — it always appears" | COVERED | AD-14: "**in-memory-only** 'dataset selected this run' flag… Nothing persists this flag across launches" |

### CAP-2 — Default auto-migration — **COVERED**

- "entire current dataset (finance, car, settings, onboarding state)… automatically migrated… with no user action" → AD-4 (bootstrap state machine runs before any UI renders, "Prevents: Any user-visible action, prompt, or delay on the upgrade path") + AD-2 (Default's directory **is** `app_data_dir`).
- "into a profile named 'Default' that appears in the picker" → AD-2 (`dataset_id` literal `"default"`), AD-4 (registry seeded with exactly one entry `is_default: true`), AD-3 (`label`).
- success: "contains every record they had before upgrading — nothing missing, nothing duplicated" → structurally guaranteed by AD-2's "Prevents: Any code path moving, copying, or rewriting the pre-existing `nkbaz-finance.db` during migration." This is the strongest form of the success criterion (nothing is touched, so nothing can be lost or duplicated). Confirmed.
- success: "the app behaves exactly as before once opened" → AD-2 (`config`, `profiles/`, keyring names stay put) + AD-8 (Default keeps today's unscoped keyring service literal `"nkbaz-finance"`, zero migration).
- "settings, onboarding state" specifically: carried implicitly because `db/config.rs` lives inside the per-dataset `.db` file (AD-1). Not named. See Brownfield F7.

### CAP-3 — Multiple isolated local profiles — **COVERED**

- "completely isolated dataset" → AD-1 (one directory + one complete independent SQLite file; isolation by *which directory* `init_db` is pointed at, never shared rows/schemas).
- "finance, car, settings, onboarding state" → AD-1 + Design Paradigm ("Every existing domain module (finance, car, settings, onboarding, backup, danger-zone) is unaware it is multi-tenant").
- "and its own AI-provider/keyring credentials" → AD-8.
- "switching profiles never mixes or leaks data or credentials" → AD-6 (drop-and-reopen, never two connections), AD-7 (full `queryClient.clear()`), AD-8.
- success: "verified by switching back and forth" → AD-6 + AD-7 make the round-trip safe; AD-7 explicitly cites the stale-render bug class (D5 in `architecture-user-profile.md`) and escalates it from one query key to a full clear. Confirmed.
- success: "AI-provider credentials configured in one profile never appear in another" → AD-8's service-name derivation. Confirmed.

### CAP-4 — Log in with Nixus Cloud (from picker) — **COVERED**

- "runs the existing, unmodified Cognito sign-in/sign-up flow (opening the system browser exactly as today)" → AD-11 (PKCE, `state` CSRF check, token exchange, `credentials.rs` storage "100% unchanged"; only a `LoginIntent` enum is added alongside the existing in-process `state`/verifier).
- "lands the user on a local profile associated with that Nixus Cloud account" → AD-12 `LoginIntent::Login` branch.
- success: "adds (or reopens) a profile tagged to that account… with its own isolated, local-only dataset like any other profile" → AD-12 (tag `kind: "cloud-linked"`, `cognito_sub`, `label: <email from id_token>`) + AD-1/AD-2 (same isolation shape as any dataset).
- success: "signing in again with the same account reopens that same profile rather than duplicating it" → AD-12 find-or-create-by-`sub`, with "Prevents: Duplicate cloud-linked datasets for the same Cognito account". Confirmed.

### CAP-5 — Migrate to Nixus Cloud (from a profile) — **PARTIAL**

| Sub-clause | Status | Where |
| --- | --- | --- |
| "From within an active local (not yet cloud-linked) profile" | PARTIAL | `kind: "local" \| "cloud-linked"` (AD-3) supplies the discriminator, but no AD states the UI must offer Migrate **only** for `kind: "local"` datasets (the SPEC's "in place of today's… entry point" is conditional on the active profile being non-cloud-linked). |
| "the top-right account menu offers 'Migrate to Nixus Cloud' **in place of** today's 'Sign In with Nixus Cloud' entry point" | **MISSING** | No AD, no Capability-Map row, and no Structural-Seed entry touches `components/auth/ProfileMenu.tsx` or the `profile.signIn` i18n key — the exact surface `brownfield.md` L28 identifies as "the exact entry point CAP-5 replaces". The spine's frontend footprint is `picker.tsx`, `__root.tsx`, `useDatasets.ts`, and the deletion of `AccountPromptDialog.tsx` only. See Brownfield F16. |
| "runs the same unchanged Cognito flow (opening the system browser exactly as today)" | COVERED | AD-11 |
| "creates a new, separate profile linked to that account containing a copy of the local profile's data as of that moment" | COVERED | AD-12 `Migrate` branch: new directory + `export_backup`'s `PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` ("never a fresh `init_db`, so the copy is byte-identical data, not an empty schema") |
| "the original local profile is left untouched… never deleted or converted" | COVERED | AD-12: "The source dataset's registry entry and files are **never** modified or removed" (+ its Prevents clause) |
| success: "picker lists both the untouched original… and a new cloud-linked profile holding a copy" | COVERED | AD-12 (`linked_from: source_dataset_id`), AD-3 |
| success: "later signing out… leaves the migrated profile marked cloud-linked-but-signed-out (never reverts to a plain local profile)" | PARTIAL | AD-10 gives the derived rule and `kind` is stored statically so it cannot revert — good. But the mechanism is underspecified: AD-10 compares the stored `sub` to "whatever `get_auth_session` currently reports globally", and `brownfield.md` L29 records that the `AuthState` wire union is `{LoggedOut} \| {LoggedIn, email, name} \| {SessionExpired}` — **no `sub` on the wire type**. AD-10 also claims "No new Rust state", so the comparison surface is unresolved. See Finding G5. |
| success: "signing back in with the same account reattaches it rather than creating a duplicate" | COVERED | AD-12 `Login` branch find-or-create-by-`sub` applies to migrated entries too (they carry `kind: "cloud-linked"` + `cognito_sub`) |
| Migrate must also carry the source's AI keys | COVERED (spine goes beyond SPEC) | AD-12 copies per-dataset AI-provider keyring entries; consistent with CAP-3/C8 |

### CAP-6 — Create additional local profiles — **PARTIAL**

- "manually create a new, empty, unlinked local profile" → COVERED: AD-2 (new `datasets/<uuid>/` with fresh migrated `nkbaz-finance.db`), AD-3 (`kind: "local"`), Capability Map (`commands/datasets.rs::create_dataset`, `routes/picker.tsx`).
- "immediately usable and switchable like any other profile" → COVERED: AD-6.
- **Label assignment is unspecified.** AD-3 requires a `label` on every registry entry, and SPEC non-goal 9 forbids renaming/custom display labels ("profiles show a fixed label (e.g. 'Default', or the linked Nixus Cloud account's email)"). Neither the SPEC nor the spine says what fixed label a CAP-6 profile gets. The spine inherits, rather than resolves, this ambiguity — flagging it because AD-3 makes `label` a required field.
- A freshly created profile "starts unonboarded and goes through the same wizard" (SPEC Assumption A3) → PARTIAL, see Assumption A3.

---

## 2. Constraints

| # | Constraint (SPEC L50–58) | Status | Evidence / gap |
| --- | --- | --- | --- |
| C1 | "**No data leaves the machine** in this pass, for any profile including cloud-linked ones — every profile's data is stored and read locally only; no network call transmits financial, car, or profile data anywhere." | **PARTIAL — quiet requirement dropped to a Deferred bullet** | The only place the spine addresses this is Deferred: "Cloud data sync/persistence of any kind. Explicitly a non-goal of the SPEC; nothing here builds toward it." No AD-n states it as an invariant, so nothing in the Invariants & Rules section constrains the one place the spine *does* add a network call (AD-11's token exchange). A Deferred bullet is a scope note, not an enforceable rule a story or reviewer can check against. Also weakens the Success signal's "every byte of data, for every profile, staying on their machine". See Finding G4. |
| C2 | "Reuse the existing Cognito PKCE flow exactly as-is (`start_login` / `handle_auth_callback` / `get_auth_session` / `sign_out`, loopback-redirect callback)… no change to the Cognito hosted UI, app client, scopes, or OAuth grant." | COVERED | AD-11 ("PKCE, the `state` CSRF check, the token exchange, and `credentials.rs` storage are **100% unchanged**"; "Prevents: Two divergent Cognito flows"). AD-10 confirms `sign_out` works unchanged. Note the one additive change AD-11 does make — `start_login` gains a `LoginIntent` parameter — is a signature change, not a protocol change, so it stays inside C2's intent. |
| C3 | "The existing demographic 'Profile' feature… is a distinct concept from the new 'local profile' (dataset-selection) concept… **and must be named so users cannot confuse the two**." | **PARTIAL — DRIFT on the user-facing half** | Code/filesystem half is COVERED and well done: AD-13 ("deliberately distinct from the existing singular `profiles/` directory, so the two concepts never share a name or a path") + Consistency Conventions naming row ("never 'profile' in code identifiers"). The **user-facing** half is contradicted: the same naming row mandates "User-facing copy: 'profile' (per SPEC)", while `brownfield.md` L28 records the existing logged-in dropdown item literally labelled **"Profile"** linking to `/profile`, and L21 states the collision is one "to actively avoid". Post-change, a user sees "profile" for the dataset picker *and* "Profile" for the demographic form. The constraint is about users, not identifiers, and no AD resolves it. See Finding G1. |
| C4 | "The picker screen's visual style must match the existing app's design system (dark theme, existing shared UI primitives, per the attached reference) — not a generic OS-native or unstyled dialog. It is a dedicated, chrome-free view (no sidebar/top bar), not a route rendered inside the existing app shell." | PARTIAL | Second sentence COVERED by AD-14 (chrome-free route, conditional shell skip, explicitly not inside the shell). First sentence **MISSING**: no AD or convention mentions the design system, dark theme, shared UI primitives, or the attached reference. `brownfield.md` L25 hands the spine the two nearest in-repo precedents — `OnboardingWizard.tsx`'s centered-column convention (logo mark, `text-h1`, `Card` tiles) and the shared `Dialog` primitive "explicitly documented in-repo as reserved for destructive confirms only" — and the spine cites neither, so it also never records that the picker must **not** be a `Dialog`. See Finding G6. |
| C5 | "Migration of the existing single dataset into 'Default' must be fully automatic, one-time, and lossless, with no user action required." | COVERED | AD-4 ("runs before any UI renders"; "Prevents: Any user-visible action, prompt, or delay on the upgrade path"); one-time via "If `datasets.json` already exists, this step is a no-op read"; lossless via AD-2's no-move rule. |
| C6 | "Existing single-profile users must never be forced through Cognito, or required to create a Nixus Cloud account, to keep using the app exactly as before." | PARTIAL (covered by construction, never stated) | Satisfied in effect: AD-4 seeds Default with no auth, AD-14 deletes the nagging `AccountPromptDialog` and makes cloud login one action among the listed local profiles, AD-8 spares Default users re-entering keys. But no AD states the guarantee, so nothing prevents a story from making the picker's cloud action mandatory-looking. Low risk, noted for completeness. |
| C7 | "Local-profile identity is a new, purely local Nixus concept, independent of the Cognito `sub` — a cloud-linked profile records the `sub` as an attribute of its local profile, never as the profile's identity/directory key itself." | COVERED | AD-2 (`datasets/<uuid>/` — uuid keyed, not `sub` keyed), AD-3 (`cognito_sub?` is one optional field among others), AD-12 (`sub` used only as a lookup attribute). Explicit and correct. |
| C8 | "AI-provider credentials and other keyring-backed settings become per-profile… This rules out today's single global keyring service name for these." | COVERED, with a deliberate documented exception | AD-8 derives the service name per dataset. The exception — Default keeps the bare literal `"nkbaz-finance"` — does not violate the isolation requirement (every non-default dataset is suffixed, so no cross-read is possible) and is justified against C5/C6 ("forcing an upgrading Default user to re-enter an already-configured key"). Note the constraint's "**and other keyring-backed settings**" is only partly addressed: AD-8 names "AI/AWS key functions"; the only other keyring-backed item in the codebase is the Cognito session, which AD-9 deliberately keeps global. That is an intentional, adopted trade-off, not an oversight — but it is a literal narrowing of C8's wording and is worth naming at story time. |
| C9 | "The picker is shown on every launch unconditionally — no 'last used profile' memory or skip-ahead shortcut in this pass." | COVERED | AD-14 in-memory-only flag; "Prevents: … a persisted 'last profile' shortcut reappearing." |

---

## 3. Non-goals

| Non-goal | Status | Evidence |
| --- | --- | --- |
| No cloud data sync or persistence | COVERED | Deferred bullet 4 |
| No mobile app, alerting, push | COVERED (by silence, correctly) | Not referenced anywhere in the spine; nothing built toward it |
| No multi-user real-time / concurrent access to the same profile | COVERED | Design Paradigm: "**single-active-dataset, never concurrent-multi-tenant**… Switching datasets **drops and reopens** state — it never serves two datasets at once"; AD-6 |
| No change to Cognito app client, hosted UI, or grant type | COVERED | AD-11 |
| No profile picture / avatar work | COVERED (silence) | — |
| No paid feature gating / entitlement logic | COVERED (silence) | — |
| No profile deletion/removal from the picker; a profile's data is never auto-deleted | COVERED | Deferred bullet 2 ("no directory-removal or registry-mutation path is built now"); AD-12 protects the source dataset during Migrate |
| No profile renaming or custom display labels; fixed labels only | COVERED for rename | Deferred bullet 2 covers rename. The *fixed-label* half interacts with CAP-6's unspecified label (see CAP-6). |

---

## 4. Assumptions

| # | Assumption | Status | Evidence / gap |
| --- | --- | --- | --- |
| A1 | New local-profile concept orthogonal to demographic Profile; "that feature's data model and route are unaffected; **only its sign-in entry point's copy/behavior changes**" | PARTIAL | Data model + route: COVERED by AD-13 ("`profile_store.rs`, its `/profile` route, and its Cognito-`sub`-keyed documents are **not touched**"). The italicized clause — the sign-in entry point copy/behavior change — is MISSING; it is the same `ProfileMenu.tsx` / `profile.signIn` gap as CAP-5. |
| A2 | Launch-time `AccountPromptDialog` is superseded by the picker | COVERED | AD-14: "`AccountPromptDialog` is **deleted** — fully superseded by the picker's own 'Log in with Nixus Cloud' action, not left dormant"; Structural Seed marks the file DELETED. Residual: the four now-orphaned i18n keys (`auth.promptTitle`, `auth.promptBody`, `auth.promptFutureFeatures`, `auth.createAccount`, `auth.continueOffline`, `brownfield.md` L30) are not mentioned. Minor, but they are under a locale-parity test suite. |
| A3 | "Each local profile has its own independent onboarding state — a freshly created non-Default local profile starts unonboarded and goes through the same wizard as a first-ever install, since its dataset is empty and isolated." | PARTIAL | True by construction (AD-1: each dataset has its own migrated DB, hence its own `config` table with its own `onboarding_completed`), but nowhere stated. The spine never names `db/config.rs`, `onboarding_completed`, or `check_onboarding_status`, and never addresses the picker-gate → onboarding-gate ordering against `routes/index.tsx`'s existing `beforeLoad` (`brownfield.md` L26). AD-14 only asserts the wizard must not be reached *before* a dataset is chosen. |
| A4 | "Backup/export, restore, and danger-zone delete-all-data become scoped to the active/selected profile rather than the whole machine" | PARTIAL | Strongly covered for the SQLite side: AD-5 makes this "a structural consequence of this rule, not separate code", and AD-1 keeps `db/backup.rs`/`db/danger_zone.rs` internally dataset-unaware. **Unreconciled:** `brownfield.md` L19 records that `commands/danger_zone.rs::delete_all_data` also deletes the **entire** `profiles/` directory (every Cognito `sub`'s document at once), and AD-13 keeps `profiles/` global at the `app_data_dir` root. So a per-dataset "delete all data" would still nuke a machine-global directory — directly at odds with A4's "rather than the whole machine". No AD addresses this. See Finding G3. |
| A5 | Target platforms unchanged (macOS, Windows via Tauri) | COVERED | Stack table (Tauri 2.x, no new deps); Deferred bullet 6 ("no new AWS resources, no new build/release step") |

---

## 5. Brownfield load-bearing facts

### 5.1 Data storage

| # | Fact (brownfield.md) | Status | Evidence / gap |
| --- | --- | --- | --- |
| F1 | `app_data_dir` resolved independently in **five separate call sites** with no shared helper: `lib.rs` (setup), `commands/backup.rs` (`export_backup`, `import_backup`), `commands/danger_zone.rs` (`delete_all_data`), `commands/profile.rs` (`resolve_profiles_dir`) | PARTIAL + **internal DRIFT** | AD-5 is built directly on this fact and even cites it ("the exact smell already present at 5 sites per `brownfield.md`"), which is the right response. But its enumeration — "`backup.rs`, `danger_zone.rs`, `commands/*.rs`, and `credentials.rs`'s per-dataset key resolution" — creates two unresolved cases: (a) `commands/profile.rs::resolve_profiles_dir` is a `commands/*.rs` site that AD-5 forbids from calling `app_data_dir`, while AD-13 requires it to resolve to the **global** root — the two rules contradict for this one site; (b) `lib.rs` (setup) is not named, yet it is the site that constructs `DbState` at startup and is now necessarily bootstrap/AD-4-ordered. See Finding G3. |
| F2 | SQLite filename is a hardcoded literal `"nkbaz-finance.db"` duplicated across `db/mod.rs::init_db`, `commands/backup.rs` (x2), and `commands/mod.rs::get_db_status` (which returns the bare literal, not a real path — "already misleading today"). **No `const DB_FILENAME` exists.** | **MISSING** | The spine uses the filename throughout (AD-1, AD-2, Structural Seed) but never addresses the duplication, never introduces or declines a shared constant, and never mentions `commands/mod.rs::get_db_status`. `get_db_status` is the one place whose output becomes *more* wrong under this feature: a bare filename cannot say which dataset is active, and it is not in the Structural Seed's modified-file list. See Finding G7. |
| F3 | `init_db(app_data_dir: &Path)` already takes a directory, "so pointing it at a different directory per profile is a small change in isolation — the work is in getting every one of the five call sites to agree on *which* directory" | COVERED | This is the load-bearing insight the whole spine is built on: AD-1 ("Isolation is achieved by **which directory `init_db` is pointed at**"), AD-5 (the call-site-agreement problem), Stack table ("`init_db` re-pointed per dataset"), Structural Seed ("`db/` UNCHANGED internally — `init_db` still takes a directory"). Faithfully adopted. |
| F4 | Live DB connection is a single global `tauri::State<DbState>` (`Mutex<Connection>`), set up once at startup; only one connection process-wide | COVERED | Design Paradigm ("one `Mutex<Connection>`, one in-memory active-dataset-id"), AD-6 (swaps "the `Mutex<Connection>` contents in place"), mermaid diagram (`db/*` "re-pointed per dataset") |
| F5 | `db/backup.rs::restore_from_file` already implements drop connection → remove `-wal`/`-shm` sidecars → copy file into place → reopen with `open_configured` (re-runs migrations) → **rollback to a safety copy on failure** — "this is the proven pattern to reuse for 'switch active profile', not something to invent fresh" | PARTIAL | AD-6 adopts the spine of it (drop connection → resolve → open+migrate via existing `init_db`/`open_configured` → swap in place) and AD-12 separately reuses `export_backup`'s `wal_checkpoint(TRUNCATE)` + `fs::copy`, which is good and explicitly credited. Two sub-clauses are unaddressed: the `-wal`/`-shm` sidecar handling, and the **failure/rollback** half. AD-6 gives no failure semantics — if the target dataset fails to open after the current connection has already been dropped, the process is left with a `Mutex<Connection>` in an undefined state and no stated recovery, whereas the pattern brownfield points at has an explicit rollback. Arguably out of AD-6's stated scope (no file copy happens on a switch), but the spine does not say so. See Finding G8. |
| F6 | `db/danger_zone.rs::wipe_all(conn)` is already profile-agnostic; machine-checked test `wipe_list_covers_every_table_in_the_schema` asserts `WIPE_TABLES ∪ PRESERVED_TABLES` covers every live table — "preserve this guarantee per-profile" | COVERED, explicitly | AD-1: "`db/danger_zone.rs`'s wipe-coverage test run completely unmodified against whichever directory is active — they must never become dataset-aware internally"; Structural Seed: "`danger_zone.rs` — same path-resolution swap; **wipe coverage untouched**". This is the strongest possible answer to the brownfield instruction: the guarantee is preserved by keeping the test and the wipe list dataset-blind. Confirmed. |
| F7 | `db/config.rs` is a generic global key-value table (`config(key, value)`) backing flags like `onboarding_completed`; "today there is exactly one such table because there is exactly one dataset" | PARTIAL | Implied by AD-1 (one complete independent SQLite file per dataset ⇒ one `config` table per dataset) and by the Design Paradigm's "settings, onboarding" module list, but never stated. Given this fact is the mechanism behind SPEC Assumption A3 (per-profile onboarding), naming it would remove the only load-bearing inference a story author has to make unaided. |

### 5.2 Identity

| # | Fact | Status | Evidence / gap |
| --- | --- | --- | --- |
| F8 | `credentials.rs` uses fixed global keyring service/account names (`nkbaz-finance` for AI/AWS keys, `nixus-auth`/`cognito-session` for the Cognito session) with **zero profile scoping**, plus an in-process `SESSION_CACHE` assuming exactly one signed-in session machine-wide | COVERED, split deliberately | AD-8 handles the AI/AWS half (per-dataset service names, Default unchanged). AD-9 handles the session half by name and by decision: "`credentials.rs`'s `nixus-auth`/`cognito-session` keyring entry and the in-process `SESSION_CACHE` singleton are **not** touched. There is exactly one Cognito session on the machine at a time, exactly as today." Marked `[ADOPTED]` with matching Deferred bullet 1 and a Prevents clause against scope creep. Both halves of the fact are explicitly accounted for. |
| F9 | `profile_store.rs` stores one JSON doc per Cognito `sub` at `<app_data_dir>/profiles/<sub>.json` (demographic feature, not the finance/car dataset), hanging off the *same* single `app_data_dir`; `sub` validated against `^[A-Za-z0-9_-]{1,128}$` and used **verbatim as a filename (never slugged, to avoid collisions)** — "the same pattern a 'local profile id' would need" | PARTIAL | The distinctness and global anchoring are COVERED and well argued (AD-13; mermaid diagram keeps `ProfileStore` off the `DatasetCtx` path; Structural Seed marks `profile_store.rs` UNCHANGED). The italicized hint is **not adopted**: `dataset_id` is used verbatim as a directory name (`datasets/<uuid>/`, plus the literal `"default"`), and no AD states a validation pattern or filename-safety rule for it. Today's ids are spine-generated uuids so the risk is latent rather than live — but the brownfield explicitly offered the precedent and the spine is silent. |
| F10 | `commands/danger_zone.rs::delete_all_data` deletes the **entire** `profiles/` directory (every Cognito sub's document at once) — not scoped to one sub; `profile_store::delete_all_profiles` has the same whole-directory semantics | **MISSING** | Nothing in the spine addresses it. This is the sharpest collision between AD-5 (danger-zone scopes to the active dataset) and AD-13 (`profiles/` stays global): the same command now has one dataset-scoped effect and one machine-global effect. See Finding G3. |
| F11 | Grepping the Rust source for `workspace`, `multi_tenant`, `instance_id`, `active_profile`, `current_profile` returns **zero matches**; no switching mechanism and no "active profile" state anywhere today | COVERED | The naming field is confirmed clear, and the spine claims `Dataset`/`datasets.rs`/`datasets/`/`dataset_id` (Consistency Conventions) — none of the greppable collisions. The absence of any switching mechanism is precisely what AD-6 introduces. |
| F12 | "**Terminology collision to actively avoid:** …must not reuse the bare word 'Profile' for its own UI/entity naming" | PARTIAL — see C3 | Entity/code naming: fully COVERED (AD-13 + naming convention forbid "profile" in code identifiers and give the `datasets/` vs `profiles/` directory split). **UI naming: not covered** — the naming convention mandates user-facing "profile", which is exactly the bare word this fact says must not be reused for UI. The spine attributes that choice to the SPEC (CAP wording does say "local profile"), so the two inputs pull against each other and the spine picks one side without recording the conflict or how users will tell the two apart. See Finding G1. |

### 5.3 Existing UI surfaces

| # | Fact | Status | Evidence / gap |
| --- | --- | --- | --- |
| F13 | `routes/__root.tsx` renders sidebar + `TopBar` + `DestinationNav` + `<Outlet/>` unconditionally on every route, including `/onboarding`; **no existing chrome-free full-page route template**. Closest patterns: `OnboardingWizard.tsx`'s centered-column convention (logo mark, `text-h1`, `Card` tiles, still inside the shell) and the shared `Dialog` primitive (documented in-repo as reserved for destructive confirms only, not full flows) | PARTIAL | The structural half is COVERED and explicitly reasoned: AD-14 chooses a conditional shell skip in `__root.tsx` "rather than a full pathless-layout-route reorg of every existing file (lowest blast radius; **no chrome-free template exists today**)", with Deferred bullet 3 recording the reorg as future work. The two named precedents are unused: no reference to `OnboardingWizard.tsx`'s centered-column convention for the picker's styling, and no statement that the picker must not be built on `Dialog`. Feeds Finding G6. |
| F14 | `routes/index.tsx`'s `beforeLoad` is the **only** launch-time redirect gate today (calls `check_onboarding_status`, redirects to `/onboarding`); "This is the single point a profile-picker gate would need to sit in front of" | PARTIAL / mild DRIFT | AD-14 places the gate in `__root.tsx` instead ("Before any other route resolves… an in-memory-only flag is checked; unset → redirect to `/picker`"), and its Prevents clause does name the onboarding wizard as a path that must not be reached first. But the spine never cites `routes/index.tsx`'s `beforeLoad` or `check_onboarding_status`, so it neither adopts nor explicitly rejects brownfield's identified insertion point, and the resulting gate ordering (root picker gate vs. index onboarding gate) is unstated. See Finding G2. |
| F15 | `components/auth/AccountPromptDialog.tsx` fires every launch when the session resolves to `LoggedOut` and hasn't been dismissed this session (no persisted dismissal); copy "Nixus accounts are here" / "Continue Offline" / "Create Nixus Cloud Account" | COVERED | AD-14 deletes it outright and says why ("fully superseded… not left dormant"); its Prevents clause names `AccountPromptDialog` as a launch path that must not precede the picker. Residual i18n orphans noted at A2. |
| F16 | `components/auth/ProfileMenu.tsx` top-right menu with states `loading \| logged-out \| logged-in \| session-expired \| unavailable` driven by `useAuthSession()`; logged-out/default button label is the literal **"Sign In with Nixus Cloud"** (`profile.signIn`) — "this is the exact entry point CAP-5 replaces"; when logged in the dropdown shows email/name, a "Profile" item linking to `/profile`, and "Sign out" | **MISSING** | The spine never mentions `ProfileMenu.tsx`. It is absent from every AD, from the Capability Map's CAP-5 row (which lists only `commands/auth.rs` and `commands/backup.rs`), and from the Structural Seed's frontend tree. Yet it is: (a) the sole CAP-5 entry point; (b) the surface where AD-10's derived signed-in/signed-out badge must render; (c) the home of the "Profile" menu item at the center of the C3 naming collision. Highest-leverage single gap. See Finding G2. |
| F17 | `hooks/useAuth.ts` exports `useAuthSession()` (query key `["auth","session"]`), `useSignIn()` (`start_login`), `useSignOut()` (`sign_out`); listens for Tauri event `auth:callback-received` to invalidate/refetch. `AuthState` union in `lib/types.ts` is `{LoggedOut} \| {LoggedIn, email, name} \| {SessionExpired}` — **no `sub` on the wire type** | PARTIAL | Partly covered: AD-7 names `useAuth.ts`/`useDatasets.ts` as the `dataset:switched` listener; AD-11 leaves `useSignIn`'s `start_login` invocation intact except for the new intent argument; AD-10 relies on existing `sign_out`. Two gaps: (a) the missing `sub` on the wire type versus AD-10's required `sub` comparison (Finding G5); (b) event interaction — after AD-12's callback branch calls `select_dataset`, both `auth:callback-received` (invalidate/refetch `["auth","session"]`) and `dataset:switched` (full `queryClient.clear()`, AD-7) fire for one user action, and no AD states their ordering. |
| F18 | Relevant existing `en.json` keys (`profile.signIn`, `auth.promptTitle`, `auth.promptBody`, `auth.promptFutureFeatures`, `auth.createAccount`, `auth.continueOffline`); **all have French parity counterparts enforced by a locale-parity test suite** | **MISSING** | The spine adds user-facing surfaces (picker screen, "Log in with Nixus Cloud", "+ New local profile", "Migrate to Nixus Cloud", cloud-linked-but-signed-out badge) and deletes another, but says nothing about i18n keys, French parity, or the parity test suite that enforces it. The Consistency Conventions table's Naming row addresses user-facing *wording* but not localization. This is a concrete, test-enforced obligation the spine is silent on. See Finding G2. |

### 5.4 Auth flow

| # | Fact | Status | Evidence |
| --- | --- | --- | --- |
| F19 | Cognito public app client, Authorization Code + PKCE, `state` CSRF check, loopback HTTP redirect (`http://127.0.0.1:52847/callback`, not the original custom URI scheme) via short-lived local listener, token exchange Rust-side only via `reqwest`, session persisted as one JSON blob in the OS keyring via `credentials.rs` | COVERED | AD-11 declares PKCE, `state` CSRF check, token exchange, and `credentials.rs` storage "100% unchanged", and confines the change to `handle_auth_callback`'s post-token-exchange branch (AD-12). AD-9 keeps the keyring session blob untouched. The `LoginIntent` is explicitly held "in-process alongside the existing PKCE `state`/verifier across the redirect round-trip", which is the correct place given the loopback round-trip. Confirmed. |

---

## 6. Success signal — clause by clause

| Clause (SPEC L73) | Status |
| --- | --- |
| "A user upgrading from the current single-dataset build sees, on next launch, a dedicated picker screen" | COVERED — AD-14 + AD-4 (bootstrap before UI) |
| "showing a 'Default' profile containing every pre-existing record untouched" | COVERED — AD-2 (nothing moved/copied/rewritten), AD-4 |
| "They can create further local profiles with fully independent datasets **and credentials**" | COVERED — AD-1, AD-2 (CAP-6), AD-8 |
| "and switch between them" | COVERED — AD-6, AD-7 |
| "either log in with a Nixus Cloud account from the picker (landing on a separate, isolated local profile tied to that account)" | COVERED — AD-11, AD-12 `Login` |
| "or migrate a copy of their current local profile's data to a newly created Nixus Cloud account via the top-right 'Migrate to Nixus Cloud' action" | PARTIAL — backend COVERED (AD-11, AD-12 `Migrate`); the **top-right action** itself is the F16 `ProfileMenu.tsx` gap |
| "with the original profile left untouched" | COVERED — AD-12 |
| "and **every byte of data, for every profile, staying on their machine**" | PARTIAL — only Deferred bullet 4; no invariant. See C1 / Finding G4 |

---

## 7. Findings (ranked)

**G1 — The "must not confuse the two Profile concepts" constraint is solved for code, not for users.**
Constraint: *"…must be named so **users** cannot confuse the two"* (SPEC L52); brownfield L21 *"must not reuse the bare word 'Profile' for its own UI/entity naming."* AD-13 and the Consistency Conventions Naming row solve the code/filesystem axis convincingly (`Dataset`/`datasets.rs`/`datasets/`/`dataset_id`, deliberately distinct from `profiles/`), but the same row mandates *"User-facing copy: 'profile' (per SPEC)"* while brownfield L28 records an existing user-facing dropdown item literally labelled **"Profile"** → `/profile`. After this change a user meets "profile" (dataset) and "Profile" (demographic form) in the same session, and no AD disambiguates them. The spine also does not record that its two inputs conflict here.

**G2 — CAP-5's actual entry point, `ProfileMenu.tsx`, and all i18n/locale-parity work are absent from the spine.**
Brownfield L28 identifies `components/auth/ProfileMenu.tsx`'s literal "Sign In with Nixus Cloud" (`profile.signIn`) as *"the exact entry point CAP-5 replaces"*; SPEC CAP-5 says Migrate appears *"in place of today's 'Sign In with Nixus Cloud' entry point"* and Assumption A1 says *"only its sign-in entry point's copy/behavior changes."* `ProfileMenu.tsx` appears in no AD, in no Capability-Map row (CAP-5 lists only `commands/auth.rs` + `commands/backup.rs`), and nowhere in the Structural Seed — even though it must also host AD-10's derived cloud-linked-but-signed-out badge and gate Migrate to `kind: "local"` datasets only. Related and equally silent: brownfield L30's French-parity **locale-parity test suite**, against which every new picker/Migrate string is an obligation, and the `auth.prompt*`/`auth.createAccount`/`auth.continueOffline` keys orphaned by AD-14's deletion of `AccountPromptDialog`. Adjacent: brownfield L26's `routes/index.tsx` `beforeLoad` — brownfield's nominated gate insertion point — is neither adopted nor rejected, leaving picker-gate vs. onboarding-gate ordering unstated.

**G3 — AD-5's "sole path-resolution authority" and AD-13's "profiles/ stays global" contradict at `commands/profile.rs`, and `delete_all_data`'s global `profiles/` wipe is unreconciled.**
Brownfield L7 lists `commands/profile.rs::resolve_profiles_dir` as one of the five `app_data_dir` call sites. AD-5 forbids `commands/*.rs` from calling `app.path().app_data_dir()` and requires `datasets::active_dataset_dir(&app)`; AD-13 requires that exact site to resolve to the **global** root. No exception is carved out. Separately, brownfield L19 records that `commands/danger_zone.rs::delete_all_data` deletes the **entire** `profiles/` directory (all Cognito subs), which under AD-5 becomes a dataset-scoped command with a machine-global side effect — contradicting SPEC Assumption A4's *"scoped to the active/selected profile rather than the whole machine."* Also, `lib.rs` (setup), the fifth call site and the one that builds `DbState`, is not enumerated in AD-5 despite being newly AD-4-ordered.

**G4 — The "no data leaves the machine" constraint exists only as a Deferred bullet, never as an invariant.**
SPEC L50 states it as a hard constraint for *every* profile including cloud-linked ones, and the Success signal repeats it ("every byte of data, for every profile, staying on their machine"). The spine's only treatment is Deferred bullet 4 (cloud sync is a non-goal). Nothing in Invariants & Rules constrains network egress — notably not AD-11/AD-12, the only decisions that add network activity (token exchange). A reviewer or story author has no rule to check against.

**G5 — AD-10's derived signed-in/out display needs a `cognito_sub` that the auth wire type does not carry.**
AD-10 computes cloud-linked state by *"comparing that stored `sub` to whatever `get_auth_session` currently reports globally"* and asserts *"No new Rust state."* Brownfield L29 records `AuthState` as `{LoggedOut} | {LoggedIn, email, name} | {SessionExpired}` — **no `sub` on the wire type**. Either the wire type/command surface changes (unstated, and in tension with C2's "reuse as-is" posture toward `get_auth_session`) or the comparison happens Rust-side behind a new command (also unstated). Related unstated interaction: one login action now fires both `auth:callback-received` (refetch) and `dataset:switched` (full `queryClient.clear()`, AD-7) with no defined ordering.

Secondary (recorded, below the top 5):

- **G6 — Picker visual-style constraint unaddressed.** SPEC L53's design-system requirement (dark theme, existing shared UI primitives, per the attached reference, "not a generic OS-native or unstyled dialog") has no AD or convention. Brownfield L25's two offered precedents — `OnboardingWizard.tsx`'s centered-column convention, and `Dialog` being reserved in-repo for destructive confirms only — are uncited, so the spine also never rules out building the picker on `Dialog`.
- **G7 — `"nkbaz-finance.db"` literal duplication and `commands/mod.rs::get_db_status` unaddressed.** Brownfield L8 flags four duplicate literals, no `const DB_FILENAME`, and `get_db_status` returning a bare literal that is "already misleading today". Under multi-dataset it becomes strictly more misleading, and the file is not in the Structural Seed.
- **G8 — No failure/rollback semantics for `select_dataset`.** Brownfield L11 hands over `restore_from_file`'s full proven sequence *including* `-wal`/`-shm` sidecar removal and rollback-to-safety-copy, explicitly "to reuse for 'switch active profile'". AD-6 adopts drop→reopen→swap but is silent on what happens if the target fails to open after the current connection is already dropped.
- **G9 — `dataset_id` filename/directory-safety rule not adopted.** Brownfield L18 offers `profile_store.rs`'s `^[A-Za-z0-9_-]{1,128}$` verbatim-filename precedent as "the same pattern a 'local profile id' would need"; AD-2/AD-3 use ids verbatim as directory names with no stated validation.
- **G10 — CAP-6 label assignment undefined.** AD-3 makes `label` a required registry field; SPEC non-goal 9 forbids custom labels/renaming; neither doc says what a manually created local profile is labelled.
- **G11 — `db/config.rs` / `onboarding_completed` per-dataset behavior implied but never stated**, leaving SPEC Assumption A3 (fresh profile starts unonboarded) as an unaided inference (brownfield L13).
- **G12 — C8's "and other keyring-backed settings"** is narrowed by AD-8 to AI/AWS keys, with the Cognito session deliberately excluded per AD-9. Intentional and justified, but a literal narrowing of the constraint's wording worth naming at story time.

## 8. Verdict

**Gaps found.** The spine is a strong, faithful response to its inputs on the hard part — data isolation and the Cognito reuse posture. Every capability has at least partial coverage and no capability is entirely missed. CAP-2, CAP-3, and CAP-4 are cleanly covered; brownfield's most consequential facts (F3 `init_db` shape, F4 single `DbState`, F6 wipe-coverage test, F8 keyring/`SESSION_CACHE`, F19 auth flow) are adopted explicitly and by name, and AD-5 correctly identifies the five-call-site smell as the real work.

The gaps cluster in two places. First, the **frontend/user-facing surface is under-specified**: `ProfileMenu.tsx` (CAP-5's only entry point), i18n and the French-parity test suite, and the picker's design-system conformance are all absent, while the user-facing half of the naming constraint is contradicted rather than resolved. Second, **two AD pairs collide at `profiles/`**: AD-5 vs AD-13 at `commands/profile.rs`, and per-dataset danger-zone scoping vs the global `profiles/` wipe. G1–G3 should be resolved before the reviewer gate; G4 and G5 are cheap to close and both concern requirements the SPEC states twice.
