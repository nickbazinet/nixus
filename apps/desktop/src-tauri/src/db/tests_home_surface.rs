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

    let today = resolve_one(&conn, "current_date", json!({}));
    assert_eq!(today.rows.len(), 1);
    assert!(today.rows[0].values.is_empty(), "a date is not a figure");
    assert!(
        regex_matches_iso_date(&today.rows[0].label),
        "{}",
        today.rows[0].label
    );

    let recurring = resolve_one(&conn, "recurring_expenses", json!({}));
    assert_eq!(
        recurring.rows.len(),
        1,
        "only the active template, largest first"
    );
    assert_eq!(recurring.rows[0].label, "Umbraline Streaming");
    assert_eq!(recurring.rows[0].values, vec![219_958]);
}

fn regex_matches_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
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

/// The Sankey's source: one typical month of the window, as a graph of income into categories.
#[test]
fn the_cash_flow_averages_the_window_into_one_graph_of_links() {
    let (_dir, conn) = dataset();
    let profile = seed_known_profile(&conn);

    let flow = resolve_one(&conn, "average_monthly_cash_flow", json!({ "months": 3 }));
    assert_eq!(flow.dimension, "flow");
    assert_eq!(
        flow.detail_columns,
        vec!["flow_from", "flow_to", "flow_from_label", "flow_to_label"]
    );
    assert_eq!(flow.series, vec!["amount"]);

    // Every band is the 3-month total over 3, so the diagram reads as one typical month.
    let links: Vec<(&str, &str, i64)> = flow
        .rows
        .iter()
        .map(|row| {
            (
                row.details[0].as_str(),
                row.details[1].as_str(),
                row.values[0],
            )
        })
        .collect();
    let groceries = format!("cat:{}", profile.groceries_category_id);
    assert_eq!(
        links,
        vec![
            ("in:1", INCOME_NODE_KEY, 739_163 / 3),
            (INCOME_NODE_KEY, groceries.as_str(), (873_419 + 618_253) / 3),
            (
                INCOME_NODE_KEY,
                format!("cat:{}", profile.groceries_category_id + 1).as_str(),
                (259_377 + 147_389) / 3
            ),
        ]
    );

    // The seed spends more than it earns, so there is nothing left to draw as unspent.
    assert!(flow.rows.iter().all(|row| row.key != format!(
        "{INCOME_NODE_KEY}>{UNSPENT_NODE_KEY}"
    )));

    // An income source is the user's own record, so its label travels; the hub is named by the
    // renderer and travels empty.
    assert_eq!(flow.rows[0].details[2], "Gossamer Consulting");
    assert_eq!(flow.rows[0].details[3], "");
    assert_eq!(flow.rows[1].details[3], "Quixotic Groceries");

    let folded = resolve_one(
        &conn,
        "average_monthly_cash_flow",
        json!({ "months": 3, "limit": 1 }),
    );
    let rest = folded
        .rows
        .iter()
        .find(|row| row.details[1] == OTHER_ROW_KEY)
        .expect("the categories past the limit are folded, not dropped");
    assert_eq!(rest.values, vec![(259_377 + 147_389) / 3]);
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

#[test]
fn net_worth_assets_can_be_filtered_by_type_and_totalled_per_type() {
    let (_dir, conn) = dataset();
    conn.execute_batch(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES
           ('Acme Corp', 'stock', 500000), ('Globex', 'stock', 300000),
           ('Cottage', 'real_estate', 20000000), ('Civic', 'vehicle', 1500000);",
    )
    .unwrap();

    let all = resolve_one(&conn, "asset_values", json!({}));
    assert_eq!(all.rows.len(), 4);

    let portfolio = resolve_one(&conn, "asset_values", json!({ "asset_type": "stock" }));
    assert_eq!(
        portfolio.rows.iter().map(|r| r.label.as_str()).collect::<Vec<_>>(),
        vec!["Acme Corp", "Globex"]
    );

    let by_type = resolve_one(&conn, "asset_values_by_type", json!({}));
    assert_eq!(
        by_type.rows.iter().map(|r| (r.label.as_str(), r.values[0])).collect::<Vec<_>>(),
        vec![("Real estate", 20_000_000), ("Vehicles", 1_500_000), ("Stocks", 800_000)]
    );
}

fn keys_of(conn: &Connection) -> Vec<String> {
    list_widgets(conn)
        .unwrap()
        .into_iter()
        .map(|widget| widget.widget_key)
        .collect()
}

/// The load-bearing guarantee of the presentation layer: the Modify branch UPDATEs `spec_json`
/// alone, so the user's own choices survive an AI modify without that branch knowing they exist.
#[test]
fn an_ai_modify_preserves_the_users_presentation_choices() {
    let (_dir, conn) = dataset();
    add(
        &conn,
        widget("Trend", "LineChart", "net_worth_history", json!({})),
    );
    let key = keys_of(&conn).remove(0);

    for update in [
        PresentationUpdate::Title(Some("My money".to_string())),
        PresentationUpdate::Span(2),
        PresentationUpdate::Accent(Some(5)),
    ] {
        set_presentation(&conn, &key, &update).expect("a presentation write");
    }

    apply_change(
        &conn,
        &SurfaceChange::Modify {
            widget_id: key.clone(),
            widget: widget(
                "Trend",
                "BarChart",
                "net_worth_history",
                json!({ "months": 6 }),
            ),
        },
    )
    .expect("modify applies");

    let after = list_widgets(&conn).unwrap().remove(0);
    assert!(
        after.spec_json.contains("BarChart"),
        "the AI-owned half did change"
    );
    assert_eq!(after.title_override.as_deref(), Some("My money"));
    assert_eq!(after.span, 2);
    assert_eq!(after.accent, Some(5));

    let resolved = resolve_surface(&conn).unwrap().remove(0);
    assert_eq!(resolved.title, "My money");
    assert_eq!(resolved.title_override.as_deref(), Some("My money"));
    assert_eq!((resolved.span, resolved.accent), (2, Some(5)));
}

#[test]
fn the_effective_title_is_the_override_and_falls_back_when_it_is_absent_or_blank() {
    let (_dir, conn) = dataset();
    add(
        &conn,
        widget("Spec Title", "Metric", "account_balances", json!({})),
    );
    let key = keys_of(&conn).remove(0);

    let title = |conn: &Connection| resolve_surface(conn).unwrap().remove(0).title;
    assert_eq!(title(&conn), "Spec Title");

    set_presentation(
        &conn,
        &key,
        &PresentationUpdate::Title(Some("Renamed".to_string())),
    )
    .expect("a rename");
    assert_eq!(title(&conn), "Renamed");

    // A row synced from a build that stored whitespace must not render a nameless card.
    conn.execute(
        "UPDATE home_widgets SET title_override = '   ' WHERE widget_key = ?1",
        params![key],
    )
    .unwrap();
    assert_eq!(title(&conn), "Spec Title");

    set_presentation(&conn, &key, &PresentationUpdate::Title(None)).expect("the override clears");
    assert_eq!(title(&conn), "Spec Title");
    assert!(resolve_surface(&conn).unwrap()[0].title_override.is_none());
}

#[test]
fn reordering_refuses_anything_that_is_not_a_permutation_and_writes_nothing() {
    let (_dir, conn) = dataset();
    add(&conn, widget("A", "Metric", "account_balances", json!({})));
    add(&conn, widget("B", "Table", "asset_values", json!({})));
    let before = list_widgets(&conn).unwrap();
    let keys = keys_of(&conn);

    for submitted in [
        Vec::new(),
        vec![keys[0].clone()],
        vec![keys[0].clone(), keys[0].clone()],
        vec![keys[0].clone(), "w_notawidget".to_string()],
        vec![keys[0].clone(), keys[1].clone(), keys[0].clone()],
    ] {
        match reorder_widgets(&conn, &submitted) {
            Err(AppError::Validation { field, .. }) => {
                assert_eq!(field.as_deref(), Some("widget_ids"))
            }
            other => panic!("expected a refusal for {submitted:?}, got {other:?}"),
        }
    }

    let after = list_widgets(&conn).unwrap();
    for (old, new) in before.iter().zip(&after) {
        assert_eq!(old.position, new.position);
        assert_eq!(old.updated_at, new.updated_at);
    }
}

#[test]
fn a_valid_permutation_changes_the_order_widgets_come_back_in() {
    let (_dir, conn) = dataset();
    add(&conn, widget("A", "Metric", "account_balances", json!({})));
    add(&conn, widget("B", "Table", "asset_values", json!({})));
    add(
        &conn,
        widget("C", "PieChart", "expenses_by_category", json!({})),
    );
    let keys = keys_of(&conn);

    // An add starts positions at 1, so submitting the current order already rewrites all three.
    // Normalising first is what leaves an untouched middle row to assert on below.
    reorder_widgets(&conn, &keys).expect("the current order applies");

    let swapped = vec![keys[2].clone(), keys[1].clone(), keys[0].clone()];
    let changes = reorder_widgets(&conn, &swapped).expect("a permutation applies");

    assert_eq!(keys_of(&conn), swapped);
    assert_eq!(
        resolve_surface(&conn)
            .unwrap()
            .iter()
            .map(|w| w.title.clone())
            .collect::<Vec<_>>(),
        vec!["C", "B", "A"]
    );
    assert_eq!(
        changes.len(),
        2,
        "only the rows whose slot moved are reported"
    );
}
