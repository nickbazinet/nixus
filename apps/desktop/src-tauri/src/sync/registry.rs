//! The declarative classification of the whole schema: what each table is, how each column merges,
//! and what each foreign-key edge does when its parent is deleted (AD-5, AD-12).
//!
//! It is a TABLE OF FACTS and not logic on purpose. `sync::capture` asks it whether a change is
//! worth a message and which kind, `sync::apply` asks it how to fold a remote one, and
//! `sync::snapshot` asks it what must not travel. Every one of those three would otherwise grow its
//! own opinion, and three opinions about one column is how two computers diverge.
//!
//! The tests below introspect the LIVE migrated schema (`sqlite_master`, `pragma_table_info`,
//! `pragma_foreign_key_list`) and fail BOTH ways: on anything in the schema this file does not
//! classify, and on anything this file classifies that the schema does not have. A declared FK
//! policy is additionally compared with the schema's own `on_delete`, so the policy table cannot
//! drift away from what SQLite will actually do.

/// What a table is, in AD-5's own words.
///
/// There is deliberately no `Derived` or `Bookkeeping` variant: the real schema has no derived
/// table (savings-project totals are a `SUM` over contributions, net worth is per-date rows), and a
/// variant nothing in the schema uses would be dead code pretending to be a decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableClass {
    /// Two-way merged per column (AD-5).
    Synced,

    /// `audit_log`: rows are shared but never edited or merged, and a remote apply writes no new
    /// row of its own (AD-5).
    AppendOnly,

    /// Never leaves this computer: `schema_version`, `sqlite_sequence` and every `sync_*` table.
    LocalOnly,
}

/// Where a row's uuid comes from (AD-2). Per TABLE, except for the one case that genuinely is per
/// row: a template-generated expense or income entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowIdentity {
    /// Random (UUIDv4), minted lazily into `sync_uuid` on first sight.
    Surrogate,

    /// Always derived (UUIDv5) from the schema's natural key, expressed in referenced uuids.
    Natural,

    /// Surrogate when the user made the row by hand, derived from `(template uuid, period)` when
    /// every computer generated it on its own from a recurring template (AD-2). The table holds
    /// both kinds, so this is the one classification a call site resolves per row.
    SurrogateOrTemplate,
}

/// How a column's concurrent writes are reconciled (AD-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Story 16 is the first to ACT on Counter and Balance; the capture hook already classifies by all
// six (AD-5).
pub enum MergeKind {
    /// The default: the write with the greatest `hlc` wins, ties broken by install id.
    Lww,

    /// Only ever incremented, so the hook captures `new − old` as a signed delta and the value is
    /// the sum of deltas, de-duplicated by message id (AD-5).
    Counter,

    /// Set-plus-delta, and never captured by the generic hook: written only through the two
    /// emitters in `db/account.rs`, so two computers reacting to one real-world action produce one
    /// delta rather than two (AD-5).
    Balance,

    /// Written once when the row is created and never edited, so there is nothing to merge. A later
    /// write is a bug, not a concurrent edit, and must not silently become an Lww winner.
    Immutable,

    /// A machine-local integer: an `INTEGER PRIMARY KEY` or a foreign key into one. AD-2 keeps
    /// these out of every message — a parent is named by uuid, and the local id is looked up.
    LocalId,

    /// Present in the row but excluded from segments, snapshots and reconcile hashing (AD-10):
    /// `project_images.image_bytes` travels as its own content-addressed object.
    Excluded,
}

/// What happens to a child when its parent is deleted, per EDGE (AD-12).
///
/// The variants are the four `ON DELETE` actions the live schema actually uses, and the test below
/// compares each declared policy with the schema's own, so this is a statement about SQLite's
/// behaviour rather than a wish about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Story 20 is the first production caller: apply consults it when a parent tombstone arrives.
#[allow(dead_code)]
pub enum FkPolicy {
    /// Applying the parent tombstone lets SQLite cascade locally with the hook off; the children
    /// were captured as their own tombstones at depth >= 1, so they stay restorable (AD-12).
    Cascade,

    /// Replays as an ordinary field write to NULL — the child survives, pointing at nothing.
    SetNull,

    /// A LIVE CHILD WINS and the parent tombstone is overridden (AD-12). The only such edge is
    /// `project_contributions.account_id -> accounts`: an account a contribution still points at
    /// cannot be deleted, and the alternative would be losing the contribution.
    Restrict,

    /// `NO ACTION`: SQLite refuses the delete outright. These are the soft-delete parents
    /// (`budget_groups`, `budget_categories` carry a `deleted_at`) and `chat_conversations`, whose
    /// children are deleted explicitly first. A parent tombstone on such an edge therefore only
    /// ever arrives after its children's, and one that does not is quarantined rather than applied
    /// half-way.
    NoAction,
}

/// One table's classification.
#[derive(Debug, Clone, Copy)]
pub struct TableRule {
    pub table: &'static str,
    pub class: TableClass,
    /// `None` exactly when the class is `LocalOnly`: a table that never travels has no identity to
    /// agree on.
    pub identity: Option<RowIdentity>,
}

/// One column's merge kind. Declared only for `Synced` and `AppendOnly` tables: a `LocalOnly`
/// table's columns are never compared, hashed or shipped, so a merge kind for them would be a fact
/// about nothing.
#[derive(Debug, Clone, Copy)]
pub struct ColumnRule {
    pub table: &'static str,
    pub column: &'static str,
    pub merge: MergeKind,
}

/// One foreign-key edge's policy, keyed the way `pragma_foreign_key_list` reports it.
#[derive(Debug, Clone, Copy)]
// Story 20 is the first production caller: apply reads the parent a tombstone cascades into.
#[allow(dead_code)]
pub struct EdgeRule {
    pub child_table: &'static str,
    pub child_column: &'static str,
    pub parent_table: &'static str,
    pub policy: FkPolicy,
}

use MergeKind::{Balance, Counter, Excluded, Immutable, LocalId, Lww};
use RowIdentity::{Natural, Surrogate, SurrogateOrTemplate};
use TableClass::{AppendOnly, LocalOnly, Synced};

/// Every table of the real schema. "Everything the user can see or has done syncs" (AD-5), so the
/// list is overwhelmingly `Synced` and the exceptions are the interesting part.
pub const TABLES: &[TableRule] = &[
    rule("accounts", Synced, Some(Surrogate)),
    rule("audit_log", AppendOnly, Some(Surrogate)),
    rule("budget_categories", Synced, Some(Surrogate)),
    rule("budget_groups", Synced, Some(Surrogate)),
    rule("chat_conversations", Synced, Some(Surrogate)),
    rule("chat_messages", Synced, Some(Surrogate)),
    // Synced EXCEPT the deny list of keys describing this computer's credential state, which is a
    // per-ROW exclusion and therefore `config_key_is_local_only`, not a table class.
    rule("config", Synced, Some(Natural)),
    // A hand-entered expense is surrogate; one generated from a recurring template at startup is
    // derived from `(template uuid, period)` so two computers produce one row (AD-2).
    rule("expenses", Synced, Some(SurrogateOrTemplate)),
    rule("income_entries", Synced, Some(SurrogateOrTemplate)),
    rule("income_sources", Synced, Some(Surrogate)),
    rule("maintenance_service_logs", Synced, Some(Surrogate)),
    // `UNIQUE(vehicle_id, task_type_key)` -> UUIDv5 over `(vehicle uuid, task_type_key)`.
    rule("maintenance_tasks", Synced, Some(Natural)),
    // `UNIQUE(merchant, budget_category_id)` -> UUIDv5 over `(merchant, category uuid)`.
    rule("merchant_category_hints", Synced, Some(Natural)),
    rule("net_worth_snapshots", Synced, Some(Surrogate)),
    rule("passive_assets", Synced, Some(Surrogate)),
    rule("project_contributions", Synced, Some(Surrogate)),
    // Its primary key IS `project_id`, so it takes its owning project's uuid (AD-2).
    rule("project_images", Synced, Some(Natural)),
    rule("projects", Synced, Some(Surrogate)),
    rule("recurring_expense_templates", Synced, Some(Surrogate)),
    rule("recurring_income_templates", Synced, Some(Surrogate)),
    rule("vehicles", Synced, Some(Surrogate)),
    // AD-5 names the local-only set exactly: `schema_version` and every `sync_*` table. The two
    // SQLite-internal tables are here because the coverage test reads `sqlite_master` and a table
    // nobody classified is what it is designed to fail on.
    rule("schema_version", LocalOnly, None),
    rule("sqlite_sequence", LocalOnly, None),
    rule("sync_applied_vector", LocalOnly, None),
    rule("sync_field_state", LocalOnly, None),
    rule("sync_image_blobs", LocalOnly, None),
    rule("sync_log", LocalOnly, None),
    rule("sync_pending", LocalOnly, None),
    rule("sync_quarantine", LocalOnly, None),
    rule("sync_state", LocalOnly, None),
    rule("sync_tombstone", LocalOnly, None),
    rule("sync_uuid", LocalOnly, None),
];

/// Every column of every `Synced` and `AppendOnly` table.
///
/// `created_at` is `Immutable` throughout and `updated_at` is not: the first is a fact about when
/// the row came into being, the second is a value the user's own edits move and therefore merges
/// like any other.
pub const COLUMNS: &[ColumnRule] = &[
    column("accounts", "id", LocalId),
    column("accounts", "name", Lww),
    column("accounts", "institution", Lww),
    column("accounts", "account_type", Lww),
    column("accounts", "currency", Lww),
    // THE set-plus-delta column (AD-5). Never captured by the generic hook.
    column("accounts", "balance_cents", Balance),
    column("accounts", "created_at", Immutable),
    column("accounts", "updated_at", Lww),
    column("audit_log", "id", LocalId),
    column("audit_log", "entity_type", Immutable),
    // An audit row's `entity_id` is a machine-local integer and is NOT an FK — one column points at
    // eleven tables, and the audit row outlives the row it describes — so nothing can resolve it
    // into a parent uuid. It travels as a local id, i.e. not at all, and `entity_uuid` below is the
    // same fact expressed in uuid space (migration 034, AD-5).
    column("audit_log", "entity_id", LocalId),
    // The `sync_uuid` of the affected row, read when the audit row is written and never changed
    // afterwards. NULL when the action has no single entity (`import`, `budget_template`, the AI
    // chat actions) or when the entity predates capture.
    column("audit_log", "entity_uuid", Immutable),
    column("audit_log", "action", Immutable),
    column("audit_log", "old_value", Immutable),
    column("audit_log", "new_value", Immutable),
    column("audit_log", "created_at", Immutable),
    column("budget_categories", "id", LocalId),
    column("budget_categories", "group_id", LocalId),
    column("budget_categories", "name", Lww),
    column("budget_categories", "target_cents", Lww),
    column("budget_categories", "sort_order", Lww),
    column("budget_categories", "created_at", Immutable),
    // The soft delete is an ordinary nullable field, which is why it merges rather than tombstones:
    // a user can un-delete a category, and a tombstone cannot be taken back.
    column("budget_categories", "deleted_at", Lww),
    column("budget_groups", "id", LocalId),
    column("budget_groups", "name", Lww),
    column("budget_groups", "sort_order", Lww),
    column("budget_groups", "created_at", Immutable),
    column("budget_groups", "deleted_at", Lww),
    column("chat_conversations", "id", LocalId),
    column("chat_conversations", "title", Lww),
    column("chat_conversations", "created_at", Immutable),
    column("chat_conversations", "updated_at", Lww),
    column("chat_conversations", "agent_id", Immutable),
    column("chat_messages", "id", LocalId),
    column("chat_messages", "conversation_id", LocalId),
    // A message that has been sent is not edited; it is deleted with its conversation.
    column("chat_messages", "role", Immutable),
    column("chat_messages", "content", Immutable),
    column("chat_messages", "created_at", Immutable),
    column("chat_messages", "message_type", Immutable),
    column("config", "key", Immutable),
    column("config", "value", Lww),
    column("expenses", "id", LocalId),
    column("expenses", "merchant", Lww),
    column("expenses", "amount_cents", Lww),
    column("expenses", "budget_category_id", LocalId),
    column("expenses", "date", Lww),
    column("expenses", "source", Immutable),
    column("expenses", "created_at", Immutable),
    column("expenses", "account_id", LocalId),
    column("income_entries", "id", LocalId),
    column("income_entries", "source_id", LocalId),
    column("income_entries", "amount_cents", Lww),
    column("income_entries", "date", Lww),
    column("income_entries", "month", Lww),
    column("income_entries", "created_at", Immutable),
    column("income_entries", "updated_at", Lww),
    column("income_entries", "account_id", LocalId),
    column("income_entries", "recurring_income_template_id", LocalId),
    column("income_sources", "id", LocalId),
    column("income_sources", "name", Lww),
    column("income_sources", "income_type", Lww),
    column("income_sources", "created_at", Immutable),
    column("income_sources", "updated_at", Lww),
    column("maintenance_service_logs", "id", LocalId),
    column("maintenance_service_logs", "vehicle_id", LocalId),
    column("maintenance_service_logs", "task_id", LocalId),
    column("maintenance_service_logs", "custom_service_name", Lww),
    column("maintenance_service_logs", "service_date", Lww),
    column("maintenance_service_logs", "odometer_km", Lww),
    column("maintenance_service_logs", "notes", Lww),
    column("maintenance_service_logs", "created_at", Immutable),
    column("maintenance_tasks", "id", LocalId),
    // Both halves of the natural key: a key that could be edited would not be one.
    column("maintenance_tasks", "vehicle_id", LocalId),
    column("maintenance_tasks", "task_type_key", Immutable),
    column("maintenance_tasks", "interval_km", Lww),
    column("maintenance_tasks", "interval_months", Lww),
    column("maintenance_tasks", "last_service_date", Lww),
    column("maintenance_tasks", "last_service_odometer_km", Lww),
    column("maintenance_tasks", "created_at", Immutable),
    column("maintenance_tasks", "updated_at", Lww),
    column("maintenance_tasks", "custom_task_name", Lww),
    column("merchant_category_hints", "id", LocalId),
    column("merchant_category_hints", "merchant", Immutable),
    column("merchant_category_hints", "budget_category_id", LocalId),
    column("merchant_category_hints", "confidence_score", Lww),
    // THE counter column (AD-5): only ever incremented, captured as a signed delta.
    column("merchant_category_hints", "usage_count", Counter),
    column("merchant_category_hints", "last_updated", Lww),
    column("merchant_category_hints", "created_at", Immutable),
    column("net_worth_snapshots", "id", LocalId),
    column("net_worth_snapshots", "total_cents", Lww),
    column("net_worth_snapshots", "snapshot_date", Lww),
    // The residual risk the architecture's Deferred section names: last-write-wins as a whole
    // document. Classified rather than special-cased, so the risk is visible here.
    column("net_worth_snapshots", "breakdown_json", Lww),
    column("net_worth_snapshots", "created_at", Immutable),
    column("passive_assets", "id", LocalId),
    column("passive_assets", "name", Lww),
    column("passive_assets", "asset_type", Lww),
    column("passive_assets", "value_cents", Lww),
    column("passive_assets", "created_at", Immutable),
    column("passive_assets", "updated_at", Lww),
    column("project_contributions", "id", LocalId),
    column("project_contributions", "project_id", LocalId),
    column("project_contributions", "account_id", LocalId),
    column("project_contributions", "amount_cents", Lww),
    column("project_contributions", "source", Immutable),
    column("project_contributions", "date", Lww),
    column("project_contributions", "created_at", Immutable),
    column("project_images", "project_id", LocalId),
    // AD-10: the bytes are `blob/<sha256>` and are excluded from every segment, snapshot and
    // reconcile hash. `image_sha256` below is what travels in their place.
    column("project_images", "image_bytes", Excluded),
    column("project_images", "mime_type", Lww),
    column("project_images", "original_filename", Lww),
    column("project_images", "byte_size", Lww),
    column("project_images", "uploaded_at", Lww),
    column("project_images", "thumbnail_bytes", Lww),
    column("project_images", "thumbnail_mime", Lww),
    column("project_images", "image_sha256", Lww),
    column("projects", "id", LocalId),
    column("projects", "name", Lww),
    column("projects", "target_cents", Lww),
    column("projects", "target_date", Lww),
    column("projects", "priority", Lww),
    column("projects", "icon", Lww),
    column("projects", "color", Lww),
    column("projects", "archived_at", Lww),
    column("projects", "created_at", Immutable),
    column("projects", "updated_at", Lww),
    column("recurring_expense_templates", "id", LocalId),
    column("recurring_expense_templates", "merchant", Lww),
    column("recurring_expense_templates", "amount_cents", Lww),
    column("recurring_expense_templates", "budget_category_id", LocalId),
    column("recurring_expense_templates", "day_of_month", Lww),
    column("recurring_expense_templates", "is_active", Lww),
    column("recurring_expense_templates", "created_at", Immutable),
    column("recurring_expense_templates", "updated_at", Lww),
    column("recurring_income_templates", "id", LocalId),
    column("recurring_income_templates", "source_id", LocalId),
    column("recurring_income_templates", "amount_cents", Lww),
    column("recurring_income_templates", "day_of_month", Lww),
    column("recurring_income_templates", "account_id", LocalId),
    column("recurring_income_templates", "is_active", Lww),
    column("recurring_income_templates", "created_at", Immutable),
    column("recurring_income_templates", "updated_at", Lww),
    column("vehicles", "id", LocalId),
    column("vehicles", "nickname", Lww),
    column("vehicles", "make", Lww),
    column("vehicles", "model", Lww),
    column("vehicles", "year", Lww),
    // A plain value, not a counter: service logs only ever raise it, but a direct set is the user's
    // latest action, so last-write-wins is the correct answer (architecture, Deferred).
    column("vehicles", "odometer_km", Lww),
    column("vehicles", "created_at", Immutable),
    column("vehicles", "updated_at", Lww),
];

/// Every foreign-key edge of the real schema, with AD-12's policy for it.
pub const EDGES: &[EdgeRule] = &[
    edge("budget_categories", "group_id", "budget_groups", FkPolicy::NoAction),
    edge("chat_messages", "conversation_id", "chat_conversations", FkPolicy::NoAction),
    edge("expenses", "account_id", "accounts", FkPolicy::SetNull),
    edge("expenses", "budget_category_id", "budget_categories", FkPolicy::NoAction),
    edge("income_entries", "account_id", "accounts", FkPolicy::SetNull),
    edge("income_entries", "source_id", "income_sources", FkPolicy::Cascade),
    edge(
        "income_entries",
        "recurring_income_template_id",
        "recurring_income_templates",
        FkPolicy::SetNull,
    ),
    edge("maintenance_service_logs", "task_id", "maintenance_tasks", FkPolicy::Cascade),
    edge("maintenance_service_logs", "vehicle_id", "vehicles", FkPolicy::Cascade),
    edge("maintenance_tasks", "vehicle_id", "vehicles", FkPolicy::Cascade),
    edge(
        "merchant_category_hints",
        "budget_category_id",
        "budget_categories",
        FkPolicy::NoAction,
    ),
    // THE one restricted edge (AD-12): a live contribution beats an account tombstone.
    edge("project_contributions", "account_id", "accounts", FkPolicy::Restrict),
    edge("project_contributions", "project_id", "projects", FkPolicy::Cascade),
    edge("project_images", "project_id", "projects", FkPolicy::Cascade),
    edge(
        "recurring_expense_templates",
        "budget_category_id",
        "budget_categories",
        FkPolicy::NoAction,
    ),
    edge("recurring_income_templates", "account_id", "accounts", FkPolicy::SetNull),
    edge("recurring_income_templates", "source_id", "income_sources", FkPolicy::Cascade),
];

const fn rule(
    table: &'static str,
    class: TableClass,
    identity: Option<RowIdentity>,
) -> TableRule {
    TableRule {
        table,
        class,
        identity,
    }
}

const fn column(table: &'static str, column: &'static str, merge: MergeKind) -> ColumnRule {
    ColumnRule {
        table,
        column,
        merge,
    }
}

const fn edge(
    child_table: &'static str,
    child_column: &'static str,
    parent_table: &'static str,
    policy: FkPolicy,
) -> EdgeRule {
    EdgeRule {
        child_table,
        child_column,
        parent_table,
        policy,
    }
}

// Story 20 is the first production caller: apply classifies the table a remote message names.
// The capture hook walks `TABLES` once at install time instead, to resolve every shape.
#[allow(dead_code)]
pub fn table(name: &str) -> Option<&'static TableRule> {
    TABLES.iter().find(|rule| rule.table == name)
}

pub fn merge_kind(table: &str, column: &str) -> Option<MergeKind> {
    column_rule(table, column).map(|rule| rule.merge)
}

/// The declared rule for one column, whose `column` field is the `&'static str` the SQL of
/// `db::sync_apply` is built from.
///
/// Apply needs the STATIC name and not the one the message carries: every identifier reaching a
/// formatted statement has to be owned by this registry rather than by another computer.
pub fn column_rule(table: &str, column: &str) -> Option<&'static ColumnRule> {
    COLUMNS
        .iter()
        .find(|rule| rule.table == table && rule.column == column)
}

/// Every declared column of one table, which is what apply materializes a row from.
pub fn columns_of(table: &str) -> impl Iterator<Item = &'static ColumnRule> + '_ {
    COLUMNS.iter().filter(move |rule| rule.table == table)
}

/// Every edge whose parent is `parent_table`: the children a tombstone has to account for before
/// the local delete runs (AD-12).
pub fn edges_into(parent_table: &str) -> impl Iterator<Item = &'static EdgeRule> + '_ {
    EDGES
        .iter()
        .filter(move |rule| rule.parent_table == parent_table)
}

// Story 20 is the first production caller: it consults the policy when a parent tombstone arrives.
#[allow(dead_code)]
pub fn fk_policy(child_table: &str, child_column: &str) -> Option<FkPolicy> {
    find_edge(child_table, child_column).map(|rule| rule.policy)
}

/// The table a foreign-key column points at, or `None` when the column is not one.
///
/// AD-2's translation step: a `LocalId` column that is an edge travels as the PARENT'S uuid, and
/// this is the table that uuid has to be looked up in. The one `LocalId` column that is a local
/// integer WITHOUT being an edge (`audit_log.entity_id`) answers `None` and therefore does not
/// travel at all until Story 18 gives it an `entity_uuid`.
pub fn fk_parent(child_table: &str, child_column: &str) -> Option<&'static str> {
    find_edge(child_table, child_column).map(|rule| rule.parent_table)
}

fn find_edge(child_table: &str, child_column: &str) -> Option<&'static EdgeRule> {
    EDGES
        .iter()
        .find(|rule| rule.child_table == child_table && rule.child_column == child_column)
}

/// The per-ROW exception inside the `Synced` `config` table (AD-5): the three keys that describe
/// THIS computer's credential state.
///
/// It reuses `db::config::LOCAL_ONLY_KEYS` rather than restating the keys, so the registry, the
/// snapshot strip and the restore carry-over cannot disagree about which keys those are.
pub fn config_key_is_local_only(key: &str) -> bool {
    crate::db::config::LOCAL_ONLY_KEYS.contains(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_dataset::migrated_dataset;
    use rusqlite::Connection;
    use std::collections::{BTreeSet, HashMap};
    use tempfile::TempDir;

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        // `sqlite_sequence` only materializes once an AUTOINCREMENT row exists, and a table the
        // coverage test cannot see is a table it cannot hold anyone to.
        let conn = migrated_dataset(&dir.path().join("nixus.db"));
        conn.execute(
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name)
             VALUES ('0a1b2c3d4e5f6071', ?1, 'field', 'accounts', ?2, 'name')",
            rusqlite::params!["0".repeat(33), &[0u8; 16][..]],
        )
        .expect("one log row, so sqlite_sequence exists");

        (dir, conn)
    }

    fn live_tables(conn: &Connection) -> BTreeSet<String> {
        let mut statement = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .expect("the table list prepares");
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("the table list reads")
            .collect::<Result<_, _>>()
            .expect("the table list collects")
    }

    fn live_columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut statement = conn
            .prepare("SELECT name FROM pragma_table_info(?1)")
            .expect("the column list prepares");
        statement
            .query_map([table], |row| row.get::<_, String>(0))
            .expect("the column list reads")
            .collect::<Result<_, _>>()
            .expect("the column list collects")
    }

    /// `(child table, child column) -> (parent table, on_delete)` for the whole live schema.
    fn live_edges(conn: &Connection) -> HashMap<(String, String), (String, String)> {
        let mut found = HashMap::new();
        for table in live_tables(conn) {
            let mut statement = conn
                .prepare(
                    "SELECT \"from\", \"table\", on_delete FROM pragma_foreign_key_list(?1)",
                )
                .expect("the edge list prepares");
            let edges: Vec<(String, String, String)> = statement
                .query_map([&table], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .expect("the edge list reads")
                .collect::<Result<_, _>>()
                .expect("the edge list collects");

            for (from, parent, on_delete) in edges {
                found.insert((table.clone(), from), (parent, on_delete));
            }
        }

        found
    }

    #[test]
    fn every_table_in_the_live_schema_is_classified_and_nothing_stale_is_declared() {
        let (_dir, conn) = dataset();
        let live = live_tables(&conn);
        let declared: BTreeSet<String> = TABLES.iter().map(|rule| rule.table.to_string()).collect();

        assert!(live.len() > 25, "the live schema must be there, got {}", live.len());
        assert_eq!(
            live.difference(&declared).collect::<Vec<_>>(),
            Vec::<&String>::new(),
            "unclassified tables. Add them to registry::TABLES."
        );
        assert_eq!(
            declared.difference(&live).collect::<Vec<_>>(),
            Vec::<&String>::new(),
            "registry::TABLES names tables the schema does not have."
        );
        assert_eq!(declared.len(), TABLES.len(), "a table is declared twice");
    }

    /// `LocalOnly` and "has no row identity" are the same statement, and a `Synced` table missing
    /// one would be a table whose rows cannot be addressed in a message at all.
    #[test]
    fn a_row_identity_is_declared_exactly_for_the_tables_that_travel() {
        for rule in TABLES {
            match rule.class {
                LocalOnly => assert!(
                    rule.identity.is_none(),
                    "{} never travels, so it has no identity to agree on",
                    rule.table
                ),
                Synced | AppendOnly => assert!(
                    rule.identity.is_some(),
                    "{} travels and must declare where its uuid comes from",
                    rule.table
                ),
            }
        }
    }

    /// A `Natural` identity is a claim about the SCHEMA — that the row has a key two computers can
    /// both compute — so it is checked against the schema rather than taken on trust.
    #[test]
    fn every_naturally_identified_table_really_has_a_unique_key_in_the_schema() {
        let (_dir, conn) = dataset();

        let natural: Vec<&str> = TABLES
            .iter()
            .filter(|rule| matches!(rule.identity, Some(Natural)))
            .map(|rule| rule.table)
            .collect();
        assert_eq!(
            natural,
            vec![
                "config",
                "maintenance_tasks",
                "merchant_category_hints",
                "project_images"
            ]
        );

        for table in natural {
            let unique: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_index_list(?1) WHERE \"unique\" = 1",
                    [table],
                    |row| row.get(0),
                )
                .expect("the index list reads");
            let text_primary_key: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE pk > 0",
                    [table],
                    |row| row.get(0),
                )
                .expect("the pk list reads");

            assert!(
                unique > 0 || text_primary_key > 0,
                "{table} is classified Natural but has no key two computers could both compute"
            );
        }
    }

    #[test]
    fn every_column_of_every_travelling_table_has_a_merge_kind() {
        let (_dir, conn) = dataset();
        let mut checked = 0;

        for rule in TABLES {
            let declared: BTreeSet<String> = COLUMNS
                .iter()
                .filter(|column| column.table == rule.table)
                .map(|column| column.column.to_string())
                .collect();

            if matches!(rule.class, LocalOnly) {
                assert!(
                    declared.is_empty(),
                    "{} never travels; its columns must not be classified",
                    rule.table
                );
                continue;
            }

            let live: BTreeSet<String> = live_columns(&conn, rule.table).into_iter().collect();
            assert!(!live.is_empty(), "{} has no columns?", rule.table);
            assert_eq!(
                live.difference(&declared).collect::<Vec<_>>(),
                Vec::<&String>::new(),
                "unclassified columns on {}. Add them to registry::COLUMNS.",
                rule.table
            );
            assert_eq!(
                declared.difference(&live).collect::<Vec<_>>(),
                Vec::<&String>::new(),
                "registry::COLUMNS names columns {} does not have.",
                rule.table
            );
            checked += live.len();
        }

        assert_eq!(
            checked,
            COLUMNS.len(),
            "a column is declared twice, or declared for a table that is not in TABLES"
        );
    }

    #[test]
    fn every_foreign_key_edge_is_classified_and_matches_what_sqlite_will_do() {
        let (_dir, conn) = dataset();
        let live = live_edges(&conn);
        assert_eq!(live.len(), 17, "the live schema's edge count changed");

        for ((child_table, child_column), (parent_table, on_delete)) in &live {
            let declared = EDGES
                .iter()
                .find(|rule| rule.child_table == child_table && rule.child_column == child_column)
                .unwrap_or_else(|| {
                    panic!("unclassified edge {child_table}.{child_column}. Add it to registry::EDGES.")
                });

            assert_eq!(
                declared.parent_table, parent_table,
                "{child_table}.{child_column} points at {parent_table}, not at {}",
                declared.parent_table
            );

            // The non-vacuity that matters: a declared policy that disagreed with the schema would
            // make every later story reason about behaviour SQLite does not have.
            let expected = match declared.policy {
                FkPolicy::Cascade => "CASCADE",
                FkPolicy::SetNull => "SET NULL",
                FkPolicy::Restrict => "RESTRICT",
                FkPolicy::NoAction => "NO ACTION",
            };
            assert_eq!(
                on_delete, expected,
                "{child_table}.{child_column} is declared {:?} but the schema says {on_delete}",
                declared.policy
            );
        }

        for rule in EDGES {
            assert!(
                live.contains_key(&(
                    rule.child_table.to_string(),
                    rule.child_column.to_string()
                )),
                "registry::EDGES names an edge the schema does not have: {}.{}",
                rule.child_table,
                rule.child_column
            );
        }
        assert_eq!(EDGES.len(), live.len(), "an edge is declared twice");
    }

    /// AD-5's named columns, pinned individually: these three are the only non-default merge kinds
    /// in the whole schema, and getting any of them wrong is a money bug rather than a style one.
    #[test]
    fn the_columns_ad5_names_have_the_kinds_ad5_names() {
        assert_eq!(merge_kind("accounts", "balance_cents"), Some(Balance));
        assert_eq!(
            merge_kind("merchant_category_hints", "usage_count"),
            Some(Counter)
        );
        assert_eq!(merge_kind("project_images", "image_bytes"), Some(Excluded));

        let balances = COLUMNS.iter().filter(|c| matches!(c.merge, Balance)).count();
        let counters = COLUMNS.iter().filter(|c| matches!(c.merge, Counter)).count();
        let excluded = COLUMNS.iter().filter(|c| matches!(c.merge, Excluded)).count();
        assert_eq!((balances, counters, excluded), (1, 1, 1));
    }

    /// Every integer primary key and every foreign-key column is `LocalId`, because AD-2 keeps
    /// machine-local integers out of messages entirely. Derived from the live schema, so a column
    /// added by a later migration is covered without anyone remembering to.
    #[test]
    fn every_local_integer_is_classified_as_a_local_id() {
        let (_dir, conn) = dataset();
        let edges = live_edges(&conn);
        let mut scanned: BTreeSet<(String, String)> = BTreeSet::new();

        for rule in TABLES.iter().filter(|rule| !matches!(rule.class, LocalOnly)) {
            let mut statement = conn
                .prepare("SELECT name, type, pk FROM pragma_table_info(?1)")
                .expect("the column list prepares");
            let columns: Vec<(String, String, i64)> = statement
                .query_map([rule.table], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .expect("the column list reads")
                .collect::<Result<_, _>>()
                .expect("the column list collects");

            for (name, declared_type, pk) in columns {
                let is_integer_pk = pk > 0 && declared_type.eq_ignore_ascii_case("INTEGER");
                let is_foreign_key =
                    edges.contains_key(&(rule.table.to_string(), name.clone()));
                if !is_integer_pk && !is_foreign_key {
                    continue;
                }

                assert_eq!(
                    merge_kind(rule.table, &name),
                    Some(LocalId),
                    "{}.{name} is a machine-local integer and must never travel as a value",
                    rule.table
                );
                scanned.insert((rule.table.to_string(), name));
            }
        }

        assert!(
            scanned.len() > 30,
            "the scan found almost nothing, so it proves nothing: {}",
            scanned.len()
        );

        // The reverse direction, which is where a wrong classification would hide: a column
        // declared `LocalId` that the schema does not make one. There is exactly one such column,
        // and it is named here rather than allowed for by a count — `audit_log.entity_id` is a
        // machine-local integer that is deliberately NOT a foreign key, which is precisely why
        // AD-5 gives `audit_log` an `entity_uuid` column in Story 18.
        let declared_only: Vec<(String, String)> = COLUMNS
            .iter()
            .filter(|column| matches!(column.merge, LocalId))
            .map(|column| (column.table.to_string(), column.column.to_string()))
            .filter(|key| !scanned.contains(key))
            .collect();
        assert_eq!(
            declared_only,
            vec![("audit_log".to_string(), "entity_id".to_string())]
        );
    }

    #[test]
    fn the_config_deny_list_is_the_one_in_db_config() {
        assert!(config_key_is_local_only("ai_configured"));
        assert!(config_key_is_local_only("ai_provider"));
        assert!(config_key_is_local_only("aws_region"));
        assert!(!config_key_is_local_only("theme"));
        assert!(!config_key_is_local_only("onboarding_completed"));
        assert_eq!(
            crate::db::config::LOCAL_ONLY_KEYS.len(),
            3,
            "AD-5 names exactly three credential-state keys"
        );
    }

    /// AD-15's local-only set, stated as a property of the live schema rather than as a list: every
    /// `sync_*` table and `schema_version`, and nothing a user can see.
    #[test]
    fn exactly_the_sync_tables_and_schema_version_are_local_only() {
        let local_only: Vec<&str> = TABLES
            .iter()
            .filter(|rule| matches!(rule.class, LocalOnly))
            .map(|rule| rule.table)
            .collect();

        for table in &local_only {
            assert!(
                table.starts_with("sync_")
                    || *table == "schema_version"
                    || *table == "sqlite_sequence",
                "{table} is local-only but is not sync bookkeeping"
            );
        }

        let sync_tables = local_only.iter().filter(|t| t.starts_with("sync_")).count();
        assert_eq!(
            sync_tables, 9,
            "the nine sync tables: sync_state, sync_image_blobs and Story 14's seven"
        );
    }

    #[test]
    fn audit_log_is_the_only_append_only_table() {
        let append_only: Vec<&str> = TABLES
            .iter()
            .filter(|rule| matches!(rule.class, AppendOnly))
            .map(|rule| rule.table)
            .collect();

        assert_eq!(append_only, vec!["audit_log"]);
        // AD-5: the action log is shared, and nothing in it is edited after the fact.
        for rule in COLUMNS.iter().filter(|c| c.table == "audit_log") {
            assert!(
                matches!(rule.merge, Immutable | LocalId),
                "audit_log.{} must not be a mergeable field",
                rule.column
            );
        }
    }

    /// Non-vacuity for the whole file: a removed entry must be CAUGHT, not shrugged at. Proven by
    /// running the same difference the coverage tests run against a deliberately holed copy.
    #[test]
    fn removing_an_entry_is_actually_detected() {
        let (_dir, conn) = dataset();

        let holed: BTreeSet<String> = TABLES
            .iter()
            .map(|rule| rule.table.to_string())
            .filter(|table| table != "accounts")
            .collect();
        assert_eq!(
            live_tables(&conn).difference(&holed).collect::<Vec<_>>(),
            vec![&"accounts".to_string()],
            "the table coverage check must notice a missing classification"
        );

        let holed: BTreeSet<String> = COLUMNS
            .iter()
            .filter(|column| column.table == "accounts" && column.column != "balance_cents")
            .map(|column| column.column.to_string())
            .collect();
        let live: BTreeSet<String> = live_columns(&conn, "accounts").into_iter().collect();
        assert_eq!(
            live.difference(&holed).collect::<Vec<_>>(),
            vec![&"balance_cents".to_string()],
            "the column coverage check must notice a missing classification"
        );

        assert_eq!(fk_policy("project_contributions", "account_id"), Some(FkPolicy::Restrict));
        assert_eq!(fk_policy("project_contributions", "no_such_column"), None);
        assert!(table("accounts").is_some());
        assert!(table("no_such_table").is_none());
    }
}
