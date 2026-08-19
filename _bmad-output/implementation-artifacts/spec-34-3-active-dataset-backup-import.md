---
title: 'Per-dataset data stays isolated across backup, import, and danger-zone'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: '9e31be17a03512f8a7d3fbb17951b6846391b6c6'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

Ensure backup/restore and statement staging can only target the active dataset. Danger-zone SQL wiping already uses the active connection and must remain so; demographic `/profile` documents intentionally remain a machine-wide wipe.

## Requirements

- In backup export/import, derive the database path from the dataset id held by the same `DbState` guard as the connection. Do not release the guard and call `active_dataset_dir()`, which can race a switch.
- Expose only the minimal pure/path helper needed to build `<root>/datasets/<id>` while holding the active guard.
- In `import_cc_statement`, reject a staged file unless its canonical path is inside the current active dataset's `imports/` directory. This prevents a Profile A draft path from being processed after Profile B is active.
- Keep `confirm_import` on the active connection.
- Keep danger-zone SQL wiping active-dataset scoped and keep the demographic profile wipe rooted at `global_root` unchanged.
- Add focused Rust tests for Default/non-default backup paths and cross-dataset import-stage rejection.

## Acceptance

- Backup/export/restore for dataset A cannot touch dataset B's database.
- A staged file from A is rejected while B is active.
- Danger-zone table wipe remains active-connection scoped; demographic profile documents remain machine-wide.
- Rust build/tests pass without warnings.

</intent-contract>

## Verification

- `cd apps/desktop/src-tauri && cargo build`
- `cd apps/desktop/src-tauri && cargo test backup`
- `cd apps/desktop/src-tauri && cargo test import`
- `cd apps/desktop/src-tauri && cargo test danger_zone`

## Auto Run Result

Status: done

Backup/export/restore paths now derive from the dataset id held by the same active-state guard as the connection, closing switch races. Restore rejects the active live DB itself and sibling profiles' live databases. Statement imports reject staged files belonging to another active dataset. Danger-zone behavior remains unchanged: SQL wiping is active-profile scoped while demographic profile documents are intentionally machine-wide.

Two-review pass found and fixed a critical self-restore truncation path plus sibling-profile restore exposure. Focused backup/import/danger-zone tests and the Rust build pass.

Follow-up review recommendation: `true` (critical restore safety fix applied).
