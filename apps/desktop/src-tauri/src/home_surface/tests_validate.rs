use serde_json::{json, Value};

use super::*;

fn line_chart(source: &str, params: Value) -> Value {
    json!({
        "component": "LineChart",
        "title": "Net Worth, Last 6 Months",
        "dataBinding": { "source": source, "params": params }
    })
}

fn summary(key: &str, title: &str) -> WidgetSummary {
    WidgetSummary {
        widget_key: key.to_string(),
        spec: json!({
            "component": "Metric",
            "title": title,
            "dataBinding": { "source": "account_balances", "params": {} }
        }),
    }
}

fn errors_of(result: Result<Value, Vec<String>>) -> String {
    result.expect_err("validation must fail").join("\n")
}

/// FR-1: every display component, bound to a source it can show, passes.
#[test]
fn every_display_component_with_a_valid_binding_passes() {
    for (component, source) in [
        ("Metric", "account_balances"),
        ("LineChart", "net_worth_history"),
        ("BarChart", "expenses_by_month"),
        ("AreaChart", "income_vs_expense_by_month"),
        ("PieChart", "expenses_by_category"),
        ("Table", "budget_vs_actual_by_category"),
        ("BarChart", "asset_values"),
    ] {
        let widget = json!({
            "component": component,
            "title": "A widget",
            "dataBinding": { "source": source }
        });
        assert!(validate_widget(&widget).is_ok(), "{component} on {source}");
    }
}

/// FR-1: a name outside the catalog never passes.
#[test]
fn a_component_outside_the_catalog_fails() {
    for name in ["Donut", "PieChart/Donut", "Html", "Script", "linechart"] {
        let widget = json!({
            "component": name,
            "title": "x",
            "dataBinding": { "source": "account_balances" }
        });
        assert!(
            errors_of(validate_widget(&widget)).contains("not in the component catalog"),
            "{name}"
        );
    }
}

/// FR-2: layout primitives nest around display components and are kept in that arrangement.
#[test]
fn nested_layout_primitives_are_preserved_in_order() {
    let widget = json!({
        "component": "Card",
        "title": "Cash flow",
        "children": [{
            "component": "Row",
            "children": [
                { "component": "Metric", "dataBinding": { "source": "expenses_by_month" } },
                {
                    "component": "Grid",
                    "columns": 2,
                    "children": [
                        { "component": "BarChart", "dataBinding": { "source": "income_vs_expense_by_month" } }
                    ]
                }
            ]
        }]
    });

    let canonical = validate_widget(&widget).expect("valid nesting");
    assert_eq!(canonical["component"], "Card");
    assert_eq!(canonical["children"][0]["component"], "Row");
    assert_eq!(
        canonical["children"][0]["children"][0]["component"],
        "Metric"
    );
    assert_eq!(canonical["children"][0]["children"][1]["component"], "Grid");
    assert_eq!(canonical["children"][0]["children"][1]["columns"], 2);
    assert_eq!(
        canonical["children"][0]["children"][1]["children"][0]["component"],
        "BarChart"
    );
}

/// FR-2: a layout primitive is structural only.
#[test]
fn a_layout_primitive_carrying_a_binding_fails() {
    let widget = json!({
        "component": "Card",
        "title": "x",
        "dataBinding": { "source": "account_balances" },
        "children": [{ "component": "Metric", "dataBinding": { "source": "account_balances" } }]
    });
    assert!(errors_of(validate_widget(&widget)).contains("cannot carry a dataBinding"));
}

/// FR-3: a source outside the whitelist never passes, and neither does a Car-module one.
#[test]
fn a_source_outside_the_whitelist_fails() {
    for source in ["vehicle_maintenance", "raw_sql", "expenses", ""] {
        assert!(
            errors_of(validate_widget(&line_chart(source, json!({}))))
                .contains("dataBinding.source"),
            "{source}"
        );
    }
}

/// FR-3: no literal data value in a data-bearing field — neither inside the binding nor beside it.
#[test]
fn a_literal_value_in_a_data_bearing_field_fails() {
    let in_params = line_chart("net_worth_history", json!({ "values": [4210000, 4300000] }));
    assert!(errors_of(validate_widget(&in_params)).contains("literal data values are not allowed"));

    let beside_binding = json!({
        "component": "Metric",
        "title": "Net worth",
        "value": 4210000,
        "dataBinding": { "source": "net_worth_history" }
    });
    assert!(
        errors_of(validate_widget(&beside_binding)).contains("literal data values are not allowed")
    );

    let in_binding = json!({
        "component": "Metric",
        "title": "Net worth",
        "dataBinding": { "source": "net_worth_history", "data": [1, 2, 3] }
    });
    assert!(errors_of(validate_widget(&in_binding)).contains("literal data values are not allowed"));

    let string_param = line_chart("net_worth_history", json!({ "months": "$42,100" }));
    assert!(errors_of(validate_widget(&string_param)).contains("must be an integer between"));
}

/// FR-3 assumption: the free-text title is exempt from the literal-value rule.
#[test]
fn a_number_in_the_free_text_title_is_allowed() {
    let widget = json!({
        "component": "BarChart",
        "title": "Dining Spend vs. $500 Budget",
        "dataBinding": { "source": "budget_vs_actual_by_category" }
    });
    let canonical = validate_widget(&widget).expect("titles are free text");
    assert_eq!(canonical["title"], "Dining Spend vs. $500 Budget");
}

#[test]
fn parameters_are_bounded_and_defaults_are_made_explicit() {
    assert!(errors_of(validate_widget(&line_chart(
        "net_worth_history",
        json!({ "months": 0 })
    )))
    .contains("between 1 and 120"));
    assert!(errors_of(validate_widget(&line_chart(
        "net_worth_history",
        json!({ "months": 6.5 })
    )))
    .contains("must be an integer"));

    let canonical = validate_widget(&line_chart("net_worth_history", json!({}))).expect("valid");
    assert_eq!(canonical["dataBinding"]["params"]["months"], 12);
}

#[test]
fn a_chart_that_cannot_show_its_source_shape_fails() {
    let pie_over_time = json!({
        "component": "PieChart",
        "title": "x",
        "dataBinding": { "source": "net_worth_history" }
    });
    assert!(errors_of(validate_widget(&pie_over_time)).contains("needs a categorical source"));

    let line_over_categories = line_chart("account_balances", json!({}));
    assert!(errors_of(validate_widget(&line_over_categories)).contains("monthly (time series)"));
}

#[test]
fn the_root_widget_needs_a_title_and_a_display_component() {
    let untitled = json!({ "component": "Metric", "dataBinding": { "source": "asset_values" } });
    assert!(errors_of(validate_widget(&untitled)).contains("widget.title is required"));

    let too_deep = json!({
        "component": "Card", "title": "x",
        "children": [{ "component": "Row", "children": [{ "component": "Column",
            "children": [{ "component": "Grid",
                "children": [{ "component": "Metric", "dataBinding": { "source": "asset_values" } }] }] }] }]
    });
    assert!(errors_of(validate_widget(&too_deep)).contains("nest at most"));

    let crowded = json!({
        "component": "Grid", "title": "x", "children": [
            { "component": "Metric", "dataBinding": { "source": "asset_values" } },
            { "component": "Metric", "dataBinding": { "source": "asset_values" } },
            { "component": "Metric", "dataBinding": { "source": "asset_values" } },
            { "component": "Metric", "dataBinding": { "source": "asset_values" } },
            { "component": "Metric", "dataBinding": { "source": "asset_values" } }
        ]
    });
    assert!(errors_of(validate_widget(&crowded)).contains("children must be an array of 1 to 4"));
}

/// FR-2 NFR: a change that would exceed twelve widgets is a validation failure.
#[test]
fn adding_past_the_cap_fails_with_a_specific_error() {
    let full: Vec<WidgetSummary> = (0..MAX_WIDGETS)
        .map(|i| summary(&format!("w{i}"), &format!("Widget {i}")))
        .collect();
    let add = json!({ "op": "add", "widget": line_chart("net_worth_history", json!({})) });

    let errors = validate_proposal(&add, &full).expect_err("the cap is enforced");
    assert!(errors.join(" ").contains("too many widgets"));

    let errors = validate_change(&add, &full).expect_err("and re-enforced at confirm time");
    assert!(errors.join(" ").contains("too many widgets"));

    assert!(validate_proposal(&add, &full[..MAX_WIDGETS - 1]).is_ok());
}

#[test]
fn a_modify_must_name_a_current_widget_and_keeps_that_id() {
    let current = vec![summary("w_keep", "Balances")];
    let modify = json!({
        "op": "modify",
        "widget_id": "w_keep",
        "widget": { "component": "BarChart", "title": "Balances", "dataBinding": { "source": "account_balances" } }
    });
    match validate_proposal(&modify, &current).expect("valid modify") {
        Proposal::Change(SurfaceChange::Modify { widget_id, widget }) => {
            assert_eq!(widget_id, "w_keep");
            assert_eq!(widget["component"], "BarChart");
        }
        other => panic!("expected a modify, got {other:?}"),
    }

    let unknown = json!({ "op": "modify", "widget_id": "w_gone", "widget": modify["widget"] });
    assert!(validate_proposal(&unknown, &current).is_err());
}

/// FR-6: removal is resolved app-side, and only a single match becomes a change.
#[test]
fn a_removal_resolves_to_one_widget_or_to_a_question() {
    let current = vec![
        summary("w1", "Spending by Category"),
        summary("w2", "Spending by Month"),
        summary("w3", "Net Worth"),
    ];

    assert_eq!(
        validate_proposal(&json!({ "op": "remove", "target": "net worth" }), &current).unwrap(),
        Proposal::Change(SurfaceChange::Remove {
            widget_id: "w3".to_string(),
            title: "Net Worth".to_string()
        })
    );
    assert_eq!(
        validate_proposal(
            &json!({ "op": "remove", "target": "the spending one" }),
            &current
        )
        .unwrap(),
        Proposal::Ambiguous(vec![
            "Spending by Category".to_string(),
            "Spending by Month".to_string()
        ])
    );
    assert!(matches!(
        validate_proposal(&json!({ "op": "remove", "target": "the car one" }), &current).unwrap(),
        Proposal::NoMatch(titles) if titles.len() == 3
    ));
}

#[test]
fn the_confirmed_params_are_revalidated_and_unknown_ops_refused() {
    let current = vec![summary("w1", "Balances")];

    let remove = validate_change(
        &json!({ "op": "remove", "widget_id": "w1", "title": "edited" }),
        &current,
    )
    .expect("valid removal");
    assert_eq!(
        remove,
        SurfaceChange::Remove {
            widget_id: "w1".to_string(),
            title: "Balances".to_string()
        },
        "the stored title wins over the card's"
    );

    assert!(validate_change(&json!({ "op": "remove", "widget_id": "w9" }), &current).is_err());
    assert!(validate_change(&json!({ "op": "drop_table" }), &current).is_err());
    assert!(validate_change(&json!({ "op": "message", "text": "hi" }), &current).is_err());
}

#[test]
fn a_message_turn_is_accepted_and_bounded() {
    let long = "x".repeat(MAX_MESSAGE_CHARS + 50);
    match validate_proposal(&json!({ "op": "message", "text": long }), &[]).unwrap() {
        Proposal::Message(text) => assert_eq!(text.chars().count(), MAX_MESSAGE_CHARS),
        other => panic!("expected a message, got {other:?}"),
    }
    assert!(validate_proposal(&json!({ "op": "shout" }), &[]).is_err());
    assert!(validate_proposal(&json!([1, 2]), &[]).is_err());
}

/// "A table of my last 10 expenses": the transaction list is a Table-only source, and its limit is
/// bounded like any other parameter.
#[test]
fn recent_expenses_is_table_only_and_bounded() {
    let table = json!({
        "component": "Table",
        "title": "Last 10 Expenses",
        "dataBinding": { "source": "recent_expenses", "params": { "limit": 10 } }
    });
    let canonical = validate_widget(&table).expect("a table of recent expenses is valid");
    assert_eq!(canonical["dataBinding"]["params"]["limit"], 10);

    for component in ["BarChart", "Metric", "PieChart", "LineChart"] {
        let chart = json!({
            "component": component,
            "title": "x",
            "dataBinding": { "source": "recent_expenses" }
        });
        assert!(
            errors_of(validate_widget(&chart)).contains("can only be shown in a Table"),
            "{component}"
        );
    }

    let too_many = json!({
        "component": "Table",
        "title": "x",
        "dataBinding": { "source": "recent_expenses", "params": { "limit": 500 } }
    });
    assert!(errors_of(validate_widget(&too_many)).contains("between 1 and 50"));
}

#[test]
fn any_window_and_a_category_in_words_are_accepted_but_never_a_figure() {
    let widget = |params: Value| {
        json!({
            "component": "BarChart",
            "title": "Groceries, Last 3 Months",
            "dataBinding": { "source": "expenses_by_month", "params": params }
        })
    };

    let canonical = validate_widget(&widget(json!({ "months": 3, "months_ago": 1, "category": " groceries " })))
        .expect("a past window narrowed to a category is valid");
    assert_eq!(canonical["dataBinding"]["params"]["months_ago"], 1);
    assert_eq!(canonical["dataBinding"]["params"]["category"], "groceries");

    let unfiltered = validate_widget(&widget(json!({}))).unwrap();
    assert!(unfiltered["dataBinding"]["params"].get("category").is_none(), "omitted means all");

    for smuggled in [json!("$4,210"), json!("groceries 4210"), json!(4210), json!("")] {
        assert!(
            errors_of(validate_widget(&widget(json!({ "category": smuggled })))).contains("no numbers"),
            "{smuggled}"
        );
    }

    let not_for_income = json!({
        "component": "BarChart",
        "title": "x",
        "dataBinding": { "source": "income_vs_expense_by_month", "params": { "category": "groceries" } }
    });
    assert!(errors_of(validate_widget(&not_for_income)).contains("is not a parameter of"));
}
