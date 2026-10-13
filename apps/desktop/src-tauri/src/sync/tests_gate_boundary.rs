//! Architecture-fitness guards for AD-14 and inherited AD-12: the gate holds by
//! construction, not by remembering to call it.
//!
//! None of these three properties is expressible as a type. A new method on the
//! `ObjectStore` port compiles perfectly without a gated counterpart; widening
//! `S3ObjectStore::new` back to `pub` compiles perfectly; and a `use` of the port from a
//! command file compiles perfectly. Each would silently produce an un-gated network path,
//! which is exactly what AD-14 exists to prevent.
//!
//! Comment lines are skipped where a rule is described in prose, so the description does
//! not trip its own guard.

use std::path::Path;

use super::tests_port_boundary::all_rust_sources;

fn source(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{relative} is readable: {e}"))
}

fn code_lines(contents: &str) -> impl Iterator<Item = (usize, &str)> {
    contents
        .lines()
        .enumerate()
        .map(|(index, line)| (index + 1, line.trim()))
        .filter(|(_, line)| !line.starts_with("//"))
}

/// Every method declared on the port, read out of `store.rs` itself so the list cannot
/// drift from the trait it is supposed to mirror.
fn port_methods() -> Vec<String> {
    let contents = source("sync/store.rs");
    let trait_header = ["pub trait ", "ObjectStore {"].concat();
    let body = contents
        .split_once(&trait_header)
        .expect("store.rs declares the port")
        .1;
    let body = body
        .split_once("\n}")
        .expect("the port's declaration is closed")
        .0;

    code_lines(body)
        .filter_map(|(_, line)| {
            let signature = line
                .strip_prefix("async fn ")
                .or_else(|| line.strip_prefix("fn "))?;
            Some(signature.split('(').next()?.trim().to_string())
        })
        .collect()
}

/// A port operation that ships without a gated counterpart is an un-gated network path.
#[test]
fn every_port_operation_has_a_gated_counterpart() {
    let methods = port_methods();
    assert!(
        methods.len() >= 8,
        "only {} port methods were found ({:?}); the parse is not reading the trait",
        methods.len(),
        methods
    );

    let gate = source("sync/gate.rs");
    // Only the production half: the test fakes in that file implement the same port, and
    // a guard satisfied by a test double would pass with no gated wrapper at all.
    let gate = gate.split_once("#[cfg(test)]").map_or(gate.as_str(), |(before, _)| before);
    let missing: Vec<&String> = methods
        .iter()
        .filter(|method| !gate.contains(&format!("fn {method}(")))
        .collect();

    assert!(
        missing.is_empty(),
        "these ObjectStore operations have no gated wrapper in sync/gate.rs, so a caller \
         could reach the transport without passing the gate (AD-14): {missing:?}"
    );
}

/// The transport is unreachable from outside `sync`, so the gate cannot be bypassed by
/// constructing an adapter somewhere else.
#[test]
fn no_module_outside_sync_can_name_the_transport() {
    let needles = [
        ["Object", "Store"].concat(),
        ["S3Object", "Store"].concat(),
        ["Gated", "Store"].concat(),
    ];

    let offenders: Vec<String> = all_rust_sources()
        .into_iter()
        .filter(|(relative, _)| !relative.starts_with("sync/"))
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
        "the object store must be reachable only from inside sync, behind the gate \
         (AD-14):\n{}",
        offenders.join("\n")
    );
}

/// Guards the walk: a guard that scans nothing passes forever.
#[test]
fn modules_outside_sync_are_actually_scanned() {
    let scanned = all_rust_sources()
        .into_iter()
        .filter(|(relative, _)| !relative.starts_with("sync/"))
        .count();

    assert!(
        scanned > 20,
        "only {scanned} files were scanned outside sync/; the walk is not finding them"
    );
}

/// The adapter's constructor stays `pub(in crate::sync)`. Without this, a widening to
/// `pub` would make an un-gated store constructible from any module in the crate.
#[test]
fn the_adapter_constructor_is_not_visible_outside_sync() {
    let adapter = source("sync/s3.rs");

    assert!(
        adapter.contains("pub(in crate::sync) fn new("),
        "sync/s3.rs must keep its constructor scoped to crate::sync"
    );

    let widened: Vec<String> = code_lines(&adapter)
        .filter(|(_, line)| line.starts_with("pub fn new(") || line.starts_with("pub fn new<"))
        .map(|(number, line)| format!("sync/s3.rs:{number}: {line}"))
        .collect();

    assert!(
        widened.is_empty(),
        "the adapter's constructor was widened past crate::sync:\n{}",
        widened.join("\n")
    );
}

/// A usable credential is reachable only through the gate.
///
/// `current_pinned` is the only constructor of credentials a network operation may use,
/// and vending is itself a network call, so a caller that reached it directly would have
/// skipped the Frozen and entitlement checks entirely.
#[test]
fn the_pinned_credential_vend_is_reachable_only_through_the_gate() {
    let accessor = ["current", "pinned"].join("_");
    let allowed = ["sync/auth.rs", "sync/gate.rs"];

    let offenders: Vec<String> = all_rust_sources()
        .into_iter()
        .filter(|(relative, _)| !allowed.contains(&relative.as_str()))
        .flat_map(|(relative, path)| {
            let contents = std::fs::read_to_string(&path).expect("source readable");
            code_lines(&contents)
                .filter(|(_, line)| line.contains(&accessor))
                .map(|(number, line)| format!("{relative}:{number}: {line}"))
                .collect::<Vec<String>>()
        })
        .collect();

    assert!(
        offenders.is_empty(),
        "credentials must be vended through SyncGate::vend so the Frozen and entitlement \
         checks cannot be skipped (AD-14):\n{}",
        offenders.join("\n")
    );
}

/// AD-14's stated prevention: no tier name is hard-coded in sync code. The tier is named
/// once, in `entitlements.rs`; sync names the capability.
#[test]
fn no_file_under_sync_names_a_product_tier() {
    let needles = ["remium", "ier_name", "subscription", "license"];

    let offenders: Vec<String> = all_rust_sources()
        .into_iter()
        .filter(|(relative, _)| relative.starts_with("sync/"))
        // This file states the forbidden words in order to forbid them, so it is the one
        // file the rule cannot apply to.
        .filter(|(relative, _)| relative != "sync/tests_gate_boundary.rs")
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
        "sync must gate on the multi_device_sync capability, never on a tier (AD-14); the \
         tier is named only in entitlements.rs:\n{}",
        offenders.join("\n")
    );
}
