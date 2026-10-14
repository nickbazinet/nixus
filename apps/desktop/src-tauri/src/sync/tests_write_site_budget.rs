//! The write-site ratchet (AD-3, AD-19): a checked-in count of the SQL writes that do NOT yet go
//! through `ActiveDataset::write`, which may only ever shrink.
//!
//! WHY a count and not a rule the compiler enforces: `db::*` write functions take `&Connection`,
//! and a `WriteTx` derefs to one, so a migrated site and an unmigrated one are the same type by
//! design — that is what lets Stories 17 and 18 move a site by changing its CALLER. Something
//! outside the type system therefore has to hold the line, and this is it.
//!
//! WHY the marker is a comment. A migrated `db::*` function is one that is only ever reached
//! through `ActiveDataset::write`, which is a fact about its callers and not about its body, so the
//! function states it: `CAPTURE-SANCTIONED (AD-3)` in the comment block directly above it. The
//! marker is a claim a reviewer checks, not a proof — the ratchet's job is to make ADDING an
//! uncaptured write site visible, not to certify the migrated ones.
//!
//! Regenerate after migrating sites:
//! `NIXUS_WRITE_SITE_BUDGET=update cargo test write_site`

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The statement starts that count as a write. Uppercase because every SQL string in this
/// repository is, and the scanner is deliberately a text scanner: a deterministic, reviewable
/// heuristic beats a parser whose output nobody can predict.
const WRITE_TOKENS: &[&str] = &[
    "INSERT INTO",
    "INSERT OR REPLACE INTO",
    "INSERT OR IGNORE INTO",
    "REPLACE INTO",
    "UPDATE ",
    "DELETE FROM",
];

const MARKER: &str = "CAPTURE-SANCTIONED";

/// Paths (relative to `src/`) whose writes are not write SITES at all.
///
/// `sync/` is the apply path, the segment writer and the bookkeeping: AD-11 writes on its own
/// connection with the hook off, and capture's own `sync_log` inserts obviously cannot be captured.
/// The `db/sync_*` modules are the SQL for those same `LocalOnly` tables. `db/snapshot_strip.rs`
/// writes inside a snapshot COPY, never the live dataset (AD-9).
const SANCTIONED_PREFIXES: &[&str] = &[
    "sync/",
    "db/sync_capture.rs",
    "db/sync_identity.rs",
    "db/sync_state.rs",
    "db/sync_blobs.rs",
    "db/snapshot_strip.rs",
];

fn is_test_only(relative: &str) -> bool {
    let name = relative.rsplit('/').next().unwrap_or(relative);

    name.starts_with("tests_")
        || relative.contains("/sim/")
        || matches!(
            name,
            "test_support.rs" | "test_dataset.rs" | "sim_tables.rs" | "capture_fixtures.rs"
        )
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Budget {
    /// Carried in the file itself so the next person to see it red knows what to do.
    #[serde(rename = "_how_to_lower_this")]
    how_to_lower: String,
    total: usize,
    sites: BTreeMap<String, usize>,
}

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn budget_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("sync-write-site-budget.json")
}

fn rust_files(dir: &Path, found: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .expect("the source tree is readable")
        .map(|entry| entry.expect("a directory entry").path())
        .collect();
    entries.sort();

    for path in entries {
        if path.is_dir() {
            rust_files(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

fn scan() -> BTreeMap<String, usize> {
    let src = src_dir();
    let mut files = Vec::new();
    rust_files(&src, &mut files);

    let mut sites: BTreeMap<String, usize> = BTreeMap::new();

    for path in files {
        let relative = path
            .strip_prefix(&src)
            .expect("every file is under src/")
            .to_string_lossy()
            .replace('\\', "/");

        if is_test_only(&relative)
            || SANCTIONED_PREFIXES
                .iter()
                .any(|prefix| relative.starts_with(prefix))
        {
            continue;
        }

        let source = std::fs::read_to_string(&path).expect("a source file is readable");
        scan_file(&relative, &source, &mut sites);
    }

    sites
}

fn scan_file(relative: &str, source: &str, sites: &mut BTreeMap<String, usize>) {
    let mut function = "<file>".to_string();
    let mut marked = false;
    let mut sanctioned = false;
    let mut test_only_rest_of_file = false;

    for line in source.lines() {
        let trimmed = line.trim_start();

        // A `mod tests` is the end of the production part of the file, so everything after it is
        // test code whatever it is called.
        if trimmed.starts_with("mod tests") || trimmed.starts_with("pub mod tests") {
            test_only_rest_of_file = true;
        }

        if trimmed.contains(MARKER) {
            marked = true;
        }

        if let Some(name) = function_name(trimmed) {
            function = name;
            sanctioned = marked || test_only_rest_of_file;
            marked = false;
        }

        if sanctioned || test_only_rest_of_file || trimmed.starts_with("//") {
            continue;
        }

        if let Some(count) = writes_in(line) {
            *sites.entry(format!("{relative}::{function}")).or_insert(0) += count;
        }
    }
}

fn function_name(trimmed: &str) -> Option<String> {
    let rest = trimmed
        .strip_prefix("pub(crate) ")
        .or_else(|| trimmed.strip_prefix("pub "))
        .unwrap_or(trimmed);
    let rest = rest.strip_prefix("async ").unwrap_or(rest);
    let rest = rest.strip_prefix("unsafe ").unwrap_or(rest);
    let rest = rest.strip_prefix("fn ")?;

    let name: String = rest
        .chars()
        .take_while(|character| character.is_alphanumeric() || *character == '_')
        .collect();

    (!name.is_empty()).then_some(name)
}

/// How many write statements start on this line, or `None` for a line that holds none.
///
/// The token has to be preceded by a quote on the same line: every write in this repository is a
/// string literal handed to rusqlite, and the quote is what keeps prose out of the count.
fn writes_in(line: &str) -> Option<usize> {
    let quote = line.find('"')?;
    let tail = &line[quote..];

    let count: usize = WRITE_TOKENS
        .iter()
        .map(|token| tail.matches(token).count())
        .sum();

    (count > 0).then_some(count)
}

#[test]
fn the_write_site_budget_may_only_shrink() {
    let scanned = scan();
    let total: usize = scanned.values().sum();

    if std::env::var("NIXUS_WRITE_SITE_BUDGET").as_deref() == Ok("update") {
        let budget = Budget {
            how_to_lower: "Move the write site onto ActiveDataset::write and mark the db function \
                           CAPTURE-SANCTIONED (AD-3), then re-run with \
                           NIXUS_WRITE_SITE_BUDGET=update."
                .to_string(),
            total,
            sites: scanned,
        };
        std::fs::write(
            budget_path(),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&budget).expect("the budget serializes")
            ),
        )
        .expect("the budget file is writable");
        return;
    }

    let recorded: Budget = serde_json::from_str(
        &std::fs::read_to_string(budget_path()).expect("the budget file is checked in"),
    )
    .expect("the budget file is valid JSON");

    let mut grown: Vec<String> = Vec::new();
    for (site, count) in &scanned {
        match recorded.sites.get(site) {
            Some(allowed) if count <= allowed => {}
            Some(allowed) => grown.push(format!("{site}: {allowed} -> {count}")),
            None => grown.push(format!("{site}: new, {count} write(s)")),
        }
    }

    assert!(
        grown.is_empty(),
        "new or grown uncaptured write sites (AD-3). Write through ActiveDataset::write, or \
         re-run with NIXUS_WRITE_SITE_BUDGET=update if the move is real:\n{}",
        grown.join("\n")
    );

    assert!(
        total <= recorded.total,
        "the uncaptured write total grew from {} to {total}",
        recorded.total
    );
}

/// The ratchet is worthless if the scanner finds nothing, or if it stops noticing the one site this
/// story migrated. Both halves are asserted so the gate cannot pass vacuously.
#[test]
fn the_scanner_sees_the_unmigrated_sites_and_not_the_migrated_one() {
    let scanned = scan();

    // A floor, not a measurement: Story 17 took the finance domains out, so the number only ever
    // falls from here. The named lists below are what actually keeps the scanner honest.
    assert!(
        scanned.len() > 25,
        "the scanner found only {} write sites, which cannot be the unmigrated remainder",
        scanned.len()
    );

    for migrated in [
        "db/budget.rs::create_budget_group",
        "db/budget.rs::update_budget_group",
        "db/budget.rs::delete_budget_group",
        "db/expense.rs::update_expense",
        "db/expense.rs::delete_expense",
        "db/income.rs::update_income_entry",
        "db/net_worth.rs::record_net_worth_snapshot",
        "db/recurring.rs::insert_template",
    ] {
        assert!(
            !scanned.contains_key(migrated),
            "{migrated} is marked CAPTURE-SANCTIONED and must not be counted"
        );
    }

    for unmigrated in [
        "db/projects.rs::insert_project",
        "db/maintenance.rs::insert_vehicle",
        "db/chat.rs::insert_message",
        "db/config.rs::set",
        // Finance, but still reachable from the AI chat actions on a bare connection, which is
        // Story 18's migration: the ratchet must keep showing those.
        "db/budget.rs::create_budget_category",
        "db/expense.rs::insert_expense_with_source_with_balance_changes",
    ] {
        assert!(
            scanned.contains_key(unmigrated),
            "{unmigrated} has not been migrated yet and must still be counted"
        );
    }
}

#[test]
fn a_write_inside_a_comment_is_not_a_write_site() {
    assert_eq!(writes_in("    // DELETE FROM accounts is what this does"), None);
    assert_eq!(
        writes_in("        \"DELETE FROM accounts WHERE id = ?1\","),
        Some(1)
    );
    assert_eq!(
        writes_in("        \"INSERT INTO a VALUES (1); INSERT INTO b VALUES (2)\","),
        Some(2)
    );
    assert_eq!(writes_in("    let updated = rows;"), None);
}
