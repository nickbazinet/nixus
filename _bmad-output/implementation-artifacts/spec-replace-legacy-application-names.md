---
title: 'Replace legacy application identities with Nixus'
type: 'chore'
created: '2026-09-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '6d98d8a18f49cbebb3b9241c6353819ed444f971'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Active application paths, storage names, package identities, and selected repository metadata still expose the former `nbazinet`/`nkbaz-finance` identity. A direct rename would strand existing desktop data and AI credentials.

**Approach:** Adopt `org.nixusapp.nixus` for the desktop bundle identifier and `nixus` for crate, database, log, keyring, backup, fixture, and internal documentation names. Migrate existing app data and AI credentials idempotently before normal startup, then scrub personal names and obsolete local paths where they are not operational external identifiers.

## Boundaries & Constraints

**Always:** Preserve existing financial data, profiles, registry files, backups, and credentials; migrate before any new database or app-data root can be created; make filesystem migration atomic and repeatable; keep old backup files restorable; use shared constants instead of duplicated filenames; preserve valid GitHub repository URLs, updater URLs, AWS OIDC subjects, support-email records, and retired-origin regression guards.

**Ask First:** Any migration requiring recursive copy instead of same-volume rename; any collision where both legacy and new app-data roots contain user data; any change to a live external account, domain, email address, updater source, or deployment trust policy.

**Never:** Delete or overwrite user data; let a legacy credential overwrite a newer Nixus credential; blanket-replace `nickbazinet` inside operational GitHub/OIDC references; hand-edit generated Tauri schemas or generated router files; rewrite dated BMAD implementation records merely to alter their historical account.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Existing install | Legacy root and database names exist; new root does not | Atomically move the root, checkpoint and rename every dataset DB, then copy verified AI credentials to Nixus services | Abort before database initialization if filesystem migration fails; retain recoverable legacy state |
| Fresh install | Neither legacy nor new state exists | Create and use only `org.nixusapp.nixus` / `nixus` names | Normal startup |
| Repeated launch | New names already exist | Migration is a no-op | Log outcome without modifying data |
| Name collision | Both DB names exist in one dataset | Use the new DB and preserve the legacy DB without clobbering | Warn clearly |
| Keyring unavailable | Legacy keychain cannot be read or written | Continue startup; retry migration on a later launch | Warn without exposing credential values |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/tauri.conf.json` -- bundle identifier and publisher; updater endpoint remains on the current GitHub account.
- `apps/desktop/src-tauri/src/lib.rs` -- startup ordering; migration must precede app-root creation, tracing, database initialization, and AI initialization.
- `apps/desktop/src-tauri/src/datasets.rs` -- sole app-path authority, dataset roots, canonical `nixus.db` name, and legacy-root probing.
- `apps/desktop/src-tauri/src/db/backup.rs` -- WAL checkpoint and sidecar helpers reused by database renaming.
- `apps/desktop/src-tauri/src/credentials.rs` -- canonical and legacy keyring service access plus convergent credential migration.
- `apps/desktop/src-tauri/src/commands/backup.rs` -- canonical dataset path and Nixus backup filename.
- `apps/desktop/src-tauri/{Cargo.toml,Cargo.lock}` and `src/main.rs` -- crate/package rename to `nixus` / `nixus_lib`; regenerate the lockfile.
- `CONTRIBUTING.md`, `docs/project-context.md`, active source comments and fixtures -- current naming documentation and personal-path cleanup.
- `_bmad-output/**` and `docs/superpowers/**` -- scrub obsolete personal local paths/metadata only where not needed as historical migration evidence.

## Tasks & Acceptance

**Execution:**
- [x] Desktop migration module and startup wiring -- atomically relocate the app root, rename root/profile dataset databases after WAL checkpointing, and keep migration idempotent.
- [x] Credential storage -- move each legacy AI secret to the Nixus service with read-back verification and destination-wins collision behavior.
- [x] Desktop manifests/runtime/tests -- rename active bundle, crate, database, log, backup, provider, fixture, and comment identities; centralize constants and regenerate `Cargo.lock`.
- [x] Repository documentation/metadata -- remove obsolete personal local paths and application-brand references while retaining explicitly operational GitHub, OIDC, updater, email, and domain values.
- [x] Migration tests -- cover fresh, existing, repeated, interrupted/collision, WAL, invalid dataset, and keyring scenarios plus an allowlist guard for required legacy literals.

**Acceptance Criteria:**
- Given an existing legacy installation, when the renamed application starts, then all datasets, profiles, AI credentials, and account sessions remain available under the new identity.
- Given a fresh installation, when it starts and creates data, then no legacy application path, file, log, crate, or keyring name is created.
- Given the repository is scanned after migration, when legacy names are found, then every match is an allowlisted compatibility constant, valid external GitHub/OIDC/updater/email/domain value, or preserved historical migration evidence.

## Spec Change Log

## Design Notes

Filesystem migration runs before creating the new app-data directory. It uses an atomic sibling-directory rename and deliberately has no recursive-copy fallback. Database renaming checkpoints WAL files before renaming the main file. Keyring migration is per-entry and convergent: copy only when the destination is absent, verify, then delete the old entry; a populated destination always wins.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero errors.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: all desktop E2E tests pass.
- `pnpm --filter @nixus/desktop test` -- expected: unit tests pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: migration and existing Rust tests pass.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: clean build with no warnings and regenerated lockfile.
- Repository legacy-name scan -- expected: only documented allowlisted compatibility and operational external references remain.

**Manual checks (if no CLI):**
- Upgrade an installation containing multiple profiles and configured AI credentials; confirm data, profile switching, credential use, backup export/restore, and new app-data/log names.

## Suggested Review Order

**Startup and migration sequencing**

- Migration runs before root creation, logging, registry access, databases, and AI initialization.
  [`lib.rs:53`](../../apps/desktop/src-tauri/src/lib.rs#L53)

- Atomic root relocation and explicit collision outcomes protect existing installations.
  [`mod.rs:56`](../../apps/desktop/src-tauri/src/app_migration/mod.rs#L56)

- WAL checkpointing makes each legacy database rename lossless and retryable.
  [`mod.rs:237`](../../apps/desktop/src-tauri/src/app_migration/mod.rs#L237)

**Credential compatibility**

- Per-entry verified copies preserve newer destinations and converge after one launch.
  [`credentials.rs:226`](../../apps/desktop/src-tauri/src/credentials.rs#L226)

- Failed read-back removes the unverified destination while retaining the legacy source.
  [`credentials.rs:304`](../../apps/desktop/src-tauri/src/credentials.rs#L304)

**Canonical Nixus identity**

- The shipped bundle identifier now maps application data to `org.nixusapp.nixus`.
  [`tauri.conf.json:5`](../../apps/desktop/src-tauri/tauri.conf.json#L5)

- One shared constant now controls every live dataset database path.
  [`datasets.rs:456`](../../apps/desktop/src-tauri/src/datasets.rs#L456)

- Package and library names produce the `nixus` executable and `nixus_lib` crate.
  [`Cargo.toml:1`](../../apps/desktop/src-tauri/Cargo.toml#L1)

**Regression coverage and documentation**

- Migration tests cover WAL recovery, collisions, invalid IDs, and corrupt files.
  [`tests_database.rs:12`](../../apps/desktop/src-tauri/src/app_migration/tests_database.rs#L12)

- Structural guards pin startup order, bundle identity, filenames, and allowed legacy literals.
  [`tests_startup_order.rs:68`](../../apps/desktop/src-tauri/src/app_migration/tests_startup_order.rs#L68)

- Contributor guidance records new paths and the compatibility migration contract.
  [`CONTRIBUTING.md:244`](../../CONTRIBUTING.md#L244)
