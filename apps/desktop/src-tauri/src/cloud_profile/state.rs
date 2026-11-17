//! The process-global, subject-scoped memory of what the last refresh or save observed, and the
//! status projection the Profile page reads it back through.
//!
//! The Rust-internal mirror of `ai/hosted_state.rs`: keyed on the Cognito subject, never exposed
//! over IPC, and readable only as a `CloudProfileStatus`, which carries no identity, no field value
//! and no version (AD-12). Its own module so the orchestration beside it reads as orchestration —
//! and so "what the page may know" has one definition rather than one per call site.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::profile_store::{self, CloudCopyState};

pub(crate) const READY: &str = "ready";
pub(crate) const OFFLINE_WITH_COPY: &str = "offline_with_copy";
pub(crate) const OFFLINE_NO_COPY: &str = "offline_no_copy";
pub(crate) const REAUTHENTICATION_REQUIRED: &str = "reauthentication_required";
pub(crate) const SIGNED_OUT: &str = "signed_out";

/// What the Profile page may know about the cloud lifecycle: a lifecycle state, whether AD-8's
/// prompt is owed, and whether there is a copy to render. No subject, no field value, no version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CloudProfileStatus {
    pub state: &'static str,
    pub consent_pending: bool,
    pub has_copy: bool,
}

impl CloudProfileStatus {
    /// A local profile has no cloud lifecycle at all: nothing blocks editing and nothing is owed.
    pub(crate) fn local() -> Self {
        Self {
            state: READY,
            consent_pending: false,
            has_copy: false,
        }
    }
}

/// The last outcome a refresh or save observed for one subject.
///
/// `Unknown` is the pre-first-refresh state and reads as `ready`: nothing is known to be wrong, and
/// the page issues its own refresh on open before the user can act on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Reachability {
    Unknown,
    Ready,
    Offline,
    ReauthenticationRequired,
    SignedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SubjectState {
    pub(super) reachability: Reachability,
    pub(super) consent_pending: bool,
}

impl Default for SubjectState {
    fn default() -> Self {
        Self {
            reachability: Reachability::Unknown,
            consent_pending: false,
        }
    }
}

fn states() -> &'static Mutex<HashMap<String, SubjectState>> {
    static STATES: OnceLock<Mutex<HashMap<String, SubjectState>>> = OnceLock::new();
    STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_state(sub: &str) -> SubjectState {
    states()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(sub)
        .copied()
        .unwrap_or_default()
}

pub(super) fn update_state(sub: &str, mutate: impl FnOnce(&mut SubjectState)) {
    let mut states = states()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    mutate(states.entry(sub.to_string()).or_default());
}

#[cfg(test)]
pub(crate) fn forget_state(sub: &str) {
    states()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(sub);
}

pub(super) fn reachability_for(code: &str) -> Reachability {
    match code {
        // The one refusal AD-7's "a failed refresh is silent" does not cover: a refresh grant
        // cannot add a scope, so only a fresh sign-in repairs it (adversary C1).
        "reauthentication_required" => Reachability::ReauthenticationRequired,
        "unauthorized" => Reachability::SignedOut,
        _ => Reachability::Offline,
    }
}

pub(super) fn copy_state(dir: &Path, sub: &str) -> CloudCopyState {
    profile_store::probe_cloud_copy(dir, sub).unwrap_or(CloudCopyState::Unreadable)
}

fn has_copy(state: &CloudCopyState) -> bool {
    matches!(
        state,
        CloudCopyState::Legacy | CloudCopyState::Declined | CloudCopyState::Synced(_)
    )
}

/// The lifecycle state as it stands, with no request issued.
pub(crate) fn status(dir: &Path, sub: &str) -> CloudProfileStatus {
    let state = read_state(sub);
    let copy = copy_state(dir, sub);
    let has_copy = has_copy(&copy);

    CloudProfileStatus {
        state: match state.reachability {
            Reachability::ReauthenticationRequired => REAUTHENTICATION_REQUIRED,
            Reachability::SignedOut => SIGNED_OUT,
            Reachability::Offline if has_copy => OFFLINE_WITH_COPY,
            Reachability::Offline => OFFLINE_NO_COPY,
            Reachability::Unknown | Reachability::Ready => READY,
        },
        consent_pending: state.consent_pending,
        has_copy,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SUB: &str = "cccccccc-0000-4000-8000-00000000000c";

    #[test]
    fn an_absent_copy_reads_as_ready_with_nothing_to_render() {
        let root = TempDir::new().expect("temp dir");
        forget_state(SUB);

        let status = status(&profile_store::profiles_dir(root.path()), SUB);
        assert_eq!(status.state, READY);
        assert!(!status.has_copy);
        assert!(!status.consent_pending);
    }

    #[test]
    fn a_refused_scope_is_the_one_outcome_that_is_never_silent() {
        assert_eq!(
            reachability_for("reauthentication_required"),
            Reachability::ReauthenticationRequired
        );
        assert_eq!(reachability_for("unauthorized"), Reachability::SignedOut);
        for code in ["unavailable", "rate_limited", "validation", "whatever"] {
            assert_eq!(reachability_for(code), Reachability::Offline);
        }
    }

    #[test]
    fn offline_distinguishes_a_copy_it_can_render_from_one_it_cannot() {
        assert!(has_copy(&CloudCopyState::Legacy));
        assert!(has_copy(&CloudCopyState::Declined));
        assert!(has_copy(&CloudCopyState::Synced(3)));
        assert!(!has_copy(&CloudCopyState::Absent));
        assert!(!has_copy(&CloudCopyState::Unreadable));
    }

    #[test]
    fn a_local_profile_has_no_cloud_lifecycle() {
        let status = CloudProfileStatus::local();
        assert_eq!(status.state, READY);
        assert!(!status.consent_pending);
        assert!(!status.has_copy);
    }
}
