---
title: 'Update founding page screenshots'
type: 'feature'
created: '2026-09-10'
status: 'done'
route: 'one-shot'
---

# Update founding page screenshots

## Intent

**Problem:** The founding page showed three outdated product screenshots and did not represent Projects or Retirement insights.

**Approach:** Replace the existing assets with the supplied images, append Projects and Retirement in the requested order, and preserve the existing responsive product-frame treatment in English and French.

## Suggested Review Order

**Showcase composition**

- The ordered content model maps all five supplied screenshots into the existing frame.
  [`betaPage.ts:15`](../../apps/web/src/content/betaPage.ts#L15)

- English captions and accessible descriptions cover Projects and Retirement.
  [`en.json:63`](../../apps/web/src/locales/en.json#L63)

- French copy mirrors the expanded showcase and corrected AI description.
  [`fr.json:63`](../../apps/web/src/locales/fr.json#L63)

**Verification**

- Tests lock exact order, asset paths, natural sizing, captions, and locale parity.
  [`BetaPage.test.tsx:129`](../../apps/web/src/components/BetaPage.test.tsx#L129)
