pub const ALERT_KM_THRESHOLD: i64 = 500;
pub const ALERT_DAYS_THRESHOLD: i64 = 14;

pub struct TaskBaseline {
    pub task_type_key: &'static str,
    pub interval_km: i64,
    pub interval_months: i64,
}

pub const DEFAULT_TASKS: &[TaskBaseline] = &[
    TaskBaseline { task_type_key: "engine_oil_filter",    interval_km: 8000,   interval_months: 6  },
    TaskBaseline { task_type_key: "transmission_fluid",   interval_km: 60000,  interval_months: 48 },
    TaskBaseline { task_type_key: "brake_fluid",           interval_km: 40000,  interval_months: 24 },
    TaskBaseline { task_type_key: "coolant",              interval_km: 80000,  interval_months: 48 },
    TaskBaseline { task_type_key: "power_steering_fluid", interval_km: 80000,  interval_months: 48 },
    TaskBaseline { task_type_key: "brake_pads",           interval_km: 50000,  interval_months: 36 },
    TaskBaseline { task_type_key: "brake_discs",          interval_km: 90000,  interval_months: 60 },
    TaskBaseline { task_type_key: "engine_air_filter",    interval_km: 24000,  interval_months: 12 },
    TaskBaseline { task_type_key: "cabin_air_filter",     interval_km: 24000,  interval_months: 12 },
    TaskBaseline { task_type_key: "spark_plugs",          interval_km: 100000, interval_months: 60 },
    TaskBaseline { task_type_key: "shock_absorbers",      interval_km: 80000,  interval_months: 48 },
    TaskBaseline { task_type_key: "battery_replacement",  interval_km: 0,      interval_months: 48 },
];

pub fn baseline_for(task_type_key: &str) -> Option<&'static TaskBaseline> {
    DEFAULT_TASKS.iter().find(|t| t.task_type_key == task_type_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tasks_contains_expected_entries() {
        assert_eq!(DEFAULT_TASKS.len(), 12);
    }

    #[test]
    fn all_task_type_keys_are_unique() {
        let mut keys: Vec<&str> = DEFAULT_TASKS.iter().map(|t| t.task_type_key).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), DEFAULT_TASKS.len(), "duplicate task_type_key found");
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
    fn battery_replacement_is_time_only() {
        let battery = DEFAULT_TASKS
            .iter()
            .find(|t| t.task_type_key == "battery_replacement")
            .unwrap();
        assert_eq!(battery.interval_km, 0);
        assert_eq!(battery.interval_months, 48);
    }

    #[test]
    fn alert_thresholds_are_correct() {
        assert_eq!(ALERT_KM_THRESHOLD, 500);
        assert_eq!(ALERT_DAYS_THRESHOLD, 14);
    }

    #[test]
    fn baseline_for_returns_baseline_for_known_key() {
        let baseline = baseline_for("engine_oil_filter").unwrap();
        assert_eq!(baseline.interval_km, 8000);
        assert_eq!(baseline.interval_months, 6);
    }

    #[test]
    fn baseline_for_returns_none_for_unknown_key() {
        assert!(baseline_for("unknown_task").is_none());
    }
}
