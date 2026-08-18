---
lens: web-verification / reality-check
target: ARCHITECTURE-SPINE.md (Local Profiles & Nixus Cloud — Step 1)
reviewed: '2026-08-18'
verdict: PASS with 1 MEDIUM finding
external_web_lookups_required: 0
---

# Review — Web / Reality Verification Lens

**Question this lens answers:** was every committed decision grounded in the web, the
existing project, or the current starter — or asserted from training data?

## Verdict

**PASS with one MEDIUM finding.**

This spine binds **zero new external technology**, so the verification burden collapses
almost entirely from "research the web" to "confirm against this exact codebase." Every
Stack table entry matches `docs/project-context.md` exactly, and every behavioural claim
about a library was traced to a real call site in this repository rather than to model
priors. **No external web lookup was required or performed** — deliberately, per the
scope of this pass: nothing new is being introduced whose live defaults or current
version could have drifted.

The one MEDIUM finding is not a version error and not a web-currency error. It is a
**reality-check gap**: AD-5's factual claim about the *existing* codebase was inherited
from `brownfield.md` and is undercounted against the actual source.

## Stack Table Verification — all entries CONFIRMED

Checked against `docs/project-context.md` (the project's own pinned-version record),
not against training data.

| Spine entry | Spine version | project-context.md | Result |
| --- | --- | --- | --- |
| rusqlite | 0.38 (bundled SQLite) | line 42 — `rusqlite 0.38 (bundled SQLite)` | ✅ exact match |
| keyring / keyring-core | 4 / 1 | line 49 — `keyring 4 + keyring-core 1` | ✅ exact match |
| Tauri | 2.x | line 31 — `Tauri 2.x (@tauri-apps/api ^2)`; line 40 — `tauri 2, tauri-build 2` | ✅ exact match |
| TanStack Router | 1.167.0 | line 30 — `TanStack Router 1.167.0` | ✅ exact match |
| TanStack Query | 5.90.21 | line 32 — `TanStack Query 5.90.21` | ✅ exact match |

**No mismatches.** The "No new dependencies" header claim holds: nothing in the
Structural Seed, the Invariants, or the Capability Map requires a crate or npm package
absent from `project-context.md`.

Notable positive: AD-8 and AD-93 correctly say `credentials.rs` touches
**`keyring_core::Entry`**, not `keyring::Entry`. That distinction is a documented
project-specific trap (`project-context.md` line 49: `keyring` v4 is used exactly once,
in `lib.rs`, for `use_native_store(false)`). A training-data-driven spine would almost
certainly have written `keyring::Entry`. This is evidence of genuine grounding.

## Behavioural Claims — traced to source

Each claim the spine makes about how an existing technology *currently behaves* was
verified in-repo. None needed a web check.

| Claim | Grounding | Result |
| --- | --- | --- |
| `app.path().app_data_dir()` is the resolution API in use | `lib.rs:53`, `commands/backup.rs:30,95`, `commands/danger_zone.rs:26`, `commands/profile.rs:16`, `commands/import.rs:41`, `commands/maintenance.rs:297` | ✅ API real and in use (but see F1 on the *count*) |
| `init_db` already takes a **directory**, so re-pointing per dataset is cheap (AD-1, AD-2) | `db/mod.rs:67` — `pub fn init_db(app_data_dir: &Path)`; joins `nkbaz-finance.db` at `:72` | ✅ confirmed — this is the load-bearing premise of the whole spine and it is real |
| `open_configured` exists as the reopen path (AD-6) | `db/mod.rs:79` — `pub(crate) fn open_configured(db_path: &Path)` | ✅ confirmed |
| `write_json_atomic` exists in `json_store.rs` and is reusable as-is (AD-3) | `json_store.rs:14` — `pub(crate) fn write_json_atomic<T: Serialize>`; already reused by `profile_store.rs:439` and `maintenance/catalog.rs` | ✅ confirmed, and `pub(crate)` visibility permits use from a new `datasets.rs` |
| `export_backup`'s `PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` sequence is real and reusable (AD-12) | `commands/backup.rs:26` (pragma) + `:60` (`std::fs::copy`) | ✅ confirmed — see F2 for a precision caveat |
| `SESSION_CACHE` is an in-process singleton left untouched (AD-9) | `credentials.rs:359` — `static SESSION_CACHE: Mutex<Option<Option<CognitoSession>>>` | ✅ confirmed |
| `queryClient.clear()` is the full-clear API, distinct from scoped `removeQueries` (AD-7) | `clear()` already used at `DangerZone.tsx:89`, `YourDataSettings.tsx:70`; scoped `removeQueries` at `useAuth.ts:21,22,66,67` with an in-code comment explaining why | ✅ confirmed — AD-7 mirrors an existing in-repo pattern, and the AD-7-vs-`useAuth` D5 distinction it draws is real, visible in code |
| No chrome-free route template exists today (AD-14) | `__root.tsx` renders `AppSidebar` / `TopBar` / `DestinationNav` unconditionally; all 31 route files sit under that shell | ✅ confirmed |
| Conditional shell in `__root.tsx` is mechanically available (AD-14) | `__root.tsx` **already imports `useRouterState`** from `@tanstack/react-router` — the exact hook needed to branch on the matched route | ✅ confirmed feasible with an API already in the file; no new Router capability assumed |
| `AccountPromptDialog` exists and is root-mounted, so deleting it is a real change (AD-14) | `components/auth/AccountPromptDialog.tsx` exists; imported in `__root.tsx` | ✅ confirmed |
| No new `AppError` variant needed beyond `File`/`Validation` (Conventions) | `project-context.md:102` lists `validation`, `file` among existing types; both used at `commands/backup.rs:32`, `json_store.rs` | ✅ confirmed |
| `#[tauri::command(rename_all = "snake_case")]` + `Result<T, AppError>` convention | `project-context.md:80,261` | ✅ confirmed |

## Findings

### F1 — MEDIUM — AD-5's "5 call sites" is undercounted; two real `app_data_dir` resolvers are unaccounted for

AD-5 says the spine prevents "a 6th independently-computed `app.path().app_data_dir()`
call site (the exact smell already present at **5 sites** per `brownfield.md`)."

That number is inherited verbatim from `brownfield.md:7`, which enumerates: `lib.rs`
(setup), `commands/backup.rs` (`export_backup`, `import_backup`),
`commands/danger_zone.rs` (`delete_all_data`), `commands/profile.rs`
(`resolve_profiles_dir`).

**The actual codebase has two additional independent resolvers that neither
`brownfield.md` nor this spine mentions:**

1. `commands/import.rs:40-41` — a private `resolve_app_data_dir(&AppHandle)` helper,
   used at `:167-168` to build `app_data_dir.join("imports")`.
2. `commands/maintenance.rs:295-297` — a *second, separate* private
   `resolve_app_data_dir(&AppHandle)` helper, used at `:305,311,323`, feeding
   `maintenance/catalog.rs:74` → `app_data_dir.join("vehicle_catalog")`.

So the real count is **7 direct `.app_data_dir()` resolutions across 6 files**, and
there are already **two duplicated private helpers of the same name** — the smell is
worse than documented.

**Why this matters to the spine, not just to trivia:**

- AD-5 is declared as binding **all** capabilities (CAP-1..CAP-6) and asserts
  `datasets.rs` is the *sole* path-resolution authority. Its rule text enumerates
  `backup.rs`, `danger_zone.rs`, `commands/*.rs`, and `credentials.rs` — the
  `commands/*.rs` wildcard technically covers `import.rs` and `maintenance.rs`, but
  the spine never *decides* what should happen to them.
- The **Structural Seed lists neither** `commands/import.rs` nor
  `commands/maintenance.rs` as MODIFIED, while explicitly listing `backup.rs` and
  `danger_zone.rs`. A story-writer reading the Seed as the change manifest will miss them.
- Two unresolved product questions follow, and the spine answers neither:
  - **`imports/`** (uploaded statement files) — almost certainly *should* be
    dataset-scoped, since it holds one dataset's financial documents. Left at the
    global root, dataset B's picker-launched session would see dataset A's imported
    statements. That is the same leak class AD-8 protects AI keys from.
  - **`vehicle_catalog/`** — a make/model reference cache, not user data. Almost
    certainly *should stay global* (scoping it would re-download the catalog per
    dataset for no benefit).
- Contrast with `profile_store.rs`, which the spine handles *correctly and explicitly*:
  AD-13 exists purely to declare it intentionally global. `imports/` and
  `vehicle_catalog/` deserve the same explicit adjudication rather than falling through
  a wildcard.

**Recommended fix (small, spec-level, no design change):** extend AD-5's rule to name
all 7 sites, correct the "5 sites" count, and add one sentence each declaring
`imports/` **dataset-scoped** (routed through `datasets::active_dataset_dir`) and
`vehicle_catalog/` **intentionally global** (an AD-13-style carve-out). Add
`commands/import.rs` (MODIFIED) and `commands/maintenance.rs`
(UNCHANGED-by-exception, or MODIFIED if scoped) to the Structural Seed. Optionally note
that the two duplicate `resolve_app_data_dir` helpers collapse into
`datasets::active_dataset_dir`, which is a cleanup win AD-5 already earns for free.

*Lens note:* this is squarely a verification finding — the spine asserted a fact about
the current project that a direct read of the project contradicts.

### F2 — LOW — AD-12's "byte-identical" copy should state that WAL sidecars are deliberately not copied

AD-12 says Migrate copies the source DB "by reusing `export_backup`'s proven
`PRAGMA wal_checkpoint(TRUNCATE)` + `std::fs::copy` sequence (never a fresh `init_db`,
so the copy is byte-identical data, not an empty schema)."

The mechanism is correctly grounded (`commands/backup.rs:26` + `:60`, copying only
`nkbaz-finance.db`). But this repo carries an explicit, hard-won caveat about exactly
this pragma, documented at `db/backup.rs:14-20`:

> The live connection is *dropped* rather than merely checkpointed: `wal_checkpoint`
> empties the `-wal` but leaves it and the `-shm` wal-index on disk and mapped into
> memory. SQLite only unlinks them when the last connection closes cleanly. Overwrite
> the database file while a stale `-shm` survives and the next connection attaches a
> wal-index describing the *previous* file's pages, which SQLite reports as
> "database disk image is malformed".

For Migrate this is **benign as specified** — the destination is a brand-new empty
directory and only the main `.db` file is copied, so no stale sidecar can be inherited.
The risk is purely in the phrase "byte-identical": an implementer optimising toward
"copy the dataset directory" (a natural reading, and arguably simpler) would carry a
stale `-wal`/`-shm` into the new dataset and reproduce the documented
`database disk image is malformed` failure.

**Recommended fix:** one clause in AD-12 — "copy the single `nkbaz-finance.db` file
only; `-wal`/`-shm` sidecars are intentionally **not** copied (see `db/backup.rs`'s
wal-index rationale)." Prevents a real, previously-encountered failure mode at zero
design cost. Note the spine's choice of the *export* path over the *restore* path is
the right one and needs no change.

### F3 — LOW / informational — AD-14's `AccountPromptDialog` deletion + launch gate has a documented E2E-mock consequence the spine doesn't mention

`project-context.md:295` records a project-specific rule earned from prior pain:

> **When adding any always-mounted root-level component that calls `invoke()` on load**
> … every existing spec's Tauri mock must add a case for the new command(s), or that
> spec's mock falls through to `Promise.reject("Unknown command")` … Audit all existing
> specs' mock switch statements before merging, not after.

AD-14 both **deletes** a root-mounted dialog and **adds** a root-level launch gate that
must consult dataset state before any route resolves — i.e. a new always-mounted
root-level `invoke()` (`get_active_dataset` / `list_datasets`). Every existing
Playwright spec under `apps/desktop/tests/` will need its mock switch extended, or all
of them fail at the new gate.

Flagged as informational: this is an implementation-planning consequence rather than a
version/currency defect, and may well be another lens's or the story-writer's territory.
Noting it here only because it is grounded in the project's own recorded rule and the
spine is silent on it.

## What this lens did NOT need to check, and why

- **No web/version research performed.** The spine introduces no new crate, package,
  service, or starter. There is no greenfield starter whose live defaults could have
  drifted, and no named technology whose continued existence is in question — all five
  Stack entries are already compiling and shipping in this repo today.
- **No "does this library still exist" check needed.** rusqlite, keyring/keyring-core,
  Tauri, TanStack Router, and TanStack Query are all present in the working tree at the
  stated versions.
- **No API-currency check needed** for `app_data_dir()`, `queryClient.clear()`,
  `useRouterState`, or `PRAGMA wal_checkpoint(TRUNCATE)` — each was verified against a
  live call site in this codebase, which is strictly stronger evidence than
  documentation for "does this work at our pinned version."

## Bottom line

Version-wise and currency-wise this spine is clean: **zero mismatches, zero new
dependencies, zero unverified external claims**, and several signs of genuine grounding
(`keyring_core::Entry` over `keyring::Entry`; reusing the `export_backup` path over
`restore_from_file`; `useRouterState` already imported where AD-14 needs it). The single
MEDIUM finding is an internal reality-check miss inherited from `brownfield.md` — a
call-site undercount that leaves `imports/` and `vehicle_catalog/` unadjudicated under
AD-5. F1 is worth fixing before story-writing; F2 and F3 are one-sentence hardening.
