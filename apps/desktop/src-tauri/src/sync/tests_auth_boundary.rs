//! Architecture-fitness guards for AD-7 and the inherited AD-10 / "no AWS credential on
//! a device" invariants, both of which are properties of the *dependency graph* rather
//! than of any signature: nothing about `use crate::credentials;` in `sync/auth.rs`, or
//! about `ai/` naming a sync type, would fail to compile or look wrong in isolation.
//!
//! Comment lines are skipped on purpose, so the rules can be *described* in prose where
//! they are enforced without the description itself tripping them.

use std::path::Path;

use super::tests_port_boundary::all_rust_sources;

fn code_lines(contents: &str) -> impl Iterator<Item = (usize, &str)> {
    contents
        .lines()
        .enumerate()
        .map(|(index, line)| (index + 1, line.trim()))
        .filter(|(_, line)| !line.starts_with("//"))
}

fn sync_auth_source() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/sync/auth.rs");
    std::fs::read_to_string(path).expect("sync/auth.rs is readable")
}

/// Inherited AD-10: `credentials.rs` is the sole accessor of the OS credential store,
/// and `sync/auth.rs` obtains the ID token only through the call-time accessor in
/// `commands/auth.rs`. A direct read here would bypass the single 120-second refresh and
/// create a second place that knows how sessions are stored.
#[test]
fn the_credential_vendor_cannot_reach_the_os_credential_store() {
    let source = sync_auth_source();
    let needles = [
        ["crate", "credentials"].join("::"),
        ["super", "credentials"].join("::"),
        ["key", "ring"].concat(),
        ["key", "chain"].concat(),
    ];

    let offenders: Vec<String> = code_lines(&source)
        .filter(|(_, line)| {
            needles
                .iter()
                .any(|needle| line.to_lowercase().contains(needle))
        })
        .map(|(number, line)| format!("sync/auth.rs:{number}: {line}"))
        .collect();

    assert!(
        offenders.is_empty(),
        "sync/auth.rs must take its ID token from commands/auth.rs and touch no stored \
         credential itself (inherited AD-10):\n{}",
        offenders.join("\n")
    );
}

/// AD-7: the vended credentials live in memory only. A derive, a serializer or a SQL
/// dependency in this file is the first step of every accidental persistence.
#[test]
fn the_vended_credentials_have_no_way_to_be_persisted() {
    let source = sync_auth_source();
    let needles = ["Serialize", "Deserialize", "serde", "rusqlite", "std::fs"];

    let offenders: Vec<String> = code_lines(&source)
        .filter(|(_, line)| needles.iter().any(|needle| line.contains(needle)))
        .map(|(number, line)| format!("sync/auth.rs:{number}: {line}"))
        .collect();

    assert!(
        offenders.is_empty(),
        "the vended credentials must stay in memory: no serialization, no database, no \
         filesystem in sync/auth.rs (AD-7):\n{}",
        offenders.join("\n")
    );
}

/// The inherited Bedrock AD-1 amendment: sync may hold AWS credentials, the hosted-AI
/// path may not. `pub(in crate::sync)` already makes this a compile error; this test is
/// what catches the "small" widening to `pub(crate)` that would silently allow it.
#[test]
fn nothing_under_ai_can_name_the_sync_credential_types() {
    let needles = [
        "VendedCredentials".to_string(),
        "CredentialVendor".to_string(),
        "SyncCredentials".to_string(),
        ["sync", "auth"].join("::"),
    ];

    let offenders: Vec<String> = all_rust_sources()
        .into_iter()
        .filter(|(relative, _)| relative.starts_with("ai/"))
        .flat_map(|(relative, path)| {
            let contents = std::fs::read_to_string(&path).expect("source readable");
            code_lines(&contents)
                .filter(|(_, line)| needles.iter().any(|needle| line.contains(needle)))
                .map(|(number, line)| format!("{relative}:{number}: {line}"))
                .collect::<Vec<String>>()
        })
        .collect();

    assert!(
        offenders.is_empty(),
        "ai/ must not be able to reach sync's AWS credentials (inherited \"no AWS \
         credential on a device\" amendment):\n{}",
        offenders.join("\n")
    );
}

/// Guards the walk itself: a guard that scans nothing passes forever. `ai/` is the
/// directory the third test depends on existing.
#[test]
fn the_ai_module_is_actually_scanned() {
    let scanned = all_rust_sources()
        .into_iter()
        .filter(|(relative, _)| relative.starts_with("ai/"))
        .count();

    assert!(
        scanned > 3,
        "only {scanned} files were scanned under ai/; the walk is not finding the module"
    );
}
