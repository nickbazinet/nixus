#![allow(dead_code)]

pub const ALERT_KM_THRESHOLD: i64 = 500;
pub const ALERT_DAYS_THRESHOLD: i64 = 14;

pub struct TaskBaseline {
    pub task_type_key: &'static str,
    pub interval_km: i64,
    pub interval_months: i64,
}

pub const DEFAULT_TASKS: &[TaskBaseline] = &[
    TaskBaseline { task_type_key: "engine_oil_filter",       interval_km: 8000,   interval_months: 6  },
    TaskBaseline { task_type_key: "transmission_fluid",      interval_km: 60000,  interval_months: 48 },
    TaskBaseline { task_type_key: "brake_fluid",             interval_km: 40000,  interval_months: 24 },
    TaskBaseline { task_type_key: "coolant",                 interval_km: 80000,  interval_months: 48 },
    TaskBaseline { task_type_key: "differential_fluid",      interval_km: 60000,  interval_months: 48 },
    TaskBaseline { task_type_key: "power_steering_fluid",    interval_km: 80000,  interval_months: 48 },
    TaskBaseline { task_type_key: "tire_rotation",           interval_km: 10000,  interval_months: 6  },
    TaskBaseline { task_type_key: "tire_inspection",         interval_km: 10000,  interval_months: 6  },
    TaskBaseline { task_type_key: "brake_inspection",        interval_km: 20000,  interval_months: 12 },
    TaskBaseline { task_type_key: "engine_air_filter",       interval_km: 24000,  interval_months: 12 },
    TaskBaseline { task_type_key: "cabin_air_filter",        interval_km: 24000,  interval_months: 12 },
    TaskBaseline { task_type_key: "spark_plugs",             interval_km: 100000, interval_months: 60 },
    TaskBaseline { task_type_key: "suspension_inspection",   interval_km: 20000,  interval_months: 12 },
    TaskBaseline { task_type_key: "battery_check",           interval_km: 0,      interval_months: 12 },
    TaskBaseline { task_type_key: "wiper_blades",            interval_km: 0,      interval_months: 12 },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tasks_contains_15_entries() {
        assert_eq!(DEFAULT_TASKS.len(), 15);
    }

    #[test]
    fn all_task_type_keys_are_unique() {
        let mut keys: Vec<&str> = DEFAULT_TASKS.iter().map(|t| t.task_type_key).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), 15, "duplicate task_type_key found");
    }

    #[test]
    fn each_task_has_at_least_one_nonzero_interval() {
        for t in DEFAULT_TASKS {
            assert!(
                t.interval_km > 0 || t.interval_months > 0,
                "task '{}' has both intervals at 0",
                t.task_type_key
            );
        }
    }

    #[test]
    fn time_only_tasks_have_zero_km_interval() {
        let battery = DEFAULT_TASKS.iter().find(|t| t.task_type_key == "battery_check").unwrap();
        assert_eq!(battery.interval_km, 0);
        assert_eq!(battery.interval_months, 12);

        let wipers = DEFAULT_TASKS.iter().find(|t| t.task_type_key == "wiper_blades").unwrap();
        assert_eq!(wipers.interval_km, 0);
        assert_eq!(wipers.interval_months, 12);
    }

    #[test]
    fn alert_thresholds_are_correct() {
        assert_eq!(ALERT_KM_THRESHOLD, 500);
        assert_eq!(ALERT_DAYS_THRESHOLD, 14);
    }

    #[test]
    fn engine_oil_filter_has_expected_baseline() {
        let task = DEFAULT_TASKS.iter().find(|t| t.task_type_key == "engine_oil_filter").unwrap();
        assert_eq!(task.interval_km, 8000);
        assert_eq!(task.interval_months, 6);
    }
}
