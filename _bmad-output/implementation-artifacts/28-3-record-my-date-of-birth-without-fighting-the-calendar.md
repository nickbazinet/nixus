# Story 28.3: Record my date of birth without fighting the calendar

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a signed-in Nixus user,
I want to set my date of birth using a date picker I can actually navigate decades with,
so that Nixus can use my age for age-dependent guidance later.

## Acceptance Criteria

1. **Given** I am on `/profile`
   **When** I open the date-of-birth picker
   **Then** I can jump directly to a year decades in the past without clicking month-by-month
   **And** the picker is the shared `@nixus/shared/ui` `DatePicker`, not a locally duplicated component

2. **Given** the shared `DatePicker` gains `captionLayout`, `startMonth`, and `endMonth`
   **When** existing call sites are checked
   **Then** all of them compile and behave unchanged, because the new props are optional

3. **Given** I pick a valid date of birth and press Save
   **When** the document is written
   **Then** `birth_date` is stored as an ISO 8601 `"YYYY-MM-DD"` string, never a timestamp

4. **Given** I submit a date in the future
   **When** validation runs in `profile_store.rs`
   **Then** it is rejected as `AppError::Validation { field: "birth_date" }`
   **And** the message is surfaced against the date-of-birth field in the form

5. **Given** I submit a date implying an age under 18 or over 120
   **When** validation runs
   **Then** it is rejected with the same field-scoped error

6. **Given** validation fails on the Rust side
   **When** the error reaches the form
   **Then** the `field` value maps directly to the form field name with no translation table, because form field names are the `snake_case` IPC names

7. **Given** I clear my date of birth and press Save
   **When** the document is written
   **Then** `birth_date` is `null` and no error occurs

## Tasks / Subtasks

- [ ] **Task 1 — Extend the shared `DatePicker` with three optional passthrough props (AC: #1, #2)**
  - [ ] Edit `packages/shared/src/ui/date-picker.tsx` ONLY. Do not create a new component, do not copy `DatePicker` into `apps/desktop` (project rule 8 / architecture D12).
  - [ ] Add `import type { CalendarProps } from "./calendar"` (the file already imports `{ Calendar }` from `./calendar`; `calendar.tsx` already does `export type { CalendarProps }`).
  - [ ] Add three OPTIONAL members to `interface DatePickerProps`, typed by indexed access so the union never drifts from react-day-picker:
        `captionLayout?: CalendarProps["captionLayout"]`
        `startMonth?: CalendarProps["startMonth"]`
        `endMonth?: CalendarProps["endMonth"]`
  - [ ] Destructure the three in the `DatePicker({ ... })` parameter list and forward them to `<Calendar ...>` inside `<PopoverContent>`.
  - [ ] Do NOT remove or alter `mode="single"`, `selected={dateValue}`, `onSelect={handleSelect}`, `defaultMonth={dateValue}`, or `autoFocus`. Do NOT change the `onChange: (date: string) => void` signature. Do NOT add a default value for any of the three new props — `undefined` must reach `DayPicker` so behaviour is byte-identical for callers that omit them.
  - [ ] No new dependency. `react-day-picker` is already `^9.14.0` in `packages/shared/package.json`. Do NOT add `fromDate`, `toDate`, `fromYear`, or `toYear` — those are react-day-picker **v8** names and do not exist in v9.
  - [ ] `DatePickerProps` is already re-exported (`packages/shared/src/ui/index.ts:28` → `packages/shared/src/index.ts` `export * from "./ui"`), so no export change is needed.

- [ ] **Task 2 — Confirm every existing `DatePicker` call site still compiles unchanged (AC: #2)**
  - [ ] Modify NONE of these files. Confirm each still typechecks with zero diff, because all three new props are optional:
        1. `apps/desktop/src/routes/import.tsx:855`
        2. `apps/desktop/src/components/import/TransactionReviewCard.tsx:125`
        3. `apps/desktop/src/components/import/AutoCategorizedSummary.tsx:173`
        4. `apps/desktop/src/components/maintenance/LogCustomServiceForm.tsx:163`
        5. `apps/desktop/src/components/maintenance/LogServiceForm.tsx:131`
        6. `apps/desktop/src/components/income/IncomeEntryList.tsx:205`
        7. `apps/desktop/src/components/income/AddIncomeEntryForm.tsx:162`
        8. `apps/desktop/src/components/expenses/AddExpenseForm.tsx:207`
        9. `apps/desktop/src/components/expenses/ExpenseList.tsx:251`
  - [ ] `apps/web` has zero `DatePicker` usages — nothing to check there.
  - [ ] Run `pnpm --filter @nixus/shared typecheck` and `pnpm --filter @nixus/desktop build` (which runs `tsc && vite build`) and confirm zero errors and zero warnings.
  - [ ] Run `pnpm --filter @nixus/desktop test` (Vitest) and the Playwright specs that touch the date control — `apps/desktop/tests/import.spec.ts` asserts the trigger label text (`"Pick a date"`, `"Mar 15, 2026"`, lines 529–566). That label is produced by the unchanged `format(dateValue, "MMM d, yyyy")` / `placeholder` path, so it must still pass.

- [ ] **Task 3 — Add the `birth_date` field to `apps/desktop/src/components/profile/ProfileForm.tsx` (AC: #1, #3, #6, #7)**
  - [ ] Add `birth_date: string` to the existing `ProfileFormData` interface in that file (Story 28.2 created it with `first_name` and `last_name`). The form field name MUST be exactly `birth_date` — the snake_case IPC name — so `AppError::Validation { field }` maps to `setError(field)` with no translation table (architecture "Process Patterns", epic AC 6).
  - [ ] Default value: `profile?.birth_date ?? ""`.
  - [ ] **Take `birth_date` off the pass-through in `onSubmit`.** Story 28.2 deliberately forwards the five fields it does not render straight from the loaded profile (`birth_date: data?.birth_date ?? null`, …) so that a full-replace save does not silently clear them. `birth_date` is now a rendered field, so its value MUST come from the form. Change that one line to read from `data.birth_date` (the submitted form values), and leave the other four (`income_bracket`, `income_bracket_currency`, `country_code`, `subdivision_code`) as pass-throughs for Epic 29. Miss this and the picker appears to work but every save writes the old value back.
  - [ ] Render inside the existing form, following `apps/desktop/src/components/maintenance/LogCustomServiceForm.tsx:153-181` verbatim as the structural pattern: `<Label htmlFor=...>` (NO `required` prop and NO `aria-required` — `birth_date` is optional), a wrapping `<div data-testid="profile-birth-date">`, a react-hook-form `<Controller name="birth_date" control={control}>`, and an error `<p id={dateErrorId} className="text-caption text-over-ink">`.
  - [ ] Inside `render={({ field }) => (...)}` use the shared picker with year navigation:
        `<DatePicker id={birthDateId} value={field.value} onChange={field.onChange} placeholder={t("profile.birthDatePlaceholder")} captionLayout="dropdown" startMonth={startMonth} endMonth={endMonth} aria-invalid={!!errors.birth_date} aria-describedby={errors.birth_date ? dateErrorId : undefined} />`
  - [ ] Compute the bounds ONCE with `useMemo(() => ..., [])` so a new `Date` is not allocated per render (this would remount the caption dropdowns):
        `startMonth = new Date(currentYear - 120, 0, 1)`
        `endMonth   = new Date(currentYear - 18, 11, 31)`
        where `currentYear = new Date().getFullYear()`. These bounds mirror the Rust 18–120 rule, so the UI cannot offer a year Rust would reject. Rust remains the authority; these are affordances only.
  - [ ] `captionLayout="dropdown"` is what satisfies AC 1 (year + month dropdowns instead of month-by-month nav). Manually verify: open `/profile`, open the picker with no date set, confirm a **year dropdown** is present and a year such as 1985 is directly selectable.
  - [ ] Import from the package root: `import { Button, DatePicker, Label } from "@nixus/shared"`. Every one of the 113 desktop files that consume shared UI imports from `"@nixus/shared"`, never `"@nixus/shared/ui"`.
  - [ ] **Clear affordance (required for AC 7):** the shared `DatePicker`'s `handleSelect` is `if (day) { onChange(...) }`, so it can NEVER emit an empty value and re-clicking the selected day is swallowed. Do not change that. Instead render, beside the picker and only when `field.value` is non-empty, a `<Button type="button" variant="ghost" size="sm" data-testid="profile-birth-date-clear" onClick={() => field.onChange("")}>{t("profile.birthDateClear")}</Button>`.
  - [ ] On submit, map `""` → `null` before invoking `save_user_profile`: `birth_date: data.birth_date.trim() || null`. Absent values are `null`, never empty strings (architecture "Format Patterns").
  - [ ] **Extend Story 28.2's `onError` field allow-list to include `"birth_date"` (AC 4, AC 6).** 28.2 built the handler to call `setError(field, { message })` only when `field` is `"first_name"` or `"last_name"`, falling through to `toast.error(t("toast.saveFailed"))` otherwise. Left as-is, a rejected birthdate would surface as a generic toast and AC 4's "the message is surfaced against the date-of-birth field" would fail silently. Add `"birth_date"` to that allow-list. Reuse 28.2's existing error reader (the `getErrorMessage` shape from `apps/desktop/src/components/settings/CredentialsForm.tsx:23-36`) — do not introduce a second one.
  - [ ] The allow-list is a guard against `setError` being called with a key that is not in `ProfileFormData`; it is **not** a translation table. The `field` string is passed to `setError` unmodified — no renaming, no camelCase conversion, and **no message-code → i18n-key lookup**. That identity mapping is the entire point of AC 6.
  - [ ] Non-validation failures (`type: "auth"`, `type: "file"`) keep falling through to the existing generic `toast.saveFailed` path that 28.2 established.
  - [ ] Do NOT add any `invoke()` call to `ProfileMenu.tsx`, `TopBar`, or any always-mounted component (architecture D11 — this is what keeps every existing Playwright mock untouched).

- [ ] **Task 4 — Add `birth_date` validation to `apps/desktop/src-tauri/src/profile_store.rs` (AC: #3, #4, #5, #7)**
  - [ ] Add to the existing validation performed by `save_profile` in `profile_store.rs`. Validation lives in the store, NOT in `commands/profile.rs` (architecture "Validation placement"; project rule 3 separation).
  - [ ] Declare the bounds as consts beside the function: `const MIN_AGE_YEARS: i32 = 18;` and `const MAX_AGE_YEARS: i32 = 120;`.
  - [ ] Write the checker as a **pure** function that takes today as a parameter, so tests are deterministic — the precedent is `apps/desktop/src-tauri/src/commands/auth.rs:499` (`"now_unix is a parameter rather than an inner Utc::now() so this is pure"`):
        `fn validate_birth_date_at(birth_date: Option<&str>, today: NaiveDate) -> Result<Option<String>, AppError>`
        plus a thin caller inside `save_profile` passing `chrono::Local::now().date_naive()`.
  - [ ] Behaviour, in order:
        1. `None` → `Ok(None)`.
        2. `Some(s)` where `s.trim().is_empty()` → `Ok(None)`. (The form already maps `""` → `null`; this is the defensive second line so "unset" has exactly one stored representation.)
        3. `NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")` failure → `Err(AppError::Validation { message: "...", field: Some("birth_date".to_string()) })`. `%Y-%m-%d` is strict, so `"1985-3-14"`, `"14/03/1985"`, `"1985-13-01"` and `"not-a-date"` all reject.
        4. `parsed > today` → `Err(...)` with `field: Some("birth_date")`.
        5. computed age `< MIN_AGE_YEARS` → `Err(...)`; age `> MAX_AGE_YEARS` → `Err(...)`; both `field: Some("birth_date")`.
        6. otherwise `Ok(Some(trimmed.to_string()))` — store the **ISO 8601 `String`** exactly as given, never a timestamp, never an epoch integer (project rule 4; architecture "Format Patterns").
  - [ ] Age helper (needs `chrono::Datelike`): `let mut age = today.year() - birth.year(); if (today.month(), today.day()) < (birth.month(), birth.day()) { age -= 1; }`. This is calendar-correct across leap days — born `2008-02-29` with today `2026-02-28` yields 17, not 18.
  - [ ] Message style and error construction MUST match `apps/desktop/src-tauri/src/db/account.rs:117-139` and `apps/desktop/src-tauri/src/db/maintenance.rs:558-581`: plain English sentence in `message`, `field: Some("<snake_case field>".to_string())`, early `return Err(...)` per rule, `.map_err(|_| AppError::Validation { ... })?` on the parse. Reuse `AppError::Validation` — introduce NO new `AppError` variant (architecture D13).
  - [ ] Use `chrono` (already a dependency, `serde` feature on). Add NO crate to `Cargo.toml`. No `.unwrap()` outside `#[cfg(test)]`; `?` propagation only.
  - [ ] Add NO SQLite migration, NO table, NO `db/profile.rs`, and NO `insert_audit_log` call — a file-backed store has neither a `Connection` nor an `i64 entity_id` (architecture D2 / D10).

- [ ] **Task 5 — Rust unit tests in `profile_store.rs` (AC: #3, #4, #5, #7)**
  - [ ] Extend the existing `#[cfg(test)] mod tests` in `apps/desktop/src-tauri/src/profile_store.rs` (inline `#[cfg(test)] mod tests`, matching `db/backup.rs`). Do not create a `tests/` file.
  - [ ] Pin `today` with `NaiveDate::from_ymd_opt(2026, 8, 10).unwrap()` (the `db/recurring.rs:396` pattern) and call `validate_birth_date_at`. Never call `Local::now()` in a test.
  - [ ] Six required cases:
        1. valid date — `Some("1985-03-14")` → `Ok(Some("1985-03-14"))`
        2. future date — `Some("2027-01-01")` → `Err(AppError::Validation { field: Some("birth_date"), .. })`
        3. age under 18 — `Some("2015-06-01")` → `Err` with `field == Some("birth_date")`
        4. age over 120 — `Some("1890-01-01")` → `Err` with `field == Some("birth_date")`
        5. malformed string — `Some("not-a-date")` (and `Some("14/03/1985")`) → `Err` with `field == Some("birth_date")`
        6. cleared / `None` — `None` → `Ok(None)`, and `Some("")` → `Ok(None)`
  - [ ] Every failing case must assert the `field` is exactly `Some("birth_date")` — a test that only asserts "is an error" would pass with the wrong field and silently break AC 6's field mapping.
  - [ ] Add the three boundary cases too, because off-by-one on an age rule is invisible otherwise: exactly 18 today (accept), the day before the 18th birthday (reject), exactly 120 today (accept).
  - [ ] Add one `tempfile`-based round-trip through `save_profile` / `load_profile` asserting the persisted JSON holds `"birth_date": "1985-03-14"` as a **string** and that a cleared save persists `"birth_date": null`. `tempfile = "3"` is already a dependency.
  - [ ] Run `cargo test` and `cargo clippy` in `apps/desktop/src-tauri` — zero warnings (project rule 9).

- [ ] **Task 6 — i18n keys in BOTH locale files, plus the locale-parity test declaration (AC: #1, #7)**
  - [ ] Add these three flat dotted keys to `apps/desktop/src/locales/en.json` AND `apps/desktop/src/locales/fr.json` in the same change. Locale files are flat dotted-key JSON, not nested, and the keys belong in the existing `profile.*` namespace — do NOT introduce `userProfile.*`.

    | Key | en.json | fr.json |
    | --- | --- | --- |
    | `profile.birthDate` | `Date of birth` | `Date de naissance` |
    | `profile.birthDatePlaceholder` | `Select your date of birth` | `Sélectionnez votre date de naissance` |
    | `profile.birthDateClear` | `Clear date of birth` | `Effacer la date de naissance` |

  - [ ] `profile.birthDatePlaceholder` is not optional polish: `DatePicker`'s own default is the hardcoded English `placeholder = "Pick a date"`, so omitting it ships an untranslated string into the FR UI, violating the platform i18n rule.
  - [ ] **REGRESSION TRAP — must be handled or CI fails.** `apps/desktop/src/locales/__tests__/profile-i18n.test.ts:58-65` has a test named `"declares every profile key it ships"` that asserts `profileKeys(en).sort()` equals exactly its `REQUIRED_KEYS` array. Adding any `profile.*` key without adding it to `REQUIRED_KEYS` (line 10-18 of that file) makes that assertion fail. Add all three new keys to `REQUIRED_KEYS`.
  - [ ] Do not add the new keys to that file's `ARIA_LABEL_KEYS`, `PLACEHOLDER_KEYS`, or `ELLIPSIS_KEYS` — none of the three is an accessible-name-only string, none carries an `{{interpolation}}`, and none is pending-state copy.
  - [ ] Run `pnpm --filter @nixus/desktop test` and confirm `src/locales/__tests__/profile-i18n.test.ts` passes, including its `"has no profile key present in one locale but not the other"` parity assertion.

- [ ] **Task 7 — Verification gates (AC: all)**
  - [ ] `pnpm --filter @nixus/shared typecheck` — zero errors.
  - [ ] `pnpm --filter @nixus/desktop build` — zero TypeScript errors and zero warnings (`noUnusedLocals` / `noUnusedParameters` are CI failures, project rule 7).
  - [ ] `cargo clippy` + `cargo test` in `apps/desktop/src-tauri` — zero warnings, all tests green.
  - [ ] `pnpm --filter @nixus/desktop test` — Vitest, including locale parity.
  - [ ] Playwright: `apps/desktop/tests/import.spec.ts` (date-control label assertions), plus whichever profile spec Story 28.1/28.2 created. Per architecture D11 no existing spec should need editing — if one does, stop and re-check that no always-mounted component gained an `invoke()`.
  - [ ] Manual: sign in, open `/profile`, set date of birth to a 1985 date via the year dropdown, Save, quit and relaunch, confirm the value round-trips. Then clear it, Save, and confirm no error and `birth_date: null` in `app_data_dir/profiles/<sub>.json`.
  - [ ] Do NOT touch `_bmad-output/implementation-artifacts/sprint-status.yaml` — the orchestrator performs one consolidated update.

## Dev Notes

**Prerequisites.** This story depends only on **Story 28.1** (the `/profile` route with its four-way session guard) and **Story 28.2** (`profile_store.rs`, `json_store.rs`, `commands/profile.rs`, `commands/auth.rs::current_subject()`, `hooks/useProfile.ts`, `components/profile/ProfileForm.tsx`, `queryKeys.profile`, `lib/types.ts` mirrors). All of those already exist when this story starts — this story adds one field to a form that exists, one validation rule to a store that exists, and three optional props to a shared component that exists. No later story is required.

**Out of scope — do not implement any of this here.** Delete-all coverage for `profiles/` (Story 28.4). The "Sign In with Nixus Cloud" relabel (Story 28.5). Country, subdivision, income bracket, currency, and the ISO 3166 dataset (Epic 29). Any TFSA display or calculation (Epic 30) — the date of birth exists *because* Epic 30 will consume it, but that consumer is not built here, so add no `get_tfsa_accumulated_limit`, no limits table, and no adjacent TFSA panel. No SQLite migration, no new table, no audit-log call, no new npm package, no new Rust crate, no new `AppError` variant.

### Why the current `DatePicker` fails a birthdate

`packages/shared/src/ui/date-picker.tsx` accepts only `{ value, onChange, placeholder, id, aria-invalid, disabled, className }` and hardwires `defaultMonth={dateValue}` internally, so a 1985 birthdate is only reachable by clicking the previous-month chevron ~490 times. The whole file today, verbatim:

```tsx
import { useState, useMemo } from "react"
import { format, parse } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "../lib/cn"
import { Button } from "./button"
import { Calendar } from "./calendar"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

interface DatePickerProps {
  value?: string
  onChange: (date: string) => void
  placeholder?: string
  id?: string
  "aria-invalid"?: boolean
  disabled?: boolean
  className?: string
}

function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  id,
  "aria-invalid": ariaInvalid,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)

  const dateValue = useMemo(() => {
    if (!value) return undefined
    const parsed = parse(value, "yyyy-MM-dd", new Date())
    return isNaN(parsed.getTime()) ? undefined : parsed
  }, [value])

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      onChange(format(day, "yyyy-MM-dd"))
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            aria-invalid={ariaInvalid}
            className={cn(
              "w-full justify-start text-left",
              !value && "text-ink-faint",
              ariaInvalid &&
                "border-over",
              className
            )}
          />
        }
      >
        <CalendarIcon className="mr-2 size-4" />
        {dateValue ? format(dateValue, "MMM d, yyyy") : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          defaultMonth={dateValue}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
```

Two consequences to read off that source directly:

1. `handleSelect` is guarded by `if (day)`. In react-day-picker v9 `mode="single"`, re-clicking the selected day fires `onSelect(undefined)` — which this guard swallows. **The control cannot emit an empty value, so it has no clear path.** That is why AC 7 needs an explicit clear `Button` in `ProfileForm.tsx` rather than a `DatePicker` change. Widening `onChange` to `(date: string | undefined)` would be a breaking signature change across all 9 call sites and is forbidden by AC 2.
2. `placeholder` defaults to the hardcoded English `"Pick a date"`, so `ProfileForm` must pass a translated placeholder.

### Why the extension is three props and nothing more

`packages/shared/src/ui/calendar.tsx` is already a thin pass-through — `type CalendarProps = React.ComponentProps<typeof DayPicker>`, and the component spreads `{...props}` onto `<DayPicker>` after its `classNames` and `components.Chevron` overrides:

```tsx
import * as React from "react"
import { DayPicker } from "react-day-picker"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "../lib/cn"
import { buttonVariants } from "./button"

type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-h3 text-ink",
        nav: "flex items-center gap-1",
        /* ...button_previous / button_next / month_grid / weekdays / day / day_button / selected / today / outside / disabled / range_* / hidden... */
        ...classNames,
      }}
        components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight
          return <Icon className="size-4" aria-hidden="true" />
        },
      }}
      {...props}
    />
  )
}

export { Calendar }
export type { CalendarProps }
```

So every react-day-picker prop is already reachable one layer down; `DatePicker` simply does not forward them. The fix is forwarding, not a new component and not a new dependency (architecture "Inherited Foundation Gap: `DatePicker` year navigation" and D12).

`calendar.tsx` does not override `dropdowns`, `dropdown`, or `dropdown_root` in `classNames`, so `captionLayout="dropdown"` renders react-day-picker's unstyled default dropdowns. That is acceptable and in scope only to the extent that the year selector is usable and legible; do **not** restyle `calendar.tsx`'s `classNames` map as part of this story — that would change rendering for the other 9 call sites and break AC 2's "behave unchanged".

### Version: these are v9 prop names

`react-day-picker` is `^9.14.0` in **both** `packages/shared/package.json` (`"react-day-picker": "^9.14.0"`, in `dependencies`) and `apps/desktop/package.json` (`"react-day-picker": "^9.14.0"`, in `dependencies`). Therefore `captionLayout`, `startMonth`, and `endMonth` are correct. The v8 names `fromDate` / `toDate` / `fromYear` / `toYear` **do not exist in v9** and must not be used. This is confirmed in `architecture-user-profile.md` under "Coherence Validation" as a verified technical assumption.

Currently **zero** of the 9 call sites pass any of `captionLayout`, `startMonth`, `endMonth`, `fromDate`, `toDate`, `fromYear`, `toYear`. The props they do pass are only `id`, `value`, `onChange`, and — on 6 of 9 — `aria-required="true"`, `aria-invalid`, `aria-describedby`. None passes `placeholder`, `disabled`, or `className`. Test IDs (`date-input`, `auto-date-input`, `log-service-date`, `custom-service-date`) sit on the wrapping `<div>`, not on `DatePicker`. So making the three additions optional is sufficient for AC 2 — no call site needs migration.

### The form pattern to copy

`apps/desktop/src/components/maintenance/LogCustomServiceForm.tsx:153-181` is the closest existing example of `DatePicker` + `react-hook-form` `Controller` + field-scoped error rendering, and this repo's forms all follow it:

```tsx
<div className="flex flex-col gap-1.5">
  <Label htmlFor={`custom-service-date-${vehicleId}`} required>
    {t("maintenance.logService.date")}
  </Label>
  <div data-testid="custom-service-date">
    <Controller
      name="service_date"
      control={control}
      rules={{ required: t("maintenance.validation.dateRequired") }}
      render={({ field }) => (
        <DatePicker
          id={`custom-service-date-${vehicleId}`}
          value={field.value}
          onChange={field.onChange}
          aria-required="true"
          aria-invalid={!!errors.service_date}
          aria-describedby={
            errors.service_date ? dateErrorId : undefined
          }
        />
      )}
    />
  </div>
  {errors.service_date && (
    <p id={dateErrorId} className="text-caption text-over-ink">
      {errors.service_date.message}
    </p>
  )}
</div>
```

Differences for `birth_date`: it is **optional**, so drop `Label required`, drop `aria-required="true"`, and pass **no `rules`** (an empty date must be submittable — AC 7). `dateErrorId` comes from `useId()`. Note the setup at the top of that file — `const { register, control, handleSubmit, setError, formState: { errors } } = useForm<...>({ defaultValues: {...}, mode: "onBlur" })` — `setError` is already destructured there and is exactly what AC 6's field mapping needs.

### The Rust validation style to match

Field errors in this codebase are constructed inline with an early return and an explicit snake_case `field`. `apps/desktop/src-tauri/src/db/account.rs:117-139`:

```rust
pub fn insert_account(conn: &Connection, input: &CreateAccountInput) -> Result<Account, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Account name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    let institution = input.institution.trim();
    if institution.is_empty() {
        return Err(AppError::Validation {
            message: "Institution is required".to_string(),
            field: Some("institution".to_string()),
        });
    }

    if !VALID_ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid account type: {}", input.account_type),
            field: Some("account_type".to_string()),
        });
    }
```

Note the shape: `trim()` first, one `if` per rule, `message` a plain English sentence, `field: Some("<snake_case>".to_string())`. Allow-lists are `const X: &[&str]` at module top (`VALID_ACCOUNT_TYPES`, `VALID_CURRENCIES`) — the age bounds should follow the same "named const at module top" habit.

`apps/desktop/src-tauri/src/db/maintenance.rs:558-581` is the existing ISO-date-plus-not-in-the-future validator and is the direct template for `birth_date` (it lacks only the age window and purity):

```rust
fn validate_service_date(service_date: &str) -> Result<(), AppError> {
    let trimmed = service_date.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            message: "Service date is required".to_string(),
            field: Some("service_date".to_string()),
        });
    }

    let parsed = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| AppError::Validation {
        message: "Invalid service date format".to_string(),
        field: Some("service_date".to_string()),
    })?;

    let today = Local::now().date_naive();
    if parsed > today {
        return Err(AppError::Validation {
            message: "Service date cannot be in the future".to_string(),
            field: Some("service_date".to_string()),
        });
    }

    Ok(())
}
```

Deviate from it in exactly two ways: (1) empty is `Ok(None)` here, not an error — `birth_date` is optional; (2) `today` is a **parameter**, not an inner `Local::now()`, so the six required tests are deterministic. The purity precedent is `apps/desktop/src-tauri/src/commands/auth.rs:499`, whose own comment reads: *"`now_unix` is a parameter rather than an inner `Utc::now()` so this is pure."* `chrono` is already a dependency; `NaiveDate::parse_from_str(.., "%Y-%m-%d")` (`import.rs:341`, `recurring.rs:232`) and `Local::now().date_naive()` (`maintenance.rs:258`) are the established calls, and `db/recurring.rs:396` shows the `NaiveDate::from_ymd_opt(2026, 3, 20).unwrap()` pinned-date test style.

### Error shape on the wire

`AppError::Validation` serializes flat (`apps/desktop/src-tauri/src/error.rs:41-50`) to `{ "type": "validation", "message": "...", "field": "birth_date" }` — `field` is omitted entirely when `None`. The frontend reads it off the rejected `invoke` value the same way `apps/desktop/src/components/settings/CredentialsForm.tsx:28-36` does. Because form field names ARE the snake_case IPC names, `field` is passed straight into `setError(...)`; there is no mapping layer and none may be added.

### i18n mechanics

Locale files are **flat dotted-key JSON**. The `profile.*` namespace already exists with exactly seven keys (`en.json` / `fr.json` lines 40-46): `profile.signIn`, `profile.accountMenu`, `profile.loading`, `profile.signedInAs`, `profile.signOut`, `profile.sessionExpired`, `profile.sessionExpiredAction`. Extend that namespace; do not create `userProfile.*`.

`apps/desktop/src/locales/__tests__/profile-i18n.test.ts` enforces three things that matter here: the two-way parity check (`"has no profile key present in one locale but not the other"`), and — the trap — `"declares every profile key it ships"`, which asserts the *complete set* of `profile.`-prefixed keys equals its hardcoded `REQUIRED_KEYS` array. A new key added to only one locale, or to both locales but not to `REQUIRED_KEYS`, fails CI either way.

Rust validation messages are surfaced to the user as returned (English), matching how `getErrorMessage(err)` results are already displayed in `YourDataSettings.tsx` and `DangerZone.tsx`. Do not add i18n keys for validation messages and do not build a code→key table; the generic fallback for non-field failures is the existing `toast.saveFailed` key (`en.json:578` / `fr.json:578`).

### Testing standards summary

- **Rust:** inline `#[cfg(test)] mod tests` in the same file, `tempfile` for filesystem tests (matching `db/backup.rs`), pinned `NaiveDate` instead of `Local::now()`. `.unwrap()` is allowed only inside tests.
- **Desktop unit (Vitest + jsdom):** locale-parity specs in `src/locales/__tests__/` and hook tests in `src/hooks/__tests__/`. No `@testing-library/react` in desktop — tests use `createRoot` / `act` directly.
- **Playwright:** `apps/desktop/tests/`, run against the plain Vite dev server on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per-spec. There is no real IPC in that suite. This story adds **no** always-mounted component and **no** new command, so no existing spec's mock switch needs a new case (`docs/project-context.md:295`; architecture D11).
- **Shared package:** `packages/shared` has no UI component tests (only `src/styles/__tests__/contrast.test.ts`). The guard on the `DatePicker` change is `pnpm --filter @nixus/shared typecheck` plus the desktop `tsc` build plus `apps/desktop/tests/import.spec.ts`.

### Project Structure Notes

Files this story touches, and nothing else:

| Path | Change |
| --- | --- |
| `packages/shared/src/ui/date-picker.tsx` | MODIFIED — three optional passthrough props forwarded to `Calendar` |
| `apps/desktop/src/components/profile/ProfileForm.tsx` | MODIFIED — `birth_date` in `ProfileFormData`, `Controller` + `DatePicker`, clear button, `""`→`null` on submit, `birth_date` moved off the 28.2 pass-through, `"birth_date"` added to the `onError` allow-list |
| `apps/desktop/src-tauri/src/profile_store.rs` | MODIFIED — `birth_date` validation + its unit tests |
| `apps/desktop/src/locales/en.json` | MODIFIED — 3 new `profile.*` keys |
| `apps/desktop/src/locales/fr.json` | MODIFIED — same 3 keys, FR values |
| `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` | MODIFIED — 3 new keys added to `REQUIRED_KEYS` |

Deliberately **not** touched: `packages/shared/src/ui/calendar.tsx` (already a full pass-through; restyling it would change the other 9 call sites), `packages/shared/src/ui/index.ts` and `packages/shared/src/index.ts` (`DatePickerProps` already re-exported), `packages/shared/package.json` and `apps/desktop/package.json` and `Cargo.toml` (zero new dependencies), all 9 existing `DatePicker` call sites, `apps/desktop/src/components/auth/ProfileMenu.tsx`, `apps/desktop/src/routes/profile.tsx`, `apps/desktop/src/hooks/useProfile.ts` and `useAuth.ts` — 28.2 already wires `save_user_profile` with all seven fields and already invalidates `queryKeys.profile` on success, so the hook layer needs no change; the `onError` allow-list edit belongs in `ProfileForm.tsx`, not in the hook — `src-tauri/migrations/`, `db/mod.rs` `MIGRATIONS`, `db/danger_zone.rs`, `db/audit.rs`, `db/backup.rs`, `commands/profile.rs`, `models/mod.rs` (`birth_date: Option<String>` already exists from 28.2), `lib.rs`, `routeTree.gen.ts`, every existing `tests/*.spec.ts`, and `_bmad-output/implementation-artifacts/sprint-status.yaml`.

Naming alignment: `birth_date` is snake_case in the Rust model, in the JSON document, in the IPC parameter list, and as the react-hook-form field name — one identifier end to end, which is precisely what makes AC 6's zero-translation-table mapping possible. The i18n *keys* are camelCase after the dot (`profile.birthDate`), matching every existing key in the file; that is a different namespace from field names and is not a variance.

One variance worth recording: the architecture's delta tree marks `date-picker.tsx` as the only `packages/shared` change and does not anticipate a clear affordance. Adding the clear `Button` inside `ProfileForm.tsx` — rather than widening `DatePicker`'s `onChange` — keeps the shared component's contract intact and honours AC 2, so the variance is resolved on the desktop side of the boundary by design, not by omission.

### References

- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Story 28.3: Record my date of birth without fighting the calendar] — acceptance criteria, copied verbatim
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Requirements Inventory] — FR2 (date of birth is a profile field), NFR5 (EN/FR i18n), NFR6 (zero new dependencies)
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Additional Requirements] — shared `DatePicker` extension is additive with v9 prop names; `birth_date` is an ISO 8601 `String`; form field names are the snake_case IPC names; conditional validation lives in `profile_store.rs`; no SQLite work; no audit logging; no new `AppError` variant; inline `#[cfg(test)] mod tests` with `tempfile`; locale parity is enforced by `src/locales/__tests__/`
- [Source: _bmad-output/planning-artifacts/epics-user-profile.md#Epic 28: Your Nixus Cloud Profile] — forward-dependency check: `28.3 → 28.2` only
- [Source: _bmad-output/implementation-artifacts/28-2-record-my-name-so-its-remembered-next-time.md#Tasks / Subtasks] — the inherited surface this story extends: `useForm<ProfileFormData>` with snake_case field names (L200); the `onError` handler whose field allow-list is `"first_name" | "last_name"` and must gain `"birth_date"` (L204); `onSubmit` forwarding the five unrendered fields straight from the loaded profile as `data?.birth_date ?? null` (L203) — the line this story must repoint at the form value; and the mandatory `REQUIRED_KEYS` update in `profile-i18n.test.ts` (L224)
- [Source: _bmad-output/implementation-artifacts/28-2-record-my-name-so-its-remembered-next-time.md] — `UserProfile` / `UpdateUserProfileInput` already carry `birth_date: Option<String>` (L130-131), stored opaquely with validation explicitly deferred to this story (L153); `save_user_profile`'s seven-scalar signature (L179) and `useSaveUserProfile`'s invoke mapping (L193) are unchanged by this story
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Inherited Foundation Gap: `DatePicker` year navigation] — current props are only `{ value, onChange, disabled, placeholder }` with `defaultMonth` set internally; `calendar.tsx` already forwards all `DayPicker` props
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Frontend Architecture] — D12 (optional `captionLayout` / `startMonth` / `endMonth`, backward-compatible), D11 (no new `invoke` in always-mounted components)
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Data Architecture] — D8 date-of-birth validation: parseable ISO 8601 `YYYY-MM-DD`, not in the future, implied age 18–120, returning `AppError::Validation { field }`; D13 reuse existing error variants
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Implementation Patterns & Consistency Rules] — validation is server-authoritative; form field names are the snake_case IPC names so `field` maps to `setError(field)` with no translation table; absent values are `null`, never empty strings; `birth_date` is an ISO 8601 string, never a timestamp
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Corrections to Prior Decisions] — Correction 1 (`sub` validated, not slugged) and Correction 2 (`get_countries` / `get_subdivisions` replace `get_location_catalog`) are background only; neither is in this story's scope
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Gap Analysis Results] — G1 full-replace save semantics (`None` clears the field, which is what makes AC 7 a write of `null` rather than a no-op); "Verified technical assumption" confirming `react-day-picker ^9.14.0` in both packages
- [Source: _bmad-output/planning-artifacts/architecture-user-profile.md#Project Structure & Boundaries] — delta tree; `date-picker.tsx` is the sole `packages/shared` modification
- [Source: docs/project-context.md#Critical Implementation Rules] — rule 4 (dates always ISO 8601 `String`), rule 5 (`AppError` only), rule 7 (`noUnusedLocals` / `noUnusedParameters` are CI failures), rule 8 (never duplicate a component that exists in `packages/shared/src/ui/`), rule 9 (zero Rust/TS warnings before committing)
- [Source: docs/project-context.md#Testing Rules] — Vitest locale-parity specs; Playwright runs against the Vite dev server with `invoke` stubbed per spec; line 295 always-mounted-component mock trap
- [Source: packages/shared/src/ui/date-picker.tsx] — full current source quoted above; `handleSelect`'s `if (day)` guard is why a clear affordance is needed
- [Source: packages/shared/src/ui/calendar.tsx] — `type CalendarProps = React.ComponentProps<typeof DayPicker>` with `{...props}` spread; `CalendarProps` is exported for indexed-access typing
- [Source: packages/shared/package.json] — `"react-day-picker": "^9.14.0"`
- [Source: apps/desktop/package.json] — `"react-day-picker": "^9.14.0"`, `react-hook-form ^7.71.2`, `date-fns ^4.1.0`
- [Source: apps/desktop/src-tauri/src/db/account.rs#insert_account] — the field-scoped validation style to match (lines 117-139)
- [Source: apps/desktop/src-tauri/src/db/maintenance.rs#validate_service_date] — existing ISO-date + not-in-the-future validator (lines 558-581)
- [Source: apps/desktop/src-tauri/src/commands/auth.rs] — line 499 precedent for taking "now" as a parameter to keep a validator pure and testable
- [Source: apps/desktop/src-tauri/src/db/recurring.rs] — line 396 pinned `NaiveDate::from_ymd_opt(...)` test style
- [Source: apps/desktop/src-tauri/src/error.rs] — `AppError::Validation { message, field }` and its flat `{ type, message, field }` serialization (lines 41-50)
- [Source: apps/desktop/src/components/maintenance/LogCustomServiceForm.tsx] — `Controller` + `DatePicker` + `setError` + error-paragraph pattern (lines 46-60, 153-181)
- [Source: apps/desktop/src/components/settings/CredentialsForm.tsx] — `getErrorMessage(err)` reading `{ type, message }` off a rejected `invoke` (lines 23-36)
- [Source: apps/desktop/src/locales/__tests__/profile-i18n.test.ts] — `REQUIRED_KEYS` (lines 10-18) and the `"declares every profile key it ships"` exact-set assertion (lines 58-65) that new keys must be registered in
- [Source: apps/desktop/src/locales/en.json] / [Source: apps/desktop/src/locales/fr.json] — existing flat `profile.*` block (lines 40-46) and `toast.saveFailed` (line 578)

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — **385 passed; 0 failed** (baseline 375; +10 new `profile_store` tests)
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` — 1 warning total, the pre-existing `deref which would be done by auto-deref` at `src/commands/backup.rs:106`. Zero clippy output mentions `profile_store`, so this change introduced no new warning.
- `pnpm --filter @nixus/shared exec tsc --noEmit` — exit 0
- `pnpm --filter @nixus/desktop exec tsc --noEmit` — exit 0
- `pnpm --filter @nixus/desktop test` — **158 passed** (baseline 155; +3 from the new `REQUIRED_KEYS` entries), `profile-i18n.test.ts` 28 tests green including both parity assertions
- `pnpm --filter @nixus/desktop exec playwright test` — **366 passed, 0 failed**, matching baseline exactly. The first full run showed one failure in `expenses.spec.ts:426`; that spec passed 19/19 in isolation and the full suite passed 366/366 on re-run, so it was a load-related flake, not a regression. No existing spec was edited.
- `en.json` / `fr.json` key counts verified equal: 1199 each (1196 + 3).

### Completion Notes List

- **Task 1 — shared `DatePicker`.** Added `captionLayout?`, `startMonth?`, `endMonth?` to `DatePickerProps`, typed by indexed access off `CalendarProps`, and forwarded them to `<Calendar>`. No defaults, so `undefined` reaches `DayPicker` for callers that omit them. `mode="single"`, `selected`, `onSelect`, `defaultMonth`, `autoFocus` and the `onChange: (date: string) => void` signature are untouched. No dependency added; v9 prop names only.
- **Task 2 — call-site audit.** All nine pre-existing `<DatePicker` usages confirmed at the exact lines the story lists (`import.tsx:855`, `TransactionReviewCard`/`AutoCategorizedSummary:173`, `LogCustomServiceForm:163`, `LogServiceForm:131`, `IncomeEntryList:205`, `AddIncomeEntryForm:162`, `AddExpenseForm:207`, `ExpenseList:251`). None appears in `git status` — zero diff — and both `tsc` runs plus the full Playwright suite (including `import.spec.ts`'s trigger-label assertions) pass. `apps/web` has no usages.
- **Task 3 — `ProfileForm.tsx`.** Added `birth_date: string` to `ProfileFormData`, defaulted from `profile?.birth_date ?? ""` in the `reset` effect, and **repointed the 28.2 pass-through** — `birth_date` now reads from the submitted form value via `emptyToNull(form.birth_date)`, while `income_bracket`, `income_bracket_currency`, `country_code` and `subdivision_code` remain pass-throughs for Epic 29. Rendered with a single `Controller` wrapping the `DatePicker` (`captionLayout="dropdown"`, `startMonth`/`endMonth` from one `useMemo(..., [])`) plus the conditional `profile-birth-date-clear` ghost `Button`. `isNameField` was widened to `isProfileField` including `"birth_date"`; the `field` string is still passed to `setError` unmodified. No `rules`, no `required`, no `aria-required` — the field is optional. No `invoke()` added to any always-mounted component.
- **Task 4 — `profile_store.rs`.** Added `MIN_AGE_YEARS`/`MAX_AGE_YEARS` consts, a `birth_date_error` constructor, and the pure `validate_birth_date_at(Option<&str>, NaiveDate)`. `save_profile` calls it with `Local::now().date_naive()` before any filesystem work, so an invalid date rejects without touching the document. `birth_date` in the struct literal now comes from the validator instead of `normalize()`. Reused `AppError::Validation`; no new variant, no crate, no migration, no audit-log call, no `.unwrap()` outside tests.
- **DEVIATION (justified).** The story asserts `%Y-%m-%d` is strict enough to reject `"1985-3-14"`. It is not — `chrono` accepts unpadded components, and that test failed against a literal implementation. Rather than weaken the test, I added a canonical round-trip guard (`parsed.format("%Y-%m-%d") != trimmed` → reject). This keeps the story's stated reject-list intact and is what actually enforces AC 3's `"YYYY-MM-DD"` storage format; a value like `"1985-3-14"` would otherwise have been persisted un-padded.
- **Task 5 — Rust tests.** Ten new tests, all pinned to `NaiveDate::from_ymd_opt(2026, 8, 10)`, never `Local::now()`: valid date, future date, under-18, over-120, malformed (`not-a-date`, `14/03/1985`, `1985-3-14`, `1985-13-01`, `1985`), cleared (`None`, `""`, `"   "`), the three age boundaries (18 today accept / day-before-18th reject / 120 today accept), the leap-day case (born `2008-02-29` is 17 on `2026-02-28` and 18 by `2026-03-01`), a `tempfile` round-trip asserting the persisted JSON holds `"birth_date": "1985-03-14"` as a **string** and that a cleared save writes `null`, and a save-rejection test. Every failing case asserts `field == Some("birth_date")` exactly.
- **Task 6 — i18n.** `profile.birthDate`, `profile.birthDatePlaceholder`, `profile.birthDateClear` added to `en.json` and `fr.json` with FR values, and all three registered in `REQUIRED_KEYS` so the `"declares every profile key it ships"` exact-set assertion still holds. Not added to `ARIA_LABEL_KEYS`, `PLACEHOLDER_KEYS` or `ELLIPSIS_KEYS`. The placeholder is passed explicitly so the FR UI never shows `DatePicker`'s hardcoded English `"Pick a date"`.
- **Minor styling note.** The new error paragraph uses the repo-wide `text-caption text-over-ink` (33 other usages) as the story specifies. 28.2's two existing paragraphs in this file use `text-over`; those were left alone rather than "cleaned up".
- **Not done, deliberately:** no manual sign-in/relaunch round-trip — that gate requires an interactive Tauri build and a real Cognito session, which is outside what this run can observe. Everything else is machine-verified above. `sprint-status.yaml` was not touched (it was already modified in the working tree by 28.1/28.2).

### File List

- `packages/shared/src/ui/date-picker.tsx` — MODIFIED: three optional passthrough props forwarded to `Calendar`
- `apps/desktop/src/components/profile/ProfileForm.tsx` — MODIFIED: `birth_date` field, `Controller` + `DatePicker` with year dropdown, clear button, `""`→`null` on submit, `birth_date` moved off the pass-through, `onError` allow-list widened
- `apps/desktop/src-tauri/src/profile_store.rs` — MODIFIED: `validate_birth_date_at` + age consts + `save_profile` wiring + 10 unit tests
- `apps/desktop/src/locales/en.json` — MODIFIED: 3 new `profile.*` keys
- `apps/desktop/src/locales/fr.json` — MODIFIED: same 3 keys, FR values
- `apps/desktop/src/locales/__tests__/profile-i18n.test.ts` — MODIFIED: 3 new keys added to `REQUIRED_KEYS`

