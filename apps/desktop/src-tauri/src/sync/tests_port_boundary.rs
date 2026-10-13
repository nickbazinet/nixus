//! Architecture-fitness guard for AD-6's transport port: the S3 SDK is named in
//! exactly one source file.
//!
//! The port only buys anything if the adapter is genuinely the single replaceable
//! piece, and that is the kind of invariant no type signature expresses — a `use`
//! of the SDK added to `manager.rs` compiles perfectly and is invisible in review.
//! This test is what makes it fail.

use std::path::{Path, PathBuf};

/// The sole file allowed to name the SDK, with the reason it must.
const SDK_ALLOWLIST: [(&str, &str); 1] = [(
    "sync/s3.rs",
    "is the S3 adapter: the one implementation of the ObjectStore port",
)];

/// Assembled from parts so this guard does not match itself, and so a search for the
/// crate name still lands on the adapter rather than on its own enforcement.
fn sdk_needles() -> Vec<String> {
    let parts = ["aws", "sdk", "s3"];
    vec![parts.join("_"), parts.join("-")]
}

fn rust_sources(dir: &Path, root: &Path, found: &mut Vec<(String, PathBuf)>) {
    for entry in std::fs::read_dir(dir).expect("src is readable") {
        let path = entry.expect("entry readable").path();
        if path.is_dir() {
            rust_sources(&path, root, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
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
fn only_the_s3_adapter_names_the_s3_sdk() {
    let needles = sdk_needles();
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

        if !SDK_ALLOWLIST
            .iter()
            .any(|(allowed, _)| *allowed == relative)
        {
            offenders.extend(hits);
        }
    }

    assert!(
        offenders.is_empty(),
        "the S3 SDK leaked out of the adapter; route this through the ObjectStore \
         port instead:\n{}",
        offenders.join("\n")
    );

    for (allowed, reason) in SDK_ALLOWLIST {
        assert!(
            matched_files.iter().any(|found| found == allowed),
            "{allowed} is allowlisted ({reason}) but no longer names the SDK; drop \
             the entry"
        );
    }
}
