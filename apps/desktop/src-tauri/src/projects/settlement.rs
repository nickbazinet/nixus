use chrono::{Datelike, NaiveDate};

use crate::models::SuggestionSettlement;

// The confirmed half of a settlement, read off the `project_contributions` ledger. `Option`-free by
// construction: the db layer returns `None` for "no suggested rows this month" rather than a zeroed
// struct, so "confirmed nothing" is unrepresentable here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmedSuggestionMonth {
    pub latest_date: String,
    pub total_cents: i64,
    pub project_count: i64,
}

// Confirm beats skip. A user who skipped and then reopened the panel and confirmed has made the
// later, stronger decision, and the skip marker for that month is stale rather than authoritative;
// showing them "skipped" over a real receipt would be a lie about their own ledger.
pub fn resolve_settlement(
    current_month: &str,
    confirmed: Option<ConfirmedSuggestionMonth>,
    skipped_month: Option<&str>,
) -> Option<SuggestionSettlement> {
    if let Some(confirmed) = confirmed {
        return Some(SuggestionSettlement::Confirm {
            settled_date: confirmed.latest_date,
            settled_month: current_month.to_string(),
            confirmed_total_cents: confirmed.total_cents,
            confirmed_project_count: confirmed.project_count,
        });
    }

    // A marker from an older month is exactly how the cadence reopens on the 1st: nothing is
    // cleared on a month boundary, the comparison simply stops matching.
    if skipped_month.is_some_and(|month| month == current_month) {
        return Some(SuggestionSettlement::Skip {
            settled_month: current_month.to_string(),
        });
    }

    None
}

pub fn month_of(today: NaiveDate) -> String {
    today.format("%Y-%m").to_string()
}

// December has to roll the year, and `NaiveDate` has no "add one month", so the 1st is constructed
// directly rather than by adding days.
pub fn next_month_start(today: NaiveDate) -> Option<NaiveDate> {
    let (year, month) = match today.month() {
        12 => (today.year() + 1, 1),
        current => (today.year(), current + 1),
    };
    NaiveDate::from_ymd_opt(year, month, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn confirmed() -> ConfirmedSuggestionMonth {
        ConfirmedSuggestionMonth {
            latest_date: "2026-08-11".to_string(),
            total_cents: 50_000,
            project_count: 2,
        }
    }

    #[test]
    fn an_unsettled_month_resolves_to_nothing() {
        assert_eq!(resolve_settlement("2026-08", None, None), None);
    }

    #[test]
    fn a_confirmation_this_month_settles_with_its_receipt() {
        let settlement = resolve_settlement("2026-08", Some(confirmed()), None).unwrap();

        assert_eq!(
            settlement,
            SuggestionSettlement::Confirm {
                settled_date: "2026-08-11".to_string(),
                settled_month: "2026-08".to_string(),
                confirmed_total_cents: 50_000,
                confirmed_project_count: 2,
            }
        );
    }

    #[test]
    fn a_skip_marker_for_this_month_settles_the_month() {
        let settlement = resolve_settlement("2026-08", None, Some("2026-08")).unwrap();

        assert_eq!(
            settlement,
            SuggestionSettlement::Skip {
                settled_month: "2026-08".to_string(),
            }
        );
    }

    // The cadence rule in executable form: last month's decision must not settle this month.
    #[test]
    fn a_skip_marker_from_a_previous_month_leaves_the_month_unsettled() {
        assert_eq!(resolve_settlement("2026-09", None, Some("2026-08")), None);
        assert_eq!(resolve_settlement("2027-01", None, Some("2026-12")), None);
    }

    #[test]
    fn a_confirmation_outranks_a_skip_marker_for_the_same_month() {
        let settlement = resolve_settlement("2026-08", Some(confirmed()), Some("2026-08")).unwrap();

        assert!(matches!(
            settlement,
            SuggestionSettlement::Confirm { .. }
        ));
    }

    // An empty config value is how the skip marker is cleared, so it must not read as a month.
    #[test]
    fn an_empty_skip_marker_never_settles_a_month() {
        assert_eq!(resolve_settlement("2026-08", None, Some("")), None);
    }

    #[test]
    fn month_of_formats_as_year_dash_month() {
        assert_eq!(month_of(day("2026-08-11")), "2026-08");
        assert_eq!(month_of(day("2026-01-01")), "2026-01");
        assert_eq!(month_of(day("2026-12-31")), "2026-12");
    }

    #[test]
    fn next_month_start_is_the_first_of_the_following_month() {
        assert_eq!(next_month_start(day("2026-08-11")), Some(day("2026-09-01")));
        assert_eq!(next_month_start(day("2026-01-31")), Some(day("2026-02-01")));
        assert_eq!(next_month_start(day("2026-01-01")), Some(day("2026-02-01")));
    }

    // February 30th does not exist, which is why the 1st is constructed rather than day-added.
    #[test]
    fn next_month_start_survives_a_month_shorter_than_the_current_one() {
        assert_eq!(next_month_start(day("2026-01-30")), Some(day("2026-02-01")));
        assert_eq!(next_month_start(day("2026-03-31")), Some(day("2026-04-01")));
    }

    #[test]
    fn next_month_start_rolls_the_year_in_december() {
        assert_eq!(next_month_start(day("2026-12-01")), Some(day("2027-01-01")));
        assert_eq!(next_month_start(day("2026-12-31")), Some(day("2027-01-01")));
    }
}
