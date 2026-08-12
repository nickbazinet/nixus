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

## In-flight commands can hit FK errors after a Danger Zone wipe

`DbState` is a single `Mutex<Connection>`, and several commands release the lock across
`.await` boundaries (e.g. `send_chat_message` at `commands/chat.rs:170-294`, which re-locks
to insert the assistant reply at `chat.rs:288`). If `delete_all_data` commits between those
lock releases, the queued write references a parent row that no longer exists and fails with
a raw `FOREIGN KEY constraint failed` `AppError::Database`. The window is small (the wipe is
immediately followed by `relaunch()`), and the same exposure predates the Danger Zone for any
frontend state holding stale ids. Fixing it properly means graceful "record was deleted"
handling across all mutation commands, not a Danger Zone patch.

## `SetupIncompleteBanner` copy misattributes a Danger Zone wipe to skipped onboarding

Because the wipe preserves `config.onboarding_completed` by design, `check_onboarding_status`
(`commands/onboarding.rs:20,24-25`) returns `setup_incomplete: true` after a wipe, so the
dashboard shows `dashboard.setupIncompleteBody` — "You skipped setup, so there's no budget
data yet." The user did not skip setup. The Danger Zone flow now clears the banner's
`finance.onboarding.dismissed` localStorage flag so the banner reliably reappears as the
recovery path, but the wording is still wrong for this case. Needs a product copy decision:
either neutral copy ("No budget data yet — set one up") or a distinct post-wipe variant.

## No component test coverage for `DangerZone.tsx`

Double-click guarding, Esc/overlay dismissal mid-delete, dialog reopened after an error,
whitespace-padded paste into the confirm input, and `relaunch()` failure are all unverified by
automated tests. `apps/desktop` has no React component test infrastructure (no
`@testing-library/react`), so bootstrapping it is a new dependency decision, not part of this
change.

## Post-wipe `VACUUM` failure is invisible to the user

`commands/danger_zone.rs` logs a `warn!` and returns `Ok(())` when
`db::danger_zone::reclaim_space` fails. The rows are gone, so this is deliberate, but a
systematically failing `VACUUM` (e.g. too little free disk for its temp copy — plausible for a
user wiping data specifically to reclaim space) leaves the file un-shrunk with no UI signal.

## Deferred from: code review of 24-2-import-validation-for-untrusted-template-files (2026-08-04)

- **TOCTOU between the size guard and the read in `import_budget_template_from_path`**
  (`apps/desktop/src-tauri/src/db/budget_template.rs`): the 1 MiB cap is checked via
  `std::fs::metadata(path).len()`, then the file is read via a separate `std::fs::read_to_string(path)`
  call. A file grown/replaced/symlink-swapped between the two syscalls bypasses the size guard for the
  actual read. Fixing this properly means switching to `File::open` + `file.metadata()` (fstat on the open
  handle) + a length-capped `Read` adapter instead of two independent path-based operations — a
  read-strategy change, not a one-line patch. Low real-world risk on a local-first, single-user desktop app
  (requires a concurrent local process racing the exact file the user just picked via the OS dialog).
- **No `is_file()` guard before reading the selected path**
  (`apps/desktop/src-tauri/src/db/budget_template.rs`, `import_budget_template_from_path`): a symlink to a
  FIFO or special device file could report a misleading size via `metadata()` and then hang
  `read_to_string` indefinitely (FIFO with no writer) or stream unbounded data (device node). Not currently
  reachable through the actual UI flow (the native file-picker dialog only lets the user select regular
  files), but worth closing as defense-in-depth alongside the TOCTOU item above in the same follow-up pass.

## Deferred from: code review of 24-3-export-current-budget-as-shareable-template (2026-08-04)

- **`ensure_json_extension` post-dialog rename can bypass the OS save dialog's own overwrite confirmation**
  (`apps/desktop/src-tauri/src/commands/budget_template.rs::export_budget_template`,
  `apps/desktop/src-tauri/src/db/budget_template.rs::ensure_json_extension`): the `.json` extension is
  appended *after* `blocking_save_file()` has already resolved, so any overwrite confirmation the native
  dialog shows runs against the name the user actually typed (e.g. `foo`), not the final normalized name
  (`foo.json`). If `foo` doesn't exist but `foo.json` already does (e.g. a prior export), `std::fs::write`
  silently overwrites `foo.json` with no confirmation shown for that name.
  **Decision: accept as-is.** Impact is bounded to overwriting a previously-exported **template file**
  (never live budget data — the DB is untouched by export), and the behavior matches the existing
  `commands/backup.rs` save-dialog precedent (no post-dialog rename step, but the same
  "OS confirms the typed name, not any name the app might still transform" class of gap in spirit). Fixing
  it here alone, ahead of `backup.rs`, would introduce an inconsistency between the two save-dialog flows.
  A proper fix belongs with a broader save-dialog UX pass across both commands, not a single-story patch.

## Deferred from: code review of 24-4-import-a-community-template-file (2026-08-04)

- **Playwright canned-error-string duplication** (`apps/desktop/tests/budget-templates.spec.ts`): 2 of the 4
  canned Rust messages from `db/budget_template.rs:40-46` (`MSG_INVALID_FILE`, `MSG_NOTHING_TO_EXPORT`) are
  hardcoded verbatim as mock reject payloads instead of shared from one source of truth. If the Rust copy
  changes, this E2E suite keeps passing against the stale string while the live app shows the new one.
  **Not introduced by this story** — every Rust-backed Playwright spec in this repo already mocks IPC this
  way (`tests/import.spec.ts`, `tests/accessibility.spec.ts`). Fixing it means a repo-wide shared-fixtures
  pass (e.g. a generated constants module bridging `db/budget_template.rs`'s consts into a TS fixture), not
  a one-file patch.
- **`budgetSummary`/`topBudgetCategories` query keys are never invalidated by any budget mutation**
  (`apps/desktop/src/hooks/useDashboard.ts` defines the queries; `apps/desktop/src/hooks/useBudget.ts` and
  the new `useBudgetTemplates.ts` both omit them from every `onSuccess`): a user sitting on the Dashboard or
  Budget page when a template import completes can see a stale summary/top-categories card until the next
  window focus or route remount (TanStack Query default `staleTime: 0` covers the remount case, but not a
  same-page redraw). **Not introduced by this story** — `useCreateBudgetCategory`/`useUpdateBudgetCategory`/
  `useDeleteBudgetCategory` have the identical gap today, predating this story by several epics. A fix
  belongs to a systemic invalidation-set review across all budget-mutating hooks, not a single-story patch.

## Deferred from: code review of 25-3-settings-templates-section-wiring (2026-08-04)

- **A previously-undocumented flaky-under-parallelism Playwright test surfaced during full-suite review:**
  `tests/maintenance.spec.ts:1290 › Maintenance Page › adding a vehicle starts schedules from current
  odometer and shows success toast` failed once during a full-suite run (`322 passed, 2 failed` alongside
  the documented `chat.spec.ts:250`) but passed 1/1 in isolation. It shares zero surface with story 25-3
  (Settings/budget-templates) and was not on the story's own carried-forward flaky list
  (`accounts.spec.ts:333`, `accounts.spec.ts:472`, `expenses.spec.ts:426`, `maintenance.spec.ts:1561`,
  `maintenance.spec.ts:1436`) — a different flaky test manifested this run, which means that list is
  illustrative of a general parallelism-contention class in this suite, not exhaustive. **Not introduced
  by this story.** A fix belongs to a suite-wide test-isolation pass (likely a shared fixture/DB-state race
  between vehicle/maintenance specs under parallel workers), not a single-story patch. Re-run the full suite
  a few times before attributing any future maintenance/vehicle-slide-over failure to a specific story.

## Deferred from: code review of 25-4-starter-template-path-in-onboarding-fork (2026-08-04)

- **Duplicate override entries for the same (group, category) pair are silently resolved first-wins, not
  rejected** (`apps/desktop/src-tauri/src/budget/template_defaults.rs::merge_target_overrides`/
  `find_override`, lines 68-76): `find_override` resolves via `.find()`, so if a caller's `overrides` list
  contained two entries addressing the identical `(group_name, category_name)` pair, the first one wins and
  the second is silently discarded — no validation rejects the duplicate.
  **Decision: accept as-is, defer.** The case is unreachable through the shipped UI — `buildOverrides` in
  `apps/desktop/src/components/onboarding/OnboardingStarterTemplate.tsx` builds its overrides array from a
  `Map` keyed by category, so it can structurally emit at most one entry per category and can never produce
  a duplicate pair. The first-entry-wins behavior is now locked by a regression test
  (`merge_with_duplicate_overrides_for_the_same_pair_uses_the_first_entry` in `template_defaults.rs`) added
  during this story's code review, so a future refactor toward last-wins (or outright rejection) would be a
  deliberate, reviewed change rather than an accidental one. Adding a defensive rejection at the Rust
  boundary today would be speculative hardening against a caller that does not exist.
  **Revisit if:** a future caller can construct raw override lists outside the shipped UI's diffing logic —
  e.g. a public API, a scripted/bulk-import apply path, or an AI-driven apply flow — at which point duplicate
  (group, category) pairs in a single request should be rejected with `AppError::Validation` rather than
  silently resolved.

## Deferred from: code review of 26-3-deep-link-and-single-instance-plugin-registration (2026-08-09)

- **`chat.spec.ts:250` font-family assertion fails** (`apps/desktop/tests/chat.spec.ts:250`): genuine Playwright
  failure, but **pre-existing on `master`** and not caused by Story 26.3.
  **Evidence:** Story 26.3 modifies zero frontend source files — `git status --porcelain` filtered to
  `\.(css|ts|tsx|js|jsx)$` returns nothing, and `git status --porcelain -- 'apps/desktop/src/' 'packages/'`
  returns nothing (the only non-Rust changes are `apps/desktop/package.json` and `pnpm-lock.yaml`).
  Playwright also never compiles or launches the Rust binary (`playwright.config.ts` runs `pnpm run dev`
  against Vite on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per spec), so the plugin
  registration this story adds is structurally unreachable from these specs.
  **Most plausible origin:** commit `9b45411 "UI: Implement new color scheme"`.
  **Revisit if/when:** triaged as its own bug against the color-scheme change — it is not a gate Story 26.3
  can clear or has affected.

- **`design-system.spec.ts:110` CSS custom-property assertion fails**
  (`apps/desktop/tests/design-system.spec.ts:110`): same classification, same evidence, and same most-plausible
  origin (`9b45411`) as the item above. Should be triaged together with it.
  Note: the other two failures in the same run (`expenses.spec.ts:666`, `maintenance.spec.ts:1318`) pass when
  re-run in isolation and are flaky timing, not defects — they are deliberately **not** recorded here.

## Deferred from: 26-1-cognito-user-pool-and-public-app-client-setup (2026-08-09)

- **Google social identity provider (federated sign-in) is deferred — Story 26.1 AC 4 and AC 10 are NOT met.**
  **Decision: deferred by explicit user decision during provisioning.** A Google Cloud OAuth 2.0 Web
  application client was **never created**, so no Google IdP could be registered on the Cognito user pool.
  **Evidence / why:** `Google` was briefly ticked in the app client's supported identity providers, which
  rendered a "Continue with Google" button on the managed login page, but clicking it failed with
  `errorMessage="Login option is not available. Please try another one"` — the expected Cognito response when
  an app client lists an identity provider that does not exist on the pool. `Google` is therefore being
  un-ticked on the app client: shipping a visible button that always errors is a worse user experience than
  shipping no button at all.
  **Consequences to carry forward:**
  - AC 5's `SupportedIdentityProviders` is `COGNITO` only, not `COGNITO` + `Google`.
  - Story 26.1 AC 9 (email/password end-to-end) passed; AC 10 (Google end-to-end) is untested and unmet.
  - Story 26.1 AC 6's "`name` and `email` are in the app client's read attributes" could not be positively
    confirmed, because with `email` as the only required attribute and no federated user in existence, no
    user carrying a `name` attribute exists — so the `name` claim's absence from the `id_token` cannot
    distinguish "no name stored" from "read attribute not granted". Moot for v1.
  - Story 27.3 AC 5's email-only degradation path (no `name` claim) is now the **only** path exercised in
    v1, not an edge case.
  **Revisit if/when:** Google federation is wanted. The work is then: create the Google Cloud OAuth Web
  client (authorized JS origin `https://auth.nixusapp.com`, redirect URI
  `https://auth.nixusapp.com/oauth2/idpresponse`), add Google as a Cognito social IdP with scopes
  `profile email openid` and attribute mapping `email`→`email` / `name`→`name`, re-tick `Google` on the app
  client, **re-verify the `name`/`email` read attributes**, and note that account linking is not automatic
  (an email/password user and a Google user with the same address become two distinct `sub`s).

## Parking lot: AI Access Proxy — Bedrock access included in paid tiers, quota-capped by subscription (2026-08-10)

**Not yet architected** — this is a captured first-pass discussion + decision, to be turned into a full `bmad-create-architecture` pass (alongside `architecture-entitlements-licensing.md` and `architecture-login.md`) when picked back up.

**Context:** With Cognito login (`architecture-login.md`) and LemonSqueezy/Keygen entitlements (`architecture-entitlements-licensing.md`) both shipped independently, the question came up: could paying users get AWS Bedrock access without entering their own AI API key (today's model — see README, "AI import requires your own API credentials")?

**Decision made so far:** Rather than vending raw Cognito Identity Pool + IAM credentials directly to the desktop app (which has no per-user request quota — IAM is allow/deny, not a metering engine, and a user or extracted credential could call Bedrock directly outside the app), the chosen shape is a **thin Lambda proxy in front of Bedrock**, gated by subscription tier, giving an actual enforcement point for usage caps. Feels "unlimited" to the user in normal use, but is capped per tier under the hood — sized to make an abusive/outlier user's cost bounded rather than open-ended.

**Cost grounding (checked 2026-08-10):** app currently uses `us.anthropic.claude-sonnet-4-6` on Bedrock, priced at $3/MTok input, $15/MTok output (standard on-demand, global cross-region). Estimated light-user cost ~$0.90/month, heavy-user ~$5-15/month — average is absorbable in a subscription price, but *outlier* usage (not the average) is the real risk a flat unmetered plan can't bound, which is why the proxy/quota shape was chosen over raw IAM vending.

**Architectural implications identified, not yet resolved:**
- Cognito Groups become the tier signal for this feature specifically (read from the verified JWT's `cognito:groups` claim at the proxy) — this is a deliberate, narrow use of Cognito Groups for authorization, limited to already-online/already-logged-in features. It should **not** be extended to gate the offline-first Finance/Car modules (those stay on Keygen per `architecture-entitlements-licensing.md`'s local-first requirement).
- `apps/api-licensing` (the LemonSqueezy → Keygen webhook bridge) would gain a second responsibility: syncing Cognito group membership (`AdminAddUserToGroup`/`AdminRemoveUserFromGroup`) when a subscription's tier changes, in addition to its existing Keygen entitlement sync.
- **Unresolved identity-linking problem:** the proxy needs to know which Cognito `sub` corresponds to which LemonSqueezy subscription. Today, login (Cognito) and purchase (LemonSqueezy) are two independent flows with no guaranteed matching email. Needs a decision: require login with the purchase email, or an explicit "link my subscription" step (e.g., enter license key while logged in).
- Unresolved: quota numbers per tier, proxy request/response shape, and where rate-limit counters live (a single Lambda invocation has no memory across requests — needs a store, e.g. DynamoDB per-user/per-period counters, not an in-process counter).

**Revisit if/when:** ready to formalize — run `bmad-create-architecture` scoped to this feature (working title: `architecture-ai-access-proxy.md`), resolving the identity-linking approach and quota tiers as part of that pass.

## Deferred from spec-recurring-income review (2026-08-10)

Findings from the three-reviewer pass on `spec-recurring-income.md` that were classified **defer** —
pre-existing patterns or enhancements, not defects introduced by that story. Patch-class findings were
fixed in the story itself; the one intent-level finding is tracked separately in that spec.

**Pre-existing patterns the recurring-expense feature shares (fix both together, or neither):**
- **Template edit re-runs history.** `recurring_expense_templates` dedupes on `merchant + date + amount_cents`
  and always replays from `created_at`, so editing a template's amount or day re-creates every past
  occurrence. Identical shape in recurring income (see that spec's change log). A shared fix would add a
  `template_id` column to `expenses` / `income_entries` and dedupe on `(template_id, year-month)`.
- **Reactivation backfills the pause window.** Toggling a template off then on re-creates every month
  missed while it was off, because nothing records the deactivation date. Affects expenses and income.
- **UTC `created_at` vs local `today`.** Templates default `created_at` to `datetime('now')` (UTC) while
  the apply loop compares against `chrono::Local::now()`, so a template created near midnight in a
  non-UTC zone can gain or lose its first occurrence. Affects expenses and income.
- **`amount_cents` has no upper bound.** Only `> 0` is enforced. A value near `i64::MAX` added to
  `accounts.balance_cents` would overflow into SQLite REAL and permanently lose cents precision.
  Applies to expenses, income entries, and both template tables.
- **Row toggles send the whole cached record.** The active switch in `RecurringTemplateList` resends every
  field from the React Query cache, so a concurrent edit elsewhere can be silently reverted. A partial
  `set_active` command would remove the lost-update window. Affects both kinds.
- **Empty numeric input yields `NaN`.** `register("day_of_month", { valueAsNumber: true })` produces `NaN`
  on an emptied field, which `min`/`max` rules do not reject, so the user gets a generic save-failed toast
  instead of a field error. Same code in the expense and income template forms.
- **Not-found returned as `AppError::Database`.** `update_template` / `delete_template` report a missing id
  as a database fault in both the expense and income modules, so callers cannot distinguish "gone" from
  "broken".
- **Failed template query looks like an empty list.** The recurring hooks expose no `isError`, and the page
  defaults to `[]`, so a failed `invoke` renders "$0.00" and an empty table rather than an error state.
  Matches the prevailing pattern across the app's hooks.

**Enhancements, not defects:**
- **No on-demand apply for recurring income.** Expenses expose `apply_recurring_expenses`; income applies
  only at launch (as the spec scoped it). A template created after its due day therefore does nothing until
  the next app start. Registering an `apply_recurring_income` command and calling it after create/activate
  would close the gap.
- **Startup holds the DB mutex across both backfills.** `lib.rs` evaluates the expense and income applies
  in one `match` arm, so the single connection mutex is held for both. Persisting a `last_applied_month`
  per template (instead of always walking from `created_at`) would bound the work and shorten the hold.
- **Deleting a linked account silently unlinks templates.** `ON DELETE SET NULL` leaves the template active
  but no longer crediting anything, and the recurring table shows no account column, so the change is
  invisible to the user.
- **Pre-existing clippy warning.** `commands/backup.rs:106` `explicit_auto_deref`. Present at baseline
  `50cb155`, untouched by the recurring-income story, and the only warning the workspace emits.

## Deferred from spec-ai-import-propose-category review (2026-08-12)

Three-reviewer pass (blind hunter, edge case hunter, acceptance auditor) on the AI-proposed-category
import feature. Patch-class findings (confidence gating, malformed-proposal deserialization, empty-groups
prompt section, retry/race conditions, hallucinated `group_id`/`group_name` sanitization, Alert layout,
proposal hidden on resolved/deselected rows) were fixed in the story itself. The following are out of
scope for this story:

- **No dedupe against existing categories/groups by name.** The AI can propose a name that already exists
  (e.g. "Groceries") because it wasn't confident enough to pick it; nothing checks for a case-insensitive
  match before creating. `budget_template.rs` (lines ~151-171) already solved this exact problem for the
  template-importer feature — a shared dedupe helper reused by both paths would close this properly.
  Neither `budget_groups` nor `budget_categories` has a `UNIQUE` constraint at the DB layer either.
- **No "apply to all" wiring for same-merchant flagged rows.** `flaggedGroups` already buckets rows by
  merchant for the existing "apply to all" affordance, but the propose-category button is per-card only —
  N rows with the identical AI-generated proposal (same merchant, multiple statement lines) create N
  duplicate categories/groups instead of one. Wiring the created category id back into the whole merchant
  group is a reasonable follow-up, not a one-line patch.
- **Group/category creation is two non-atomic Tauri calls, not a DB transaction.** The spec's frozen intent
  explicitly requires reusing the existing `create_budget_group`/`create_budget_category` commands with no
  new DB write path. A local group-id cache (added in this story) prevents a duplicate group on *retry*,
  but a user who creates the group then abandons the row entirely can still be left with an empty orphan
  group. A fully atomic fix means a new backend command wrapping both inserts in one
  `conn.unchecked_transaction()` (mirroring `apply_template_inner`) — an architecture change beyond this
  spec's boundaries.
- **No merchant-hint recording for AI-created categories.** Confirming an import records merchant hints for
  transactions with a `suggested_category_id`, but the new create-from-proposal path never calls the
  hint-recording path for the newly created category, so next month's statement re-proposes the same
  category for the same merchant instead of matching it via the hint system.
- **No Playwright coverage for the retry/race/dedupe edge cases** — a happy-path test was added in this
  story (`tests/import.spec.ts`), but the concurrent-click race, retry-after-failure group reuse, and
  cross-row duplicate-proposal scenarios above remain unverified by automation.

