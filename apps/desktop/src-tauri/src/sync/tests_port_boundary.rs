//! Architecture-fitness guard for AD-6's transport port and AD-7's credential vendor:
//! each AWS SDK is named in exactly one source file.
//!
//! The port only buys anything if the adapter is genuinely the single replaceable
//! piece, and that is the kind of invariant no type signature expresses — a `use`
//! of the SDK added to `manager.rs` compiles perfectly and is invisible in review.
//! This test is what makes it fail.

use std::path::{Path, PathBuf};

/// One SDK, the sole file allowed to name it, and the reason that file must.
struct SdkGuard {
    /// Assembled from parts so this guard does not match itself, and so a search for
    /// the crate name still lands on the implementation rather than on its enforcement.
    parts: &'static [&'static str],
    allowed: &'static str,
    reason: &'static str,
}

const SDK_GUARDS: [SdkGuard; 2] = [
    SdkGuard {
        parts: &["aws", "sdk", "s3"],
        allowed: "sync/s3.rs",
        reason: "is the S3 adapter: the one implementation of the ObjectStore port",
    },
    SdkGuard {
        parts: &["aws", "sdk", "cognitoidentity"],
        allowed: "sync/auth.rs",
        reason: "is the identity-pool credential vendor (AD-7): the one place sync \
                 credentials are obtained",
    },
];

fn needles(parts: &[&str]) -> Vec<String> {
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

pub(super) fn all_rust_sources() -> Vec<(String, PathBuf)> {
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
fn each_aws_sdk_is_named_in_exactly_one_file() {
    let sources = all_rust_sources();

    for guard in SDK_GUARDS {
        let needles = needles(guard.parts);
        let mut offenders = Vec::new();
        let mut matched_files = Vec::new();

        for (relative, path) in &sources {
            let contents = std::fs::read_to_string(path).expect("source readable");
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

            if relative != guard.allowed {
                offenders.extend(hits);
            }
        }

        assert!(
            offenders.is_empty(),
            "{} leaked out of {}, which {}; route this through the module's own port \
             instead:\n{}",
            guard.parts.join("-"),
            guard.allowed,
            guard.reason,
            offenders.join("\n")
        );

        assert!(
            matched_files.iter().any(|found| found == guard.allowed),
            "{} is allowlisted ({}) but no longer names {}; drop the entry",
            guard.allowed,
            guard.reason,
            guard.parts.join("-")
        );
    }
}
