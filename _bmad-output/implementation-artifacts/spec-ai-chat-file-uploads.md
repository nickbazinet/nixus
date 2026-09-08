---
title: 'AI chat file uploads'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: '205df1ef1ff76b18fb21f8af7f229bd2ab0827d5'
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/guidelines/warnings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AI chat accepts only typed text, so users cannot ask the assistant to interpret a document or use its contents when proposing financial changes.

**Approach:** Let the user attach one PDF, PNG/JPEG image, CSV, XLS/XLSX workbook, or plain-text file to a chat message. The attachment is ephemeral read-only model context; any resulting expense, budget, or other mutation continues through the existing explicit confirmation card.

## Boundaries & Constraints

**Always:** Accept at most one file per message; validate extension and a 4 MiB decoded-size ceiling before invoking AI; attach media to the newest user turn; support hosted and BYO Bedrock consistently; keep attachment bytes and names out of persistence, prompts, logs, and cloud telemetry; preserve streaming, conversation history, hosted-first routing, quota charging, fallback rules, and the existing confirmation flow; expose all UI copy in English and French.

**Ask First:** Supporting additional formats, persisting attachment metadata, raising the size ceiling, or changing attachment availability in the floating chat bar.

**Never:** Auto-execute a write inferred from a file; store or log file contents, paths, or names; add OpenAI chat attachment support; add token preflight/`CountTokens`; change statement-import behavior or cloud quota semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Supported attachment | One allowed file plus a message | Selected file is shown locally, sent with the newest user turn, and readable by the AI | N/A |
| File-driven action | Attachment contains expenses or budget data | AI proposes the normal confirmation card; nothing changes until Confirm | Existing inline action errors remain unchanged |
| Invalid file | Unsupported extension, empty file, or file over 4 MiB | Message is not sent and attachment can be replaced or removed | Localized inline validation error; no AI request/quota charge |
| Picker cancelled | User closes the native picker | Draft message remains unchanged | No error |
| Tool round-trip | Attached turn triggers an AI tool call | The attachment remains available on the post-tool invocation | Normal committed/fallback rules apply independently |
| Reopened conversation | User later reloads the conversation | Text response/history remains; attachment bytes and filename are absent | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/routes/ai.$agentId.tsx` -- full-chat composer; add attach/remove UI beside the existing input, not the floating bar.
- `apps/desktop/src/components/import/UploadZone.tsx` -- reuse native dialog/filter and validation interaction patterns; do not reuse import-specific commands.
- `apps/desktop/src/hooks/useChat.ts` -- carry one ephemeral attachment through `sendMessage` while preserving `confirmAction`/`cancelAction`.
- `apps/desktop/src-tauri/src/commands/chat.rs` -- validate/read the selected path without exposing it, then pass typed bytes through both model invocations.
- `apps/desktop/src-tauri/src/ai/{backend,chat,hosted_bedrock}.rs` -- extend `AiAttachment` with document format and associate it with the newest user turn; existing code currently hardcodes PDF and turn zero.
- `packages/shared/src/types/cloud-ai.ts` -- widen the closed document-format contract to `pdf|csv|txt|xls|xlsx`.
- `apps/api-bedrock/src/lib/{validation,bedrock-client}.ts` -- permit one media block on the latest chat user message and pass supported Bedrock formats through; retain the 4 MiB media boundary.
- `apps/desktop/src/locales/{en,fr}.json` -- attachment labels and validation messages with locale parity.
- `apps/desktop/tests/chat.spec.ts` -- picker, removal, validation, send payload, and confirmation-flow coverage using existing Tauri mocks.
- `apps/desktop/src-tauri/src/ai/hosted_e2e.rs` and `apps/api-bedrock/src/**/*.test.ts` -- contract, shape, privacy, and hosted round-trip regression coverage.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/types/cloud-ai.ts`, `apps/api-bedrock/src/lib/validation.ts`, `apps/api-bedrock/src/lib/bedrock-client.ts` -- extend and validate the cross-package chat attachment contract without weakening privacy or quota boundaries.
- [x] `apps/desktop/src-tauri/src/ai/backend.rs`, `chat.rs`, `hosted_bedrock.rs`, `commands/chat.rs` -- validate, read, format, and route one ephemeral attachment on the newest user turn across initial and tool-loop invocations.
- [x] `apps/desktop/src/hooks/useChat.ts`, `apps/desktop/src/routes/ai.$agentId.tsx`, locale files -- implement accessible native selection, selected-file display/removal, localized errors, and send-state cleanup.
- [x] Existing desktop Rust, API, shared-contract, and Playwright test suites -- cover every matrix row plus no-name/no-content logging guards.

**Acceptance Criteria:**
- Given any supported file up to 4 MiB, when it is sent with a chat prompt, then hosted or BYO Bedrock receives exactly one correctly formatted attachment on the newest user turn and the AI can answer from it.
- Given an attached file leads the AI to propose a financial mutation, when the response renders, then the existing confirmation card is required before any database change.
- Given a conversation containing an attachment is reopened, when history loads, then no attachment bytes, path, or filename were persisted while the textual conversation remains usable.
- Given the feature is complete, when desktop and API quality gates run, then TypeScript/Rust compile without warnings and all affected unit, contract, hosted E2E, and Playwright tests pass.

## Spec Change Log

## Design Notes

Bedrock Converse already supports the required document formats, so format-aware content blocks are preferable to local extraction. Use a fixed neutral provider document name such as `attachment`; the UI may show the selected basename only in volatile React state. Re-send the attachment for the post-tool invocation because each invocation is routed independently and still needs the source context.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero errors or warnings.
- `pnpm --filter @nixus/desktop test` -- expected: all desktop unit tests pass.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: all desktop user flows pass.
- `pnpm --filter @nixus/api-bedrock lint && pnpm --filter @nixus/api-bedrock typecheck && pnpm --filter @nixus/api-bedrock test` -- expected: all API checks pass.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -- expected: all Rust tests pass with no warnings.

## Suggested Review Order

**Chat entry and UI state**

- Shared send boundary connects starter prompts, composer state, and ephemeral attachments.
  [`ai.$agentId.tsx:75`](../../apps/desktop/src/routes/ai.$agentId.tsx#L75)

- Composer renders selection, truncation, localized errors, and accessible retry behavior.
  [`ChatComposer.tsx:35`](../../apps/desktop/src/components/chat/ChatComposer.tsx#L35)

- Picker hook serializes one race-safe native selection without persisting metadata.
  [`useChatAttachment.ts:53`](../../apps/desktop/src/hooks/useChatAttachment.ts#L53)

- Chat hook carries the optional path while preserving write-action confirmation.
  [`useChat.ts:158`](../../apps/desktop/src/hooks/useChat.ts#L158)

**Local file and AI boundaries**

- Command validates before persistence, then reuses bytes across the tool round-trip.
  [`chat.rs:222`](../../apps/desktop/src-tauri/src/commands/chat.rs#L222)

- Attachment boundary enforces formats, non-empty content, and the four-mebibyte ceiling.
  [`attachment.rs:61`](../../apps/desktop/src-tauri/src/ai/attachment.rs#L61)

- Provider port preserves operation rules and attaches media to the newest user turn.
  [`backend.rs:49`](../../apps/desktop/src-tauri/src/ai/backend.rs#L49)

- Hosted adapter emits the same typed media shape as BYO Bedrock.
  [`hosted_bedrock.rs:198`](../../apps/desktop/src-tauri/src/ai/hosted_bedrock.rs#L198)

**Hosted contract and validation**

- Shared wire type exposes only Bedrock formats approved for this feature.
  [`cloud-ai.ts:15`](../../packages/shared/src/types/cloud-ai.ts#L15)

- Lambda validation restricts formats per operation and media to the newest chat turn.
  [`validation.ts:53`](../../apps/api-bedrock/src/lib/validation.ts#L53)

- Bedrock translation forwards the validated format and operation-specific neutral name.
  [`bedrock-client.ts:82`](../../apps/api-bedrock/src/lib/bedrock-client.ts#L82)

**Verification**

- Browser coverage exercises selection, errors, confirmation, recovery, and privacy behavior.
  [`chat.spec.ts:661`](../../apps/desktop/tests/chat.spec.ts#L661)

- Hosted integration proves the desktop wire body survives a real HTTP round-trip.
  [`hosted_e2e.rs:959`](../../apps/desktop/src-tauri/src/ai/hosted_e2e.rs#L959)

- API contract tests cover every supported format, position, and media-size boundary.
  [`validation.test.ts:610`](../../apps/api-bedrock/src/lib/validation.test.ts#L610)
