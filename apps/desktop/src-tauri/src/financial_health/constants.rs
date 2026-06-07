pub const ESSENTIAL_GROUP_PATTERNS: &[&str] = &[
    "housing",
    "rent",
    "mortgage",
    "utilities",
    "grocery",
    "groceries",
    "insurance",
    "transport",
    "gas",
    "fuel",
    "health",
    "medical",
    "savings",
    "debt",
    "loan",
    "essential",
];

pub const DEFAULT_EMERGENCY_FUND_TARGET_MONTHS: i64 = 6;
pub const EMERGENCY_FUND_TARGET_CONFIG_KEY: &str = "emergency_fund_target_months";

/// CC balances at or below this share of trailing average monthly expenses are
/// treated as normal revolving use (e.g. paid off every statement), not blocking step 3.
/// Example: $300 on a card with $2,000/mo expenses → 15% → step 2 complete.
pub const CREDIT_CARD_DEBT_BUFFER_EXPENSE_RATIO: f64 = 0.15;

pub fn credit_card_debt_buffer_cents(avg_monthly_expenses_cents: i64) -> i64 {
    if avg_monthly_expenses_cents <= 0 {
        return 0;
    }
    (avg_monthly_expenses_cents as f64 * CREDIT_CARD_DEBT_BUFFER_EXPENSE_RATIO).round() as i64
}

pub fn is_credit_card_debt_complete(
    credit_card_debt_cents: i64,
    avg_monthly_expenses_cents: i64,
) -> bool {
    credit_card_debt_cents <= credit_card_debt_buffer_cents(avg_monthly_expenses_cents)
}

pub fn is_essential_group_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    ESSENTIAL_GROUP_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn essential_patterns_match_housing_and_rent() {
        assert!(is_essential_group_name("Housing"));
        assert!(is_essential_group_name("Monthly Rent"));
    }

    #[test]
    fn essential_patterns_match_case_insensitive_groceries() {
        assert!(is_essential_group_name("GROCERIES"));
        assert!(is_essential_group_name("Weekly Groceries"));
    }

    #[test]
    fn non_essential_group_names_are_not_matched() {
        assert!(!is_essential_group_name("Entertainment"));
        assert!(!is_essential_group_name("Dining Out"));
        assert!(!is_essential_group_name("Subscriptions"));
    }

    #[test]
    fn default_emergency_fund_target_is_six_months() {
        assert_eq!(DEFAULT_EMERGENCY_FUND_TARGET_MONTHS, 6);
    }

    #[test]
    fn credit_card_debt_buffer_is_fifteen_percent_of_expenses() {
        assert_eq!(credit_card_debt_buffer_cents(200_000), 30_000);
    }

    #[test]
    fn credit_card_debt_complete_when_at_or_below_buffer() {
        assert!(is_credit_card_debt_complete(30_000, 200_000));
        assert!(is_credit_card_debt_complete(0, 200_000));
        assert!(!is_credit_card_debt_complete(30_001, 200_000));
    }
}
