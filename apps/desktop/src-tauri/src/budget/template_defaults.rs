use std::borrow::Cow;

use crate::db::budget_template::{SUPPORTED_TEMPLATE_FORMAT_VERSION, MAX_TEMPLATE_TARGET_CENTS};
use crate::error::AppError;
use crate::models::{
    SystemBudgetTemplate, TemplateCategoryDef, TemplateGroupDef, TemplateTargetOverride,
};

/// Stable identifier. Also the i18n key stem Stories 25.2/25.3 can use to
/// localize the display name without changing this const.
pub const CANADIAN_STARTER_ID: &str = "canadian-starter";

const HOUSING: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("Rent / Mortgage"),               target_cents: Some(180_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Utilities (Hydro, Gas, Water)"), target_cents: Some(20_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Home & Tenant Insurance"),       target_cents: Some(5_000) },
];

const TRANSPORTATION: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("Car Payment & Insurance"), target_cents: Some(45_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Gas & Transit"),           target_cents: Some(25_000) },
];

const LIVING: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("Groceries"),               target_cents: Some(60_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Phone & Internet"),        target_cents: Some(15_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Health & Pharmacy"),       target_cents: Some(10_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Dining & Entertainment"),  target_cents: Some(25_000) },
];

const SAVINGS: &[TemplateCategoryDef] = &[
    TemplateCategoryDef { name: Cow::Borrowed("TFSA Contribution"), target_cents: Some(50_000) },
    TemplateCategoryDef { name: Cow::Borrowed("RRSP Contribution"), target_cents: Some(40_000) },
    TemplateCategoryDef { name: Cow::Borrowed("Emergency Fund"),    target_cents: Some(25_000) },
];

const CANADIAN_STARTER_GROUPS: &[TemplateGroupDef] = &[
    TemplateGroupDef { name: Cow::Borrowed("Housing"),        categories: Cow::Borrowed(HOUSING) },
    TemplateGroupDef { name: Cow::Borrowed("Transportation"), categories: Cow::Borrowed(TRANSPORTATION) },
    TemplateGroupDef { name: Cow::Borrowed("Living"),         categories: Cow::Borrowed(LIVING) },
    TemplateGroupDef { name: Cow::Borrowed("Savings"),        categories: Cow::Borrowed(SAVINGS) },
];

const CANADIAN_STARTER: SystemBudgetTemplate = SystemBudgetTemplate {
    // Referenced, not literal `1`, so this const can never drift from the
    // version validate_budget_template accepts.
    format_version: SUPPORTED_TEMPLATE_FORMAT_VERSION,
    id: Some(Cow::Borrowed(CANADIAN_STARTER_ID)),
    name: Cow::Borrowed("Canadian Starter Budget"),
    description: Some(Cow::Borrowed(
        "Common Canadian household categories with suggested monthly targets. Adjust every target to match your situation.",
    )),
    groups: Cow::Borrowed(CANADIAN_STARTER_GROUPS),
};

pub const SYSTEM_TEMPLATES: &[SystemBudgetTemplate] = &[CANADIAN_STARTER];

pub fn find_system_template(id: &str) -> Option<&'static SystemBudgetTemplate> {
    SYSTEM_TEMPLATES.iter().find(|t| t.id.as_deref() == Some(id))
}

/// Same rule the shared apply core uses for group-name collisions, so an edit
/// addresses exactly the row a later apply would create.
fn names_match(authored: &str, requested: &str) -> bool {
    authored.trim().to_lowercase() == requested.trim().to_lowercase()
}

fn find_override<'a>(
    overrides: &'a [TemplateTargetOverride],
    group_name: &str,
    category_name: &str,
) -> Option<&'a TemplateTargetOverride> {
    overrides.iter().find(|entry| {
        names_match(group_name, &entry.group_name) && names_match(category_name, &entry.category_name)
    })
}

/// Returns an owned copy of `template` with each matching category's
/// `target_cents` replaced by the user's edited value.
///
/// Every entry is validated first: the whole request is rejected before a single
/// value is merged, so a caller never receives a partially edited document.
/// Bounds reuse [`MAX_TEMPLATE_TARGET_CENTS`] — the same rule import applies —
/// but report `AppError::Validation` rather than import's opaque `AppError::File`,
/// because these values come from our own UI, not an untrusted file.
pub fn merge_target_overrides(
    template: &SystemBudgetTemplate,
    overrides: &[TemplateTargetOverride],
) -> Result<SystemBudgetTemplate, AppError> {
    for entry in overrides {
        if !(0..=MAX_TEMPLATE_TARGET_CENTS).contains(&entry.target_cents) {
            return Err(AppError::Validation {
                message: "That budget amount is out of range.".to_string(),
                field: Some("target_cents".to_string()),
            });
        }

        let matched = template.groups.iter().any(|group| {
            names_match(&group.name, &entry.group_name)
                && group
                    .categories
                    .iter()
                    .any(|category| names_match(&category.name, &entry.category_name))
        });

        if !matched {
            tracing::warn!(
                "Template override does not match any category: {} / {}",
                entry.group_name,
                entry.category_name
            );
            return Err(AppError::Validation {
                message: "One of the edited categories is not part of this template.".to_string(),
                field: Some("overrides".to_string()),
            });
        }
    }

    let groups: Vec<TemplateGroupDef> = template
        .groups
        .iter()
        .map(|group| TemplateGroupDef {
            name: group.name.clone(),
            categories: Cow::Owned(
                group
                    .categories
                    .iter()
                    .map(|category| TemplateCategoryDef {
                        name: category.name.clone(),
                        target_cents: find_override(overrides, &group.name, &category.name)
                            .map(|entry| entry.target_cents)
                            .or(category.target_cents),
                    })
                    .collect(),
            ),
        })
        .collect();

    Ok(SystemBudgetTemplate {
        format_version: template.format_version,
        id: template.id.clone(),
        name: template.name.clone(),
        description: template.description.clone(),
        groups: Cow::Owned(groups),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::budget_template::{MAX_TEMPLATE_NAME_LEN, MAX_TEMPLATE_TARGET_CENTS};

    fn override_entry(group: &str, category: &str, cents: i64) -> TemplateTargetOverride {
        TemplateTargetOverride {
            group_name: group.to_string(),
            category_name: category.to_string(),
            target_cents: cents,
        }
    }

    fn target_of(template: &SystemBudgetTemplate, group: &str, category: &str) -> Option<i64> {
        template
            .groups
            .iter()
            .find(|g| g.name == group)
            .and_then(|g| g.categories.iter().find(|c| c.name == category))
            .and_then(|c| c.target_cents)
    }

    fn assert_name_ok(name: &str) {
        let trimmed = name.trim();
        assert!(!trimmed.is_empty(), "blank name in the starter template");
        assert!(
            trimmed.chars().count() <= MAX_TEMPLATE_NAME_LEN,
            "{name} exceeds MAX_TEMPLATE_NAME_LEN"
        );
    }

    #[test]
    fn canadian_starter_has_four_groups_and_twelve_categories() {
        assert_eq!(CANADIAN_STARTER.groups.len(), 4);

        let total: usize = CANADIAN_STARTER
            .groups
            .iter()
            .map(|g| g.categories.len())
            .sum();
        assert_eq!(total, 12);
    }

    #[test]
    fn every_category_target_is_prefilled_and_positive() {
        for group in CANADIAN_STARTER.groups.iter() {
            for category in group.categories.iter() {
                assert!(
                    matches!(category.target_cents, Some(n) if n > 0),
                    "{} must carry a positive pre-filled target (FR70), got {:?}",
                    category.name,
                    category.target_cents
                );
            }
        }
    }

    #[test]
    fn system_template_ids_are_present_and_unique() {
        let mut ids: Vec<&str> = Vec::new();

        for template in SYSTEM_TEMPLATES.iter() {
            match template.id.as_deref() {
                Some(id) => {
                    assert!(!id.trim().is_empty(), "{} has a blank id", template.name);
                    ids.push(id);
                }
                None => panic!("system template {} has no id", template.name),
            }
        }

        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(
            unique.len(),
            ids.len(),
            "duplicate system template id in {ids:?}"
        );
    }

    #[test]
    fn find_system_template_round_trips() {
        let found = find_system_template(CANADIAN_STARTER_ID).expect("canadian starter is present");

        assert_eq!(found.id.as_deref(), Some(CANADIAN_STARTER_ID));
    }

    #[test]
    fn find_system_template_unknown_id_is_none() {
        for id in ["", "nope", "CANADIAN-STARTER"] {
            assert!(
                find_system_template(id).is_none(),
                "{id:?} must not resolve — the lookup is exact and case-sensitive"
            );
        }
    }

    #[test]
    fn all_names_within_length_bound() {
        for group in CANADIAN_STARTER.groups.iter() {
            assert_name_ok(&group.name);
            for category in group.categories.iter() {
                assert_name_ok(&category.name);
            }
        }
    }

    #[test]
    fn merge_with_no_overrides_preserves_every_authored_target() {
        let merged = merge_target_overrides(&CANADIAN_STARTER, &[]).unwrap();

        assert_eq!(merged.id.as_deref(), Some(CANADIAN_STARTER_ID));
        assert_eq!(merged.format_version, CANADIAN_STARTER.format_version);
        assert_eq!(merged.name, CANADIAN_STARTER.name);
        assert_eq!(merged.description, CANADIAN_STARTER.description);
        assert_eq!(merged.groups.len(), CANADIAN_STARTER.groups.len());

        for (merged_group, source_group) in merged.groups.iter().zip(CANADIAN_STARTER.groups.iter())
        {
            assert_eq!(merged_group.name, source_group.name);
            assert_eq!(merged_group.categories.len(), source_group.categories.len());
            for (merged_category, source_category) in merged_group
                .categories
                .iter()
                .zip(source_group.categories.iter())
            {
                assert_eq!(merged_category.name, source_category.name);
                assert_eq!(merged_category.target_cents, source_category.target_cents);
            }
        }
    }

    #[test]
    fn merge_applies_an_override_and_leaves_siblings_untouched() {
        let merged = merge_target_overrides(
            &CANADIAN_STARTER,
            &[override_entry("Housing", "Rent / Mortgage", 250_000)],
        )
        .unwrap();

        assert_eq!(target_of(&merged, "Housing", "Rent / Mortgage"), Some(250_000));
        assert_eq!(
            target_of(&merged, "Housing", "Home & Tenant Insurance"),
            target_of(&CANADIAN_STARTER, "Housing", "Home & Tenant Insurance")
        );
        assert_eq!(
            target_of(&merged, "Savings", "TFSA Contribution"),
            target_of(&CANADIAN_STARTER, "Savings", "TFSA Contribution")
        );
    }

    #[test]
    fn merge_matches_group_and_category_names_case_insensitively_and_trimmed() {
        let merged = merge_target_overrides(
            &CANADIAN_STARTER,
            &[override_entry("  hOuSiNg  ", "rent / MORTGAGE", 1_234)],
        )
        .unwrap();

        assert_eq!(target_of(&merged, "Housing", "Rent / Mortgage"), Some(1_234));
    }

    #[test]
    fn merge_applies_every_override_in_a_multi_entry_request() {
        let merged = merge_target_overrides(
            &CANADIAN_STARTER,
            &[
                override_entry("Housing", "Rent / Mortgage", 300_000),
                override_entry("Living", "Groceries", 75_000),
                override_entry("Savings", "Emergency Fund", 10_000),
            ],
        )
        .unwrap();

        assert_eq!(target_of(&merged, "Housing", "Rent / Mortgage"), Some(300_000));
        assert_eq!(target_of(&merged, "Living", "Groceries"), Some(75_000));
        assert_eq!(target_of(&merged, "Savings", "Emergency Fund"), Some(10_000));
    }

    #[test]
    fn merge_rejects_an_override_whose_group_does_not_exist() {
        let error = merge_target_overrides(
            &CANADIAN_STARTER,
            &[override_entry("Vacations", "Rent / Mortgage", 1_000)],
        )
        .unwrap_err();

        assert!(matches!(
            error,
            AppError::Validation { ref field, .. } if field.as_deref() == Some("overrides")
        ));
    }

    #[test]
    fn merge_rejects_an_override_whose_category_belongs_to_another_group() {
        // "Groceries" exists, but under "Living" — a group/category pair must match together,
        // or an edit could silently land on the wrong row.
        let error = merge_target_overrides(
            &CANADIAN_STARTER,
            &[override_entry("Housing", "Groceries", 1_000)],
        )
        .unwrap_err();

        assert!(matches!(error, AppError::Validation { .. }));
    }

    #[test]
    fn merge_rejects_a_negative_or_over_cap_target() {
        for cents in [-1, MAX_TEMPLATE_TARGET_CENTS + 1, i64::MAX] {
            let error = merge_target_overrides(
                &CANADIAN_STARTER,
                &[override_entry("Housing", "Rent / Mortgage", cents)],
            )
            .unwrap_err();

            assert!(
                matches!(
                    error,
                    AppError::Validation { ref field, .. } if field.as_deref() == Some("target_cents")
                ),
                "{cents} must be rejected on the same bounds rule as import"
            );
        }
    }

    #[test]
    fn merge_accepts_the_inclusive_bounds() {
        for cents in [0, MAX_TEMPLATE_TARGET_CENTS] {
            let merged = merge_target_overrides(
                &CANADIAN_STARTER,
                &[override_entry("Housing", "Rent / Mortgage", cents)],
            )
            .expect("the bound itself is valid input");

            assert_eq!(target_of(&merged, "Housing", "Rent / Mortgage"), Some(cents));
        }
    }

    #[test]
    fn merge_with_duplicate_overrides_for_the_same_pair_uses_the_first_entry() {
        // The frontend never emits two entries for the same pair (`buildOverrides` visits
        // each category once), but this boundary accepts raw input from any future caller.
        // `find_override` resolves via `.find()`, so the first entry wins silently — lock
        // that so a refactor toward last-wins (or outright rejection) is a deliberate,
        // reviewed change rather than an accidental one.
        let merged = merge_target_overrides(
            &CANADIAN_STARTER,
            &[
                override_entry("Housing", "Rent / Mortgage", 111_111),
                override_entry("Housing", "Rent / Mortgage", 222_222),
            ],
        )
        .unwrap();

        assert_eq!(
            target_of(&merged, "Housing", "Rent / Mortgage"),
            Some(111_111)
        );
    }

    #[test]
    fn merge_rejects_the_whole_request_when_any_entry_is_invalid() {
        // All-or-nothing: a partially applied edit set is indistinguishable from a
        // successful one to the caller, so one bad entry must fail the batch.
        let error = merge_target_overrides(
            &CANADIAN_STARTER,
            &[
                override_entry("Housing", "Rent / Mortgage", 300_000),
                override_entry("Housing", "Nope", 1_000),
            ],
        )
        .unwrap_err();

        assert!(matches!(error, AppError::Validation { .. }));
    }

    #[test]
    fn merged_template_still_passes_the_shared_document_validation() {
        // The merged document is handed straight to the shared apply core, which
        // re-validates. A merge that produced an invalid document would surface as an
        // opaque "not a valid template" file error at apply time.
        let merged = merge_target_overrides(
            &CANADIAN_STARTER,
            &[override_entry("Housing", "Rent / Mortgage", MAX_TEMPLATE_TARGET_CENTS)],
        )
        .unwrap();

        for group in merged.groups.iter() {
            assert_name_ok(&group.name);
            assert!(!group.categories.is_empty());
            for category in group.categories.iter() {
                assert_name_ok(&category.name);
                assert!(matches!(
                    category.target_cents,
                    Some(n) if (0..=MAX_TEMPLATE_TARGET_CENTS).contains(&n)
                ));
            }
        }
    }
}
