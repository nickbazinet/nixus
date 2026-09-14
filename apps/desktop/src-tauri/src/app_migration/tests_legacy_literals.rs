//! The repository-wide guard behind the spec's third acceptance criterion: after the
//! rename, every surviving legacy literal is an allowlisted compatibility constant.

use std::path::{Path, PathBuf};

/// Every source file allowed to mention the pre-Nixus identity at all, with the
/// reason it must. The guard below fails on any other file, which is what stops the
/// rename from silently regrowing: a new `join("<legacy>.db")` or a copied keyring
/// literal is invisible in review and would quietly write to a name the app no
/// longer reads.
const LEGACY_LITERAL_ALLOWLIST: [(&str, &str); 3] = [
    (
        "datasets.rs",
        "declares LEGACY_APP_IDENTIFIER and LEGACY_DB_FILE_NAME, the compatibility \
         constants this migration consumes",
    ),
    (
        "credentials.rs",
        "declares LEGACY_KEYRING_SERVICE and pins the legacy service names the \
         credential migration reads from",
    ),
    (
        "commands/backup.rs",
        "regression test proving a backup exported under the legacy filename is \
         still restorable",
    ),
];

/// The needles are derived from the two compatibility constants rather than written
/// out, so this file stays free of the literals it hunts and the guard cannot drift
/// away from the names actually in use.
fn legacy_needles() -> Vec<String> {
    let stem = crate::datasets::LEGACY_DB_FILE_NAME
        .split('-')
        .next()
        .expect("the legacy database name has a stem");
    let person = crate::datasets::LEGACY_APP_IDENTIFIER
        .split('.')
        .nth(1)
        .expect("the legacy identifier is a reverse-DNS triple");

    vec![stem.to_string(), person.to_string()]
}

fn rust_sources(dir: &Path, root: &Path, found: &mut Vec<(String, PathBuf)>) {
    for entry in std::fs::read_dir(dir).expect("src is readable") {
        let path = entry.expect("entry readable").path();
        if path.is_dir() {
            rust_sources(&path, root, found);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            let relative = path
                .strip_prefix(root)
                .expect("under src")
                .to_string_lossy()
                .replace('\\', "/");
            found.push((relative, path));
        }
    }
}

fn all_rust_sources() -> Vec<(String, PathBuf)> {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut sources = Vec::new();
    rust_sources(&src, &src, &mut sources);
    assert!(
        sources.len() > 20,
        "the walk found only {} files; it is not scanning the tree",
        sources.len()
    );
    sources
}

#[test]
fn no_source_file_outside_the_allowlist_mentions_the_legacy_identity() {
    let needles = legacy_needles();
    let mut offenders = Vec::new();
    let mut matched_files = Vec::new();

    for (relative, path) in all_rust_sources() {
        let contents = std::fs::read_to_string(&path).expect("source readable");
        let hits: Vec<String> = contents
            .lines()
            .enumerate()
            .filter(|(_, line)| needles.iter().any(|needle| line.contains(needle)))
            .map(|(index, line)| format!("{relative}:{}: {}", index + 1, line.trim()))
            .collect();

        if hits.is_empty() {
            continue;
        }
        matched_files.push(relative.clone());

        if !LEGACY_LITERAL_ALLOWLIST
            .iter()
            .any(|(allowed, _)| *allowed == relative)
        {
            offenders.extend(hits);
        }
    }

    assert!(
        offenders.is_empty(),
        "the legacy application identity reappeared outside the allowlist:\n{}",
        offenders.join("\n")
    );

    // The allowlist is exact in both directions: an entry whose reason no longer
    // applies must be removed rather than left as standing permission.
    for (allowed, reason) in LEGACY_LITERAL_ALLOWLIST {
        assert!(
            matched_files.iter().any(|found| found == allowed),
            "{allowed} is allowlisted ({reason}) but no longer contains a legacy \
             literal; drop the entry"
        );
    }
}

/// The specific regression the allowlist cannot catch on file granularity: a legacy
/// name reintroduced as a *live* constant inside an already-allowlisted file.
#[test]
fn every_constant_carrying_a_legacy_literal_is_declared_as_legacy() {
    let needles = legacy_needles();
    let mut offenders = Vec::new();

    for (relative, path) in all_rust_sources() {
        let contents = std::fs::read_to_string(&path).expect("source readable");
        for (index, line) in contents.lines().enumerate() {
            let declares_const = line.contains("const ") && line.contains('=');
            let carries_legacy = needles.iter().any(|needle| line.contains(needle));
            if declares_const && carries_legacy && !line.contains("LEGACY_") {
                offenders.push(format!("{relative}:{}: {}", index + 1, line.trim()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "a legacy name is declared as a live constant:\n{}",
        offenders.join("\n")
    );
}

/// The shipped Tauri manifest, read from disk rather than through `tauri::generate_context!`
/// so the assertions below need no running app.
fn tauri_manifest() -> (String, serde_json::Value) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let raw = std::fs::read_to_string(&path).expect("tauri.conf.json is readable");
    let parsed = serde_json::from_str(&raw).expect("tauri.conf.json is valid JSON");
    (raw, parsed)
}

/// The bundle identifier *is* the app-data directory name on all three desktop platforms,
/// so it is the single value that decides where every user's data lives. Pinned exactly:
/// changing it silently relocates the whole installed base, and the migration in this
/// module is the only thing that makes such a change survivable.
#[test]
fn the_shipped_bundle_identifier_is_exactly_the_nixus_one() {
    let (_, manifest) = tauri_manifest();

    assert_eq!(
        manifest["identifier"].as_str(),
        Some("org.nixusapp.nixus"),
        "the bundle identifier decides the app-data directory; changing it needs a \
         migration step, not an edit"
    );
}

/// The database filename is the other half of that contract, and the sole declaration
/// every reader resolves through.
#[test]
fn the_database_file_name_is_exactly_nixus_db() {
    assert_eq!(crate::datasets::DB_FILE_NAME, "nixus.db");
}

/// The manifest is scanned for the same legacy needles as the sources, because the
/// identifier is precisely where the pre-Nixus name would come back.
///
/// This deliberately does **not** flag the updater endpoint: that URL is an operational
/// GitHub identifier the spec requires preserved, and the needles are narrow enough not
/// to match it — which the sibling test below pins, so nobody "fixes" this by widening
/// them into the external values.
#[test]
fn the_shipped_manifest_carries_no_legacy_identity_literal() {
    let (raw, _) = tauri_manifest();

    for needle in legacy_needles() {
        let offenders: Vec<&str> = raw
            .lines()
            .filter(|line| line.contains(&needle))
            .map(str::trim)
            .collect();

        assert!(
            offenders.is_empty(),
            "the legacy identity reappeared in tauri.conf.json:\n{}",
            offenders.join("\n")
        );
    }
}

/// The operational external identifiers the spec requires preserved, asserted positively
/// so the guards above can never be "satisfied" by deleting them.
///
/// The GitHub account name is a near-miss for the person-segment needle rather than a
/// match — the character preceding `bazinet` differs — which is exactly why the scan can
/// be strict about the bundle identifier without touching the account. That near-miss is
/// asserted rather than trusted, because a needle widened to the bare surname would start
/// failing on values that must never change.
#[test]
fn the_preserved_external_updater_endpoint_is_untouched_by_the_legacy_needles() {
    let (_, manifest) = tauri_manifest();
    let endpoint = manifest["plugins"]["updater"]["endpoints"][0]
        .as_str()
        .expect("the updater endpoint is configured");

    assert_eq!(
        endpoint, "https://github.com/nickbazinet/nixus/releases/latest/download/latest.json",
        "the updater endpoint is an operational external identifier and must be preserved"
    );
    for needle in legacy_needles() {
        assert!(
            !endpoint.contains(&needle),
            "needle {needle:?} matches the preserved updater endpoint; it must never be \
             widened into external GitHub values"
        );
    }
}
