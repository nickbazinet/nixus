//! AD-18's client-side cost and abuse bounds: how large an object this computer will ever
//! write, and how often it will ever ask the store for anything.
//!
//! There is no server in this design (AD-17: the stack is compute-free), so nothing on the
//! cloud side can refuse a buggy or modified client. Every bound therefore has to hold
//! here, and it has to hold at a place a caller cannot route around: the size caps and the
//! request-rate cap are both applied in `GatedStore` — the one path to the transport
//! (AD-14) — so GET, PUT, LIST, DELETE, HEAD and the existence probe all count, and the
//! producers (`segment::cut`, `snapshot::build_snapshot`, `blob::put_image_blob`) refuse or
//! split *before* an upload is even attempted so the refusal costs no request at all.
//!
//! The two kinds of bound behave differently on purpose, and AD-18 is the reason:
//!
//! - **Too large is a refusal.** It is not retryable: the same bytes will be the same size
//!   next time, so a retry is a billed request with a known answer. A segment candidate is
//!   SPLIT instead (its cut is bounded before anything is encoded); a snapshot or a blob is
//!   refused, and the local app is unaffected.
//! - **Too fast is a delay.** Data is never dropped and nothing busy-loops: the caller is
//!   put to sleep until a token is available, which is also what makes the cap safe to put
//!   in front of a write.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tokio::time::Instant;

use super::blob::BLOB_KEY_PREFIX;
use super::segment::{HEAD_KEY_PREFIX, LOG_KEY_PREFIX};
use super::snapshot::{SNAP_KEY_PREFIX, SNAP_LATEST_KEY};

/// AD-18: the largest *encoded* segment object this computer will write — the AD-8 frame
/// around `zstd(payload)`, i.e. exactly the bytes that go on the wire.
///
/// The enforced split happens earlier and on the uncompressed payload
/// (`segment::SEGMENT_MAX_PAYLOAD_BYTES`, 4 MiB), because that is the quantity the cutter can
/// bound without encoding anything. This cap is the boundary's backstop for the one case the
/// split cannot cover: `bounded_batch` always keeps at least one message, so a single message
/// larger than the split cap still produces one oversized segment. The margin between the two
/// is deliberate — a real message is a column value, and the largest BLOB column the schema
/// admits is a 64 KiB project thumbnail (`projects::image::MAX_PROJECT_THUMBNAIL_BYTES`), so
/// the gap is four orders of magnitude and the backstop is unreachable in practice.
pub const MAX_SEGMENT_OBJECT_BYTES: usize = 16 * 1024 * 1024;

/// AD-18: the largest encoded snapshot object this computer will write.
///
/// Measured margin (story 8, recorded in the Milestone 1 ledger): the heavy-year dataset —
/// 6 000 expenses, 15 000 audit rows, 5 000 chat messages, a full year of history — frames to
/// 2 131 153 B. This cap is ~31x that, so a dataset an order of magnitude heavier than the
/// CAP-2 reference still publishes, while a runaway or corrupt build cannot push an
/// arbitrarily large file into the account.
pub const MAX_SNAPSHOT_OBJECT_BYTES: usize = 64 * 1024 * 1024;

/// AD-18: the largest full project image this computer will upload as a blob (AD-10), measured
/// on the raw image bytes rather than on the framed object, because that is the number the
/// producer knows before it hashes or frames anything.
///
/// `commands/projects.rs` accepts source images up to 4 MiB, so this is 4x the largest picture
/// the app itself can produce.
pub const MAX_BLOB_BYTES: usize = 16 * 1024 * 1024;

/// AD-18: the largest mutable *pointer* this computer will write — `head/<install>`, `roster`,
/// `owner`, `snap/LATEST`. They are small hand-written JSON documents (a head is under 100
/// bytes, a roster grows by 19 bytes per computer), so a megabyte is already absurd; the point
/// is that no prefix is left uncapped.
pub const MAX_POINTER_BYTES: usize = 1024 * 1024;

/// Which AD-18 size cap a key is subject to, decided from the key's AD-6 namespace.
///
/// A match on the prefix rather than an argument the caller passes: the cap then cannot be
/// mis-stated by a caller, and a new namespace that nobody classified lands on the pointer cap
/// (the smallest one) instead of on no cap at all.
pub fn object_size_limit(key: &str) -> usize {
    if key.starts_with(LOG_KEY_PREFIX) {
        MAX_SEGMENT_OBJECT_BYTES
    } else if key.starts_with(BLOB_KEY_PREFIX) {
        MAX_BLOB_BYTES
    } else if key == SNAP_LATEST_KEY || key.starts_with(HEAD_KEY_PREFIX) {
        // `snap/LATEST` is a pointer that happens to live under the snapshot prefix, so it is
        // tested before the prefix below.
        MAX_POINTER_BYTES
    } else if key.starts_with(SNAP_KEY_PREFIX) {
        MAX_SNAPSHOT_OBJECT_BYTES
    } else {
        MAX_POINTER_BYTES
    }
}

/// AD-18's maximum object rate, as a token bucket.
///
/// Two numbers and not one because the two things being bounded differ: `burst` is how many
/// requests a legitimate burst (enabling sync, bootstrapping a new computer, a retention sweep)
/// may make back-to-back, and `per_minute` is the sustained ceiling a loop cannot exceed no
/// matter how it is driven.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RequestRateCap {
    pub burst: u32,
    pub per_minute: u32,
}

impl Default for RequestRateCap {
    /// Generous against the measured steady state and still a hard ceiling.
    ///
    /// Steady state (story 19, asserted) is `1 + <known computers>` conditional GETs per
    /// `remote_poll_interval` of 30 s — about 4/minute for a two-computer account. Enabling sync
    /// or bootstrapping is a few dozen requests in one go, and a retention sweep is a listing plus
    /// one delete per reclaimable object. 600/minute is therefore ~100x the steady state and
    /// cannot be reached by correct behaviour, while a runaway loop is bounded at 10 requests a
    /// second instead of as many as the network allows.
    fn default() -> Self {
        Self {
            burst: 120,
            per_minute: 600,
        }
    }
}

impl RequestRateCap {
    /// How long one token takes to refill. Computed from `per_minute` so there is one number to
    /// state rather than a rate and a period that can disagree.
    fn refill_interval(&self) -> Duration {
        // A zero rate would mean "never refill", which would wedge sync rather than bound it, so
        // the floor is one request per minute.
        Duration::from_nanos(60_000_000_000 / u64::from(self.per_minute.max(1)))
    }

    fn capacity(&self) -> u64 {
        u64::from(self.burst.max(1))
    }
}

/// The bucket's mutable half. Behind a `std::sync::Mutex` and never held across an `await`:
/// the decision (how long to sleep) is taken under the lock, the sleep happens outside it.
#[derive(Debug)]
struct Bucket {
    cap: RequestRateCap,
    /// Available tokens, in whole requests.
    tokens: u64,
    /// When the bucket was last refilled, on the Tokio clock — so a test can prove the delay with
    /// `#[tokio::test(start_paused = true)]` instead of sleeping in real time.
    refilled_at: Instant,
}

impl Bucket {
    /// Takes one token, answering how long the caller must wait before it is really theirs.
    fn take(&mut self, now: Instant) -> Duration {
        let interval = self.cap.refill_interval();
        let elapsed = now.saturating_duration_since(self.refilled_at);
        let refilled = u64::try_from(elapsed.as_nanos() / interval.as_nanos().max(1))
            .unwrap_or(u64::MAX)
            .min(self.cap.capacity());
        if refilled > 0 {
            self.tokens = (self.tokens + refilled).min(self.cap.capacity());
            self.refilled_at = now;
        }

        if self.tokens > 0 {
            self.tokens -= 1;
            return Duration::ZERO;
        }

        // The bucket is empty: the caller owes the time one token takes to refill, and the clock
        // is moved forward so concurrent callers queue rather than all wait the same interval.
        self.refilled_at = self
            .refilled_at
            .checked_add(interval)
            .unwrap_or(self.refilled_at);

        self.refilled_at.saturating_duration_since(now)
    }
}

/// Everything AD-18 bounds for ONE dataset, shared by every `GatedStore` that dataset's host
/// hands out.
///
/// Per dataset and not per session: `SyncHost::connect` rebuilds the store from a fresh vend on
/// every cycle, so a cap living in the store would reset itself every 30 seconds and bound
/// nothing. Shared behind an `Arc` for the same reason.
#[derive(Debug)]
pub struct DatasetLimits {
    bucket: Mutex<Bucket>,
    /// How many times a request was delayed by the rate cap (AD-16: a count, never a value).
    delays: AtomicU64,
    /// How many writes were refused for size (same).
    oversize_refusals: AtomicU64,
}

impl Default for DatasetLimits {
    fn default() -> Self {
        Self::new(RequestRateCap::default())
    }
}

impl DatasetLimits {
    pub fn new(cap: RequestRateCap) -> Self {
        Self {
            bucket: Mutex::new(Bucket {
                cap,
                // Starts full: the first thing a freshly enabled computer does is a burst, and
                // making it wait for a bucket to fill would delay the one case the user watches.
                tokens: cap.capacity(),
                refilled_at: Instant::now(),
            }),
            delays: AtomicU64::new(0),
            oversize_refusals: AtomicU64::new(0),
        }
    }

    /// Re-states the cap from `SyncTuning`, keeping whatever tokens are left.
    ///
    /// Exists so the actor's tuning is the single place the rate is stated (and so a test can
    /// make the cap small enough to hit); the host owns the limiter because it owns the store.
    pub fn reconfigure(&self, cap: RequestRateCap) {
        if let Ok(mut bucket) = self.bucket.lock() {
            bucket.tokens = bucket.tokens.min(cap.capacity());
            bucket.cap = cap;
        }
    }

    /// Waits until this request is within AD-18's rate, then lets it through.
    ///
    /// Never refuses and never spins: a rate cap that dropped a request would lose data, and one
    /// that polled would cost the very thing it is bounding.
    pub async fn acquire(&self) {
        let wait = match self.bucket.lock() {
            Ok(mut bucket) => bucket.take(Instant::now()),
            // A poisoned lock means another thread panicked while holding it. Letting the request
            // through is the safe failure: the cap is a cost control, not a correctness one, and
            // refusing would stop replication.
            Err(_) => Duration::ZERO,
        };

        if !wait.is_zero() {
            self.delays.fetch_add(1, Ordering::Relaxed);
            tokio::time::sleep(wait).await;
        }
    }

    /// Whether `len` bytes may be written to `key` (AD-18). Counted when it refuses, so
    /// diagnostics can show that a cap was hit without showing anything about the data.
    pub fn check_object_size(&self, key: &str, len: usize) -> Result<(), Oversize> {
        let limit = object_size_limit(key);
        if len > limit {
            self.oversize_refusals.fetch_add(1, Ordering::Relaxed);

            return Err(Oversize { limit, found: len });
        }

        Ok(())
    }

    pub fn delays(&self) -> u64 {
        self.delays.load(Ordering::Relaxed)
    }

    pub fn oversize_refusals(&self) -> u64 {
        self.oversize_refusals.load(Ordering::Relaxed)
    }

    /// Counts an oversize refusal a PRODUCER made before any key existed to check it against
    /// (a snapshot or a blob is refused at build time, which is the whole point: the refusal
    /// costs no request). Keeps one counter for the two places the cap is applied.
    pub fn note_oversize(&self) {
        self.oversize_refusals.fetch_add(1, Ordering::Relaxed);
    }
}

/// A refused write: how big it was and what the cap is. Numbers only — AD-16 keeps values out
/// of anything that reaches a log line or diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Oversize {
    pub limit: usize,
    pub found: usize,
}

impl std::fmt::Display for Oversize {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} bytes exceeds the {} byte limit for this object",
            self.found, self.limit
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_ad6_namespace_has_a_cap_and_the_pointer_cap_is_the_fallback() {
        assert_eq!(
            object_size_limit("log/0a1b2c3d4e5f6071/0000000000000003"),
            MAX_SEGMENT_OBJECT_BYTES
        );
        assert_eq!(
            object_size_limit("snap/".to_string().as_str()),
            MAX_SNAPSHOT_OBJECT_BYTES
        );
        assert_eq!(object_size_limit(&format!("{BLOB_KEY_PREFIX}abc")), MAX_BLOB_BYTES);
        // The three pointers, including the one that lives under the snapshot prefix.
        assert_eq!(object_size_limit(SNAP_LATEST_KEY), MAX_POINTER_BYTES);
        assert_eq!(object_size_limit("head/0a1b2c3d4e5f6071"), MAX_POINTER_BYTES);
        assert_eq!(object_size_limit("roster"), MAX_POINTER_BYTES);
        assert_eq!(object_size_limit("owner"), MAX_POINTER_BYTES);
        // An unclassified namespace lands on the smallest cap, never on none.
        assert_eq!(object_size_limit("something/new"), MAX_POINTER_BYTES);
    }

    #[test]
    fn a_write_at_the_cap_passes_and_one_byte_over_is_refused_and_counted() {
        let limits = DatasetLimits::default();
        let key = "log/0a1b2c3d4e5f6071/0000000000000000";

        assert!(limits.check_object_size(key, MAX_SEGMENT_OBJECT_BYTES).is_ok());
        assert_eq!(limits.oversize_refusals(), 0);

        assert_eq!(
            limits.check_object_size(key, MAX_SEGMENT_OBJECT_BYTES + 1),
            Err(Oversize {
                limit: MAX_SEGMENT_OBJECT_BYTES,
                found: MAX_SEGMENT_OBJECT_BYTES + 1,
            })
        );
        assert_eq!(limits.oversize_refusals(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn the_burst_passes_untouched_and_the_next_request_waits_for_a_token() {
        let limits = DatasetLimits::new(RequestRateCap {
            burst: 3,
            per_minute: 60,
        });

        let start = Instant::now();
        for _ in 0..3 {
            limits.acquire().await;
        }
        assert_eq!(limits.delays(), 0, "a burst inside the cap is never delayed");
        assert_eq!(Instant::now(), start, "and costs no time");

        limits.acquire().await;
        assert_eq!(limits.delays(), 1);
        assert_eq!(
            Instant::now().saturating_duration_since(start),
            Duration::from_secs(1),
            "one token per second at 60/minute"
        );

        // And it recovers: waiting out two intervals refills two tokens, which then pass freely.
        tokio::time::sleep(Duration::from_secs(2)).await;
        limits.acquire().await;
        limits.acquire().await;
        assert_eq!(limits.delays(), 1, "a refilled bucket delays nothing further");
    }

    #[tokio::test(start_paused = true)]
    async fn requests_past_the_cap_queue_instead_of_all_waiting_the_same_interval() {
        let limits = DatasetLimits::new(RequestRateCap {
            burst: 1,
            per_minute: 60,
        });
        let start = Instant::now();

        limits.acquire().await; // the one burst token
        limits.acquire().await;
        limits.acquire().await;

        assert_eq!(limits.delays(), 2);
        assert_eq!(
            Instant::now().saturating_duration_since(start),
            Duration::from_secs(2),
            "two delayed requests cost two intervals, not one"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn tuning_can_tighten_the_cap_without_handing_out_tokens_it_no_longer_allows() {
        let limits = DatasetLimits::new(RequestRateCap {
            burst: 100,
            per_minute: 600,
        });
        limits.reconfigure(RequestRateCap {
            burst: 1,
            per_minute: 60,
        });

        limits.acquire().await;
        assert_eq!(limits.delays(), 0);
        limits.acquire().await;
        assert_eq!(
            limits.delays(),
            1,
            "the 100 tokens the old cap allowed must not survive the new one"
        );
    }
}
