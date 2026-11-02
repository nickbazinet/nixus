//! Home Surface persistence and Data Source resolution (PRD FR-3, FR-8).
//!
//! Resolution is the ONLY place a Home widget meets a real figure, and it happens here, locally,
//! after the model has finished choosing the widget's shape. Nothing in this module is reachable
//! from the generation prompt.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::db::account as account_db;
use crate::db::asset as asset_db;
use crate::db::budget as budget_db;
use crate::error::AppError;
use crate::home_surface::catalog::{self, ComponentKind};
use crate::home_surface::validate::{SurfaceChange, WidgetSummary};
use crate::models::{HomeDataset, HomeDatasetRow, HomeRenderNode, HomeWidget, StoredHomeWidget};

/// The row key the renderer translates as "Other" for a folded remainder.
pub const OTHER_ROW_KEY: &str = "__other__";

const WIDGET_SELECT: &str =
    "SELECT id, widget_key, position, spec_json, created_at, updated_at FROM home_widgets";

fn row_to_widget(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredHomeWidget> {
    Ok(StoredHomeWidget {
        id: row.get(0)?,
        widget_key: row.get(1)?,
        position: row.get(2)?,
        spec_json: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn list_widgets(conn: &Connection) -> Result<Vec<StoredHomeWidget>, AppError> {
    let mut stmt = conn.prepare(&format!("{WIDGET_SELECT} ORDER BY position, id"))?;
    let widgets = stmt
        .query_map([], row_to_widget)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(widgets)
}

/// The surface as validation and the prompt see it: keys and specs, never values.
pub fn list_summaries(conn: &Connection) -> Result<Vec<WidgetSummary>, AppError> {
    Ok(list_widgets(conn)?
        .into_iter()
        .map(|widget| WidgetSummary {
            spec: serde_json::from_str(&widget.spec_json).unwrap_or(Value::Null),
            widget_key: widget.widget_key,
        })
        .collect())
}

fn find_widget(conn: &Connection, widget_key: &str) -> Result<StoredHomeWidget, AppError> {
    conn.query_row(
        &format!("{WIDGET_SELECT} WHERE widget_key = ?1 ORDER BY id LIMIT 1"),
        params![widget_key],
        row_to_widget,
    )
    .optional()?
    .ok_or_else(|| AppError::Validation {
        message: "That widget is no longer on the Home Surface".to_string(),
        field: Some("widget_id".to_string()),
    })
}

fn get_widget(conn: &Connection, id: i64) -> Result<StoredHomeWidget, AppError> {
    Ok(conn.query_row(
        &format!("{WIDGET_SELECT} WHERE id = ?1"),
        params![id],
        row_to_widget,
    )?)
}

fn new_widget_key() -> String {
    let bytes = rand::random::<[u8; 6]>();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("w_{hex}")
}

/// What a confirmed change did, in the shape the audit row records.
#[derive(Debug, Clone)]
pub struct AppliedChange {
    pub entity_id: i64,
    pub action: &'static str,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub title: String,
}

fn to_json(widget: &StoredHomeWidget) -> Option<String> {
    serde_json::to_string(widget).ok()
}

/// Applies one validated change. Add appends at the end; modify replaces the spec in place, so the
/// widget keeps its key and its position (FR-6); remove deletes only the one targeted row.
///
/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn apply_change(conn: &Connection, change: &SurfaceChange) -> Result<AppliedChange, AppError> {
    match change {
        SurfaceChange::Add { widget } => {
            let position: i64 = conn.query_row(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM home_widgets",
                [],
                |row| row.get(0),
            )?;
            conn.execute(
                "INSERT INTO home_widgets (widget_key, position, spec_json) VALUES (?1, ?2, ?3)",
                params![new_widget_key(), position, widget.to_string()],
            )?;
            let created = get_widget(conn, conn.last_insert_rowid())?;
            Ok(AppliedChange {
                entity_id: created.id,
                action: "create",
                old_value: None,
                new_value: to_json(&created),
                title: title_of(widget),
            })
        }
        SurfaceChange::Modify { widget_id, widget } => {
            let before = find_widget(conn, widget_id)?;
            conn.execute(
                "UPDATE home_widgets SET spec_json = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![widget.to_string(), before.id],
            )?;
            let after = get_widget(conn, before.id)?;
            Ok(AppliedChange {
                entity_id: before.id,
                action: "update",
                old_value: to_json(&before),
                new_value: to_json(&after),
                title: title_of(widget),
            })
        }
        SurfaceChange::Remove { widget_id, .. } => {
            let before = find_widget(conn, widget_id)?;
            conn.execute("DELETE FROM home_widgets WHERE id = ?1", params![before.id])?;
            let spec: Value = serde_json::from_str(&before.spec_json).unwrap_or(Value::Null);
            Ok(AppliedChange {
                entity_id: before.id,
                action: "delete",
                old_value: to_json(&before),
                new_value: None,
                title: title_of(&spec),
            })
        }
    }
}

fn title_of(spec: &Value) -> String {
    spec.get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Calendar arithmetic on `(year, month)` pairs, so a window never depends on day-of-month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct YearMonth {
    year: i32,
    month: u32,
}

impl YearMonth {
    fn back(self, months: i64) -> YearMonth {
        let index = i64::from(self.year) * 12 + i64::from(self.month) - 1 - months;
        YearMonth {
            year: (index.div_euclid(12)) as i32,
            month: (index.rem_euclid(12) + 1) as u32,
        }
    }

    fn key(self) -> String {
        format!("{:04}-{:02}", self.year, self.month)
    }

    fn first_day(self) -> String {
        format!("{}-01", self.key())
    }

    /// `count` months ending at (and including) `self`, oldest first.
    fn window(self, count: i64) -> Vec<YearMonth> {
        (0..count).rev().map(|back| self.back(back)).collect()
    }
}

fn current_month(conn: &Connection) -> Result<YearMonth, AppError> {
    let (year, month): (i32, u32) = conn.query_row(
        "SELECT CAST(strftime('%Y', 'now') AS INTEGER), CAST(strftime('%m', 'now') AS INTEGER)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(YearMonth { year, month })
}

/// The binding's parameters with every value present and inside its declared range. A persisted
/// spec was validated when it was written, but a later build may have tightened a range.
fn param(params: &Map<String, Value>, spec: &catalog::DataSource, name: &str) -> i64 {
    let Some((min, max, default)) = spec.param(name).and_then(|declared| declared.integer()) else {
        return 0;
    };
    params
        .get(name)
        .and_then(Value::as_i64)
        .map(|value| value.clamp(min, max))
        .unwrap_or(default)
}

/// A calendar window: from the first day of its first month, up to (not including) the first day
/// after its last month. Every windowed source reads its rows through one of these.
struct Window {
    months: Vec<YearMonth>,
    since: String,
    until: String,
}

/// `months` long, ending `months_ago` months before the current one.
fn window_of(params: &Map<String, Value>, spec: &catalog::DataSource, now: YearMonth) -> Window {
    let end = now.back(param(params, spec, "months_ago"));
    let months = end.window(param(params, spec, "months").max(1));
    Window {
        since: months[0].first_day(),
        until: end.back(-1).first_day(),
        months,
    }
}

/// Every budget category, for matching a user's words against.
pub fn category_names(conn: &Connection) -> Result<Vec<(i64, String)>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name FROM budget_categories")?;
    let names = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names)
}

/// The category filter as SQL wants it: `None` for "all categories", otherwise the matched ids as
/// a JSON array for `json_each`. A term that matches nothing filters to nothing — an empty widget is
/// honest, while silently showing every category under a "Groceries" title is not.
fn category_filter(conn: &Connection, params: &Map<String, Value>) -> Result<Option<String>, AppError> {
    let Some(term) = params.get("category").and_then(Value::as_str) else {
        return Ok(None);
    };
    let ids = crate::home_surface::matcher::match_categories(term, &category_names(conn)?);
    Ok(Some(Value::from(ids).to_string()))
}

const CATEGORY_CLAUSE: &str =
    "(?3 IS NULL OR budget_category_id IN (SELECT value FROM json_each(?3)))";

fn monthly_expense_sums(
    conn: &Connection,
    window: &Window,
    categories: Option<&str>,
) -> Result<HashMap<String, i64>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT strftime('%Y-%m', date), SUM(amount_cents) FROM expenses
         WHERE date >= ?1 AND date < ?2 AND {CATEGORY_CLAUSE} GROUP BY 1"
    ))?;
    let sums = stmt
        .query_map(params![window.since, window.until, categories], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<HashMap<String, i64>, _>>()?;
    Ok(sums)
}

fn monthly_income_sums(conn: &Connection, window: &Window) -> Result<HashMap<String, i64>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', date), SUM(amount_cents) FROM income_entries
         WHERE date >= ?1 AND date < ?2 GROUP BY 1",
    )?;
    let sums = stmt
        .query_map(params![window.since, window.until], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<HashMap<String, i64>, _>>()?;
    Ok(sums)
}

fn month_rows(window: &[YearMonth], columns: &[&HashMap<String, i64>]) -> Vec<HomeDatasetRow> {
    window
        .iter()
        .map(|month| HomeDatasetRow {
            details: Vec::new(),
            key: month.key(),
            label: month.key(),
            values: columns
                .iter()
                .map(|sums| sums.get(&month.key()).copied().unwrap_or(0))
                .collect(),
        })
        .collect()
}

fn dataset(dimension: &str, series: &[&str], rows: Vec<HomeDatasetRow>) -> HomeDataset {
    HomeDataset {
        dimension: dimension.to_string(),
        detail_columns: Vec::new(),
        series: series.iter().map(|s| s.to_string()).collect(),
        rows,
    }
}

fn expenses_by_category(
    conn: &Connection,
    window: &Window,
    limit: usize,
) -> Result<HomeDataset, AppError> {
    let mut stmt = conn.prepare(
        "SELECT bc.id, bc.name, SUM(e.amount_cents) AS spent
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE e.date >= ?1 AND e.date < ?2
         GROUP BY bc.id
         HAVING spent > 0
         ORDER BY spent DESC, bc.name",
    )?;
    let ranked = stmt
        .query_map(params![window.since, window.until], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut rows: Vec<HomeDatasetRow> = ranked
        .iter()
        .take(limit)
        .map(|(id, name, spent)| HomeDatasetRow {
            details: Vec::new(),
            key: format!("category:{id}"),
            label: name.clone(),
            values: vec![*spent],
        })
        .collect();
    // Folded rather than dropped: a pie of the top N alone would overstate every share.
    let rest: i64 = ranked.iter().skip(limit).map(|(_, _, spent)| spent).sum();
    if rest > 0 {
        rows.push(HomeDatasetRow {
            details: Vec::new(),
            key: OTHER_ROW_KEY.to_string(),
            label: "Other".to_string(),
            values: vec![rest],
        });
    }
    Ok(dataset("category", &["spent"], rows))
}

fn net_worth_history(conn: &Connection, window: &Window) -> Result<HomeDataset, AppError> {
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', snapshot_date), total_cents
         FROM net_worth_snapshots
         WHERE snapshot_date >= ?1 AND snapshot_date < ?2
         ORDER BY snapshot_date, id",
    )?;
    // The LAST snapshot of each month is that month's net worth. A month with none is omitted
    // rather than drawn as zero, which would invent a crash that never happened.
    let mut by_month: BTreeMap<String, i64> = BTreeMap::new();
    for row in stmt.query_map(params![window.since, window.until], |row| {
        Ok((row.get::<_, String>(0)?, row.get(1)?))
    })? {
        let (month, total) = row?;
        by_month.insert(month, total);
    }
    let rows = by_month
        .into_iter()
        .map(|(month, total)| HomeDatasetRow {
            details: Vec::new(),
            key: month.clone(),
            label: month,
            values: vec![total],
        })
        .collect();
    Ok(dataset("month", &["net_worth"], rows))
}

fn budget_vs_actual(conn: &Connection, month: YearMonth) -> Result<HomeDataset, AppError> {
    let rows = budget_db::get_budget_status(conn, month.year, month.month as i32)?
        .into_iter()
        .filter(|status| status.target_cents > 0 || status.spent_cents > 0)
        .map(|status| HomeDatasetRow {
            details: Vec::new(),
            key: format!("category:{}", status.id),
            label: status.name,
            values: vec![status.spent_cents, status.target_cents],
        })
        .collect();
    Ok(dataset("category", &["actual", "budget"], rows))
}

/// Individual expenses, newest first. Ties on a date fall back to the latest-entered row, which is
/// the order a user who just imported a statement expects to read them in.
fn recent_expenses(
    conn: &Connection,
    window: &Window,
    categories: Option<&str>,
    limit: i64,
) -> Result<HomeDataset, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT e.id, e.merchant, e.date, bc.name, e.amount_cents
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE e.date >= ?1 AND e.date < ?2 AND {}
         ORDER BY e.date DESC, e.id DESC
         LIMIT ?4",
        CATEGORY_CLAUSE.replace("budget_category_id", "e.budget_category_id")
    ))?;
    let rows = stmt
        .query_map(params![window.since, window.until, categories, limit], |row| {
            Ok(HomeDatasetRow {
                key: format!("expense:{}", row.get::<_, i64>(0)?),
                label: row.get(1)?,
                details: vec![row.get(2)?, row.get(3)?],
                values: vec![row.get(4)?],
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(HomeDataset {
        dimension: "expense".to_string(),
        detail_columns: vec!["date".to_string(), "category".to_string()],
        series: vec!["amount".to_string()],
        rows,
    })
}

fn account_balances(conn: &Connection) -> Result<HomeDataset, AppError> {
    let rows = account_db::get_all_accounts(conn)?
        .into_iter()
        .map(|account| HomeDatasetRow {
            details: Vec::new(),
            key: format!("account:{}", account.id),
            label: if account.currency == "CAD" {
                account.name
            } else {
                format!("{} ({})", account.name, account.currency)
            },
            values: vec![account.balance_cents],
        })
        .collect();
    Ok(dataset("account", &["balance"], rows))
}

fn asset_values(conn: &Connection) -> Result<HomeDataset, AppError> {
    let rows = asset_db::get_all_assets(conn)?
        .into_iter()
        .map(|asset| HomeDatasetRow {
            details: Vec::new(),
            key: format!("asset:{}", asset.id),
            label: asset.name,
            values: vec![asset.value_cents],
        })
        .collect();
    Ok(dataset("asset", &["value"], rows))
}

/// Resolves one whitelisted source. `None` for a source this build does not know.
pub fn resolve_binding(
    conn: &Connection,
    source: &str,
    params: &Map<String, Value>,
    now: YearMonthNow,
) -> Result<Option<HomeDataset>, AppError> {
    let Some(spec) = catalog::data_source(source) else {
        return Ok(None);
    };
    let now = now.0;

    let resolved = match spec.name {
        "expenses_by_month" => {
            let window = window_of(params, spec, now);
            let categories = category_filter(conn, params)?;
            let spent = monthly_expense_sums(conn, &window, categories.as_deref())?;
            dataset("month", &["spent"], month_rows(&window.months, &[&spent]))
        }
        "expenses_by_category" => expenses_by_category(
            conn,
            &window_of(params, spec, now),
            param(params, spec, "limit") as usize,
        )?,
        "net_worth_history" => net_worth_history(conn, &window_of(params, spec, now))?,
        "budget_vs_actual_by_category" => {
            budget_vs_actual(conn, now.back(param(params, spec, "months_ago")))?
        }
        "income_vs_expense_by_month" => {
            let window = window_of(params, spec, now);
            let income = monthly_income_sums(conn, &window)?;
            let spent = monthly_expense_sums(conn, &window, None)?;
            dataset(
                "month",
                &["income", "spent"],
                month_rows(&window.months, &[&income, &spent]),
            )
        }
        "recent_expenses" => recent_expenses(
            conn,
            &window_of(params, spec, now),
            category_filter(conn, params)?.as_deref(),
            param(params, spec, "limit"),
        )?,
        "account_balances" => account_balances(conn)?,
        "asset_values" => asset_values(conn)?,
        _ => return Ok(None),
    };

    Ok(Some(resolved))
}

/// The current calendar month, read once per Home open so every widget agrees on "now".
#[derive(Debug, Clone, Copy)]
pub struct YearMonthNow(YearMonth);

pub fn now(conn: &Connection) -> Result<YearMonthNow, AppError> {
    Ok(YearMonthNow(current_month(conn)?))
}

fn unsupported(component: &str) -> HomeRenderNode {
    HomeRenderNode {
        component: component.to_string(),
        title: None,
        columns: None,
        source: None,
        data: None,
        unsupported: true,
        children: Vec::new(),
    }
}

/// Resolves a node and its children. Two bindings with the same source and params resolve once.
fn resolve_node(
    conn: &Connection,
    node: &Value,
    now: YearMonthNow,
    cache: &mut HashMap<String, Option<HomeDataset>>,
) -> Result<HomeRenderNode, AppError> {
    let name = node.get("component").and_then(Value::as_str).unwrap_or("");
    let Some(component) = catalog::component(name) else {
        return Ok(unsupported(name));
    };
    let title = node
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string);

    match component.kind {
        ComponentKind::Display => {
            let source = node
                .pointer("/dataBinding/source")
                .and_then(Value::as_str)
                .unwrap_or("");
            let empty = Map::new();
            let params = node
                .pointer("/dataBinding/params")
                .and_then(Value::as_object)
                .unwrap_or(&empty);
            let cache_key = format!("{source}:{}", Value::Object(params.clone()));
            let data = match cache.get(&cache_key) {
                Some(hit) => hit.clone(),
                None => {
                    let resolved = resolve_binding(conn, source, params, now)?;
                    cache.insert(cache_key, resolved.clone());
                    resolved
                }
            };
            Ok(HomeRenderNode {
                component: component.name.to_string(),
                title,
                columns: None,
                source: Some(source.to_string()),
                unsupported: data.is_none(),
                data,
                children: Vec::new(),
            })
        }
        ComponentKind::Layout => {
            let children = node
                .get("children")
                .and_then(Value::as_array)
                .map(|children| {
                    children
                        .iter()
                        .map(|child| resolve_node(conn, child, now, cache))
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()?
                .unwrap_or_default();
            Ok(HomeRenderNode {
                component: component.name.to_string(),
                title,
                columns: node.get("columns").and_then(Value::as_i64),
                source: None,
                data: None,
                unsupported: false,
                children,
            })
        }
    }
}

/// Every persisted widget, each binding resolved against the data as it is right now (FR-8).
pub fn resolve_surface(conn: &Connection) -> Result<Vec<HomeWidget>, AppError> {
    let now = now(conn)?;
    let mut cache = HashMap::new();

    list_widgets(conn)?
        .into_iter()
        .map(|widget| {
            let spec: Value = serde_json::from_str(&widget.spec_json).unwrap_or(Value::Null);
            Ok(HomeWidget {
                title: title_of(&spec),
                root: resolve_node(conn, &spec, now, &mut cache)?,
                id: widget.widget_key,
                position: widget.position,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "tests_home_surface.rs"]
mod tests;
