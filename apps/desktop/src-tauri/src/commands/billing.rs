//! The IPC surface that reaches Nixus Cloud commerce (billing AD-8, AD-12, AD-13, Epic F).
//!
//! The two commerce commands both answer `Result<(), AppError>`. That is the AD-8 enforcement
//! rather than a convenience: `billing_client::open_checkout` and `open_portal` keep the
//! server-issued URL inside the sole billing module and open it in the **system browser**
//! themselves, so there is no value either command could hand to the webview even by mistake.
//! Nixus renders no card field on any surface, and Checkout and the Portal are always
//! Stripe-hosted.
//!
//! The third command answers the capability question those two surfaces are gated on. It is here
//! and not in `commands/cloud_ai.rs` because that module is pinned by
//! `ai::backend::boundary_guards::the_entitlement_command_carries_no_usage_figure` to a bare
//! `bool`, and the gates need a list. The half of that prohibition that matters is kept intact
//! and applied to this file too: `the_capability_command_carries_no_usage_figure` below asserts
//! this module's shipped half names no usage figure at all (AD-9).
//!
//! Neither commerce command takes a subject, a customer id or a subscription id, and neither does
//! the capability read. The subject is resolved from the machine's own session through
//! `commands::auth::current_subject`, for the same reason AD-3 forbids a body-supplied subject on
//! the server: a caller-chosen identity is a request to act as somebody else, and the webview is
//! as untrusted a caller as an HTTP client.
//!
//! Which surface the user lands on is **the server's decision** (AD-18): `POST /checkout` routes
//! an account that already subscribes to the Portal and answers with whichever URL it chose. This
//! module never inspects that, so "upgrade" and "manage" cannot disagree with the server about
//! what the account currently has.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::billing_client::{self, BillingRefusal};
use crate::commands::auth;
use crate::entitlements::{self, SurfaceEntitlement};
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

/// The capability answer a billing surface gates on (AD-1, AD-13).
///
/// Exactly three fields, and the two absences are the design:
///
/// - `capabilities` is the only field a gate may read. A client testing it is asking the one
///   question the statement actually answers, which is what lets a new plan ship as a
///   server-side change with no desktop release.
/// - `tier` is an opaque label that crosses the wire for display and support. A client may print
///   it and may never compare it, and nothing in this crate compares it either — the source guard
///   in `entitlements.rs` fails the build if any file does.
/// - `established` is the distinction `get_cloud_ai_premium`'s fail-closed boolean cannot carry.
///   A verified statement granting nothing is a free or lower plan, which an upgrade repairs; an
///   entitlement that could not be established is a transient problem an upgrade cannot. Selling
///   a plan to a user with a flaky connection is the defect this field exists to prevent (AD-9).
///
/// There is no fourth field, and in particular no usage figure: the limit the statement claims
/// carry, the charged count and the period all stay inside the crate, and the source guard below
/// pins that for this file the way `commands/cloud_ai.rs` is pinned for its own (AD-9).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingEntitlementView {
    pub established: bool,
    pub tier: Option<String>,
    pub capabilities: Vec<String>,
}

impl BillingEntitlementView {
    /// A pure projection, so every row of the answer matrix is testable with no statement cache,
    /// no keyring and no network.
    ///
    /// An unestablished answer is flattened to "nothing known" rather than passed through
    /// field-by-field: it must be impossible for this view to carry a label or a capability the
    /// device never verified.
    fn of(entitlement: &SurfaceEntitlement) -> Self {
        if !entitlement.is_established() {
            return Self {
                established: false,
                tier: None,
                capabilities: Vec::new(),
            };
        }

        Self {
            established: true,
            tier: entitlement.tier.clone(),
            capabilities: entitlement
                .capability_names()
                .into_iter()
                .map(str::to_string)
                .collect(),
        }
    }
}

/// What the signed-in Nixus Cloud account's entitlement grants, and whether it is an answer yet.
///
/// Never `Err`, for the same reason `get_cloud_ai_premium` never is: the entitlement read is
/// fail-closed, so an unreachable billing API is an ordinary product state carried in
/// `established: false` rather than an error the webview has to handle. The `Result` is the
/// command contract, not a channel this path uses.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_billing_entitlement() -> Result<BillingEntitlementView, AppError> {
    Ok(BillingEntitlementView::of(
        &entitlements::surface_entitlement().await,
    ))
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

    /// The shipped half with every comment line removed, so a scan for a forbidden symbol cannot
    /// match this module's own documentation of that prohibition.
    fn production_code() -> String {
        production_source()
            .lines()
            .filter(|line| {
                let trimmed = line.trim_start();
                !(trimmed.starts_with("//")
                    || trimmed.starts_with("*")
                    || trimmed.starts_with("/*"))
            })
            .collect::<Vec<_>>()
            .join("\n")
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

    // --- the capability answer --------------------------------------------------------------

    use crate::entitlements::{
        AccountCapabilities, EntitlementAnswer, StatedEntitlement, HOSTED_AI, HOUSEHOLD_NET_WORTH,
        MULTI_DEVICE_SYNC,
    };

    fn verified(
        capabilities: &[crate::entitlements::Capability],
        tier: &str,
    ) -> SurfaceEntitlement {
        SurfaceEntitlement {
            answer: EntitlementAnswer::Verified(AccountCapabilities::from_capabilities(
                capabilities,
            )),
            tier: Some(tier.to_string()),
        }
    }

    /// The counterpart of `the_entitlement_command_carries_no_usage_figure`, applied to this file
    /// from the day it grew a capability-bearing command rather than after a usage figure has
    /// already leaked. The frontend has no legitimate use for the limit, the charged count or the
    /// period, and shipping one would create the quota surface the architecture defers (AD-9).
    ///
    /// Scanned with comment lines stripped, for the same reason
    /// `ai::backend::boundary_guards::production_source` strips them: this module *documents* the
    /// symbols it must never carry, so a raw text scan matches its own prohibition — and one that
    /// did would force the prohibition to go undocumented to stay green.
    #[test]
    fn the_capability_command_carries_no_usage_figure() {
        let code = production_code();

        for symbol in [
            "monthly_request_limit",
            "charged_count",
            "period",
            "HostedAiStatus",
            "hosted_state",
        ] {
            assert!(
                !code.contains(symbol),
                "{symbol} must never cross IPC (AD-9)"
            );
        }
    }

    /// The view carries three fields and no more. A source assertion rather than a serde
    /// round-trip, because the failure being guarded against is a field being *added*, and a
    /// round-trip of a known shape cannot see one.
    #[test]
    fn the_view_declares_exactly_the_three_sanctioned_fields() {
        let production = production_source();
        let start = production
            .find("pub struct BillingEntitlementView {")
            .expect("the view is declared");
        let body = &production[start..];
        let end = body.find("\n}").expect("the declaration closes");

        let fields: Vec<&str> = body[..end]
            .lines()
            .skip(1)
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with("//"))
            .collect();

        assert_eq!(
            fields,
            vec![
                "pub established: bool,",
                "pub tier: Option<String>,",
                "pub capabilities: Vec<String>,",
            ]
        );
    }

    #[test]
    fn the_command_answers_the_view_and_takes_no_caller_supplied_identity() {
        let signature = signature_of("get_billing_entitlement");

        assert!(
            signature.contains("-> Result<BillingEntitlementView, AppError>"),
            "the command must answer the capability view, but reads {signature}"
        );
        assert!(
            signature.contains("get_billing_entitlement()"),
            "the command must take no argument at all, but reads {signature}"
        );
    }

    /// An Advance-shaped grant: every capability, and the opaque label carried through for
    /// display. Sorted because `capability_names` walks the union, which is pinned sorted on both
    /// sides of the contract.
    #[test]
    fn a_verified_grant_is_established_and_carries_its_sorted_names_and_tier() {
        let view = BillingEntitlementView::of(&verified(
            &[MULTI_DEVICE_SYNC, HOSTED_AI, HOUSEHOLD_NET_WORTH],
            "advance",
        ));

        assert!(view.established);
        assert_eq!(view.tier.as_deref(), Some("advance"));
        assert_eq!(
            view.capabilities,
            vec!["hosted_ai", "household_net_worth", "multi_device_sync"]
        );

        let mut sorted = view.capabilities.clone();
        sorted.sort();
        assert_eq!(view.capabilities, sorted);
    }

    /// The defect this whole command exists to fix: a Classic subscriber holds no `hosted_ai`, so
    /// the hosted-AI boolean reports them as entitled to nothing and the Portal becomes
    /// unreachable for a paying customer. Here they hold a non-empty capability list.
    #[test]
    fn a_classic_shaped_grant_yields_a_non_empty_capability_list_without_hosted_ai() {
        let view = BillingEntitlementView::of(&verified(
            &[HOUSEHOLD_NET_WORTH, MULTI_DEVICE_SYNC],
            "classic",
        ));

        assert!(view.established);
        assert_eq!(
            view.capabilities,
            vec!["household_net_worth", "multi_device_sync"]
        );
        assert!(!view.capabilities.is_empty(), "this account has a plan");
        assert!(!view.capabilities.contains(&"hosted_ai".to_string()));
    }

    /// Verified free: an answer, and an answer an upgrade repairs.
    #[test]
    fn a_verified_free_grant_is_established_and_empty() {
        let view = BillingEntitlementView::of(&verified(&[], "free"));

        assert!(view.established);
        assert_eq!(view.tier.as_deref(), Some("free"));
        assert!(view.capabilities.is_empty());
    }

    /// Unestablished: not an answer, so no capability and no label may cross. Asserted against an
    /// entitlement that *does* carry a label, because flattening it is the whole point — a value
    /// the device never verified must not reach a surface that would display it as current.
    #[test]
    fn an_unestablished_answer_carries_nothing_at_all() {
        let view = BillingEntitlementView::of(&SurfaceEntitlement::unestablished());

        assert!(!view.established);
        assert_eq!(view.tier, None);
        assert!(view.capabilities.is_empty());

        let mislabelled = SurfaceEntitlement {
            answer: EntitlementAnswer::Unestablished,
            tier: Some("advance".to_string()),
        };
        let flattened = BillingEntitlementView::of(&mislabelled);

        assert!(!flattened.established);
        assert_eq!(flattened.tier, None, "an unverified label must not escape");
        assert!(flattened.capabilities.is_empty());
    }

    /// The two outcomes a gate conflates and a surface must not. Both grant nothing; only one is
    /// something an upgrade fixes (AD-9).
    #[test]
    fn a_verified_empty_grant_is_distinguishable_from_an_unestablished_one() {
        let free = BillingEntitlementView::of(&verified(&[], "free"));
        let unknown = BillingEntitlementView::of(&SurfaceEntitlement::unestablished());

        assert_eq!(free.capabilities, unknown.capabilities);
        assert_ne!(
            free.established, unknown.established,
            "a surface must be able to tell them apart, or it sells a plan over a bad connection"
        );
    }

    /// The command resolves the real source, so the view is not merely a projection of a fixture.
    #[tokio::test]
    async fn the_command_reads_the_entitlement_source() {
        let stated = StatedEntitlement::verified(&[MULTI_DEVICE_SYNC], Some("classic"));

        let view = get_billing_entitlement().await.expect("never fails");

        assert!(view.established);
        assert_eq!(view.tier.as_deref(), Some("classic"));
        assert_eq!(view.capabilities, vec!["multi_device_sync"]);

        stated.restate(EntitlementAnswer::Unestablished, Some("classic"));
        let view = get_billing_entitlement().await.expect("never fails");

        assert!(!view.established);
        assert_eq!(view.tier, None);
        assert!(view.capabilities.is_empty());
    }
}
