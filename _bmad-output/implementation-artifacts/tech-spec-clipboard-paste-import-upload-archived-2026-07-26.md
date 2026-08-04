---
title: 'Clipboard Paste for Import Upload'
slug: 'clipboard-paste-import-upload'
created: '2026-07-26'
status: 'in-progress'
stepsCompleted: [1, 2]
tech_stack:
  - 'React 19 + TypeScript (apps/desktop)'
  - 'Tauri 2 (invoke snake_case, AppError)'
  - 'i18next (en.json + fr.json flat keys)'
  - 'Playwright E2E (apps/desktop/tests)'
  - 'tempfile crate (Rust; tests today, usable for paste temps)'
files_to_modify:
  - 'apps/desktop/src/components/import/UploadZone.tsx'
  - 'apps/desktop/src/routes/import.tsx'
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
- Dashboard last-expense work (separate archived WIP)
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
| `apps/desktop/src/routes/import.tsx` | Page-level paste when `status === "idle"` (Cmd/Ctrl+V anywhere on Import) |
| `apps/desktop/src-tauri/src/commands/import.rs` | Add write-temp-from-bytes command; keep `validate_cc_file` / `import_cc_statement` |
| `apps/desktop/src-tauri/src/lib.rs` | Register new command |
| `apps/desktop/src/hooks/useImport.ts` | Unchanged path consumer (`startImport(file_path)`) |
| `apps/desktop/src/components/onboarding/OnboardingImportStep.tsx` | Redirect-only; no code change unless we later embed zone |
| `apps/desktop/src/locales/en.json` / `fr.json` | Paste hint + non-image/empty clipboard error keys |
| `apps/desktop/tests/import.spec.ts` | Playwright mocks + paste E2E |
| `docs/project-context.md` | IPC snake_case, i18n both locales, Playwright-only desktop tests |

### Technical Decisions

- **Paste acquisition:** Web `paste` / `ClipboardEvent.clipboardData` image items (no new clipboard plugin).
- **Bridge:** New Tauri command (e.g. `save_import_clipboard_image`) accepts image bytes + extension, writes under `{app_data_dir}/imports/` (or NamedTempFile), returns path; then call existing `validate_cc_file`.
- **Page-level paste:** Listen on Import page (window/document) while upload idle; forward image payload into shared paste handler used by `UploadZone`.
- **Images only:** If clipboard has no image item → inline error (new i18n key). Do not attempt PDF-from-clipboard.
- **UX copy:** Extend secondary line under drop/browse to include “or paste a screenshot” (EN+FR).
- **Cleanup:** Prefer deleting temp paste file after successful import start or on reset (avoid `app_data_dir` buildup); document in Step 3 tasks.
- **Types:** Optionally move `FileValidationResult` to `lib/types.ts` (today duplicated in UploadZone) — nice-to-have, not required.
- **Non-overlap:** Do not touch dashboard / last-expense surfaces (archived separate WIP).

## Implementation Plan

### Tasks

{tasks}

### Acceptance Criteria

{acceptance_criteria}

## Additional Context

### Dependencies

{dependencies}

### Testing Strategy

{testing_strategy}

### Notes

{notes}
