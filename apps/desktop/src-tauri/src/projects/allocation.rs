use chrono::{Datelike, NaiveDate};

use crate::error::AppError;
use crate::financial_health::evaluator::WaterfallStep;
use crate::models::ProjectAllocationSuggestion;

pub const PRIORITY_WEIGHT_SCALE: i64 = 1000;
pub const URGENCY_WEIGHT_SCALE: i64 = 1000;

#[derive(Debug, Clone)]
pub struct AllocationProject {
    pub project_id: i64,
    pub name: String,
    pub priority: i32,
    pub target_cents: i64,
    pub saved_cents: i64,
    pub target_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AllocationInput {
    pub current_step: WaterfallStep,
    pub avg_monthly_surplus_cents: i64,
    /// ISO 8601 `YYYY-MM-DD`. Injected, never read from the clock inside this module.
    pub today: String,
    pub projects: Vec<AllocationProject>,
}

fn is_allocation_step(step: &WaterfallStep) -> bool {
    matches!(
        step,
        WaterfallStep::ContributeRegisteredAccounts | WaterfallStep::InvestSurplus
    )
}

// A partial month does not count, so a target on an earlier day-of-month than today loses one whole
// month: (2026-08-11 → 2026-10-01) is 1 month, (2026-08-11 → 2026-10-11) is 2.
// `pub(crate)` for `projects::pace`, which must judge pace against the exact same month arithmetic
// the suggestion uses: two implementations of "how many whole months are left" would let the badge
// and the suggested amount disagree on a date boundary.
pub(crate) fn whole_months(today: NaiveDate, target: NaiveDate) -> i64 {
    let months = (i64::from(target.year()) - i64::from(today.year())) * 12
        + (i64::from(target.month()) - i64::from(today.month()));

    if target.day() < today.day() {
        months - 1
    } else {
        months
    }
}

// A past-due or this-month target clamps to one month, which makes it maximally urgent instead of
// dividing `remaining` by zero or a negative month count. An absent or unparseable date degrades to
// "no deadline" rather than failing the whole suggestion: `target_date` is a nullable free-text ISO
// column with no CHECK constraint, so bad data is representable.
pub(crate) fn months_to_target(today: Option<NaiveDate>, target_date: Option<&String>) -> Option<i64> {
    let target = NaiveDate::parse_from_str(target_date?, "%Y-%m-%d").ok()?;
    Some(whole_months(today?, target).max(1))
}

struct AllocationEntry<'a> {
    project: &'a AllocationProject,
    remaining_cents: i64,
    priority_rank: i32,
    months_to_target: Option<i64>,
    weight: i64,
    suggested_cents: i64,
}

impl AllocationEntry<'_> {
    fn required_monthly_cents(&self) -> i64 {
        // `months_to_target` is clamped to at least 1 when it is built, so this cannot divide by zero.
        let Some(months) = self.months_to_target else {
            return 0;
        };

        self.remaining_cents.saturating_add(months - 1) / months
    }
}

fn eligible_entries(input: &AllocationInput) -> Vec<AllocationEntry<'_>> {
    let today = NaiveDate::parse_from_str(&input.today, "%Y-%m-%d").ok();

    let mut entries: Vec<AllocationEntry<'_>> = input
        .projects
        .iter()
        .filter_map(|project| {
            let remaining_cents = project.target_cents.saturating_sub(project.saved_cents);
            if remaining_cents <= 0 {
                return None;
            }

            Some(AllocationEntry {
                project,
                remaining_cents,
                priority_rank: 0,
                months_to_target: months_to_target(today, project.target_date.as_ref()),
                weight: 0,
                suggested_cents: 0,
            })
        })
        .collect();

    entries.sort_by(|left, right| {
        left.project
            .priority
            .cmp(&right.project.priority)
            .then_with(|| left.project.project_id.cmp(&right.project.project_id))
    });

    let mut rank: i32 = 0;
    let mut previous_priority: Option<i32> = None;
    for entry in &mut entries {
        if previous_priority.is_some_and(|previous| previous != entry.project.priority) {
            rank = rank.saturating_add(1);
        }
        previous_priority = Some(entry.project.priority);
        entry.priority_rank = rank;
    }

    entries
}

// Both inputs are scaled to 0..1000 before they are added so priority and deadline have exactly equal
// maximum influence. Urgency is normalised against the most urgent project's required monthly amount
// rather than used raw, because a raw cents figure in the hundreds of thousands would make the
// ~1000-scale priority weight arithmetically irrelevant.
fn assign_weights(entries: &mut [AllocationEntry<'_>]) {
    let required_monthly: Vec<i64> = entries
        .iter()
        .map(AllocationEntry::required_monthly_cents)
        .collect();
    let max_required_cents = required_monthly.iter().copied().max().unwrap_or(0);

    for (entry, required_cents) in entries.iter_mut().zip(required_monthly) {
        let priority_weight =
            (PRIORITY_WEIGHT_SCALE / (1 + i64::from(entry.priority_rank))).max(1);

        let urgency_weight = if max_required_cents == 0 {
            0
        } else {
            (i128::from(URGENCY_WEIGHT_SCALE) * i128::from(required_cents)
                / i128::from(max_required_cents)) as i64
        };

        entry.weight = priority_weight + urgency_weight;
    }
}

// `total_weight` is at least 1 because every priority weight is floored at 1 and the caller has
// already returned early on an empty list, so the division is safe.
//
// Floor division alone leaves up to n-1 cents unassigned, and the cap at `remaining_cents` can free a
// much larger amount, so one pass in priority order reassigns both: the freed money goes to the
// highest-priority project that can still absorb it. That cap plus this pass is what makes
// `Σ suggested == min(allocatable, Σ remaining)` hold exactly.
fn distribute(entries: &mut [AllocationEntry<'_>], allocatable_cents: i64) {
    let total_weight: i64 = entries.iter().map(|entry| entry.weight).sum();

    for entry in entries.iter_mut() {
        let raw_cents = (i128::from(allocatable_cents) * i128::from(entry.weight)
            / i128::from(total_weight)) as i64;
        entry.suggested_cents = raw_cents.min(entry.remaining_cents);
    }

    let assigned_cents: i64 = entries.iter().map(|entry| entry.suggested_cents).sum();
    let mut leftover_cents = allocatable_cents - assigned_cents;

    for entry in entries.iter_mut() {
        if leftover_cents == 0 {
            break;
        }

        let give_cents = leftover_cents.min(entry.remaining_cents - entry.suggested_cents);
        entry.suggested_cents += give_cents;
        leftover_cents -= give_cents;
    }
}

pub fn compute_suggested_allocation(
    input: &AllocationInput,
) -> Vec<ProjectAllocationSuggestion> {
    if !is_allocation_step(&input.current_step) {
        return Vec::new();
    }

    if input.avg_monthly_surplus_cents <= 0 {
        return Vec::new();
    }

    let mut entries = eligible_entries(input);
    if entries.is_empty() {
        return Vec::new();
    }

    assign_weights(&mut entries);
    distribute(&mut entries, input.avg_monthly_surplus_cents);

    entries
        .into_iter()
        .map(|entry| ProjectAllocationSuggestion {
            project_id: entry.project.project_id,
            project_name: entry.project.name.clone(),
            suggested_cents: entry.suggested_cents,
            remaining_cents: entry.remaining_cents,
            target_cents: entry.project.target_cents,
            saved_cents: entry.project.saved_cents,
            target_date: entry.project.target_date.clone(),
            months_to_target: entry.months_to_target,
            priority_rank: entry.priority_rank,
            weight: entry.weight,
        })
        .collect()
}

// The only fallible function in this module, and the backend half of two contracts the frontend also
// implements: FR6's step gate (a `source = "suggested"` row may only exist for an allocation the app
// was willing to suggest) and FR7's inclusive cap, which must match `validateAllocationTotal` in
// `src/lib/allocation.ts` exactly or the UI enables a confirm the backend then refuses. The step is
// re-read at confirm time because it can change after the panel was rendered.
pub fn guard_confirmable(
    current_step: &WaterfallStep,
    avg_monthly_surplus_cents: i64,
    total_cents: i64,
) -> Result<(), AppError> {
    if !is_allocation_step(current_step) {
        return Err(AppError::Validation {
            message:
                "Savings goals come after the emergency fund and high-interest debt are handled"
                    .to_string(),
            field: None,
        });
    }

    if total_cents > avg_monthly_surplus_cents {
        return Err(AppError::Validation {
            message: format!(
                "The confirmed total of {total_cents} cents exceeds the available monthly surplus of {avg_monthly_surplus_cents} cents"
            ),
            field: Some("amount_cents".to_string()),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(project_id: i64, priority: i32, remaining_cents: i64) -> AllocationProject {
        AllocationProject {
            project_id,
            name: format!("Project {project_id}"),
            priority,
            target_cents: remaining_cents,
            saved_cents: 0,
            target_date: None,
        }
    }

    fn dated_project(
        project_id: i64,
        priority: i32,
        remaining_cents: i64,
        target_date: &str,
    ) -> AllocationProject {
        AllocationProject {
            target_date: Some(target_date.to_string()),
            ..project(project_id, priority, remaining_cents)
        }
    }

    fn base_input() -> AllocationInput {
        AllocationInput {
            current_step: WaterfallStep::ContributeRegisteredAccounts,
            avg_monthly_surplus_cents: 100_000,
            today: "2026-08-11".to_string(),
            projects: vec![project(1, 0, 1_000_000), project(2, 0, 1_000_000)],
        }
    }

    #[test]
    fn build_emergency_fund_step_suggests_nothing() {
        let input = AllocationInput {
            current_step: WaterfallStep::BuildEmergencyFund,
            ..base_input()
        };

        assert!(compute_suggested_allocation(&input).is_empty());
    }

    #[test]
    fn pay_high_interest_debt_step_suggests_nothing() {
        let input = AllocationInput {
            current_step: WaterfallStep::PayHighInterestDebt,
            ..base_input()
        };

        assert!(compute_suggested_allocation(&input).is_empty());
    }

    #[test]
    fn contribute_registered_accounts_step_suggests_something() {
        assert_eq!(compute_suggested_allocation(&base_input()).len(), 2);
    }

    // Why this test exists even though today's evaluator only picks `InvestSurplus` when the surplus
    // is not positive (evaluator.rs:76-83): FR6 names both steps, so the gate's contract is
    // independent of which caller reaches it and of the evaluator's current ladder. Do not delete
    // this as unreachable.
    #[test]
    fn invest_surplus_step_with_a_positive_surplus_suggests_something() {
        let input = AllocationInput {
            current_step: WaterfallStep::InvestSurplus,
            ..base_input()
        };

        assert_eq!(compute_suggested_allocation(&input).len(), 2);
    }

    #[test]
    fn zero_surplus_suggests_nothing() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 0,
            ..base_input()
        };

        assert!(compute_suggested_allocation(&input).is_empty());
    }

    #[test]
    fn negative_surplus_suggests_nothing() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: -10_000,
            ..base_input()
        };

        assert!(compute_suggested_allocation(&input).is_empty());
    }

    #[test]
    fn no_projects_suggests_nothing() {
        let input = AllocationInput {
            projects: vec![],
            ..base_input()
        };

        assert!(compute_suggested_allocation(&input).is_empty());
    }

    fn amounts(suggestions: &[ProjectAllocationSuggestion]) -> Vec<i64> {
        suggestions
            .iter()
            .map(|suggestion| suggestion.suggested_cents)
            .collect()
    }

    fn weights(suggestions: &[ProjectAllocationSuggestion]) -> Vec<i64> {
        suggestions.iter().map(|suggestion| suggestion.weight).collect()
    }

    fn amount_for(suggestions: &[ProjectAllocationSuggestion], project_id: i64) -> i64 {
        suggestions
            .iter()
            .find(|suggestion| suggestion.project_id == project_id)
            .map(|suggestion| suggestion.suggested_cents)
            .expect("expected a suggestion for the project")
    }

    #[test]
    fn equal_priority_no_deadline_splits_evenly() {
        let suggestions = compute_suggested_allocation(&base_input());

        assert_eq!(amounts(&suggestions), vec![50_000, 50_000]);
        assert_eq!(weights(&suggestions), vec![1000, 1000]);
    }

    #[test]
    fn higher_priority_gets_more() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 300_000,
            projects: vec![project(1, 0, 10_000_000), project(2, 1, 10_000_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(weights(&suggestions), vec![1000, 500]);
        assert_eq!(amounts(&suggestions), vec![200_000, 100_000]);
    }

    #[test]
    fn reversing_priority_reverses_the_split() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 300_000,
            projects: vec![project(1, 1, 10_000_000), project(2, 0, 10_000_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(amount_for(&suggestions, 1), 100_000);
        assert_eq!(amount_for(&suggestions, 2), 200_000);
    }

    #[test]
    fn nearer_deadline_gets_larger_share() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 320_000,
            projects: vec![
                dated_project(1, 0, 1_000_000, "2026-10-11"),
                dated_project(2, 0, 1_000_000, "2027-06-11"),
            ],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.months_to_target)
                .collect::<Vec<_>>(),
            vec![Some(2), Some(10)]
        );
        assert_eq!(weights(&suggestions), vec![2000, 1200]);
        assert_eq!(amounts(&suggestions), vec![200_000, 120_000]);
    }

    #[test]
    fn three_dense_ranks_split_1000_500_333() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 183_300,
            projects: vec![
                project(1, 0, 10_000_000),
                project(2, 1, 10_000_000),
                project(3, 2, 10_000_000),
            ],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(weights(&suggestions), vec![1000, 500, 333]);
        assert_eq!(amounts(&suggestions), vec![100_000, 50_000, 33_300]);
    }

    #[test]
    fn ties_in_priority_share_the_same_rank() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 250_000,
            projects: vec![
                project(1, 0, 10_000_000),
                project(2, 0, 10_000_000),
                project(3, 5, 10_000_000),
            ],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.priority_rank)
                .collect::<Vec<_>>(),
            vec![0, 0, 1]
        );
        assert_eq!(weights(&suggestions), vec![1000, 1000, 500]);
        assert_eq!(amounts(&suggestions), vec![100_000, 100_000, 50_000]);
    }

    #[test]
    fn deadline_urgency_is_relative_to_the_most_urgent_project() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 400_000,
            projects: vec![
                project(1, 0, 600_000),
                dated_project(2, 0, 600_000, "2026-11-11"),
                project(3, 0, 600_000),
            ],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(weights(&suggestions), vec![1000, 2000, 1000]);
        assert_eq!(amounts(&suggestions), vec![100_000, 200_000, 100_000]);
    }

    fn funded_project(project_id: i64, target_cents: i64, saved_cents: i64) -> AllocationProject {
        AllocationProject {
            saved_cents,
            ..project(project_id, 0, target_cents)
        }
    }

    fn total(suggestions: &[ProjectAllocationSuggestion]) -> i64 {
        suggestions
            .iter()
            .map(|suggestion| suggestion.suggested_cents)
            .sum()
    }

    fn varied_inputs() -> Vec<AllocationInput> {
        vec![
            base_input(),
            AllocationInput {
                avg_monthly_surplus_cents: 1,
                ..base_input()
            },
            AllocationInput {
                avg_monthly_surplus_cents: 100_000,
                projects: vec![project(1, 0, 5_000), project(2, 0, 1_000_000)],
                ..base_input()
            },
            AllocationInput {
                avg_monthly_surplus_cents: 7_777,
                projects: vec![
                    project(1, 0, 3_000),
                    dated_project(2, 1, 900_000, "2026-09-01"),
                    dated_project(3, 2, 250_000, "2025-01-01"),
                ],
                ..base_input()
            },
            AllocationInput {
                avg_monthly_surplus_cents: 1_000_000,
                projects: vec![
                    project(1, 0, 2_000),
                    project(2, 0, 4_000),
                    funded_project(3, 500_000, 500_000),
                ],
                ..base_input()
            },
            AllocationInput {
                avg_monthly_surplus_cents: 333_333,
                projects: vec![
                    dated_project(9, 3, 1_500_000, "2027-02-28"),
                    project(4, 3, 20_000),
                    dated_project(7, 0, 88_888, "not-a-date"),
                ],
                ..base_input()
            },
        ]
    }

    #[test]
    fn never_suggests_more_than_a_project_needs() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 100_000,
            projects: vec![project(1, 0, 5_000), project(2, 0, 1_000_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(amounts(&suggestions), vec![5_000, 95_000]);
    }

    #[test]
    fn total_never_exceeds_the_surplus() {
        for input in varied_inputs() {
            let suggestions = compute_suggested_allocation(&input);

            assert!(
                total(&suggestions) <= input.avg_monthly_surplus_cents,
                "total {} exceeded surplus {} for {input:?}",
                total(&suggestions),
                input.avg_monthly_surplus_cents
            );
        }
    }

    #[test]
    fn total_equals_the_conservation_identity_across_varied_inputs() {
        for input in varied_inputs() {
            let suggestions = compute_suggested_allocation(&input);
            let total_remaining: i64 = suggestions
                .iter()
                .map(|suggestion| suggestion.remaining_cents)
                .sum();

            assert_eq!(
                total(&suggestions),
                input.avg_monthly_surplus_cents.min(total_remaining),
                "conservation identity broke for {input:?}"
            );
        }
    }

    #[test]
    fn total_equals_min_of_surplus_and_total_remaining() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 100_000,
            projects: vec![project(1, 0, 2_000), project(2, 0, 4_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(amounts(&suggestions), vec![2_000, 4_000]);
        assert_eq!(total(&suggestions), 6_000);
    }

    #[test]
    fn fully_funded_project_is_excluded() {
        let input = AllocationInput {
            projects: vec![project(1, 0, 1_000_000), funded_project(2, 500_000, 500_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.project_id)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn overfunded_project_is_excluded() {
        let input = AllocationInput {
            projects: vec![project(1, 0, 1_000_000), funded_project(2, 500_000, 900_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.project_id)
                .collect::<Vec<_>>(),
            vec![1]
        );
        assert!(suggestions
            .iter()
            .all(|suggestion| suggestion.suggested_cents >= 0));
    }

    #[test]
    fn every_amount_is_non_negative_and_within_remaining() {
        for input in varied_inputs() {
            for suggestion in compute_suggested_allocation(&input) {
                assert!(
                    suggestion.suggested_cents >= 0,
                    "negative suggestion {suggestion:?}"
                );
                assert!(
                    suggestion.suggested_cents <= suggestion.remaining_cents,
                    "suggestion exceeded remaining {suggestion:?}"
                );
            }
        }
    }

    #[test]
    fn single_project_receives_the_whole_surplus_up_to_its_remaining() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 90_000,
            projects: vec![project(1, 0, 1_000_000)],
            ..base_input()
        };
        assert_eq!(amounts(&compute_suggested_allocation(&input)), vec![90_000]);

        let capped = AllocationInput {
            projects: vec![project(1, 0, 40_000)],
            ..input
        };
        assert_eq!(amounts(&compute_suggested_allocation(&capped)), vec![40_000]);
    }

    // Story 32.3 renders and edits every active project, so a project whose share floors to zero must
    // still come back as an entry rather than disappearing from the panel.
    #[test]
    fn zero_amount_entries_are_still_returned() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 1,
            projects: vec![project(1, 0, 1_000_000), project(2, 1, 1_000_000)],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(suggestions.len(), 2);
        assert_eq!(amounts(&suggestions), vec![1, 0]);
    }

    fn only_suggestion(input: &AllocationInput) -> ProjectAllocationSuggestion {
        let mut suggestions = compute_suggested_allocation(input);
        assert_eq!(suggestions.len(), 1, "expected exactly one suggestion");
        suggestions.remove(0)
    }

    fn months_for(target_date: Option<&str>) -> Option<i64> {
        let project = match target_date {
            Some(date) => dated_project(1, 0, 1_000_000, date),
            None => project(1, 0, 1_000_000),
        };
        let input = AllocationInput {
            projects: vec![project],
            ..base_input()
        };

        only_suggestion(&input).months_to_target
    }

    #[test]
    fn no_target_date_has_zero_urgency_and_none_months() {
        let input = AllocationInput {
            projects: vec![project(1, 0, 1_000_000)],
            ..base_input()
        };

        let suggestion = only_suggestion(&input);

        assert_eq!(suggestion.months_to_target, None);
        assert_eq!(suggestion.weight, PRIORITY_WEIGHT_SCALE);
    }

    #[test]
    fn past_due_target_date_clamps_to_one_month() {
        let input = AllocationInput {
            projects: vec![
                dated_project(1, 0, 1_000_000, "2025-01-01"),
                dated_project(2, 0, 1_000_000, "2027-06-11"),
            ],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(suggestions[0].months_to_target, Some(1));
        assert_eq!(
            suggestions[0].weight,
            PRIORITY_WEIGHT_SCALE + URGENCY_WEIGHT_SCALE
        );
        assert!(suggestions[1].weight < suggestions[0].weight);
    }

    #[test]
    fn target_date_later_this_month_clamps_to_one_month() {
        assert_eq!(months_for(Some("2026-08-20")), Some(1));
    }

    #[test]
    fn partial_month_floors_down() {
        assert_eq!(months_for(Some("2026-10-01")), Some(1));
        assert_eq!(months_for(Some("2026-10-11")), Some(2));
    }

    #[test]
    fn unparseable_target_date_is_treated_as_no_deadline() {
        for target_date in ["not-a-date", "", "2026-13-45", "2026/10/11"] {
            let input = AllocationInput {
                projects: vec![dated_project(1, 0, 1_000_000, target_date)],
                ..base_input()
            };

            let suggestion = only_suggestion(&input);

            assert_eq!(suggestion.months_to_target, None, "for {target_date:?}");
            assert_eq!(suggestion.weight, PRIORITY_WEIGHT_SCALE);
        }
        assert_eq!(months_for(None), None);
    }

    // The command always injects `Local::now().date_naive().to_string()`, so this is unreachable in
    // production; the test pins the degradation so an unparseable `today` can never panic a caller.
    #[test]
    fn unparseable_today_is_treated_as_no_deadline() {
        let input = AllocationInput {
            today: "whenever".to_string(),
            projects: vec![dated_project(1, 0, 1_000_000, "2026-10-11")],
            ..base_input()
        };

        let suggestion = only_suggestion(&input);

        assert_eq!(suggestion.months_to_target, None);
        assert_eq!(suggestion.weight, PRIORITY_WEIGHT_SCALE);
    }

    #[test]
    fn identical_inputs_produce_identical_output() {
        let input = AllocationInput {
            avg_monthly_surplus_cents: 123_457,
            projects: vec![
                dated_project(3, 1, 750_000, "2026-12-31"),
                project(1, 0, 5_000),
                dated_project(2, 0, 400_000, "not-a-date"),
            ],
            ..base_input()
        };

        let first = compute_suggested_allocation(&input);
        let second = compute_suggested_allocation(&input);

        assert_eq!(first, second);
    }

    fn expect_gate_rejection(step: WaterfallStep, total_cents: i64) {
        match guard_confirmable(&step, 100_000, total_cents).unwrap_err() {
            AppError::Validation { field, .. } => assert_eq!(field, None),
            other => panic!("expected a step-gate validation error, got {other:?}"),
        }
    }

    #[test]
    fn guard_rejects_a_confirmation_while_the_emergency_fund_is_unfunded() {
        expect_gate_rejection(WaterfallStep::BuildEmergencyFund, 50_000);
    }

    #[test]
    fn guard_rejects_a_confirmation_while_high_interest_debt_is_outstanding() {
        expect_gate_rejection(WaterfallStep::PayHighInterestDebt, 50_000);
    }

    // The step gate is checked before and independently of the total, so an empty confirmation on a
    // gated-out step is still a rejection rather than a silent no-op.
    #[test]
    fn guard_rejects_a_gated_out_step_even_with_a_zero_total() {
        expect_gate_rejection(WaterfallStep::BuildEmergencyFund, 0);
    }

    #[test]
    fn guard_allows_a_total_below_the_surplus_on_an_allowed_step() {
        assert!(
            guard_confirmable(&WaterfallStep::ContributeRegisteredAccounts, 100_000, 99_999)
                .is_ok()
        );
        assert!(guard_confirmable(&WaterfallStep::InvestSurplus, 100_000, 1).is_ok());
    }

    // The boundary that must match `validateAllocationTotal` in `src/lib/allocation.ts`: equal to the
    // surplus is allowed, one cent over is not. Drift here enables a confirm the backend refuses.
    #[test]
    fn guard_allows_a_total_exactly_equal_to_the_surplus() {
        assert!(
            guard_confirmable(&WaterfallStep::ContributeRegisteredAccounts, 100_000, 100_000)
                .is_ok()
        );
    }

    #[test]
    fn guard_rejects_a_total_one_cent_over_the_surplus() {
        match guard_confirmable(&WaterfallStep::ContributeRegisteredAccounts, 100_000, 100_001)
            .unwrap_err()
        {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("amount_cents".to_string()));
            }
            other => panic!("expected a cap validation error, got {other:?}"),
        }
    }

    #[test]
    fn guard_allows_a_zero_total_on_an_allowed_step() {
        assert!(
            guard_confirmable(&WaterfallStep::ContributeRegisteredAccounts, 100_000, 0).is_ok()
        );
    }

    #[test]
    fn output_order_is_priority_then_id() {
        let input = AllocationInput {
            projects: vec![
                project(9, 2, 1_000_000),
                project(4, 0, 1_000_000),
                project(7, 1, 1_000_000),
                project(2, 0, 1_000_000),
            ],
            ..base_input()
        };

        let suggestions = compute_suggested_allocation(&input);

        assert_eq!(
            suggestions
                .iter()
                .map(|suggestion| suggestion.project_id)
                .collect::<Vec<_>>(),
            vec![2, 4, 7, 9]
        );
    }
}
