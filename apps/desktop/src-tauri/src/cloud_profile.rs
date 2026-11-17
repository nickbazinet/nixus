//! AD-7's lifecycle for a Nixus Cloud profile: refresh, save, avatar staleness, and AD-8's
//! first-upload consent — all of it in Rust.
//!
//! The one rule every path here obeys is AD-1: the cloud is the sole source of truth, so
//! `profiles/<sub>.json` and `avatars.db` are written ONLY from a server response. Nothing in this
//! module writes a value the server has not already accepted, which is why a failed `PUT` leaves
//! the copy byte-identical.
//!
//! It holds no HTTP client of its own — every request goes through `profile_client.rs`, the sole
//! profile network module (AD-9) — and no credential: the token is resolved inside that client.
//! What each outcome means to the Profile page lives in `state`, beside it.

#[cfg(test)]
mod e2e;
mod state;

use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tracing::{info, warn};

use crate::account_contract::{AVATAR_MAX_DECODED_BYTES, AVATAR_MIME_TYPES};
use crate::avatar_store::{self, StoredAvatar};
use crate::error::AppError;
use crate::models::{
    CloudAvatarWire, ProfileFields, PutAvatarRequestWire, PutProfileRequestWire,
    UpdateUserProfileInput, UserProfile,
};
use crate::profile_client::{self, ProfileClientError};
use crate::profile_store::{self, CloudCopyState};

pub(crate) use state::{status, CloudProfileStatus};
use state::{copy_state, reachability_for, update_state, Reachability};

#[cfg(test)]
pub(crate) use state::forget_state;

/// Fixed English sentences, one per code, for the refusals this module raises itself.
///
/// Never interpolated, for the same reason `profile_client`'s are not: the UI resolves its own
/// EN/FR copy from `code`, and a message is the one field that reaches a log (AD-12).
fn refusal(code: &'static str) -> AppError {
    let message = match code {
        "version_conflict" => "Your Nixus Cloud profile changed since it was loaded.",
        "payload_too_large" => "That profile picture is too large.",
        "unsupported_media" => "That file type is not supported.",
        "unauthorized" => "Sign in to your Nixus Cloud account to continue.",
        _ => "Your Nixus Cloud profile is temporarily unavailable.",
    };

    AppError::CloudProfile {
        code: code.to_string(),
        message: message.to_string(),
        field: None,
        reason: None,
        recoverable: !matches!(code, "payload_too_large" | "unsupported_media"),
    }
}

/// The contract code a client refusal carries, which is the only part of it that may be logged.
fn code_of(error: &ProfileClientError) -> &str {
    match error {
        ProfileClientError::VersionConflict { .. } => "version_conflict",
        ProfileClientError::Failed(AppError::CloudProfile { code, .. }) => code,
        ProfileClientError::Failed(_) => "unavailable",
    }
}

/// The `ProfileFields` half of a cloud copy, which is all any consumer of it reads.
pub(crate) fn fields_of_copy(profile: &UserProfile) -> ProfileFields {
    ProfileFields {
        first_name: profile.first_name.clone(),
        last_name: profile.last_name.clone(),
        birth_date: profile.birth_date.clone(),
        income_bracket: profile.income_bracket.clone(),
        income_bracket_currency: profile.income_bracket_currency.clone(),
        country_code: profile.country_code.clone(),
        subdivision_code: profile.subdivision_code.clone(),
    }
}

/// Compared through their serialized form rather than a `PartialEq` derive, so the comparison is
/// over the wire shape the server actually answered with and no field can be added to the contract
/// without being compared.
fn fields_match(sent: &ProfileFields, returned: &ProfileFields) -> bool {
    serde_json::to_value(sent).ok() == serde_json::to_value(returned).ok()
}

/// `expected_version` for a `PUT`: the copy's server version, or `null` for create-only (AD-4).
///
/// A legacy, declined or unreadable copy carries no server version, so it is `null` — never a
/// guess, because a wrong number is a `version_conflict` and a guessed one could overwrite.
fn expected_profile_version(dir: &Path, sub: &str) -> Option<u64> {
    match copy_state(dir, sub) {
        CloudCopyState::Synced(version) => Some(version),
        _ => None,
    }
}

/// AD-7's refresh: `GET`, write the copy from the response, then settle the avatar.
///
/// A network failure keeps the last copy and logs a state only. A `reauthentication_required` is
/// recorded instead, because it is the one outcome the user has to act on.
pub(crate) async fn refresh(dir: &Path, sub: &str) -> CloudProfileStatus {
    match profile_client::get_profile(sub).await {
        Ok(Some(wire)) => {
            // The cloud wins over any legacy file, and the write is what replaces it (AD-8).
            if let Err(error) = profile_store::write_cloud_copy(dir, sub, &wire) {
                warn!("The Nixus Cloud profile copy could not be written: {}", error);
            }
            update_state(sub, |state| {
                state.reachability = Reachability::Ready;
                state.consent_pending = false;
            });
            settle_avatar(dir, sub, wire.avatar_version).await;
        }
        Ok(None) => {
            // AD-8's prompt is owed only after a successful `GET` answered `null`, which is why it
            // cannot be offered to a session that never reached the API at all.
            let pending = matches!(copy_state(dir, sub), CloudCopyState::Legacy);
            update_state(sub, |state| {
                state.reachability = Reachability::Ready;
                state.consent_pending = pending;
            });
        }
        Err(error) => {
            let code = code_of(&error);
            let reachability = reachability_for(code);
            update_state(sub, |state| state.reachability = reachability);
            info!("A Nixus Cloud profile refresh did not complete ({})", code);
        }
    }

    status(dir, sub)
}

/// AD-4's staleness signal, and the whole reason the avatar is a separate item: the bytes are
/// fetched only when the server's `avatar_version` differs from the cached one (adversary H4).
///
/// An `avatar_version` of `null` deliberately KEEPS a cached row rather than mirroring the absence.
/// No surface in this product can remove an avatar — replacing is the whole vocabulary on both the
/// desktop and the account app — so the only account that reaches this branch with a cached row is
/// one that stored a picture before the service existed, and that row is the user's ONLY copy of
/// it. Destroying it is the avatar equivalent of the orphaning AD-8 exists to prevent, and the
/// sync spine's write-site ratchet independently forbids a second SQL write in this store.
async fn settle_avatar(dir: &Path, sub: &str, avatar_version: Option<u64>) {
    let Some(version) = avatar_version else {
        return;
    };

    let cached = match avatar_store::load_avatar(dir, sub) {
        Ok(cached) => cached,
        Err(error) => {
            warn!("The avatar cache could not be read: {}", error);
            return;
        }
    };

    if cached.and_then(|avatar| avatar.version) == Some(version) {
        return;
    }

    match profile_client::get_avatar(sub).await {
        Ok(Some(wire)) => {
            if let Err(error) = store_avatar(dir, sub, &wire) {
                warn!("The profile picture could not be cached: {}", error);
            }
        }
        Ok(None) => {}
        Err(error) => info!(
            "The Nixus Cloud profile picture could not be fetched ({})",
            code_of(&error)
        ),
    }
}

/// Mirrors `avatars.db`'s named `CHECK` constraints, so a server response can never be rejected by
/// the insert it is on its way to — the one place a refusal would be undiagnosable.
fn validate_derivative(image_bytes: &[u8], mime_type: &str) -> Result<(), AppError> {
    if image_bytes.is_empty() || image_bytes.len() > AVATAR_MAX_DECODED_BYTES {
        return Err(refusal("payload_too_large"));
    }

    if !AVATAR_MIME_TYPES.contains(&mime_type) {
        return Err(refusal("unsupported_media"));
    }

    Ok(())
}

fn store_avatar(
    dir: &Path,
    sub: &str,
    wire: &CloudAvatarWire,
) -> Result<StoredAvatar, AppError> {
    let image_bytes = STANDARD
        .decode(&wire.data)
        .map_err(|_| refusal("unsupported_media"))?;
    validate_derivative(&image_bytes, &wire.mime_type)?;

    avatar_store::save_avatar_with_version(
        dir,
        sub,
        &image_bytes,
        &wire.mime_type,
        Some(wire.version),
    )
}

/// AD-1/AD-7's save: validate as an affordance, `PUT`, await success, then rewrite the copy from
/// the response. There is no local write ahead of the server's answer on any branch.
pub(crate) async fn save(
    dir: &Path,
    sub: &str,
    input: &UpdateUserProfileInput,
) -> Result<UserProfile, AppError> {
    let fields = profile_store::validate_fields(input)?;
    let request = PutProfileRequestWire {
        fields: fields.clone(),
        expected_version: expected_profile_version(dir, sub),
    };

    match profile_client::put_profile(sub, &request).await {
        Ok(wire) => {
            let saved = profile_store::write_cloud_copy(dir, sub, &wire)?;
            update_state(sub, |state| {
                state.reachability = Reachability::Ready;
                state.consent_pending = false;
            });
            settle_avatar(dir, sub, wire.avatar_version).await;
            Ok(saved)
        }
        Err(ProfileClientError::VersionConflict {
            resource,
            current_version,
        }) => {
            info!(
                "A Nixus Cloud profile save conflicted (resource={}, current_version={})",
                resource
                    .map(profile_client::VersionedResource::wire_name)
                    .unwrap_or("unknown"),
                current_version
                    .map(|version| version.to_string())
                    .unwrap_or_else(|| "none".to_string())
            );
            reload_profile(dir, sub).await;
            Err(refusal("version_conflict"))
        }
        // `unavailable` is the one refusal that can mean the request was applied and its response
        // never observed, so it is resolved by a `GET` and a comparison before the user is told
        // anything (adversary L1). An offline device fails that `GET` too and reports `unavailable`.
        Err(ProfileClientError::Failed(error)) => {
            if is_unobserved(&error) {
                return resolve_unobserved(dir, sub, &fields).await;
            }

            let reachability = reachability_for(match &error {
                AppError::CloudProfile { code, .. } => code,
                _ => "unavailable",
            });
            update_state(sub, |state| state.reachability = reachability);
            Err(error)
        }
    }
}

fn is_unobserved(error: &AppError) -> bool {
    matches!(error, AppError::CloudProfile { code, .. } if code == "unavailable")
}

async fn resolve_unobserved(
    dir: &Path,
    sub: &str,
    sent: &ProfileFields,
) -> Result<UserProfile, AppError> {
    let Ok(Some(wire)) = profile_client::get_profile(sub).await else {
        update_state(sub, |state| state.reachability = Reachability::Offline);
        return Err(refusal("unavailable"));
    };

    let saved = profile_store::write_cloud_copy(dir, sub, &wire)?;

    if !fields_match(sent, &wire.fields) {
        update_state(sub, |state| state.reachability = Reachability::Offline);
        return Err(refusal("unavailable"));
    }

    info!("An unobserved Nixus Cloud profile save was confirmed by a read-back");
    update_state(sub, |state| {
        state.reachability = Reachability::Ready;
        state.consent_pending = false;
    });
    settle_avatar(dir, sub, wire.avatar_version).await;

    Ok(saved)
}

/// Replaces the copy with the server's current document, so a conflict leaves the device holding
/// what the cloud holds rather than the value that was refused.
async fn reload_profile(dir: &Path, sub: &str) {
    match profile_client::get_profile(sub).await {
        Ok(Some(wire)) => {
            if let Err(error) = profile_store::write_cloud_copy(dir, sub, &wire) {
                warn!("The Nixus Cloud profile copy could not be written: {}", error);
            }
        }
        Ok(None) => {}
        Err(error) => info!(
            "The Nixus Cloud profile could not be reloaded after a conflict ({})",
            code_of(&error)
        ),
    }
}

/// The avatar's own save, versioned independently of the profile and never written in the same
/// operation as it (AD-4).
pub(crate) async fn save_avatar(
    dir: &Path,
    sub: &str,
    image_bytes: &[u8],
    mime_type: &str,
) -> Result<StoredAvatar, AppError> {
    validate_derivative(image_bytes, mime_type)?;

    let expected_version = avatar_store::load_avatar(dir, sub)?.and_then(|avatar| avatar.version);
    let request = PutAvatarRequestWire {
        mime_type: mime_type.to_string(),
        data: STANDARD.encode(image_bytes),
        expected_version,
    };

    match profile_client::put_avatar(sub, &request).await {
        Ok(wire) => store_avatar(dir, sub, &wire),
        Err(ProfileClientError::VersionConflict { current_version, .. }) => {
            info!(
                "A Nixus Cloud avatar save conflicted (resource=avatar, current_version={})",
                current_version
                    .map(|version| version.to_string())
                    .unwrap_or_else(|| "none".to_string())
            );
            if let Ok(Some(wire)) = profile_client::get_avatar(sub).await {
                if let Err(error) = store_avatar(dir, sub, &wire) {
                    warn!("The profile picture could not be cached: {}", error);
                }
            }
            Err(refusal("version_conflict"))
        }
        Err(ProfileClientError::Failed(error)) => Err(error),
    }
}

/// AD-8's answer: accept uploads the legacy document create-only, decline records the refusal.
///
/// A conflict on the accept means the cloud gained a profile in the meantime, and the cloud wins:
/// its document replaces the legacy file and the upload is not retried.
pub(crate) async fn answer_upload(
    dir: &Path,
    sub: &str,
    accept: bool,
) -> Result<CloudProfileStatus, AppError> {
    if !accept {
        profile_store::mark_upload_declined(dir, sub)?;
        update_state(sub, |state| state.consent_pending = false);
        info!("The first upload of a legacy profile was declined");
        return Ok(status(dir, sub));
    }

    let Some(legacy) = profile_store::load_profile(dir, sub)? else {
        update_state(sub, |state| state.consent_pending = false);
        return Ok(status(dir, sub));
    };

    let request = PutProfileRequestWire {
        fields: fields_of_copy(&legacy),
        expected_version: None,
    };

    match profile_client::put_profile(sub, &request).await {
        Ok(wire) => {
            profile_store::write_cloud_copy(dir, sub, &wire)?;
        }
        Err(ProfileClientError::VersionConflict { .. }) => {
            let Ok(Some(wire)) = profile_client::get_profile(sub).await else {
                return Err(refusal("unavailable"));
            };
            info!("A Nixus Cloud profile already existed; its document replaced the legacy file");
            profile_store::write_cloud_copy(dir, sub, &wire)?;
        }
        Err(ProfileClientError::Failed(error)) => return Err(error),
    }

    update_state(sub, |state| {
        state.reachability = Reachability::Ready;
        state.consent_pending = false;
    });

    Ok(status(dir, sub))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SUB: &str = "cccccccc-0000-4000-8000-00000000000c";

    fn dir(root: &TempDir) -> std::path::PathBuf {
        profile_store::profiles_dir(root.path())
    }

    fn fields(first_name: Option<&str>) -> ProfileFields {
        ProfileFields {
            first_name: first_name.map(str::to_string),
            last_name: None,
            birth_date: None,
            income_bracket: None,
            income_bracket_currency: None,
            country_code: None,
            subdivision_code: None,
        }
    }




    // A legacy, declined or unreadable copy carries no server version, so the `PUT` must be
    // create-only rather than conditional on a number nobody has.
    #[test]
    fn only_a_synced_copy_contributes_an_expected_version() {
        let root = TempDir::new().expect("temp dir");
        let dir = dir(&root);

        assert_eq!(expected_profile_version(&dir, SUB), None);

        profile_store::write_cloud_copy(
            &dir,
            SUB,
            &crate::models::CloudProfileWire {
                fields: fields(Some("Ada")),
                version: 7,
                created_at: "2026-11-17T00:00:00Z".to_string(),
                updated_at: "2026-11-17T00:00:00Z".to_string(),
                avatar_version: None,
            },
        )
        .expect("the copy is written");

        assert_eq!(expected_profile_version(&dir, SUB), Some(7));
    }

    #[test]
    fn the_unobserved_comparison_is_over_every_contract_field() {
        assert!(fields_match(&fields(Some("Ada")), &fields(Some("Ada"))));
        assert!(!fields_match(&fields(Some("Ada")), &fields(Some("Grace"))));
        assert!(!fields_match(&fields(Some("Ada")), &fields(None)));
    }

    #[test]
    fn a_derivative_outside_the_caches_own_checks_is_refused_before_the_insert() {
        let ok = vec![1u8; 10];
        assert!(validate_derivative(&ok, "image/png").is_ok());
        assert!(validate_derivative(&ok, "image/jpeg").is_ok());
        assert!(validate_derivative(&ok, "image/webp").is_err());
        assert!(validate_derivative(&[], "image/png").is_err());
        assert!(validate_derivative(&vec![1u8; AVATAR_MAX_DECODED_BYTES], "image/png").is_ok());
        assert!(
            validate_derivative(&vec![1u8; AVATAR_MAX_DECODED_BYTES + 1], "image/png").is_err()
        );
    }

    // AD-12: every refusal this module raises is a fixed sentence with no value in it.
    #[test]
    fn no_refusal_this_module_raises_carries_a_value_or_an_identifier() {
        for code in [
            "version_conflict",
            "payload_too_large",
            "unsupported_media",
            "unauthorized",
            "unavailable",
        ] {
            let serialized = serde_json::to_string(&refusal(code)).expect("serializable");
            assert!(serialized.contains(r#""type":"cloud_profile""#), "{serialized}");
            assert!(!serialized.contains(SUB));
            for forbidden in ["://", "Bearer"] {
                assert!(!serialized.contains(forbidden));
            }
        }
    }

}
