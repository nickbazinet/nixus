---
title: 'AI-provider credentials become per-profile'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_revision: 'fbab6330f7928232ba2001e343126701e073493c'
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

<intent-contract>

## Intent

Scope AI-provider keyring entries to the active dataset. Default must continue using the exact service literal `nkbaz-finance` with zero migration; non-default datasets use `nkbaz-finance-<dataset_id>` byte-for-byte. `credentials.rs` remains the only module touching `keyring_core::Entry`.

## Requirements

- Add a dataset-aware service-name helper in `credentials.rs` and pass `dataset_id` to AWS/OpenAI store/load/clear functions.
- Update all callers in settings commands and AI initialization to use the active dataset id.
- Reload `AiState` when `select_dataset` swaps datasets so AI clients cannot remain bound to the previous profile's key.
- Keep Cognito auth credential storage unchanged and machine-wide.
- Add focused keyring tests proving Default uses the old entries unchanged and two non-default ids remain isolated.
- Keep signatures typed and avoid new dependencies.

## Acceptance

- Default's existing AWS/OpenAI credentials still load without migration.
- Saving/loading/clearing credentials for dataset A never affects dataset B.
- Switching datasets rebuilds AI state from the selected dataset's DB config and keyring service.
- Rust build is warning-free and focused credential/settings/dataset tests pass.

</intent-contract>

## Code Map

- `apps/desktop/src-tauri/src/credentials.rs` -- dataset-aware AI service names and isolation tests.
- `apps/desktop/src-tauri/src/commands/settings.rs` -- use active dataset id for save/clear.
- `apps/desktop/src-tauri/src/ai/mod.rs` -- initialize provider from a dataset id.
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- refresh `AiState` after selection.
- `apps/desktop/src-tauri/src/lib.rs` -- pass Default/active id during startup initialization as needed.

## Verification

- `cd apps/desktop/src-tauri && cargo build`
- `cd apps/desktop/src-tauri && cargo test credentials`
- `cd apps/desktop/src-tauri && cargo test datasets`
- `cd apps/desktop && npx tsc --noEmit`

## Auto Run Result

Status: done

AI-provider credentials are now scoped by dataset. Default keeps the exact legacy `nkbaz-finance` service; non-default profiles use `nkbaz-finance-<dataset_id>`. Settings commands, AI initialization, and dataset switching all use the active dataset id. Switching replaces `AiState` so the previous profile's provider cannot remain active.

Two-review pass found and fixed two material isolation gaps: non-default profiles no longer fall back to machine-wide environment/default-chain credentials, and poisoned AI-state locks cannot preserve a stale provider. Focused credential, dataset, and AI initialization tests pass; TypeScript and Rust builds are clean.

Follow-up review recommendation: `true` (material isolation fixes applied).
