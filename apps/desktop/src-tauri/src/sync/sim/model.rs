//! What the simulator can say: the tables it exercises, the changes a replica can make and
//! the observable state the assertions compare.
//!
//! Nothing here knows how a change is merged — that is the engine's job (`engine.rs`) and the
//! oracle's (`oracle.rs`).

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

use crate::db::sim_tables::SimCell;
use crate::sync::clock::Hlc;

pub(crate) type RowUuid = [u8; 16];

/// `(cause row uuid, kind)` — AD-5's key for a balance delta, so two computers reacting to
/// the same real-world action (deleting one expense) contribute one delta, not two.
pub(crate) type CauseKey = (RowUuid, &'static str);

/// The real tables the simulator drives.
///
/// Chosen for what their columns and foreign keys are, not for how many there are: a balance
/// column (AD-5 `Balance`), a parent/child pair whose foreign key is a real
/// `ON DELETE CASCADE` (AD-12), a schema-level natural key (AD-2) and a counter column
/// (AD-5 `Counter`). The `RESTRICT` and `SET NULL` edges are deliberately out: their policy
/// is Story 14's registry and Story 21's tombstone work, and simulating a policy that does
/// not exist yet would freeze a guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Table {
    Accounts,
    IncomeSources,
    IncomeEntries,
    MerchantHints,
}

impl Table {
    pub(crate) const ALL: [Table; 4] = [
        Table::Accounts,
        Table::IncomeSources,
        Table::IncomeEntries,
        Table::MerchantHints,
    ];

    /// The simulated table of this name, or `None` for one the scenario does not drive.
    ///
    /// Story 20's whole-schema dump walks the REGISTRY, so it meets table names the closed enum
    /// does not have, and the four it does have must still be dumped exactly as the oracle computes
    /// them.
    pub(crate) fn from_sql(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|table| table.sql() == name)
    }

    pub(crate) fn sql(self) -> &'static str {
        match self {
            Self::Accounts => "accounts",
            Self::IncomeSources => "income_sources",
            Self::IncomeEntries => "income_entries",
            Self::MerchantHints => "merchant_category_hints",
        }
    }

    /// The parent table and the foreign-key column that points at it.
    pub(crate) fn parent(self) -> Option<(Table, &'static str)> {
        match self {
            Self::IncomeEntries => Some((Self::IncomeSources, "source_id")),
            _ => None,
        }
    }

    /// Last-write-wins columns, all of them required by the schema, so a row cannot be
    /// materialized until every one of them is known.
    pub(crate) fn lww_columns(self) -> &'static [&'static str] {
        match self {
            Self::Accounts => &["name", "institution", "account_type"],
            Self::IncomeSources => &["name", "income_type"],
            Self::IncomeEntries => &["amount_cents", "date", "month"],
            Self::MerchantHints => &["merchant", "budget_category_id"],
        }
    }

    /// The subset a later edit may change. `merchant_category_hints` has none: its columns
    /// *are* its natural key, and a natural key that could be edited would not be one.
    pub(crate) fn editable_columns(self) -> &'static [&'static str] {
        match self {
            Self::Accounts => &["name", "institution"],
            Self::IncomeSources => &["name", "income_type"],
            Self::IncomeEntries => &["amount_cents", "date"],
            Self::MerchantHints => &[],
        }
    }

    pub(crate) fn counter_column(self) -> Option<&'static str> {
        match self {
            Self::MerchantHints => Some("usage_count"),
            _ => None,
        }
    }

    pub(crate) fn balance_column(self) -> Option<&'static str> {
        match self {
            Self::Accounts => Some("balance_cents"),
            _ => None,
        }
    }

    /// Every column the assertions compare, in a stable order.
    pub(crate) fn observable_columns(self) -> Vec<&'static str> {
        let mut columns: Vec<&'static str> = self.lww_columns().to_vec();
        columns.extend(self.parent().map(|(_, fk)| fk));
        columns.extend(self.counter_column());
        columns.extend(self.balance_column());
        columns.sort_unstable();

        columns
    }
}

/// One change, as both a local intent and the body of the message that carries it.
///
/// Deliberately the same type for both: AD-1 says a remote change takes the same path as a
/// local one, and an engine that could not express "apply my own write through the same fold"
/// would make that impossible to check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Change {
    Upsert {
        table: Table,
        row: RowUuid,
        parent: Option<RowUuid>,
        fields: Vec<(&'static str, SimCell)>,
    },
    Tombstone {
        table: Table,
        row: RowUuid,
    },
    BalanceSet {
        row: RowUuid,
        cents: i64,
    },
    BalanceDelta {
        row: RowUuid,
        cause: CauseKey,
        cents: i64,
    },
    CounterDelta {
        table: Table,
        row: RowUuid,
        delta: i64,
    },
}

impl Change {
    pub(crate) fn row(&self) -> RowUuid {
        match self {
            Self::Upsert { row, .. }
            | Self::Tombstone { row, .. }
            | Self::CounterDelta { row, .. }
            | Self::BalanceSet { row, .. }
            | Self::BalanceDelta { row, .. } => *row,
        }
    }

    pub(crate) fn describe(&self) -> String {
        let row = short(self.row());
        match self {
            Self::Upsert { table, fields, .. } => {
                let assigned = fields
                    .iter()
                    .map(|(column, cell)| format!("{column}={cell:?}"))
                    .collect::<Vec<_>>()
                    .join(",");
                format!("upsert {}#{row} {{{assigned}}}", table.sql())
            }
            Self::Tombstone { table, .. } => format!("delete {}#{row}", table.sql()),
            Self::BalanceSet { cents, .. } => format!("balance_set accounts#{row} {cents}"),
            Self::BalanceDelta { cause, cents, .. } => format!(
                "balance_delta accounts#{row} {cents} cause={}:{}",
                short(cause.0),
                cause.1
            ),
            Self::CounterDelta { table, delta, .. } => {
                format!("counter_delta {}#{row} {delta:+}", table.sql())
            }
        }
    }
}

pub(crate) fn short(row: RowUuid) -> String {
    row[..4].iter().map(|byte| format!("{byte:02x}")).collect()
}

/// `(install, seq, idx)` (AD-4). `seq` is the segment this message was buffered into and
/// `idx` its position inside it, so the identity is fixed the moment the message exists and
/// a duplicate delivery is recognizable without comparing bodies.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct MessageId {
    pub install: String,
    pub seq: u64,
    pub idx: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Message {
    pub id: MessageId,
    pub hlc: Hlc,
    pub change: Change,
}

/// A batch of one install's messages, which is what the transport moves around. The real
/// thing is `header + zstd(payload)` (AD-8, Story 19); what matters to the simulator is only
/// that it is immutable, attributable to one install and in contiguous `seq` order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Segment {
    pub install: String,
    pub seq: u64,
    pub messages: Vec<Message>,
}

/// Everything two replicas are required to agree on, keyed by TABLE NAME and by row uuid rather
/// than by local integer id (AD-2).
///
/// Keyed by name and not by [`Table`] since Story 20: the real engine writes through the real apply
/// path, which can write any table in the schema, so the dump covers every `Synced`/`AppendOnly`
/// table instead of the four the scenario drives. A table the enum does not know is then a visible
/// difference rather than an unrepresentable one.
pub(crate) type Observable =
    BTreeMap<&'static str, BTreeMap<RowUuid, BTreeMap<&'static str, SimCell>>>;

const ROW_UUID_DOMAIN: &str = "nixus/sync/sim/row/v1";
const NATURAL_KEY_DOMAIN: &str = "nixus/sync/sim/natural-key/v1";

fn digest_uuid(domain: &str, parts: &[&[u8]]) -> RowUuid {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }

    let digest = hasher.finalize();
    let mut uuid = [0u8; 16];
    uuid.copy_from_slice(&digest[..16]);

    uuid
}

/// The identity of a row every replica already had before any sync began.
///
/// Derived from the table and the integer id, which is only sound because those rows are written
/// identically on every replica and never edited. It stands in for the identities a bootstrap
/// snapshot carries in production.
pub(crate) fn base_row_uuid(table: &str, row_id: i64) -> RowUuid {
    digest_uuid(
        NATURAL_KEY_DOMAIN,
        &[b"base", table.as_bytes(), &row_id.to_be_bytes()],
    )
}

/// A fresh identity. The real one is 16 random bytes (AD-2); derived from a counter here so a
/// seed replays byte for byte.
pub(crate) fn fresh_row_uuid(ordinal: u64) -> RowUuid {
    digest_uuid(ROW_UUID_DOMAIN, &[&ordinal.to_be_bytes()])
}

/// The identity of a row whose schema has a natural key (AD-2): two replicas that create
/// "the same" row independently must land on one row, not two, and the only way that can be
/// true without a coordinator is for the identity to be a function of the key.
///
/// The real thing is UUIDv5 over the key expressed in the uuids of the rows it references;
/// `uuid` is not a dependency yet (Story 14 adds it), so this is the same construction over
/// sha256. Switching it later changes the bytes and nothing else: no assertion reads them.
pub(crate) fn natural_key_uuid(table: Table, parts: &[&[u8]]) -> RowUuid {
    let mut material: Vec<&[u8]> = vec![table.sql().as_bytes()];
    material.extend_from_slice(parts);

    digest_uuid(NATURAL_KEY_DOMAIN, &material)
}
