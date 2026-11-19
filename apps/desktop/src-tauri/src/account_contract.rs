//! The Rust mirror of the Nixus Cloud profile contract, `packages/shared/src/types/account.ts`
//! (AD-13). The wire structs live in `models`; this module holds the closed code vocabularies and
//! the avatar ceilings, and its tests are the desktop half of the contract tests: they read the
//! TypeScript source and the shared fixtures, so a drift on either side fails here.

pub const ERROR_CODES: [&str; 8] = [
    "unauthorized",
    "reauthentication_required",
    "validation",
    "version_conflict",
    "payload_too_large",
    "unsupported_media",
    "rate_limited",
    "unavailable",
];

pub const VALIDATION_REASONS: [&str; 11] = [
    "invalid_type",
    "invalid_format",
    "required",
    "not_allowed",
    "in_future",
    "too_young",
    "too_old",
    "requires_country",
    "no_subdivisions",
    "dimensions_exceeded",
    "unknown_field",
];

pub const VALIDATION_FIELDS: [&str; 11] = [
    "first_name",
    "last_name",
    "birth_date",
    "income_bracket",
    "income_bracket_currency",
    "country_code",
    "subdivision_code",
    "expected_version",
    "mime_type",
    "data",
    "body",
];

pub const AVATAR_MIME_TYPES: [&str; 2] = ["image/png", "image/jpeg"];
/// The server's own dimension ceiling. Read by the contract tests below rather than by the
/// desktop: the derivative's 256px edge is enforced by `projects::image`'s downscale ladder, which
/// owns the only resizer, so a second check here could only disagree with it.
#[allow(dead_code)]
pub const AVATAR_MAX_EDGE_PX: u32 = 256;
pub const AVATAR_MAX_DECODED_BYTES: usize = 64 * 1024;

/// Maps any wire code — including one a newer server added — onto the closed union.
pub fn normalize_error_code(code: &str) -> &'static str {
    ERROR_CODES
        .iter()
        .find(|known| **known == code)
        .copied()
        .unwrap_or("unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        AccountErrorEnvelopeWire, CloudAvatarWire, CloudProfileWire, PutAvatarRequestWire,
        PutProfileRequestWire,
    };
    use std::path::PathBuf;

    fn shared_types_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/shared/src/types")
    }

    fn contract_source() -> String {
        std::fs::read_to_string(shared_types_dir().join("account.ts"))
            .expect("account.ts is readable")
    }

    /// The quoted members of `export const <name> = [ ... ] as const`, comments skipped.
    fn ts_array(source: &str, name: &str) -> Vec<String> {
        let start_marker = format!("export const {name} = [");
        let start = source
            .find(&start_marker)
            .unwrap_or_else(|| panic!("{name} is declared in account.ts"))
            + start_marker.len();
        let end = start + source[start..].find("] as const").expect("array is closed");

        source[start..end]
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("/**") && !line.starts_with('*'))
            .flat_map(|line| line.split(','))
            .filter_map(|item| {
                let item = item.trim();
                item.strip_prefix('"')
                    .and_then(|rest| rest.strip_suffix('"'))
                    .map(str::to_string)
            })
            .collect()
    }

    fn ts_number(source: &str, name: &str) -> String {
        let marker = format!("export const {name} = ");
        let start = source.find(&marker).expect("constant is declared") + marker.len();
        let end = start + source[start..].find(';').expect("statement ends");
        source[start..end].trim().to_string()
    }

    fn strs(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    // AD-5: the bracket and currency allow-lists are declared once in account.ts. The Rust
    // constants under test are `profile_store`'s, never `db/account::VALID_CURRENCIES`, which is
    // the unrelated account-currency allow-list.
    #[test]
    fn profile_store_allow_lists_match_the_shared_contract() {
        let source = contract_source();
        assert_eq!(
            strs(crate::profile_store::VALID_INCOME_BRACKETS),
            ts_array(&source, "INCOME_BRACKETS")
        );
        assert_eq!(
            strs(crate::profile_store::VALID_INCOME_BRACKET_CURRENCIES),
            ts_array(&source, "INCOME_BRACKET_CURRENCIES")
        );
    }

    #[test]
    fn age_window_matches_the_shared_contract() {
        let source = contract_source();
        assert_eq!(
            ts_number(&source, "PROFILE_MIN_AGE_YEARS"),
            crate::profile_store::MIN_AGE_YEARS.to_string()
        );
        assert_eq!(
            ts_number(&source, "PROFILE_MAX_AGE_YEARS"),
            crate::profile_store::MAX_AGE_YEARS.to_string()
        );
    }

    #[test]
    fn error_vocabularies_match_the_shared_contract() {
        let source = contract_source();
        assert_eq!(strs(&ERROR_CODES), ts_array(&source, "ACCOUNT_ERROR_CODES"));
        assert_eq!(
            strs(&VALIDATION_REASONS),
            ts_array(&source, "VALIDATION_REASONS")
        );
        assert_eq!(
            strs(&AVATAR_MIME_TYPES),
            ts_array(&source, "AVATAR_MIME_TYPES")
        );

        let mut fields = ts_array(&source, "PROFILE_FIELD_NAMES");
        fields.extend(ts_array(&source, "VALIDATION_FIELDS"));
        assert_eq!(strs(&VALIDATION_FIELDS), fields);
    }

    // The avatar ceilings are the server contract that `avatar_store`'s named CHECK constraints
    // mirror, so they are pinned against both the TS source and the derivation constant.
    #[test]
    fn avatar_ceilings_match_the_shared_contract_and_the_derivation() {
        let source = contract_source();
        assert_eq!(
            ts_number(&source, "AVATAR_MAX_EDGE_PX"),
            AVATAR_MAX_EDGE_PX.to_string()
        );
        assert_eq!(ts_number(&source, "AVATAR_MAX_DECODED_BYTES"), "64 * 1024");
        assert_eq!(AVATAR_MAX_DECODED_BYTES, 65_536);
        assert_eq!(
            crate::projects::image::MAX_PROJECT_THUMBNAIL_BYTES,
            AVATAR_MAX_DECODED_BYTES as u64
        );
    }

    #[test]
    fn an_unknown_error_code_normalizes_to_unavailable() {
        assert_eq!(normalize_error_code("quota_exhausted"), "unavailable");
        assert_eq!(normalize_error_code(""), "unavailable");
        for code in ERROR_CODES {
            assert_eq!(normalize_error_code(code), code);
        }
    }

    #[test]
    fn the_shared_fixtures_deserialize_into_the_rust_wire_models() {
        let raw = std::fs::read_to_string(shared_types_dir().join("account.fixtures.json"))
            .expect("fixtures are readable");
        let fixtures: serde_json::Value = serde_json::from_str(&raw).expect("fixtures parse");

        let full: CloudProfileWire =
            serde_json::from_value(fixtures["profile_full"].clone()).expect("profile_full");
        assert_eq!(full.version, 3);
        assert_eq!(full.avatar_version, Some(2));
        assert_eq!(full.fields.subdivision_code.as_deref(), Some("CA-QC"));

        let empty: CloudProfileWire =
            serde_json::from_value(fixtures["profile_empty"].clone()).expect("profile_empty");
        assert!(empty.fields.first_name.is_none());
        assert!(empty.avatar_version.is_none());

        for name in ["put_profile_create", "put_profile_update"] {
            let request: PutProfileRequestWire =
                serde_json::from_value(fixtures[name].clone()).expect(name);
            // Re-serializing must reproduce the fixture exactly: `expected_version: null` is
            // emitted, never omitted, and no member is added or renamed.
            assert_eq!(serde_json::to_value(&request).unwrap(), fixtures[name]);
        }

        let avatar: CloudAvatarWire =
            serde_json::from_value(fixtures["avatar"].clone()).expect("avatar");
        assert_eq!(avatar.version, 2);
        let put_avatar: PutAvatarRequestWire =
            serde_json::from_value(fixtures["put_avatar"].clone()).expect("put_avatar");
        assert_eq!(
            serde_json::to_value(&put_avatar).unwrap(),
            fixtures["put_avatar"]
        );

        let errors = fixtures["errors"].as_array().expect("errors array");
        let mut seen: Vec<String> = Vec::new();
        for entry in errors {
            let envelope: AccountErrorEnvelopeWire =
                serde_json::from_value(entry.clone()).expect("error envelope");
            assert_eq!(
                normalize_error_code(&envelope.error.code),
                envelope.error.code
            );
            if envelope.error.code == "validation" {
                let field = envelope.error.field.as_deref().expect("validation field");
                let reason = envelope.error.reason.as_deref().expect("validation reason");
                assert!(VALIDATION_FIELDS.contains(&field));
                assert!(VALIDATION_REASONS.contains(&reason));
            }
            if envelope.error.code == "version_conflict" {
                let resource = envelope.error.resource.as_deref().expect("resource");
                assert!(["profile", "avatar"].contains(&resource));
            }
            seen.push(envelope.error.code);
        }
        seen.sort();
        seen.dedup();
        let mut expected = strs(&ERROR_CODES);
        expected.sort();
        assert_eq!(seen, expected);
    }

    // Additive evolution: a newer server's extra member must not break an older client.
    #[test]
    fn an_unknown_response_member_is_ignored() {
        let mut value: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(shared_types_dir().join("account.fixtures.json")).unwrap(),
        )
        .unwrap();
        value["profile_full"]["display_name"] = serde_json::json!("new field");
        let parsed: CloudProfileWire = serde_json::from_value(value["profile_full"].clone())
            .expect("unknown member is ignored");
        assert_eq!(parsed.version, 3);
    }
}
