# Deferred Work

## Native selects remaining outside this story's scope

- `src/components/import/AutoCategorizedSummary.tsx` (line ~114) — native `<select>` for category picker in auto-categorized summary
- `src/routes/import.tsx` (line ~402) — native `<select>` for category picker in unreadable transactions manual entry

Both should be converted to the new shadcn Select component for visual consistency on the import page.

## Auto-updater: manual "Check for updates" action

Add a "Check for updates" button in settings or help menu so users can re-check after dismissing the startup prompt, without needing to restart the app.

## Projection Scenarios (Goal 2)

**Context:** Split from the Projection page feature. Goal 1 (default projection view) must ship first.

**Scope:**
- Full scenario management: create, name, save, load, compare scenarios
- Interactive controls to tweak growth rates, monthly contributions, and assumptions
- Side-by-side comparison on the projection chart (multiple lines)
- Hypothetical asset modeling:
  - Buy a revenue property: purchase price, rental income, mortgage, expenses, appreciation
  - Buy a new house at a different price point
- Compare scenarios visually on the line chart

**Dependencies:** Requires the base projection page (Goal 1) to be implemented first.

## Y-axis negative value formatting

`useFormatAxisValue` in `src/hooks/useFormatCurrency.ts` formats negative values as `$-5K` instead of `-$5K`. Pre-existing issue, surfaced by projection review (projections can go negative for debt-heavy users).

## i18n Phase 2: Per-page translations and remaining gaps

- `useFormatAxisValue` in `src/hooks/useFormatCurrency.ts` — hardcoded `$` prefix, needs locale-aware formatting for chart axes
- `formatCurrencyAccessible` in `src/lib/formatCurrency.ts` — dead function with hardcoded English words ("negative", "dollars"). Either wire up with locale support or remove.
- Direct `formatCurrency` imports bypassing locale in: `AccountRow.tsx`, `AssetRow.tsx`, `NetWorthBreakdownBar.tsx`, `TransactionReviewCard.tsx` — should use `useFormatCurrency()` hook instead
- `ACCOUNT_TYPE_LABELS` and `ASSET_TYPE_LABELS` dictionaries — hardcoded English, need locale file entries
- All per-page toast messages (~50 calls) — hardcoded English across routes and components
- All per-page UI strings (page titles, form labels, empty states, validation messages, etc.)

## Chat: Non-existent conversation ID shows blank page

Navigating to `/chat?conversation=999` (non-existent) silently shows an empty chat page. Should validate the conversation exists or show a user-facing error/redirect.

## Chat: Search param validation accepts non-integer values

`validateSearch` in `chat.tsx` uses `Number.isFinite()` which accepts negative numbers and floats (e.g., `-1`, `3.7`). Should validate `Number.isInteger(conv) && conv > 0`.

## Download banner: Trans HTML brittleness in i18n values

`downloadBanner.macosBody` and `downloadBanner.windowsBody` (both locales) embed raw `<strong>` HTML tags as string content, which `react-i18next`'s `Trans` component parses naively. Translators who change tag casing or add attributes will silently break the output. Consider switching to i18next interpolation syntax (`<1>text</1>`) for robustness.

## Download banner: stale InstallInstructions references in untouched files

Comments in `apps/web/src/features/download/DownloadStateContext.tsx` and `apps/web/src/features/download/DownloadCTA.test.tsx` still reference `<InstallInstructions />` by name, which was deleted. Update these comments when the files are next touched.

## Download banner: SUPPORT_EMAIL not a shared constant

`SUPPORT_EMAIL` is hardcoded in `DownloadBanner.tsx`. If this email is used elsewhere, consider extracting to a shared constants file to prevent divergence.

## Credit card interest modeling in projections

The projection page treats credit card debt at 0% growth (static balance). In reality, unpaid credit card debt accrues ~20% interest. Consider adding a configurable rate for credit card debt in Goal 2 scenarios.

## fr.json: duplicate `expenses.merchant` key

`apps/desktop/src/locales/fr.json` defines `"expenses.merchant"` twice (lines ~372 and ~374), silently shadowing one value. Pre-existing, unrelated to any current feature — remove the duplicate.

## Chat: assistant "busy" state is encoded via magic content strings

`ChatMessageBubble.tsx` infers UI state from sentinel content values (`content === ""` for "thinking", `content === "tool-searching"` for tool execution) instead of an explicit status enum from `useChat`. Real assistant text could theoretically collide with these sentinels, and the state machine is implicit. Consider adding an explicit `status: "idle" | "thinking" | "tool-executing" | "streaming"` field to `useChat`'s message/hook state.

## Chat: no component test coverage for ChatMessageBubble

There are no tests for `ChatMessageBubble.tsx` (thinking indicator, tool-searching indicator, action confirmation card, markdown rendering). Bootstrapping component tests for this file is a larger lift than any single chat UI tweak — track separately.

## Chat: bouncing/spinning indicators ignore `prefers-reduced-motion`

Both the "thinking" dots and the "tool-searching" spinner in `ChatMessageBubble.tsx` animate unconditionally. Users with a reduced-motion preference still see the animation. Systemic accessibility gap, not introduced by any single change — consider a `motion-reduce:animate-none` (or equivalent) treatment across all chat indicators.

