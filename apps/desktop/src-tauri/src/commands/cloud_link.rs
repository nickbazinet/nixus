//! The post-callback branch of the OAuth round-trip (AD-11/AD-12).
//!
//! `commands/auth.rs` owns every OAuth mechanic and hands the resolved
//! `LoginIntent` here; this module owns only what happens *locally* afterwards:
//! which dataset the account lands on, and — for Migrate — the copy that produces
//! it. No source file on this path constructs a network client of its own, which
//! is Story 35.6's claim and is asserted by the tests at the bottom of this file.
//!
//! Lock ordering is load-bearing and runs one way only: the registry lock is
//! taken (and released) inside `datasets.rs`, and only then is the dataset
//! activated. Activating while holding the registry lock deadlocks the callback
//! thread, because `select_dataset_now` reads the registry itself.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tracing::info;

use crate::commands::auth::{cloud_identity, LoginIntent};
use crate::commands::datasets::{mark_picker_passed, refresh_ai_state, select_dataset_now};
use crate::datasets;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::Dataset;

/// Lands the completed sign-in on its dataset: reopened or created for `Login`,
/// freshly copied for `Migrate`.
pub(crate) async fn resolve_intent(
    app: &AppHandle,
    intent: &LoginIntent,
    id_token: &str,
) -> Result<(), AppError> {
    let identity = cloud_identity(id_token)?;
    let root = datasets::global_root(app)?;

    let dataset = match intent {
        LoginIntent::Login => {
            datasets::find_or_create_cloud_dataset_at(&root, &identity.sub, &identity.email)?
        }
        LoginIntent::Migrate { source_dataset_id } => datasets::migrate_to_cloud_dataset_at(
            &root,
            source_dataset_id,
            &identity.sub,
            &identity.email,
            || checkpoint_active_source(app, &root, source_dataset_id),
        )?,
    };

    activate(app, &dataset).await
}

/// Migrate's abort seam, and the single sanctioned exception to the lock order: a
/// brief read-only peek at the active-dataset lock, taken while the registry lock
/// is held and released before the copy runs.
///
/// If the user switched profiles during the browser round-trip, the source is no
/// longer active and this fails — creating nothing. Otherwise the source's WAL is
/// checkpointed into its main database file, using the same sequence the backup
/// export already uses, so the file about to be copied is complete on its own.
///
/// The path is resolved from the same guard the connection was flushed under, and
/// by explicit id, so it can never name a sibling dataset's file.
fn checkpoint_active_source(
    app: &AppHandle,
    root: &Path,
    source_dataset_id: &str,
) -> Result<PathBuf, AppError> {
    let state = app.state::<DbState>();
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    if active.id.as_deref() != Some(source_dataset_id) {
        return Err(AppError::Validation {
            message: "The profile you started migrating is no longer open. Please try again."
                .to_string(),
            field: Some("source_dataset_id".to_string()),
        });
    }

    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;

    Ok(datasets::dataset_db_path(root, source_dataset_id))
}

/// Opens the resolved dataset and marks the launch picker passed.
///
/// The picker gate is latched here because a sign-in *from* the picker never goes
/// through the picker's own click path, and without it the user would be bounced
/// straight back to the picker they just signed in from. Latching is idempotent,
/// so the in-app Migrate path is unaffected.
async fn activate(app: &AppHandle, dataset: &Dataset) -> Result<(), AppError> {
    select_dataset_now(app, &dataset.id)?;
    refresh_ai_state(app, &dataset.id).await;
    mark_picker_passed();

    info!("Cloud sign-in landed on dataset {}", dataset.id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    fn src_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
    }

    fn suffix_after_src(path: &Path) -> String {
        let full = path.to_string_lossy().replace('\\', "/");
        match full.split_once("/src/") {
            Some((_, suffix)) => suffix.to_string(),
            None => full,
        }
    }

    fn rust_sources(dir: &Path, found: &mut Vec<(PathBuf, String)>) {
        for entry in std::fs::read_dir(dir).expect("source directory is readable") {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                rust_sources(&path, found);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let source = std::fs::read_to_string(&path).expect("source is readable");
                found.push((path, production_source(&source).to_string()));
            }
        }
    }

    /// Where every file's `#[cfg(test)]` block starts, and the reason this module
    /// can audit itself: the assertions below quote the very needles they search
    /// for, so a whole-file scan would always match this file. Cutting on the
    /// module header — not on a bare `#[cfg(test)]`, which also appears in prose —
    /// keeps the shipped half of every file, which is the half the claim is about.
    const TEST_MODULE_HEADER: &str = "mod tests {";

    fn production_source(source: &str) -> &str {
        match source.split_once(TEST_MODULE_HEADER) {
            Some((production, _)) => production,
            None => source,
        }
    }

    /// Every file in the crate that constructs a network client in its own source,
    /// named explicitly.
    ///
    /// The vehicle catalog predates this epic and has nothing to do with sign-in;
    /// it is listed so the sweep below can assert an exact set rather than a
    /// minimum, which is what makes a new networked module a test failure.
    ///
    /// `ai/hosted_bedrock.rs` is the Nixus Cloud Bedrock HTTP/NDJSON adapter. It is
    /// deliberately networked and deliberately NOT on the Login/Migrate/keyring
    /// path this guard protects: it never touches a profile file or `credentials.rs`,
    /// obtains its only credential from `commands/auth.rs`, and sends nothing but a
    /// prompt the user explicitly invoked an AI feature to send.
    const NETWORKED_MODULES: [&str; 3] = [
        "ai/hosted_bedrock.rs",
        "commands/auth.rs",
        "maintenance/catalog.rs",
    ];

    /// The modules the Login and Migrate branches are built out of — this one
    /// included. None of them may ever appear in the networked set.
    const CLOUD_PROFILE_MODULES: [&str; 4] = [
        "datasets.rs",
        "credentials.rs",
        "commands/datasets.rs",
        "commands/cloud_link.rs",
    ];

    /// Every network client this crate could plausibly reach for, banned in the
    /// four modules above and deliberately nowhere else: `ai/*`,
    /// `commands/settings.rs`, `commands/chat.rs` and `maintenance/catalog.rs`
    /// legitimately use networked clients, so this list is scoped rather than
    /// crate-wide. Most of these appear nowhere on the login/migrate path today —
    /// they are here so a future regression reaching for a *different* HTTP crate
    /// fails the same way `reqwest` would.
    const BANNED_NETWORK_NAMES: [&str; 9] = [
        "reqwest",
        "TcpStream",
        "TcpListener",
        "UdpSocket",
        "hyper::",
        "ureq::",
        "tiny_http",
        "aws_sdk_",
        "async_openai",
    ];

    /// Story 35.6's claim, as a guard rather than an assumption: no file on the
    /// Login branch, the Migrate copy, or the keyring accessor constructs an HTTP
    /// or socket client in its own source, so none of them can send a profile or a
    /// financial record anywhere.
    ///
    /// Scoped to each file's own source on purpose, and it is NOT a claim that zero
    /// network I/O can occur anywhere downstream: these modules do call into
    /// `commands/auth.rs`'s own already-audited Cognito session refresh (the badge
    /// read resolves a subject) and into `ai::*`'s provider clients (sign-in
    /// completion re-probes AI credentials), both pre-existing, intentional, and
    /// orthogonal to what this guard checks. Building a transitive call-graph
    /// checker is deliberately out of scope.
    #[test]
    fn no_file_on_the_login_or_migrate_path_constructs_a_network_client() {
        let mut sources = Vec::new();
        rust_sources(&src_root(), &mut sources);
        assert!(
            sources.len() > 20,
            "the sweep found only {} files, so it is not scanning the crate",
            sources.len()
        );

        let mut networked: Vec<String> = sources
            .iter()
            .filter(|(_, source)| source.contains("reqwest") || source.contains("TcpStream"))
            .map(|(path, _)| suffix_after_src(path))
            .collect();
        networked.sort();

        let mut expected: Vec<String> = NETWORKED_MODULES.iter().map(|m| m.to_string()).collect();
        expected.sort();
        assert_eq!(
            networked, expected,
            "the set of files that construct a network client changed"
        );

        for module in CLOUD_PROFILE_MODULES {
            let (_, source) = sources
                .iter()
                .find(|(path, _)| suffix_after_src(path) == module)
                .unwrap_or_else(|| panic!("{module} is named here but is not being scanned"));

            for name in BANNED_NETWORK_NAMES {
                assert!(
                    !source.contains(name),
                    "{module} is on the login/migrate path and must not construct a network \
                     client in its own source, but it names {name}"
                );
            }
        }
    }

    /// The other half of NFR1: the OAuth module may reach the network, but only at
    /// Cognito's known endpoints.
    ///
    /// Two shapes are scanned because the module composes its targets two ways: the
    /// token endpoint is spliced inline (`{}/oauth2/…`), while the authorize entries
    /// are the path literals `AuthorizeEntry` selects between. Only the production
    /// half of the file is read, so a byte-exact URL in a test fixture is never
    /// mistaken for a call site — and a path merely named in prose is not either.
    /// Split on the test module's own declaration rather than on its `cfg` attribute:
    /// that attribute is also *named* in a header comment, which would cut the scan
    /// off at line 23 and silently leave it matching nothing.
    #[test]
    fn the_oauth_module_only_ever_addresses_the_known_cognito_endpoints() {
        let auth = std::fs::read_to_string(src_root().join("commands").join("auth.rs"))
            .expect("the OAuth module is readable");
        let (production, _) = auth
            .split_once("mod tests {")
            .expect("the OAuth module carries a test module");

        let spliced = production.match_indices("{}/oauth2/").map(|(index, _)| {
            let rest = &production[index + 2..];
            let end = rest
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '/' && c != '_')
                .unwrap_or(rest.len());
            &rest[..end]
        });

        let literal = production.match_indices("\"/").map(|(index, _)| {
            let rest = &production[index + 1..];
            let end = rest[1..].find('"').expect("a closed string literal") + 1;
            &rest[..end]
        });

        let mut targets: Vec<&str> = spliced.chain(literal).collect();
        targets.sort_unstable();
        targets.dedup();

        assert_eq!(
            targets,
            ["/oauth2/authorize", "/oauth2/token", "/signup"],
            "the set of Cognito endpoints this module can address changed"
        );
    }
}
