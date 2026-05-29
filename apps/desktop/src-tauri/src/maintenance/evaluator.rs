#![allow(dead_code)]

use chrono::{Months, NaiveDate};
use serde::Serialize;

use super::defaults::{ALERT_DAYS_THRESHOLD, ALERT_KM_THRESHOLD};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Ok,
    Upcoming,
    Due,
    Overdue,
}

#[derive(Debug, Clone)]
pub struct TaskEvalInput {
    pub interval_km: i64,
    pub interval_months: i64,
    /// "YYYY-MM-DD" or None if never serviced
    pub last_service_date: Option<String>,
    pub last_service_odometer_km: Option<i64>,
    pub current_odometer_km: i64,
    /// SQLite datetime string: "YYYY-MM-DD HH:MM:SS"
    pub vehicle_created_at: String,
    pub today: NaiveDate,
}

#[derive(Debug, Clone)]
pub struct TaskEvaluation {
    pub status: TaskStatus,
    pub next_due_date: Option<NaiveDate>,
    pub next_due_odometer_km: Option<i64>,
    pub km_remaining: Option<i64>,
    pub days_remaining: Option<i64>,
}

pub fn evaluate_task(input: &TaskEvalInput) -> TaskEvaluation {
    let km_eval = if input.interval_km > 0 {
        let anchor = input.last_service_odometer_km.unwrap_or(0);
        let next_due = anchor + input.interval_km;
        let remaining = next_due - input.current_odometer_km;
        Some((next_due, remaining))
    } else {
        None
    };

    let time_eval = if input.interval_months > 0 {
        let anchor_date = parse_anchor_date(&input.last_service_date, &input.vehicle_created_at);
        let next_due = anchor_date
            .checked_add_months(Months::new(input.interval_months as u32))
            .unwrap_or(anchor_date);
        let remaining = (next_due - input.today).num_days();
        Some((next_due, remaining))
    } else {
        None
    };

    let km_status = km_eval.as_ref().map(|(_, rem)| classify(*rem, ALERT_KM_THRESHOLD));
    let time_status = time_eval.as_ref().map(|(_, rem)| classify(*rem, ALERT_DAYS_THRESHOLD));
    let status = worst_of(km_status, time_status);

    TaskEvaluation {
        status,
        next_due_odometer_km: km_eval.map(|(km, _)| km),
        next_due_date: time_eval.map(|(d, _)| d),
        km_remaining: km_eval.map(|(_, rem)| rem),
        days_remaining: time_eval.map(|(_, rem)| rem),
    }
}

fn parse_anchor_date(last_service_date: &Option<String>, vehicle_created_at: &str) -> NaiveDate {
    if let Some(ref d) = last_service_date {
        if let Ok(parsed) = NaiveDate::parse_from_str(d, "%Y-%m-%d") {
            return parsed;
        }
    }
    // Fall back to vehicle creation date (first 10 chars of datetime string)
    let date_str = vehicle_created_at.get(..10).unwrap_or("1970-01-01");
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d").unwrap_or_else(|_| {
        NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()
    })
}

fn classify(remaining: i64, alert_threshold: i64) -> TaskStatus {
    if remaining < 0 {
        TaskStatus::Overdue
    } else if remaining == 0 {
        TaskStatus::Due
    } else if remaining <= alert_threshold {
        TaskStatus::Upcoming
    } else {
        TaskStatus::Ok
    }
}

fn status_rank(s: &TaskStatus) -> u8 {
    match s {
        TaskStatus::Ok => 0,
        TaskStatus::Upcoming => 1,
        TaskStatus::Due => 2,
        TaskStatus::Overdue => 3,
    }
}

fn worst_of(a: Option<TaskStatus>, b: Option<TaskStatus>) -> TaskStatus {
    match (a, b) {
        (None, None) => TaskStatus::Ok,
        (Some(s), None) | (None, Some(s)) => s,
        (Some(a), Some(b)) => {
            if status_rank(&a) >= status_rank(&b) { a } else { b }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 5, 29).unwrap()
    }

    fn created_at() -> String {
        "2024-01-01 00:00:00".to_string()
    }

    // --- km-only tasks ---

    #[test]
    fn km_only_ok_when_far_from_due() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 0,
            last_service_date: Some("2025-01-01".to_string()),
            last_service_odometer_km: Some(100_000),
            current_odometer_km: 100_000,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Ok);
        assert_eq!(eval.next_due_odometer_km, Some(108_000));
        assert_eq!(eval.km_remaining, Some(8_000));
        assert!(eval.next_due_date.is_none());
    }

    #[test]
    fn km_only_upcoming_within_alert_window() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 0,
            last_service_date: None,
            last_service_odometer_km: Some(100_000),
            current_odometer_km: 107_600,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Upcoming);
        assert_eq!(eval.km_remaining, Some(400));
    }

    #[test]
    fn km_only_due_at_exact_threshold() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 0,
            last_service_date: None,
            last_service_odometer_km: Some(100_000),
            current_odometer_km: 108_000,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Due);
        assert_eq!(eval.km_remaining, Some(0));
    }

    #[test]
    fn km_only_overdue_past_threshold() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 0,
            last_service_date: None,
            last_service_odometer_km: Some(100_000),
            current_odometer_km: 109_000,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Overdue);
        assert_eq!(eval.km_remaining, Some(-1_000));
    }

    // --- time-only tasks ---

    #[test]
    fn time_only_ok_when_far_from_due() {
        let input = TaskEvalInput {
            interval_km: 0,
            interval_months: 12,
            last_service_date: Some("2026-01-01".to_string()),
            last_service_odometer_km: None,
            current_odometer_km: 0,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        // Next due: 2027-01-01; today: 2026-05-29 → ~216 days remaining → Ok
        assert_eq!(eval.status, TaskStatus::Ok);
        assert!(eval.km_remaining.is_none());
        assert!(eval.days_remaining.is_some());
        assert!(eval.days_remaining.unwrap() > 14);
    }

    #[test]
    fn time_only_upcoming_within_14_days() {
        let close_date = today() - chrono::Duration::days(365 - 10); // service ~10 days before next due
        let input = TaskEvalInput {
            interval_km: 0,
            interval_months: 12,
            last_service_date: Some(close_date.format("%Y-%m-%d").to_string()),
            last_service_odometer_km: None,
            current_odometer_km: 0,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Upcoming);
        let days = eval.days_remaining.unwrap();
        assert!(days > 0 && days <= 14, "expected 0 < days <= 14, got {}", days);
    }

    #[test]
    fn time_only_overdue_past_due_date() {
        let input = TaskEvalInput {
            interval_km: 0,
            interval_months: 12,
            last_service_date: Some("2024-12-01".to_string()),
            last_service_odometer_km: None,
            current_odometer_km: 0,
            vehicle_created_at: created_at(),
            today: today(),
        };
        // Next due: 2025-12-01; today: 2026-05-29 → overdue by ~179 days
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Overdue);
        assert!(eval.days_remaining.unwrap() < 0);
    }

    // --- combined tasks ---

    #[test]
    fn combined_km_overdue_wins_over_time_ok() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 6,
            // Time: serviced 1 month ago → ~5 months remaining → Ok
            last_service_date: Some("2026-04-29".to_string()),
            // Km: 9000 km past due → Overdue
            last_service_odometer_km: Some(100_000),
            current_odometer_km: 109_000,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Overdue);
    }

    #[test]
    fn combined_time_upcoming_wins_over_km_ok() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 6,
            // Km: 5000 km remaining → Ok
            last_service_odometer_km: Some(100_000),
            current_odometer_km: 103_000,
            // Time: ~10 days remaining → Upcoming
            last_service_date: Some(
                (today() - chrono::Duration::days(172)).format("%Y-%m-%d").to_string()
            ),
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Upcoming);
    }

    // --- never-serviced tasks ---

    #[test]
    fn never_serviced_km_task_anchors_from_zero() {
        let input = TaskEvalInput {
            interval_km: 8000,
            interval_months: 0,
            last_service_date: None,
            last_service_odometer_km: None,
            current_odometer_km: 500,
            vehicle_created_at: created_at(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        // Anchor odometer = 0, next due = 8000, current = 500 → remaining = 7500 → Ok
        assert_eq!(eval.status, TaskStatus::Ok);
        assert_eq!(eval.next_due_odometer_km, Some(8000));
        assert_eq!(eval.km_remaining, Some(7500));
    }

    #[test]
    fn never_serviced_time_task_anchors_from_vehicle_created_at() {
        let input = TaskEvalInput {
            interval_km: 0,
            interval_months: 12,
            last_service_date: None,
            last_service_odometer_km: None,
            current_odometer_km: 0,
            // Created 2 years ago → next due was 1 year ago → Overdue
            vehicle_created_at: "2024-01-01 00:00:00".to_string(),
            today: today(),
        };
        let eval = evaluate_task(&input);
        // Anchor: 2024-01-01, next due: 2025-01-01; today: 2026-05-29 → Overdue
        assert_eq!(eval.status, TaskStatus::Overdue);
    }

    #[test]
    fn battery_check_time_only_evaluates_correctly() {
        let input = TaskEvalInput {
            interval_km: 0,
            interval_months: 12,
            last_service_date: Some("2026-01-01".to_string()),
            last_service_odometer_km: None,
            current_odometer_km: 50_000,
            vehicle_created_at: created_at(),
            today: today(),
        };
        // Next due: 2027-01-01 → Ok (more than 14 days away)
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Ok);
        assert!(eval.km_remaining.is_none());
    }

    #[test]
    fn wiper_blades_time_only_evaluates_correctly() {
        let input = TaskEvalInput {
            interval_km: 0,
            interval_months: 12,
            last_service_date: Some("2025-05-20".to_string()),
            last_service_odometer_km: None,
            current_odometer_km: 80_000,
            vehicle_created_at: created_at(),
            today: today(),
        };
        // Next due: 2026-05-20; today: 2026-05-29 → Overdue (9 days past)
        let eval = evaluate_task(&input);
        assert_eq!(eval.status, TaskStatus::Overdue);
        assert!(eval.days_remaining.unwrap() < 0);
    }
}
