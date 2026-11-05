//! The closed vocabulary the Home Surface is composed from (PRD §4.1, §4.2).
//!
//! Two closed sets and nothing else: the Component Catalog the model may name, and the Data Source
//! Whitelist a display component may bind to. Both are app-curated; no model output can extend
//! either, and Surface Validation (`validate`) rejects anything outside them before a proposal is
//! ever shown to the user.

/// Whether a catalog entry carries data or only arranges other entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentKind {
    Display,
    Layout,
}

/// The shape a data source answers in, which is what decides the components it can feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceShape {
    /// One row per calendar month, oldest first.
    TimeSeries,
    /// One row per named thing (a category, an account, an asset).
    Categorical,
    /// One row per individual record (an expense), newest first. Only a Table can show it: a chart
    /// of arbitrary line items has no axis that means anything.
    Transactions,
    /// One row per flow between two named nodes, rather than per thing. A row carries the node it
    /// leaves and the node it reaches in its `details`, so the rows together are a graph. Only a
    /// SankeyChart can show it: every other component reads a row as a standalone value.
    Flow,
    /// One row holding a single fact, not a figure — there is nothing to sum, chart or rank. Only
    /// a Date can show it: every other component reads a row as a number.
    Scalar,
}

#[derive(Debug, Clone, Copy)]
pub struct CatalogComponent {
    pub name: &'static str,
    pub kind: ComponentKind,
    /// Goes into the generation prompt verbatim, so it is written for the model.
    pub description: &'static str,
    /// `None` when any source shape renders sensibly.
    pub requires: Option<SourceShape>,
}

use ComponentKind::{Display, Layout};
use SourceShape::{Categorical, Flow, Scalar, TimeSeries, Transactions};

pub const COMPONENTS: &[CatalogComponent] = &[
    CatalogComponent {
        name: "Metric",
        kind: Display,
        description: "One headline figure. For a monthly source it shows the latest month and its change from the month before; for any other source it shows the total.",
        requires: None,
    },
    CatalogComponent {
        name: "LineChart",
        kind: Display,
        description: "A trend over time, one line per series. Use for growth or change month over month.",
        requires: Some(TimeSeries),
    },
    CatalogComponent {
        name: "BarChart",
        kind: Display,
        description: "Bars comparing values, one bar group per row. Good for month-by-month comparisons or ranking categories, accounts or assets.",
        requires: None,
    },
    CatalogComponent {
        name: "AreaChart",
        kind: Display,
        description: "A filled trend over time. Use when the size of the value matters as much as its direction.",
        requires: Some(TimeSeries),
    },
    CatalogComponent {
        name: "PieChart",
        kind: Display,
        description: "Shares of a whole, one slice per row. Only for categorical sources.",
        requires: Some(Categorical),
    },
    CatalogComponent {
        name: "Table",
        kind: Display,
        description: "Rows and columns of the source's figures. Use when exact values matter more than shape. The only component that can show a transaction-list source.",
        requires: None,
    },
    CatalogComponent {
        name: "SankeyChart",
        kind: Display,
        description: "A flow diagram: money leaves the nodes on the left and fans out through bands whose thickness is the amount. Use for \"where does my money go\". Only for flow sources.",
        requires: Some(Flow),
    },
    CatalogComponent {
        name: "Date",
        kind: Display,
        description: "A single fact, not a figure. Only for scalar sources.",
        requires: Some(Scalar),
    },
    CatalogComponent {
        name: "Card",
        kind: Layout,
        description: "A titled container around 1-4 children.",
        requires: None,
    },
    CatalogComponent {
        name: "Row",
        kind: Layout,
        description: "Places 1-4 children side by side.",
        requires: None,
    },
    CatalogComponent {
        name: "Column",
        kind: Layout,
        description: "Stacks 1-4 children vertically.",
        requires: None,
    },
    CatalogComponent {
        name: "Grid",
        kind: Layout,
        description: "Arranges 1-4 children in a grid with `columns` (1-4, default 2) columns.",
        requires: None,
    },
];

pub fn component(name: &str) -> Option<&'static CatalogComponent> {
    COMPONENTS.iter().find(|component| component.name == name)
}

/// What a parameter accepts. Integers select a window or a count; the one text kind selects a
/// budget category by the user's own words. Neither can carry a figure: an integer is bounded to a
/// small range, and text is matched against category names locally, never shown as a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamKind {
    Integer { min: i64, max: i64, default: i64 },
    /// Optional: omitted means "no filter".
    CategoryName { max_chars: usize },
}

#[derive(Debug, Clone, Copy)]
pub struct ParamSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub kind: ParamKind,
}

impl ParamSpec {
    /// The integer bounds, for the parameters that have them.
    pub fn integer(&self) -> Option<(i64, i64, i64)> {
        match self.kind {
            ParamKind::Integer { min, max, default } => Some((min, max, default)),
            ParamKind::CategoryName { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct DataSource {
    pub name: &'static str,
    /// Goes into the generation prompt verbatim. Describes WHAT the source answers, never a value.
    pub description: &'static str,
    pub shape: SourceShape,
    pub params: &'static [ParamSpec],
}

const fn int(
    name: &'static str,
    description: &'static str,
    min: i64,
    max: i64,
    default: i64,
) -> ParamSpec {
    ParamSpec {
        name,
        description,
        kind: ParamKind::Integer { min, max, default },
    }
}

/// Every windowed source takes the same two knobs, so any period can be asked for: `months` is how
/// long the window is, `months_ago` is how far back it ends. "Last month" is `months: 1,
/// months_ago: 1`; "this year so far" is `months` = the current month number.
const fn months(max: i64, default: i64) -> ParamSpec {
    int(
        "months",
        "How many calendar months the window covers, ending at the month picked by months_ago",
        1,
        max,
        default,
    )
}

const MONTHS_AGO: ParamSpec = int(
    "months_ago",
    "Which month the window ends at: 0 = the current month, 1 = last month, and so on",
    0,
    120,
    0,
);

const CATEGORY: ParamSpec = ParamSpec {
    name: "category",
    description: "Optional. Only expenses in the budget category the user names, in the user's own words (e.g. \"groceries\"); omit for all categories",
    kind: ParamKind::CategoryName { max_chars: 60 },
};

pub const DATA_SOURCES: &[DataSource] = &[
    DataSource {
        name: "expenses_by_month",
        description: "Total spending per calendar month, optionally for one budget category.",
        shape: TimeSeries,
        params: &[months(36, 6), MONTHS_AGO, CATEGORY],
    },
    DataSource {
        name: "expenses_by_category",
        description: "Spending per budget category over a window of months, largest first; categories past `limit` are folded into one 'Other' row.",
        shape: Categorical,
        params: &[
            months(36, 1),
            MONTHS_AGO,
            int(
                "limit",
                "How many categories to show before folding the rest into 'Other'",
                1,
                20,
                8,
            ),
        ],
    },
    DataSource {
        name: "net_worth_history",
        description: "Net worth at the end of each calendar month that has a recorded snapshot.",
        shape: TimeSeries,
        params: &[months(120, 12), MONTHS_AGO],
    },
    DataSource {
        name: "budget_vs_actual_by_category",
        description: "For one month, each budget category's actual spending next to its monthly budget target.",
        shape: Categorical,
        params: &[MONTHS_AGO],
    },
    DataSource {
        name: "income_vs_expense_by_month",
        description: "Income and spending side by side for each calendar month.",
        shape: TimeSeries,
        params: &[months(36, 6), MONTHS_AGO],
    },
    DataSource {
        name: "recent_expenses",
        description: "Individual expenses, newest first: date, merchant, budget category and amount. Use for \"my last N expenses\" or \"recent transactions\", optionally within a window of months or one budget category.",
        shape: Transactions,
        params: &[
            int("limit", "How many expenses to list", 1, 50, 10),
            months(120, 120),
            MONTHS_AGO,
            CATEGORY,
        ],
    },
    DataSource {
        name: "account_balances",
        description: "The current balance of each account (bank, credit card, investment).",
        shape: Categorical,
        params: &[],
    },
    DataSource {
        name: "asset_values",
        description: "The current value of each passive asset (real estate, vehicles, business equity, stocks).",
        shape: Categorical,
        params: &[],
    },
    DataSource {
        name: "average_monthly_cash_flow",
        description: "Where the money goes in an average month over a window: each income source flows into one income node, which fans out into each budget category and into whatever was left unspent. Every figure is the monthly average over the window. Use for \"where does my money go\" or a cash-flow Sankey.",
        shape: Flow,
        params: &[
            months(36, 3),
            MONTHS_AGO,
            int(
                "limit",
                "How many budget categories get their own band before the rest are folded into 'Other'",
                1,
                20,
                8,
            ),
        ],
    },
    DataSource {
        name: "current_date",
        description: "Today's date, read when the Home dashboard is opened. For the Date component.",
        shape: Scalar,
        params: &[],
    },
    DataSource {
        name: "recurring_expenses",
        description: "Every active recurring expense template and its monthly amount, largest first.",
        shape: Categorical,
        params: &[],
    },
];

pub fn data_source(name: &str) -> Option<&'static DataSource> {
    DATA_SOURCES.iter().find(|source| source.name == name)
}

impl DataSource {
    pub fn param(&self, name: &str) -> Option<&'static ParamSpec> {
        self.params.iter().find(|param| param.name == name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FR-1 / FR-2: the catalog is exactly these eleven names, spelled exactly so, because Surface
    /// Validation matches `component` by exact name.
    #[test]
    fn the_catalog_is_the_seven_display_components_and_four_layout_primitives() {
        let display: Vec<&str> = COMPONENTS
            .iter()
            .filter(|c| c.kind == Display)
            .map(|c| c.name)
            .collect();
        let layout: Vec<&str> = COMPONENTS
            .iter()
            .filter(|c| c.kind == Layout)
            .map(|c| c.name)
            .collect();

        assert_eq!(
            display,
            vec![
                "Metric",
                "LineChart",
                "BarChart",
                "AreaChart",
                "PieChart",
                "Table",
                "SankeyChart",
                "Date"
            ]
        );
        assert_eq!(layout, vec!["Card", "Row", "Column", "Grid"]);
        assert!(component("PieChart/Donut").is_none());
        assert!(
            component("piechart").is_none(),
            "matching is exact, not case-folded"
        );
    }

    /// FR-3's seven finance sources plus `recent_expenses` (added after the PRD, by request), plus
    /// `current_date` and `recurring_expenses` (added after the PRD, by request), and nothing from
    /// another module.
    #[test]
    fn the_whitelist_is_the_finance_sources() {
        let names: Vec<&str> = DATA_SOURCES.iter().map(|s| s.name).collect();
        assert_eq!(
            names,
            vec![
                "expenses_by_month",
                "expenses_by_category",
                "net_worth_history",
                "budget_vs_actual_by_category",
                "income_vs_expense_by_month",
                "recent_expenses",
                "account_balances",
                "asset_values",
                "average_monthly_cash_flow",
                "current_date",
                "recurring_expenses",
            ]
        );
        for source in DATA_SOURCES {
            for param in source.params {
                if let Some((min, max, default)) = param.integer() {
                    assert!(min <= default && default <= max, "{}", source.name);
                }
            }
        }
    }
}
