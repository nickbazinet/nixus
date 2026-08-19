# Epic 33 Context: Local Profile Foundation — Picker, Default Migration & Dataset Infrastructure

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Today Nixus is strictly single-tenant: one SQLite dataset, one machine, five independent call sites that each compute `app_data_dir` on their own. This epic replaces that with a dataset-scoping foundation: a single path authority, a JSON registry of profiles, and a locked "active dataset" hot-swap, then puts a chrome-free picker screen in front of every launch. On first launch after this ships, an existing user's entire current dataset is automatically and losslessly recognized as a "Default" profile with zero files moved, so today's users see no visible change beyond an extra picker screen before the app they already know. Every later epic (additional local profiles, Nixus Cloud login/migration) depends on this path authority, registry, and lock existing first.

## Stories

- Story 33.1: Dataset path authority replaces every independent `app_data_dir` call site
- Story 33.2: Dataset registry with bootstrap migration to Default
- Story 33.3: Active-dataset state and the locked hot-swap (`select_dataset`)
- Story 33.4: The launch-time picker screen
- Story 33.5: Choosing a profile opens the app scoped to it
- Story 33.6: Existing E2E suite keeps passing with the new launch gate

## Requirements & Constraints

- The picker appears on every single launch, unconditionally — no "last used profile" memory or skip-ahead shortcut, ever.
- Migration of the existing dataset into "Default" must be fully automatic, one-time, and lossless: zero files moved, copied, or renamed, and every pre-existing record (finance, car, settings, onboarding state) present and unchanged afterward.
- Existing single-profile users must never be forced through Cognito or required to create a Nixus Cloud account to keep using the app as before.
- The picker's visual style must match the existing dark-theme design system using `@nixus/shared/ui` primitives — no OS-native dialog, no parallel design system.
- No `select_dataset`/switch, backup, danger-zone, or import operation may ever target Default's directory as a whole (only specifically named files within it) — the registry and every other profile live in that same directory and must never be put at risk.
- Local-profile identity is a new, purely local concept, independent of the Cognito `sub`.
- The demographic "Profile" feature (name/DOB/income/location at `/profile`, keyed by Cognito `sub`) is a distinct concept from the new "local profile" (dataset-selection) concept and must never be confused in naming, code, or UI copy.
- An unparseable `datasets.json` must surface a hard, user-visible error and must never be silently recreated (that would orphan every non-default dataset already on disk).
- No user-visible action, prompt, or delay is acceptable on the upgrade path; a fresh install must still end up with exactly one Default entry.

## Technical Decisions

- **Path authority (AD-5):** `datasets.rs` is the *only* module allowed to call `app.path().app_data_dir()`. It exposes exactly three functions: `global_root()` (the app data root — anchors `datasets.json` and the unrelated `profiles/` dir); `dataset_dir(app, id)` (pure, lock-free — returns `global_root()` when `id == "default"`, else `global_root().join("datasets").join(id)`); and `active_dataset_dir()` (fallible, acquires the active-dataset lock just long enough to read the id, returns `AppError::NotConfigured` if none is active). Call sites that already hold the active-dataset guard (`backup.rs`, `import.rs`, `danger_zone.rs`) must build paths via `dataset_dir(app, &guard.id)` directly and must never call `active_dataset_dir()` from inside that critical section (re-acquiring the lock deadlocks). Paths from these functions are only ever used to name `nkbaz-finance.db` and its `-wal`/`-shm` sidecars — never passed to a recursive delete/copy/walk.
- **Default dataset (AD-2):** fixed literal id `"default"`, `is_default: true`, and its directory *is* `app_data_dir` itself — `nkbaz-finance.db`, `config`, and existing unsuffixed keyring names stay exactly where they are. New datasets get `app_data_dir/datasets/<uuid-v4>/`, generated once and used byte-identical (never re-cased/slugged) as both directory name and future keyring suffix.
- **Registry (AD-3):** one file, `global_root()/datasets.json`, full schema always written: `{ id, label, kind: "local"|"cloud-linked", cognito_sub: string|null, linked_from: string|null, is_default: bool, created_at }`. Written only through the existing atomic-write helper (`write_json_atomic` in `json_store.rs`), serialized through one in-process registry lock held for the full read-modify-write, not just the final write. Missing file → bootstrap (AD-4). Present-but-unparseable → hard error, never silently recreated. On read, each entry's `id` is re-validated against the filesystem-safe charset; a failing entry is skipped and logged, not fatal to the whole load.
- **Bootstrap (AD-4):** runs before any UI renders. If `datasets.json` is missing, create it under the registry lock with exactly one Default entry using the full AD-3 schema, regardless of whether a legacy `nkbaz-finance.db` already exists (upgrade) or not (fresh install). No file is ever moved either way.
- **Active-dataset lock and hot-swap (AD-6):** `DbState` becomes `Mutex<ActiveDataset>` where `ActiveDataset { id: Option<String>, conn: Option<Connection> }` — one struct behind one lock, so "which dataset" and "its connection" can never be read or swapped independently. Starts `{ id: None, conn: None }`. Any command needing DB access while `conn` is `None` returns the existing `AppError::NotConfigured` (no new variant). `select_dataset(id)` resolves the target directory via `dataset_dir`, opens and migrates it via the existing `init_db`/`open_configured` path *before* touching any lock; only on success does it acquire the lock and swap `id`+`conn` together atomically. On failure, previous state is left completely untouched. Every existing `~125` `State<DbState>` access site across `db/*.rs` gains a `.conn.as_ref().ok_or(AppError::NotConfigured)?` guard where it previously did a bare `.lock()`.
- **Switch event (AD-6c):** a successful `select_dataset` always emits `dataset:switched { dataset_id, kind }`, including the very first selection of a run. The frontend's sole switch-completion signal is this event — never a raw page reload.
- **Lock ordering:** the registry lock (AD-3) and the active-dataset lock (AD-6) are distinct. Registry is acquired, then fully released, before the active-dataset lock is ever acquired (e.g. via `select_dataset`). The reverse order is never used in this epic (the one narrow exception involving both locks belongs to Epic 35's Migrate flow, not this epic).
- **Demographic Profile stays untouched (AD-13):** `profile_store.rs`, its `/profile` route, and its Cognito-`sub`-keyed documents remain anchored at `global_root()` regardless of active dataset — a distinct concept from "local profile," never dataset-scoped. `routes/index.tsx`'s existing `check_onboarding_status` gate is unchanged; it simply now runs after the picker gate rather than first.
- **Picker gate (AD-14):** new chrome-free `routes/picker.tsx` — `__root.tsx` conditionally skips shell rendering (sidebar/`TopBar`/`DestinationNav`) for chrome-free routes rather than a full route reorg. Before any other route resolves, a Rust-side flag ("a dataset has been selected this run," alongside `ActiveDataset`) is checked — unset redirects to `/picker`. Nothing persists this flag across launches. `AccountPromptDialog.tsx` is deleted outright, fully superseded by the picker's own "Log in with Nixus Cloud" action (that action's click handler is wired in Epic 35; this epic only needs it present and disabled/inert). The only network calls this feature makes remain Cognito's existing endpoints — nothing new.
- **i18n:** the `auth.promptTitle`/`promptBody`/`promptFutureFeatures`/`createAccount`/`continueOffline` locale keys are removed from both `en.json` and `fr.json` in the same change that deletes `AccountPromptDialog.tsx`.
- **Naming convention:** code entities use `Dataset`/`datasets.rs`/`datasets/`/`dataset_id` — never "profile" in code identifiers. User-facing copy says "profile." `commands/datasets.rs` (thin orchestration) is distinct from top-level `datasets.rs` (the store) — same basename is intentional, not a defect.
- **No new dependencies.** Built entirely on existing `rusqlite`, `keyring-core`, Tauri events, TanStack Router/Query already in the stack.

## UX & Interaction Patterns

- The picker is a dedicated, login-page-like screen, not an in-app view: no sidebar, no top bar, no destination nav.
- It lists every registry entry, styled with the existing `@nixus/shared/ui` primitives and dark-theme tokens.
- A "Log in with Nixus Cloud" action is visible in the picker layout in this epic, but inert/disabled until Epic 35 wires its handler.
- Selecting a profile: the frontend calls `select_dataset`, then on success calls `queryClient.clear()` and navigates into the dashboard (or the onboarding wizard, per that dataset's own `onboarding_completed` state) — never a raw page reload. This must feel like "log out of A / log into B," not a jarring reload.

## Cross-Story Dependencies

- Story 33.1 (path authority) must land before 33.2 (registry) and 33.3 (active-dataset lock), since both build on `datasets.rs`'s path functions.
- Story 33.2 (registry + bootstrap) must land before 33.3 (`select_dataset` reads registry entries) and before 33.4 (picker lists registry entries via `list_datasets`).
- Story 33.3 (`select_dataset`, `dataset:switched` event) is a prerequisite for 33.5 (frontend reacts to the event and navigates).
- Story 33.4 (picker route/gate) and 33.5 (selection flow) together are prerequisites for 33.6 (E2E suite updates, since the new root-level `invoke()` call needs a Tauri mock case in every existing spec).
- This entire epic is a hard prerequisite for Epic 34 (multiple local profiles reuse `create_dataset`/registry/lock) and Epic 35 (Cloud login/migration reuse `select_dataset`, the registry lock, and the picker's inert Cloud action).
