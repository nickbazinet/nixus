//! Per-agent static context, assembled from named providers.
//!
//! Each provider owns one section of the prompt's data block and is individually capped. An
//! agent's `AgentSpec::context` slice selects which sections it gets, and in what order — the
//! slice, not the enum below, is what pins prompt layout.
//!
//! Every provider swallows its own read errors and degrades to an absent (or empty-state)
//! section. That is deliberate and inherited: a failing section must never fail the turn.

use rusqlite::Connection;

use crate::db::account as account_db;
use crate::db::asset as asset_db;
use crate::db::budget as budget_db;
use crate::db::dashboard as dashboard_db;
use crate::db::income as income_db;
use crate::db::maintenance as maintenance_db;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextProviderId {
    BudgetSummary,
    BudgetGroups,
    BudgetCategories,
    Accounts,
    Assets,
    IncomeThisMonth,
    VehicleRoster,
}

/// The period every provider reads against, resolved once by the caller so two sections of one
/// prompt can never straddle a month boundary.
pub struct ProviderClock {
    pub year: i32,
    pub month: u32,
}

/// Row ceilings, per provider, as constants rather than configuration.
///
/// New behaviour: the underlying reads are unbounded, so without these every added agent and
/// every year of accumulated data silently inflates every prompt. The wording of the truncation
/// line matches the idiom `query_expenses` already uses, so the model's existing instruction to
/// "say the list may be incomplete" covers these too.
const BUDGET_GROUPS_CAP: usize = 30;
const BUDGET_CATEGORIES_CAP: usize = 100;
const ACCOUNTS_CAP: usize = 50;
const ASSETS_CAP: usize = 50;
const INCOME_CAP: usize = 50;
const VEHICLES_CAP: usize = 20;

fn truncation_note(cap: usize, total: usize) -> String {
    format!("  ... (showing first {cap} of {total}; the list may be incomplete)\n")
}

/// Appends the truncation line when `total` exceeded `cap`, and nothing otherwise.
fn note_truncation(out: &mut String, cap: usize, total: usize) {
    if total > cap {
        out.push_str(&truncation_note(cap, total));
    }
}

pub fn render(id: ContextProviderId, conn: &Connection, clock: &ProviderClock) -> String {
    match id {
        ContextProviderId::BudgetSummary => budget_summary(conn, clock),
        ContextProviderId::BudgetGroups => budget_groups(conn),
        ContextProviderId::BudgetCategories => budget_categories(conn, clock),
        ContextProviderId::Accounts => accounts(conn),
        ContextProviderId::Assets => assets(conn),
        ContextProviderId::IncomeThisMonth => income_this_month(conn, clock),
        ContextProviderId::VehicleRoster => vehicle_roster(conn),
    }
}

pub fn assemble(ids: &[ContextProviderId], conn: &Connection, clock: &ProviderClock) -> String {
    let mut out = String::new();
    for id in ids {
        out.push_str(&render(*id, conn, clock));
    }
    out
}

fn budget_summary(conn: &Connection, clock: &ProviderClock) -> String {
    match dashboard_db::get_budget_summary(conn, clock.year, clock.month as i32) {
        Ok(summary) => format!(
            "Budget Summary ({}-{:02}):\n  Total budget: {} cents\n  Total spent: {} cents\n  Remaining: {} cents\n\n",
            clock.year,
            clock.month,
            summary.total_target_cents,
            summary.total_spent_cents,
            summary.remaining_cents
        ),
        Err(_) => String::new(),
    }
}

/// Rendered before the categories so the model sees the groups a new category may be filed under.
/// `create_budget_category` requires an existing group name and never creates one, so an invented
/// name is a refused card.
fn budget_groups(conn: &Connection) -> String {
    let groups = budget_db::get_budget_groups(conn).unwrap_or_default();
    if groups.is_empty() {
        return "Budget Groups: none yet.\n\n".to_string();
    }

    let mut out = String::from("Budget Groups (the only valid group_name values):\n");
    for group in groups.iter().take(BUDGET_GROUPS_CAP) {
        out.push_str(&format!("  - {}\n", group.name));
    }
    note_truncation(&mut out, BUDGET_GROUPS_CAP, groups.len());
    out.push('\n');
    out
}

/// Re-reads the group list itself to resolve `group_id → name` rather than taking it as a
/// parameter, which is what keeps every provider's signature uniform. One extra cheap local query.
fn budget_categories(conn: &Connection, clock: &ProviderClock) -> String {
    let Ok(categories) = budget_db::get_budget_status(conn, clock.year, clock.month as i32) else {
        return String::new();
    };
    let groups = budget_db::get_budget_groups(conn).unwrap_or_default();

    let mut out = String::from("Budget Categories:\n");
    for cat in categories.iter().take(BUDGET_CATEGORIES_CAP) {
        let group_name = groups
            .iter()
            .find(|group| group.id == cat.group_id)
            .map(|group| group.name.as_str())
            .unwrap_or("unknown");
        if cat.project_id.is_some() {
            out.push_str(&format!(
                "  - {} (group: {}) (savings project, set aside {} of {} cents)\n",
                cat.name, group_name, cat.spent_cents, cat.target_cents
            ));
        } else {
            out.push_str(&format!(
                "  - {} (group: {}): target {} cents, spent {} cents\n",
                cat.name, group_name, cat.target_cents, cat.spent_cents
            ));
        }
    }
    note_truncation(&mut out, BUDGET_CATEGORIES_CAP, categories.len());
    out.push('\n');
    out
}

fn accounts(conn: &Connection) -> String {
    let Ok(accounts) = account_db::get_all_accounts(conn) else {
        return String::new();
    };

    let mut out = String::from("Accounts:\n");
    for acc in accounts.iter().take(ACCOUNTS_CAP) {
        out.push_str(&format!(
            "  - {} ({}, {}): {} cents\n",
            acc.name, acc.institution, acc.account_type, acc.balance_cents
        ));
    }
    note_truncation(&mut out, ACCOUNTS_CAP, accounts.len());
    out.push('\n');
    out
}

fn assets(conn: &Connection) -> String {
    let Ok(assets) = asset_db::get_all_assets(conn) else {
        return String::new();
    };

    let mut out = String::from("Assets:\n");
    for asset in assets.iter().take(ASSETS_CAP) {
        out.push_str(&format!(
            "  - {} ({}): {} cents\n",
            asset.name, asset.asset_type, asset.value_cents
        ));
    }
    note_truncation(&mut out, ASSETS_CAP, assets.len());
    out.push('\n');
    out
}

fn income_this_month(conn: &Connection, clock: &ProviderClock) -> String {
    let entries = income_db::get_income_entries_by_month(conn, clock.year, clock.month)
        .unwrap_or_default();
    if entries.is_empty() {
        return "No income recorded for the current month.\n\n".to_string();
    }

    let mut out = String::from("Income this month:\n");
    for entry in entries.iter().take(INCOME_CAP) {
        out.push_str(&format!(
            "  - {} ({}): ${:.2}\n",
            entry.source_name,
            entry.income_type,
            entry.amount_cents as f64 / 100.0
        ));
    }
    note_truncation(&mut out, INCOME_CAP, entries.len());
    // The total is read separately and covers the whole month, so it stays correct under
    // truncation — which is exactly why it is worth keeping when the row list is cut.
    if let Ok(total) = income_db::get_income_total(conn, clock.year, clock.month) {
        out.push_str(&format!(
            "Total income: ${:.2}\n",
            total.total_cents as f64 / 100.0
        ));
    }
    out.push('\n');
    out
}

/// How one roster row is laid out, as the maintenance prompt describes it to the model.
///
/// Declared beside the code that emits the row so the instruction and the data cannot drift: the
/// agent is told to match against these parts, and a silent change here would have it matching
/// against parts that are no longer rendered.
pub const VEHICLE_ROSTER_SHAPE: &str = "nickname [year make model] (id=N, odometer=N km)";

/// The manufacturer's own description, in brackets after the nickname the user chose.
///
/// Both are needed to resolve how people actually refer to their cars: the nickname is what they
/// call it, and the year/make/model is what lets "vw", "the 2019" or a trim name like "GLI" land on
/// the right row. Omitted entirely when none of the three is recorded, so a bare nickname stays
/// exactly as it was.
fn manufacturer_label(vehicle: &crate::models::Vehicle) -> String {
    let parts: Vec<String> = [
        vehicle.year.map(|year| year.to_string()),
        vehicle.make.clone(),
        vehicle.model.clone(),
    ]
    .into_iter()
    .flatten()
    .filter(|part| !part.trim().is_empty())
    .collect();

    if parts.is_empty() {
        String::new()
    } else {
        format!(" [{}]", parts.join(" "))
    }
}

fn vehicle_roster(conn: &Connection) -> String {
    let Ok(vehicles) = maintenance_db::get_all_vehicles(conn) else {
        return String::new();
    };
    if vehicles.is_empty() {
        return "Maintenance Tracking: No vehicles registered.\n\n".to_string();
    }

    let alert_count = maintenance_db::get_maintenance_alert_summary(conn)
        .map(|s| s.total_alerts)
        .unwrap_or(0);

    let mut out = String::from("Maintenance Tracking:\n");
    out.push_str(&format!("  Vehicles: {}\n", vehicles.len()));
    if alert_count > 0 {
        out.push_str(&format!("  Alerts: {} tasks need attention\n", alert_count));
    } else {
        out.push_str("  Alerts: 0 tasks need attention\n");
    }
    out.push('\n');

    for vehicle in vehicles.iter().take(VEHICLES_CAP) {
        out.push_str(&format!(
            "  - {}{} (id={}, odometer={} km)\n",
            vehicle.nickname,
            manufacturer_label(vehicle),
            vehicle.id,
            vehicle.odometer_km
        ));
    }
    note_truncation(&mut out, VEHICLES_CAP, vehicles.len());
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    const ALL: &[ContextProviderId] = &[
        ContextProviderId::BudgetSummary,
        ContextProviderId::BudgetGroups,
        ContextProviderId::BudgetCategories,
        ContextProviderId::Accounts,
        ContextProviderId::Assets,
        ContextProviderId::IncomeThisMonth,
        ContextProviderId::VehicleRoster,
    ];

    fn clock() -> ProviderClock {
        ProviderClock {
            year: 2026,
            month: 3,
        }
    }

    fn empty_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        run_migrations(&conn).expect("migrate");
        conn
    }

    fn seeded_db() -> Connection {
        let conn = empty_db();
        conn.execute_batch(
            "INSERT INTO budget_groups (id, name, sort_order) VALUES (1, 'Needs', 0), (2, 'Wants', 1);
             INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
               VALUES (1, 1, 'Groceries', 55000, 0), (2, 1, 'Rent', 165000, 1), (3, 2, 'Fun', 25000, 0);
             INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
               VALUES ('Metro', 5124, 1, '2026-03-04'), ('Landlord', 165000, 2, '2026-03-01');
             INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
               VALUES (1, 'Chequing', 'Tangerine', 'chequing', 'CAD', 250000),
                      (2, 'Visa', 'RBC', 'credit', 'CAD', -45000);
             INSERT INTO passive_assets (id, name, asset_type, value_cents)
               VALUES (1, 'Condo', 'real_estate', 42000000);
             INSERT INTO income_sources (id, name, income_type) VALUES (1, 'Salary', 'employment');
             INSERT INTO income_entries (source_id, amount_cents, month, date)
               VALUES (1, 480000, '2026-03', '2026-03-15');
             INSERT INTO vehicles (id, nickname, make, model, year, odometer_km)
               VALUES (1, 'Civic', 'Honda', 'Civic', 2019, 98000);",
        )
        .expect("seed");
        conn
    }

    /// The decomposition's regression guard.
    ///
    /// The literal below was captured from the pre-decomposition `build_context` running against
    /// this same fixture — equivalence with that implementation was asserted directly (both seeded
    /// and empty) while the providers were being extracted. This pins the result so a later edit
    /// to any one provider cannot quietly reshape Budget Helper's whole data block.
    const SEEDED_SNAPSHOT: &str = "Budget Summary (2026-03):\n  \
        Total budget: 245000 cents\n  Total spent: 170124 cents\n  Remaining: 74876 cents\n\n\
        Budget Groups (the only valid group_name values):\n  - Needs\n  - Wants\n\n\
        Budget Categories:\n  \
        - Groceries (group: Needs): target 55000 cents, spent 5124 cents\n  \
        - Rent (group: Needs): target 165000 cents, spent 165000 cents\n  \
        - Fun (group: Wants): target 25000 cents, spent 0 cents\n\n\
        Accounts:\n  - Chequing (Tangerine, chequing): 250000 cents\n  \
        - Visa (RBC, credit): -45000 cents\n\n\
        Assets:\n  - Condo (real_estate): 42000000 cents\n\n\
        Income this month:\n  - Salary (employment): $4800.00\nTotal income: $4800.00\n\n\
        Maintenance Tracking:\n  Vehicles: 1\n  Alerts: 0 tasks need attention\n\n  \
        - Civic [2019 Honda Civic] (id=1, odometer=98000 km)\n\n";

    #[test]
    fn the_assembled_context_matches_the_committed_snapshot() {
        assert_eq!(assemble(ALL, &seeded_db(), &clock()), SEEDED_SNAPSHOT);
    }

    #[test]
    fn sections_are_rendered_in_slice_order_not_declaration_order() {
        let conn = seeded_db();
        let reversed = assemble(
            &[ContextProviderId::Assets, ContextProviderId::Accounts],
            &conn,
            &clock(),
        );

        let assets_at = reversed.find("Assets:").expect("assets rendered");
        let accounts_at = reversed.find("Accounts:").expect("accounts rendered");
        assert!(assets_at < accounts_at);
    }

    #[test]
    fn an_empty_provider_slice_contributes_nothing() {
        assert_eq!(assemble(&[], &seeded_db(), &clock()), "");
    }

    #[test]
    fn every_empty_state_string_is_preserved_exactly() {
        let conn = empty_db();
        let c = clock();

        assert_eq!(
            render(ContextProviderId::BudgetGroups, &conn, &c),
            "Budget Groups: none yet.\n\n"
        );
        assert_eq!(
            render(ContextProviderId::IncomeThisMonth, &conn, &c),
            "No income recorded for the current month.\n\n"
        );
        assert_eq!(
            render(ContextProviderId::VehicleRoster, &conn, &c),
            "Maintenance Tracking: No vehicles registered.\n\n"
        );
        // These three keep a bare header with no rows, exactly as they always have.
        assert_eq!(
            render(ContextProviderId::BudgetCategories, &conn, &c),
            "Budget Categories:\n\n"
        );
        assert_eq!(render(ContextProviderId::Accounts, &conn, &c), "Accounts:\n\n");
        assert_eq!(render(ContextProviderId::Assets, &conn, &c), "Assets:\n\n");
        assert_eq!(
            render(ContextProviderId::BudgetSummary, &conn, &c),
            "Budget Summary (2026-03):\n  Total budget: 0 cents\n  Total spent: 0 cents\n  Remaining: 0 cents\n\n"
        );
    }

    fn rows(section: &str) -> usize {
        section
            .lines()
            .filter(|line| line.starts_with("  - "))
            .count()
    }

    /// Asserts a provider stops at its cap and says so in the exact agreed wording.
    fn assert_capped(section: &str, cap: usize, total: usize) {
        assert_eq!(rows(section), cap, "section: {section}");
        assert!(
            section.contains(&format!(
                "  ... (showing first {cap} of {total}; the list may be incomplete)\n"
            )),
            "section: {section}"
        );
    }

    #[test]
    fn budget_groups_truncates_at_its_cap() {
        let conn = empty_db();
        let total = BUDGET_GROUPS_CAP + 1;
        for i in 0..total {
            conn.execute(
                "INSERT INTO budget_groups (name, sort_order) VALUES (?1, ?2)",
                rusqlite::params![format!("Group {i:03}"), i as i64],
            )
            .expect("insert group");
        }

        assert_capped(
            &render(ContextProviderId::BudgetGroups, &conn, &clock()),
            BUDGET_GROUPS_CAP,
            total,
        );
    }

    #[test]
    fn budget_categories_truncates_at_its_cap() {
        let conn = empty_db();
        conn.execute("INSERT INTO budget_groups (id, name, sort_order) VALUES (1, 'G', 0)", [])
            .expect("insert group");
        let total = BUDGET_CATEGORIES_CAP + 1;
        for i in 0..total {
            conn.execute(
                "INSERT INTO budget_categories (group_id, name, target_cents, sort_order) VALUES (1, ?1, 100, ?2)",
                rusqlite::params![format!("Cat {i:03}"), i as i64],
            )
            .expect("insert category");
        }

        assert_capped(
            &render(ContextProviderId::BudgetCategories, &conn, &clock()),
            BUDGET_CATEGORIES_CAP,
            total,
        );
    }

    #[test]
    fn accounts_truncates_at_its_cap() {
        let conn = empty_db();
        let total = ACCOUNTS_CAP + 1;
        for i in 0..total {
            conn.execute(
                "INSERT INTO accounts (name, institution, account_type, currency, balance_cents) VALUES (?1, 'Bank', 'chequing', 'CAD', 1)",
                rusqlite::params![format!("Acct {i:03}")],
            )
            .expect("insert account");
        }

        assert_capped(
            &render(ContextProviderId::Accounts, &conn, &clock()),
            ACCOUNTS_CAP,
            total,
        );
    }

    #[test]
    fn assets_truncates_at_its_cap() {
        let conn = empty_db();
        let total = ASSETS_CAP + 1;
        for i in 0..total {
            conn.execute(
                "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES (?1, 'other', 1)",
                rusqlite::params![format!("Asset {i:03}")],
            )
            .expect("insert asset");
        }

        assert_capped(
            &render(ContextProviderId::Assets, &conn, &clock()),
            ASSETS_CAP,
            total,
        );
    }

    #[test]
    fn income_truncates_its_rows_but_keeps_the_whole_month_total() {
        let conn = empty_db();
        let total = INCOME_CAP + 1;
        for i in 0..total {
            conn.execute(
                "INSERT INTO income_sources (id, name, income_type) VALUES (?1, ?2, 'employment')",
                rusqlite::params![i as i64 + 1, format!("Source {i:03}")],
            )
            .expect("insert source");
            conn.execute(
                "INSERT INTO income_entries (source_id, amount_cents, month, date) VALUES (?1, 100, '2026-03', '2026-03-10')",
                rusqlite::params![i as i64 + 1],
            )
            .expect("insert entry");
        }

        let section = render(ContextProviderId::IncomeThisMonth, &conn, &clock());

        assert_capped(&section, INCOME_CAP, total);
        // The total is read for the month, not summed from the rendered rows, so truncation must
        // not understate it.
        assert!(
            section.contains(&format!("Total income: ${:.2}\n", total as f64)),
            "section: {section}"
        );
    }

    /// Without the manufacturer's own words in the roster, an abbreviation like "vw" has nothing
    /// to match against and the agent concludes the vehicle is not registered.
    #[test]
    fn the_roster_carries_the_manufacturer_label_beside_the_nickname() {
        let conn = empty_db();
        conn.execute(
            "INSERT INTO vehicles (id, nickname, make, model, year, odometer_km)
             VALUES (3, 'Jetta', 'Volkswagen', 'Jetta', 2019, 42000)",
            [],
        )
        .expect("insert vehicle");

        let section = render(ContextProviderId::VehicleRoster, &conn, &clock());

        assert!(section.contains("Jetta [2019 Volkswagen Jetta] (id=3, odometer=42000 km)"));
    }

    /// A vehicle recorded with nothing but a nickname renders exactly as it always did.
    #[test]
    fn a_vehicle_with_no_make_or_model_keeps_its_bare_nickname() {
        let conn = empty_db();
        conn.execute(
            "INSERT INTO vehicles (id, nickname, odometer_km) VALUES (9, 'The Van', 1000)",
            [],
        )
        .expect("insert vehicle");

        let section = render(ContextProviderId::VehicleRoster, &conn, &clock());

        assert!(section.contains("  - The Van (id=9, odometer=1000 km)\n"));
        assert!(!section.contains('['));
    }

    #[test]
    fn a_partially_recorded_vehicle_labels_only_what_is_known() {
        let conn = empty_db();
        conn.execute(
            "INSERT INTO vehicles (id, nickname, make, odometer_km) VALUES (4, 'Truck', 'Ford', 10)",
            [],
        )
        .expect("insert vehicle");

        let section = render(ContextProviderId::VehicleRoster, &conn, &clock());

        assert!(section.contains("Truck [Ford] (id=4, odometer=10 km)"));
    }

    /// The documented shape and the emitted row, checked against each other in one place.
    #[test]
    fn the_emitted_roster_row_has_exactly_the_documented_shape() {
        let conn = empty_db();
        conn.execute(
            "INSERT INTO vehicles (id, nickname, make, model, year, odometer_km)
             VALUES (3, 'Jetta', 'Volkswagen', 'Jetta', 2019, 42000)",
            [],
        )
        .expect("insert vehicle");

        let expected = VEHICLE_ROSTER_SHAPE
            .replace("nickname", "Jetta")
            .replace("year make model", "2019 Volkswagen Jetta")
            .replace("id=N", "id=3")
            .replace("odometer=N km", "odometer=42000 km");

        assert!(
            render(ContextProviderId::VehicleRoster, &conn, &clock())
                .contains(&format!("  - {expected}\n")),
            "documented shape: {VEHICLE_ROSTER_SHAPE}"
        );
    }

    #[test]
    fn the_vehicle_roster_truncates_at_its_cap_but_still_counts_them_all() {
        let conn = empty_db();
        let total = VEHICLES_CAP + 1;
        for i in 0..total {
            conn.execute(
                "INSERT INTO vehicles (nickname, odometer_km) VALUES (?1, 1000)",
                rusqlite::params![format!("Car {i:03}")],
            )
            .expect("insert vehicle");
        }

        let section = render(ContextProviderId::VehicleRoster, &conn, &clock());

        assert_capped(&section, VEHICLES_CAP, total);
        assert!(
            section.contains(&format!("  Vehicles: {total}\n")),
            "section: {section}"
        );
    }

    #[test]
    fn a_provider_whose_read_fails_degrades_to_an_absent_section() {
        // A migrated-away database stands in for any read failure: the turn must still proceed.
        let conn = Connection::open_in_memory().expect("in-memory database");

        assert_eq!(assemble(ALL, &conn, &clock()), "Budget Groups: none yet.\n\nNo income recorded for the current month.\n\n");
    }
}
