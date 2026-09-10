---
title: 'Edit and delete maintenance service history entries'
type: 'feature'
created: '2026-09-09'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture-car-maintenance.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Maintenance service history is currently read-only, so incorrect dates, odometer readings, notes, or accidental entries cannot be corrected from the car module.

**Approach:** Add accessible row actions that open a pre-filled edit form or an explicit destructive confirmation, backed by audited Tauri update/delete commands. Preserve every existing history column, service-logging flow, file, and unrelated behavior.

## Boundaries & Constraints

**Always:** Keep all existing files and functionality; retain Date, Task, Odometer, and Notes in the list; support scheduled and custom service entries; validate edits with the same date/odometer rules as creation; audit every update/delete; keep vehicle odometer non-decreasing; recompute a scheduled task's last-service anchors from its newest remaining log after update/delete; provide EN/FR copy; require confirmation before deletion.

**Ask First:** Any schema migration, dependency addition, change to service/task identity, removal of existing behavior, or change that would lower a vehicle's current odometer.

**Never:** Perform git operations; delete or rename files; silently delete a service; expose raw task keys; put SQL in command handlers; mutate passive assets; remove existing tests or weaken assertions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Edit scheduled service | Valid date, integer odometer, optional notes | Row updates; task anchors reflect newest remaining log; vehicle odometer only advances | Inline validation or save-failed toast; original row remains |
| Edit custom service | Valid service name/date/odometer/notes | Name and fields update without changing managed-task anchors | Same validation as custom-service creation |
| Delete service | User confirms an existing row | Only that log is removed; scheduled-task anchors are recomputed; success toast appears | Missing log returns typed error; list remains unchanged |
| Cancel delete | Dialog open | No command runs and row remains | N/A |
| Delete latest scheduled log | Older task log remains | Task anchors fall back to newest remaining task log | Transaction rolls back on failure |
| Delete only scheduled log | No task log remains | Task anchors become null without lowering vehicle odometer | Transaction rolls back on failure |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/maintenance/ServiceHistoryTable.tsx:48-155` -- Preserve current four columns/pagination; add per-row edit/delete controls, overlays, and stable test IDs.
- `apps/desktop/src/components/maintenance/LogCustomServiceForm.tsx:24-116` and `LogServiceForm.tsx` -- Reuse field shape, parsing, validation, DatePicker, and form feedback in a focused edit form.
- `apps/desktop/src/components/expenses/ExpenseList.tsx` -- Golden pattern for contextual row actions, SlideOver editing, and destructive confirmation.
- `apps/desktop/src/hooks/useServiceHistory.ts` -- Owns history reads/mutations and refreshes maintenance history, vehicle, and maintenance caches.
- `apps/desktop/src/lib/types.ts:591-642` -- Add IPC update input/result shapes without changing existing service models.
- `apps/desktop/src-tauri/src/models/mod.rs` -- Mirror update input and response types with existing exact derives.
- `apps/desktop/src-tauri/src/db/maintenance.rs:558-652,891-1087` -- Reuse validation/lookup; add transactional update/delete and scheduled-task anchor recomputation. Preserve current create semantics.
- `apps/desktop/src-tauri/src/commands/maintenance.rs:197-288` -- Add thin audited commands; SQL remains in db layer.
- `apps/desktop/src-tauri/src/lib.rs:305-320` -- Register new Tauri commands without changing existing registrations.
- `apps/desktop/src/locales/en.json`, `apps/desktop/src/locales/fr.json` -- Add parity-checked labels, descriptions, confirmations, and toasts.
- `apps/desktop/tests/maintenance.spec.ts:738-938,1747-1815` -- Extend the IPC mock and cover edit, confirm-delete, cancel, and visible persisted outcomes.
- `apps/desktop/src-tauri/src/db/maintenance.rs` test module -- Lock transaction, validation, fallback-anchor, and non-decreasing-odometer behavior before implementation.
- `_bmad-output/implementation-artifacts/17-4-service-history-view.md:25-27,106-112` -- Historical append-only constraint intentionally superseded by this user-requested feature; all read/display behavior remains.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src-tauri/src/db/maintenance.rs` -- Add failing unit tests, then transactional update/delete with anchor recomputation -- preserve schedule correctness after history mutations.
- [x] `apps/desktop/src-tauri/src/models/mod.rs`, `commands/maintenance.rs`, `lib.rs` -- Add typed audited IPC surface and registration -- expose mutations safely without altering existing commands.
- [x] `apps/desktop/src/lib/types.ts`, `hooks/useServiceHistory.ts` -- Add strict frontend types and query-coherent mutations -- refresh every affected car view.
- [x] `apps/desktop/tests/maintenance.spec.ts` -- Add failing user-flow scenarios and mock commands before UI code -- prove persistence, confirmation, and cancellation.
- [x] `apps/desktop/src/components/maintenance/EditServiceLogForm.tsx`, `DeleteServiceLogDialog.tsx`, `ServiceHistoryTable.tsx` -- Add pre-filled edit SlideOver and per-row delete confirmation while preserving current table content.
- [x] `apps/desktop/src/locales/en.json`, `fr.json` -- Add matching localized strings -- keep locale parity.

**Acceptance Criteria:**
- Given any scheduled or custom history row, when Edit is activated, then a keyboard-accessible pre-filled form saves valid changes and the refreshed row shows them.
- Given a history row, when Delete is activated, then a dialog identifies the service and deletion occurs only after explicit confirmation.
- Given deletion is cancelled, when the dialog closes, then the row and all existing data remain unchanged.
- Given a latest scheduled service is edited or deleted, when maintenance status refreshes, then task anchors derive from the newest remaining scheduled log while vehicle odometer never decreases.
- Given existing car workflows and history display, when the feature ships, then all prior tests and the four existing history columns still pass unchanged.

## Design Notes

Use the established Linear-style contextual-action pattern: compact icon buttons appear in the row action area with visible focus states and translated accessible labels. Editing uses the existing SlideOver form language; deletion uses the existing destructive Dialog pattern. Do not make the whole row clickable or replace any displayed data.

## Verification

**Commands:**
- `cargo test` in `apps/desktop/src-tauri` -- expected: all Rust tests pass with zero warnings.
- `pnpm --filter @nixus/desktop test` -- expected: locale parity and hook/unit tests pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero TypeScript errors.
- `pnpm --filter @nixus/desktop exec playwright test tests/maintenance.spec.ts` -- expected: maintenance flows pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop E2E suite passes.
- `pnpm --filter @nixus/desktop build` -- expected: production frontend build exits 0.

**Manual checks (if no CLI):**
- Drive edit, delete-confirm, and delete-cancel in a real browser at desktop and narrow widths; verify focus, labels, overlays, preserved columns, and no console errors.

## Suggested Review Order

**User interaction**

- Start with the history list, row controls, and overlay orchestration.
  [`ServiceHistoryTable.tsx:129`](../../apps/desktop/src/components/maintenance/ServiceHistoryTable.tsx#L129)

- Review prefilled editing, validation, pending-state protection, and failure feedback.
  [`EditServiceLogForm.tsx:34`](../../apps/desktop/src/components/maintenance/EditServiceLogForm.tsx#L34)

- Review destructive confirmation, custom-entry copy, and delete failure behavior.
  [`DeleteServiceLogDialog.tsx:22`](../../apps/desktop/src/components/maintenance/DeleteServiceLogDialog.tsx#L22)

**Persistence and audit**

- Inspect transactional update/delete and scheduled-task anchor recomputation.
  [`maintenance.rs:1087`](../../apps/desktop/src-tauri/src/db/maintenance.rs#L1087)

- Inspect audited command helpers and odometer companion audit rows.
  [`maintenance.rs:289`](../../apps/desktop/src-tauri/src/commands/maintenance.rs#L289)

- Confirm Tauri command registration remains additive.
  [`lib.rs:305`](../../apps/desktop/src-tauri/src/lib.rs#L305)

**Frontend state and contracts**

- Review mutation cache refresh and fallback invalidation behavior.
  [`useServiceHistory.ts:24`](../../apps/desktop/src/hooks/useServiceHistory.ts#L24)

- Review locale-safe short and full service-date formatting.
  [`serviceHistoryDates.ts:1`](../../apps/desktop/src/lib/serviceHistoryDates.ts#L1)

- Confirm IPC input/result types mirror Rust models.
  [`types.ts:644`](../../apps/desktop/src/lib/types.ts#L644)

**Verification**

- Review edit/delete success, cancellation, failure, anchoring, and accessibility scenarios.
  [`maintenance.spec.ts:1981`](../../apps/desktop/tests/maintenance.spec.ts#L1981)

- Review deterministic ordering and rollback database tests.
  [`maintenance.rs:2520`](../../apps/desktop/src-tauri/src/db/maintenance.rs#L2520)

- Review command-level audit assertions for update, delete, and odometer changes.
  [`maintenance.rs:440`](../../apps/desktop/src-tauri/src/commands/maintenance.rs#L440)
