---
title: 'Upload and display a user profile picture'
type: 'feature'
created: '2026-09-10'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - 'docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signed-in desktop users can edit demographic profile fields, but their account affordance always shows the generic round `CircleUser` placeholder. They cannot personalize it with a picture.

**Approach:** Add a profile-page upload/replace control backed by a subject-scoped, bounded SQLite BLOB store. Render its downscaled round image in the profile page and as a larger 32 px account-menu avatar within a 40 px accessible trigger, retaining the existing placeholder when absent and the existing gold Premium treatment as a circular ring when entitled.

## Boundaries & Constraints

**Always:** Resolve the Cognito subject in Rust; keep avatar state independent of active financial datasets; prove PNG/JPEG from headers and enforce 4 MiB source, 12 MP decoded, 256 px derivative, and 64 KiB stored limits; move only a native-picker path into IPC and only the derivative base64 back; use EN/FR i18n and accessible controls; render the header image/placeholder at 32×32 px inside a minimum 40×40 px target without shifting adjacent navigation; preserve unrelated worktree changes.

**Ask First:** Any need for cloud sync, a different stored-image quality/size contract, a new dependency, or changes to dataset backup semantics.

**Never:** Accept `sub` from the frontend; store image files beside the database or bytes/base64 in profile JSON, logs, audit rows, list/auth responses, or dataset `nkbaz-finance.db`; add filesystem/asset-protocol capability; add avatar removal, cropping, or editing; run Git operations, commit, remove files, or alter unrelated dirty files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Upload | Valid PNG/JPEG selected on `/profile` | Validate, downscale, upsert for current subject, refresh both round renderings | Success feedback; no source retained |
| Replace | Subject already has an avatar | One-row upsert replaces prior derivative | Existing image remains if processing fails |
| Invalid image | Wrong header/extension, >4 MiB, >12 MP, or no ≤64 KiB derivative | No write; translated field-specific message | Page and prior avatar remain usable |
| No avatar | Authenticated subject has no row | Existing `CircleUser` placeholder remains | No error UI |
| Identity change | Sign-out or another subject signs in | Cached face is removed before new read | Never display the prior subject's image |
| Premium | Avatar exists and entitlement is active | 32 px image is round with a 2 px `--premium-ink` circular ring | Non-Premium image has no gold ring |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/projects/image.rs` -- reuse header inspection, source ceilings, and `thumbnail`; store returned MIME because conversion may occur.
- `apps/desktop/src-tauri/src/profile_store.rs` -- reuse validated subject/path boundary; `profiles/` recursive deletion must structurally remove `avatars.db`.
- `apps/desktop/src-tauri/src/datasets.rs` -- `global_root()` remains the only global path authority.
- `apps/desktop/src-tauri/src/commands/{auth,profile}.rs` -- resolve `current_subject()` before opening `profiles/avatars.db`; add lazy get/set commands without `DbState`.
- `apps/desktop/src-tauri/src/commands/backup.rs` -- read-only evidence: dataset backup copies only `nkbaz-finance.db`; avatar database must remain excluded.
- `apps/desktop/src/hooks/useProjectImagePicker.ts` -- extend the native picker/validator hook with profile-copy overrides rather than duplicating file access logic.
- `apps/desktop/src/components/auth/ProfileMenu.tsx` -- sole current placeholder; render avatar query result and existing entitlement-derived Premium ring.
- `apps/desktop/src/routes/profile.tsx` -- authenticated upload/replace surface; non-authenticated guards remain unchanged.
- `apps/desktop/tests/{profile,profile-isolation}.spec.ts` -- upload/render/ring and subject-isolation coverage; audit all always-mounted Tauri mocks for `get_user_avatar`.
- `_bmad-output/planning-artifacts/{architecture-user-profile,epics-user-profile}.md` -- profile-picture exclusion premise predates migrations 026/027 and is superseded only for this feature.

## Tasks & Acceptance

**Execution:**
- [ ] Rust tests first -- lock validation, named SQLite checks, upsert replacement, subject isolation, recursive wipe, and backup exclusion.
- [ ] `src-tauri/src/avatar_store.rs`, `models/mod.rs`, `commands/profile.rs`, `lib.rs` -- create/open `profiles/avatars.db` with `user_avatars(cognito_sub PRIMARY KEY, image_bytes, mime_type, uploaded_at)` and named payload/MIME checks; add `get_user_avatar` and `set_user_avatar`.
- [ ] `src-tauri/src/projects/image.rs` -- expose only the existing reusable read/thumbnail seam needed by avatar commands; do not fork validation logic.
- [ ] `src/lib/{types,constants,appError}.ts`, `src/hooks/{useProfile,useProjectImagePicker,useAuth}.ts` -- typed avatar query/mutation, profile-specific errors, and identity-change cache removal.
- [ ] `src/routes/profile.tsx`, `src/components/auth/ProfileMenu.tsx`, locale files/tests -- add accessible upload/replace UI and round avatar/placeholder rendering with Premium ring.
- [ ] Desktop Playwright mocks/specs -- support the new always-mounted read command and prove upload, replacement, fallback, Premium styling, and account isolation.

**Acceptance Criteria:**
- Given a signed-in user selects a valid image, when processing succeeds, then their round avatar replaces the placeholder on `/profile` and in the account trigger and survives restart.
- Given the account trigger renders, when viewed in the desktop shell, then its avatar or placeholder is 32×32 px within a minimum 40×40 px target and does not disturb header alignment.
- Given that user is Premium, when the avatar renders, then a 2 px round border/ring resolves to `--premium-ink`; otherwise no gold ring is shown.
- Given no avatar, invalid input, sign-out, or a subject switch, when the shell renders, then the correct placeholder/prior safe state appears and no other subject's image flashes.
- Given backup, dataset switch/delete, or delete-all operations, when completed, then avatar data is excluded from dataset backups, unaffected by dataset lifecycle, and removed by delete-all.

## Spec Change Log

## Design Notes

Use `global_root/profiles/avatars.db`, opened per command without WAL or dataset migrations. Store only the 256 px/64 KiB derivative: it is sufficient for the profile control and enlarged 32 px shell avatar, avoids retaining a write-only source, and keeps the lazy shell payload bounded. Use a 2 px ring that does not reduce the visible image size. The prior architecture's “no image convention” premise is obsolete after project-image migrations 026/027; its subject-scoping, backup, and wipe invariants remain binding.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- zero errors or warnings.
- `pnpm --filter @nixus/desktop test` -- Rust-adjacent frontend/unit and locale contracts pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- avatar store/command and regression tests pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- full desktop E2E suite passes.
- `pnpm --filter @nixus/desktop build` -- production desktop frontend builds.

**Manual checks (if no CLI):**
- Drive `/profile` in Chromium at desktop width: upload and replace a PNG/JPEG, inspect round rendering/focus/alt text, verify Premium and non-Premium rings, then switch identity and confirm no stale face.
