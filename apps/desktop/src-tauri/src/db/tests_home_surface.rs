use std::time::Instant;

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tempfile::TempDir;

use super::*;
use crate::db::test_dataset::migrated_dataset;
use crate::db::tests_home_surface_fixtures::seed_known_profile;

fn dataset() -> (TempDir, Connection) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));
    (dir, conn)
}

fn widget(title: &str, component: &str, source: &str, params: Value) -> Value {
    crate::home_surface::validate::validate_widget(&json!({
        "component": component,
        "title": title,
        "dataBinding": { "source": source, "params": params }
    }))
    .expect("a valid fixture widget")
}

fn add(conn: &Connection, spec: Value) -> AppliedChange {
    apply_change(conn, &SurfaceChange::Add { widget: spec }).expect("add applies")
}

fn data_of(widget: &HomeWidget) -> &HomeDataset {
    widget.root.data.as_ref().expect("a resolved display")
}

fn resolve_one(conn: &Connection, source: &str, params: Value) -> HomeDataset {
    let params = params.as_object().cloned().unwrap_or_default();
    resolve_binding(conn, source, &params, now(conn).expect("now"))
        .expect("resolves")
        .expect("a known source")
}

/// FR-8: the persisted structure comes back unchanged, in order, with no AI call involved.
#[test]
fn widgets_persist_in_order_and_reload_identically() {
    let (dir, conn) = dataset();
    add(
        &conn,
        widget("First", "Metric", "account_balances", json!({})),
    );
    add(
        &conn,
        widget(
            "Second",
            "BarChart",
            "expenses_by_month",
            json!({ "months": 3 }),
        ),
    );
    drop(conn);

    let reopened = migrated_dataset(&dir.path().join("nixus.db"));
    let surface = resolve_surface(&reopened).expect("resolves");
    assert_eq!(
        surface.iter().map(|w| w.title.as_str()).collect::<Vec<_>>(),
        vec!["First", "Second"]
    );
    assert_eq!(surface[1].root.component, "BarChart");
    assert_eq!(data_of(&surface[1]).rows.len(), 3);
}

/// FR-8: values are resolved at open time, never snapshotted when the widget was generated.
#[test]
fn a_widget_shows_data_recorded_after_it_was_created() {
    let (_dir, conn) = dataset();
    let known = seed_known_profile(&conn);
    add(
        &conn,
        widget(
            "Spend",
            "Metric",
            "expenses_by_month",
            json!({ "months": 1 }),
        ),
    );

    let before = data_of(&resolve_surface(&conn).unwrap()[0]).rows[0].values[0];
    conn.execute(
        "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('Later', 1111, ?1, date('now'))",
        params![known.groceries_category_id],
    )
    .unwrap();
    let after = data_of(&resolve_surface(&conn).unwrap()[0]).rows[0].values[0];

    assert_eq!(after - before, 1111);
}

/// FR-6: an add touches no other widget.
#[test]
fn adding_leaves_every_other_widget_unchanged() {
    let (_dir, conn) = dataset();
    add(&conn, widget("A", "Metric", "account_balances", json!({})));
    add(&conn, widget("B", "Table", "asset_values", json!({})));
    let before = list_widgets(&conn).unwrap();

    add(
        &conn,
        widget("C", "PieChart", "expenses_by_category", json!({})),
    );
    let after = list_widgets(&conn).unwrap();

    assert_eq!(after.len(), 3);
    for (old, new) in before.iter().zip(&after) {
        assert_eq!(old.widget_key, new.widget_key);
        assert_eq!(old.position, new.position);
        assert_eq!(old.spec_json, new.spec_json);
        assert_eq!(old.updated_at, new.updated_at);
    }
    assert!(
        after[2].position > after[1].position,
        "an add lands at the end"
    );
}

/// FR-6: a modify is a whole-widget replace that keeps the widget's id and position.
#[test]
fn modifying_replaces_the_spec_but_keeps_id_and_position() {
    let (_dir, conn) = dataset();
    add(&conn, widget("A", "Metric", "account_balances", json!({})));
    add(
        &conn,
        widget("Trend", "LineChart", "net_worth_history", json!({})),
    );
    add(&conn, widget("C", "Table", "asset_values", json!({})));
    let target = list_widgets(&conn).unwrap()[1].clone();

    let applied = apply_change(
        &conn,
        &SurfaceChange::Modify {
            widget_id: target.widget_key.clone(),
            widget: widget(
                "Trend",
                "BarChart",
                "net_worth_history",
                json!({ "months": 6 }),
            ),
        },
    )
    .expect("modify applies");

    let after = list_widgets(&conn).unwrap();
    assert_eq!(after[1].widget_key, target.widget_key);
    assert_eq!(after[1].position, target.position);
    assert_eq!(after[1].id, target.id);
    assert!(after[1].spec_json.contains("BarChart"));
    assert!(!after[1].spec_json.contains("LineChart"));
    assert_eq!(applied.action, "update");
    assert!(applied.old_value.unwrap().contains("LineChart"));
    assert!(applied.new_value.unwrap().contains("BarChart"));
}

#[test]
fn removing_deletes_only_the_target_and_an_unknown_key_is_refused() {
    let (_dir, conn) = dataset();
    add(
        &conn,
        widget("Keep", "Metric", "account_balances", json!({})),
    );
    add(&conn, widget("Drop", "Metric", "asset_values", json!({})));
    let drop_key = list_widgets(&conn).unwrap()[1].widget_key.clone();

    let applied = apply_change(
        &conn,
        &SurfaceChange::Remove {
            widget_id: drop_key.clone(),
            title: "Drop".to_string(),
        },
    )
    .expect("remove applies");
    assert_eq!(applied.action, "delete");
    assert!(applied.new_value.is_none());

    let left = list_widgets(&conn).unwrap();
    assert_eq!(left.len(), 1);
    assert!(left[0].spec_json.contains("Keep"));

    assert!(apply_change(
        &conn,
        &SurfaceChange::Remove {
            widget_id: drop_key,
            title: String::new()
        }
    )
    .is_err());
}

#[test]
fn each_whitelisted_source_resolves_against_live_data() {
    let (_dir, conn) = dataset();
    seed_known_profile(&conn);

    let by_month = resolve_one(&conn, "expenses_by_month", json!({ "months": 3 }));
    assert_eq!(by_month.dimension, "month");
    assert_eq!(
        by_month.rows.len(),
        3,
        "every month in the window, zero-filled"
    );
    let values: Vec<i64> = by_month.rows.iter().map(|r| r.values[0]).collect();
    assert_eq!(values, vec![147_389, 618_253, 873_419 + 259_377]);

    let by_category = resolve_one(
        &conn,
        "expenses_by_category",
        json!({ "months": 3, "limit": 1 }),
    );
    assert_eq!(by_category.rows[0].label, "Quixotic Groceries");
    assert_eq!(by_category.rows[0].values, vec![873_419 + 618_253]);
    assert_eq!(
        by_category.rows[1].key, OTHER_ROW_KEY,
        "the remainder is folded, not dropped"
    );
    assert_eq!(by_category.rows[1].values, vec![259_377 + 147_389]);

    let net_worth = resolve_one(&conn, "net_worth_history", json!({ "months": 2 }));
    assert_eq!(
        net_worth
            .rows
            .iter()
            .map(|r| r.values[0])
            .collect::<Vec<_>>(),
        vec![64_183_529, 65_829_117]
    );

    let budget = resolve_one(
        &conn,
        "budget_vs_actual_by_category",
        json!({ "months_ago": 0 }),
    );
    assert_eq!(budget.series, vec!["actual", "budget"]);
    let groceries = budget
        .rows
        .iter()
        .find(|r| r.label == "Quixotic Groceries")
        .unwrap();
    assert_eq!(groceries.values, vec![873_419, 912_345]);

    let flow = resolve_one(&conn, "income_vs_expense_by_month", json!({ "months": 1 }));
    assert_eq!(flow.rows[0].values, vec![739_163, 873_419 + 259_377]);

    let accounts = resolve_one(&conn, "account_balances", json!({}));
    assert_eq!(accounts.rows.len(), 2);
    assert!(accounts.rows.iter().any(|r| r.values == vec![4_281_937]));

    let assets = resolve_one(&conn, "asset_values", json!({}));
    assert_eq!(assets.rows[0].values, vec![61_928_374]);
}

/// §8 #3 is open; until it is decided, a node this build cannot render is kept and flagged rather
/// than dropped, so a synced widget from a newer version is never silently lost.
#[test]
fn a_persisted_node_this_build_does_not_know_is_flagged_not_dropped() {
    let (_dir, conn) = dataset();
    conn.execute(
        "INSERT INTO home_widgets (widget_key, position, spec_json) VALUES ('w_future', 1, ?1)",
        params![
            json!({ "component": "Card", "title": "Future", "children": [
                { "component": "Sparkline", "dataBinding": { "source": "account_balances" } },
                { "component": "Metric", "dataBinding": { "source": "crypto_prices" } }
            ]})
            .to_string()
        ],
    )
    .unwrap();

    let surface = resolve_surface(&conn).expect("an unknown node never fails the whole surface");
    assert_eq!(surface.len(), 1);
    assert!(surface[0].root.children[0].unsupported);
    assert!(surface[0].root.children[1].unsupported);
    assert!(!surface[0].root.unsupported);
}

/// FR-8 NFR: a full 12-widget Home Surface resolves within one second on a heavy local dataset.
#[test]
fn a_full_surface_resolves_within_the_one_second_budget() {
    let (_dir, conn) = dataset();
    seed_known_profile(&conn);
    let category: i64 = conn
        .query_row("SELECT id FROM budget_categories LIMIT 1", [], |r| r.get(0))
        .unwrap();
    // Three years of daily-ish spending plus a snapshot every few days: well past typical volume.
    conn.execute_batch("BEGIN").unwrap();
    for day in 0..1_100_i64 {
        for n in 0..5_i64 {
            conn.execute(
                "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
                 VALUES ('Bulk', ?1, ?2, date('now', printf('-%d days', ?3)))",
                params![1_000 + n, category, day],
            )
            .unwrap();
        }
        if day % 3 == 0 {
            conn.execute(
                "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json)
                 VALUES (?1, date('now', printf('-%d days', ?2)), '{}')",
                params![50_000_000 + day, day],
            )
            .unwrap();
        }
    }
    conn.execute_batch("COMMIT").unwrap();

    let sources = [
        ("LineChart", "net_worth_history", json!({ "months": 36 })),
        ("BarChart", "expenses_by_month", json!({ "months": 36 })),
        (
            "AreaChart",
            "income_vs_expense_by_month",
            json!({ "months": 36 }),
        ),
        ("PieChart", "expenses_by_category", json!({ "months": 12 })),
        ("Table", "budget_vs_actual_by_category", json!({})),
        ("Metric", "account_balances", json!({})),
        ("BarChart", "asset_values", json!({})),
        ("Metric", "expenses_by_month", json!({ "months": 2 })),
        ("LineChart", "expenses_by_month", json!({ "months": 12 })),
        (
            "Table",
            "expenses_by_category",
            json!({ "months": 6, "limit": 20 }),
        ),
        (
            "BarChart",
            "budget_vs_actual_by_category",
            json!({ "months_ago": 1 }),
        ),
        ("AreaChart", "net_worth_history", json!({ "months": 120 })),
    ];
    for (index, (component, source, params)) in sources.into_iter().enumerate() {
        add(
            &conn,
            widget(&format!("W{index}"), component, source, params),
        );
    }

    let started = Instant::now();
    let surface = resolve_surface(&conn).expect("resolves");
    let elapsed = started.elapsed();

    assert_eq!(surface.len(), crate::home_surface::validate::MAX_WIDGETS);
    assert!(elapsed.as_millis() < 1_000, "Home open took {elapsed:?}");
}

#[test]
fn recent_expenses_lists_individual_expenses_newest_first() {
    let (_dir, conn) = dataset();
    seed_known_profile(&conn);

    let listed = resolve_one(&conn, "recent_expenses", json!({ "limit": 3 }));
    assert_eq!(listed.dimension, "expense");
    assert_eq!(listed.detail_columns, vec!["date", "category"]);
    assert_eq!(listed.series, vec!["amount"]);
    assert_eq!(listed.rows.len(), 3, "the limit is honoured");

    let dates: Vec<&str> = listed.rows.iter().map(|r| r.details[0].as_str()).collect();
    let mut sorted = dates.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(dates, sorted, "newest first");

    // The two current-month expenses share a date; the later-entered one comes first.
    assert_eq!(listed.rows[0].label, "Bellwether Bistro");
    assert_eq!(listed.rows[0].values, vec![259_377]);
    assert_eq!(listed.rows[0].details[1], "Marmalade Dining");
    assert_eq!(listed.rows[1].label, "Quokka Market");
    assert_eq!(listed.rows[2].values, vec![618_253]);

    let all = resolve_one(&conn, "recent_expenses", json!({}));
    assert_eq!(all.rows.len(), 4, "the default of 10 covers the whole seed");
}

/// The reported scenario: "Spending by Category – Last Month" shows last month, not this one.
#[test]
fn a_window_can_end_in_any_past_month() {
    let (_dir, conn) = dataset();
    seed_known_profile(&conn);

    let last_month = resolve_one(
        &conn,
        "expenses_by_category",
        json!({ "months": 1, "months_ago": 1 }),
    );
    assert_eq!(last_month.rows.len(), 1, "only last month's one expense");
    assert_eq!(last_month.rows[0].label, "Quixotic Groceries");
    assert_eq!(last_month.rows[0].values, vec![618_253]);

    let two_months_back = resolve_one(
        &conn,
        "expenses_by_month",
        json!({ "months": 2, "months_ago": 1 }),
    );
    assert_eq!(
        two_months_back.rows.iter().map(|r| r.values[0]).collect::<Vec<_>>(),
        vec![147_389, 618_253],
        "the window ends last month and excludes this month"
    );

    let net_worth = resolve_one(&conn, "net_worth_history", json!({ "months": 1, "months_ago": 2 }));
    assert_eq!(net_worth.rows.len(), 1);
    assert_eq!(net_worth.rows[0].values, vec![63_017_291]);

    let flow = resolve_one(&conn, "income_vs_expense_by_month", json!({ "months": 1, "months_ago": 1 }));
    assert_eq!(flow.rows[0].values, vec![0, 618_253], "this month's income stays out");
}

#[test]
fn spending_and_transactions_can_be_narrowed_to_one_category_in_the_users_words() {
    let (_dir, conn) = dataset();
    seed_known_profile(&conn);

    let groceries = resolve_one(
        &conn,
        "expenses_by_month",
        json!({ "months": 3, "category": "groceries" }),
    );
    assert_eq!(
        groceries.rows.iter().map(|r| r.values[0]).collect::<Vec<_>>(),
        vec![0, 618_253, 873_419]
    );

    let dining = resolve_one(
        &conn,
        "recent_expenses",
        json!({ "category": "Marmalade Dining", "months": 1 }),
    );
    assert_eq!(dining.rows.len(), 1);
    assert_eq!(dining.rows[0].label, "Bellwether Bistro");

    // A term that names no category shows nothing rather than everything under the wrong title.
    let nothing = resolve_one(&conn, "recent_expenses", json!({ "category": "car insurance" }));
    assert!(nothing.rows.is_empty());
}
