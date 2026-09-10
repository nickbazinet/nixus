---
title: 'Format Desktop Update Release Notes'
type: 'bugfix'
created: '2026-09-10'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c219b0365266cb378c49f78732abf39d765a6d00'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The desktop “Update available” dialog prints GitHub release-note Markdown literally, exposing syntax such as `###`, `**scope:**`, and list dashes instead of presenting a readable changelog.

**Approach:** Render the updater-provided body as styled Markdown using the app’s existing `react-markdown` and `remark-gfm` stack, while preserving dialog accessibility, scrolling, fallback copy, and update actions.

## Boundaries & Constraints

**Always:** Preserve the existing consent flow, version title, bounded scrolling, fallback text when the release body is empty, light/dark theme tokens, and valid dialog description semantics. Reuse installed Markdown dependencies and established Nixus typography/spacing classes.

**Ask First:** Any change to release-note generation, updater metadata, dialog actions, or the shared dialog primitive.

**Never:** Render release notes with `dangerouslySetInnerHTML`, add a Markdown dependency, duplicate the full chat renderer, broaden this into an updater redesign, or nest block-level Markdown output inside the paragraph element produced by `DialogDescription`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Generated release notes | `### Features\n\n- **ai:** Improve imports` | Semantic heading, list item, and bold scope render without visible Markdown delimiters | N/A |
| Plain release body | Text without Markdown syntax | Readable body text renders in the same scroll region | N/A |
| Empty release body | Missing or empty `update.body` | Existing localized `update.newVersion` fallback remains visible | N/A |
| Long release body | Content exceeds the dialog body limit | Notes scroll inside the existing bounded region; footer actions remain visible | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/components/shared/UpdateChecker.tsx:82-96` -- Fix site. It currently interpolates `update.body` directly inside `DialogDescription`, whose `whitespace-pre-wrap` styling preserves the raw syntax.
- `apps/desktop/src/components/chat/ChatMessageBubble.tsx:3-16,225-287` -- Proven `ReactMarkdown` + `remark-gfm` configuration and token-based element styling; reuse only the changelog-relevant subset and retain `singleTilde: false`.
- `packages/shared/src/ui/dialog.tsx:138-151` -- `DialogDescription` accessibility wrapper; treat as read-only unless human-approved because its underlying primitive renders a paragraph.
- `scripts/generate-release-notes.mjs:59-90` -- Read-only evidence: release bodies intentionally contain GFM headings, bullets, and bold scopes.
- `apps/desktop/tests/update-checker.spec.ts` -- New focused Playwright regression spec using the existing Tauri invoke-stub convention to return updater metadata and assert semantic rendered output.
- `apps/desktop/tests/chat.spec.ts:136-151` -- Reference mock precedence: updater checks normally resolve `null` so unrelated suites do not open the modal.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/tests/update-checker.spec.ts` -- Add a failing-first updater-dialog scenario with generated-release-note Markdown, plain text, empty-body fallback, and long-content scrolling.
- [x] `apps/desktop/src/components/shared/UpdateChecker.tsx` -- Render the body with the existing Markdown stack and a small token-based component map in a valid block container while retaining an accessible dialog description.

**Acceptance Criteria:**
- Given an available update with generated GitHub release notes, when the dialog opens, then headings, list items, and bold scopes are semantic styled elements and Markdown delimiters are not shown.
- Given the rendered Markdown contains block elements, when the dialog DOM is inspected, then no invalid paragraph nesting or dialog description accessibility regression is present.
- Given release notes are long, when the user scrolls them, then the title and update controls remain usable and visible.
- Given the user selects “Not now” or “Update & restart,” when the dialog is formatted, then both existing actions behave unchanged.

## Spec Change Log

## Design Notes

Keep the current dialog composition and calm visual hierarchy. Use a compact subset of the chat Markdown renderer for headings, paragraphs, strong text, unordered/ordered lists, list items, inline code, and links; the updater does not need chat-specific tables, action cards, streaming behavior, or financial-number styling.

## Verification

**Commands:**
- `pnpm --filter @nixus/desktop exec playwright test tests/update-checker.spec.ts` -- expected: focused regression scenarios pass.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- expected: zero type errors or warnings.
- `pnpm --filter @nixus/desktop exec playwright test` -- expected: full desktop E2E suite passes.
- `pnpm --filter @nixus/desktop build` -- expected: production frontend build succeeds.

**Manual checks:**
- Open the mocked update dialog in Chromium and verify formatted hierarchy, scrolling, focus behavior, and both actions at desktop viewport size.

## Suggested Review Order

**Rendering and accessibility**

- Start at the updater boundary: normalized input, semantic Markdown, responsive scrolling, and focus.
  [`UpdateChecker.tsx:97`](../../apps/desktop/src/components/shared/UpdateChecker.tsx#L97)

- Review the constrained element map and heading hierarchy used for release notes.
  [`UpdateChecker.tsx:165`](../../apps/desktop/src/components/shared/UpdateChecker.tsx#L165)

**Regression coverage**

- Confirm generated Markdown, fallbacks, wrapping, and heading normalization are locked.
  [`update-checker.spec.ts:90`](../../apps/desktop/tests/update-checker.spec.ts#L90)

- Verify keyboard scrolling, dialog semantics, dismissal, progress, and relaunch behavior.
  [`update-checker.spec.ts:149`](../../apps/desktop/tests/update-checker.spec.ts#L149)
