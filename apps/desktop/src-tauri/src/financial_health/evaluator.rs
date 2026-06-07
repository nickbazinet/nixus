use serde::{Deserialize, Serialize};

use super::constants::is_credit_card_debt_complete;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WaterfallStep {
    BuildEmergencyFund,
    PayHighInterestDebt,
    ContributeRegisteredAccounts,
    InvestSurplus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReasoningParams {
    pub coverage_months: Option<f64>,
    pub target_months: i64,
    pub credit_card_debt_cents: i64,
    pub avg_monthly_surplus_cents: i64,
    pub liquid_savings_cents: i64,
    pub avg_monthly_expenses_cents: i64,
}

#[derive(Debug, Clone)]
pub struct WaterfallEvalInput {
    pub data_sufficient: bool,
    pub coverage_months: Option<f64>,
    pub target_months: i64,
    pub credit_card_debt_cents: i64,
    pub avg_monthly_surplus_cents: i64,
    pub liquid_savings_cents: i64,
    pub avg_monthly_expenses_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WaterfallEvaluation {
    pub current_step: WaterfallStep,
    pub completed_steps: Vec<WaterfallStep>,
    pub reasoning_key: String,
    pub reasoning_params: ReasoningParams,
}

pub fn evaluate_waterfall(input: &WaterfallEvalInput) -> WaterfallEvaluation {
    let reasoning_params = ReasoningParams {
        coverage_months: input.coverage_months,
        target_months: input.target_months,
        credit_card_debt_cents: input.credit_card_debt_cents,
        avg_monthly_surplus_cents: input.avg_monthly_surplus_cents,
        liquid_savings_cents: input.liquid_savings_cents,
        avg_monthly_expenses_cents: input.avg_monthly_expenses_cents,
    };

    let emergency_fund_complete = input.data_sufficient
        && input
            .coverage_months
            .is_some_and(|months| months >= input.target_months as f64);
    let debt_complete = is_credit_card_debt_complete(
        input.credit_card_debt_cents,
        input.avg_monthly_expenses_cents,
    );

    let mut completed_steps = Vec::new();
    if emergency_fund_complete {
        completed_steps.push(WaterfallStep::BuildEmergencyFund);
    }
    if emergency_fund_complete && debt_complete {
        completed_steps.push(WaterfallStep::PayHighInterestDebt);
    }

    let (current_step, reasoning_key) = if !input.data_sufficient
        || !emergency_fund_complete
    {
        (WaterfallStep::BuildEmergencyFund, "build_emergency_fund")
    } else if !debt_complete {
        (WaterfallStep::PayHighInterestDebt, "pay_debt")
    } else if input.avg_monthly_surplus_cents > 0 {
        (
            WaterfallStep::ContributeRegisteredAccounts,
            "contribute_registered",
        )
    } else {
        (WaterfallStep::InvestSurplus, "invest_surplus")
    };

    WaterfallEvaluation {
        current_step,
        completed_steps,
        reasoning_key: reasoning_key.to_string(),
        reasoning_params,
    }
}

pub fn compute_coverage_months(
    liquid_savings_cents: i64,
    avg_monthly_expenses_cents: i64,
    expense_month_count: i64,
) -> (bool, Option<f64>) {
    if expense_month_count == 0 || avg_monthly_expenses_cents == 0 {
        return (false, None);
    }

    let coverage = liquid_savings_cents as f64 / avg_monthly_expenses_cents as f64;
    (true, Some(coverage))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> WaterfallEvalInput {
        WaterfallEvalInput {
            data_sufficient: true,
            coverage_months: Some(8.0),
            target_months: 6,
            credit_card_debt_cents: 0,
            avg_monthly_surplus_cents: 50000,
            liquid_savings_cents: 480000,
            avg_monthly_expenses_cents: 60000,
        }
    }

    #[test]
    fn build_emergency_fund_wins_when_coverage_below_target() {
        let input = WaterfallEvalInput {
            coverage_months: Some(3.0),
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::BuildEmergencyFund);
        assert_eq!(eval.reasoning_key, "build_emergency_fund");
        assert!(eval.completed_steps.is_empty());
    }

    #[test]
    fn pay_high_interest_debt_wins_when_fund_met_but_cc_debt_above_buffer() {
        let input = WaterfallEvalInput {
            credit_card_debt_cents: 250000,
            avg_monthly_expenses_cents: 200000,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::PayHighInterestDebt);
        assert_eq!(eval.reasoning_key, "pay_debt");
        assert_eq!(eval.completed_steps, vec![WaterfallStep::BuildEmergencyFund]);
    }

    #[test]
    fn small_cc_debt_within_buffer_advances_past_pay_debt() {
        let input = WaterfallEvalInput {
            credit_card_debt_cents: 30000,
            avg_monthly_expenses_cents: 200000,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(
            eval.current_step,
            WaterfallStep::ContributeRegisteredAccounts
        );
        assert_eq!(
            eval.completed_steps,
            vec![
                WaterfallStep::BuildEmergencyFund,
                WaterfallStep::PayHighInterestDebt,
            ]
        );
    }

    #[test]
    fn cc_debt_one_cent_above_buffer_stays_on_pay_debt() {
        let input = WaterfallEvalInput {
            credit_card_debt_cents: 30001,
            avg_monthly_expenses_cents: 200000,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::PayHighInterestDebt);
    }

    #[test]
    fn contribute_registered_accounts_wins_when_fund_and_debt_complete_with_surplus() {
        let eval = evaluate_waterfall(&base_input());
        assert_eq!(
            eval.current_step,
            WaterfallStep::ContributeRegisteredAccounts
        );
        assert_eq!(eval.reasoning_key, "contribute_registered");
        assert_eq!(
            eval.completed_steps,
            vec![
                WaterfallStep::BuildEmergencyFund,
                WaterfallStep::PayHighInterestDebt,
            ]
        );
    }

    #[test]
    fn invest_surplus_is_terminal_when_no_surplus() {
        let input = WaterfallEvalInput {
            avg_monthly_surplus_cents: 0,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::InvestSurplus);
        assert_eq!(eval.reasoning_key, "invest_surplus");
    }

    #[test]
    fn invest_surplus_when_deficit() {
        let input = WaterfallEvalInput {
            avg_monthly_surplus_cents: -10000,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::InvestSurplus);
    }

    #[test]
    fn insufficient_expense_history_returns_build_emergency_fund_with_null_coverage() {
        let input = WaterfallEvalInput {
            data_sufficient: false,
            coverage_months: None,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::BuildEmergencyFund);
        assert!(eval.reasoning_params.coverage_months.is_none());
    }

    #[test]
    fn coverage_exactly_at_target_advances_past_emergency_fund_step() {
        let input = WaterfallEvalInput {
            coverage_months: Some(6.0),
            target_months: 6,
            credit_card_debt_cents: 10000,
            avg_monthly_surplus_cents: 0,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::PayHighInterestDebt);
        assert_eq!(eval.completed_steps, vec![WaterfallStep::BuildEmergencyFund]);
    }

    #[test]
    fn zero_credit_card_debt_skips_pay_debt_step() {
        let input = WaterfallEvalInput {
            avg_monthly_surplus_cents: 0,
            credit_card_debt_cents: 0,
            ..base_input()
        };
        let eval = evaluate_waterfall(&input);
        assert_eq!(eval.current_step, WaterfallStep::InvestSurplus);
        assert_eq!(
            eval.completed_steps,
            vec![
                WaterfallStep::BuildEmergencyFund,
                WaterfallStep::PayHighInterestDebt,
            ]
        );
    }

    #[test]
    fn identical_inputs_produce_identical_output() {
        let input = base_input();
        let first = evaluate_waterfall(&input);
        let second = evaluate_waterfall(&input);
        assert_eq!(first, second);
    }

    #[test]
    fn reasoning_key_never_contains_product_names_or_tickers() {
        let cases = [
            WaterfallEvalInput {
                coverage_months: Some(1.0),
                target_months: 6,
                ..base_input()
            },
            WaterfallEvalInput {
                credit_card_debt_cents: 50000,
                ..base_input()
            },
            base_input(),
            WaterfallEvalInput {
                avg_monthly_surplus_cents: 0,
                ..base_input()
            },
        ];

        for input in cases {
            let eval = evaluate_waterfall(&input);
            let key = eval.reasoning_key.to_lowercase();
            assert!(!key.contains("vti"));
            assert!(!key.contains("xeqt"));
            assert!(!key.contains("etf"));
            assert!(!key.contains("stock"));
            assert!(
                matches!(
                    eval.reasoning_key.as_str(),
                    "build_emergency_fund" | "pay_debt" | "contribute_registered" | "invest_surplus"
                )
            );
        }
    }

    #[test]
    fn waterfall_step_serializes_as_snake_case() {
        let json = serde_json::to_string(&WaterfallStep::PayHighInterestDebt).unwrap();
        assert_eq!(json, "\"pay_high_interest_debt\"");
    }

    #[test]
    fn compute_coverage_months_returns_false_when_no_expense_history() {
        let (sufficient, coverage) = compute_coverage_months(100000, 0, 0);
        assert!(!sufficient);
        assert!(coverage.is_none());
    }

    #[test]
    fn compute_coverage_months_calculates_ratio() {
        let (sufficient, coverage) = compute_coverage_months(300000, 100000, 3);
        assert!(sufficient);
        assert_eq!(coverage, Some(3.0));
    }
}
