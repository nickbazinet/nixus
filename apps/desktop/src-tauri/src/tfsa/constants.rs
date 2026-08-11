/// First year the TFSA program existed. A floor, not an offset: nobody accrues
/// room for a year before the program existed, however long ago they turned 18.
pub const TFSA_FIRST_YEAR: i32 = 2009;

/// The last year `ANNUAL_LIMITS_CENTS` covers. Past it the figure is withheld
/// rather than extrapolated — see NFR9 below.
pub const KNOWN_THROUGH_YEAR: i32 = 2026;

// ⚠️ HUMAN VERIFICATION REQUIRED BEFORE MERGE.
//
// These values were supplied from model knowledge and were NOT fetched from
// canada.ca. A reviewer MUST verify every row below against the CRA's published
// TFSA contribution-limit table before this code is merged. An incorrect row
// produces a silently wrong dollar figure in a finance app — the worst possible
// failure mode for this feature, because the number looks authoritative and
// nothing errors. Two rows deserve extra scrutiny: 2015 is the one-off $10,000
// year (reduced back to $5,500 for 2016), and 2026 is the most recently
// announced limit and therefore the most likely to be wrong or unannounced.
//
// NFR9 — standing maintenance obligation: the CRA announces a new limit most
// Novembers and this table goes stale most Januaries. Every year a new limit is
// announced, this table gains a row AND `KNOWN_THROUGH_YEAR` is bumped in the
// same commit. The contiguity test below is what makes a half-update fail CI.
// If a row cannot be verified, drop it and lower `KNOWN_THROUGH_YEAR` together.
// Do NOT add a runtime fetch, a TTL cache, or a refresh path: the table ships
// with the app release, exactly like the bundled ISO 3166 dataset.
pub const ANNUAL_LIMITS_CENTS: &[(i32, i64)] = &[
    (2009, 500_000),
    (2010, 500_000),
    (2011, 500_000),
    (2012, 500_000),
    (2013, 550_000),
    (2014, 550_000),
    (2015, 1_000_000),
    (2016, 550_000),
    (2017, 550_000),
    (2018, 550_000),
    (2019, 600_000),
    (2020, 600_000),
    (2021, 600_000),
    (2022, 600_000),
    (2023, 650_000),
    (2024, 700_000),
    (2025, 700_000),
    (2026, 700_000),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_starts_at_the_first_tfsa_year() {
        assert_eq!(
            ANNUAL_LIMITS_CENTS.first().map(|(y, _)| *y),
            Some(TFSA_FIRST_YEAR)
        );
    }

    // The guard that makes a half-updated table fail CI instead of shipping: a
    // new row without a `KNOWN_THROUGH_YEAR` bump (or the reverse) fails here.
    #[test]
    fn table_last_year_equals_known_through_year() {
        assert_eq!(
            ANNUAL_LIMITS_CENTS.last().map(|(y, _)| *y),
            Some(KNOWN_THROUGH_YEAR)
        );
    }

    #[test]
    fn table_years_are_contiguous_with_no_gaps_or_duplicates() {
        for (index, (year, _)) in ANNUAL_LIMITS_CENTS.iter().enumerate() {
            assert_eq!(*year, TFSA_FIRST_YEAR + index as i32);
        }
    }

    #[test]
    fn table_covers_every_year_in_the_declared_range_exactly_once() {
        let expected_len = (KNOWN_THROUGH_YEAR - TFSA_FIRST_YEAR + 1) as usize;
        assert_eq!(ANNUAL_LIMITS_CENTS.len(), expected_len);
    }

    #[test]
    fn every_annual_limit_is_a_positive_whole_number_of_dollars() {
        for (year, cents) in ANNUAL_LIMITS_CENTS {
            assert!(*cents > 0, "{} has a non-positive limit", year);
            assert_eq!(*cents % 100, 0, "{} is not a whole number of dollars", year);
        }
    }

    #[test]
    fn twenty_fifteen_is_the_one_off_ten_thousand_dollar_year() {
        let entry = ANNUAL_LIMITS_CENTS.iter().find(|(y, _)| *y == 2015);
        assert_eq!(entry.map(|(_, c)| *c), Some(1_000_000));
        let after = ANNUAL_LIMITS_CENTS.iter().find(|(y, _)| *y == 2016);
        assert_eq!(after.map(|(_, c)| *c), Some(550_000));
    }

    // The NFR9 guard, and the only assertion in the suite that names the year as a
    // literal. Every behaviour test is written relative to the const so it survives
    // the annual bump; this one deliberately does NOT, so the table cannot be
    // extended — or the bound quietly moved to make a stale figure reappear —
    // without editing a test that says the year out loud. A silent January
    // rollover becomes a deliberate act with a reviewable diff.
    // Model: `financial_health/constants.rs::default_emergency_fund_target_is_six_months`.
    #[test]
    fn limits_table_is_known_through_2026() {
        assert_eq!(KNOWN_THROUGH_YEAR, 2026);
    }
}
