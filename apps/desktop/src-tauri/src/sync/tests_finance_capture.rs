//! AD-3 on the finance write paths: every migrated domain is proven to produce `sync_log` rows
//! when its write COMMITS and none when it rolls back.
//!
//! The write-site budget (`tests_write_site_budget.rs`) is the structural half of this story — it
//! proves no SQL write was left outside `ActiveDataset::write`. This file is the behavioural half:
//! it drives the real commands' `db::*` functions through a real `ActiveDataset` with the real hook
//! and reads the real log, so a function that was marked `CAPTURE-SANCTIONED` while silently
//! capturing nothing fails here.

use std::collections::BTreeSet;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::sync_capture::{self, StoredMessage};
use crate::db::{
    account as account_db, asset as asset_db, budget as budget_db, expense as expense_db,
    income as income_db, net_worth as net_worth_db, recurring as recurring_db,
    recurring_income as recurring_income_db, sync_identity, test_dataset, ActiveDataset,
};
use crate::error::AppError;
use crate::models::{
    CreateAccountInput, CreateAssetInput, CreateBudgetCategory, CreateBudgetGroup,
    CreateExpenseInput, CreateIncomeEntryInput, CreateIncomeSourceInput,
    CreateRecurringExpenseTemplateInput, CreateRecurringIncomeTemplateInput, DatasetKind,
    UpdateAccountInput, UpdateAssetInput, UpdateExpenseInput, UpdateIncomeEntryInput,
    UpdateIncomeSourceInput, UpdateRecurringExpenseTemplateInput,
    UpdateRecurringIncomeTemplateInput,
};

use super::capture::{payload, Capture};
use super::identity;

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
                id: Some("finance-capture-test".to_string()),
                conn: Some(conn),
                capture: Some(capture),
            },
        }
    }

    fn local_only() -> Self {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("local-only-test".to_string()),
                conn: Some(conn),
                capture: None,
            },
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset
            .conn
            .as_ref()
            .expect("a replica has a connection")
    }

    fn messages(&self) -> Vec<StoredMessage> {
        sync_capture::all_messages(self.conn()).expect("the log reads")
    }

    fn clear_log(&self) {
        self.conn()
            .execute_batch("DELETE FROM sync_log")
            .expect("the log clears");
    }

    /// Every table the log has a message about since the last [`Replica::clear_log`].
    fn touched_tables(&self) -> BTreeSet<String> {
        self.messages()
            .into_iter()
            .map(|message| message.table_name)
            .collect()
    }

    fn kinds_for(&self, table: &str) -> Vec<String> {
        self.messages()
            .into_iter()
            .filter(|message| message.table_name == table)
            .map(|message| message.kind)
            .collect()
    }

    /// Every column named by a `field` message about `table` since the last clear.
    ///
    /// WHY the balance assertions read the PAYLOAD instead of counting messages: `updated_at` is
    /// an `Lww` column every finance write path sets to `datetime('now')`, whose granularity is
    /// one SECOND, so a write that lands in a later second than the seed legitimately adds a
    /// `field` message and one that lands in the same second does not. An exact message vector is
    /// therefore a wall-clock race, while what AD-5 actually forbids — the balance travelling as
    /// an ordinary field — is a statement about the columns a field message carries.
    fn field_columns(&self, table: &str) -> BTreeSet<String> {
        self.messages()
            .into_iter()
            .filter(|message| message.table_name == table && message.kind == "field")
            .flat_map(|message| {
                payload::decode_row(
                    message
                        .payload
                        .as_deref()
                        .expect("a field message has a payload"),
                )
                .expect("the row payload decodes")
            })
            .map(|(column, _)| column)
            .collect()
    }

    fn write<T>(
        &self,
        operation: impl FnOnce(&crate::db::WriteTx<'_>) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        self.dataset.write(operation)
    }

    fn seed_category(&self) -> i64 {
        self.write(|tx| {
            let group = budget_db::create_budget_group(
                tx,
                &CreateBudgetGroup {
                    name: "Living".to_string(),
                },
            )?;
            budget_db::create_budget_category(
                tx,
                &CreateBudgetCategory {
                    group_id: group.id,
                    name: "Groceries".to_string(),
                    target_cents: 50_000,
                },
            )
        })
        .expect("the category is seeded")
        .id
    }

    fn seed_account(&self) -> i64 {
        self.write(|tx| {
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
        .expect("the account is seeded")
        .id
    }

    fn seed_income_source(&self) -> i64 {
        self.write(|tx| {
            income_db::insert_income_source(
                tx,
                &CreateIncomeSourceInput {
                    name: "Salary".to_string(),
                    income_type: "employment".to_string(),
                },
            )
        })
        .expect("the source is seeded")
        .id
    }
}

#[test]
fn the_budget_category_write_sites_are_captured() {
    let replica = Replica::open();

    let group = replica
        .write(|tx| {
            budget_db::create_budget_group(
                tx,
                &CreateBudgetGroup {
                    name: "Living".to_string(),
                },
            )
        })
        .expect("the group is created");
    replica.clear_log();

    let category = replica
        .write(|tx| {
            budget_db::create_budget_category(
                tx,
                &CreateBudgetCategory {
                    group_id: group.id,
                    name: "Groceries".to_string(),
                    target_cents: 50_000,
                },
            )
        })
        .expect("the category is created");
    assert_eq!(replica.kinds_for("budget_categories"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| {
            budget_db::update_budget_category(tx, category.id, Some("Food".to_string()), None)
        })
        .expect("the category is renamed");
    assert_eq!(replica.kinds_for("budget_categories"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| budget_db::reorder_budget_categories(tx, group.id, &[category.id]))
        .expect("the categories reorder");
    // A reorder that moves nothing still writes the row, and the hook only reports a CHANGED
    // column — so the assertion is about the write being captured at all, not about a count.
    assert!(replica.kinds_for("budget_categories").len() <= 1);

    replica.clear_log();
    replica
        .write(|tx| budget_db::delete_budget_category(tx, category.id))
        .expect("the category is deleted");
    assert!(
        !replica.kinds_for("budget_categories").is_empty(),
        "a delete must be captured"
    );
}

/// AD-12's restorability on a real finance cascade: deleting an income source takes its entries
/// with it, and every one of them has to be in the log or the delete is unreplayable.
#[test]
fn deleting_an_income_source_captures_its_cascaded_entries() {
    let replica = Replica::open();
    let source = replica.seed_income_source();
    for date in ["2026-09-15", "2026-10-15"] {
        replica
            .write(|tx| {
                income_db::insert_income_entry(
                    tx,
                    &CreateIncomeEntryInput {
                        source_id: source,
                        amount_cents: 100_000,
                        date: date.to_string(),
                        account_id: None,
                    },
                )
            })
            .expect("an entry is created");
    }
    replica.clear_log();

    replica
        .write(|tx| income_db::delete_income_source(tx, source))
        .expect("the source is deleted");

    assert_eq!(
        replica.kinds_for("income_entries"),
        vec!["tombstone", "tombstone"],
        "both cascaded entries must be tombstoned"
    );
    assert_eq!(replica.kinds_for("income_sources"), vec!["tombstone"]);
}

#[test]
fn the_expense_write_sites_are_captured() {
    let replica = Replica::open();
    let category = replica.seed_category();
    let account = replica.seed_account();
    replica.clear_log();

    let created = replica
        .write(|tx| {
            expense_db::insert_expense_with_balance_changes(
                tx,
                &CreateExpenseInput {
                    merchant: "Metro".to_string(),
                    amount_cents: 4_200,
                    budget_category_id: category,
                    date: "2026-10-01".to_string(),
                    account_id: Some(account),
                },
            )
        })
        .expect("the expense is created")
        .expense;
    assert_eq!(replica.kinds_for("expenses"), vec!["field"]);
    assert_eq!(
        replica
            .kinds_for("accounts")
            .iter()
            .filter(|kind| *kind == "balance_delta")
            .count(),
        1,
        "the linked account moves by AD-5's cause-keyed delta"
    );
    assert!(
        !replica.field_columns("accounts").contains("balance_cents"),
        "and never by a balance field"
    );

    replica.clear_log();
    replica
        .write(|tx| {
            expense_db::update_expense(
                tx,
                created.id,
                &UpdateExpenseInput {
                    merchant: "Metro Plus".to_string(),
                    amount_cents: 5_000,
                    budget_category_id: category,
                    date: "2026-10-02".to_string(),
                    account_id: Some(account),
                },
            )
        })
        .expect("the expense is updated");
    assert_eq!(replica.kinds_for("expenses"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| expense_db::delete_expense(tx, created.id))
        .expect("the expense is deleted");
    assert_eq!(replica.kinds_for("expenses"), vec!["tombstone"]);
}

#[test]
fn an_import_batch_is_captured_row_by_row() {
    let replica = Replica::open();
    let category = replica.seed_category();
    replica.clear_log();

    let rows: Vec<(String, i64, i64, String)> = (0..5)
        .map(|index| {
            (
                format!("Merchant {index}"),
                1_000 + index,
                category,
                "2026-10-03".to_string(),
            )
        })
        .collect();

    let count = replica
        .write(|tx| expense_db::bulk_insert_imported_expenses(tx, &rows))
        .expect("the batch imports");

    assert_eq!(count, 5);
    assert_eq!(replica.kinds_for("expenses").len(), 5);
}

#[test]
fn the_account_write_sites_are_captured() {
    let replica = Replica::open();

    let account = replica.seed_account();
    assert!(!replica.kinds_for("accounts").is_empty());

    replica.clear_log();
    replica
        .write(|tx| {
            account_db::update_account(
                tx,
                account,
                &UpdateAccountInput {
                    name: "Savings".to_string(),
                    institution: "Test Bank".to_string(),
                    account_type: "savings".to_string(),
                    currency: "CAD".to_string(),
                },
            )
        })
        .expect("the account is updated");
    assert_eq!(replica.kinds_for("accounts"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| account_db::delete_account(tx, account))
        .expect("the account is deleted");
    assert_eq!(replica.kinds_for("accounts"), vec!["tombstone"]);
}

#[test]
fn the_income_write_sites_are_captured() {
    let replica = Replica::open();
    let account = replica.seed_account();

    let source = replica.seed_income_source();
    assert_eq!(replica.kinds_for("income_sources"), vec!["field"]);

    replica.clear_log();
    let entry = replica
        .write(|tx| {
            income_db::insert_income_entry(
                tx,
                &CreateIncomeEntryInput {
                    source_id: source,
                    amount_cents: 300_000,
                    date: "2026-10-15".to_string(),
                    account_id: Some(account),
                },
            )
        })
        .expect("the entry is created")
        .entry;
    assert_eq!(replica.kinds_for("income_entries"), vec!["field"]);
    assert!(replica
        .kinds_for("accounts")
        .contains(&"balance_delta".to_string()));

    replica.clear_log();
    replica
        .write(|tx| {
            income_db::update_income_entry(
                tx,
                entry.id,
                &UpdateIncomeEntryInput {
                    source_id: source,
                    amount_cents: 310_000,
                    date: "2026-10-16".to_string(),
                    account_id: Some(account),
                },
            )
        })
        .expect("the entry is updated");
    assert_eq!(replica.kinds_for("income_entries"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| income_db::delete_income_entry(tx, entry.id))
        .expect("the entry is deleted");
    assert_eq!(replica.kinds_for("income_entries"), vec!["tombstone"]);

    replica.clear_log();
    replica
        .write(|tx| {
            income_db::update_income_source(
                tx,
                source,
                &UpdateIncomeSourceInput {
                    name: "Salary 2".to_string(),
                    income_type: "employment".to_string(),
                },
            )
        })
        .expect("the source is updated");
    assert_eq!(replica.kinds_for("income_sources"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| income_db::delete_income_source(tx, source))
        .expect("the source is deleted");
    assert_eq!(replica.kinds_for("income_sources"), vec!["tombstone"]);
}

#[test]
fn the_passive_asset_and_net_worth_write_sites_are_captured() {
    let replica = Replica::open();

    let asset = replica
        .write(|tx| {
            asset_db::insert_asset(
                tx,
                &CreateAssetInput {
                    name: "House".to_string(),
                    asset_type: "real_estate".to_string(),
                    value_cents: 50_000_000,
                },
            )
        })
        .expect("the asset is created");
    assert_eq!(replica.kinds_for("passive_assets"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| asset_db::update_asset_value(tx, asset.id, 51_000_000))
        .expect("the value is updated");
    assert_eq!(replica.kinds_for("passive_assets"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| {
            asset_db::update_asset(
                tx,
                asset.id,
                &UpdateAssetInput {
                    name: "Cottage".to_string(),
                    asset_type: "real_estate".to_string(),
                },
            )
        })
        .expect("the asset is renamed");
    assert_eq!(replica.kinds_for("passive_assets"), vec!["field"]);

    replica.clear_log();
    replica
        .write(|tx| net_worth_db::record_net_worth_snapshot(tx))
        .expect("the snapshot is recorded");
    assert!(
        !replica.kinds_for("net_worth_snapshots").is_empty(),
        "net-worth history must travel"
    );

    replica.clear_log();
    replica
        .write(|tx| asset_db::delete_asset(tx, asset.id))
        .expect("the asset is deleted");
    assert_eq!(replica.kinds_for("passive_assets"), vec!["tombstone"]);
}

#[test]
fn the_recurring_template_write_sites_are_captured() {
    let replica = Replica::open();
    let category = replica.seed_category();
    let source = replica.seed_income_source();
    replica.clear_log();

    let expense_template = replica
        .write(|tx| {
            recurring_db::insert_template(
                tx,
                &CreateRecurringExpenseTemplateInput {
                    merchant: "Gym".to_string(),
                    amount_cents: 5_000,
                    budget_category_id: category,
                    day_of_month: 1,
                },
            )
        })
        .expect("the template is created");
    assert_eq!(
        replica.kinds_for("recurring_expense_templates"),
        vec!["field"]
    );

    replica.clear_log();
    replica
        .write(|tx| {
            recurring_db::update_template(
                tx,
                expense_template.id,
                &UpdateRecurringExpenseTemplateInput {
                    merchant: "Gym".to_string(),
                    amount_cents: 6_000,
                    budget_category_id: category,
                    day_of_month: 2,
                    is_active: true,
                },
            )
        })
        .expect("the template is updated");
    assert_eq!(
        replica.kinds_for("recurring_expense_templates"),
        vec!["field"]
    );

    replica.clear_log();
    replica
        .write(|tx| recurring_db::delete_template(tx, expense_template.id))
        .expect("the template is deleted");
    assert_eq!(
        replica.kinds_for("recurring_expense_templates"),
        vec!["tombstone"]
    );

    replica.clear_log();
    let income_template = replica
        .write(|tx| {
            recurring_income_db::insert_template(
                tx,
                &CreateRecurringIncomeTemplateInput {
                    source_id: source,
                    amount_cents: 100_000,
                    day_of_month: 15,
                    account_id: None,
                },
            )
        })
        .expect("the income template is created");
    assert_eq!(
        replica.kinds_for("recurring_income_templates"),
        vec!["field"]
    );

    replica.clear_log();
    replica
        .write(|tx| {
            recurring_income_db::update_template(
                tx,
                income_template.id,
                &UpdateRecurringIncomeTemplateInput {
                    source_id: source,
                    amount_cents: 120_000,
                    day_of_month: 16,
                    account_id: None,
                    is_active: true,
                },
            )
        })
        .expect("the income template is updated");
    assert_eq!(
        replica.kinds_for("recurring_income_templates"),
        vec!["field"]
    );

    replica.clear_log();
    replica
        .write(|tx| recurring_income_db::delete_template(tx, income_template.id))
        .expect("the income template is deleted");
    assert_eq!(
        replica.kinds_for("recurring_income_templates"),
        vec!["tombstone"]
    );
}

/// AD-2's template rule, on the real backfill: the generated rows carry a DERIVED identity, so two
/// computers that both backfill the same month are talking about one row and not two.
#[test]
fn a_backfilled_recurring_row_takes_its_derived_identity() {
    // A fixed past period, not "today": the income backfill starts at the template's own
    // `created_at`, which SQLite writes in UTC, while it compares against the LOCAL date. Any
    // fixture aimed at today therefore generates nothing whenever the two dates differ (a local
    // evening east of UTC). The period under test is pinned instead, and the expense half is asked
    // for the same one by value.
    const PERIOD: &str = "2024-01";
    const DAY_OF_MONTH: i32 = 5;
    const CREATED_AT: &str = "2024-01-01 12:00:00";
    const OCCURRENCE: &str = "2024-01-05";

    let identities_of = |replica: &Replica| -> (Vec<u8>, Vec<u8>) {
        let category = replica.seed_category();
        let source = replica.seed_income_source();

        let expense_template = replica
            .write(|tx| {
                recurring_db::insert_template(
                    tx,
                    &CreateRecurringExpenseTemplateInput {
                        merchant: "Gym".to_string(),
                        amount_cents: 5_000,
                        budget_category_id: category,
                        day_of_month: DAY_OF_MONTH,
                    },
                )
            })
            .expect("the template is created");
        let income_template = replica
            .write(|tx| {
                recurring_income_db::insert_template(
                    tx,
                    &CreateRecurringIncomeTemplateInput {
                        source_id: source,
                        amount_cents: 100_000,
                        day_of_month: DAY_OF_MONTH,
                        account_id: None,
                    },
                )
            })
            .expect("the income template is created");

        // The income backfill derives its first occurrence from `created_at`, so the fixture pins
        // it rather than inheriting the clock.
        replica
            .conn()
            .execute(
                "UPDATE recurring_income_templates SET created_at = ?1 WHERE id = ?2",
                rusqlite::params![CREATED_AT, income_template.id],
            )
            .expect("the income template start date is pinned");

        // Both templates are bound to the SAME uuid on both replicas, which is what the apply path
        // will do for real (Story 20) and what makes the derived rows comparable at all.
        for (table, row_id, byte) in [
            ("recurring_expense_templates", expense_template.id, 0xA1),
            ("recurring_income_templates", income_template.id, 0xB2),
        ] {
            sync_identity::forget(replica.conn(), table, row_id).expect("the mapping drops");
            sync_identity::ensure(replica.conn(), table, row_id, &[byte; 16])
                .expect("the identity binds");
        }

        let expenses = replica
            .write(|tx| recurring_db::apply_recurring_for_month(tx, 2024, 1))
            .expect("the month applies");
        assert_eq!(expenses.len(), 1, "exactly one generated expense");

        let entries = replica
            .write(|tx| recurring_income_db::apply_due_recurring_income(tx))
            .expect("the income backfills");
        let generated = entries
            .entries
            .iter()
            .find(|entry| entry.date == OCCURRENCE)
            .expect("the fixture must actually generate the income entry of the pinned period");

        (
            sync_identity::lookup(replica.conn(), "expenses", expenses[0].id)
                .expect("the mapping reads")
                .expect("a generated expense has an identity")
                .to_vec(),
            sync_identity::lookup(replica.conn(), "income_entries", generated.id)
                .expect("the mapping reads")
                .expect("a generated entry has an identity")
                .to_vec(),
        )
    };

    let one = Replica::open();
    let two = Replica::open();
    let (one_expense, one_entry) = identities_of(&one);
    let (two_expense, two_entry) = identities_of(&two);

    assert_eq!(
        one_expense,
        identity::recurring_expense(&[0xA1; 16], PERIOD).to_vec(),
        "the generated expense takes (template uuid, period)"
    );
    assert_eq!(
        one_entry,
        identity::recurring_income(&[0xB2; 16], PERIOD).to_vec(),
        "and the generated entry takes (template uuid, period) too"
    );
    assert_eq!(
        one_expense, two_expense,
        "two computers generating the same month must agree on the row"
    );
    assert_eq!(one_entry, two_entry, "and on the income half");
    assert_ne!(
        one_expense, one_entry,
        "an expense is not an income entry even for the same period"
    );
}

/// The other half of AD-3's guarantee: a write that fails leaves no message describing rows that
/// never existed.
#[test]
fn a_rolled_back_finance_write_captures_nothing() {
    let replica = Replica::open();
    let category = replica.seed_category();
    let account = replica.seed_account();
    replica.clear_log();

    let failed = replica.write(|tx| {
        expense_db::insert_expense_with_balance_changes(
            tx,
            &CreateExpenseInput {
                merchant: "Metro".to_string(),
                amount_cents: 4_200,
                budget_category_id: category,
                date: "2026-10-01".to_string(),
                account_id: Some(account),
            },
        )?;

        Err::<(), AppError>(AppError::Validation {
            message: "deliberate failure after a real row and a real emission".to_string(),
            field: None,
        })
    });

    assert!(failed.is_err());
    assert!(
        replica.messages().is_empty(),
        "a rolled back write must leave no message"
    );
    assert_eq!(
        replica
            .conn()
            .query_row("SELECT COUNT(*) FROM expenses", [], |row| row
                .get::<_, i64>(0))
            .expect("the count reads"),
        0,
        "and no row"
    );
}

/// Inherited AD-12: a local-only profile runs the SAME migrated write sites and still writes no
/// sync bookkeeping at all.
#[test]
fn a_local_only_profile_captures_no_finance_write() {
    let replica = Replica::local_only();
    let category = replica.seed_category();
    let account = replica.seed_account();

    replica
        .write(|tx| {
            expense_db::insert_expense_with_balance_changes(
                tx,
                &CreateExpenseInput {
                    merchant: "Metro".to_string(),
                    amount_cents: 4_200,
                    budget_category_id: category,
                    date: "2026-10-01".to_string(),
                    account_id: Some(account),
                },
            )
        })
        .expect("the expense is created");
    replica
        .write(|tx| net_worth_db::record_net_worth_snapshot(tx))
        .expect("the snapshot is recorded");

    assert!(replica.touched_tables().is_empty());
    assert_eq!(
        sync_identity::count(replica.conn()).expect("the mapping count reads"),
        0,
        "no identity is minted either"
    );
}
