---
title: 'Delete local profiles safely'
type: 'feature'
created: '2026-08-21'
status: 'in-progress'
baseline_commit: 'af0b4b5755cc7fc8388ad7e46d21e6d067d21cf2'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Additional local profiles can be created and renamed but never removed, leaving obsolete financial datasets and their AI credentials permanently on the machine.

**Approach:** Add deletion to each local profile's picker-row overflow menu, behind a localized type-to-confirm dialog. Only inactive, non-default local profiles may be deleted; the Rust boundary enforces every restriction and removes that profile's directory and AI credentials.

## Boundaries & Constraints

**Always:** Keep rename and delete in one local-row overflow menu; use the shared destructive `Dialog`; name the profile and irreversibility in EN/FR; require the localized confirmation word; show failures inline; disable picker mutations while deletion is open or pending. Hold `REGISTRY_LOCK` across an unfiltered registry read-modify-write. Refuse the active profile, any `is_default` entry, id `default`, cloud-linked entries, invalid ids, and unknown ids. Remove only `root/datasets/<id>`, clear only that id's AI credentials, and advance generated labels by max numeric suffix so deleted names are never reused.

**Ask First:** Supporting cloud-linked deletion; allowing active-profile deletion by switching automatically; changing Default's permanent status; adding backup/export to this flow.

**Never:** Remove the app-data root, global `profiles/` documents, another dataset, or the Cognito session; emit `dataset:switched`; clear all frontend caches; add dependencies; edit or revert unrelated dirty auth/profile work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Delete local profile | Inactive non-default local id + exact confirm word | Directory, registry entry, and per-id AI credentials are removed; picker stays open and row disappears | Success is announced |
| Active local profile | Entry id equals active id | Delete item is disabled with guidance; backend also refuses | Validation error on `dataset_id` |
| Default profile | `is_default` or id `default` | Delete item omitted and root remains untouched | Backend validation error |
| Cloud-linked profile | `kind: cloud-linked` | No management menu is shown | Backend validation error |
| Filesystem removal fails | Target directory cannot be removed | Registry remains unchanged so deletion remains visible and retryable | Inline translated failure |
| Registry write fails after removal | Directory is already absent | Error surfaces; retry treats the absent directory as already removed and finishes registry cleanup | Inline translated failure |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/datasets.rs:239` -- replace count-based `next_local_label`; add the lock-safe, idempotent `delete_dataset_at` beside `rename_dataset_at`, using `read_registry_for_update` and `dataset_dir_from_root`.
- `apps/desktop/src-tauri/src/credentials.rs:119` -- reuse `clear_credentials(dataset_id)`; tests must prove sibling AI keys and `nixus-auth` survive.
- `apps/desktop/src-tauri/src/commands/datasets.rs:177` and `src-tauri/src/lib.rs` -- expose `delete_dataset` plus an auth-free `get_active_dataset_id`; release `DbState` before registry mutation and register both commands.
- `apps/desktop/src/hooks/useDatasets.ts:117` and `src/hooks/__tests__/useDatasets.test.tsx` -- add active-id query and delete mutation; invalidate only datasets and active-profile keys.
- `apps/desktop/src/components/picker/DatasetPicker.tsx:147` -- replace the pencil with a sibling overflow trigger, cross-disable mutations, and coordinate rename/delete panels.
- `apps/desktop/src/components/picker/ProfileRowMenu.tsx` and `DeleteProfilePanel.tsx` -- local-only menu and typed destructive confirmation; Default omission and active guidance live here while Rust remains authoritative.
- `apps/desktop/src/locales/en.json`, `fr.json`, and `src/locales/__tests__/picker-i18n.test.ts` -- bilingual `datasets.*` copy, exact-key parity, and retirement of the pencil-specific accessible-label key.
- `apps/desktop/tests/picker.spec.ts` -- faithful active-id/delete mocks and picker flows; preserve dirty `auth.spec.ts` and `profile.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `datasets.rs` and `credentials.rs` -- implement and unit-test safe, retryable deletion plus max-suffix naming -- prevent root, sibling, auth, and credential leakage.
- [ ] `commands/datasets.rs`, `lib.rs`, `useDatasets.ts`, and hook tests -- expose active-id/delete IPC and narrow cache invalidation -- keep the picker auth-free and active data intact.
- [ ] Picker components and locales -- add the overflow and typed confirmation interaction -- make irreversible deletion deliberate, accessible, and bilingual.
- [ ] `picker.spec.ts` -- cover restrictions, failure, pending, cancel, success, fresh registry reads, and post-delete naming -- prove the user-visible contract.

**Acceptance Criteria:**
- Given an inactive non-default local profile, when its localized confirmation word is submitted, then only that profile disappears from disk, registry, keyring, and picker without navigation.
- Given Default, a cloud-linked profile, or the active local profile, when management controls and IPC are exercised, then deletion is unavailable or refused and all data remains unchanged.
- Given a profile was deleted and another is created, when labels are generated, then the highest prior `Local Profile <n>` suffix advances rather than colliding or reusing a deleted label.
- Given the implementation, when focused Rust, TypeScript, locale, hook, and picker Playwright gates run, then they pass with zero compilation warnings.

## Spec Change Log

## Design Notes

The overflow placement follows existing destructive-row actions: rename stays a normal menu item and delete is separated and destructive. Default deletion is omitted because its directory is the app-data root; active deletion is disabled because an open SQLite/WAL handle cannot be removed safely on every platform. Directory removal precedes registry removal so a filesystem failure stays visible and retryable; an absent directory is accepted on retry to complete a prior partial operation.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: strict TypeScript passes.
- `pnpm --filter @nixus/desktop test` -- expected: dataset hooks and exact EN/FR locale parity pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml datasets` -- expected: deletion, isolation, ordering, and naming tests pass.
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: exit 0 with zero warnings.
- `pnpm --filter @nixus/desktop exec playwright test picker.spec.ts` -- expected: all picker profile-management flows pass.
