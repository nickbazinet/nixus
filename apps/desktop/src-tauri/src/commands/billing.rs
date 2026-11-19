//! The IPC surface that reaches Nixus Cloud commerce (billing AD-8, AD-12, Epic F).
//!
//! Two commands, and both answer `Result<(), AppError>`. That is the AD-8 enforcement rather
//! than a convenience: `billing_client::open_checkout` and `open_portal` keep the server-issued
//! URL inside the sole billing module and open it in the **system browser** themselves, so there
//! is no value either command could hand to the webview even by mistake. Nixus renders no card
//! field on any surface, and Checkout and the Portal are always Stripe-hosted.
//!
//! Deliberately its own file rather than an addition to `commands/cloud_ai.rs`: that module is
//! pinned by `ai::backend::boundary_guards::the_entitlement_command_carries_no_usage_figure`,
//! which asserts its whole source answers with a bare `bool` and never names a usage figure.
//!
//! Neither command takes a subject, a customer id or a subscription id. The subject is resolved
//! here from the machine's own session through `commands::auth::current_subject`, for the same
//! reason AD-3 forbids a body-supplied subject on the server: a caller-chosen identity is a
//! request to act as somebody else, and the webview is as untrusted a caller as an HTTP client.
//!
//! Which surface the user lands on is **the server's decision** (AD-18): `POST /checkout` routes
//! an account that already subscribes to the Portal and answers with whichever URL it chose. This
//! module never inspects that, so "upgrade" and "manage" cannot disagree with the server about
//! what the account currently has.

use tauri::AppHandle;

use crate::billing_client::{self, BillingRefusal};
use crate::commands::auth;
use crate::error::AppError;

/// Mirrors `PLAN_LOOKUP_KEY_MAX_LENGTH` in `packages/shared/src/types/billing.ts`, pinned
/// against that source by a test below.
const PLAN_LOOKUP_KEY_MAX_LENGTH: usize = 64;

/// The Rust equivalent of the contract's `isPlanLookupKeyShaped`, whose pattern is
/// `^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$`.
///
/// Hand-written rather than a regex because the crate carries no regex dependency and the
/// grammar is three rules; the pattern literal is pinned against `billing.ts` by a test, so a
/// change on either side fails here instead of silently diverging.
fn is_plan_lookup_key_shaped(value: &str) -> bool {
    if value.len() > PLAN_LOOKUP_KEY_MAX_LENGTH {
        return false;
    }

    let mut segments = value.split('_');
    let Some(head) = segments.next() else {
        return false;
    };

    let mut head_chars = head.chars();
    match head_chars.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    if !head_chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return false;
    }

    let mut tail_segments = 0usize;
    for segment in segments {
        tail_segments += 1;
        if segment.is_empty()
            || !segment
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return false;
        }
    }

    tail_segments > 0
}

/// Refuses a malformed key locally, before any network call and without echoing what was
/// submitted: the value came from the webview, and `AppError` crosses straight back into it, so
/// reflecting it is the one thing a refusal message must not do (AD-12).
fn validated_plan_lookup_key(plan_lookup_key: &str) -> Result<&str, AppError> {
    if is_plan_lookup_key_shaped(plan_lookup_key) {
        return Ok(plan_lookup_key);
    }

    Err(AppError::Billing {
        code: "validation".to_string(),
        message: "That is not a Nixus Cloud plan.".to_string(),
        recoverable: false,
    })
}

/// The one place a billing refusal becomes an `AppError`.
///
/// `recoverable` is "would the identical click plausibly work later", and two arms are the point
/// of this function rather than a default:
///
/// - `ForcedUpgrade` is **not** a sign-out and **not** retryable. The server will not serve this
///   build, and only installing a newer Nixus repairs it; ending the session would be both
///   useless and exactly the "a client limitation read as an auth failure" confusion AD-12
///   exists to prevent.
/// - `SignedOut` and `ReauthenticationRequired` carry the same two codes the auth surfaces
///   already recover from, so the frontend routes them into sign-in rather than an error toast.
fn billing_error(refusal: BillingRefusal) -> AppError {
    let (code, message, recoverable) = match refusal {
        BillingRefusal::SignedOut => (
            "unauthorized",
            "Sign in to your Nixus Cloud account to continue.",
            true,
        ),
        BillingRefusal::ReauthenticationRequired => (
            "reauthentication_required",
            "Sign in again to continue.",
            true,
        ),
        BillingRefusal::ForcedUpgrade { .. } => (
            "client_too_old",
            "This version of Nixus is too old for Nixus Cloud plans. Install the latest version.",
            false,
        ),
        BillingRefusal::CapabilityRefused => (
            "premium_required",
            "This Nixus Cloud account has no plan to manage.",
            true,
        ),
        BillingRefusal::Rejected { code: "validation" } => {
            ("validation", "Nixus Cloud refused this request.", false)
        }
        BillingRefusal::Rejected {
            code: "version_conflict",
        } => (
            "version_conflict",
            "The plan changed somewhere else. Try again.",
            true,
        ),
        BillingRefusal::Rejected {
            code: "promotion_invalid",
        } => (
            "promotion_invalid",
            "That promotion code cannot be used.",
            false,
        ),
        BillingRefusal::Rejected {
            code: "checkout_in_progress",
        } => (
            "checkout_in_progress",
            "A plan change is already open in your browser. Finish it there.",
            true,
        ),
        // `BillingRefusal::Rejected` carries only the four codes above, and `Transient` is
        // `rate_limited` and `unavailable`. Both degrade to the one outcome a wait repairs.
        BillingRefusal::Rejected { .. } | BillingRefusal::Transient => (
            "unavailable",
            "Nixus Cloud could not be reached. Try again in a moment.",
            true,
        ),
    };

    AppError::Billing {
        code: code.to_string(),
        message: message.to_string(),
        recoverable,
    }
}

/// An unresolvable session is a sign-in, not a billing outage: the click cannot name an account,
/// and the account surfaces already know how to recover from this code.
async fn subject() -> Result<String, AppError> {
    auth::current_subject()
        .await
        .map_err(|_| billing_error(BillingRefusal::SignedOut))
}

/// Opens Stripe-hosted Checkout for `plan_lookup_key` in the system browser.
///
/// The server validates the key against the live catalog and may answer with the **Portal**
/// instead when the account already subscribes (AD-18); either way the URL is opened by
/// `billing_client` and never returned here.
#[tauri::command(rename_all = "snake_case")]
pub async fn open_billing_checkout(
    app: AppHandle,
    plan_lookup_key: String,
) -> Result<(), AppError> {
    let plan_lookup_key = validated_plan_lookup_key(&plan_lookup_key)?;
    let sub = subject().await?;

    billing_client::open_checkout(&app, &sub, plan_lookup_key, None)
        .await
        .map_err(billing_error)
}

/// Opens the Stripe-hosted Customer Portal in the system browser.
#[tauri::command(rename_all = "snake_case")]
pub async fn open_billing_portal(app: AppHandle) -> Result<(), AppError> {
    let sub = subject().await?;

    billing_client::open_portal(&app, &sub)
        .await
        .map_err(billing_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repo_file(relative: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
    }

    /// This module's shipped half. Cut on the test module's own declaration, for the same reason
    /// every other source guard in this crate does: the assertions below quote the very needles
    /// they search for.
    fn production_source() -> String {
        let whole = std::fs::read_to_string(repo_file("src/commands/billing.rs"))
            .expect("this module is readable");

        whole
            .split_once("mod tests {")
            .map(|(production, _)| production.to_string())
            .expect("this module carries a test module")
    }

    fn signature_of(name: &str) -> String {
        let production = production_source();
        let marker = format!("pub async fn {name}(");
        let start = production
            .find(&marker)
            .unwrap_or_else(|| panic!("{name} is declared"));
        let end = start
            + production[start..]
                .find('{')
                .expect("the signature is followed by a body");

        production[start..end].to_string()
    }

    fn body_of(name: &str) -> String {
        let production = production_source();
        let marker = format!("pub async fn {name}(");
        let start = production
            .find(&marker)
            .unwrap_or_else(|| panic!("{name} is declared"));
        let rest = &production[start..];
        let end = rest.find("\n}").map_or(rest.len(), |offset| offset + 2);

        rest[..end].to_string()
    }

    // --- the plan key, refused locally ----------------------------------------------------

    #[test]
    fn the_shape_check_mirrors_the_shared_contracts_pattern_exactly() {
        let contract =
            std::fs::read_to_string(repo_file("../../../packages/shared/src/types/billing.ts"))
                .expect("billing.ts is readable");

        assert!(
            contract.contains(
                "export const PLAN_LOOKUP_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;"
            ),
            "the pattern this module mirrors changed in billing.ts"
        );
        assert!(
            contract.contains(&format!(
                "export const PLAN_LOOKUP_KEY_MAX_LENGTH = {PLAN_LOOKUP_KEY_MAX_LENGTH};"
            )),
            "the maximum length this module mirrors changed in billing.ts"
        );
    }

    #[test]
    fn the_live_catalog_keys_are_accepted() {
        for key in [
            "advance_monthly_cad",
            "classic_monthly_cad",
            "a_b",
            "plan2_monthly_cad",
        ] {
            assert!(is_plan_lookup_key_shaped(key), "{key} must be accepted");
            assert_eq!(validated_plan_lookup_key(key).expect("accepted"), key);
        }
    }

    /// A malformed key is refused on its shape alone — no subject is resolved, no token is
    /// minted and no request is issued, because `validated_plan_lookup_key` is a pure function
    /// over the string and returns before anything else runs. The ordering guard below pins
    /// that it stays the first statement of the command.
    #[test]
    fn a_malformed_plan_key_is_refused_without_echoing_what_was_submitted() {
        let rejected = [
            "",
            "advance",
            "Advance_Monthly_CAD",
            "advance__monthly",
            "_advance_monthly",
            "advance_monthly_",
            "9advance_monthly",
            "advance-monthly-cad",
            "advance monthly cad",
            "advance_monthly_cad\n",
            "advance_monthly_café",
            "../../../etc/passwd",
            "https://evil.example.com/pay",
            &"a_".repeat(40),
        ];

        for key in rejected {
            assert!(!is_plan_lookup_key_shaped(key), "{key:?} must be refused");

            let error = validated_plan_lookup_key(key).expect_err("refused");
            let AppError::Billing {
                code,
                message,
                recoverable,
            } = &error
            else {
                panic!("a malformed key must be refused as a billing validation");
            };

            assert_eq!(code, "validation");
            assert!(!recoverable, "resending the same key cannot help");
            assert!(
                !message.contains(key) || key.is_empty(),
                "the refusal must not reflect the submitted value, but it reads {message}"
            );
            assert!(
                !error.to_string().contains("evil.example.com")
                    && !error.to_string().contains("etc/passwd"),
                "nor may Display reflect it"
            );
        }
    }

    // --- the refusal mapping ---------------------------------------------------------------

    fn code_of(refusal: BillingRefusal) -> (String, bool) {
        match billing_error(refusal) {
            AppError::Billing {
                code, recoverable, ..
            } => (code, recoverable),
            other => panic!("a billing refusal must map onto AppError::Billing, got {other}"),
        }
    }

    /// The one refusal that must never end a session: a build the server will not serve is
    /// repaired by installing a newer one (AD-12).
    #[test]
    fn a_forced_upgrade_never_produces_a_signed_out_outcome() {
        for minimum_client_version in [None, Some("1.0.0".to_string())] {
            let (code, recoverable) = code_of(BillingRefusal::ForcedUpgrade {
                minimum_client_version,
            });

            assert_eq!(code, "client_too_old");
            assert!(!recoverable, "only a newer build repairs it, never a retry");

            let (signed_out, _) = code_of(BillingRefusal::SignedOut);
            let (reauth, _) = code_of(BillingRefusal::ReauthenticationRequired);
            assert_ne!(code, signed_out);
            assert_ne!(code, reauth);
        }
    }

    #[test]
    fn every_refusal_maps_onto_a_contract_code_and_a_fixed_sentence() {
        let expected = [
            (BillingRefusal::SignedOut, "unauthorized", true),
            (
                BillingRefusal::ReauthenticationRequired,
                "reauthentication_required",
                true,
            ),
            (
                BillingRefusal::ForcedUpgrade {
                    minimum_client_version: None,
                },
                "client_too_old",
                false,
            ),
            (BillingRefusal::CapabilityRefused, "premium_required", true),
            (
                BillingRefusal::Rejected { code: "validation" },
                "validation",
                false,
            ),
            (
                BillingRefusal::Rejected {
                    code: "version_conflict",
                },
                "version_conflict",
                true,
            ),
            (
                BillingRefusal::Rejected {
                    code: "promotion_invalid",
                },
                "promotion_invalid",
                false,
            ),
            (
                BillingRefusal::Rejected {
                    code: "checkout_in_progress",
                },
                "checkout_in_progress",
                true,
            ),
            (BillingRefusal::Transient, "unavailable", true),
        ];

        let contract =
            std::fs::read_to_string(repo_file("../../../packages/shared/src/types/billing.ts"))
                .expect("billing.ts is readable");

        for (refusal, code, recoverable) in expected {
            let mapped = code_of(refusal.clone());

            assert_eq!(mapped.0, code, "refusal {refusal:?}");
            assert_eq!(mapped.1, recoverable, "refusal {refusal:?}");
            assert!(
                contract.contains(&format!("\"{code}\"")),
                "{code} must be a member of the shared billing error union"
            );
        }
    }

    /// `message` is a fixed sentence read by logs and support, so it may never carry a URL, an
    /// account identifier or a Stripe object id (AD-14).
    #[test]
    fn no_refusal_sentence_carries_a_url_or_an_identifier() {
        for refusal in [
            BillingRefusal::SignedOut,
            BillingRefusal::ReauthenticationRequired,
            BillingRefusal::ForcedUpgrade {
                minimum_client_version: Some("1.0.0".to_string()),
            },
            BillingRefusal::CapabilityRefused,
            BillingRefusal::Rejected { code: "validation" },
            BillingRefusal::Transient,
        ] {
            let rendered = billing_error(refusal).to_string();

            for forbidden in ["http", "stripe", "cus_", "sub_", "cs_", "1.0.0"] {
                assert!(
                    !rendered.to_lowercase().contains(forbidden),
                    "{forbidden} must not reach a billing refusal sentence, but it reads \
                     {rendered}"
                );
            }
        }
    }

    // --- the command surface ---------------------------------------------------------------

    /// AD-8 as a type-level fact: neither command can hand a commerce URL to the webview,
    /// because neither has anything but `()` to answer with.
    #[test]
    fn neither_command_can_return_a_url() {
        for name in ["open_billing_checkout", "open_billing_portal"] {
            let signature = signature_of(name);

            assert!(
                signature.contains("-> Result<(), AppError>"),
                "{name} must answer with no URL at all, but reads {signature}"
            );
            assert!(
                !signature.contains("String>") && !signature.contains("url"),
                "{name} must not answer with a string, but reads {signature}"
            );
        }

        let production = production_source();
        assert!(
            !production.contains("fn checkout_url") && !production.contains("fn portal_url"),
            "a URL-returning accessor would reintroduce the webview path AD-8 forbids"
        );
    }

    /// AD-3's rule, applied to the IPC boundary: there is no caller-supplied subject to ignore,
    /// because there is no parameter to supply one through.
    #[test]
    fn neither_command_accepts_a_caller_supplied_identity() {
        for name in ["open_billing_checkout", "open_billing_portal"] {
            let signature = signature_of(name);

            for forbidden in [
                "sub:",
                "subject",
                "customer",
                "subscription",
                "expected_sub",
                "access_token",
                "email",
            ] {
                assert!(
                    !signature.contains(forbidden),
                    "{name} must not take {forbidden}, but reads {signature}"
                );
            }

            assert!(
                body_of(name).contains("subject().await?"),
                "{name} must resolve the subject itself"
            );
        }

        assert!(
            production_source().contains("auth::current_subject()"),
            "the subject must come from the machine's own session"
        );
    }

    /// The local refusal has to come first, or a malformed key costs a keyring read and a round
    /// trip before being rejected by the server anyway.
    #[test]
    fn the_key_is_validated_before_a_subject_is_resolved_or_a_request_is_sent() {
        let body = body_of("open_billing_checkout");

        let validated = body
            .find("validated_plan_lookup_key")
            .expect("the key is validated");
        let resolved = body
            .find("subject().await?")
            .expect("the subject is resolved");
        let sent = body
            .find("billing_client::open_checkout")
            .expect("the client is called");

        assert!(
            validated < resolved && resolved < sent,
            "validate, then resolve, then send"
        );
    }

    /// Neither command may log at all: the only values in scope are the submitted key and the
    /// resolved subject, and both are things a billing log must never carry (AD-14).
    #[test]
    fn this_module_logs_nothing_and_opens_nothing_itself() {
        let production = production_source();

        for forbidden in [
            "info!", "warn!", "error!", "debug!", "trace!", "println!", "opener", "open_url",
            "reqwest",
        ] {
            assert!(
                !production.contains(forbidden),
                "{forbidden} must not appear in this module"
            );
        }
    }
}
