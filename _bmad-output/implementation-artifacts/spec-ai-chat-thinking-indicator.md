---
title: 'AI chat thinking indicator'
type: 'feature' # feature | bugfix | refactor | chore
created: '2026-07-26'
status: 'done'
context: []
route: 'one-shot'
---

# AI chat thinking indicator

## Intent

**Problem:** When the AI assistant is generating a response, there's a gap between the user sending a message and the first token/tool-call arriving where the assistant's chat bubble renders empty content — giving no visual feedback that the AI is working.

**Approach:** Render an animated 3-dot "thinking" indicator (reusing the existing bounce animation utility) inside `ChatMessageBubble` whenever the assistant message is streaming but has no content yet, matching the visual pattern already used for the "searching" tool-call indicator.

## Suggested Review Order

1. [`ChatMessageBubble.tsx`](../../apps/desktop/src/components/chat/ChatMessageBubble.tsx#L46) — core logic: new `isThinking` condition and the 3-dot indicator markup.
2. [`en.json`](../../apps/desktop/src/locales/en.json) / [`fr.json`](../../apps/desktop/src/locales/fr.json) — new `chat.thinking` translation key (aria-label only).
