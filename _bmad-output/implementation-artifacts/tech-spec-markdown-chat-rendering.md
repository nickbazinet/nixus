---
title: 'Markdown rendering for AI chat messages'
type: 'feature'
created: '2026-03-30'
status: 'done'
baseline_commit: '9d81c707'
context: []
---

# Markdown rendering for AI chat messages

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AI chat responses contain markdown (headers, bold, italics, lists, code blocks) but `formatAiContent()` only parses tables and inline code. Raw symbols like `*` and `#` display verbatim instead of formatted text.

**Approach:** Install `react-markdown` with `remark-gfm` plugin and replace the custom `formatAiContent()` function with a `<ReactMarkdown>` component. Style output with scoped Tailwind classes on the wrapper. Preserve existing action-block and tool-call detection logic untouched.

## Boundaries & Constraints

**Always:** Preserve action payload detection (````action``` blocks), tool-call spinner detection (````tool_call``` blocks), and their rendering paths unchanged. Remove `whitespace-pre-wrap` from the markdown wrapper (ReactMarkdown handles its own spacing). Keep `parseActionFromContent` export stable.

**Ask First:** Adding `@tailwindcss/typography` prose plugin vs hand-styling with Tailwind utility classes.

**Never:** Modify the Rust backend or chat streaming logic. Add sanitization libraries (react-markdown uses an allowlist by default). Change user message rendering.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Headers | `# Title\n## Subtitle` | Rendered as styled h1, h2 elements | N/A |
| Bold/italic | `**bold** and *italic*` | Rendered with proper emphasis | N/A |
| Lists | `- item 1\n- item 2` | Rendered as `<ul><li>` elements | N/A |
| Code blocks | ````python\nprint("hi")\n```` | Rendered as styled `<pre><code>` block | N/A |
| Inline code | `` `variable` `` | Rendered as styled `<code>` inline | N/A |
| Tables (GFM) | Pipe-delimited markdown table | Rendered as styled `<table>` via remark-gfm | N/A |
| Action block | `````action\n{...}\n````` | Detected and rendered as confirmation card (unchanged) | N/A |
| Tool call | `````tool_call\n...\n````` | Detected and rendered as spinner (unchanged) | N/A |
| Plain text | `Hello, how can I help?` | Rendered as paragraph text | N/A |

</frozen-after-approval>

## Code Map

- `src/components/chat/ChatMessageBubble.tsx` -- Replace `formatAiContent()` and `parseMarkdownTable()` with ReactMarkdown; keep action/tool detection
- `package.json` -- Add `react-markdown`, `remark-gfm` dependencies

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- Install `react-markdown` and `remark-gfm`
- [ ] `src/components/chat/ChatMessageBubble.tsx` -- Import ReactMarkdown and remarkGfm. Replace the `formatAiContent()` call with `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{...}}>`. Remove `formatAiContent()` and `parseMarkdownTable()`. Style markdown elements via the `components` prop with Tailwind classes matching the chat bubble aesthetic.

**Acceptance Criteria:**
- Given an AI response with `# Title`, when displayed in chat, then a styled heading renders (no raw `#`)
- Given an AI response with `**bold**`, when displayed, then text renders bold (no raw `*`)
- Given an AI response with a markdown table, when displayed, then a styled table renders
- Given an AI response with an `action` code block, when displayed, then the confirmation card renders as before
- Given an AI response with a `tool_call` block, when displayed, then the spinner renders as before

## Verification

**Commands:**
- `npm run build` -- expected: no TypeScript or build errors
- `npx playwright test tests/chat.spec.ts` -- expected: all existing chat tests pass
