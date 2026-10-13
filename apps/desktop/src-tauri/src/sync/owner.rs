//! The create-only `acct/<identity-id>/owner` object: the binding between an identity id
//! and the user-pool `sub` that owns the prefix (AD-7).
//!
//! Its own module rather than part of `sync/auth.rs` for a structural reason:
//! `tests_auth_boundary.rs` forbids `serde`, `rusqlite` and `std::fs` anywhere in
//! `auth.rs`, because a serializer in the file that holds vended AWS credentials is the
//! first step of every accidental persistence. Reading this document needs a JSON parser,
//! so the document belongs beside the guard rather than inside it.

use super::auth::{AccountPin, AuthError};

/// AD-6's owner key, relative to `acct/<identity-id>/`.
pub const OWNER_OBJECT_KEY: &str = "owner";

/// The version of the document (Story 3's `v`).
pub const OWNER_OBJECT_VERSION: u32 = 1;

/// The body, in the shape Story 3 proved against the deployed bucket: compact UTF-8 JSON
/// with sorted keys and exactly four fields.
///
/// Hand-serialized rather than derived, for the same reason as `snap/LATEST`: the document
/// is a wire contract between app versions, so the exact spelling is part of it, and a
/// `#[derive(Serialize)]` would let a field rename silently change the bytes.
pub fn owner_object_body(pin: &AccountPin, created_ms: i64) -> Vec<u8> {
    format!(
        "{{\"created_ms\":{},\"identity_id\":\"{}\",\"sub\":\"{}\",\"v\":{}}}",
        created_ms, pin.identity_id, pin.owner_sub, OWNER_OBJECT_VERSION
    )
    .into_bytes()
}

/// The `sub` the account prefix is bound to.
///
/// Unknown fields are ignored and `sub` is required, so a later version may add to the
/// document without this build losing the ability to compare owners. A body that cannot be
/// read is refused rather than treated as an absent object: an absent owner means "nobody
/// owns this prefix yet", which is a first-enable, and mistaking a malformed one for it
/// would let a second account start a source of truth under the same prefix (AD-7).
pub fn owner_sub_from_body(body: &[u8]) -> Result<String, AuthError> {
    let document: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| AuthError::MalformedOwnerObject)?;

    let owner_sub = document
        .get("sub")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|sub| !sub.is_empty())
        .ok_or(AuthError::MalformedOwnerObject)?;

    Ok(owner_sub.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTITY: &str = "us-east-1:11111111-2222-3333-4444-555555555555";
    const SUB: &str = "66666666-7777-8888-9999-000000000000";

    fn pin() -> AccountPin {
        AccountPin::new(IDENTITY, SUB)
    }

    #[test]
    fn the_body_is_exactly_the_four_sorted_fields_the_infrastructure_track_proved() {
        assert_eq!(
            String::from_utf8(owner_object_body(&pin(), 1_760_000_000_000)).expect("utf-8"),
            format!(
                "{{\"created_ms\":1760000000000,\"identity_id\":\"{IDENTITY}\",\
                 \"sub\":\"{SUB}\",\"v\":1}}"
            )
        );
    }

    #[test]
    fn the_owner_sub_round_trips_and_survives_a_field_a_later_version_adds() {
        assert_eq!(
            owner_sub_from_body(&owner_object_body(&pin(), 1)).expect("round trips"),
            SUB
        );
        assert_eq!(
            owner_sub_from_body(
                format!("{{\"sub\":\"{SUB}\",\"v\":1,\"from_a_later_build\":true}}").as_bytes()
            )
            .expect("unknown fields are ignored"),
            SUB
        );
    }

    #[test]
    fn an_unreadable_owner_object_is_never_mistaken_for_an_absent_one() {
        for body in [
            b"".as_slice(),
            b"   \n".as_slice(),
            &[0xff, 0xfe][..],
            br#"{"v":1}"#.as_slice(),
            br#"{"sub":""}"#.as_slice(),
            br#"{"sub":"   "}"#.as_slice(),
            br#"{"sub":42}"#.as_slice(),
            SUB.as_bytes(),
        ] {
            assert_eq!(
                owner_sub_from_body(body),
                Err(AuthError::MalformedOwnerObject),
                "{body:?} must be refused"
            );
        }
    }
}
