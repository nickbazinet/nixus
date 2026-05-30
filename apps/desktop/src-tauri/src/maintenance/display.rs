/// Builds the stored vehicle label from year, make, and model (e.g. "2014 Honda Accord").
pub fn derive_vehicle_nickname(
    make: &Option<String>,
    model: &Option<String>,
    year: &Option<i32>,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(y) = year {
        parts.push(y.to_string());
    }
    if let Some(m) = make {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            parts.push(trimmed.to_string());
        }
    }
    if let Some(m) = model {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            parts.push(trimmed.to_string());
        }
    }

    if parts.is_empty() {
        "Vehicle".to_string()
    } else {
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_full_label() {
        assert_eq!(
            derive_vehicle_nickname(
                &Some("Honda".to_string()),
                &Some("Accord".to_string()),
                &Some(2014),
            ),
            "2014 Honda Accord"
        );
    }

    #[test]
    fn falls_back_to_vehicle_when_empty() {
        assert_eq!(
            derive_vehicle_nickname(&None, &None, &None),
            "Vehicle"
        );
    }
}
