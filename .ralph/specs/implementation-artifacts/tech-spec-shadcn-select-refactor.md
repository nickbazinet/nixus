---
title: 'Replace native selects with shadcn Select component'
type: 'refactor'
created: '2026-03-29'
status: 'done'
baseline_commit: 'e9cf7174'
context: []
---

# Replace Native Selects with shadcn Select Component

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** All 17 select dropdowns across the app use native HTML `<select>` elements, which look inconsistent with the shadcn design system used everywhere else (buttons, inputs, dialogs, etc.).

**Approach:** Create a shadcn Select UI component using `@base-ui/react/select` (matching the project's existing pattern), then replace all native selects across 14 files. Forms using `register()` will switch to `Controller` for react-hook-form integration.

## Boundaries & Constraints

**Always:**
- Match existing shadcn component patterns (base-ui primitives, `data-slot`, `cn()` merge)
- Preserve all existing validation rules, default values, and form behavior
- Support grouped items (SelectGroup/SelectLabel) for expense category selects
- Keep the same value types (string for form selects, number for TransactionReviewCard)

**Ask First:**
- Any change to form submission logic or data flow

**Never:**
- Change form validation rules or default values
- Modify backend/Rust code
- Add new features beyond the select UI swap

</frozen-after-approval>

## Code Map

- `src/components/ui/select.tsx` -- NEW: shadcn Select component (Root, Trigger, Value, Content, Item, Group, GroupLabel)
- `src/components/accounts/AddAccountForm.tsx` -- 2 selects: account_type, currency
- `src/components/accounts/EditAccountForm.tsx` -- 2 selects: account_type, currency
- `src/components/assets/AddAssetForm.tsx` -- 1 select: asset_type
- `src/components/assets/EditAssetForm.tsx` -- 1 select: asset_type
- `src/components/income/AddIncomeSourceForm.tsx` -- 1 select: income_type
- `src/components/income/EditIncomeSourceForm.tsx` -- 1 select: income_type
- `src/components/income/AddIncomeEntryForm.tsx` -- 1 select: source_id (validated)
- `src/components/income/IncomeEntryList.tsx` -- 1 select: source_id (validated)
- `src/components/expenses/AddExpenseForm.tsx` -- 1 select: budget_category_id (grouped, validated)
- `src/components/expenses/ExpenseList.tsx` -- 1 select: budget_category_id (grouped, validated)
- `src/components/onboarding/OnboardingAccountsStep.tsx` -- 2 selects: account_type, currency
- `src/components/onboarding/OnboardingAssetsStep.tsx` -- 1 select: asset_type
- `src/components/onboarding/OnboardingIncomeStep.tsx` -- 1 select: income_type
- `src/components/import/TransactionReviewCard.tsx` -- 1 select: category (controlled, no form)

## Tasks & Acceptance

**Execution:**
- [ ] `src/components/ui/select.tsx` -- Create shadcn Select component using @base-ui/react/select primitives with Root, Trigger, Value, Content, Item, Group, GroupLabel exports
- [ ] `src/components/accounts/AddAccountForm.tsx` -- Replace 2 native selects with Select, switch to Controller
- [ ] `src/components/accounts/EditAccountForm.tsx` -- Replace 2 native selects with Select, switch to Controller
- [ ] `src/components/assets/AddAssetForm.tsx` -- Replace 1 native select with Select, switch to Controller
- [ ] `src/components/assets/EditAssetForm.tsx` -- Replace 1 native select with Select, switch to Controller
- [ ] `src/components/income/AddIncomeSourceForm.tsx` -- Replace 1 native select with Select
- [ ] `src/components/income/EditIncomeSourceForm.tsx` -- Replace 1 native select with Select
- [ ] `src/components/income/AddIncomeEntryForm.tsx` -- Replace 1 native select with Select + Controller (has validation)
- [ ] `src/components/income/IncomeEntryList.tsx` -- Replace 1 native select with Select + Controller (has validation)
- [ ] `src/components/expenses/AddExpenseForm.tsx` -- Replace 1 grouped select with Select + SelectGroup + Controller
- [ ] `src/components/expenses/ExpenseList.tsx` -- Replace 1 grouped select with Select + SelectGroup + Controller
- [ ] `src/components/onboarding/OnboardingAccountsStep.tsx` -- Replace 2 native selects with Select + Controller
- [ ] `src/components/onboarding/OnboardingAssetsStep.tsx` -- Replace 1 native select with Select + Controller
- [ ] `src/components/onboarding/OnboardingIncomeStep.tsx` -- Replace 1 native select with Select + Controller
- [ ] `src/components/import/TransactionReviewCard.tsx` -- Replace 1 controlled native select with Select (no form)

**Acceptance Criteria:**
- Given any form with a select, when the user clicks the trigger, then a styled dropdown appears with all original options
- Given a grouped expense category select, when opened, then categories appear grouped under their budget group labels
- Given a required select with no value, when the form is submitted, then validation error displays correctly
- Given an edit form, when opened, then the select shows the current value pre-selected

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no type errors
- `npx playwright test` -- expected: existing tests pass

**Manual checks:**
- Open each form and verify selects render with shadcn styling, open/close properly, and submit correct values
