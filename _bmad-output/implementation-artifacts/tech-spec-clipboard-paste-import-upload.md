---
title: 'Clipboard Paste for Import Upload'
slug: 'clipboard-paste-import-upload'
created: '2026-07-26'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
working_path: '_bmad-output/implementation-artifacts/tech-spec-clipboard-paste-import-upload.md'
tech_stack:
  - 'React 19 + TypeScript (apps/desktop)'
  - 'Tauri 2 (invoke snake_case, AppError)'
  - 'i18next (en.json + fr.json flat keys)'
  - 'Playwright E2E (apps/desktop/tests)'
  - 'tempfile crate (Rust; tests today, usable for paste temps)'
files_to_modify:
  - 'apps/desktop/src/components/import/UploadZone.tsx'
  - 'apps/desktop/src-tauri/src/commands/import.rs'
  - 'apps/desktop/src-tauri/src/lib.rs'
  - 'apps/desktop/src/locales/en.json'
  - 'apps/desktop/src/locales/fr.json'
  - 'apps/desktop/tests/import.spec.ts'
code_patterns:
  - 'Path-based pipeline: validate_cc_file → startImport(file_path) → import_cc_statement → cc_parser reads disk'
  - 'UploadZone: dialog.open / drag-drop path → invoke validate_cc_file; errors under data-testid=upload-error'
  - 'OnboardingImportStep navigates to /import (no embedded UploadZone)'
  - 'No clipboard/fs Tauri plugins; write temp via new Rust command under app_data_dir'
  - 'i18n: all UI strings via t(); EN+FR parity required'
test_patterns:
  - 'Playwright only; setupTauriMock via window.__TAURI_INTERNALS__.invoke'
  - 'Mock validate_cc_file + new write-temp command; dispatch paste via page.evaluate'
  - 'assert upload-error / upload-zone-success / import-progress-stepper'
---

# Tech-Spec: Clipboard Paste for Import Upload

**Created:** 2026-07-26

## Overview

### Problem Statement

Import only accepts click-to-browse or drag-and-drop of filesystem files. After taking a screenshot, the user must save the image and re-select it before AI can categorize spending — unnecessary friction.

### Solution

Add clipboard paste support for image screenshots across import upload entry points, with clear “paste a screenshot” UX copy and the same inline validation errors used for invalid file types. Bridge clipboard image bytes into the existing validate/import pipeline via a Rust temp-file write command.

### Scope

**In Scope:**
- All import upload entry points (Import page `/import`, onboarding path into import, and any other shared `UploadZone` consumers)
- `Cmd/Ctrl+V` anywhere on the Import page while upload is idle (and equivalent paste handling on surfaces that host the upload zone)
- Image screenshots only (PNG/JPEG from clipboard)
- UX copy: “or paste a screenshot” alongside existing drop/browse text
- Empty clipboard / non-image paste → inline error under the zone (same pattern as invalid file type)
- Bridge clipboard bytes → existing `validate_cc_file` / `import_cc_statement` pipeline via temp file

**Out of Scope:**
- PDF / non-image clipboard contents
- Changes to AI categorization / extraction behavior
- Dashboard last-expense work (tracked separately in `tech-spec-dashboard-last-expense-line.md`)
- Web marketing app clipboard features
- Adding Tauri clipboard/fs plugins (prefer Rust command + web `paste` event)

## Context for Development

### Codebase Patterns

- **End-to-end path requirement:** `UploadZone` → `invoke("validate_cc_file", { file_path })` → `onValidated` → `startImport(file_path)` → `import_cc_statement` → `cc_parser` does `std::fs::read(file_path)`. Clipboard blobs have no path — must persist bytes first.
- **UploadZone today:** click → `@tauri-apps/plugin-dialog` `open()`; drop → `(file as File & { path?: string }).path`; missing path → `t("import.filePathError")`; errors in `data-testid="upload-error"`.
- **Import page:** `status === "idle"` renders `UploadZone`; paste listener should be active only in idle upload state so Cmd+V doesn’t fight review/error screens.
- **Onboarding:** `OnboardingImportStep` only navigates to `/import` — no second upload widget. Paste on Import covers onboarding.
- **No other upload surfaces:** Chat is text-only; no shared upload abstraction beyond `UploadZone`.
- **Plugins:** dialog/opener/updater/process only — **no clipboard or fs plugin**. Prefer new Rust IPC command over new plugins.
- **Writable dirs:** existing pattern `app.path().app_data_dir()` (backup, maintenance, lib setup). `tempfile` already in `Cargo.toml` (tests).
- **Validation rules to honor after write:** extensions `png|jpg|jpeg|pdf` (paste will only produce image), ≤ 20MB, `AppError::File` messages.
- **i18n:** flat keys in `apps/desktop/src/locales/{en,fr}.json`; update both. Existing: `import.dropHere`, `import.orClickToBrowse`, `import.filePathError`, etc.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/desktop/src/components/import/UploadZone.tsx` | Primary paste integration + UX copy; reuses `validateFile(path)` |
| `apps/desktop/src/routes/import.tsx` | Idle-only mounts `UploadZone` (page-level paste via window listener while mounted) |
| `apps/desktop/src-tauri/src/commands/import.rs` | Add write-temp-from-bytes command; keep `validate_cc_file` / `import_cc_statement` |
| `apps/desktop/src-tauri/src/lib.rs` | Register new command |
| `apps/desktop/src/hooks/useImport.ts` | Unchanged path consumer (`startImport(file_path)`) |
| `apps/desktop/src/components/onboarding/OnboardingImportStep.tsx` | Redirect-only; no code change required |
| `apps/desktop/src/locales/en.json` / `fr.json` | Paste hint + non-image/empty clipboard error keys |
| `apps/desktop/tests/import.spec.ts` | Playwright mocks + paste E2E |
| `docs/project-context.md` | IPC snake_case, i18n both locales, Playwright-only desktop tests |

### Technical Decisions

- **Paste acquisition:** Web `paste` / `ClipboardEvent.clipboardData` image items (no new clipboard plugin).
- **Bridge:** New Tauri command `save_import_clipboard_image` accepts image bytes (`Vec<u8>` / number array) + extension (`png` | `jpg` | `jpeg`), writes under `{app_data_dir}/imports/paste-{uuid}.{ext}`, returns `{ file_path: String }`, then frontend calls existing `validate_cc_file`.
- **Page-level paste:** Attach `window` `paste` listener inside `UploadZone` (cleanup on unmount). Because Import only mounts `UploadZone` when `status === "idle"`, Cmd/Ctrl+V works anywhere on the page during upload without fighting review/error screens. No `import.tsx` change required.
- **Images only:** Prefer `clipboardData.items` / `files` with `type` starting `image/`; map `image/png` → `png`, `image/jpeg` → `jpg`. No image → set inline error via `t("import.pasteNoImage")`. Ignore pure text pastes into inputs if any (none on idle upload UI today); still treat non-image paste on the page as the paste-no-image error when listener fires.
- **UX copy:** Update `import.orClickToBrowse` (or add sibling key) so secondary line includes paste hint, e.g. EN: `or click to browse / paste a screenshot. PNG, JPG, PDF accepted.` FR parity required.
- **Size guard:** Before invoke, if `blob.size > 20MB`, show same size-limit style error (reuse backend message after write+validate, or short-circuit client-side with i18n). Prefer let `validate_cc_file` enforce 20MB after write for one source of truth; Rust write command should also reject oversized payloads to avoid writing huge temps.
- **Cleanup:** Best-effort delete of `imports/paste-*` temps after `onValidated` succeeds and import has started, or leave files and add a note that temps may accumulate — prefer: Rust write with unique name; frontend does not delete mid-pipeline (parser still needs path); optional later cleanup command. For v1: write under `app_data_dir/imports/` and document known limitation (temps until manual cleanup / future GC). Do **not** block shipping on GC.
- **Non-overlap:** Do not touch dashboard / last-expense surfaces (`tech-spec-dashboard-last-expense-line.md`).
- **Command registration:** `#[tauri::command(rename_all = "snake_case")]`, return `Result<T, AppError>`, register in `lib.rs` invoke handler.

## Implementation Plan

### Tasks

- [x] Task 1: Add Rust command `save_import_clipboard_image`
  - File: `apps/desktop/src-tauri/src/commands/import.rs`
  - Action: Add command taking `app: AppHandle`, `bytes: Vec<u8>`, `extension: String`. Normalize extension to lowercase; allow only `png`, `jpg`, `jpeg`. Reject empty bytes and `bytes.len() > MAX_FILE_SIZE` (20MB) with `AppError::File`. Resolve `app.path().app_data_dir()`, ensure `imports/` subdir exists (`create_dir_all`), write `paste-{uuid}.{ext}` via `std::fs::write`, return `{ file_path: String }` (absolute path string). Follow existing `resolve_app_data_dir` / `AppError::File` patterns from `backup.rs` / `maintenance.rs`.
  - Notes: Add a small unit test for extension allowlist / empty bytes if easy without AppHandle; otherwise cover via E2E mock path.

- [x] Task 2: Register the new command
  - File: `apps/desktop/src-tauri/src/lib.rs`
  - Action: Register `commands::import::save_import_clipboard_image` next to `validate_cc_file` / `import_cc_statement`.

- [x] Task 3: Add i18n keys (EN + FR)
  - Files: `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json`
  - Action: Update `import.orClickToBrowse` to mention paste (or add `import.orPasteScreenshot` and compose in UI). Add `import.pasteNoImage` for empty/non-image clipboard (EN e.g. `Clipboard has no image to paste. Copy a screenshot first.` / FR equivalent). Keep flat key style.

- [x] Task 4: Implement clipboard paste in `UploadZone`
  - File: `apps/desktop/src/components/import/UploadZone.tsx`
  - Action:
    1. Add helper to extract first image `File`/`Blob` from `ClipboardEvent` (mime `image/png` | `image/jpeg` | `image/jpg`).
    2. On paste: if no image → `setError(t("import.pasteNoImage"))` and return; else `arrayBuffer()` → `Uint8Array` → `invoke("save_import_clipboard_image", { bytes: Array.from(...), extension })` → then existing `validateFile(result.file_path)`.
    3. Register `window` `paste` listener in `useEffect` while component mounted; `preventDefault` when handling an image paste; cleanup on unmount.
    4. Also wire `onPaste` on the zone div for redundancy.
    5. Update secondary copy to use updated i18n string(s).
    6. Reuse existing validating / error / success UI paths — do not fork the pipeline.
  - Notes: Avoid double-firing if both window and div handlers run — use a single shared `handlePaste` and only attach window listener (recommended) **or** guard with a ref. Prefer **window-only** listener for “anywhere on page.”

- [x] Task 5: Playwright coverage for paste
  - File: `apps/desktop/tests/import.spec.ts`
  - Action: Extend `setupTauriMock` with `save_import_clipboard_image` returning a fake path (e.g. `/tmp/pasted-statement.png`) that `validate_cc_file` accepts. Add tests:
    - Paste image → success path (validated file name / progress stepper as current happy path).
    - Paste without image → `upload-error` shows paste-no-image copy.
  - Notes: Use `page.evaluate` to dispatch a `ClipboardEvent`/`paste` with a synthetic image File (PNG blob), or call into mocked flow. Mirror existing `validate_cc_file` reject patterns. Update `import-duplicates.spec.ts` mock switch only if it shares the same invoke stub and would break on unknown commands.

- [x] Task 6: Smoke-check onboarding path (no code unless broken)
  - File: `apps/desktop/src/components/onboarding/OnboardingImportStep.tsx` (read-only verify)
  - Action: Confirm it still only navigates to `/import`. No change unless product later embeds `UploadZone` — then paste comes free via Task 4.

### Acceptance Criteria

- [x] AC1: Given the Import page is idle showing the upload zone, when the user presses Cmd/Ctrl+V with a PNG or JPEG screenshot on the clipboard, then the image is saved via `save_import_clipboard_image`, validated, and the existing import pipeline starts (same as browse/drop success).

- [x] AC2: Given the Import page is idle, when the user pastes with no image on the clipboard (empty or text-only), then an inline error appears under the upload zone (`data-testid="upload-error"`) with the paste-no-image message, and import does not start.

- [x] AC3: Given the upload zone is visible, when the user views the secondary hint text, then it mentions paste/screenshot in addition to browse (EN and FR).

- [x] AC4: Given Import is in processing, done, or error state (UploadZone unmounted), when the user presses Cmd/Ctrl+V, then paste does not start a new import or show upload-zone paste errors (listener unmounted).

- [x] AC5: Given a pasted image exceeds 20MB, when paste is processed, then the user sees an inline file-size error (from write command or `validate_cc_file`) and import does not start.

- [x] AC6: Given onboarding “Go to Import page”, when the user lands on `/import` and pastes a screenshot, then behavior matches AC1 (same UploadZone).

- [x] AC7: Given Playwright `import.spec.ts`, when the new paste tests run, then image-paste happy path and non-image error path pass with mocked Tauri commands.

## Additional Context

### Dependencies

- Existing Story 6.1/6.2 import pipeline (`validate_cc_file`, `import_cc_statement`, `useImport`) — no AI/parser changes.
- Tauri `AppHandle` path API (`app.path().app_data_dir()`) — already used elsewhere; no new plugins.
- Prefer zero new Rust deps for unique filenames (e.g. timestamp + random) if `uuid` is not already in `Cargo.toml`.

### Testing Strategy

- **Playwright (required):** Happy-path paste + non-image paste in `import.spec.ts` with mocked `save_import_clipboard_image` + `validate_cc_file`.
- **Rust:** Prefer light unit coverage for extension/size rejection on the write helper if extractable without full AppHandle; otherwise rely on E2E + manual.
- **Manual:** On real Tauri build — screenshot (macOS Cmd+Shift+4), open Import, Cmd+V, confirm AI pipeline starts; paste text and confirm inline error; navigate away from idle and confirm paste is inert.

### Notes

- **Risk:** Playwright clipboard fidelity is weak — prefer `page.evaluate` constructing a `File`/`DataTransfer` rather than OS clipboard.
- **Risk:** Double paste handling if both window and element listeners fire — use one listener.
- **Cleanup:** New paste writes clean prior `paste-*` files under `app_data_dir/imports/` before saving.
- **Limitation:** PDF-from-clipboard not supported (by design).
- **Parallel tracking:** Dashboard last-expense lives in `tech-spec-dashboard-last-expense-line.md` — do not merge or overwrite.

## Review Notes

- Adversarial review completed
- Findings: 15 total, 9 fixed (real), 6 skipped (noise/undecided)
- Resolution approach: auto-fix
- Fixed: F1 base64 IPC, F2 editable-target paste passthrough, F3 reentrancy guard, F4 temp cleanup, F5 unique filenames, F6 unsupported-format message, F7 client size guard, F8 Playwright assert invoke, F11 mountedRef unmount safety
- Skipped: F9, F10, F12, F13, F14, F15
