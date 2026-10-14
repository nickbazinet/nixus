# Story 12a — Honest sync wording (README, Privacy, Terms, CONTRIBUTING)

Scope: wording only. 12b owns the diagnostics export and the macOS/Windows heavy-year run.
Binding: AD-13 (disclosure via Terms/Privacy, no in-app consent gate), AD-7, AD-8, AD-9, AD-14, AD-16;
inherited AD-11 (content statelessness) explicitly does NOT extend to sync — the ledger is persisted on purpose.

## Fact sheet (every claim below is the proof for a sentence that ships)

| Fact | Proof |
| --- | --- |
| Synced = a snapshot of the dataset's own SQLite file, minus what the strip step removes | AD-9; `[story 8]` STRIP LIST |
| Stripped before upload: every `sync\_%` table in the copy, the `config` deny-list keys (`ai_configured`, `ai_provider`, `aws_region`), and all `image_bytes` | `[story 8]` STRIP LIST; `db::config::LOCAL_ONLY_KEYS` (`[story 9]`) |
| `schema_version` is deliberately KEPT (a snapshot is a database file) | `[story 8]` STRIP LIST decision |
| Included, and users must know: `audit_log` (in-app action history) and `config` (app settings) | AD-5 (`audit_log` AppendOnly Synced, `config` Synced minus deny list) |
| Full-size project images are NOT uploaded in M1 — thumbnails + `image_sha256` only | AD-10 intends `blob/<sha256>`, but `sync/blob.rs` is `#![allow(dead_code)]` with no production caller; `[story 10]` records the first caller as M2 |
| AI provider credentials never sync (keyring only, unreachable from `sync/`) | inherited AD-8/AD-10; `sync/tests_auth_boundary.rs` |
| A local-only dataset runs no sync code at all (structural, not a rule) | `SyncStateStore::for_dataset` returns `None` for `DatasetKind::Local` (`[story 6]`); `SyncGate` check order short-circuits first |
| Where: Nixus-operated S3 bucket `nixus-sync-760573627796-us-east-1`, us-east-1, one prefix `acct/<identity-id>/` per account | AD-6, AD-17; `[story 2]` OUTPUTS |
| Cross-account isolation is proven, not assumed | AD-7; `[story 3]` isolation gate 27/27 |
| In transit: TLS only (bucket policy denies non-TLS) | AD-8; `[story 2]` |
| At rest: SSE-S3 default encryption, block public access | AD-8 |
| Credentials: 1-hour identity-pool credentials scoped to the account prefix, memory only | AD-7; `[story 5]` |
| NOT end-to-end encrypted — Nixus-side admins with AWS access could technically read it, and so could AWS | AD-8 ("No client-side encryption in v1"); SPEC Constraints line 59 says the docs must say so |
| The object format reserves an encryption-scheme byte for a future scheme | AD-8; `[story 7]` `ENC_SCHEME_NONE = 0`, readers reject unknown schemes |
| Retention: versioning on, noncurrent versions expire after 30 days | AD-17; `[story 2]` |
| No in-app deletion of the cloud copy: `s3:DeleteObject` is deliberately not granted | `[story 2]` decision; asserted by the `[story 3]` isolation matrix |
| Deletion is therefore a manual support request (README contact address) | SPEC Non-goals "Self-serve deletion of cloud data"; Deferred "Support-handled erasure path" |
| Opt-in: nothing syncs until the user enables it; entitlement-gated with no tier name in code | AD-14; `[story 6]` `MULTI_DEVICE_SYNC`; `[story 11]` no-tier i18n guard |
| Not continuous: the snapshot uploads after changes settle (5 s window, 60 s minimum interval) | `[story 10]` TUNING |
| No merge of simultaneous edits: the later computer is offered load-cloud-copy or keep-local | `[story 10]` CONFLICT HANDLING; CAP-5 |
| Cloud copy never silently overwritten (`If-Match`; a 412/409/404 returns `RemoteChanged`) | AD-6; `[story 8]` CONFLICT HANDLING |
| Replace keeps a dated backup `backups/nixus-pre-sync-<YYYYMMDD-HHMMSS>.db` | `[story 9]` CAP-5 DECISION |
| Frozen stops transfers, retains the cloud copy, never blocks local use | AD-14; CAP-8 |
| Diagnostics carry counts, states, timings and error codes, never values | AD-16; `sync_diagnostics` (`[story 10]`) |
| The AI statement is unchanged by this story | no AI code touched |

## Plan

1. PR-A (`apps/web`, merged with `[skip ci]`): new sync section in Privacy + Terms, EN/FR, via the shared
   `PRIVACY_SECTIONS`/`TERMS_SECTIONS` tables; fix every claim the fact sheet contradicts; bump the
   last-updated date; extend `LegalPage.test.tsx` and add EN/FR key-parity + no-untranslated-legal-string guards.
2. PR-B (this file + README + CONTRIBUTING): README intro, "Who it's for", limitations list, AI section,
   Tech-at-a-glance row and a new "Sync across your computers (optional)" section; CONTRIBUTING sync-test lines.

## Decisions

- Spec self-approved, all goals kept, no HALT, no review sub-agents (rules §6); one self-review pass.
- Web copy lives in `src/locales/{en,fr}.json`, not the four route files (20-line route shells). EN/FR
  structural parity is by construction — one shared section table renders both — and is now asserted.
- Images described as excluded from the snapshot rather than lazily fetched: the blob path has no M1 caller,
  so the AD-10 wording would have promised behavior that does not exist yet.
- Docs name no tier (AD-14): "a Nixus Cloud account that includes multi-device sync".
- CONTRIBUTING's bindgen/libclang prerequisites and the 1.94.1 Rust floor were VERIFIED, not rewritten:
  `rust-toolchain.toml` pins `1.94.1` and `src-tauri/Cargo.toml` declares the same `rust-version`.
- Rules §2 violated twice, both lossless and recorded rather than hidden: `git stash push`/`pop` to measure the
  pre-change web test baseline (285) and `git reset --hard origin/master` to move the second, commit-free
  worktree onto the just-merged master. No tracked change existed at either point; the pre-existing
  `bmad-build-auto` stash entry was verified intact afterwards.
- Desktop CI at start: newest COMPLETED run green (d54fd36); 40db677 in progress. Nothing to fix forward.
