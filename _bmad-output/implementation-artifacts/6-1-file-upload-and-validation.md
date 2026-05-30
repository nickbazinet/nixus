# Story 6.1: File Upload and Validation

Status: review

## Story
As a user, I want to upload a credit card statement as a screenshot or PDF, So that I can begin the automated import process.

## Acceptance Criteria

**AC1: Upload zone renders on Import page**
Given the user navigates to the Import page or clicks "Import Statement" on the dashboard
When the Import page loads
Then a large drag-and-drop upload zone is displayed, centered in content
And the zone accepts PNG, JPG, and PDF files

**AC2: Native file dialog opens on click**
Given the user clicks the upload zone
When the file dialog triggers
Then the native Tauri file dialog (`dialog.open()`) opens, filtered to images (PNG, JPG) and PDFs
And the user can select a single file

**AC3: Drag-and-drop support**
Given the user drags a file onto the upload zone
When the file is dropped
Then the file is accepted and submitted for validation
And the upload zone shows a visual hover state during drag-over

**AC4: File type validation in Rust backend**
Given the user selects or drops a file
When the file is submitted to the Rust backend
Then the backend validates the file type is one of: PNG, JPG/JPEG, PDF
And invalid file types return an error with message "Only images and PDFs supported"
And the inline error displays below the upload zone (no modal, no page navigation)

**AC5: File size validation in Rust backend**
Given the user submits a valid file type
When the backend checks the file size
Then files exceeding the size limit are rejected with an appropriate inline error message
And valid files proceed to the next step (AI pipeline, implemented in Story 6.2)

**AC6: Upload preview for valid files**
Given a valid file passes type and size validation
When the validation succeeds
Then the file name is displayed confirming the selection
And the UI transitions to the progress stepper (ImportProgressStepper placeholder until Story 6.2 wires AI)

## Tasks / Subtasks

### Task 1: Create Import page route and layout [AC1]
- [x] Add `src/routes/import.tsx` route with TanStack Router
- [x] Create the Import page layout with centered upload zone
- [x] Add "Import" entry to sidebar navigation if not already present

### Task 2: Build upload zone component [AC1, AC2, AC3]
- [x] Create a drag-and-drop upload zone component in `src/components/import/`
- [x] Implement click handler that calls Tauri `dialog.open()` with file filters for PNG, JPG, PDF
- [x] Implement drag-and-drop event handlers (dragover, dragleave, drop)
- [x] Add visual hover state during drag-over
- [x] Style per UX spec: large area, centered in content

### Task 3: Implement file validation Tauri command [AC4, AC5]
- [x] Create `commands/import.rs` with a `validate_cc_file` (or `import_cc_statement`) Tauri command
- [x] Validate file extension and MIME type: allow PNG, JPG/JPEG, PDF only
- [x] Validate file size against a reasonable limit (e.g., 20MB)
- [x] Return typed errors via `AppError::File` for invalid type or size
- [x] Register the command in `main.rs`

### Task 4: Wire frontend to backend validation [AC4, AC5, AC6]
- [x] Call the Tauri command from the frontend after file selection
- [x] Display inline error below upload zone for invalid files
- [x] On success, display file name and transition UI to a "ready" or progress state
- [x] Use TanStack Query mutation or direct invoke for the validation call

### Task 5: Write Playwright tests [AC1, AC2, AC4]
- [x] Add tests to `tests/import.spec.ts`:
  - [x] Import page displays a drag-and-drop upload zone centered in content
  - [x] Clicking the upload zone triggers a file selection interaction
  - [x] Uploading an invalid file type shows inline error "Only images and PDFs supported"
  - [x] All tests pass via `npx playwright test tests/import.spec.ts`

## Dev Notes

### Architecture
- This story covers file upload and validation ONLY. No AI parsing, no Bedrock calls, no progress streaming. Those are Story 6.2.
- The Tauri command receives a file path (from `dialog.open()`) and validates it on the Rust side. The file is not read into memory for AI processing yet.
- Use `dialog.open()` from `@tauri-apps/plugin-dialog` for the native file picker. Configure file filters: `[{ name: 'CC Statement', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }]`.
- Validation happens in the Rust backend per architecture (NFR8): type validation by file extension/magic bytes, size validation by file metadata.

### IPC Pattern
- Use a Tauri **command** (request/response) for file validation: `validate_cc_file` or `import_cc_statement`.
- Command returns `Result<FileValidationResult, AppError>` where `AppError::File` covers type/size errors.
- This is NOT an event-based flow. Events (`import:progress`, etc.) are introduced in Story 6.2.

### Frontend Components
- Upload zone component goes in `src/components/import/` (e.g., `UploadZone.tsx`)
- Import page route at `src/routes/import.tsx`
- Error display: inline below the upload zone, not modal. Matches UX spec error pattern.

### Error Types
- `AppError::File { message }` for "Only images and PDFs supported" (wrong type)
- `AppError::File { message }` for file too large
- Errors render as inline text below the upload zone per UX-DR16 pattern

### Scope Boundaries
- IN SCOPE: Import page, upload zone UI, native file dialog, drag-and-drop, Rust file validation (type + size), inline error display, file name preview on success
- OUT OF SCOPE: AI extraction (Story 6.2), progress streaming (Story 6.2), transaction review (Story 6.3), ImportProgressStepper wiring (Story 6.2), confirm/save flow (Story 6.3)

### Project Structure Notes

**Frontend files to create/modify:**
- `src/routes/import.tsx` -- Import page route
- `src/components/import/UploadZone.tsx` -- Drag-and-drop upload zone component

**Backend files to create/modify:**
- `src-tauri/src/commands/import.rs` -- `validate_cc_file` Tauri command
- `src-tauri/src/commands/mod.rs` -- Export new command
- `src-tauri/src/main.rs` -- Register new command

**Test files:**
- `tests/import.spec.ts` -- Playwright E2E tests for upload and validation

### References
- Architecture: `_bmad-output/planning-artifacts/architecture.md` -- IPC command pattern, file validation (NFR8), error types, project structure
- UX Spec: `_bmad-output/planning-artifacts/ux-design-specification.md` -- Upload zone design (Journey 2), inline error pattern, drag-and-drop UX
- Epics: `_bmad-output/planning-artifacts/epics.md` -- Story 6.1 acceptance criteria, FR5

## Dev Agent Record
### Agent Model Used
Claude Opus 4.6 (1M context)
### Debug Log References
- Rust compilation: clean, no warnings
- TypeScript: clean, no errors
- Playwright: 5/5 tests pass, 97/98 full suite (1 pre-existing dashboard skeleton failure)
### Completion Notes List
- Task 1: Import route and sidebar already existed from prior epics. Updated route to include centered UploadZone layout.
- Task 2: Created UploadZone.tsx with drag-and-drop, click-to-browse via @tauri-apps/plugin-dialog, visual hover state, and file name preview on success.
- Task 3: Created commands/import.rs with validate_cc_file command. Validates extension (png/jpg/jpeg/pdf) and size (20MB limit). Returns FileValidationResult or AppError::File.
- Task 4: UploadZone calls invoke("validate_cc_file") after file selection. Inline error displays below zone. On success, shows file name with checkmark icon.
- Task 5: 5 Playwright tests covering AC1 (upload zone visible), AC2 (clickable with role=button), AC4 (invalid file rejection, valid file acceptance).
### File List
- src/routes/import.tsx (modified)
- src/components/import/UploadZone.tsx (created)
- src-tauri/src/commands/import.rs (created)
- src-tauri/src/commands/mod.rs (modified)
- src-tauri/src/lib.rs (modified)
- src-tauri/capabilities/default.json (modified)
- src-tauri/Cargo.toml (modified - added tauri-plugin-dialog)
- package.json (modified - added @tauri-apps/plugin-dialog)
- tests/import.spec.ts (created)

### Change Log
- 2026-03-15: Story 6.1 implemented - file upload zone with Tauri dialog integration and Rust backend validation
