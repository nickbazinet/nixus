# Budget-to-Income Warning Design

## Goal

Warn users when their total targeted monthly budget is higher than their historical average monthly income, once enough income history exists to make the comparison useful.

## Behavior

- Income history is eligible once it contains at least six distinct completed months with recorded income.
- Average monthly income uses all completed months with recorded income and excludes the current, incomplete month.
- The warning appears only when `total_target_cents` is strictly greater than `average_monthly_income_cents`.
- An equal budget and average income does not trigger the warning.
- The comparison uses integer cents at every layer.

## Architecture and Data Flow

Extend the existing budget-summary response rather than introducing a separate query. The backend obtains the existing total budget target and trailing income average, then returns the summary with:

- `average_monthly_income_cents`
- `income_month_count`

The budget page continues to load one summary with one loading/error state. The frontend determines warning visibility from those values and passes the warning data into the existing budget summary strip.

## User Experience

Render the existing shared `Alert` with `variant="caution"` beneath the overall budget meter inside the budget summary card. This follows the Nixus “Quiet Ledger” design system: inline and non-modal, with caution tokens, no shadow, and no decorative motion.

The alert contains:

- an amber attention icon from Lucide;
- a short title stating that the budget is above average income;
- one sentence showing both the targeted monthly budget and average monthly income in the user’s locale and currency.

The alert is advisory only. It has no dismissal control and does not prevent users from editing their budget.

All visible copy is localized in English and French. Hidden monetary values remain hidden through the existing values-visibility behavior.

## Acceptance Criteria

1. **Given** five completed months with recorded income, **when** the budget page loads with a target above average income, **then** no income warning is shown.
2. **Given** six completed months with recorded income, **when** the target is above average income, **then** the caution alert shows the formatted target and average income.
3. **Given** six or more completed months with recorded income, **when** the target equals or is below average income, **then** no income warning is shown.
4. **Given** eligible income history and hidden financial values, **when** the warning is shown, **then** neither monetary amount is exposed.

## Verification

- Rust tests cover month-count eligibility and integer average data returned by the budget summary.
- Frontend tests cover warning visibility at the five/six-month boundary and the equal/greater target boundary.
- Locale tests preserve English/French key and placeholder parity.
- Playwright drives the budget page and verifies ineligible, visible, localized-amount, and values-masked states.
- Type checking, the desktop build, and the full desktop Playwright suite pass.
