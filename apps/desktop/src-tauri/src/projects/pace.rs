use chrono::NaiveDate;

use crate::models::ProjectPace;
use crate::projects::allocation::{months_to_target, whole_months};

/// How many trailing months of contributions `recent_cents` covers. The db layer's `recent_since`
/// window and this divisor must always describe the same span.
pub const RECENT_WINDOW_MONTHS: i64 = 3;

pub const STATUS_GOOD: &str = "good";
pub const STATUS_CAUTION: &str = "caution";
pub const STATUS_OVER: &str = "over";
pub const STATUS_NEUTRAL: &str = "neutral";

// Integer thresholds, never a float ratio: `actual / required >= 1.0` is `actual * 100 >= required *
// 100` and `>= 0.75` is `actual * 100 >= required * 75`, which keeps the boundaries exact on cents.
const CAUTION_RATIO_NUMERATOR: i64 = 75;
const RATIO_SCALE: i64 = 100;

// Db-layer shape, not the wire shape: `created_at` and the two sums exist only to feed the
// computation below and never reach the frontend.
#[derive(Debug, Clone)]
pub struct ProjectPaceRow {
    pub project_id: i64,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub created_at: String,
    pub saved_cents: i64,
    pub recent_cents: i64,
}

#[derive(Debug, Clone)]
pub struct PaceInput<'a> {
    /// ISO 8601 `YYYY-MM-DD`. Injected, never read from the clock inside this module.
    pub today: &'a str,
    pub project: &'a ProjectPaceRow,
}

fn pace(project_id: i64, status: &str) -> ProjectPace {
    ProjectPace {
        project_id,
        required_monthly_cents: None,
        actual_monthly_cents: None,
        status: status.to_string(),
    }
}

// `created_at` is a SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`), so only the date half is
// parseable as a `NaiveDate`.
fn created_date(created_at: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(created_at.get(..10)?, "%Y-%m-%d").ok()
}

// A project younger than one whole month with nothing saved has no trailing average to measure: its
// 3-month window is mostly time it did not exist, so any ratio would read as "way behind" on day one.
// An unparseable `created_at` is treated as old enough rather than as too new, so bad data cannot
// permanently suppress the badge.
fn too_new_to_judge(input: &PaceInput<'_>, today: Option<NaiveDate>) -> bool {
    if input.project.saved_cents != 0 {
        return false;
    }

    match (today, created_date(&input.project.created_at)) {
        (Some(today), Some(created)) => whole_months(created, today) < 1,
        _ => false,
    }
}

fn target_date_passed(target_date: Option<&String>, today: Option<NaiveDate>) -> bool {
    let (Some(today), Some(target)) = (
        today,
        target_date.and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
    ) else {
        return false;
    };

    target < today
}

fn status_for(actual_monthly_cents: i64, required_monthly_cents: i64) -> &'static str {
    let actual = i128::from(actual_monthly_cents) * i128::from(RATIO_SCALE);

    if actual >= i128::from(required_monthly_cents) * i128::from(RATIO_SCALE) {
        return STATUS_GOOD;
    }

    if actual >= i128::from(required_monthly_cents) * i128::from(CAUTION_RATIO_NUMERATOR) {
        return STATUS_CAUTION;
    }

    STATUS_OVER
}

// Gate order is the contract, not an implementation detail. A met goal wins outright — there is
// nothing left to pace, so it is `good` even without a deadline. "Too new" comes next so a fresh
// project reports no rate at all rather than a rate it has had no chance to hit. Only then does the
// deadline decide whether a rate is even definable.
pub fn compute_project_pace(input: &PaceInput<'_>) -> ProjectPace {
    let project = input.project;
    let remaining_cents = project.target_cents.saturating_sub(project.saved_cents);
    if remaining_cents <= 0 {
        return pace(project.project_id, STATUS_GOOD);
    }

    let today = NaiveDate::parse_from_str(input.today, "%Y-%m-%d").ok();

    if too_new_to_judge(input, today) {
        return pace(project.project_id, STATUS_NEUTRAL);
    }

    // `None` is "no deadline": an absent date, an unparseable date, or an unparseable `today`. Every
    // one of them leaves the required rate undefined, so none of them may produce a status.
    let Some(months) = months_to_target(today, project.target_date.as_ref()) else {
        return pace(project.project_id, STATUS_NEUTRAL);
    };

    // Ceiling division: paying the floor every month would land short of the target by up to
    // `months - 1` cents. `months` is clamped to at least 1 upstream, so this cannot divide by zero.
    let required_monthly_cents = remaining_cents.saturating_add(months - 1) / months;
    let actual_monthly_cents = project.recent_cents / RECENT_WINDOW_MONTHS;

    let status = if target_date_passed(project.target_date.as_ref(), today) {
        STATUS_OVER
    } else {
        status_for(actual_monthly_cents, required_monthly_cents)
    };

    ProjectPace {
        project_id: project.project_id,
        required_monthly_cents: Some(required_monthly_cents),
        actual_monthly_cents: Some(actual_monthly_cents),
        status: status.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: &str = "2026-08-12";

    fn row(target_cents: i64, saved_cents: i64, recent_cents: i64) -> ProjectPaceRow {
        ProjectPaceRow {
            project_id: 1,
            target_cents,
            target_date: Some("2027-02-12".to_string()),
            created_at: "2025-01-01 00:00:00".to_string(),
            saved_cents,
            recent_cents,
        }
    }

    fn compute(project: &ProjectPaceRow) -> ProjectPace {
        compute_project_pace(&PaceInput {
            today: TODAY,
            project,
        })
    }

    // 2026-08-12 → 2027-02-12 is 6 whole months, so 600_000 remaining needs 100_000/mo and a
    // trailing 3-month total of 3 × the monthly figure under test.
    fn six_months_out(monthly_actual_cents: i64) -> ProjectPaceRow {
        row(600_000, 0, monthly_actual_cents * RECENT_WINDOW_MONTHS)
    }

    #[test]
    fn matching_the_required_rate_is_on_track() {
        let result = compute(&six_months_out(100_000));

        assert_eq!(result.status, STATUS_GOOD);
        assert_eq!(result.required_monthly_cents, Some(100_000));
        assert_eq!(result.actual_monthly_cents, Some(100_000));
    }

    #[test]
    fn beating_the_required_rate_is_on_track() {
        assert_eq!(compute(&six_months_out(250_000)).status, STATUS_GOOD);
    }

    #[test]
    fn three_quarters_of_the_required_rate_is_caution() {
        assert_eq!(compute(&six_months_out(80_000)).status, STATUS_CAUTION);
    }

    #[test]
    fn half_the_required_rate_is_over() {
        let result = compute(&six_months_out(50_000));

        assert_eq!(result.status, STATUS_OVER);
        assert_eq!(result.actual_monthly_cents, Some(50_000));
    }

    #[test]
    fn contributing_nothing_against_a_deadline_is_over() {
        assert_eq!(compute(&six_months_out(0)).status, STATUS_OVER);
    }

    // The four boundaries the thresholds are defined by. 100_000 required makes each ratio an exact
    // cents figure, so these pin the comparisons rather than approximating them.
    #[test]
    fn ratio_boundaries_land_on_the_documented_side() {
        assert_eq!(compute(&six_months_out(74_900)).status, STATUS_OVER);
        assert_eq!(compute(&six_months_out(75_000)).status, STATUS_CAUTION);
        assert_eq!(compute(&six_months_out(99_900)).status, STATUS_CAUTION);
        assert_eq!(compute(&six_months_out(100_000)).status, STATUS_GOOD);
    }

    #[test]
    fn no_target_date_is_neutral_with_no_rate() {
        let project = ProjectPaceRow {
            target_date: None,
            ..six_months_out(100_000)
        };

        let result = compute(&project);

        assert_eq!(result.status, STATUS_NEUTRAL);
        assert_eq!(result.required_monthly_cents, None);
        assert_eq!(result.actual_monthly_cents, None);
    }

    #[test]
    fn unparseable_target_date_is_neutral_like_no_deadline() {
        for target_date in ["not-a-date", "", "2026-13-45", "2026/10/11"] {
            let project = ProjectPaceRow {
                target_date: Some(target_date.to_string()),
                ..six_months_out(100_000)
            };

            assert_eq!(compute(&project).status, STATUS_NEUTRAL, "for {target_date:?}");
        }
    }

    // The command always injects `Local::now().date_naive().to_string()`, so this is unreachable in
    // production; the test pins the degradation so an unparseable `today` can never panic a caller.
    #[test]
    fn unparseable_today_is_neutral() {
        let project = six_months_out(100_000);

        let result = compute_project_pace(&PaceInput {
            today: "whenever",
            project: &project,
        });

        assert_eq!(result.status, STATUS_NEUTRAL);
        assert_eq!(result.required_monthly_cents, None);
    }

    #[test]
    fn a_passed_target_date_with_money_left_is_over() {
        let project = ProjectPaceRow {
            target_date: Some("2026-08-11".to_string()),
            ..row(600_000, 0, 10_000_000)
        };

        let result = compute(&project);

        assert_eq!(result.status, STATUS_OVER);
        // Past due clamps to one month upstream, so the whole remainder is required immediately.
        assert_eq!(result.required_monthly_cents, Some(600_000));
    }

    #[test]
    fn a_target_date_of_today_is_not_yet_passed() {
        let project = ProjectPaceRow {
            target_date: Some(TODAY.to_string()),
            ..row(600_000, 0, 3_000_000)
        };

        let result = compute(&project);

        assert_eq!(result.status, STATUS_GOOD);
        assert_eq!(result.required_monthly_cents, Some(600_000));
    }

    #[test]
    fn a_brand_new_project_with_no_contributions_is_neutral() {
        let project = ProjectPaceRow {
            created_at: "2026-08-01 09:30:00".to_string(),
            ..row(600_000, 0, 0)
        };

        let result = compute(&project);

        assert_eq!(result.status, STATUS_NEUTRAL);
        assert_eq!(result.required_monthly_cents, None);
        assert_eq!(result.actual_monthly_cents, None);
    }

    #[test]
    fn a_brand_new_project_that_already_contributed_is_judged() {
        let project = ProjectPaceRow {
            created_at: "2026-08-01 09:30:00".to_string(),
            ..row(600_000, 300_000, 300_000)
        };

        let result = compute(&project);

        assert_eq!(result.status, STATUS_GOOD);
        assert_eq!(result.required_monthly_cents, Some(50_000));
        assert_eq!(result.actual_monthly_cents, Some(100_000));
    }

    #[test]
    fn a_project_exactly_one_whole_month_old_is_judged() {
        let project = ProjectPaceRow {
            created_at: "2026-07-12 09:30:00".to_string(),
            ..six_months_out(0)
        };

        assert_eq!(compute(&project).status, STATUS_OVER);
    }

    #[test]
    fn an_unparseable_created_at_does_not_suppress_the_status() {
        let project = ProjectPaceRow {
            created_at: "whenever".to_string(),
            ..six_months_out(0)
        };

        assert_eq!(compute(&project).status, STATUS_OVER);
    }

    #[test]
    fn a_met_goal_is_good_regardless_of_pace() {
        let result = compute(&row(600_000, 600_000, 0));

        assert_eq!(result.status, STATUS_GOOD);
        assert_eq!(result.required_monthly_cents, None);
        assert_eq!(result.actual_monthly_cents, None);
    }

    #[test]
    fn an_overfunded_goal_is_good() {
        assert_eq!(compute(&row(600_000, 900_000, 0)).status, STATUS_GOOD);
    }

    // A met goal outranks every other gate, including a passed deadline and a missing one.
    #[test]
    fn a_met_goal_with_no_deadline_is_good_not_neutral() {
        let project = ProjectPaceRow {
            target_date: None,
            created_at: "2026-08-01 09:30:00".to_string(),
            ..row(600_000, 600_000, 0)
        };

        assert_eq!(compute(&project).status, STATUS_GOOD);
    }

    #[test]
    fn a_met_goal_after_a_passed_deadline_is_good() {
        let project = ProjectPaceRow {
            target_date: Some("2026-01-01".to_string()),
            ..row(600_000, 600_000, 0)
        };

        assert_eq!(compute(&project).status, STATUS_GOOD);
    }

    #[test]
    fn the_required_rate_rounds_up_so_the_target_is_actually_reached() {
        let project = ProjectPaceRow {
            target_date: Some("2026-11-12".to_string()),
            ..row(1_000, 0, 0)
        };

        assert_eq!(compute(&project).required_monthly_cents, Some(334));
    }

    #[test]
    fn the_actual_rate_is_the_trailing_window_divided_by_its_month_count() {
        assert_eq!(
            compute(&row(600_000, 0, 100_000)).actual_monthly_cents,
            Some(100_000 / RECENT_WINDOW_MONTHS)
        );
    }

    #[test]
    fn identical_inputs_produce_identical_output() {
        let project = row(777_777, 12_345, 98_765);

        assert_eq!(compute(&project), compute(&project));
    }
}
