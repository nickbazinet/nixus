use chrono::{Datelike, NaiveDate};

use crate::models::{TfsaAccumulatedLimit, UserProfile};
use crate::tfsa::constants::{ANNUAL_LIMITS_CENTS, KNOWN_THROUGH_YEAR, TFSA_FIRST_YEAR};

/// The single decision point for shown-vs-withheld. Every withholding condition
/// returns `None`; nothing here approximates, truncates, or defaults.
///
/// It lives here rather than in `commands/profile.rs` because the command takes
/// an `AppHandle` and reads the keyring, so a gate placed there is testable only
/// through an E2E stub of the very command under test. `current_year` is a
/// parameter, not an inner clock read, for the same reason.
///
/// The country test is EXACT equality with `"CA"` — not `eq_ignore_ascii_case`,
/// not `to_uppercase()`, not `starts_with`, not the alpha-3 `"CAN"`. Story 29.1
/// validates `country_code` against the bundled ISO 3166-1 alpha-2 dataset on
/// write, so `"CA"` is the only value that can legitimately be stored; anything
/// else withholds rather than guessing what the user meant.
///
/// Takes no `State<DbState>` and holds no `Connection`, so subtracting a TFSA
/// account balance is unreachable here rather than merely forbidden.
pub fn accumulated_limit_for_profile(
    profile: Option<&UserProfile>,
    current_year: i32,
) -> Option<TfsaAccumulatedLimit> {
    let profile = profile?;

    if profile.country_code.as_deref() != Some("CA") {
        return None;
    }

    let birth_date = profile.birth_date.as_deref()?;

    accumulated_limit(birth_date, current_year)
}

/// Total TFSA contribution room accumulated over a lifetime, in integer cents.
///
/// `current_year` is a parameter and is never read from the clock here — that is
/// what makes the past-the-bound case testable without freezing the system
/// clock. The single `Local::now()` call lives in the command.
///
/// Eligibility is by CALENDAR YEAR, not by birthday: CRA room accrues for the
/// whole year in which someone turns 18, so this uses `birth_year + 18` and
/// never compares month or day. There is no proration.
///
/// `None` means "withhold the figure" and is a normal outcome, never an error:
/// an unparseable `birth_date`, a `current_year` past the limits table's bound
/// (never extrapolate), or someone not yet eligible in `current_year`.
///
/// This never subtracts a TFSA account balance and never returns remaining
/// room. Nixus tracks balances, not contributions; a balance includes market
/// growth and ignores withdrawals, so remaining room is not computable from
/// available data and would be wrong in both directions.
pub fn accumulated_limit(birth_date: &str, current_year: i32) -> Option<TfsaAccumulatedLimit> {
    if current_year > KNOWN_THROUGH_YEAR {
        return None;
    }

    let birth_year = NaiveDate::parse_from_str(birth_date.trim(), "%Y-%m-%d")
        .ok()?
        .year();

    let eligible_from_year = birth_year.checked_add(18)?.max(TFSA_FIRST_YEAR);
    if eligible_from_year > current_year {
        return None;
    }

    let mut total_cents: i64 = 0;
    for (year, cents) in ANNUAL_LIMITS_CENTS {
        if *year >= eligible_from_year && *year <= current_year {
            total_cents += cents;
        }
    }

    Some(TfsaAccumulatedLimit {
        total_cents,
        eligible_from_year,
        known_through_year: KNOWN_THROUGH_YEAR,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn born_before_the_program_existed_accrues_from_the_first_tfsa_year() {
        // Turned 18 in 2003, six years before TFSAs existed: 2009 is a floor,
        // not an offset, so nothing accrues for 2003-2008.
        let result = accumulated_limit("1985-06-15", KNOWN_THROUGH_YEAR).unwrap();
        assert_eq!(result.eligible_from_year, 2009);
        assert_eq!(result.total_cents, 10_900_000);
        assert_eq!(result.known_through_year, KNOWN_THROUGH_YEAR);
    }

    #[test]
    fn born_after_the_program_existed_accrues_from_the_year_they_turned_eighteen() {
        let result = accumulated_limit("2000-11-30", KNOWN_THROUGH_YEAR).unwrap();
        assert_eq!(result.eligible_from_year, 2018);
        assert_eq!(result.total_cents, 5_700_000);
    }

    #[test]
    fn turning_eighteen_in_the_current_year_accrues_that_full_year() {
        // No proration: room accrues for the whole calendar year in which the
        // 18th birthday falls, whatever the month.
        let birth_date = format!("{}-12-31", KNOWN_THROUGH_YEAR - 18);
        let result = accumulated_limit(&birth_date, KNOWN_THROUGH_YEAR).unwrap();
        assert_eq!(result.eligible_from_year, KNOWN_THROUGH_YEAR);
        assert_eq!(result.total_cents, 700_000);
    }

    #[test]
    fn first_year_past_the_table_bound_withholds_the_figure() {
        // Expressed against the bound, not a literal year, so the annual table
        // bump cannot silently invert this test's meaning.
        assert!(accumulated_limit("1985-06-15", KNOWN_THROUGH_YEAR + 1).is_none());
    }

    #[test]
    fn unparseable_or_empty_birth_date_withholds_the_figure() {
        assert!(accumulated_limit("", KNOWN_THROUGH_YEAR).is_none());
        assert!(accumulated_limit("not-a-date", KNOWN_THROUGH_YEAR).is_none());
        assert!(accumulated_limit("1985-06", KNOWN_THROUGH_YEAR).is_none());
        assert!(accumulated_limit("06/15/1985", KNOWN_THROUGH_YEAR).is_none());
        assert!(accumulated_limit("1985-13-01", KNOWN_THROUGH_YEAR).is_none());
    }

    #[test]
    fn not_yet_eighteen_in_the_current_year_withholds_the_figure() {
        let birth_date = format!("{}-01-01", KNOWN_THROUGH_YEAR - 17);
        assert!(accumulated_limit(&birth_date, KNOWN_THROUGH_YEAR).is_none());
    }

    #[test]
    fn totals_are_bounded_by_the_current_year_not_the_table_bound() {
        let result = accumulated_limit("1985-06-15", 2009).unwrap();
        assert_eq!(result.eligible_from_year, 2009);
        assert_eq!(result.total_cents, 500_000);
    }

    // A long-abandoned build must not degrade differently from a one-year-stale
    // one. 30.1 tests `bound + 1`; this is the far-future complement.
    #[test]
    fn many_years_past_the_table_bound_still_withholds_the_figure() {
        assert!(accumulated_limit("1985-06-15", KNOWN_THROUGH_YEAR + 5).is_none());
    }

    // A future birth date parses cleanly, so 30.1's parse guard does not catch
    // it; the empty-eligibility-range guard does. Unreachable through the form
    // (Story 28.3 rejects it on write) and therefore only ever exercised here.
    #[test]
    fn a_birth_date_in_the_future_withholds_the_figure() {
        assert!(accumulated_limit("2099-01-01", KNOWN_THROUGH_YEAR).is_none());
    }

    // The shape of the answer is the point: `None`, never `Some { total_cents: 0 }`.
    // Zero is a claim — "you have accumulated no room" — and it is wrong.
    #[test]
    fn turning_eighteen_after_the_current_year_is_none_not_a_zero_total() {
        let birth_date = format!("{}-01-01", KNOWN_THROUGH_YEAR - 10);
        let result = accumulated_limit(&birth_date, KNOWN_THROUGH_YEAR);
        assert!(result.is_none());
    }

    fn base_profile() -> UserProfile {
        UserProfile {
            schema_version: 1,
            cognito_sub: "sub-123".to_string(),
            first_name: Some("Ada".to_string()),
            last_name: Some("Lovelace".to_string()),
            birth_date: Some("1985-06-15".to_string()),
            income_bracket: None,
            income_bracket_currency: None,
            country_code: Some("CA".to_string()),
            subdivision_code: None,
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
            updated_at: "2026-01-01T00:00:00+00:00".to_string(),
        }
    }

    // The positive control: without it the whole matrix below would also pass
    // against a function that unconditionally returns `None`.
    #[test]
    fn a_canadian_profile_with_a_valid_birth_date_yields_the_figure() {
        let profile = base_profile();
        let result = accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).unwrap();
        assert_eq!(result.eligible_from_year, 2009);
        assert_eq!(result.total_cents, 10_900_000);
        assert_eq!(result.known_through_year, KNOWN_THROUGH_YEAR);
    }

    #[test]
    fn no_profile_document_at_all_withholds_the_figure() {
        assert!(accumulated_limit_for_profile(None, KNOWN_THROUGH_YEAR).is_none());
    }

    #[test]
    fn an_unset_country_withholds_the_figure() {
        let profile = UserProfile {
            country_code: None,
            ..base_profile()
        };
        assert!(accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).is_none());
    }

    #[test]
    fn a_non_canadian_country_withholds_the_figure() {
        for code in ["US", "FR", "JP", "GB"] {
            let profile = UserProfile {
                country_code: Some(code.to_string()),
                ..base_profile()
            };
            assert!(
                accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).is_none(),
                "{} should withhold the figure",
                code
            );
        }
    }

    // The near-misses are the ones a case-insensitive or alpha-3-tolerant gate
    // would wrongly let through. `save_profile` cannot store either value, so a
    // match here would mean guessing at a hand-edited document.
    #[test]
    fn country_matching_is_exact_so_near_misses_withhold_the_figure() {
        for code in ["ca", "Ca", "CAN", "CA "] {
            let profile = UserProfile {
                country_code: Some(code.to_string()),
                ..base_profile()
            };
            assert!(
                accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).is_none(),
                "{:?} should withhold the figure",
                code
            );
        }
    }

    #[test]
    fn a_canadian_profile_with_no_birth_date_withholds_the_figure() {
        let profile = UserProfile {
            birth_date: None,
            ..base_profile()
        };
        assert!(accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).is_none());
    }

    // The gate returns the calculator's `None`s verbatim rather than reinterpreting
    // them, so a stored date the form could never have written still withholds.
    #[test]
    fn the_gate_passes_through_the_calculators_own_withholding_conditions() {
        for birth_date in ["", "not-a-date", "2099-01-01"] {
            let profile = UserProfile {
                birth_date: Some(birth_date.to_string()),
                ..base_profile()
            };
            assert!(
                accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).is_none(),
                "{:?} should withhold the figure",
                birth_date
            );
        }

        let profile = base_profile();
        assert!(accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR + 1).is_none());
    }

    // Row 9 of the degradation matrix. The figure is a function of
    // (country_code, birth_date, current_year) and nothing else — no account, no
    // balance, no deduction, no run-to-run variation.
    #[test]
    fn identical_inputs_produce_identical_output() {
        let profile = base_profile();
        let first = accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).unwrap();
        let second = accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).unwrap();
        assert_eq!(first.total_cents, second.total_cents);
        assert_eq!(first.eligible_from_year, second.eligible_from_year);
        assert_eq!(first.known_through_year, second.known_through_year);
    }

    // The single most important assertion in Story 30.2: the returned total is the
    // FULL sum of every annual limit in the eligible range, with nothing deducted.
    // A balance includes market growth and ignores withdrawals, so subtracting one
    // would produce a figure wrong in both directions with no way to tell which.
    // Computed here from the table rather than restated as a literal, so the
    // assertion is "no deduction" rather than "equals some number".
    #[test]
    fn the_total_is_the_undeducted_sum_of_every_eligible_annual_limit() {
        let profile = base_profile();
        let result = accumulated_limit_for_profile(Some(&profile), KNOWN_THROUGH_YEAR).unwrap();

        let undeducted_sum: i64 = ANNUAL_LIMITS_CENTS
            .iter()
            .filter(|(year, _)| {
                *year >= result.eligible_from_year && *year <= KNOWN_THROUGH_YEAR
            })
            .map(|(_, cents)| *cents)
            .sum();

        assert_eq!(result.total_cents, undeducted_sum);
        assert!(result.total_cents > 0);
    }
}
