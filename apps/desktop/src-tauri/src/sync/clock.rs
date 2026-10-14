//! Hybrid logical clock and the install id (AD-4).
//!
//! Story 6 landed the install id and the machine fingerprint that decides when it has to
//! be re-minted. Story 13 adds the clock itself: [`Hlc`], the value every message carries,
//! and [`Clock`], the per-install generator wrapped around `uhlc` 0.9.0.
//!
//! The fingerprint takes its signals as a value rather than reading the environment
//! itself, and the clock's wall clock is injectable, so both the regeneration rule and the
//! drift limit are testable without a second machine or a second real clock — the only way
//! either could otherwise be exercised.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use uhlc::{HLCBuilder, Timestamp, HLC, ID, NTP64};

/// 8 random bytes as lowercase hex (AD-4), so the id is usable verbatim as an object-key
/// segment (`log/<install>/<seq>`) with no escaping anywhere.
pub const INSTALL_ID_LEN: usize = 16;

/// Drawn with `rand::random`, the same way `datasets::new_dataset_id` and
/// `commands/auth.rs`'s PKCE verifier draw theirs: 64 bits is far beyond the collision
/// budget of one person's handful of computers, and AD-6's create-only put turns the
/// residual collision into a detected `ContentHashMismatch` rather than a silent merge.
pub fn new_install_id() -> String {
    let bytes = rand::random::<[u8; 8]>();

    let mut id = String::with_capacity(INSTALL_ID_LEN);
    for byte in bytes {
        id.push_str(&format!("{byte:02x}"));
    }

    id
}

/// What the fingerprint is derived from. Every field is a value the OS already put in the
/// process environment, so computing one costs no process spawn, no filesystem read and
/// no new dependency — and nothing here is a hardware identifier, which the stored digest
/// is forbidden from carrying in a reversible form anyway.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MachineSignals {
    pub host: Option<String>,
    pub user: Option<String>,
    pub platform: &'static str,
}

/// The first of `names` that is set to a non-empty value.
///
/// Which variable carries the host name is platform-dependent and, on a GUI launch, not
/// guaranteed to be set at all: Windows always exports `COMPUTERNAME`, a shell exports
/// `HOSTNAME` or `HOST`, and a macOS app launched from Finder exports neither. Probing a
/// list rather than branching on `target_os` is what keeps one code path on all three
/// platforms, including the one that cannot be tested locally.
fn first_set(names: &[&str]) -> Option<String> {
    names
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .find(|value| !value.trim().is_empty())
}

impl MachineSignals {
    pub fn from_environment() -> Self {
        Self {
            host: first_set(&["COMPUTERNAME", "HOSTNAME", "HOST"]),
            user: first_set(&["USERNAME", "USER", "LOGNAME"]),
            platform: std::env::consts::OS,
        }
    }
}

/// The 8 bytes behind an install id, parsed out of its 16-character hex form.
///
/// A fixed-width array rather than the string, because it is both the tiebreak key of
/// [`Hlc`] (where a byte comparison is the ordering) and the `uhlc::ID` the clock is built
/// with — and because a value that cannot hold a malformed id is one fewer thing every
/// later story has to validate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
// Story 15 is the first production caller: it stamps captured changes with the clock.
#[allow(dead_code)]
pub struct InstallBytes([u8; 8]);

impl InstallBytes {
    pub fn parse(install_id: &str) -> Result<Self, ClockError> {
        if install_id.len() != INSTALL_ID_LEN {
            return Err(ClockError::MalformedInstallId);
        }

        let mut bytes = [0u8; 8];
        for (byte, pair) in bytes.iter_mut().zip(install_id.as_bytes().chunks(2)) {
            let pair = std::str::from_utf8(pair).map_err(|_| ClockError::MalformedInstallId)?;
            if pair.chars().any(|c| !c.is_ascii_hexdigit() || c.is_ascii_uppercase()) {
                return Err(ClockError::MalformedInstallId);
            }
            *byte = u8::from_str_radix(pair, 16).map_err(|_| ClockError::MalformedInstallId)?;
        }

        Ok(Self(bytes))
    }

    pub fn hex(&self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// `uhlc` needs *an* identifier that is unique in the system; which byte order it reads
    /// is irrelevant here because [`Hlc`]'s tiebreak is written out in this module and never
    /// delegates to `uhlc::ID`'s own (little-endian) ordering.
    fn uhlc_id(&self) -> Result<ID, ClockError> {
        ID::try_from(&self.0[..]).map_err(|_| ClockError::MalformedInstallId)
    }
}

/// What can go wrong in this module. Narrow on purpose: the drift refusal is the one
/// runtime fault, and AD-4 names the code it surfaces as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Story 15 is the first production caller.
#[allow(dead_code)]
pub enum ClockError {
    /// A remote timestamp more than [`MAX_FORWARD_DRIFT`] ahead of local wall time. The
    /// local clock is left untouched: adopting it is exactly what AD-4 forbids.
    Skew { ahead_ms: i64 },
    MalformedInstallId,
    MalformedTimestamp,
}

// Story 24 is the first production caller: it maps this onto the `clock_skew` sync state.
#[allow(dead_code)]
impl ClockError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Skew { .. } => "clock_skew",
            Self::MalformedInstallId => "install_malformed",
            Self::MalformedTimestamp => "hlc_malformed",
        }
    }
}

impl std::fmt::Display for ClockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Skew { ahead_ms } => write!(
                f,
                "a remote timestamp {ahead_ms} ms ahead of this computer exceeds the {} ms limit",
                MAX_FORWARD_DRIFT.as_millis()
            ),
            Self::MalformedInstallId => write!(f, "an install id is not 16 lowercase hex characters"),
            Self::MalformedTimestamp => write!(f, "an encoded hybrid logical clock is malformed"),
        }
    }
}

impl std::error::Error for ClockError {}

/// AD-4's bound. A remote timestamp further ahead than this is refused rather than adopted,
/// so one computer with a wrong clock cannot win every conflict for the next however long.
pub const MAX_FORWARD_DRIFT: Duration = Duration::from_secs(300);

/// The width of [`Hlc::encode`]: 16 hex digits of NTP64 time, a separator, 16 of install id.
pub const HLC_ENCODED_LEN: usize = 33;

const HLC_SEPARATOR: char = '-';

/// One point on the hybrid logical clock: `uhlc`'s 64-bit NTP time plus the install that
/// produced it (AD-4).
///
/// The NTP64 word already packs physical time in its high bits and the logical counter in
/// its low bits, so comparing it as one unsigned integer *is* "physical, then logical".
/// The install id is the final tiebreak, which makes the order total across the whole
/// system: no two messages anywhere can compare equal unless they are the same message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
// Story 15 is the first production caller.
#[allow(dead_code)]
pub struct Hlc {
    time: u64,
    install: InstallBytes,
}

/// Written out rather than derived, because the field order of the struct is not what makes
/// the tiebreak correct — the decision that *time* dominates and the install id only breaks
/// exact ties is, and a later field reorder must not be able to change it silently.
impl Ord for Hlc {
    fn cmp(&self, other: &Self) -> Ordering {
        self.time
            .cmp(&other.time)
            .then_with(|| self.install.0.cmp(&other.install.0))
    }
}

impl PartialOrd for Hlc {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[allow(dead_code)]
impl Hlc {
    /// The raw NTP64 word: physical time in the high bits, logical counter in the low bits.
    pub fn ntp_time(&self) -> u64 {
        self.time
    }

    /// Milliseconds since the Unix epoch, for diagnostics and the drift comparison. Lossy by
    /// construction (NTP64's fraction is finer than a millisecond), which is why it is not
    /// what the ordering uses.
    pub fn wall_ms(&self) -> i64 {
        NTP64(self.time).to_duration().as_millis() as i64
    }

    pub fn install(&self) -> InstallBytes {
        self.install
    }

    /// A fixed-width, lowercase-hex form whose ASCII order is the [`Ord`] above.
    ///
    /// Fixed width is the whole point: every field is zero-padded to its full length and the
    /// separator sits at a constant offset, so a plain `ORDER BY` or a `BTreeMap` over the
    /// text sorts messages exactly as the clock does, with no decoding and no collation
    /// surprises. Frozen by `the_encoding_is_frozen`.
    pub fn encode(&self) -> String {
        format!("{:016x}{HLC_SEPARATOR}{}", self.time, self.install.hex())
    }

    pub fn decode(encoded: &str) -> Result<Self, ClockError> {
        // `is_ascii` before any slicing, not only the byte length: the input is untrusted
        // (Stories 14/19/20 decode it out of the dataset and off the wire), and a 33-BYTE
        // string whose multi-byte character straddles byte 16 would make `split_at` panic
        // on a character boundary instead of reporting a malformed timestamp.
        if encoded.len() != HLC_ENCODED_LEN || !encoded.is_ascii() {
            return Err(ClockError::MalformedTimestamp);
        }
        let (time, rest) = encoded.split_at(16);
        let install = rest
            .strip_prefix(HLC_SEPARATOR)
            .ok_or(ClockError::MalformedTimestamp)?;
        if time.chars().any(|c| !c.is_ascii_hexdigit() || c.is_ascii_uppercase()) {
            return Err(ClockError::MalformedTimestamp);
        }

        Ok(Self {
            time: u64::from_str_radix(time, 16).map_err(|_| ClockError::MalformedTimestamp)?,
            install: InstallBytes::parse(install).map_err(|_| ClockError::MalformedTimestamp)?,
        })
    }

    fn timestamp(&self) -> Result<Timestamp, ClockError> {
        Ok(Timestamp::new(NTP64(self.time), self.install.uhlc_id()?))
    }
}

/// Milliseconds since the Unix epoch. A value, not a `SystemTime`, so a test can hand the
/// clock an arithmetic sequence and assert on exact drift amounts.
pub type WallClock = Arc<dyn Fn() -> i64 + Send + Sync>;

// `uhlc::HLCBuilder::with_clock` takes a bare `fn() -> NTP64`, not a closure, so a
// per-instance wall clock cannot be handed to it directly. This thread-local is the
// indirection: `Clock` installs its own wall clock for the duration of each call it makes
// into `uhlc`, which is what lets several replicas with several clocks coexist on one
// thread. Production installs the system clock through the same path, so there is exactly
// one code path rather than a test-only branch.
thread_local! {
    static SCOPED_WALL_CLOCK: RefCell<Option<WallClock>> = const { RefCell::new(None) };
}

fn scoped_wall_clock() -> NTP64 {
    let installed = SCOPED_WALL_CLOCK.with(|slot| slot.borrow().clone());
    match installed {
        Some(wall) => NTP64::from(Duration::from_millis(wall().max(0) as u64)),
        None => uhlc::system_time_clock(),
    }
}

/// Restores the previous wall clock even if the body panics, so one failing assertion in a
/// test cannot leave a foreign clock installed for every later test on that thread.
struct WallClockGuard(Option<WallClock>);

impl Drop for WallClockGuard {
    fn drop(&mut self) {
        let previous = self.0.take();
        SCOPED_WALL_CLOCK.with(|slot| *slot.borrow_mut() = previous);
    }
}

pub fn system_wall_clock() -> WallClock {
    Arc::new(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_millis() as i64)
            .unwrap_or_default()
    })
}

/// One HLC per install (AD-4), with the 5-minute maximum delta configured.
// Story 15 is the first production caller: the capture hook stamps every change with it.
#[allow(dead_code)]
pub struct Clock {
    hlc: HLC,
    install: InstallBytes,
    wall: WallClock,
}

#[allow(dead_code)]
impl Clock {
    pub fn new(install_id: &str) -> Result<Self, ClockError> {
        Self::with_wall_clock(install_id, system_wall_clock())
    }

    pub fn with_wall_clock(install_id: &str, wall: WallClock) -> Result<Self, ClockError> {
        let install = InstallBytes::parse(install_id)?;

        Ok(Self {
            hlc: HLCBuilder::new()
                .with_id(install.uhlc_id()?)
                .with_clock(scoped_wall_clock)
                .with_max_delta(MAX_FORWARD_DRIFT)
                .build(),
            install,
            wall,
        })
    }

    pub fn install(&self) -> InstallBytes {
        self.install
    }

    /// Strictly greater than every timestamp this clock has produced and than every remote
    /// timestamp it has accepted, which is what makes a local write always win against the
    /// past it was based on.
    pub fn now(&self) -> Hlc {
        let _guard = self.install_wall_clock();
        let stamped = self.hlc.new_timestamp();

        Hlc {
            time: stamped.get_time().as_u64(),
            install: self.install,
        }
    }

    /// Fold a remote timestamp in, or refuse it.
    ///
    /// The drift is measured against *this* clock's wall time before `uhlc` is asked to
    /// update, so the refusal carries how far ahead the remote was (AD-16 wants a number,
    /// not a string) and so the limit is this module's, not the `UHLC_MAX_DELTA_MS`
    /// environment variable's. `uhlc`'s own check is still called and still honoured: it is
    /// the thing that guarantees the clock is not advanced when the answer is `Err`.
    pub fn observe(&self, remote: &Hlc) -> Result<(), ClockError> {
        let ahead_ms = remote.wall_ms() - (self.wall)();
        if ahead_ms > MAX_FORWARD_DRIFT.as_millis() as i64 {
            return Err(ClockError::Skew { ahead_ms });
        }

        let stamped = remote.timestamp()?;
        let _guard = self.install_wall_clock();
        self.hlc
            .update_with_timestamp(&stamped)
            .map_err(|_| ClockError::Skew { ahead_ms })
    }

    fn install_wall_clock(&self) -> WallClockGuard {
        let previous =
            SCOPED_WALL_CLOCK.with(|slot| slot.replace(Some(Arc::clone(&self.wall))));

        WallClockGuard(previous)
    }
}

/// Domain separation, so this digest cannot be compared against any other sha256 of the
/// same strings produced elsewhere in the app or by a third party.
const FINGERPRINT_DOMAIN: &str = "nixus/sync/machine-fingerprint/v1";

/// A one-way, 64-character lowercase-hex digest of `signals`.
///
/// The length-prefixed framing is what makes the digest injective over the signal tuple:
/// plain concatenation would let `host = "ab", user = "c"` and `host = "a", user = "bc"`
/// collide, and a collision here is a *missed* relink.
///
/// Absent signals hash deterministically rather than failing, which is deliberate: on a
/// platform where nothing identifying is exported, every install on every machine shares
/// one fingerprint, so a copied database is not detected and the install id is kept. That
/// is the safe direction — a spurious re-mint would relink a dataset that never moved —
/// and Story 9's explicit replace/separate choice is the backstop for the copy case.
pub fn machine_fingerprint(signals: &MachineSignals) -> String {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_DOMAIN.as_bytes());

    for field in [
        signals.host.as_deref().unwrap_or_default(),
        signals.user.as_deref().unwrap_or_default(),
        signals.platform,
    ] {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field.as_bytes());
    }

    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::atomic::AtomicI64;
    use std::sync::atomic::Ordering::SeqCst;

    fn signals(host: Option<&str>, user: Option<&str>, platform: &'static str) -> MachineSignals {
        MachineSignals {
            host: host.map(str::to_string),
            user: user.map(str::to_string),
            platform,
        }
    }

    #[test]
    fn an_install_id_is_sixteen_lowercase_hex_characters() {
        let id = new_install_id();

        assert_eq!(id.len(), INSTALL_ID_LEN);
        assert!(
            id.chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "unexpected characters in {id}"
        );
    }

    #[test]
    fn install_ids_are_not_a_constant() {
        let minted: HashSet<String> = (0..64).map(|_| new_install_id()).collect();

        assert!(
            minted.len() > 60,
            "only {} distinct ids out of 64; the source is not random",
            minted.len()
        );
    }

    #[test]
    fn a_fingerprint_is_a_sha256_hex_digest() {
        let digest = machine_fingerprint(&signals(Some("mac"), Some("nick"), "macos"));

        assert_eq!(digest.len(), 64);
        assert!(digest
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
    }

    #[test]
    fn the_same_machine_always_produces_the_same_fingerprint() {
        let once = machine_fingerprint(&signals(Some("mac"), Some("nick"), "macos"));
        let twice = machine_fingerprint(&signals(Some("mac"), Some("nick"), "macos"));

        assert_eq!(once, twice);
    }

    #[test]
    fn every_signal_changes_the_fingerprint() {
        let base = machine_fingerprint(&signals(Some("mac"), Some("nick"), "macos"));

        for other in [
            signals(Some("pc"), Some("nick"), "macos"),
            signals(Some("mac"), Some("other"), "macos"),
            signals(Some("mac"), Some("nick"), "windows"),
            signals(None, Some("nick"), "macos"),
            signals(Some("mac"), None, "macos"),
        ] {
            assert_ne!(
                base,
                machine_fingerprint(&other),
                "{other:?} must not share the base fingerprint"
            );
        }
    }

    /// The framing, not the hash: an un-prefixed concatenation makes these two equal, and
    /// an equal fingerprint across two machines is a copied database that never relinks.
    #[test]
    fn signals_cannot_be_shifted_across_field_boundaries() {
        assert_ne!(
            machine_fingerprint(&signals(Some("ab"), Some("c"), "macos")),
            machine_fingerprint(&signals(Some("a"), Some("bc"), "macos"))
        );
    }

    #[test]
    fn a_fingerprint_never_contains_the_signals_it_was_built_from() {
        let digest = machine_fingerprint(&signals(Some("workstation"), Some("nick"), "macos"));

        for secret in ["workstation", "nick"] {
            assert!(
                !digest.contains(secret),
                "{secret} survived into the stored fingerprint"
            );
        }
    }

    #[test]
    fn absent_signals_still_produce_a_storable_digest() {
        let digest = machine_fingerprint(&MachineSignals {
            platform: "macos",
            ..MachineSignals::default()
        });

        assert_eq!(digest.len(), 64);
    }

    #[test]
    fn the_environment_reader_reports_this_platform() {
        assert_eq!(
            MachineSignals::from_environment().platform,
            std::env::consts::OS
        );
    }

    const A: &str = "0a1b2c3d4e5f6071";
    const B: &str = "ff00000000000000";

    fn fixed_clock(install: &str, ms: i64) -> Clock {
        Clock::with_wall_clock(install, Arc::new(move || ms)).expect("the install id parses")
    }

    fn moving_clock(install: &str, start_ms: i64) -> (Clock, Arc<AtomicI64>) {
        let now = Arc::new(AtomicI64::new(start_ms));
        let reader = Arc::clone(&now);
        let clock = Clock::with_wall_clock(install, Arc::new(move || reader.load(SeqCst)))
            .expect("the install id parses");

        (clock, now)
    }

    #[test]
    fn an_install_id_round_trips_through_its_bytes() {
        assert_eq!(InstallBytes::parse(A).expect("A parses").hex(), A);
    }

    #[test]
    fn a_malformed_install_id_is_refused_rather_than_truncated() {
        for bad in ["", "0a1b", "0A1B2C3D4E5F6071", "0a1b2c3d4e5f607z", "0a1b2c3d4e5f60711"] {
            assert_eq!(
                InstallBytes::parse(bad),
                Err(ClockError::MalformedInstallId),
                "{bad} must not parse"
            );
        }
    }

    #[test]
    fn timestamps_from_one_clock_strictly_increase_even_within_a_millisecond() {
        let clock = fixed_clock(A, 1_700_000_000_000);

        let stamps: Vec<Hlc> = (0..256).map(|_| clock.now()).collect();
        for pair in stamps.windows(2) {
            assert!(pair[1] > pair[0], "{:?} must follow {:?}", pair[1], pair[0]);
        }
    }

    #[test]
    fn a_wall_clock_that_moves_backwards_cannot_move_the_hlc_backwards() {
        let (clock, now) = moving_clock(A, 1_700_000_000_000);

        let before = clock.now();
        now.store(1_600_000_000_000, SeqCst);
        let after = clock.now();

        assert!(after > before, "{after:?} must still follow {before:?}");
    }

    #[test]
    fn two_installs_stamping_the_same_millisecond_are_ordered_by_install_id() {
        let earlier = fixed_clock(A, 1_700_000_000_000);
        let later = fixed_clock(B, 1_700_000_000_000);

        let from_a = earlier.now();
        let from_b = later.now();

        assert_eq!(from_a.ntp_time(), from_b.ntp_time(), "the same physical instant");
        assert!(from_b > from_a, "ff... must win the tie against 0a...");
        assert_ne!(from_a, from_b);
    }

    #[test]
    fn observing_a_remote_timestamp_makes_the_next_local_stamp_follow_it() {
        let remote = fixed_clock(B, 1_700_000_060_000);
        let local = fixed_clock(A, 1_700_000_000_000);

        let remote_stamp = remote.now();
        local.observe(&remote_stamp).expect("one minute ahead is inside the limit");

        assert!(local.now() > remote_stamp);
    }

    #[test]
    fn a_remote_timestamp_beyond_the_drift_limit_is_refused_and_never_adopted() {
        let local = fixed_clock(A, 1_700_000_000_000);
        let ours_before = local.now();

        let skewed = fixed_clock(B, 1_700_000_000_000 + MAX_FORWARD_DRIFT.as_millis() as i64 + 60_000);
        let their_stamp = skewed.now();

        let refused = local.observe(&their_stamp).expect_err("beyond the limit");
        assert_eq!(refused.code(), "clock_skew");
        assert!(
            matches!(refused, ClockError::Skew { ahead_ms } if ahead_ms >= MAX_FORWARD_DRIFT.as_millis() as i64),
            "{refused:?} must carry how far ahead the remote was"
        );

        let ours_after = local.now();
        assert!(
            ours_after.wall_ms() <= ours_before.wall_ms() + 1,
            "the local clock adopted the skewed time: {ours_after:?}"
        );
        assert!(ours_after < their_stamp, "the refused stamp must still be ahead of us");
    }

    /// A second inside the limit rather than exactly on it: `NTP64` is not millisecond
    /// quantised, so the boundary millisecond itself is ambiguous by design and asserting on
    /// it would pin a rounding artefact instead of the rule.
    #[test]
    fn a_remote_timestamp_just_inside_the_drift_limit_is_still_accepted() {
        let local = fixed_clock(A, 1_700_000_000_000);
        let edge = fixed_clock(B, 1_700_000_000_000 + MAX_FORWARD_DRIFT.as_millis() as i64 - 1_000);

        assert!(local.observe(&edge.now()).is_ok());
    }

    #[test]
    fn a_remote_timestamp_from_the_past_is_accepted_and_changes_nothing() {
        let local = fixed_clock(A, 1_700_000_000_000);
        let ours = local.now();
        let ancient = fixed_clock(B, 1_600_000_000_000);

        local.observe(&ancient.now()).expect("the past is never a drift fault");

        assert!(local.now() > ours);
    }

    /// The format is a persistence contract: Story 14 stores it, so changing the width, the
    /// padding, the case or the separator is a migration, not a refactor.
    #[test]
    fn the_encoding_is_frozen() {
        let hlc = Hlc {
            time: 0x1234_5678_9abc_def0,
            install: InstallBytes::parse(A).expect("A parses"),
        };

        assert_eq!(hlc.encode(), "123456789abcdef0-0a1b2c3d4e5f6071");
        assert_eq!(hlc.encode().len(), HLC_ENCODED_LEN);
        assert_eq!(Hlc::decode(&hlc.encode()).expect("it round trips"), hlc);
    }

    #[test]
    fn the_encoding_sorts_exactly_like_the_clock() {
        let clocks = [fixed_clock(A, 1_700_000_000_000), fixed_clock(B, 1_700_000_000_000)];
        let mut stamps: Vec<Hlc> = (0..200)
            .map(|index| clocks[index % clocks.len()].now())
            .collect();
        stamps.sort();

        let mut encoded: Vec<String> = stamps.iter().map(Hlc::encode).collect();
        let as_sorted_text = {
            let mut text = encoded.clone();
            text.sort();
            text
        };
        encoded.dedup();

        assert_eq!(encoded.len(), 200, "every stamp must be distinct");
        assert_eq!(
            as_sorted_text,
            stamps.iter().map(Hlc::encode).collect::<Vec<_>>(),
            "sorting the text must reproduce the clock order"
        );
    }

    #[test]
    fn a_malformed_encoding_is_refused() {
        for bad in [
            "",
            "123456789abcdef0:0a1b2c3d4e5f6071",
            "123456789abcdef0-0a1b2c3d4e5f607",
            "123456789abcdeg0-0a1b2c3d4e5f6071",
            "123456789abcdef0-0A1B2C3D4E5F6071",
        ] {
            assert_eq!(
                Hlc::decode(bad),
                Err(ClockError::MalformedTimestamp),
                "{bad} must not decode"
            );
        }
    }

    /// Both of these are exactly 33 BYTES, which is all a length check can see, and both put
    /// a multi-byte character where slicing happens — the first straddles the offset the time
    /// field is split at. A byte-length guard alone lets them through and panics on a
    /// character boundary, and this input arrives from the dataset and off the wire.
    #[test]
    fn a_multibyte_encoding_of_the_right_byte_length_is_refused_not_panicked_on() {
        for bad in [
            "123456789abcdef\u{00e9}0a1b2c3d4e5f6071",
            "123456789abcdef0-0a1b2c3\u{1f600}f6071",
        ] {
            assert_eq!(bad.len(), HLC_ENCODED_LEN, "{bad} must be 33 bytes to be the case");
            assert!(!bad.is_char_boundary(16) || !bad.is_ascii());
            assert_eq!(
                Hlc::decode(bad),
                Err(ClockError::MalformedTimestamp),
                "{bad} must not decode"
            );
        }
    }

    /// Two clocks on one thread with two different injected wall clocks: the thread-local
    /// indirection would show up here as one of them reading the other's time.
    #[test]
    fn clocks_on_one_thread_do_not_share_their_wall_clock() {
        let early = fixed_clock(A, 1_700_000_000_000);
        let late = fixed_clock(B, 1_700_000_200_000);

        let from_early = early.now();
        let from_late = late.now();

        assert_eq!(from_early.wall_ms(), 1_700_000_000_000);
        assert_eq!(from_late.wall_ms(), 1_700_000_200_000);
        assert_eq!(early.now().wall_ms(), 1_700_000_000_000);
    }

    #[test]
    fn a_clock_with_no_injected_wall_clock_reads_the_system_clock() {
        let clock = Clock::new(A).expect("the install id parses");
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the epoch is in the past")
            .as_millis() as i64;

        let stamped = clock.now();

        assert!(
            (stamped.wall_ms() - now_ms).abs() < 60_000,
            "{} is not within a minute of {now_ms}",
            stamped.wall_ms()
        );
    }
}
