//! One-time relocation of app data left behind by the pre-Nixus identity.
//!
//! Runs from `lib.rs`'s `.setup()` *before* the new app-data root is created and
//! before tracing, the dataset registry, and any database connection exist — a
//! directory created at the new name would make the root rename below impossible,
//! and a database opened under the new name would shadow the user's real one.
//!
//! Because it precedes the tracing subscriber it cannot log; it returns a
//! `MigrationOutcome` the caller logs once logging is up.
//!
//! Every step is idempotent, so an interrupted run finishes on the next launch,
//! and a run with nothing to do costs two `exists` checks.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::datasets::{is_valid_dataset_id, DATASETS_SUBDIR, DB_FILE_NAME, LEGACY_DB_FILE_NAME};
use crate::db::backup::{remove_sidecars, with_suffix};
use crate::error::AppError;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests_database;
#[cfg(test)]
mod tests_legacy_literals;
#[cfg(test)]
mod tests_relocation;
#[cfg(test)]
mod tests_startup_order;
#[cfg(test)]
mod tests_symlinks;

/// What one run actually did, so the caller can log it after tracing starts.
///
/// The two collision fields are carried rather than resolved: both names holding
/// data is the one state this module refuses to decide on its own, because either
/// resolution would discard something the user created. They are distinct from a
/// no-op precisely so the caller can warn instead of reporting nothing to do.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct MigrationOutcome {
    pub(crate) root_moved_from: Option<PathBuf>,
    pub(crate) root_collision: Option<PathBuf>,
    pub(crate) databases_renamed: Vec<PathBuf>,
    pub(crate) database_collisions: Vec<PathBuf>,
}

impl MigrationOutcome {
    pub(crate) fn is_noop(&self) -> bool {
        *self == Self::default()
    }
}

/// Moves the legacy app-data root onto `root`, then renames every dataset database
/// beneath it to the canonical `nixus.db`.
///
/// `legacy_root` is `None` when the platform gave a root with no parent, which
/// leaves nothing to migrate from.
pub(crate) fn migrate_from_legacy_identity(
    root: &Path,
    legacy_root: Option<&Path>,
) -> Result<MigrationOutcome, AppError> {
    let mut outcome = MigrationOutcome::default();

    match relocate_root(root, legacy_root)? {
        RootRelocation::Moved(from) => outcome.root_moved_from = Some(from),
        RootRelocation::Collision(legacy) => outcome.root_collision = Some(legacy),
        RootRelocation::Nothing => {}
    }

    // A fresh install has no root yet: `bootstrap_registry` creates it moments
    // later, and there is nothing here to rename.
    if root.is_dir() {
        rename_dataset_databases(root, &mut outcome)?;
    }

    Ok(outcome)
}

enum RootRelocation {
    Moved(PathBuf),
    Collision(PathBuf),
    Nothing,
}

/// Renames the legacy root to `root` when — and only when — `root` does not exist.
///
/// A same-volume sibling rename, with deliberately **no** recursive-copy fallback:
/// a copy is not atomic, so a failure part-way through would leave two partial
/// roots and no way to tell which one the user's data is in. The spec requires a
/// human decision before any copy, so a rename that cannot happen is a hard error
/// that leaves the legacy root fully intact and the migration retryable.
///
/// The "`root` must not exist" precondition is stricter than POSIX `rename`, which
/// would happily replace an *empty* destination directory while Windows refuses to.
/// Requiring absence is what makes the outcome identical on all three platforms and
/// makes overwriting user data unrepresentable rather than merely unlikely. Both
/// roots existing is therefore reported as a collision, never merged away.
///
/// A symlink is refused outright. `fs::rename` moves the *link*, not its target, so
/// migrating one would install a symlink as the app-data root — and every dataset
/// path resolved afterwards would land wherever it points, letting the database walk
/// rename files anywhere on the filesystem. Refusing is also the only honest answer:
/// the link may well be a deliberate relocation of the user's data, which is exactly
/// the case the spec reserves for a human.
fn relocate_root(root: &Path, legacy_root: Option<&Path>) -> Result<RootRelocation, AppError> {
    let legacy = match legacy_root {
        Some(legacy) if legacy != root => legacy,
        _ => return Ok(RootRelocation::Nothing),
    };

    if is_symlink(legacy) {
        return Err(AppError::File {
            message: format!(
                "{} is a symbolic link; refusing to migrate it because the data it \
                 points at may live anywhere. Move or replace it with a real directory",
                legacy.display()
            ),
        });
    }

    if !legacy.is_dir() {
        return Ok(RootRelocation::Nothing);
    }

    if root.exists() {
        return Ok(RootRelocation::Collision(legacy.to_path_buf()));
    }

    if let Some(parent) = root.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::File {
            message: format!("Failed to prepare {}: {}", parent.display(), e),
        })?;
    }

    std::fs::rename(legacy, root).map_err(|e| AppError::File {
        message: format!(
            "Failed to move existing application data from {} to {}: {}",
            legacy.display(),
            root.display(),
            e
        ),
    })?;

    Ok(RootRelocation::Moved(legacy.to_path_buf()))
}

/// Whether `path` is itself a symlink, without following it.
///
/// `symlink_metadata` is load-bearing: every `is_dir`/`exists` call in this module
/// follows links, so a link to a directory is indistinguishable from a directory to
/// all of them. An unreadable path is not a symlink for this purpose — the caller's
/// own `is_dir` check rejects it moments later.
fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

fn rename_dataset_databases(root: &Path, outcome: &mut MigrationOutcome) -> Result<(), AppError> {
    for dir in dataset_dirs(root)? {
        match rename_database(&dir)? {
            DbRename::Renamed => outcome.databases_renamed.push(dir),
            DbRename::Collision => outcome.database_collisions.push(dir),
            DbRename::Absent => {}
        }
    }

    Ok(())
}

/// Every directory that can own a dataset database: the root itself, which *is*
/// Default's directory, plus one directory per validly-named profile.
///
/// Walked on the filesystem rather than read from `datasets.json`, because a database
/// left at the legacy name is a database the app will never open again — so the walk
/// has to see directories, not registry entries.
///
/// Filtered by `is_valid_dataset_id` all the same: that predicate decides which
/// directory names the app can ever resolve, so a name it rejects belongs to a dataset
/// the product cannot open by any route. Migrating one would mean renaming a file
/// inside a directory reached by a name that never passed path-component validation.
///
/// Symlinks are skipped, and this is the load-bearing half of the filter: `is_dir`
/// follows links, so a link under `datasets/` would otherwise have the walk rename a
/// file in whatever directory it targets — anywhere on the filesystem, entirely outside
/// the app-data root. A non-directory entry is skipped for the plainer reason that it
/// cannot hold a database.
fn dataset_dirs(root: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut dirs = vec![root.to_path_buf()];

    let nested = root.join(DATASETS_SUBDIR);
    let read = match std::fs::read_dir(&nested) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(dirs),
        Err(e) => return Err(unreadable(&nested, &e)),
    };

    for entry in read {
        let path = entry.map_err(|e| unreadable(&nested, &e))?.path();
        let named_for_a_reachable_dataset = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_valid_dataset_id);

        if path.is_dir() && named_for_a_reachable_dataset && !is_symlink(&path) {
            dirs.push(path);
        }
    }

    Ok(dirs)
}

fn unreadable(path: &Path, cause: &std::io::Error) -> AppError {
    AppError::File {
        message: format!("Failed to read {}: {}", path.display(), cause),
    }
}

enum DbRename {
    Renamed,
    Collision,
    Absent,
}

/// Renames `dir`'s legacy database to `nixus.db`, flushing its write-ahead log first.
///
/// The checkpoint is not an optimization — it is what makes the rename lossless. A
/// `-wal` sidecar holds committed transactions that live *only* there until a
/// checkpoint folds them into the main file, and the sidecar is named after the file
/// it belongs to, so renaming the main file alone would strand every one of them.
/// That is why both the checkpoint and the post-close `-wal` check below are hard
/// errors: proceeding past either is silent data loss.
///
/// A destination that already exists is never touched. That state means a previous
/// run already migrated this dataset (and something recreated the legacy file) or
/// two installs converged here; either way the new database is the live one and the
/// legacy file is preserved for a human to inspect.
fn rename_database(dir: &Path) -> Result<DbRename, AppError> {
    let legacy = dir.join(LEGACY_DB_FILE_NAME);
    let target = dir.join(DB_FILE_NAME);

    if !legacy.is_file() {
        return Ok(DbRename::Absent);
    }
    if target.exists() {
        return Ok(DbRename::Collision);
    }

    checkpoint_and_close(&legacy)?;

    if with_suffix(&legacy, "-wal").exists() {
        return Err(AppError::File {
            message: format!(
                "{} still has an unflushed write-ahead log; renaming it would lose data",
                legacy.display()
            ),
        });
    }

    std::fs::rename(&legacy, &target).map_err(|e| AppError::File {
        message: format!(
            "Failed to rename {} to {}: {}",
            legacy.display(),
            target.display(),
            e
        ),
    })?;

    // The wal-index describes the file it was created beside, so one surviving the
    // rename would have the next connection replay another name's pages.
    remove_sidecars(&legacy);
    remove_sidecars(&target);

    Ok(DbRename::Renamed)
}

/// Folds the write-ahead log into the main file and closes the connection explicitly.
///
/// `Connection::close` rather than a drop: SQLite only unlinks `-wal`/`-shm` when the
/// last connection closes cleanly, and the caller's stranded-log check depends on that
/// having actually happened rather than on a drop whose failure is unobservable.
fn checkpoint_and_close(db_path: &Path) -> Result<(), AppError> {
    let conn = Connection::open(db_path).map_err(|e| AppError::File {
        message: format!("Failed to open {}: {}", db_path.display(), e),
    })?;

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(|e| AppError::File {
            message: format!(
                "Failed to flush the write-ahead log of {}: {}",
                db_path.display(),
                e
            ),
        })?;

    conn.close().map_err(|(_, e)| AppError::File {
        message: format!("Failed to close {}: {}", db_path.display(), e),
    })
}
