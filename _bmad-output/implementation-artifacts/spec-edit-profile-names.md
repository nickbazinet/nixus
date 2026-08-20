---
title: 'Edit local profile names'
type: 'feature'
created: '2026-08-20'
status: 'done'
baseline_commit: '2d5a8409b59ea57459d35908910829fe41959117'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Local profile labels are generated automatically and cannot be changed, making multiple profiles difficult to distinguish once their purpose changes.

**Approach:** Add a focused registry rename operation and expose it from the profile picker. Persist only the display label; dataset ids, directories, profile contents, and cloud-account labels remain unchanged.

## Boundaries & Constraints

**Always:** Allow renaming local profiles, including Default, from the picker. Trim submitted labels and reject empty labels or labels longer than 80 characters. Keep dataset ids and directories immutable. Hold the existing registry writer lock across the read-modify-write. Refresh both the picker list and active-profile query after success. Add English and French copy together. Preserve all unrelated working-tree changes.

**Ask First:** Expanding rename support to cloud-linked profiles; adding profile deletion; changing dataset ids or directory names; introducing label uniqueness rules.

**Never:** Touch `apps/desktop/src/hooks/useAuth.ts`, `apps/desktop/src/hooks/__tests__/useAuth.test.tsx`, or `_bmad-output/implementation-artifacts/spec-local-profile-switch-skips-auth-checks.md`. Do not move data, add dependencies, hardcode user-visible English, auto-select a renamed profile, or broaden this into profile-management redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename local profile | Existing local id and `"  Work  "` | Persist and display `"Work"`; remain on picker | N/A |
| Rename Default | Dataset id `default` | Change display label only; root storage remains unchanged | N/A |
| Invalid label | Blank after trim or over 80 characters | Registry remains unchanged | Return field validation error for `label` |
| Missing profile | Unknown dataset id | Registry remains unchanged | Return not-found validation error |
| Cloud-linked profile | Existing cloud-linked id | Account-derived label remains unchanged | Reject rename |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/datasets.rs` -- registry mutators, `REGISTRY_LOCK`, atomic writer, and dataset tests; add the label-only rename operation here.
- `apps/desktop/src-tauri/src/commands/datasets.rs` -- thin Tauri dataset commands; expose `rename_dataset` using snake_case parameters.
- `apps/desktop/src-tauri/src/lib.rs` -- `generate_handler!` registration required for the new command.
- `apps/desktop/src/hooks/useDatasets.ts` -- dataset mutations and cache invalidation; add the rename mutation.
- `apps/desktop/src/hooks/__tests__/useDatasets.test.tsx` -- focused mutation/cache behavior tests.
- `apps/desktop/src/components/picker/DatasetPicker.tsx` -- renders `entry.label`; add the small rename interaction without nesting a control inside the profile-row button.
- `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json` -- bilingual picker labels and validation/error copy under `datasets.*`.
- `apps/desktop/src/locales/__tests__/picker-i18n.test.ts` -- exact picker-key parity contract.
- `apps/desktop/tests/picker.spec.ts` -- picker Tauri mock and rename flow; replace the obsolete blanket no-input assertion with a creation-specific assertion.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/datasets.rs` -- add and unit-test a lock-safe local-profile label mutation -- persist valid names without changing profile identity or sibling entries.
- [x] `apps/desktop/src-tauri/src/commands/datasets.rs` and `apps/desktop/src-tauri/src/lib.rs` -- expose and register `rename_dataset` -- make the mutation available through Tauri IPC.
- [x] `apps/desktop/src/hooks/useDatasets.ts` and its test -- add `useRenameDataset` and invalidate dataset/active-profile queries -- keep visible labels current without clearing unrelated caches.
- [x] `DatasetPicker.tsx`, locale files, and picker i18n test -- add a compact rename dialog for local rows -- provide an accessible bilingual interaction.
- [x] `apps/desktop/tests/picker.spec.ts` -- cover successful rename and retained picker state -- verify the user-visible flow without broad suite expansion.

**Acceptance Criteria:**
- Given a local profile in the picker, when the user submits a valid new name, then the row updates immediately, the name survives a registry reload, and no navigation occurs.
- Given the active profile is renamed, when active-profile data is queried again, then its new display label is returned.
- Given invalid input, when rename is submitted, then the user sees a translated error and the previous label remains.
- Given a cloud-linked profile, when the picker renders, then no rename action is offered.

## Spec Change Log

## Verification

**Commands:**
- `cargo test datasets` from `apps/desktop/src-tauri` -- expected: rename unit tests and existing dataset tests pass.
- `pnpm exec tsc --noEmit` from `apps/desktop` -- expected: strict TypeScript check passes.
- `pnpm test -- picker-i18n useDatasets` from `apps/desktop` -- expected: focused locale and hook tests pass.
- `pnpm exec playwright test picker.spec.ts` from `apps/desktop` -- expected: focused picker flows pass.

## Suggested Review Order

**User flow**

- Picker rows expose local-only rename controls and guard every competing action.
  [`DatasetPicker.tsx:35`](../../apps/desktop/src/components/picker/DatasetPicker.tsx#L35)

- The edit panel validates names and remains stable while persistence is pending.
  [`RenameProfilePanel.tsx:32`](../../apps/desktop/src/components/picker/RenameProfilePanel.tsx#L32)

**Persistence boundary**

- Registry mutation trims, validates, locks, and changes only the display label.
  [`datasets.rs:528`](../../apps/desktop/src-tauri/src/datasets.rs#L528)

- The Tauri command keeps filesystem resolution outside the active-dataset lock.
  [`datasets.rs:184`](../../apps/desktop/src-tauri/src/commands/datasets.rs#L184)

- Command registration makes the new IPC endpoint reachable by the picker.
  [`lib.rs:213`](../../apps/desktop/src-tauri/src/lib.rs#L213)

**State and evidence**

- Mutation invalidates only profile-label queries, preserving unrelated cached data.
  [`useDatasets.ts:139`](../../apps/desktop/src/hooks/useDatasets.ts#L139)

- Rust tests cover trimming, immutability, invalid input, Default, cloud, and concurrency.
  [`datasets.rs:1591`](../../apps/desktop/src-tauri/src/datasets.rs#L1591)

- Picker tests cover persistence refresh, validation, cloud exclusion, and pending guards.
  [`picker.spec.ts:950`](../../apps/desktop/tests/picker.spec.ts#L950)
