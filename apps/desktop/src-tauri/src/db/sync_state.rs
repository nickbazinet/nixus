//! The `sync_state` row: AD-4's install id and machine fingerprint, AD-7's account
//! pin, and AD-14's Frozen reason. All of the SQL for the table, and nothing else.
//!
//! The row type deliberately carries no `Serialize`: it never crosses IPC (Story 10
//! defines the status shape the UI sees) and AD-16 forbids an account identifier
//! reaching a log line or an exported diagnostic, so there is no reason for the
//! identity id and the owner sub to be one `serde_json::to_string` away from either.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppError;

/// Whether this dataset is bound to a cloud account.
///
/// An *absent* row is also unlinked, which is what makes AD-15's "a wipe unlinks"
/// a plain `DELETE` instead of a second state transition that could half-apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkState {
    Unlinked,
    Linked,
}

impl LinkState {
    fn parse(raw: &str) -> Result<Self, AppError> {
        match raw {
            "unlinked" => Ok(LinkState::Unlinked),
            "linked" => Ok(LinkState::Linked),
            _ => Err(AppError::Database {
                message: "sync_state.link_state holds an unknown value".to_string(),
            }),
        }
    }
}

/// Why transfers are stopped (AD-14). There is no separate boolean: `None` *is* "not
/// frozen", so a frozen state can never exist without a reason to report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrozenReason {
    /// The `multi_device_sync` capability is no longer granted (AD-14, CAP-8).
    EntitlementLapsed,
    /// The cloud copy is owned by a different account than this dataset is pinned to
    /// (AD-7). Never cleared automatically.
    OwnerMismatch,
    /// Set out of band while a problem is investigated.
    Support,
}

impl FrozenReason {
    /// The stable code, which is also the stored value and what AD-16's diagnostics
    /// count. Not a user-facing string: Story 11 owns the i18n copy.
    pub fn code(self) -> &'static str {
        match self {
            FrozenReason::EntitlementLapsed => "entitlement_lapsed",
            FrozenReason::OwnerMismatch => "owner_mismatch",
            FrozenReason::Support => "support",
        }
    }

    fn parse(raw: &str) -> Result<Self, AppError> {
        match raw {
            "entitlement_lapsed" => Ok(FrozenReason::EntitlementLapsed),
            "owner_mismatch" => Ok(FrozenReason::OwnerMismatch),
            "support" => Ok(FrozenReason::Support),
            _ => Err(AppError::Database {
                message: "sync_state.frozen_reason holds an unknown value".to_string(),
            }),
        }
    }
}

/// The single `sync_state` row, parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncState {
    pub install_id: String,
    pub machine_fingerprint: String,
    pub identity_id: Option<String>,
    pub owner_sub: Option<String>,
    pub link_state: LinkState,
    pub frozen_reason: Option<FrozenReason>,
}

const SELECT_ROW: &str = "SELECT install_id, machine_fingerprint, identity_id, owner_sub, \
                          link_state, frozen_reason FROM sync_state WHERE id = 1";

/// The row exactly as stored. Read and parsed in two steps because the row reader must
/// answer `rusqlite::Result` while an unknown enum value has to surface as an `AppError`.
struct StoredRow {
    install_id: String,
    machine_fingerprint: String,
    identity_id: Option<String>,
    owner_sub: Option<String>,
    link_state: String,
    frozen_reason: Option<String>,
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredRow> {
    Ok(StoredRow {
        install_id: row.get(0)?,
        machine_fingerprint: row.get(1)?,
        identity_id: row.get(2)?,
        owner_sub: row.get(3)?,
        link_state: row.get(4)?,
        frozen_reason: row.get(5)?,
    })
}

fn parse_row(raw: StoredRow) -> Result<SyncState, AppError> {
    Ok(SyncState {
        install_id: raw.install_id,
        machine_fingerprint: raw.machine_fingerprint,
        identity_id: raw.identity_id,
        owner_sub: raw.owner_sub,
        link_state: LinkState::parse(&raw.link_state)?,
        frozen_reason: raw
            .frozen_reason
            .as_deref()
            .map(FrozenReason::parse)
            .transpose()?,
    })
}

/// The row, or `None` when this dataset has never run sync.
///
/// `None` is a normal answer, not a fault: a local-only dataset must never have a row
/// at all (inherited AD-12), so every caller has to handle its absence anyway.
pub fn load(conn: &Connection) -> Result<Option<SyncState>, AppError> {
    let raw = conn
        .query_row(SELECT_ROW, [], read_row)
        .optional()?;

    raw.map(parse_row).transpose()
}

/// The row, creating it from `install_id` / `machine_fingerprint` when absent.
///
/// An existing row wins outright — the arguments are *candidates*, not an update. The
/// install id is minted once per install (AD-4) and a second mint for a dataset that
/// already has one would split the `(install, seq)` space; deciding whether the stored
/// fingerprint still describes this machine is `sync::state`'s job, not this one's.
pub fn ensure(
    conn: &Connection,
    install_id: &str,
    machine_fingerprint: &str,
) -> Result<SyncState, AppError> {
    if let Some(existing) = load(conn)? {
        return Ok(existing);
    }

    conn.execute(
        "INSERT INTO sync_state (id, install_id, machine_fingerprint, link_state) \
         VALUES (1, ?1, ?2, 'unlinked')",
        rusqlite::params![install_id, machine_fingerprint],
    )?;

    load(conn)?.ok_or_else(|| AppError::Database {
        message: "sync_state row vanished immediately after it was created".to_string(),
    })
}

/// AD-4's copied-database path: a new install id for the machine the file now sits on.
///
/// The pin is kept. A copy is almost always the same user on a new computer, so the
/// account this dataset belongs to has not changed — only the install has — and
/// discarding the pin would make the next vend adopt whatever account signs in. The
/// link drops to `unlinked` because the new install has uploaded nothing yet; Story 9
/// owns the bootstrap that follows.
pub fn relink_install(
    conn: &Connection,
    install_id: &str,
    machine_fingerprint: &str,
) -> Result<(), AppError> {
    let updated = conn.execute(
        "UPDATE sync_state SET install_id = ?1, machine_fingerprint = ?2, \
         link_state = 'unlinked', updated_at = datetime('now') WHERE id = 1",
        rusqlite::params![install_id, machine_fingerprint],
    )?;

    expect_the_single_row(updated)
}

/// Records the account this dataset belongs to and marks it linked (AD-7).
///
/// Unconditional on purpose: the refusal on a mismatching pin lives in
/// `sync::auth::verify_account_pin` and is applied by `sync::state` before this is ever
/// reached, so a second rule here would be a second place to keep correct.
pub fn set_pin(conn: &Connection, identity_id: &str, owner_sub: &str) -> Result<(), AppError> {
    let updated = conn.execute(
        "UPDATE sync_state SET identity_id = ?1, owner_sub = ?2, link_state = 'linked', \
         updated_at = datetime('now') WHERE id = 1",
        rusqlite::params![identity_id, owner_sub],
    )?;

    expect_the_single_row(updated)
}

/// Freezes (`Some`) or resumes (`None`) transfers. Nothing else about the row changes,
/// which is what makes leaving Frozen a resume rather than a re-link (AD-14, CAP-8).
pub fn set_frozen_reason(conn: &Connection, reason: Option<FrozenReason>) -> Result<(), AppError> {
    let updated = conn.execute(
        "UPDATE sync_state SET frozen_reason = ?1, updated_at = datetime('now') WHERE id = 1",
        rusqlite::params![reason.map(FrozenReason::code)],
    )?;

    expect_the_single_row(updated)
}

/// Turns "the row was not there" into an error instead of a silent no-op: every mutator
/// here is only ever called after `ensure`, so zero rows affected means the row was
/// deleted underneath the caller (a wipe) and the mutation was lost.
fn expect_the_single_row(updated: usize) -> Result<(), AppError> {
    if updated == 1 {
        return Ok(());
    }

    Err(AppError::Database {
        message: "sync_state has no row to update".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{run_migrations, MIGRATIONS};

    const INSTALL: &str = "0123456789abcdef";
    const FINGERPRINT: &str = "ab00000000000000000000000000000000000000000000000000000000000000";

    fn migrated_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fks");
        run_migrations(&conn).expect("run migrations");
        conn
    }

    /// The upgrade path: a database that stopped at v28 must gain the table, not be
    /// rebuilt. Applied the same way `db::backup`'s tests build an older fixture.
    fn db_at_version(max_version: i64) -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fks");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )",
        )
        .expect("create schema_version");

        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= max_version) {
            conn.execute_batch(sql).expect("apply migration");
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
                rusqlite::params![version],
            )
            .expect("record migration");
        }

        conn
    }

    #[test]
    fn a_fresh_database_has_the_table_and_no_row() {
        let conn = migrated_db();

        assert_eq!(load(&conn).expect("load succeeds"), None);
    }

    #[test]
    fn upgrading_from_the_previous_schema_adds_the_table_without_touching_existing_rows() {
        let conn = db_at_version(28);
        conn.execute(
            "INSERT INTO accounts (id, name, institution, account_type) \
             VALUES (1, 'Chequing', 'Bank', 'chequing')",
            [],
        )
        .expect("seed a pre-existing row");
        assert!(
            conn.query_row(SELECT_ROW, [], read_row).is_err(),
            "the fixture must start without the table"
        );

        run_migrations(&conn).expect("forward migrate");

        assert_eq!(load(&conn).expect("load succeeds"), None);
        let accounts: i64 = conn
            .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
            .expect("count accounts");
        assert_eq!(accounts, 1, "the upgrade must not disturb existing data");
    }

    #[test]
    fn ensure_creates_the_row_once_and_then_returns_it_unchanged() {
        let conn = migrated_db();

        let created = ensure(&conn, INSTALL, FINGERPRINT).expect("first ensure");
        assert_eq!(created.install_id, INSTALL);
        assert_eq!(created.machine_fingerprint, FINGERPRINT);
        assert_eq!(created.link_state, LinkState::Unlinked);
        assert_eq!(created.identity_id, None);
        assert_eq!(created.owner_sub, None);
        assert_eq!(created.frozen_reason, None);

        let again =
            ensure(&conn, "fedcba9876543210", FINGERPRINT).expect("second ensure");
        assert_eq!(
            again, created,
            "an existing install id must win over a fresh candidate"
        );
    }

    #[test]
    fn the_table_cannot_hold_a_second_row() {
        let conn = migrated_db();
        ensure(&conn, INSTALL, FINGERPRINT).expect("ensure");

        let error = conn
            .execute(
                "INSERT INTO sync_state (id, install_id, machine_fingerprint) VALUES (2, ?1, ?2)",
                rusqlite::params![INSTALL, FINGERPRINT],
            )
            .expect_err("a second row must be refused");

        assert!(
            error.to_string().contains("sync_state_single_row"),
            "expected the single-row constraint to fire, got {error}"
        );
    }

    #[test]
    fn the_schema_refuses_every_malformed_state() {
        // Each case names the constraint that must reject it, so the test asserts which
        // invariant fired rather than only that *some* refusal happened.
        let refused: [(&str, &str); 6] = [
            (
                "sync_state_install_id_is_8_bytes_hex",
                "INSERT INTO sync_state (id, install_id, machine_fingerprint) \
                 VALUES (1, 'abc', 'ab00000000000000000000000000000000000000000000000000000000000000')",
            ),
            (
                "sync_state_fingerprint_is_sha256_hex",
                "INSERT INTO sync_state (id, install_id, machine_fingerprint) \
                 VALUES (1, '0123456789abcdef', 'short')",
            ),
            (
                "sync_state_pin_is_whole_or_absent",
                "INSERT INTO sync_state (id, install_id, machine_fingerprint, identity_id) \
                 VALUES (1, '0123456789abcdef', \
                 'ab00000000000000000000000000000000000000000000000000000000000000', 'us-east-1:x')",
            ),
            (
                "sync_state_link_state_is_known",
                "INSERT INTO sync_state (id, install_id, machine_fingerprint, link_state) \
                 VALUES (1, '0123456789abcdef', \
                 'ab00000000000000000000000000000000000000000000000000000000000000', 'linking')",
            ),
            (
                "sync_state_linked_requires_a_pin",
                "INSERT INTO sync_state (id, install_id, machine_fingerprint, link_state) \
                 VALUES (1, '0123456789abcdef', \
                 'ab00000000000000000000000000000000000000000000000000000000000000', 'linked')",
            ),
            (
                "sync_state_frozen_reason_is_known",
                "INSERT INTO sync_state (id, install_id, machine_fingerprint, frozen_reason) \
                 VALUES (1, '0123456789abcdef', \
                 'ab00000000000000000000000000000000000000000000000000000000000000', 'because')",
            ),
        ];

        for (constraint, sql) in refused {
            let conn = migrated_db();
            let error = conn
                .execute(sql, [])
                .expect_err(&format!("{constraint} must reject this row"));
            assert!(
                error.to_string().contains(constraint),
                "expected {constraint} to fire, got {error}"
            );
        }
    }

    #[test]
    fn setting_the_pin_links_the_dataset() {
        let conn = migrated_db();
        ensure(&conn, INSTALL, FINGERPRINT).expect("ensure");

        set_pin(&conn, "us-east-1:abc", "sub-1").expect("set pin");

        let state = load(&conn).expect("load").expect("row exists");
        assert_eq!(state.identity_id.as_deref(), Some("us-east-1:abc"));
        assert_eq!(state.owner_sub.as_deref(), Some("sub-1"));
        assert_eq!(state.link_state, LinkState::Linked);
    }

    #[test]
    fn freezing_and_resuming_change_nothing_but_the_reason() {
        let conn = migrated_db();
        ensure(&conn, INSTALL, FINGERPRINT).expect("ensure");
        set_pin(&conn, "us-east-1:abc", "sub-1").expect("set pin");
        let linked = load(&conn).expect("load").expect("row exists");

        set_frozen_reason(&conn, Some(FrozenReason::EntitlementLapsed)).expect("freeze");
        let frozen = load(&conn).expect("load").expect("row exists");
        assert_eq!(frozen.frozen_reason, Some(FrozenReason::EntitlementLapsed));
        assert_eq!(frozen.link_state, LinkState::Linked);
        assert_eq!(frozen.install_id, linked.install_id);

        set_frozen_reason(&conn, None).expect("resume");
        assert_eq!(
            load(&conn).expect("load").expect("row exists"),
            linked,
            "leaving Frozen must restore exactly the previous state"
        );
    }

    #[test]
    fn relinking_mints_a_new_install_and_unlinks_while_keeping_the_account() {
        let conn = migrated_db();
        ensure(&conn, INSTALL, FINGERPRINT).expect("ensure");
        set_pin(&conn, "us-east-1:abc", "sub-1").expect("set pin");

        let other = "cd00000000000000000000000000000000000000000000000000000000000000";
        relink_install(&conn, "fedcba9876543210", other).expect("relink");

        let state = load(&conn).expect("load").expect("row exists");
        assert_eq!(state.install_id, "fedcba9876543210");
        assert_eq!(state.machine_fingerprint, other);
        assert_eq!(state.link_state, LinkState::Unlinked);
        assert_eq!(
            state.identity_id.as_deref(),
            Some("us-east-1:abc"),
            "a copy is the same account on a new machine; the pin must survive"
        );
        assert_eq!(state.owner_sub.as_deref(), Some("sub-1"));
    }

    #[test]
    fn a_mutation_against_a_wiped_row_is_an_error_not_a_silent_no_op() {
        let conn = migrated_db();
        ensure(&conn, INSTALL, FINGERPRINT).expect("ensure");
        conn.execute("DELETE FROM sync_state", [])
            .expect("wipe the row");

        for error in [
            set_pin(&conn, "us-east-1:abc", "sub-1").expect_err("set_pin must fail"),
            set_frozen_reason(&conn, Some(FrozenReason::Support)).expect_err("freeze must fail"),
            relink_install(&conn, INSTALL, FINGERPRINT).expect_err("relink must fail"),
        ] {
            assert!(matches!(error, AppError::Database { .. }));
        }
    }

    #[test]
    fn an_unreadable_stored_value_is_an_error_rather_than_a_panic() {
        let conn = migrated_db();
        ensure(&conn, INSTALL, FINGERPRINT).expect("ensure");
        // The CHECK constraints make this unreachable through the app; a hand-edited or
        // downgraded file is the case this guards, simulated by suspending the checks.
        conn.execute_batch(
            "PRAGMA ignore_check_constraints=ON;
             UPDATE sync_state SET link_state = 'linking';
             PRAGMA ignore_check_constraints=OFF;",
        )
        .expect("store an unknown value");

        let error = load(&conn).expect_err("load must refuse");
        assert!(matches!(error, AppError::Database { .. }));
    }
}
