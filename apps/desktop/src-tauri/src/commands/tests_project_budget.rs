//! A savings project's budget line, end to end against a real migrated dataset: the commands that
//! link and unlink it, the figures every budget surface reads for it, the guards that keep it from
//! being treated as an expense category, and its lifecycle with the project.

use chrono::NaiveDate;
use rusqlite::params;
use tempfile::TempDir;

use super::*;
use crate::db::budget_template as budget_template_db;
use crate::db::dashboard as dashboard_db;
use crate::db::expense as expense_db;
use crate::db::recurring as recurring_db;
use crate::db::test_dataset::migrated_dataset;
use crate::models::{
    CreateExpenseInput, CreateRecurringExpenseTemplateInput, RecurrenceFrequency,
    UpdateExpenseInput, UpdateRecurringExpenseTemplateInput,
};

const GROUP_NAME: &str = "Projects";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, 10).expect("a valid date")
}

fn dataset() -> (TempDir, ActiveDataset) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));
    conn.execute_batch(
        "INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
             VALUES (1, 'Savings', 'Tangerine', 'savings', 'CAD', 1000000);
         INSERT INTO budget_groups (id, name, sort_order) VALUES (1, 'Needs', 0);
         INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
             VALUES (1, 1, 'Groceries', 50000, 0);
         INSERT INTO projects (id, name, target_cents, target_date, priority)
             VALUES (1, 'GLI Summer Tire', 120000, '2027-05-01', 0),
                    (2, 'Rainy day', 500000, NULL, 1);",
    )
    .expect("seed");

    (
        dir,
        ActiveDataset {
            id: Some("project-budget-test".to_string()),
            conn: Some(conn),
            capture: None,
        },
    )
}

fn conn(active: &ActiveDataset) -> &Connection {
    active.conn.as_ref().expect("a selected dataset")
}

fn contribute(active: &ActiveDataset, project_id: i64, amount_cents: i64, date: &str) {
    conn(active)
        .execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date)
             VALUES (?1, 1, ?2, 'manual', ?3)",
            params![project_id, amount_cents, date],
        )
        .expect("contribution");
}

fn add(active: &ActiveDataset, project_id: i64, monthly_cents: Option<i64>) -> Result<ProjectBudgetLink, AppError> {
    add_project_to_budget_inner(active, project_id, GROUP_NAME, monthly_cents, today())
}

fn linked_status(active: &ActiveDataset, year: i32, month: i32, category_id: i64) -> BudgetCategoryStatus {
    budget_db::get_budget_status(conn(active), year, month)
        .expect("status")
        .into_iter()
        .find(|status| status.id == category_id)
        .expect("the linked row is listed")
}

fn validation_field(result: Result<impl std::fmt::Debug, AppError>) -> Option<String> {
    match result {
        Err(AppError::Validation { field, .. }) => field,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

fn audit_actions(active: &ActiveDataset, project_id: i64) -> Vec<String> {
    let mut stmt = conn(active)
        .prepare(
            "SELECT action FROM audit_log WHERE entity_type = 'project' AND entity_id = ?1
             ORDER BY id",
        )
        .expect("prepare");
    stmt.query_map(params![project_id], |row| row.get(0))
        .expect("query")
        .collect::<Result<Vec<String>, _>>()
        .expect("rows")
}

// ---------------------------------------------------------------------------
// Linking and unlinking
// ---------------------------------------------------------------------------

#[test]
fn adding_a_dated_project_creates_the_projects_group_and_a_linked_line() {
    let (_dir, active) = dataset();
    contribute(&active, 1, 20_000, "2026-10-15");

    let link = add(&active, 1, Some(99_999)).expect("linked");

    // 100_000 still missing on Nov 1, six months to May 1; the offered amount is ignored.
    assert_eq!(link.month_target_cents, 16_667);
    assert_eq!(link.set_aside_cents, 0);

    let group = budget_db::get_budget_groups(conn(&active))
        .expect("groups")
        .into_iter()
        .find(|group| group.id == link.group_id)
        .expect("the group exists");
    assert_eq!(group.name, GROUP_NAME);

    let category = budget_db::get_budget_categories_by_group(conn(&active), link.group_id)
        .expect("categories")
        .into_iter()
        .next()
        .expect("one line");
    assert_eq!(category.id, link.category_id);
    assert_eq!(category.name, "GLI Summer Tire");
    assert_eq!(category.project_id, Some(1));
    assert_eq!(category.target_cents, 16_667, "the snapshot is the computed value");

    assert_eq!(audit_actions(&active, 1), vec!["budget_link"]);
}

#[test]
fn the_group_setting_holds_the_groups_sync_uuid_not_its_local_id() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");

    let stored = crate::db::config::get(conn(&active), projects_db::PROJECTS_BUDGET_GROUP_CONFIG_KEY)
        .expect("the key is written");
    let parsed = uuid::Uuid::parse_str(&stored).expect("a uuid");
    let resolved = crate::db::sync_identity::row_id_for(conn(&active), "budget_groups", parsed.as_bytes())
        .expect("lookup");

    assert_eq!(resolved, Some(link.group_id));
    assert_ne!(stored, link.group_id.to_string());
}

#[test]
fn an_undated_project_needs_a_positive_monthly_amount() {
    let (_dir, active) = dataset();

    assert_eq!(validation_field(add(&active, 2, None)).as_deref(), Some("monthly_cents"));
    assert_eq!(validation_field(add(&active, 2, Some(0))).as_deref(), Some("monthly_cents"));
    assert!(
        budget_db::get_active_linked_category_ids(conn(&active), 2).expect("ids").is_empty(),
        "a refused add writes nothing"
    );

    let link = add(&active, 2, Some(25_000)).expect("linked");
    assert_eq!(link.month_target_cents, 25_000);
}

#[test]
fn a_project_can_be_linked_only_once_and_only_while_active() {
    let (_dir, active) = dataset();
    add(&active, 1, None).expect("linked");

    assert_eq!(validation_field(add(&active, 1, None)).as_deref(), Some("project_id"));

    conn(&active)
        .execute("UPDATE projects SET archived_at = datetime('now') WHERE id = 2", [])
        .expect("archive");
    assert_eq!(validation_field(add(&active, 2, Some(1_000))).as_deref(), Some("project_id"));
    assert_eq!(validation_field(add(&active, 404, Some(1_000))).as_deref(), Some("project_id"));
}

#[test]
fn a_second_project_joins_the_same_group() {
    let (_dir, active) = dataset();
    let first = add(&active, 1, None).expect("first");
    let second = add(&active, 2, Some(10_000)).expect("second");

    assert_eq!(first.group_id, second.group_id);
}

#[test]
fn a_deleted_projects_group_is_recreated_on_the_next_add() {
    let (_dir, active) = dataset();
    let first = add(&active, 1, None).expect("linked");
    let first_setting =
        crate::db::config::get(conn(&active), projects_db::PROJECTS_BUDGET_GROUP_CONFIG_KEY);

    remove_project_from_budget_inner(&active, 1).expect("unlinked");
    active
        .write(|tx| budget_db::delete_budget_group(tx, first.group_id))
        .expect("group deleted");

    let second = add(&active, 1, None).expect("linked again");

    assert_ne!(second.group_id, first.group_id);
    assert_ne!(
        crate::db::config::get(conn(&active), projects_db::PROJECTS_BUDGET_GROUP_CONFIG_KEY),
        first_setting,
        "the setting now names the new group"
    );
}

#[test]
fn removing_a_project_ends_the_link_and_keeps_the_project_and_its_money() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    contribute(&active, 1, 5_000, "2026-11-12");

    remove_project_from_budget_inner(&active, 1).expect("unlinked");

    assert!(budget_db::get_active_linked_category_ids(conn(&active), 1).expect("ids").is_empty());
    assert!(project_budget_links_for(conn(&active), today()).expect("links").is_empty());
    assert!(projects_db::get_project_by_id(conn(&active), 1).expect("project").archived_at.is_none());
    assert_eq!(projects_db::get_project_saved_cents(conn(&active), 1).expect("saved"), 5_000);

    // The removed line still renders for the month that has money set aside on it.
    let removed = linked_status(&active, 2026, 11, link.category_id);
    assert!(removed.is_deleted);
    assert_eq!(removed.spent_cents, 5_000);
    assert!(budget_db::get_budget_status(conn(&active), 2026, 12)
        .expect("status")
        .iter()
        .all(|status| status.id != link.category_id));

    assert_eq!(validation_field(remove_project_from_budget_inner(&active, 1)).as_deref(), Some("project_id"));
    assert_eq!(audit_actions(&active, 1), vec!["budget_link", "budget_unlink"]);
}

#[test]
fn links_are_reported_once_per_project_even_when_duplicated_by_sync() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    conn(&active)
        .execute(
            "INSERT INTO budget_categories (group_id, name, target_cents, project_id)
             VALUES (?1, 'GLI Summer Tire', 1, 1)",
            params![link.group_id],
        )
        .expect("a duplicate arriving through sync");

    let links = project_budget_links_for(conn(&active), today()).expect("links");

    assert_eq!(links.len(), 1);
    assert_eq!(links[0].category_id, link.category_id, "the lowest id is the link");
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

#[test]
fn a_dated_line_shows_a_fixed_monthly_target_and_the_months_contributions() {
    let (_dir, active) = dataset();
    contribute(&active, 1, 20_000, "2026-10-15");
    let link = add(&active, 1, None).expect("linked");
    contribute(&active, 1, 5_000, "2026-11-03");
    contribute(&active, 1, 7_000, "2026-12-20");

    let november = linked_status(&active, 2026, 11, link.category_id);
    assert_eq!(november.project_id, Some(1));
    assert_eq!(november.target_cents, 16_667, "a mid-month contribution does not move the target");
    assert_eq!(november.spent_cents, 5_000);

    // 25_000 saved before Dec 1, 95_000 left over five months.
    let december = linked_status(&active, 2026, 12, link.category_id);
    assert_eq!(december.target_cents, 19_000);
    assert_eq!(december.spent_cents, 7_000);

    let groceries = linked_status(&active, 2026, 11, 1);
    assert_eq!((groceries.target_cents, groceries.spent_cents), (50_000, 0));
}

#[test]
fn a_reached_goal_commits_nothing() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    contribute(&active, 1, 120_000, "2026-11-05");

    assert_eq!(linked_status(&active, 2026, 12, link.category_id).target_cents, 0);
}

#[test]
fn an_undated_line_uses_its_editable_amount() {
    let (_dir, active) = dataset();
    let link = add(&active, 2, Some(25_000)).expect("linked");

    active
        .write(|tx| budget_db::update_budget_category(tx, link.category_id, None, Some(30_000)))
        .expect("an undated amount is editable");

    assert_eq!(linked_status(&active, 2026, 11, link.category_id).target_cents, 30_000);
}

#[test]
fn the_summary_counts_set_aside_money_toward_the_line_and_never_as_spent() {
    let (_dir, active) = dataset();
    contribute(&active, 1, 20_000, "2026-10-15");
    add(&active, 1, None).expect("linked");
    contribute(&active, 1, 5_000, "2026-11-03");
    conn(&active)
        .execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
             VALUES ('Metro', 10000, 1, '2026-11-04')",
            [],
        )
        .expect("expense");

    let summary = dashboard_db::get_budget_summary(conn(&active), 2026, 11).expect("summary");

    assert_eq!(summary.total_target_cents, 50_000 + 16_667);
    assert_eq!(summary.total_spent_cents, 10_000);
    assert_eq!(summary.remaining_cents, (50_000 - 10_000) + (16_667 - 5_000));
}

#[test]
fn setting_aside_more_than_planned_frees_nothing_for_other_categories() {
    let (_dir, active) = dataset();
    add(&active, 2, Some(10_000)).expect("linked");
    contribute(&active, 2, 40_000, "2026-11-03");

    let summary = dashboard_db::get_budget_summary(conn(&active), 2026, 11).expect("summary");

    assert_eq!(summary.remaining_cents, 50_000);
}

#[test]
fn spending_views_and_template_export_leave_savings_lines_out() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    contribute(&active, 1, 50_000, "2026-11-03");

    let top = dashboard_db::get_top_budget_categories(conn(&active), 2026, 11, 10).expect("top");
    assert!(top.iter().all(|category| category.id != link.category_id));

    let targets = crate::db::spending_trends::get_category_targets(conn(&active)).expect("targets");
    assert!(!targets.contains_key(&link.category_id));
    assert!(targets.contains_key(&1));

    let exported = budget_template_db::build_budget_template_export_json(conn(&active)).expect("export");
    assert!(!exported.contains("GLI Summer Tire"));
    assert!(!exported.contains(GROUP_NAME), "a group of savings lines only is not exported");
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

#[test]
fn an_expense_cannot_be_recorded_against_a_savings_line() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    let input = CreateExpenseInput {
        merchant: "Canadian Tire".to_string(),
        amount_cents: 1_000,
        budget_category_id: link.category_id,
        date: "2026-11-05".to_string(),
        account_id: None,
    };

    let created = active.write(|tx| expense_db::insert_expense(tx, &input));
    assert_eq!(validation_field(created).as_deref(), Some("budget_category_id"));

    let expense = active
        .write(|tx| expense_db::insert_expense(tx, &CreateExpenseInput { budget_category_id: 1, ..input.clone() }))
        .expect("a regular expense");
    let moved = active.write(|tx| {
        expense_db::update_expense(
            tx,
            expense.id,
            &UpdateExpenseInput {
                merchant: input.merchant.clone(),
                amount_cents: input.amount_cents,
                budget_category_id: link.category_id,
                date: input.date.clone(),
                account_id: None,
            },
        )
    });
    assert_eq!(validation_field(moved).as_deref(), Some("budget_category_id"));

    let imported = active.write(|tx| {
        expense_db::bulk_insert_imported_expenses(
            tx,
            &[
                ("Metro".to_string(), 500, 1, "2026-11-05".to_string()),
                ("Canadian Tire".to_string(), 500, link.category_id, "2026-11-05".to_string()),
            ],
        )
    });
    assert_eq!(validation_field(imported).as_deref(), Some("budget_category_id"));
    let expense_count: i64 = conn(&active)
        .query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
        .expect("count");
    assert_eq!(expense_count, 1, "a refused import writes no row");
}

#[test]
fn a_recurring_template_cannot_target_a_savings_line() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    let create = |budget_category_id| CreateRecurringExpenseTemplateInput {
        merchant: "Tire storage".to_string(),
        amount_cents: 2_000,
        budget_category_id,
        day_of_month: 5,
        frequency: RecurrenceFrequency::Monthly,
        start_date: None,
    };

    let created = active.write(|tx| recurring_db::insert_template(tx, &create(link.category_id)));
    assert_eq!(validation_field(created).as_deref(), Some("budget_category_id"));

    let missing = active.write(|tx| recurring_db::insert_template(tx, &create(404)));
    assert_eq!(validation_field(missing).as_deref(), Some("budget_category_id"));

    let template = active
        .write(|tx| recurring_db::insert_template(tx, &create(1)))
        .expect("a regular template");
    let moved = active.write(|tx| {
        recurring_db::update_template(
            tx,
            template.id,
            &UpdateRecurringExpenseTemplateInput {
                merchant: template.merchant.clone(),
                amount_cents: template.amount_cents,
                budget_category_id: link.category_id,
                day_of_month: 5,
                frequency: RecurrenceFrequency::Monthly,
                start_date: None,
                is_active: true,
            },
        )
    });
    assert_eq!(validation_field(moved).as_deref(), Some("budget_category_id"));
}

#[test]
fn a_template_pointing_at_a_savings_line_is_skipped_without_failing_the_batch() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");
    conn(&active)
        .execute_batch(&format!(
            "INSERT INTO recurring_expense_templates (merchant, amount_cents, budget_category_id, day_of_month)
                 VALUES ('Legacy', 2000, {}, 5), ('Netflix', 1500, 1, 5);",
            link.category_id
        ))
        .expect("templates");

    let created = active
        .write(|tx| recurring_db::apply_recurring_for_month(tx, 2026, 11))
        .expect("the batch succeeds");

    assert_eq!(created.len(), 1);
    assert_eq!(created[0].merchant, "Netflix");
}

#[test]
fn a_chat_action_cannot_resolve_a_savings_line_by_name() {
    let (_dir, active) = dataset();
    add(&active, 1, None).expect("linked");

    assert_eq!(
        budget_db::resolve_active_category_id_by_name(conn(&active), "GLI Summer Tire").expect("resolve"),
        budget_db::CategoryNameMatch::Missing
    );
}

#[test]
fn a_savings_line_cannot_be_renamed_and_a_dated_target_cannot_be_edited() {
    let (_dir, active) = dataset();
    let dated = add(&active, 1, None).expect("dated");
    let undated = add(&active, 2, Some(10_000)).expect("undated");

    let renamed = active.write(|tx| {
        budget_db::update_budget_category(tx, undated.category_id, Some("Other".to_string()), None)
    });
    assert_eq!(validation_field(renamed).as_deref(), Some("name"));

    let retargeted =
        active.write(|tx| budget_db::update_budget_category(tx, dated.category_id, None, Some(1_000)));
    assert_eq!(validation_field(retargeted).as_deref(), Some("target_cents"));

    active
        .write(|tx| budget_db::update_budget_category(tx, 1, Some("Food".to_string()), Some(60_000)))
        .expect("a regular category stays fully editable");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[test]
fn renaming_the_project_renames_its_line() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");

    update_project_inner(
        &active,
        1,
        &UpdateProjectInput {
            name: "  Winter tires  ".to_string(),
            target_cents: 120_000,
            target_date: Some("2027-05-01".to_string()),
            priority: Some(0),
            icon: None,
            color: None,
        },
    )
    .expect("renamed");

    assert_eq!(linked_status(&active, 2026, 11, link.category_id).name, "Winter tires");
}

#[test]
fn archiving_the_project_removes_its_line() {
    let (_dir, active) = dataset();
    let link = add(&active, 1, None).expect("linked");

    archive_project_inner(&active, 1).expect("archived");

    assert!(budget_db::get_active_linked_category_ids(conn(&active), 1).expect("ids").is_empty());
    assert!(budget_db::get_budget_status(conn(&active), 2026, 11)
        .expect("status")
        .iter()
        .all(|status| status.id != link.category_id));
    assert_eq!(audit_actions(&active, 1), vec!["budget_link", "archive", "budget_unlink"]);
}

#[test]
fn archiving_an_unbudgeted_project_writes_no_unlink() {
    let (_dir, active) = dataset();

    archive_project_inner(&active, 2).expect("archived");

    assert_eq!(audit_actions(&active, 2), vec!["archive"]);
}
