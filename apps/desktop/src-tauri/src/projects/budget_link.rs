//! The monthly commitment a savings project contributes to the budget.
//!
//! Pure: no `Connection`, no clock. The budget month is passed in, so the figure for a given month
//! is the same no matter when during that month it is read.

use chrono::NaiveDate;

use crate::projects::allocation::months_to_target;

/// A project is "dated" when its target date parses. An unparseable date is treated as no date, the
/// same degradation `allocation::months_to_target` applies, so the user-chosen amount stays in force
/// and stays editable.
pub(crate) fn is_dated(target_date: Option<&String>) -> bool {
    target_date
        .is_some_and(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
}

/// The budget target for `month_start`'s month.
///
/// Dated project: what is still missing at the START of the month, spread over the whole months left
/// from that day, rounded up. It deliberately ignores contributions made during the month, so the
/// target does not shrink as the user sets money aside — progress is shown against a fixed figure.
/// Undated (or unparseable date): the user-chosen amount stored on the category.
pub(crate) fn monthly_commitment_cents(
    target_cents: i64,
    saved_before_cents: i64,
    target_date: Option<&String>,
    month_start: NaiveDate,
    stored_target_cents: i64,
) -> i64 {
    if !is_dated(target_date) {
        return stored_target_cents;
    }

    let remaining_cents = target_cents.saturating_sub(saved_before_cents);
    if remaining_cents <= 0 {
        return 0;
    }

    // `months_to_target` clamps to at least 1, so a past-due or this-month date asks for the whole
    // remainder and the division below cannot be by zero.
    let Some(months) = months_to_target(Some(month_start), target_date) else {
        return stored_target_cents;
    };

    remaining_cents.saturating_add(months - 1) / months
}

#[cfg(test)]
mod tests {
    use super::*;

    fn november() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 1).expect("a valid date")
    }

    fn date(value: &str) -> Option<String> {
        Some(value.to_string())
    }

    #[test]
    fn the_remainder_is_spread_over_the_months_left_and_rounded_up() {
        // 6 months from Nov 1 to May 1: 100_000 / 6 = 16_666.67, rounded up.
        let target = monthly_commitment_cents(120_000, 20_000, date("2027-05-01").as_ref(), november(), 1);

        assert_eq!(target, 16_667);
    }

    #[test]
    fn an_even_split_is_not_rounded() {
        let target = monthly_commitment_cents(120_000, 0, date("2027-05-01").as_ref(), november(), 1);

        assert_eq!(target, 20_000);
    }

    #[test]
    fn a_reached_goal_commits_nothing() {
        for saved in [120_000, 150_000] {
            let target =
                monthly_commitment_cents(120_000, saved, date("2027-05-01").as_ref(), november(), 9_999);

            assert_eq!(target, 0, "saved {saved}");
        }
    }

    #[test]
    fn a_past_due_project_asks_for_the_whole_remainder() {
        let target = monthly_commitment_cents(120_000, 20_000, date("2026-08-01").as_ref(), november(), 1);

        assert_eq!(target, 100_000);
    }

    #[test]
    fn a_target_inside_the_month_asks_for_the_whole_remainder() {
        let target = monthly_commitment_cents(120_000, 20_000, date("2026-11-20").as_ref(), november(), 1);

        assert_eq!(target, 100_000);
    }

    #[test]
    fn an_undated_project_uses_the_stored_amount() {
        let target = monthly_commitment_cents(120_000, 20_000, None, november(), 7_500);

        assert_eq!(target, 7_500);
    }

    #[test]
    fn an_unparseable_date_uses_the_stored_amount() {
        let target = monthly_commitment_cents(120_000, 20_000, date("next spring").as_ref(), november(), 7_500);

        assert_eq!(target, 7_500);
        assert!(!is_dated(date("next spring").as_ref()));
    }

    #[test]
    fn identical_inputs_give_identical_output() {
        let first = monthly_commitment_cents(987_654, 12_345, date("2028-02-29").as_ref(), november(), 1);
        let second = monthly_commitment_cents(987_654, 12_345, date("2028-02-29").as_ref(), november(), 1);

        assert_eq!(first, second);
    }
}
