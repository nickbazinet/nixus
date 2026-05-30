---
title: 'Replace Native Date Inputs with shadcn DatePicker'
type: 'feature'
created: '2026-03-29'
status: 'done'
baseline_commit: 'e9cf7174'
context: []
---

# Replace Native Date Inputs with shadcn DatePicker

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** All date inputs across the app use native `<input type="date">`, which looks unstyled and inconsistent with the shadcn design system used everywhere else.

**Approach:** Install `react-day-picker` and `date-fns`, add shadcn `Calendar` and `Popover` UI primitives, build a reusable `DatePicker` component (button trigger + calendar popover), then replace all 7 native date inputs.

## Boundaries & Constraints

**Always:** Output and accept dates as `YYYY-MM-DD` strings (existing format). Preserve all existing validation, `data-testid` attributes, and `react-hook-form` integration. Match the existing design tokens (height, border radius, focus ring).

**Ask First:** Any change to date format or validation behavior beyond the current required-field check.

**Never:** Change how dates are stored or transmitted. Add date range pickers or time pickers. Modify the `MonthNavigator` component.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Select date | Click button, pick day | Popover closes, button shows formatted date, form value = ISO string | N/A |
| Clear required field | No date selected on required form | `aria-invalid` styling, error message shown | Validation message |
| Pre-filled value | Component receives existing ISO date | Calendar opens to that month, day highlighted | N/A |
| No initial value | `value` is empty/undefined | Button shows placeholder "Pick a date" | N/A |

</frozen-after-approval>

## Code Map

- `src/components/ui/calendar.tsx` -- New shadcn Calendar primitive (react-day-picker wrapper)
- `src/components/ui/popover.tsx` -- New shadcn Popover primitive (Base UI popover wrapper)
- `src/components/ui/date-picker.tsx` -- New reusable DatePicker (Calendar + Popover + Button)
- `src/components/expenses/AddExpenseForm.tsx` -- Replace `<Input type="date">` with DatePicker
- `src/components/expenses/ExpenseList.tsx` -- Replace edit date input
- `src/components/income/AddIncomeEntryForm.tsx` -- Replace `<Input type="date">` with DatePicker
- `src/components/income/IncomeEntryList.tsx` -- Replace edit date input
- `src/components/import/TransactionReviewCard.tsx` -- Replace raw `<input type="date">`
- `src/components/import/AutoCategorizedSummary.tsx` -- Replace raw `<input type="date">`
- `src/routes/import.tsx` -- Replace manual entry date input

## Tasks & Acceptance

**Execution:**
- [ ] Install `react-day-picker` and `date-fns` dependencies
- [ ] `src/components/ui/popover.tsx` -- Create Popover component using `@base-ui/react` Popover primitive, matching existing component patterns (data-slot, cn utility, Tailwind)
- [ ] `src/components/ui/calendar.tsx` -- Create Calendar component wrapping react-day-picker, styled with project's Tailwind tokens
- [ ] `src/components/ui/date-picker.tsx` -- Create DatePicker component: props `value?: string`, `onChange: (date: string) => void`, `placeholder?`, `id?`, `aria-invalid?`, `disabled?`. Uses Popover + Calendar + Button (outline variant). Formats display with date-fns `format()`.
- [ ] `src/components/expenses/AddExpenseForm.tsx` -- Replace date `<Input>` with `<DatePicker>` via react-hook-form `Controller`
- [ ] `src/components/expenses/ExpenseList.tsx` -- Replace edit date input with DatePicker
- [ ] `src/components/income/AddIncomeEntryForm.tsx` -- Replace date input with DatePicker via Controller
- [ ] `src/components/income/IncomeEntryList.tsx` -- Replace edit date input with DatePicker
- [ ] `src/components/import/TransactionReviewCard.tsx` -- Replace raw `<input type="date">` with DatePicker
- [ ] `src/components/import/AutoCategorizedSummary.tsx` -- Replace raw `<input type="date">` with DatePicker
- [ ] `src/routes/import.tsx` -- Replace manual entry date input with DatePicker

**Acceptance Criteria:**
- Given any form with a date field, when clicking the date button, then a styled calendar popover opens
- Given a date is selected from the calendar, when the popover closes, then the button shows the formatted date and the form value is a YYYY-MM-DD string
- Given an existing date value, when opening the calendar, then it navigates to the correct month with the day highlighted
- Given a required date field left empty, when submitting, then the validation error displays with `aria-invalid` styling
- Given the app is in dark mode, when viewing any date picker, then it uses the correct dark theme tokens

## Verification

**Commands:**
- `npm run build` -- expected: no TypeScript or build errors
- `npx playwright test` -- expected: existing tests pass (date inputs still function)
