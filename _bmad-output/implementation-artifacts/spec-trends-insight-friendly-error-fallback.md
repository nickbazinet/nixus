---
title: 'Friendly fallback for failed Trends AI insight'
type: 'bugfix'
created: '2026-08-02'
status: 'done'
route: 'one-shot'
context: []
---

## Intent

**Problem:** When the Trends AI insight (`generate_trends_insight`) failed, the panel's error `Alert` rendered the raw backend `AppError.message` (e.g. Bedrock/OpenAI service errors, JSON-parse failures) directly to the user, which reads like a technical crash rather than a graceful failure.

**Approach:** Stop reading `error.message` in `TrendsInsightPanel`'s error branch; always render the existing friendly, translated fallback copy, and retitle the alert to plainly say the AI trend summary isn't available. Locked with a Playwright assertion that the raw error text never renders.

## Suggested Review Order

1. [TrendsInsightPanel.tsx error branch](../../apps/desktop/src/components/spending-trends/TrendsInsightPanel.tsx#L106-L126) — core fix: raw `error.message` removed from the error Alert.
2. [en.json insightError copy](../../apps/desktop/src/locales/en.json#L407) / [fr.json insightError copy](../../apps/desktop/src/locales/fr.json#L407) — friendlier, on-topic title text.
3. [spending-trends.spec.ts regression lock](../../apps/desktop/tests/spending-trends.spec.ts#L224-L235) — asserts the mocked backend error string never appears and the friendly copy does.
