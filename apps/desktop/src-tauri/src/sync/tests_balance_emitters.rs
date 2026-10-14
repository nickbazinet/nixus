//! AD-5's balance and counter emitters, proven on the REAL `db/account.rs` and
//! `db/expense.rs` write paths and on real `sync_log` rows.
//!
//! # What this file is evidence of
//!
//! `sync::apply` does not exist yet (Story 20), so a message cannot be APPLIED to a second
//! computer. What can be proven today is everything the apply path will depend on:
//!
//! 1. the emitters describe the local arithmetic EXACTLY — folding an account's own messages with
//!    AD-5's rule reproduces the `balance_cents` the real code wrote, including the credit-card
//!    sign rules, so a replica never has to recompute anything;
//! 2. the fold is a FUNCTION OF THE MESSAGE SET and not of its order or multiplicity, which is
//!    what makes "identical results on every computer" true under reordering and duplication;
//! 3. a cause that two computers can reach independently (deleting one expense) is keyed so it
//!    contributes ONE delta, while a repeatable cause (editing) is not.
//!
//! # The seam Story 20 replaces
//!
//! [`fold`] is the stand-in for the apply path: it reads real `sync_log` rows and folds them with
//! [`crate::sync::sim::balance::BalanceLedger`], the same type the simulator's reference engine
//! folds with — one rule, two callers. Story 20 replaces the CALLER, not the rule: `deliver` writes
//! the folded value into `accounts.balance_cents` on a second connection instead of returning it.
//! Where a replica needs a row the other computer created, these tests bind the identity with
//! `sync_identity::ensure` — that is precisely the one thing apply does that is missing here.

use std::collections::BTreeMap;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::account::{self as account_db, BalanceCauseRow, CashFlowKind};
use crate::db::sync_capture::{self, StoredMessage};
use crate::db::{capture_fixtures as fixtures, sync_identity, test_dataset, ActiveDataset};
use crate::error::AppError;
use crate::models::{CreateAccountInput, DatasetKind};

use super::capture::{payload, BalanceCause, Capture};
use super::clock::Hlc;
use super::identity;
use super::sim::balance::BalanceLedger;

/// One computer: its own file, its own install id, its own clock, the real hook.
struct Replica {
    _dir: TempDir,
    dataset: ActiveDataset,
}

impl Replica {
    fn open() -> Self {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));
        let capture = Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .expect("capture is built")
            .expect("a cloud-linked dataset captures");
        capture.attach(&conn).expect("the hook is installed");

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("emitter-test".to_string()),
                conn: Some(conn),
                capture: Some(capture),
            },
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset.conn.as_ref().expect("a replica has a connection")
    }

    fn messages(&self) -> Vec<StoredMessage> {
        sync_capture::all_messages(self.conn()).expect("the log reads")
    }

    fn uuid_of(&self, table: &str, row_id: i64) -> [u8; 16] {
        sync_identity::lookup(self.conn(), table, row_id)
            .expect("the mapping reads")
            .unwrap_or_else(|| panic!("{table}#{row_id} has no identity"))
    }

    /// What `sync::apply` will do (Story 20): make this computer's local row the SAME logical row
    /// the other computer is talking about.
    ///
    /// The locally minted mapping is dropped first, because `sync_identity::ensure` is
    /// first-writer-wins on both keys and would otherwise hand back the identity this computer
    /// invented for itself.
    fn adopt_identity(&self, table: &str, row_id: i64, uuid: &[u8; 16]) {
        sync_identity::forget(self.conn(), table, row_id).expect("the local mapping drops");
        sync_identity::ensure(self.conn(), table, row_id, uuid).expect("the identity binds");
    }

    fn balance_of(&self, account_id: i64) -> i64 {
        self.conn()
            .query_row(
                "SELECT balance_cents FROM accounts WHERE id = ?1",
                [account_id],
                |row| row.get(0),
            )
            .expect("the balance reads")
    }

    fn usage_count_of(&self, hint_id: i64) -> i64 {
        self.conn()
            .query_row(
                "SELECT usage_count FROM merchant_category_hints WHERE id = ?1",
                [hint_id],
                |row| row.get(0),
            )
            .expect("the count reads")
    }

    fn create_account(&self, name: &str, account_type: &str) -> i64 {
        self.dataset
            .write(|tx| {
                account_db::insert_account(
                    tx,
                    &CreateAccountInput {
                        name: name.to_string(),
                        institution: "Test Bank".to_string(),
                        account_type: account_type.to_string(),
                        currency: "CAD".to_string(),
                    },
                )
            })
            .expect("the account is created")
            .id
    }

    fn set_balance(&self, account_id: i64, cents: i64) {
        self.dataset
            .write(|tx| account_db::update_account_balance(tx, account_id, cents))
            .expect("the balance is set");
    }

    fn adjust(&self, account_id: i64, kind: CashFlowKind, cents: i64, cause: BalanceCauseRow) {
        self.dataset
            .write(|tx| account_db::adjust_account_balance(tx, account_id, kind, cents, cause))
            .expect("the balance is adjusted");
    }

    fn reverse(&self, account_id: i64, kind: CashFlowKind, cents: i64, cause: BalanceCauseRow) {
        self.dataset
            .write(|tx| account_db::reverse_adjustment(tx, account_id, kind, cents, cause))
            .expect("the balance is reversed");
    }

    /// A budget group + category, needed by every expense and every merchant hint.
    fn seed_category(&self) -> i64 {
        self.dataset
            .write(|tx| {
                let group = fixtures::insert_budget_group(tx, "Living", 0)?;
                fixtures::insert_budget_category(tx, group, "Groceries")
            })
            .expect("the category is seeded")
    }

    /// An expense plus the delta it causes, in ONE captured write — what
    /// `db::expense::insert_expense_with_balance_changes` will do once Story 17 puts it on
    /// `ActiveDataset::write` instead of on a transaction of its own.
    fn insert_expense(&self, category: i64, account_id: i64, cents: i64) -> i64 {
        self.dataset
            .write(|tx| {
                let expense = fixtures::insert_expense_row(tx, category, account_id, cents)?;
                account_db::adjust_account_balance(
                    tx,
                    account_id,
                    CashFlowKind::Expense,
                    cents,
                    BalanceCauseRow::new("expenses", expense, BalanceCause::Created),
                )?;

                Ok(expense)
            })
            .expect("the expense is recorded")
    }

    fn record_hint(&self, merchant: &str, category: i64) {
        self.dataset
            .write(|tx| {
                crate::db::expense::record_merchant_category_hint(tx, merchant, category, false)
            })
            .expect("the hint is recorded");
    }
}

type RowKey = (String, Vec<u8>);

/// The merged state AD-5 says a set of messages means, independent of their order.
#[derive(Default)]
struct Folded {
    balances: BTreeMap<RowKey, BalanceLedger<Vec<u8>>>,
    /// Keyed by message so a duplicate delivery adds nothing: a counter's value is the sum of its
    /// DISTINCT deltas. `(install, hlc, column)` identifies a message here because
    /// `(install, seq, idx)` is only assigned when Story 19 cuts a segment.
    counters: BTreeMap<RowKey, BTreeMap<(String, String, String), i64>>,
}

impl Folded {
    fn balance(&self, table: &str, row: &[u8]) -> i64 {
        self.balances
            .get(&(table.to_string(), row.to_vec()))
            .map(BalanceLedger::value)
            .unwrap_or(0)
    }

    fn counter(&self, table: &str, row: &[u8]) -> i64 {
        self.counters
            .get(&(table.to_string(), row.to_vec()))
            .map(|deltas| deltas.values().sum())
            .unwrap_or(0)
    }
}

fn fold(batches: &[&[StoredMessage]]) -> Folded {
    let mut folded = Folded::default();

    for batch in batches {
        for message in *batch {
            let key = (message.table_name.clone(), message.row_uuid.clone());
            let hlc = Hlc::decode(&message.hlc).expect("a stored hlc decodes");

            match message.kind.as_str() {
                "balance_set" => {
                    let cents = integer_payload(message);
                    folded
                        .balances
                        .entry(key)
                        .or_default()
                        .observe_set(hlc, cents, false);
                }
                "balance_delta" => {
                    let cents = integer_payload(message);
                    let cause = message
                        .cause_uuid
                        .clone()
                        .expect("a balance delta is keyed by its cause");
                    folded
                        .balances
                        .entry(key)
                        .or_default()
                        .observe_delta(hlc, cause, cents);
                }
                "counter_delta" => {
                    let cents = integer_payload(message);
                    let column = message
                        .column_name
                        .clone()
                        .expect("a counter delta names its column");
                    folded.counters.entry(key).or_default().insert(
                        (message.install.clone(), message.hlc.clone(), column),
                        cents,
                    );
                }
                _ => {}
            }
        }
    }

    folded
}

fn integer_payload(message: &StoredMessage) -> i64 {
    let encoded = message
        .payload
        .as_ref()
        .expect("a balance or counter message carries a payload");
    let expected = payload::TAG_INTEGER;
    assert_eq!(encoded[0], expected, "{} carries an integer", message.kind);

    i64::from_be_bytes(encoded[1..].try_into().expect("eight payload bytes"))
}

fn messages_of(replica: &Replica, kind: &str) -> Vec<StoredMessage> {
    replica
        .messages()
        .into_iter()
        .filter(|message| message.kind == kind)
        .collect()
}

/// AD-5's whole claim in one assertion: a replica never recomputes a balance, so the messages must
/// already say what the originating computer wrote.
#[test]
fn an_accounts_messages_fold_to_exactly_the_balance_its_own_code_wrote() {
    let replica = Replica::open();
    let category = replica.seed_category();
    let account = replica.create_account("Chequing", "chequing");

    replica.set_balance(account, 250_000);
    let first = replica.insert_expense(category, account, 12_500);
    replica.insert_expense(category, account, 4_000);
    replica.reverse(
        account,
        CashFlowKind::Expense,
        12_500,
        BalanceCauseRow::new("expenses", first, BalanceCause::Deleted),
    );

    let messages = replica.messages();
    let account_uuid = replica.uuid_of("accounts", account);

    assert_eq!(replica.balance_of(account), 250_000 - 4_000);
    assert_eq!(
        fold(&[&messages]).balance("accounts", &account_uuid),
        replica.balance_of(account),
        "the folded messages and the live row must be the same number"
    );
}

/// AD-5: a liability account's sign rules are applied ONCE, by the computer the user acted on.
#[test]
fn a_credit_cards_sign_rules_travel_as_a_signed_delta_and_not_as_a_rule_to_re_run() {
    let replica = Replica::open();
    let card = replica.create_account("Visa", "credit_card");

    replica.set_balance(card, -50_000);
    replica.adjust(
        card,
        CashFlowKind::Expense,
        10_000,
        BalanceCauseRow::new("expenses", 1, BalanceCause::Created),
    );
    replica.adjust(
        card,
        CashFlowKind::Income,
        4_000,
        BalanceCauseRow::new("income_entries", 1, BalanceCause::Created),
    );

    let deltas = messages_of(&replica, "balance_delta");
    assert_eq!(
        deltas.iter().map(integer_payload).collect::<Vec<_>>(),
        vec![-10_000, 4_000],
        "owing more is a more negative balance, and a payment moves it back"
    );

    let card_uuid = replica.uuid_of("accounts", card);
    let messages = replica.messages();
    let mut reversed = messages.clone();
    reversed.reverse();

    assert_eq!(replica.balance_of(card), -56_000);
    assert_eq!(fold(&[&messages]).balance("accounts", &card_uuid), -56_000);
    assert_eq!(
        fold(&[&reversed, &messages]).balance("accounts", &card_uuid),
        -56_000,
        "the fold is a function of the message set, not of its order or multiplicity"
    );
}

/// AD-19's double delete, on the emitter side: two computers deleting the same expense must credit
/// the account once.
#[test]
fn two_computers_deleting_the_same_expense_contribute_one_delta() {
    let left = Replica::open();
    let right = Replica::open();

    let category = left.seed_category();
    let account = left.create_account("Chequing", "chequing");
    left.set_balance(account, 100_000);
    let expense = left.insert_expense(category, account, 30_000);

    let account_uuid = left.uuid_of("accounts", account);
    let expense_uuid = left.uuid_of("expenses", expense);

    // What Story 20's apply will have done by the time the right-hand computer can delete it: the
    // rows exist there under the SAME identities, without the right-hand computer having emitted
    // the messages that created them.
    let right_category = right.seed_category();
    let right_account = right.create_account("Chequing", "chequing");
    right.adopt_identity("accounts", right_account, &account_uuid);
    let right_expense = right
        .dataset
        .write(|tx| fixtures::insert_expense_row(tx, right_category, right_account, 30_000))
        .expect("the arrived expense is stored");
    right.adopt_identity("expenses", right_expense, &expense_uuid);

    for (replica, account_id, expense_id) in
        [(&left, account, expense), (&right, right_account, right_expense)]
    {
        replica.reverse(
            account_id,
            CashFlowKind::Expense,
            30_000,
            BalanceCauseRow::new("expenses", expense_id, BalanceCause::Deleted),
        );
    }

    let from_left = messages_of(&left, "balance_delta");
    let from_right = messages_of(&right, "balance_delta");
    let left_cause = from_left.last().expect("a delta").cause_uuid.clone();
    assert_eq!(
        left_cause,
        from_right.last().expect("a delta").cause_uuid,
        "one real-world cause, one cause key, on both computers"
    );

    let left_messages = left.messages();
    let right_deltas = from_right;
    let folded = fold(&[&left_messages, &right_deltas]);
    assert_eq!(
        folded.balance("accounts", &account_uuid),
        100_000 - 30_000 + 30_000,
        "the reversal counts once however many computers issued it"
    );
}

/// The other half of the cause rule: an edit is a NEW event every time, so its deltas must not be
/// mistaken for a replay of the previous edit.
#[test]
fn editing_the_same_expense_twice_is_two_events_and_not_a_duplicate() {
    let replica = Replica::open();
    let category = replica.seed_category();
    let account = replica.create_account("Chequing", "chequing");
    replica.set_balance(account, 100_000);
    let expense = replica.insert_expense(category, account, 10_000);

    for (old, new) in [(10_000, 25_000), (25_000, 10_000)] {
        let cause = BalanceCauseRow::new("expenses", expense, BalanceCause::Edited);
        replica.reverse(account, CashFlowKind::Expense, old, cause);
        replica.adjust(account, CashFlowKind::Expense, new, cause);
    }

    let causes: std::collections::BTreeSet<Option<Vec<u8>>> = messages_of(&replica, "balance_delta")
        .into_iter()
        .map(|message| message.cause_uuid)
        .collect();
    assert_eq!(
        causes.len(),
        5,
        "the creation plus four edit halves are five distinct causes; a per-row key would have \
         collapsed the second edit into the first and lost it"
    );

    let account_uuid = replica.uuid_of("accounts", account);
    let messages = replica.messages();
    assert_eq!(replica.balance_of(account), 90_000);
    assert_eq!(
        fold(&[&messages]).balance("accounts", &account_uuid),
        90_000
    );
}

/// AD-5: concurrent absolute sets are last-write-wins, and the same absolute set is idempotent.
#[test]
fn the_same_absolute_set_on_two_computers_lands_on_that_value_whatever_the_order() {
    let left = Replica::open();
    let right = Replica::open();

    let account = left.create_account("Savings", "savings");
    let account_uuid = left.uuid_of("accounts", account);
    let right_account = right.create_account("Savings", "savings");
    right.adopt_identity("accounts", right_account, &account_uuid);

    left.set_balance(account, 777_000);
    right.set_balance(right_account, 777_000);

    let from_left = messages_of(&left, "balance_set");
    let from_right = messages_of(&right, "balance_set");

    for order in [
        vec![&from_left[..], &from_right[..]],
        vec![&from_right[..], &from_left[..]],
    ] {
        assert_eq!(
            fold(&order).balance("accounts", &account_uuid),
            777_000,
            "two computers stating the same balance cannot produce a different one"
        );
    }
}

/// AD-5's set-plus-delta: a delta stamped after a set applies on top of it, and one stamped before
/// it was already included in the number the user typed.
#[test]
fn a_delta_applies_on_top_of_a_set_only_when_it_is_stamped_after_it() {
    let replica = Replica::open();
    let account = replica.create_account("Chequing", "chequing");
    let account_uuid = replica.uuid_of("accounts", account);

    replica.adjust(
        account,
        CashFlowKind::Income,
        5_000,
        BalanceCauseRow::new("income_entries", 1, BalanceCause::Created),
    );
    let before_the_set = replica.messages();

    replica.set_balance(account, 200_000);
    let through_the_set = replica.messages();

    replica.adjust(
        account,
        CashFlowKind::Expense,
        30_000,
        BalanceCauseRow::new("expenses", 1, BalanceCause::Created),
    );
    let everything = replica.messages();

    assert_eq!(
        fold(&[&before_the_set]).balance("accounts", &account_uuid),
        5_000
    );
    assert_eq!(
        fold(&[&through_the_set]).balance("accounts", &account_uuid),
        200_000,
        "the set absorbs every delta stamped before it"
    );
    assert_eq!(
        fold(&[&everything]).balance("accounts", &account_uuid),
        170_000
    );
    assert_eq!(replica.balance_of(account), 170_000);
}

/// AD-5's counter: two computers each using a merchant once add up to two uses, and a duplicated
/// delivery still adds one.
#[test]
fn counter_increments_from_two_computers_add_up_without_double_counting() {
    let left = Replica::open();
    let right = Replica::open();

    let category = left.seed_category();
    let right_category = right.seed_category();
    let category_uuid = left.uuid_of("budget_categories", category);

    left.record_hint("Metro", category);
    right.adopt_identity("budget_categories", right_category, &category_uuid);
    right.record_hint("Metro", right_category);

    let hint_uuid = identity::merchant_category_hint("metro", &category_uuid);
    assert_eq!(
        left.uuid_of("merchant_category_hints", 1),
        hint_uuid,
        "AD-2: the hint's identity is derived from its natural key, so both computers agree on it"
    );
    assert_eq!(right.uuid_of("merchant_category_hints", 1), hint_uuid);
    assert_eq!(left.usage_count_of(1), 2, "created with one use, then reinforced");

    let from_left = messages_of(&left, "counter_delta");
    let from_right = messages_of(&right, "counter_delta");
    assert_eq!(
        from_left.iter().map(integer_payload).collect::<Vec<_>>(),
        vec![1, 1],
        "AD-5: the creation emits the initial count as a delta from zero, the reinforcement one more"
    );

    assert_eq!(
        fold(&[&from_left]).counter("merchant_category_hints", &hint_uuid),
        2
    );
    assert_eq!(
        fold(&[&from_left, &from_right, &from_left]).counter(
            "merchant_category_hints",
            &hint_uuid
        ),
        4,
        "two computers, two uses each; the duplicated batch adds nothing"
    );
}

/// AD-5: `balance_cents` leaves this computer only through the two emitters, so an ordinary
/// statement that happens to touch it must produce no message about it at all.
#[test]
fn a_plain_update_of_balance_cents_inside_a_captured_write_emits_nothing_about_it() {
    let replica = Replica::open();
    let account = replica.create_account("Chequing", "chequing");
    let before = replica.messages().len();

    replica
        .dataset
        .write(|tx| {
            fixtures::set_account_balance_directly(tx, account, 999_000, "2030-01-01 00:00:00")
        })
        .expect("the raw update commits");

    let added: Vec<StoredMessage> = replica.messages().split_off(before);
    assert!(
        !added.is_empty(),
        "the statement did change a captured row, so the test is not vacuous"
    );
    assert!(
        added
            .iter()
            .all(|message| message.kind == "field" && message.cause_uuid.is_none()),
        "no balance message may come from the generic hook, got {:?}",
        added.iter().map(|message| &message.kind).collect::<Vec<_>>()
    );

    let columns: Vec<String> = added
        .iter()
        .flat_map(|message| {
            payload::decode_row(message.payload.as_deref().expect("a field payload"))
                .expect("the row payload decodes")
        })
        .map(|(column, _)| column)
        .collect();
    assert!(
        !columns.contains(&"balance_cents".to_string()),
        "AD-5: the balance is not an ordinary field, got {columns:?}"
    );
    assert_eq!(
        replica.balance_of(account),
        999_000,
        "the row itself still changed — only the message is withheld"
    );
}

/// A balance emitter inside a rolled-back savepoint must not leave its message behind.
#[test]
fn an_emission_inside_a_rolled_back_savepoint_is_discarded_with_its_rows() {
    let replica = Replica::open();
    let account = replica.create_account("Chequing", "chequing");
    let before = replica.messages().len();

    replica
        .dataset
        .write(|tx| {
            let failed = tx.savepoint(|conn| {
                account_db::update_account_balance(conn, account, 5_000)?;
                Err::<(), AppError>(AppError::Database {
                    message: "deliberate".to_string(),
                })
            });
            assert!(failed.is_err());

            Ok(())
        })
        .expect("the outer write still commits");

    assert_eq!(
        replica.messages().len(),
        before,
        "the rolled-back set must not be published"
    );
    assert_eq!(replica.balance_of(account), 0);
}

/// A local-only profile has no capture at all, so the emitters must be a no-op there rather than a
/// panic or a stray row (inherited AD-12).
#[test]
fn a_local_only_profile_emits_no_balance_message_and_binds_no_identity() {
    let dir = TempDir::new().expect("temp dir");
    let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));
    let capture =
        Capture::for_dataset(DatasetKind::Local, &conn).expect("a local dataset asks for none");
    let dataset = ActiveDataset {
        id: Some("local".to_string()),
        conn: Some(conn),
        capture,
    };

    let account = dataset
        .write(|tx| {
            account_db::insert_account(
                tx,
                &CreateAccountInput {
                    name: "Chequing".to_string(),
                    institution: "Test Bank".to_string(),
                    account_type: "chequing".to_string(),
                    currency: "CAD".to_string(),
                },
            )
        })
        .expect("the account is created");
    dataset
        .write(|tx| account_db::update_account_balance(tx, account.id, 4_200))
        .expect("the balance is set");

    let conn = dataset.conn.as_ref().expect("a connection");
    assert!(dataset.capture.is_none());
    assert_eq!(
        sync_capture::all_messages(conn).expect("the log reads").len(),
        0
    );
    assert_eq!(sync_identity::count(conn).expect("the mappings count"), 0);
}
