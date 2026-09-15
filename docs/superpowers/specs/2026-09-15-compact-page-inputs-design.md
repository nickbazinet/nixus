# Compact Page Inputs Design

## Goal

Prevent short monetary values from stretching across wide page-level cards while preserving the current behavior of bounded dialogs, slide-overs, onboarding flows, and variable-length fields.

## Scope

Apply compact sizing only to page-level money inputs that can currently expand with the 1280px application content area:

- expected annual government pension income;
- expected annual employer/workplace pension income;
- the inline budget-category target amount.

Existing compact age and percentage fields remain unchanged. Dialog, slide-over, onboarding, free-text, secret, notes, chat, date, select, and other numeric controls remain unchanged.

## User Experience

- Each affected money input uses the available width on narrow containers but stops growing at `12rem` on wider layouts.
- The width accommodates common localized currency values, the currency symbol, input padding, and native focus treatment without making the control appear associated with the full card width.
- Controls remain left-aligned with their labels and supporting text, following conventional desktop form layout.
- Labels, help text, validation, keyboard behavior, focus indicators, and value alignment do not change.
- No global default changes: unrelated forms keep their established sizing and layout.

## Implementation

Use the existing `MoneyInput` `className` extension point and Tailwind's responsive-safe `w-full max-w-48` utilities at the three affected call sites. This is preferable to adding a shared variant because the approved behavior is intentionally limited to page-level cards and does not yet represent an app-wide primitive.

No state, data flow, validation, localization, or error-handling code changes are required.

## Acceptance Criteria

1. **Given** the retirement page is displayed in a wide desktop window, **when** the assumptions card renders, **then** both annual pension inputs are no wider than `12rem` and remain left-aligned beneath their labels.
2. **Given** the budget page is displayed in a wide desktop window, **when** the inline add-category form renders, **then** its target money input is no wider than `12rem`.
3. **Given** an affected form has less than `12rem` available, **when** it renders, **then** the money input shrinks to the available width without horizontal overflow.
4. **Given** any bounded dialog, slide-over, onboarding flow, or variable-length field, **when** this change ships, **then** its existing width and behavior are unchanged.

## Verification

- Playwright asserts the affected page-level input widths and verifies unchanged input behavior.
- Type checking and the desktop production build pass.
- The full desktop Playwright suite passes.
- Browser visual QA checks the retirement and budget pages at representative desktop widths, including focus state and horizontal overflow.
