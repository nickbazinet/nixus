use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Process-local hosted-AI status cache (AD-9 / architecture Conventions).
///
/// Deliberately has no Tauri command, no frontend hook, and no TanStack Query key:
/// v1 renders nothing from this, and exposing it would create a status surface the
/// architecture defers. It is read and invalidated only by `ai::hosted_bedrock`.
///
/// Every entry is bound to the `subject_sub` it was fetched for. A desktop process
/// can outlive a sign-out/sign-in-as-someone-else cycle, so a cache keyed only by
/// time would leak one Cognito user's quota state into another's session.

/// Refresh interval for a still-valid entry. Bounds how long a console-side premium
/// or limit change takes to be observed without any polling loop.
const CACHE_TTL: Duration = Duration::from_secs(300);

/// Client-side courtesy window after a `503`, so a disabled or globally exhausted
/// gateway is not hammered. Never a substitute for a real check: the server's
/// per-user and GLOBAL state stays authoritative once this elapses.
const UNAVAILABLE_BACKOFF: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq)]
pub struct HostedAiStatus {
    pub premium: bool,
    pub monthly_request_limit: i64,
    pub charged_count: i64,
    pub period: String,
}

impl HostedAiStatus {
    /// `charged_count` is the sole net authority server-side; this mirrors that
    /// arithmetic rather than inventing a second notion of "has quota".
    pub fn has_remaining_quota(&self) -> bool {
        self.premium && self.monthly_request_limit - self.charged_count > 0
    }
}

#[derive(Debug, Clone)]
struct CacheEntry {
    subject_sub: String,
    status: HostedAiStatus,
    fetched_at: Instant,
}

#[derive(Debug, Clone)]
struct UnavailableEntry {
    subject_sub: String,
    marked_at: Instant,
}

struct CacheState {
    entry: Option<CacheEntry>,
    unavailable: Option<UnavailableEntry>,
}

static CACHE: Mutex<CacheState> = Mutex::new(CacheState {
    entry: None,
    unavailable: None,
});

/// A poisoned lock must not break AI routing, so the guard is recovered rather
/// than propagated: the worst case is a stale entry, and every read re-checks the
/// subject and age anyway.
fn with_cache<R>(f: impl FnOnce(&mut CacheState) -> R) -> R {
    let mut guard = match CACHE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    f(&mut guard)
}

/// Cleared on sign-out, session expiry, sign-in as a different `sub`, and an
/// auth-callback subject change.
pub fn clear() {
    with_cache(|state| {
        state.entry = None;
        state.unavailable = None;
    });
}

pub fn store(subject_sub: &str, status: HostedAiStatus) {
    with_cache(|state| {
        state.entry = Some(CacheEntry {
            subject_sub: subject_sub.to_string(),
            status,
            fetched_at: Instant::now(),
        });
    });
}

/// Returns a usable entry only when it belongs to `subject_sub` and is fresh. A
/// mismatch invalidates the whole cache before returning `None`, so a stale
/// subject's status cannot survive to be consulted again.
pub fn get_fresh(subject_sub: &str) -> Option<HostedAiStatus> {
    get_fresh_at(subject_sub, Instant::now())
}

fn get_fresh_at(subject_sub: &str, now: Instant) -> Option<HostedAiStatus> {
    with_cache(|state| {
        let entry = state.entry.as_ref()?;

        if entry.subject_sub != subject_sub {
            state.entry = None;
            state.unavailable = None;
            return None;
        }

        if now.saturating_duration_since(entry.fetched_at) >= CACHE_TTL {
            state.entry = None;
            return None;
        }

        Some(entry.status.clone())
    })
}

/// Invalidated immediately on any `403`, `429`, or `503` from `/v1/ai/invoke`, so a
/// console premium/limit change or a kill-switch flip is picked up on the next call
/// instead of after the full TTL.
pub fn invalidate_status() {
    with_cache(|state| {
        state.entry = None;
    });
}

pub fn mark_unavailable(subject_sub: &str) {
    with_cache(|state| {
        state.entry = None;
        state.unavailable = Some(UnavailableEntry {
            subject_sub: subject_sub.to_string(),
            marked_at: Instant::now(),
        });
    });
}

pub fn is_unavailable(subject_sub: &str) -> bool {
    is_unavailable_at(subject_sub, Instant::now())
}

fn is_unavailable_at(subject_sub: &str, now: Instant) -> bool {
    with_cache(|state| {
        let Some(unavailable) = state.unavailable.as_ref() else {
            return false;
        };

        if unavailable.subject_sub != subject_sub {
            state.unavailable = None;
            return false;
        }

        if now.saturating_duration_since(unavailable.marked_at) >= UNAVAILABLE_BACKOFF {
            state.unavailable = None;
            return false;
        }

        true
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUB_A: &str = "1111aaaa-0000-4000-8000-000000000001";
    const SUB_B: &str = "2222bbbb-0000-4000-8000-000000000002";

    fn status(premium: bool, limit: i64, charged: i64) -> HostedAiStatus {
        HostedAiStatus {
            premium,
            monthly_request_limit: limit,
            charged_count: charged,
            period: "2026-08".to_string(),
        }
    }

    /// The cache is process-global, so every test starts from a known empty state.
    fn reset() {
        clear();
    }

    #[test]
    fn remaining_quota_mirrors_the_server_arithmetic() {
        assert!(status(true, 100, 0).has_remaining_quota());
        assert!(status(true, 100, 99).has_remaining_quota());
        assert!(!status(true, 100, 100).has_remaining_quota());
        assert!(!status(true, 100, 101).has_remaining_quota());
        assert!(!status(false, 100, 0).has_remaining_quota());
        assert!(!status(true, 0, 0).has_remaining_quota());
    }

    #[test]
    fn a_stored_entry_is_readable_by_its_own_subject() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));

        assert_eq!(get_fresh(SUB_A), Some(status(true, 50, 3)));
    }

    #[test]
    fn another_subject_never_reads_the_cached_status() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));

        assert_eq!(get_fresh(SUB_B), None, "cross-subject read must miss");
        assert_eq!(
            get_fresh(SUB_A),
            None,
            "the mismatch must also evict the original entry"
        );
    }

    #[test]
    fn a_subject_mismatch_also_drops_a_pending_unavailable_window() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 0));
        mark_unavailable(SUB_A);
        store(SUB_A, status(true, 50, 0));

        assert_eq!(get_fresh(SUB_B), None);
        assert!(!is_unavailable(SUB_A));
    }

    #[test]
    fn an_entry_older_than_the_ttl_is_dropped() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));
        let expired_at = Instant::now() + CACHE_TTL;

        assert_eq!(get_fresh_at(SUB_A, expired_at), None);
        assert_eq!(get_fresh(SUB_A), None, "the stale entry is evicted, not kept");
    }

    #[test]
    fn an_entry_just_inside_the_ttl_is_still_fresh() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));
        let almost = Instant::now() + CACHE_TTL - Duration::from_millis(1);

        assert_eq!(get_fresh_at(SUB_A, almost), Some(status(true, 50, 3)));
    }

    #[test]
    fn sign_out_style_clear_removes_everything() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));
        mark_unavailable(SUB_A);
        clear();

        assert_eq!(get_fresh(SUB_A), None);
        assert!(!is_unavailable(SUB_A));
    }

    #[test]
    fn an_error_response_invalidates_the_status_immediately() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));
        invalidate_status();

        assert_eq!(get_fresh(SUB_A), None);
    }

    #[test]
    fn the_unavailable_window_expires_after_the_backoff() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        mark_unavailable(SUB_A);
        assert!(is_unavailable(SUB_A));

        let after = Instant::now() + UNAVAILABLE_BACKOFF;
        assert!(!is_unavailable_at(SUB_A, after));
        assert!(!is_unavailable(SUB_A), "the elapsed window is evicted");
    }

    #[test]
    fn the_unavailable_window_never_applies_to_a_different_subject() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        mark_unavailable(SUB_A);

        assert!(!is_unavailable(SUB_B));
    }

    #[test]
    fn marking_unavailable_also_drops_any_cached_status() {
        let _guard = crate::credentials::test_keyring_guard();
        reset();

        store(SUB_A, status(true, 50, 3));
        mark_unavailable(SUB_A);

        assert_eq!(get_fresh(SUB_A), None);
    }

    #[test]
    fn the_backoff_window_is_the_architecture_mandated_maximum() {
        assert_eq!(UNAVAILABLE_BACKOFF, Duration::from_secs(60));
        assert_eq!(CACHE_TTL, Duration::from_secs(300));
    }
}
