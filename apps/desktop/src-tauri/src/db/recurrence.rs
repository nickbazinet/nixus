//! When a recurring template falls due. Shared by the expense and income templates, which store the
//! same three schedule columns: `frequency`, `day_of_month`, and `start_date`.

use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};

use crate::db::recurring::{clamp_day_to_month, next_month, parse_template_start_date};
use crate::error::AppError;
use crate::models::RecurrenceFrequency;

impl RecurrenceFrequency {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Monthly => "monthly",
            Self::Weekly => "weekly",
            Self::Biweekly => "biweekly",
            Self::EveryFourWeeks => "every_four_weeks",
        }
    }

    /// Days between occurrences, or `None` for the calendar-month cadence.
    fn interval_days(self) -> Option<i64> {
        match self {
            Self::Monthly => None,
            Self::Weekly => Some(7),
            Self::Biweekly => Some(14),
            Self::EveryFourWeeks => Some(28),
        }
    }
}

impl ToSql for RecurrenceFrequency {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for RecurrenceFrequency {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "monthly" => Ok(Self::Monthly),
            "weekly" => Ok(Self::Weekly),
            "biweekly" => Ok(Self::Biweekly),
            "every_four_weeks" => Ok(Self::EveryFourWeeks),
            other => Err(FromSqlError::Other(
                format!("unknown recurrence frequency: {other}").into(),
            )),
        }
    }
}

/// The schedule columns as a template row stores them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredSchedule {
    pub frequency: RecurrenceFrequency,
    pub day_of_month: i32,
    pub start_date: Option<String>,
}

/// Validates a submitted schedule and returns what the row should store.
///
/// A schedule that is new (`previous` is `None`) or that CHANGED starts fresh: it records nothing
/// before `today`, so retuning a template never backfills months or weeks under the new rule next
/// to the entries the old rule already created. An unchanged schedule (an amount edit, a pause)
/// keeps what it had.
///
/// A week-based `start_date` in the past is rolled forward by whole intervals to the first
/// occurrence on or after `today`: the weekday and the every-other-week phase are kept, the
/// backfill is not.
pub(crate) fn normalize(
    frequency: RecurrenceFrequency,
    day_of_month: i32,
    start_date: Option<&str>,
    previous: Option<&StoredSchedule>,
    today: NaiveDate,
) -> Result<StoredSchedule, AppError> {
    let Some(interval) = frequency.interval_days() else {
        if !(1..=31).contains(&day_of_month) {
            return Err(AppError::Validation {
                message: "Day of month must be between 1 and 31".to_string(),
                field: Some("day_of_month".to_string()),
            });
        }

        let start_date = match previous {
            None => None,
            Some(prev)
                if prev.frequency == RecurrenceFrequency::Monthly
                    && prev.day_of_month == day_of_month =>
            {
                prev.start_date.clone()
            }
            Some(_) => Some(format_date(today)),
        };

        return Ok(StoredSchedule {
            frequency,
            day_of_month,
            start_date,
        });
    };

    let raw = start_date
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation {
            message: "Start date is required".to_string(),
            field: Some("start_date".to_string()),
        })?;
    let anchor = NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| AppError::Validation {
        message: "Start date must be a valid date".to_string(),
        field: Some("start_date".to_string()),
    })?;

    if let Some(prev) = previous {
        if prev.frequency == frequency && prev.start_date.as_deref() == Some(raw) {
            return Ok(prev.clone());
        }
    }

    let anchor = roll_forward(anchor, interval, today);
    Ok(StoredSchedule {
        frequency,
        day_of_month: anchor.day() as i32,
        start_date: Some(format_date(anchor)),
    })
}

fn roll_forward(anchor: NaiveDate, interval: i64, today: NaiveDate) -> NaiveDate {
    let behind = (today - anchor).num_days();
    if behind <= 0 {
        return anchor;
    }
    let steps = (behind + interval - 1) / interval;
    anchor + Duration::days(steps * interval)
}

/// Every occurrence from the schedule's first recordable date through `today`, inclusive.
///
/// A monthly schedule without a `start_date` starts at `created_at`, which is the rule every
/// template followed before schedules could change.
pub(crate) fn due_occurrences(
    schedule: &StoredSchedule,
    created_at: &str,
    today: NaiveDate,
) -> Result<Vec<NaiveDate>, AppError> {
    let mut dates = Vec::new();

    match schedule.frequency.interval_days() {
        None => {
            let floor = match schedule.start_date.as_deref() {
                Some(start) => parse_date(start)?,
                None => parse_template_start_date(created_at)?,
            };
            let (mut year, mut month) = (floor.year(), floor.month());
            while (year, month) <= (today.year(), today.month()) {
                let date = monthly_date(schedule.day_of_month, year, month)?;
                if date >= floor && date <= today {
                    dates.push(date);
                }
                (year, month) = next_month(year, month);
            }
        }
        Some(interval) => {
            let mut date = anchor_of(schedule)?;
            while date <= today {
                dates.push(date);
                date += Duration::days(interval);
            }
        }
    }

    Ok(dates)
}

/// Every occurrence that falls in one calendar month. A monthly schedule always has exactly one; a
/// week-based schedule has those on or after its anchor.
pub(crate) fn occurrences_in_month(
    schedule: &StoredSchedule,
    year: i32,
    month: u32,
) -> Result<Vec<NaiveDate>, AppError> {
    let Some(interval) = schedule.frequency.interval_days() else {
        return Ok(vec![monthly_date(schedule.day_of_month, year, month)?]);
    };

    let first = NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| AppError::Validation {
        message: format!("Invalid month: {year}-{month}"),
        field: Some("month".to_string()),
    })?;
    let anchor = anchor_of(schedule)?;
    let mut date = if anchor >= first {
        anchor
    } else {
        roll_forward(anchor, interval, first)
    };

    let mut dates = Vec::new();
    while date.year() == year && date.month() == month {
        dates.push(date);
        date += Duration::days(interval);
    }
    Ok(dates)
}

/// The period a generated row is named by (AD-2): the month for a monthly schedule, which keeps
/// every identity derived before week-based schedules existed, and the exact date otherwise, since
/// a weekly schedule records several rows in one month.
pub(crate) fn period_of(frequency: RecurrenceFrequency, date: NaiveDate) -> String {
    match frequency {
        RecurrenceFrequency::Monthly => date.format("%Y-%m").to_string(),
        _ => format_date(date),
    }
}

fn anchor_of(schedule: &StoredSchedule) -> Result<NaiveDate, AppError> {
    let start = schedule
        .start_date
        .as_deref()
        .ok_or_else(|| AppError::Database {
            message: "A week-based recurring template has no start date".to_string(),
        })?;
    parse_date(start)
}

fn monthly_date(day_of_month: i32, year: i32, month: u32) -> Result<NaiveDate, AppError> {
    let day = clamp_day_to_month(year, month, day_of_month);
    NaiveDate::from_ymd_opt(year, month, day as u32).ok_or_else(|| AppError::Database {
        message: format!("Invalid recurring date: {year}-{month}-{day}"),
    })
}

fn parse_date(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|e| AppError::Database {
        message: format!("Invalid recurring start date {value}: {e}"),
    })
}

fn format_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use RecurrenceFrequency::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn weekly(frequency: RecurrenceFrequency, start: &str) -> StoredSchedule {
        StoredSchedule {
            frequency,
            day_of_month: 1,
            start_date: Some(start.to_string()),
        }
    }

    #[test]
    fn a_new_monthly_schedule_keeps_the_created_at_rule() {
        let stored = normalize(Monthly, 15, Some("2026-01-01"), None, d(2026, 11, 10)).unwrap();
        assert_eq!(stored.day_of_month, 15);
        assert_eq!(stored.start_date, None);
    }

    #[test]
    fn a_monthly_day_change_starts_fresh_today() {
        let prev = StoredSchedule {
            frequency: Monthly,
            day_of_month: 15,
            start_date: None,
        };
        let same = normalize(Monthly, 15, None, Some(&prev), d(2026, 11, 10)).unwrap();
        assert_eq!(same, prev);

        let moved = normalize(Monthly, 20, None, Some(&prev), d(2026, 11, 10)).unwrap();
        assert_eq!(moved.start_date.as_deref(), Some("2026-11-10"));
    }

    #[test]
    fn monthly_rejects_an_out_of_range_day() {
        assert!(normalize(Monthly, 0, None, None, d(2026, 11, 10)).is_err());
        assert!(normalize(Monthly, 32, None, None, d(2026, 11, 10)).is_err());
    }

    #[test]
    fn a_week_based_schedule_requires_a_valid_start_date() {
        assert!(normalize(Weekly, 1, None, None, d(2026, 11, 10)).is_err());
        assert!(normalize(Weekly, 1, Some(""), None, d(2026, 11, 10)).is_err());
        assert!(normalize(Weekly, 1, Some("2026-13-01"), None, d(2026, 11, 10)).is_err());
    }

    #[test]
    fn a_past_start_date_rolls_forward_keeping_weekday_and_phase() {
        // Thursday 2026-10-29, every two weeks: 11-12 is the first on/after Tuesday 11-10.
        let stored = normalize(Biweekly, 1, Some("2026-10-29"), None, d(2026, 11, 10)).unwrap();
        assert_eq!(stored.start_date.as_deref(), Some("2026-11-12"));
        assert_eq!(stored.day_of_month, 12);

        // A start that lands exactly on today stays today.
        let today = normalize(Weekly, 1, Some("2026-11-03"), None, d(2026, 11, 10)).unwrap();
        assert_eq!(today.start_date.as_deref(), Some("2026-11-10"));

        // A future start is kept as given.
        let future =
            normalize(EveryFourWeeks, 1, Some("2026-12-01"), None, d(2026, 11, 10)).unwrap();
        assert_eq!(future.start_date.as_deref(), Some("2026-12-01"));
    }

    #[test]
    fn an_unchanged_week_based_schedule_is_kept_even_once_its_start_is_past() {
        let prev = weekly(Weekly, "2026-10-01");
        let kept = normalize(Weekly, 1, Some("2026-10-01"), Some(&prev), d(2026, 11, 10)).unwrap();
        assert_eq!(kept, prev);

        let switched = normalize(
            Biweekly,
            1,
            Some("2026-10-01"),
            Some(&prev),
            d(2026, 11, 10),
        )
        .unwrap();
        assert_eq!(switched.start_date.as_deref(), Some("2026-11-12"));
    }

    #[test]
    fn weekly_due_occurrences_run_from_the_anchor_through_today() {
        let dates =
            due_occurrences(&weekly(Weekly, "2026-10-22"), "2026-10-22", d(2026, 11, 12)).unwrap();
        assert_eq!(
            dates,
            vec![
                d(2026, 10, 22),
                d(2026, 10, 29),
                d(2026, 11, 5),
                d(2026, 11, 12)
            ]
        );

        let biweekly =
            due_occurrences(&weekly(Biweekly, "2026-10-22"), "", d(2026, 11, 18)).unwrap();
        assert_eq!(biweekly, vec![d(2026, 10, 22), d(2026, 11, 5)]);

        let future =
            due_occurrences(&weekly(EveryFourWeeks, "2026-12-01"), "", d(2026, 11, 18)).unwrap();
        assert!(future.is_empty());
    }

    #[test]
    fn monthly_due_occurrences_honour_a_start_date_over_created_at() {
        let schedule = StoredSchedule {
            frequency: Monthly,
            day_of_month: 15,
            start_date: Some("2026-03-16".to_string()),
        };
        let dates = due_occurrences(&schedule, "2026-01-01 00:00:00", d(2026, 4, 20)).unwrap();
        assert_eq!(dates, vec![d(2026, 4, 15)]);
    }

    #[test]
    fn occurrences_in_month_lists_every_week_based_hit() {
        let schedule = weekly(Weekly, "2026-10-01");
        assert_eq!(
            occurrences_in_month(&schedule, 2026, 11).unwrap(),
            vec![
                d(2026, 11, 5),
                d(2026, 11, 12),
                d(2026, 11, 19),
                d(2026, 11, 26)
            ]
        );
        // Nothing before the anchor's own month.
        assert!(occurrences_in_month(&schedule, 2026, 9).unwrap().is_empty());

        let every_four = weekly(EveryFourWeeks, "2026-10-01");
        assert_eq!(
            occurrences_in_month(&every_four, 2026, 10).unwrap(),
            vec![d(2026, 10, 1), d(2026, 10, 29)]
        );
    }

    #[test]
    fn a_monthly_period_is_the_month_and_a_weekly_one_is_the_date() {
        assert_eq!(period_of(Monthly, d(2026, 11, 5)), "2026-11");
        assert_eq!(period_of(Weekly, d(2026, 11, 5)), "2026-11-05");
    }
}
