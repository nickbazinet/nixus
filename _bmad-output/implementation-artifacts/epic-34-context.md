# Epic 34 Context: Multiple Isolated Local Profiles

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 33 built the dataset-scoping foundation (path authority, registry, active-dataset lock, launch picker) but left the machine with exactly one profile. This epic makes multi-profile real: the user can create additional empty local profiles from the picker and switch freely between them, with *complete* isolation of financial data, car data, settings, onboarding state, staged imports, dismissed-banner flags, and AI-provider credentials. Isolation is the whole deliverable — the feature is only valuable if a user can trust that populating a second profile never appears in, or alters, the first. That trust has to be demonstrated, not asserted, so the epic ends with an automated end-to-end spec that creates, populates, and switches back and forth verifying nothing bleeds through in either direction.

## Stories

- Story 34.1: Create additional local profiles from the picker
- Story 34.2: AI-provider credentials become per-profile
- Story 34.3: Per-dataset financial data stays isolated across backup, import, and danger-zone
- Story 34.4: No frontend-persisted state survives a profile switch
- Story 34.5: End-to-end isolation verification across repeated switching

## Requirements & Constraints

- Switching profiles must never mix or leak data or credentials between them — financial data, car data, settings, onboarding state, and keyring-backed AI/API keys all included.
- Profile labels are auto-generated (`"Local Profile <n>"`, n = count of existing non-default, non-cloud-linked profiles + 1). No free-text label input may appear anywhere in the UI — renaming and custom labels are an explicit non-goal this pass.
- No profile deletion/removal from the picker in this pass, and a profile's data is never auto-deleted.
- An upgrading Default-profile user must not have to re-enter an already-configured AI-provider key — Default's credential storage keeps working with zero migration.
- Each profile has its own independent onboarding state: a freshly created non-Default profile starts fully unonboarded and goes through the same wizard as a first-ever install.
- Backup/export, restore, statement import, and "delete all data" become scoped to the active profile rather than the whole machine.
- One documented exception to that scoping: "delete all data" continues to wipe the demographic `/profile` documents machine-wide, exactly as it does today. This is intentional parity, not a regression to fix — but it is a real user-visible consequence worth surfacing in the danger-zone confirmation copy.
- No operation may ever target Default's directory as a whole (only specifically named files within it) — the registry and every other profile live in that same directory.
- No data leaves the machine; this epic adds no network calls at all.
- New user-facing strings live under the `datasets.*` i18n namespace and land in both `en.json` and `fr.json` in the same change (existing locale-parity CI enforces this).

## Technical Decisions

- **Isolation mechanism:** isolation comes solely from *which directory the DB initializer is pointed at* — never from a shared file with per-dataset rows or schemas. The migrations runner, backup module, and danger-zone wipe run completely unmodified against whichever directory is active and must never become dataset-aware internally. The existing wipe-coverage test that asserts every schema table is covered must keep passing unmodified against whichever profile is active.
- **New dataset creation:** `create_dataset` mints a lowercase UUID v4, creates `<app_data_dir>/datasets/<uuid>/` with its own fresh migrated database, and appends a full-schema registry entry under the *same single registry writer lock* every other mutator uses (held for the whole read-modify-write, not just the final write). The UUID string is used byte-identical — never re-cased or slugged — as both the directory name and the keyring service-name suffix.
- **Per-profile credentials:** the credential module's AI/AWS key functions take a `dataset_id` and compute the keyring *service* name as the unchanged literal `"nkbaz-finance"` when the id is `"default"`, and `"nkbaz-finance-<dataset_id>"` otherwise. The credential module remains the only place in the codebase touching keyring entries — no new call site may bypass it.
- **Path resolution for per-profile files:** statement-import staging files are per-profile financial data and must resolve through the dataset path authority, not a bare app-data-dir call. Call sites that already hold the active-dataset guard (backup, import, danger-zone) build their path from the id they already hold in that guard, and must not re-enter the fallible `active_dataset_dir()` helper from inside that critical section (the lock is non-reentrant — it would deadlock).
- **Frontend state sweep:** the full query-cache clear on dataset activation (from Epic 33) is necessary but not sufficient. Any `localStorage` or component-persisted value that mirrors one profile's data or progress must also be cleared or scoped. Known starting points are the statement-import draft and the onboarding/setup-banner dismissal flags in the danger-zone, setup-incomplete-banner, and car-onboarding-checklist components — but the rule is binding beyond that list, so identifying additional keys is part of the work, not optional. Surveying for them is expected; the enumeration in planning is deliberately non-exhaustive.
- **Naming convention:** code identifiers use `Dataset`/`dataset_id`/`datasets/` — never "profile"; user-facing copy says "profile." The demographic Profile feature (name/DOB/income/location, keyed by Cognito `sub`) is a separate concept and stays anchored at the global root regardless of active dataset.
- **No new dependencies.** Everything is built on the existing SQLite, keyring, Tauri event, and TanStack Router/Query stack.

## UX & Interaction Patterns

- The picker gains a "+ New local profile" action alongside the profile list, styled with the same shared-UI primitives and dark-theme tokens as the rest of the picker — no separate dialog system.
- A newly created profile appears in the picker list immediately and is selectable exactly like any other profile; opening it lands in the onboarding wizard rather than the dashboard, since its dataset is genuinely empty.
- Switching profiles should read as "log out of profile A / log into profile B" — back to the picker, then into the new profile's own entry view — never a raw page reload.

## Cross-Story Dependencies

- All of Epic 33 is a hard prerequisite: this epic reuses its path authority, registry + writer lock, active-dataset lock, `select_dataset` hot-swap, and `dataset:switched` event.
- Story 34.1 (creating a second profile) must land before 34.2, 34.3, 34.4, and 34.5 — every isolation story needs two profiles to prove anything.
- Story 34.4 completes the coverage the query-cache clear in Epic 33 started; the two together are what satisfy the "no per-profile frontend state survives a switch" rule. Neither alone is sufficient.
- Story 34.5 depends on 34.1–34.4 all being in place, and its Playwright spec builds on the Tauri-mock cases added across the existing spec suite in Epic 33.
- Epic 35 (Nixus Cloud login and migration) depends on this epic's per-profile keyring naming, since migrating a profile to a cloud-linked one copies its per-profile credential entries.
