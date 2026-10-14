//! A deterministic synthetic "heavy year" dataset, in a temp dir, for tests that need a database of
//! realistic SIZE rather than a handful of rows (CAP-2, AD-19).
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1). WHY raw
//! SQL rather than the `db::*` write functions: those also write audit rows and adjust balances, so
//! the row counts a timing test reports would be whatever the side effects happened to add instead
//! of the numbers the test asked for.
//!
//! It never reads, copies or touches real application data: every byte is generated from a seeded
//! LCG into a `TempDir` the caller drops.

use std::path::PathBuf;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::open_configured;
use crate::projects::image::sha256_hex;

/// One year of heavy-but-plausible use. The counts are the ones CAP-2's timing budget was written
/// against, so they are fields rather than literals: a test asserts against what it asked for.
/// The counts on their own, so the generator can also fill a dataset that already exists
/// (Story 12's proof suite owns its two app-data dirs and cannot use a temp dir of ours).
#[derive(Debug, Clone, Copy)]
pub(crate) struct HeavyYearShape {
    pub expenses: usize,
    pub audit_rows: usize,
    pub chat_messages: usize,
    pub project_images: usize,
    pub image_payload_bytes: usize,
}

impl HeavyYearShape {
    pub(crate) const STANDARD: Self = Self {
        expenses: 6_000,
        audit_rows: 15_000,
        chat_messages: 5_000,
        project_images: 2,
        image_payload_bytes: 1_500_000,
    };
}

pub(crate) struct HeavyYear {
    /// Owns the directory: dropping a `HeavyYear` is what deletes the dataset, so this field is a
    /// lifetime guard rather than something a test reads.
    #[allow(dead_code)]
    pub dir: TempDir,
    pub db_path: PathBuf,
    pub expenses: usize,
    pub audit_rows: usize,
    pub chat_messages: usize,
    pub project_images: usize,
    pub image_payload_bytes: usize,
}

/// Reproducible across platforms and carrying no fixture files, which is the only way two machines
/// can compare a measured snapshot size at all.
struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 11
    }

    fn below(&mut self, limit: u64) -> u64 {
        self.next() % limit
    }

    fn pick<'a, T>(&mut self, options: &'a [T]) -> &'a T {
        &options[self.below(options.len() as u64) as usize]
    }

    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| (self.next() >> 22) as u8).collect()
    }

    /// Filler of a given length built from real words, so the text compresses the way a user's
    /// notes and AI answers do instead of like random noise.
    fn prose(&mut self, len: usize) -> String {
        const WORDS: &[&str] = &[
            "budget", "category", "grocery", "transfer", "balance", "monthly", "projection",
            "account", "statement", "recurring", "adjusted", "reviewed", "savings", "vehicle",
            "maintenance", "contribution", "forecast", "remaining", "allocated", "reconciled",
        ];

        let mut text = String::with_capacity(len + 12);
        while text.len() < len {
            let word: &&str = self.pick(WORDS);
            text.push_str(word);
            text.push(' ');
        }
        text.truncate(len);
        text
    }
}

const GROUPS: &[&str] = &["Living", "Lifestyle", "Obligations"];
const CATEGORIES: &[&str] = &[
    "Groceries",
    "Restaurants",
    "Fuel",
    "Transit",
    "Rent",
    "Utilities",
    "Insurance",
    "Subscriptions",
    "Health",
    "Clothing",
    "Gifts",
    "Home",
];
const MERCHANTS: &[&str] = &[
    "Metro",
    "Costco",
    "Petro-Canada",
    "Amazon",
    "Hydro-Quebec",
    "Bell",
    "Pharmaprix",
    "IGA",
    "Uber",
    "Netflix",
];

/// A date `day` days after 2026-01-01, as the ISO 8601 day string the schema stores.
fn spread_date(day: u64) -> String {
    let start = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).expect("2026-01-01 is a date");

    (start + chrono::Days::new(day)).format("%Y-%m-%d").to_string()
}

/// Builds the dataset and returns the temp dir that owns it.
///
/// The database is created by `open_configured`, so it is migrated exactly the way the app migrates
/// one and carries the real schema with all its CHECKs — a fixture that bypassed them could hold
/// rows production can never produce.
pub(crate) fn heavy_year_dataset() -> HeavyYear {
    let dir = tempfile::tempdir().expect("a temp dir for the synthetic dataset");
    let db_path = dir.path().join("nixus.db");
    let conn = open_configured(&db_path).expect("the synthetic dataset migrates");

    let shape = HeavyYearShape::STANDARD;
    let heavy = HeavyYear {
        dir,
        db_path,
        expenses: shape.expenses,
        audit_rows: shape.audit_rows,
        chat_messages: shape.chat_messages,
        project_images: shape.project_images,
        image_payload_bytes: shape.image_payload_bytes,
    };

    seed(&conn, &shape);
    // A linked install, so a stripping test is proving a DELETE that had something to delete.
    seed_sync_state(&conn);
    // Closed before the caller can copy or back up the file: a live connection leaves `-wal` and
    // `-shm` beside it, and on Windows an open handle is also what makes a copy or a rename fail.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .expect("the wal is checkpointed");
    drop(conn);

    heavy
}

/// The same content, seeded into a dataset that ALREADY exists at `db_path`.
///
/// No `sync_state` row: the install identity of a simulated computer belongs to that
/// computer, and a foreign pin here would read as another account owning the prefix (AD-7).
pub(crate) fn seed_heavy_year_into(db_path: &std::path::Path) -> HeavyYearShape {
    let conn = open_configured(db_path).expect("the existing dataset opens");
    let shape = HeavyYearShape::STANDARD;
    seed(&conn, &shape);
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .expect("the wal is checkpointed");
    drop(conn);

    shape
}

fn seed(conn: &Connection, heavy: &HeavyYearShape) {
    let mut rng = Lcg::new(0x5EED_0008);

    conn.execute_batch("BEGIN").expect("the seed transaction opens");
    seed_reference_rows(conn, &mut rng);
    seed_expenses(conn, &mut rng, heavy.expenses);
    seed_income(conn, &mut rng);
    seed_audit_log(conn, &mut rng, heavy.audit_rows);
    seed_chat(conn, &mut rng, heavy.chat_messages);
    seed_projects(conn, &mut rng, heavy);
    seed_config(conn);
    conn.execute_batch("COMMIT").expect("the seed transaction commits");
}

fn seed_reference_rows(conn: &Connection, rng: &mut Lcg) {
    for (index, group) in GROUPS.iter().enumerate() {
        conn.execute(
            "INSERT INTO budget_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
            rusqlite::params![index as i64 + 1, group, index as i64],
        )
        .expect("a budget group inserts");
    }

    for (index, category) in CATEGORIES.iter().enumerate() {
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                index as i64 + 1,
                (index % GROUPS.len()) as i64 + 1,
                category,
                20_000 + rng.below(180_000) as i64,
                index as i64
            ],
        )
        .expect("a budget category inserts");
    }

    for (index, (name, kind)) in [
        ("Chequing", "chequing"),
        ("Visa", "credit_card"),
        ("TFSA", "investment"),
    ]
    .iter()
    .enumerate()
    {
        conn.execute(
            "INSERT INTO accounts (id, name, institution, account_type, balance_cents)
             VALUES (?1, ?2, 'Bank', ?3, ?4)",
            rusqlite::params![
                index as i64 + 1,
                name,
                kind,
                rng.below(2_000_000) as i64 - 500_000
            ],
        )
        .expect("an account inserts");
    }
}

fn seed_expenses(conn: &Connection, rng: &mut Lcg, count: usize) {
    let mut insert = conn
        .prepare(
            "INSERT INTO expenses
                (merchant, amount_cents, budget_category_id, date, source, account_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .expect("the expense statement prepares");

    for index in 0..count {
        let date = spread_date(rng.below(365));
        insert
            .execute(rusqlite::params![
                rng.pick(MERCHANTS),
                // Money is i64 cents everywhere, and the schema's CHECK requires it positive.
                199 + rng.below(40_000) as i64,
                rng.below(CATEGORIES.len() as u64) as i64 + 1,
                date,
                if index % 3 == 0 { "statement" } else { "manual" },
                rng.below(3) as i64 + 1,
                format!("{date} 12:00:00"),
            ])
            .expect("an expense inserts");
    }
}

fn seed_income(conn: &Connection, rng: &mut Lcg) {
    conn.execute(
        "INSERT INTO income_sources (id, name, income_type) VALUES (1, 'Employer', 'employment')",
        [],
    )
    .expect("an income source inserts");

    for month in 0..12u64 {
        let date = spread_date(month * 30 + 1);
        conn.execute(
            "INSERT INTO income_entries (source_id, amount_cents, date, month, account_id)
             VALUES (1, ?1, ?2, ?3, 1)",
            rusqlite::params![
                400_000 + rng.below(50_000) as i64,
                date,
                &date[..7]
            ],
        )
        .expect("an income entry inserts");
    }
}

fn seed_audit_log(conn: &Connection, rng: &mut Lcg, count: usize) {
    const ENTITIES: &[&str] = &["expense", "account", "budget_category", "project", "vehicle"];
    const ACTIONS: &[&str] = &["create", "update", "delete"];

    let mut insert = conn
        .prepare(
            "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .expect("the audit statement prepares");

    for index in 0..count {
        let day = (index as u64 * 365) / count.max(1) as u64;
        insert
            .execute(rusqlite::params![
                rng.pick(ENTITIES),
                rng.below(6_000) as i64 + 1,
                rng.pick(ACTIONS),
                format!("{{\"note\":\"{}\"}}", rng.prose(170)),
                format!("{{\"note\":\"{}\"}}", rng.prose(170)),
                format!("{} 09:{:02}:00", spread_date(day), index % 60),
            ])
            .expect("an audit row inserts");
    }
}

fn seed_chat(conn: &Connection, rng: &mut Lcg, count: usize) {
    const CONVERSATIONS: i64 = 40;

    for id in 1..=CONVERSATIONS {
        conn.execute(
            "INSERT INTO chat_conversations (id, title) VALUES (?1, ?2)",
            rusqlite::params![id, rng.prose(30)],
        )
        .expect("a conversation inserts");
    }

    let mut insert = conn
        .prepare(
            "INSERT INTO chat_messages (conversation_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .expect("the chat statement prepares");

    for index in 0..count {
        insert
            .execute(rusqlite::params![
                (index as i64 % CONVERSATIONS) + 1,
                if index % 2 == 0 { "user" } else { "assistant" },
                rng.prose(if index % 2 == 0 { 120 } else { 900 }),
                format!("{} 20:00:00", spread_date((index as u64 * 365) / count.max(1) as u64)),
            ])
            .expect("a chat message inserts");
    }
}

fn seed_projects(conn: &Connection, rng: &mut Lcg, heavy: &HeavyYearShape) {
    for id in 1..=heavy.project_images as i64 {
        conn.execute(
            "INSERT INTO projects (id, name, target_cents, target_date, priority)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                id,
                format!("Project {id}"),
                1_000_000 * id,
                spread_date(300 + id as u64),
                id
            ],
        )
        .expect("a project inserts");

        conn.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, 1, ?2, 'manual', ?3)",
            rusqlite::params![id, 50_000 * id, spread_date(100 + id as u64)],
        )
        .expect("a contribution inserts");

        let payload = rng.bytes(heavy.image_payload_bytes);
        conn.execute(
            "INSERT INTO project_images
                (project_id, image_bytes, mime_type, original_filename, byte_size,
                 thumbnail_bytes, thumbnail_mime, image_sha256)
             VALUES (?1, ?2, 'image/jpeg', ?3, ?4, ?5, 'image/png', ?6)",
            rusqlite::params![
                id,
                &payload,
                format!("cover-{id}.jpg"),
                payload.len() as i64,
                rng.bytes(4_096),
                sha256_hex(&payload),
            ],
        )
        .expect("a project image inserts");
    }
}

/// The three keys AD-5's deny list names, plus one ordinary key, so a stripping test can prove it
/// removes exactly the credential-state keys and nothing else.
fn seed_config(conn: &Connection) {
    for (key, value) in [
        ("ai_configured", "true"),
        ("ai_provider", "bedrock"),
        ("aws_region", "us-east-1"),
        ("onboarding_complete", "true"),
    ] {
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .expect("a config key inserts");
    }
}

/// Every value a sentinel stamp wrote starts with this, so one substring search over the
/// bytes of an export answers "did any user text get out?" for all of them at once.
pub(crate) const SENTINEL_PREFIX: &str = "SENTINEL";

pub(crate) struct SentinelStamp {
    /// `table.column` for every text column that now holds a sentinel.
    pub stamped: Vec<String>,
    /// `table.column: reason` for the ones SQLite refused (an enum, a date or a hash under
    /// a CHECK). Recorded rather than ignored: a column that cannot hold a sentinel is a
    /// column that cannot hold user prose either, which is why its absence is not a gap.
    pub refused: Vec<String>,
}

/// Overwrites EVERY text column of every user table with a recognizable sentinel, plus
/// token-shaped and identity-shaped ones, so an AD-16 redaction proof searches for a single
/// string instead of enumerating the columns a future migration might add.
///
/// Discovered from the schema rather than listed, which is the whole point: a column added
/// later is stamped without anyone editing this function.
pub(crate) fn stamp_text_columns_with_sentinels(conn: &Connection) -> SentinelStamp {
    let mut stamp = SentinelStamp {
        stamped: Vec::new(),
        refused: Vec::new(),
    };

    for table in user_tables(conn) {
        for column in text_columns(conn, &table) {
            let label = format!("{table}.{column}");
            // The rowid suffix keeps the values distinct, so a UNIQUE index is not what
            // decides whether a column can be stamped.
            let sql = format!(
                "UPDATE \"{table}\" SET \"{column}\" = '{SENTINEL_PREFIX}-{table}-{column}-' \
                 || CAST(_rowid_ AS TEXT)"
            );
            match conn.execute(&sql, []) {
                Ok(_) => stamp.stamped.push(label),
                Err(error) => stamp.refused.push(format!("{label}: {error}")),
            }
        }
    }

    for (key, value) in [
        ("sentinel_jwt", format!("{SENTINEL_PREFIX}-eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.c2ln")),
        ("sentinel_access_key", format!("{SENTINEL_PREFIX}-AKIAIOSFODNN7EXAMPLE")),
        (
            "sentinel_identity_id",
            format!("{SENTINEL_PREFIX}-us-east-1:11111111-2222-4333-8444-555555555555"),
        ),
        ("sentinel_install_id", format!("{SENTINEL_PREFIX}-0a1b2c3d4e5f6071")),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .expect("a sentinel config key inserts");
        stamp.stamped.push(format!("config.{key}"));
    }

    stamp
}

fn user_tables(conn: &Connection) -> Vec<String> {
    let mut statement = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table'
               AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
               AND name NOT LIKE 'sync\\_%' ESCAPE '\\'
               AND name <> 'schema_version'
             ORDER BY name",
        )
        .expect("the table list prepares");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("the table list reads")
        .collect::<Result<_, _>>()
        .expect("the table list collects")
}

fn text_columns(conn: &Connection, table: &str) -> Vec<String> {
    let mut statement = conn
        .prepare("SELECT name, type FROM pragma_table_info(?1)")
        .expect("the column list prepares");
    statement
        .query_map([table], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .expect("the column list reads")
        .filter_map(Result::ok)
        .filter(|(_, declared)| {
            let declared = declared.to_uppercase();
            declared.contains("TEXT") || declared.contains("CHAR") || declared.contains("CLOB")
        })
        .map(|(name, _)| name)
        .collect()
}

fn seed_sync_state(conn: &Connection) {
    crate::db::sync_state::ensure(conn, "0a1b2c3d4e5f6071", &"a".repeat(64))
        .expect("the sync state row inserts");
    crate::db::sync_state::set_pin(conn, "us-east-1:0000", "sub-0").expect("the pin writes");
}

/// One row in each of Story 14's seven sync tables, so a test about the snapshot round trip is
/// proving a DELETE that had something to delete and a carry-over that had something to carry.
///
/// Returns how many rows it wrote, so the caller asserts against what it asked for rather than
/// against a literal that drifts the next time a table is added.
pub(crate) fn seed_sync_bookkeeping(conn: &Connection) -> usize {
    const HLC: &str = "0000000000000001-0a1b2c3d4e5f6071";
    const INSTALL: &str = "0a1b2c3d4e5f6071";
    const REMOTE: &str = "fedcba9876543210";

    /// The packed per-column map migration 033 stores: `count = 1`, then `name_len = 4`, `"name"`,
    /// the 33-character HLC and 32 hash bytes. Built as bytes here so the fixture does not depend
    /// on `db::sync_capture`'s encoder being correct to prove a restore carried the row.
    fn packed_name_entry(hlc: &str) -> Vec<u8> {
        let mut packed = vec![0x00, 0x01, 0x04];
        packed.extend_from_slice(b"name");
        packed.extend_from_slice(hlc.as_bytes());
        packed.extend_from_slice(&[0xbb; 32]);
        packed
    }
    let row: [u8; 16] = [0x11; 16];
    let parent: [u8; 16] = [0x22; 16];

    let statements: [(&str, Vec<rusqlite::types::Value>); 7] = [
        (
            "INSERT INTO sync_uuid (table_name, row_id, uuid) VALUES ('accounts', 1, ?1)",
            vec![row.to_vec().into()],
        ),
        (
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name)
             VALUES (?1, ?2, 'field', 'accounts', ?3, 'name')",
            vec![INSTALL.to_string().into(), HLC.to_string().into(), row.to_vec().into()],
        ),
        (
            // The packed per-column map migration 033 stores: one entry for `name`, built here as
            // bytes so the fixture does not depend on `db::sync_capture`'s encoder to be correct.
            "INSERT INTO sync_field_state (table_name, row_uuid, columns) VALUES ('accounts', ?1, ?2)",
            vec![row.to_vec().into(), packed_name_entry(HLC).into()],
        ),
        (
            "INSERT INTO sync_applied_vector (install, seq, applied_offset) VALUES (?1, 7, 0)",
            vec![REMOTE.to_string().into()],
        ),
        (
            "INSERT INTO sync_tombstone
                (table_name, row_uuid, hlc, install, row_json, deleted_at, purge_after)
             VALUES ('expenses', ?1, ?2, ?3, '{\"id\":1}',
                     '2026-10-01 00:00:00', '2026-10-31 00:00:00')",
            vec![row.to_vec().into(), HLC.to_string().into(), INSTALL.to_string().into()],
        ),
        (
            "INSERT INTO sync_pending
                (install, seq, idx, hlc, kind, table_name, row_uuid,
                 waiting_on_table, waiting_on_uuid)
             VALUES (?1, 7, 0, ?2, 'field', 'income_entries', ?3, 'income_sources', ?4)",
            vec![
                REMOTE.to_string().into(),
                HLC.to_string().into(),
                row.to_vec().into(),
                parent.to_vec().into(),
            ],
        ),
        (
            "INSERT INTO sync_quarantine
                (install, seq, idx, hlc, kind, table_name, row_uuid, reason)
             VALUES (?1, 8, 0, ?2, 'tombstone', 'accounts', ?3, 'constraint_violation')",
            vec![REMOTE.to_string().into(), HLC.to_string().into(), row.to_vec().into()],
        ),
    ];

    for (sql, values) in &statements {
        conn.execute(sql, rusqlite::params_from_iter(values.iter()))
            .unwrap_or_else(|error| panic!("a sync bookkeeping row inserts: {error}\n{sql}"));
    }

    statements.len()
}

/// A migrated, otherwise-empty dataset at `db_path`, for tests about the sync *protocol*
/// rather than about size. `heavy_year_dataset` costs ~700 ms to snapshot; this costs
/// milliseconds, which is what makes a dozen settle/conflict tests affordable.
pub(crate) fn migrated_dataset(db_path: &std::path::Path) -> Connection {
    open_configured(db_path).expect("a fresh dataset migrates")
}

/// Inserts recognisable `budget_groups` rows.
///
/// Two jobs in one helper: it makes `local_data_summary` report "this computer has data"
/// (which is what raises CAP-5's choice), and the names are the sentinels an AD-16 test
/// searches the serialized diagnostics for. SQL stays in `db/` (project-context rule 1).
pub(crate) fn insert_marker_rows(conn: &Connection, names: &[&str]) {
    for name in names {
        conn.execute(
            "INSERT INTO budget_groups (name, sort_order) VALUES (?1, 0)",
            rusqlite::params![name],
        )
        .expect("a marker row inserts");
    }
}

pub(crate) fn marker_rows(conn: &Connection) -> Vec<String> {
    let mut statement = conn
        .prepare("SELECT name FROM budget_groups ORDER BY id")
        .expect("the marker query prepares");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("the marker query runs")
        .collect::<Result<Vec<_>, _>>()
        .expect("every marker row reads");

    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The generator is itself a fixture Stories 9 and 12 measure against, so its shape is pinned:
    /// the counts it claims, valid foreign keys, money as positive cents, and a size in the range
    /// CAP-2's budget was written for.
    #[test]
    fn the_heavy_year_dataset_has_the_shape_its_consumers_measure_against() {
        let heavy = heavy_year_dataset();
        let conn = Connection::open(&heavy.db_path).expect("the dataset opens");

        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .expect("the table counts")
        };
        assert_eq!(count("expenses") as usize, heavy.expenses);
        assert_eq!(count("audit_log") as usize, heavy.audit_rows);
        assert_eq!(count("chat_messages") as usize, heavy.chat_messages);
        assert_eq!(count("project_images") as usize, heavy.project_images);

        conn.execute_batch("PRAGMA foreign_keys=ON")
            .expect("foreign keys enable");
        let violations: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("the check runs");
        assert_eq!(violations, 0, "every generated row must have valid parents");

        let smallest: i64 = conn
            .query_row("SELECT MIN(amount_cents) FROM expenses", [], |row| row.get(0))
            .expect("the minimum reads");
        assert!(smallest > 0, "money is positive i64 cents");

        let distinct_dates: i64 = conn
            .query_row("SELECT COUNT(DISTINCT date) FROM expenses", [], |row| row.get(0))
            .expect("the spread reads");
        assert!(
            distinct_dates > 300,
            "a year's spread, not a single day: {distinct_dates}"
        );

        let bytes = std::fs::metadata(&heavy.db_path)
            .expect("the file is there")
            .len();
        let images = (heavy.project_images * heavy.image_payload_bytes) as u64;
        let without_images = bytes - images;
        assert!(
            (6_000_000..16_000_000).contains(&without_images),
            "about 10 MB without images, got {without_images}"
        );
    }

    /// Two runs must produce the same DATA, or a recorded snapshot size or timing means nothing.
    /// The file bytes themselves are deliberately not compared: `datetime('now')` defaults put a
    /// real wall clock into `created_at`/`applied_at`, which is what a real dataset holds too.
    #[test]
    fn the_generator_is_deterministic() {
        let digest = || {
            let heavy = heavy_year_dataset();
            let conn = Connection::open(&heavy.db_path).expect("the dataset opens");
            let mut material = String::new();

            for query in [
                "SELECT group_concat(merchant || amount_cents || budget_category_id || date, '|')
                 FROM (SELECT * FROM expenses ORDER BY id)",
                "SELECT group_concat(entity_type || entity_id || action || old_value, '|')
                 FROM (SELECT * FROM audit_log ORDER BY id)",
                "SELECT group_concat(conversation_id || role || content, '|')
                 FROM (SELECT * FROM chat_messages ORDER BY id)",
                "SELECT group_concat(image_sha256 || byte_size, '|')
                 FROM (SELECT * FROM project_images ORDER BY project_id)",
            ] {
                let part: String = conn
                    .query_row(query, [], |row| row.get(0))
                    .expect("the material reads");
                material.push_str(&part);
            }

            sha256_hex(material.as_bytes())
        };

        assert_eq!(digest(), digest());
    }
}
