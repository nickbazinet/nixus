//! Hybrid logical clock and the install id (AD-4). This story lands the install id and
//! the machine fingerprint that decides when it has to be re-minted; the HLC itself is
//! Milestone 2.
//!
//! Both functions here are pure — the fingerprint takes its signals as a value rather
//! than reading the environment itself — so the regeneration rule is testable without a
//! second machine, which is the only way it could otherwise be exercised.

use sha2::{Digest, Sha256};

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
}
