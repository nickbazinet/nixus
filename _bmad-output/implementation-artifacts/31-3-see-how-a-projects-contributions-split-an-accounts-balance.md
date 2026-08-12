# Story 31.3: See how a project's contributions split an account's balance

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Nixus user,
I want to see how much of an account's balance is earmarked for each project versus unallocated,
so that I don't mistake earmarked money for money I'm free to spend.

## Acceptance Criteria

1. **Given** an account with contributions logged toward one or more projects
   **When** I view that account on the Accounts page
   **Then** I see a breakdown showing unallocated balance plus one segment per project, summing exactly to the account's `balance_cents`

2. **Given** an account with no project contributions
   **When** I view that account
   **Then** no earmark breakdown is shown (clean empty state, not a degenerate single-segment bar)

3. **Given** the breakdown is rendered
   **When** the component tree is inspected
   **Then** it reuses the existing stacked-bar + legend component already used for net-worth composition, introducing no new visual primitive

4. **Given** an account whose earmarked total exceeds its balance
   **When** the breakdown is computed
   **Then** `unallocated_cents` is reported as the true (negative) difference rather than clamped, so the segments still account for every cent and the over-earmarked state is visible rather than hidden

5. **Given** the earmark breakdown command
   **When** it runs
   **Then** it performs zero writes and never touches the `accounts` write path

## Tasks / Subtasks

- [x] **Task 1 — Models for the breakdown** (AC: #1, #4)
  - [x] In `apps/desktop/src-tauri/src/models/mod.rs`, add:
    ```rust
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AccountEarmarkSegment {
        pub project_id: i64,
        pub project_name: String,
        pub earmarked_cents: i64,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AccountEarmarkBreakdown {
        pub account_id: i64,
        pub balance_cents: i64,
        pub earmarked_cents: i64,
        pub unallocated_cents: i64,
        pub segments: Vec<AccountEarmarkSegment>,
    }
    ```
  - [x] Derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`, `snake_case` fields, no `rename_all`. `AccountEarmarkBreakdown` is the struct named in the architecture; `AccountEarmarkSegment` is its per-project element.
- [x] **Task 2 — `db/projects.rs`: the aggregation (TDD each assertion)** (AC: #1, #2, #4, #5)
  - [x] Add `pub fn get_account_earmark_breakdown(conn: &Connection, account_id: i64) -> Result<AccountEarmarkBreakdown, AppError>` to `apps/desktop/src-tauri/src/db/projects.rs`.
  - [x] Read the account's balance first: `SELECT balance_cents FROM accounts WHERE id = ?1`. If the account does not exist, return `AppError::Validation { message: "Account not found", field: Some("account_id") }` (the `db/account.rs:317-322` mapping idea) — never fabricate a zero-balance breakdown for a missing account.
  - [x] Run the grouped segment query exactly as written in Dev Notes → "The aggregation query", joining `project_contributions` to `projects` to get `project_name`, grouped by `project_id`, ordered `earmarked_cents DESC, p.name`.
  - [x] Compute `earmarked_cents` as the sum of the segment values (or a second `COALESCE(SUM(...), 0)` over the same `WHERE account_id = ?1`), and `unallocated_cents = balance_cents - earmarked_cents`. **Do not clamp to zero** (AC #4).
  - [x] Include contributions toward **archived** projects in the segments. Rationale and the exact hazard are in Dev Notes → "Archived projects are included, deliberately" — omitting them breaks the sum-to-balance invariant this story exists to guarantee.
  - [x] `COALESCE(SUM(amount_cents), 0)` on every aggregate — `SUM` over zero rows is `NULL` in SQLite and would fail the `i64` row-get (precedent `db/account.rs:106`, `:122`).
  - [x] This function performs **no writes**. No `UPDATE`, no `INSERT`, no `DELETE`, and specifically no write to `accounts` (AC #5).
- [x] **Task 3 — Command + registration** (AC: #1, #5)
  - [x] In `apps/desktop/src-tauri/src/commands/projects.rs`, add:
    ```rust
    #[tauri::command(rename_all = "snake_case")]
    pub fn get_account_earmark_breakdown(
        state: State<DbState>,
        account_id: i64,
    ) -> Result<AccountEarmarkBreakdown, AppError>
    ```
    locking with `state.0.lock().map_err(|e| AppError::Database { message: e.to_string() })?` and delegating straight to `projects_db::get_account_earmark_breakdown`.
  - [x] **No audit log** — this is a read. A `get_*` command that writes anything (including an audit row) violates the architecture's enforcement rules.
  - [x] Register `commands::projects::get_account_earmark_breakdown` in the `generate_handler![...]` list in `apps/desktop/src-tauri/src/lib.rs`, beside the other project commands.
- [x] **Task 4 — Frontend types, query key, hook** (AC: #1, #2)
  - [x] Add `AccountEarmarkSegment` and `AccountEarmarkBreakdown` interfaces to `apps/desktop/src/lib/types.ts`, mirroring the Rust shapes.
  - [x] Add `accountEarmarks: (accountId: number) => ["account-earmarks", accountId] as const` to `queryKeys` in `apps/desktop/src/lib/constants.ts` — this is the key name the architecture specifies (`accountEarmarks(accountId)`).
  - [x] Add `useAccountEarmarkBreakdown(accountId: number)` to `apps/desktop/src/hooks/useProjects.ts` — a plain `useQuery` calling `invoke<AccountEarmarkBreakdown>("get_account_earmark_breakdown", { account_id: accountId })`.
  - [x] **Wire the invalidation this story is responsible for:** add `queryClient.invalidateQueries({ queryKey: queryKeys.accountEarmarks(accountId) })` to the `onSuccess` of `useCreateProjectContribution` and `useDeleteProjectContribution` (created in Story 31.2). For create, `accountId` comes from the mutation input; for delete, from the returned deleted row (this is why `delete_project_contribution` returns the row). Also invalidate it in `useArchiveProject`'s `onSuccess`, since archiving changes a segment's label state on screen.
  - [x] Because a single mutation can only invalidate the accounts it knows about, also accept the coarser fallback where needed: `queryClient.invalidateQueries({ queryKey: ["account-earmarks"] })` invalidates every account's breakdown by key prefix. Prefer the precise key; use the prefix form only in `useArchiveProject`, where no single account is implicated. Document the choice with a one-line WHY comment.
- [x] **Task 5 — `AccountEarmarkBar.tsx`** (AC: #1, #2, #3)
  - [x] Create `apps/desktop/src/components/projects/AccountEarmarkBar.tsx` taking a single `account: Account` prop and calling `useAccountEarmarkBreakdown(account.id)` itself. One component instance per account is what makes a `.map()` over accounts legal — never call the hook in a loop in the parent.
  - [x] Return `null` when the query is loading, errored, or when `segments.length === 0`. AC #2 requires *no* bar for an account with no contributions, and `NetWorthBreakdownBar`'s own `segments.length === 0` early return (`NetWorthBreakdownBar.tsx:118`) is not sufficient on its own: a single "unallocated" segment is non-zero, so the bar would render as one full-width band — exactly the "degenerate single-segment bar" the AC forbids.
  - [x] Map the backend shape to `NetWorthBreakdownCategory[]` (`lib/types.ts:197-202`): one entry per project segment plus a final unallocated entry:
    ```typescript
    const breakdown: NetWorthBreakdownCategory[] = [
      ...data.segments.map((s) => ({
        name: s.project_name,
        cents: s.earmarked_cents,
        percentage: 0,
        color: "",
      })),
      { name: t("projects.unallocated"), cents: data.unallocated_cents, percentage: 0, color: "" },
    ];
    ```
  - [x] `percentage: 0` and `color: ""` are correct, not placeholders: `NetWorthBreakdownBar` recomputes each segment's share from `cents` (`NetWorthBreakdownBar.tsx:73-94`) and **deliberately discards the incoming `color`** in favour of its own rank-ordered luminance ramp (see the comment at `NetWorthBreakdownBar.tsx:80-83`). Passing a colour would be ignored; passing a percentage would be ignored.
  - [x] Render `<NetWorthBreakdownBar breakdown={breakdown} titleKey="projects.accountEarmarkTitle" />` and put the **account name in a heading in this wrapper**, above the card. `NetWorthBreakdownBar` calls `t(titleKey)` with no interpolation (`:109`, `:123`), so the account name cannot travel through `titleKey`.
  - [x] **Do not modify `components/net-worth/NetWorthBreakdownBar.tsx`.** It is net-worth's component, consumed read-only by this feature (architecture: "Component Boundaries"). If it looks like it needs a prop, wrap it instead.
  - [x] Add a `data-testid` (e.g. `account-earmark-bar`) on the wrapper for the E2E assertions.
- [x] **Task 6 — Wire into the Accounts page** (AC: #1, #2)
  - [x] In `apps/desktop/src/routes/wealth.accounts.tsx`, render one `<AccountEarmarkBar account={account} />` per account, inside the existing `!isLoading && accounts && accounts.length > 0` block, placed **after** the existing `accounts-breakdown` `NetWorthBreakdownBar` block (`wealth.accounts.tsx:308-315`) and before or after the accounts table — pick one and keep it consistent.
  - [x] Wrap the group in a container with `data-testid="accounts-earmarks"`. Each child self-suppresses when it has no segments (Task 5), so no filtering logic is needed in the route and no extra query is needed to decide whether the section exists.
  - [x] Do **not** embed the bar inside `components/accounts/AccountRow.tsx`: that component renders a `TableRow` (`AccountRow.tsx` returns `TableRow`/`TableCell`), and mounting a `Card` inside a table row breaks the table semantics the accounts table relies on.
  - [x] Keep the existing `Alert` at `wealth.accounts.tsx:304-306` ("balances are typed in, nothing in the app moves them") — it is now doubly true and must not be removed.
- [x] **Task 7 — i18n keys in both locales** (AC: #1, #3)
  - [x] Add the keys from Dev Notes → "i18n keys" to `apps/desktop/src/locales/en.json` **and** `fr.json` in the same change.
  - [x] Extend `REQUIRED_KEYS` in `apps/desktop/src/locales/__tests__/projects-i18n.test.ts`.
  - [x] `NetWorthBreakdownBar` also reads `netWorth.breakdown.orderNote`, `netWorth.breakdown.tableCaption`, `netWorth.breakdown.colType`, `netWorth.breakdown.colAmount`, `netWorth.breakdown.colShare` (`:124`, `:155-162`). Those keys already exist and are reused as-is — do **not** duplicate them into the `projects.*` namespace.
- [x] **Task 8 — Rust unit tests (write first)** (AC: #1, #2, #4, #5)
  - [x] Extend `db/projects.rs`'s `#[cfg(test)] mod tests` using the existing `projects_test_db()` helper (it already creates `accounts`, `projects`, `project_contributions` with `PRAGMA foreign_keys=ON`).
  - [x] Test (**the SC4 invariant**): one account with `balance_cents = 1_000_000` and contributions of `300_000` and `100_000` to two different projects → `segments.len() == 2`, `earmarked_cents == 400_000`, `unallocated_cents == 600_000`, and `segments.iter().map(|s| s.earmarked_cents).sum::<i64>() + unallocated_cents == balance_cents`. Assert the sum identity explicitly, not just the individual numbers.
  - [x] Test: several contributions to the **same** project collapse into one segment whose `earmarked_cents` is their sum (proves the `GROUP BY`).
  - [x] Test: an account with no contributions → `segments.is_empty()`, `earmarked_cents == 0`, `unallocated_cents == balance_cents` (AC #2 — the *frontend* suppresses the bar; the command still answers honestly).
  - [x] Test: contributions from a *different* account are excluded from this account's segments.
  - [x] Test (AC #4): earmarked total greater than balance → `unallocated_cents` is negative and equals `balance_cents - earmarked_cents`; the sum identity still holds.
  - [x] Test: a contribution toward an **archived** project still appears as a segment (Dev Notes → "Archived projects are included, deliberately"), so the sum identity survives archiving.
  - [x] Test: unknown `account_id` → `AppError::Validation` with `field == Some("account_id")`.
  - [x] Test (AC #5): `balance_cents` in the DB is unchanged after calling `get_account_earmark_breakdown`, and `SELECT COUNT(*)` on `project_contributions` is unchanged (a read that writes nothing).
- [x] **Task 9 — Playwright / spec-mock audit (mandatory — this changes a widely visited surface)** (AC: #1, #2)
  - [x] `/wealth/accounts` now invokes `get_account_earmark_breakdown` once per account. Every spec that navigates there must gain a mock case or its `invoke` mock falls through to `Promise.reject("Unknown command")` and the section renders in its error state (`docs/project-context.md:295`). Audit **all four**: `apps/desktop/tests/accounts.spec.ts` (mock switch at `:29-150`), `apps/desktop/tests/accessibility.spec.ts` (visits `/wealth/accounts` at `:299`), `apps/desktop/tests/nav-qa.spec.ts` (`SURFACES` includes `wealth-accounts` at `:107`), `apps/desktop/tests/navigation.spec.ts` (`:183`).
  - [x] The minimal mock is `case "get_account_earmark_breakdown": return Promise.resolve({ account_id: args.account_id, balance_cents: 0, earmarked_cents: 0, unallocated_cents: 0, segments: [] });` — an empty `segments` array reproduces the "no bar" state, so existing assertions about the accounts page are unaffected.
  - [x] Add positive coverage in `apps/desktop/tests/projects.spec.ts` or `accounts.spec.ts`: an account with two project segments renders a bar whose segment count is 3 (2 projects + unallocated), and an account with none renders no bar. `NetWorthBreakdownBar` exposes `data-testid="breakdown-bar"`, `"breakdown-segment"`, `"breakdown-legend"`, `"legend-item"` (`NetWorthBreakdownBar.tsx:133-167`) — assert against those rather than against CSS.
- [x] **Task 10 — Verification** (AC: all)
  - [x] `cargo test` green; `cargo clippy --all-targets` adds zero new warnings.
  - [x] `pnpm --filter @nixus/desktop exec tsc --noEmit` clean; `pnpm --filter @nixus/desktop test` passes.
  - [x] `pnpm --filter @nixus/desktop exec playwright test` — confirm the four audited specs still pass.
  - [x] `git diff` shows **no** modification to `components/net-worth/NetWorthBreakdownBar.tsx` (AC #3) and no write to `accounts` anywhere (AC #5).
  - [x] `git diff` grep for `f64` in Rust → zero matches.

## Dev Notes

### What this story is, in one sentence

One read-only aggregation command, one thin wrapper component around the existing net-worth breakdown bar, and its wiring into the Accounts page — no new visual primitive and no new write path.

### The aggregation query

```sql
SELECT c.project_id,
       p.name AS project_name,
       COALESCE(SUM(c.amount_cents), 0) AS earmarked_cents
FROM project_contributions c
JOIN projects p ON p.id = c.project_id
WHERE c.account_id = ?1
GROUP BY c.project_id, p.name
ORDER BY earmarked_cents DESC, p.name
```

Then, in Rust:

```
earmarked_cents   = Σ segment.earmarked_cents
unallocated_cents = balance_cents - earmarked_cents
```

This is exactly the architecture's stated computation: *"'Earmarked amount for account X' = `SUM(amount_cents) GROUP BY account_id, project_id`, computed on read, never stored redundantly"* and *"'Available/unallocated' for an account = `accounts.balance_cents - SUM(all contributions from that account)`, also computed on read."* The `idx_project_contributions_account_id` index created by migration 025 is what keeps this cheap.

`ORDER BY earmarked_cents DESC` is a nicety only — `NetWorthBreakdownBar` re-sorts by magnitude itself (`NetWorthBreakdownBar.tsx:84-86`). Ordering server-side keeps the legend stable if the component is ever swapped.

**`JOIN`, not `LEFT JOIN`, here** — the opposite of Story 31.2's saved-totals query. There, the driving table was `projects` and a project with no contributions still needed a `0` row. Here the driving table is `project_contributions`; a row cannot exist without its project (FK `NOT NULL`), and a project with no contributions from *this* account must not appear as a zero segment.

### Archived projects are included, deliberately

A contribution toward an archived project still represents money sitting in the account. If the segment query filtered `WHERE p.archived_at IS NULL`:

- the segments would no longer sum to `balance_cents` (AC #1 and PRD SC4 both state the sum identity as the test criterion), and
- the missing amount would silently reappear as "unallocated", telling the user money is free to spend when it is still labelled for an archived goal.

So: **no `archived_at` filter in this query.** This is the one place in the feature where archived projects are intentionally visible. Story 31.2's `get_project_saved_totals` and Story 31.4's dashboard rollup *do* filter to active projects, because those answer "what am I actively working toward?" — a different question. If a segment for an archived project needs a visual marker later, that is a UI concern, not a reason to drop it from the sum.

[Source: `prd-savings-projects.md#2. Success Criteria` SC4; `epics-savings-projects.md#Story 31.3` AC 1]

### Why `unallocated_cents` is not clamped

A user can log more contributions than an account holds — nothing prevents it, because contributions are labels, not transfers, and the balance is typed in by hand (see the standing note at `wealth.accounts.tsx:304-306`). Clamping `unallocated_cents` at `0` would break the sum identity and hide the over-commitment. Report the true difference; let the UI decide how to present a negative segment. `NetWorthBreakdownBar` already handles negative values by magnitude (`Math.abs` at `:75`, `:85`, `:89`), so a negative unallocated segment renders as a proportional band rather than crashing or vanishing.

### Reusing `NetWorthBreakdownBar` without touching it

`components/net-worth/NetWorthBreakdownBar.tsx` takes:

```typescript
interface NetWorthBreakdownBarProps {
  breakdown: NetWorthBreakdownCategory[];
  isLoading?: boolean;
  titleKey?: string;
}
```

and `NetWorthBreakdownCategory` (`lib/types.ts:197-202`) is `{ name: string; cents: number; percentage: number; color: string }`.

Three behaviours that determine how to call it:

1. **It recomputes shares.** `segments` is derived from `cents` against the magnitude total (`:73-94`); the `percentage` field you pass is never read. Pass `0`.
2. **It discards `color` on purpose.** The in-file comment at `:80-83` explains that a colour pinned to a category identity is what produced two indistinguishable purples; it uses a rank-ordered 8-step luminance ramp instead. Pass `""`.
3. **`titleKey` is a bare i18n key.** It is rendered as `t(titleKey)` (`:109`, `:123`) with no interpolation object, so `t("projects.earmarkTitle", { name })` is not reachable through it. The account name therefore goes in the wrapper's own heading, above the card.

There is precedent for exactly this kind of reuse-with-a-different-title: `wealth.accounts.tsx:308-315` already renders `<NetWorthBreakdownBar breakdown={breakdown} titleKey="accounts.breakdown" />` for the account-type composition, with the breakdown built by `buildAccountBreakdown` in `lib/accountUtils.ts:100-125` — note that helper also passes `percentage: 0` (`accountUtils.ts:121`), confirming the field is vestigial.

The architecture is explicit that this component is *"reused as-is"* and that `components/projects/` *"consumes but does not modify"* it. Modifying it would also silently change the net-worth surface and the existing account-type bar.

### Component sketch

```tsx
export function AccountEarmarkBar({ account }: { account: Account }) {
  const { t } = useTranslation();
  const { data } = useAccountEarmarkBreakdown(account.id);

  // AC #2: an account with no contributions shows nothing at all. NetWorthBreakdownBar's own
  // empty guard is not enough — a lone "unallocated" segment is non-zero and would render as a
  // single full-width band, which is the degenerate state the AC rules out.
  if (!data || data.segments.length === 0) return null;

  const breakdown: NetWorthBreakdownCategory[] = [
    ...data.segments.map((segment) => ({
      name: segment.project_name,
      cents: segment.earmarked_cents,
      percentage: 0,
      color: "",
    })),
    {
      name: t("projects.unallocated"),
      cents: data.unallocated_cents,
      percentage: 0,
      color: "",
    },
  ];

  return (
    <section data-testid="account-earmark-bar">
      <h3 className="mb-2 text-label text-ink">{account.name}</h3>
      <NetWorthBreakdownBar breakdown={breakdown} titleKey="projects.accountEarmarkTitle" />
    </section>
  );
}
```

Keep the class names consistent with the surrounding page (`text-label text-ink` is the register used for group headings at `wealth.accounts.tsx:92`). Do not introduce new colour or spacing tokens.

### N accounts means N queries — and that is fine

Each `AccountEarmarkBar` runs its own `useQuery`. A user has a handful of accounts, and the architecture states plainly: *"No special optimization needed — data volumes are small; standard React Query caching is sufficient."* Do **not** invent a batched `get_all_account_earmarks` command that the architecture does not specify; and do not call `useAccountEarmarkBreakdown` inside a `.map()` in the route (that would violate the rules of hooks — the per-account component is what makes the mapping legal).

### Invalidation this story owns

Story 31.2 created the contribution mutations with a deliberately short `onSuccess` list, because `queryKeys.accountEarmarks` did not exist yet. This story adds it:

- `useCreateProjectContribution` → `invalidateQueries(queryKeys.accountEarmarks(input.account_id))`
- `useDeleteProjectContribution` → `invalidateQueries(queryKeys.accountEarmarks(deleted.account_id))` (the row is returned precisely so this is possible)
- `useArchiveProject` → prefix invalidation `invalidateQueries({ queryKey: ["account-earmarks"] })`, because archiving touches every account that funded that project and the mutation does not know which they are

Every mutation must invalidate **all** affected keys (project rule 6); an un-invalidated earmark bar showing a stale split is exactly the "money I'm free to spend" mistake this story exists to prevent.

### i18n keys

Both `en.json` and `fr.json`, same change, appended to the `projects.*` namespace.

| Key | EN | FR |
| --- | --- | --- |
| `projects.accountEarmarkTitle` | `Set aside for goals` | `Mis de côté pour des objectifs` |
| `projects.unallocated` | `Not set aside` | `Non réservé` |
| `projects.earmarkNote` | `These amounts are labels, not transfers. The balance itself has not moved.` | `Ces montants sont des étiquettes, non des transferts. Le solde lui-même n'a pas bougé.` |
| `projects.earmarkSectionTitle` | `Money set aside per account` | `Argent mis de côté par compte` |

Reused as-is, **not** duplicated: `netWorth.breakdown.orderNote`, `netWorth.breakdown.tableCaption`, `netWorth.breakdown.colType`, `netWorth.breakdown.colAmount`, `netWorth.breakdown.colShare` — all read by `NetWorthBreakdownBar` itself and already present in both locales.

### Dependencies and sequencing

- **Depends on Story 31.2**: without contribution rows there is nothing to aggregate, and the invalidation wiring in Task 4 edits hooks that Story 31.2 creates.
- **Depends on Story 31.1** for migration 025 (specifically `idx_project_contributions_account_id`), `db/projects.rs`, `commands/projects.rs`, `hooks/useProjects.ts`, and the `projects.*` locale namespace.
- Nothing in Epic 31 depends on this story: Stories 31.4 and 31.5 are independent of it (both depend on 31.2). Epic 32's suggestion panel does not consume the earmark breakdown either.

### Testing standards

- **Rust:** extend the inline `#[cfg(test)] mod tests` in `db/projects.rs` with the existing `projects_test_db()` helper. In-memory SQLite, `PRAGMA foreign_keys=ON`, plain `#[test]` fns, `assert_eq!` on concrete cent values. Multi-table helper precedent: `db/budget.rs:379-440`; simpler single-table precedent: `db/account.rs:464-480`.
- **Assert the sum identity as an identity**, not as three separate magic numbers: `segments.sum() + unallocated == balance` is the property the PRD measures (SC4), and it is what catches an accidental `archived_at` filter or a clamp.
- **Commands are not unit-tested** in this codebase; keep `get_account_earmark_breakdown` a two-line orchestrator.
- **Frontend:** locale parity spec extension is required. The interesting behaviour (suppression when `segments` is empty) is best covered by Playwright, since desktop unit tests have no `@testing-library/react`.
- **Playwright:** four existing specs reach `/wealth/accounts` and all four need a mock case — this is the highest-risk task in the story, because a missing mock does not fail loudly at compile time, it fails as an unrelated-looking spec regression.
- **Zero new warnings** from `cargo clippy` and `tsc`.

### Explicitly out of scope

No migration change, no modification to `NetWorthBreakdownBar` or any other net-worth file, no change to `AccountRow.tsx`, no batched multi-account earmark command, no dashboard card (Story 31.4), no change to `commands/account.rs` (Story 31.5), no allocation suggestions (Epic 32), no per-project drill-down from the accounts page, no new UI primitive, no new dependency, no version bump.

### Project Structure Notes

```
apps/desktop/src-tauri/src/
├── models/mod.rs                                  # MODIFIED — + AccountEarmarkBreakdown,
│                                                  #            + AccountEarmarkSegment
├── db/projects.rs                                 # MODIFIED — + get_account_earmark_breakdown
│                                                  #            + tests
├── commands/projects.rs                           # MODIFIED — + get_account_earmark_breakdown (read)
└── lib.rs                                         # MODIFIED — register 1 command

apps/desktop/src/
├── components/projects/AccountEarmarkBar.tsx      # NEW — thin wrapper over NetWorthBreakdownBar
├── routes/wealth.accounts.tsx                     # MODIFIED — render one bar per account
├── hooks/useProjects.ts                           # MODIFIED — + useAccountEarmarkBreakdown;
│                                                  #            + earmark invalidation in the
│                                                  #              contribution/archive mutations
├── lib/constants.ts                               # MODIFIED — + queryKeys.accountEarmarks(id)
├── lib/types.ts                                   # MODIFIED — + AccountEarmarkBreakdown,
│                                                  #            + AccountEarmarkSegment
├── locales/en.json, fr.json                       # MODIFIED — projects.accountEarmark* keys
└── locales/__tests__/projects-i18n.test.ts        # MODIFIED — + REQUIRED_KEYS

apps/desktop/tests/
├── accounts.spec.ts                               # MODIFIED — mock case + positive coverage
├── accessibility.spec.ts                          # MODIFIED — mock case
├── nav-qa.spec.ts                                 # MODIFIED — mock case
└── navigation.spec.ts                             # MODIFIED — mock case
```

**One new file only.** Everything else is an extension of a file that exists after Stories 31.1–31.2, plus one modification to an existing surface (`wealth.accounts.tsx`).

**Deliberately not touched:** `components/net-worth/NetWorthBreakdownBar.tsx` (consumed read-only — modifying it is an AC #3 failure), `components/accounts/AccountRow.tsx`, `lib/accountUtils.ts`, `db/account.rs`, `commands/account.rs`, `db/net_worth.rs`, `migrations/`, `db/mod.rs`, `routes/index.tsx`, `lib/navigation.ts`, `Cargo.toml`, `package.json`, `tauri.conf.json`, `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Naming conventions satisfied:** `_cents` on every money field; `snake_case` Rust fn / IPC args (`account_id`); `PascalCase` struct and component names; the query key is the architecture's own `accountEarmarks(accountId)` rendered as the kebab-case array `["account-earmarks", accountId]`; the component lives in the flat `components/projects/` feature folder.

**Variance note:** the architecture describes `AccountEarmarkBar.tsx` as *"a thin wrapper around NetWorthBreakdownBar for one account"* — the wrapper here adds an account-name heading around the card, which is slightly more than zero markup. That is forced by `NetWorthBreakdownBar`'s non-interpolating `titleKey`, and it is the alternative to modifying a component the architecture says not to modify.

### References

- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Story 31.3: See how a project's contributions split an account's balance` — acceptance criteria, copied faithfully, incl. the "no degenerate single-segment bar" and "no new visual primitive" clauses]
- [Source: `_bmad-output/planning-artifacts/epics-savings-projects.md#Requirements Inventory` — FR5]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#8. Functional Requirements` — FR5 test criterion: "Sum of all segments equals the account's `balance_cents` for every account with ≥1 contribution"]
- [Source: `_bmad-output/planning-artifacts/prd-savings-projects.md#2. Success Criteria` — SC4: breakdown bar renders unallocated + N project segments summing to the account balance]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Data modeling approach` — earmarked = `SUM(amount_cents) GROUP BY account_id, project_id`; unallocated = `balance_cents - SUM(...)`; computed on read, never stored]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#API & Communication Patterns` — `get_account_earmark_breakdown(account_id)` returns unallocated + per-project segments]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Frontend Architecture` — reuse `NetWorthBreakdownBar` as-is; query key `accountEarmarks(accountId)`; no new primitives; no special optimization needed]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Architectural Boundaries` — `components/projects/` consumes but does not modify `NetWorthBreakdownBar`; `accounts` is a read-only touchpoint]
- [Source: `_bmad-output/planning-artifacts/architecture-savings-projects.md#Enforcement Guidelines` — the `get_account_earmark_breakdown` "Good Example"; no `get_*` command may write; never write `accounts.balance_cents`]
- [Source: `docs/project-context.md#1. Monetary Values — Always Integers (Cents)`; `#2. Tauri IPC Commands`; `#3. Database Operations Belong in db/ Only`; `#4. Rust Model Structs`; `#6. TanStack Query Keys`; `#8. Shared UI Components`; `#9. Compilation Warnings Policy`; `#Testing Rules` (incl. the line-295 mock trap)]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:102-129` — `COALESCE(SUM(...), 0)` aggregate + currency-scoped-query precedent]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:297-322` — get-by-id and the not-found → `AppError::Validation { field: Some("account_id") }` mapping]
- [Source: `apps/desktop/src-tauri/src/db/account.rs:464-480` — minimal in-memory test-db helper]
- [Source: `apps/desktop/src-tauri/src/db/budget.rs:379-440` — multi-table in-memory test-db helper]
- [Source: `apps/desktop/src-tauri/src/db/dashboard.rs:32-46` — grouped aggregation with a join, `query_map` collection shape]
- [Source: `apps/desktop/src-tauri/src/commands/account.rs:41-48` — minimal read-command shape (lock → db call → return, no audit)]
- [Source: `apps/desktop/src-tauri/src/lib.rs:171-280` — `generate_handler!` registration list]
- [Source: `apps/desktop/src-tauri/migrations/025_projects.sql` (created in Story 31.1) — `idx_project_contributions_account_id`, the index this aggregation relies on]
- [Source: `apps/desktop/src/components/net-worth/NetWorthBreakdownBar.tsx:21-25`, `:73-94`, `:80-83`, `:109`, `:118`, `:123`, `:133-167` — props, share recomputation, deliberate colour discard, non-interpolating `titleKey`, empty-state early return, test ids]
- [Source: `apps/desktop/src/lib/types.ts:197-202` — `NetWorthBreakdownCategory` shape]
- [Source: `apps/desktop/src/lib/accountUtils.ts:100-125` — existing breakdown builder; confirms `percentage: 0` is vestigial]
- [Source: `apps/desktop/src/routes/wealth.accounts.tsx:222-316`, `:304-306`, `:308-315` — loaded-state layout, the manual-balance Alert to keep, and the existing `NetWorthBreakdownBar` reuse with a custom `titleKey`]
- [Source: `apps/desktop/src/components/accounts/AccountRow.tsx` — renders a `TableRow`; why the bar is not embedded there]
- [Source: `apps/desktop/src/hooks/useAccounts.ts:11-16` — plain `useQuery` hook shape]
- [Source: `apps/desktop/src/lib/constants.ts:1-70` — `queryKeys` object, parameterized key precedent]
- [Source: `apps/desktop/tests/accounts.spec.ts:29-150` — mock switch to extend]
- [Source: `apps/desktop/tests/accessibility.spec.ts:299` — spec visiting `/wealth/accounts`]
- [Source: `apps/desktop/tests/nav-qa.spec.ts:101-119`, `:107` — `SURFACES` list incl. `wealth-accounts`; console-error gate]
- [Source: `apps/desktop/tests/navigation.spec.ts:13`, `:27`, `:183` — Wealth landing and `/wealth/accounts` navigation]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo test` (src-tauri): `test result: ok. 479 passed; 0 failed` — includes 8 new `earmark_breakdown_*` tests.
- `cargo clippy --all-targets`: 1 warning, `src/commands/backup.rs:106` `explicit_auto_deref` — pre-existing, unrelated file, untouched by this story. Zero new warnings.
- `pnpm --filter @nixus/desktop exec tsc --noEmit`: clean, no output.
- `pnpm --filter @nixus/desktop test` (vitest): `Test Files 12 passed (12) / Tests 205 passed (205)`.
- `pnpm --filter @nixus/desktop exec playwright test accounts accessibility nav-qa navigation projects`: `75 passed (51.0s)`.
- Full `playwright test`: `419 passed, 1 failed` — the failure is `maintenance.spec.ts:1521` (car maintenance intervals), which passes in isolation (`42 passed`) and touches no surface this story changes; flake under full-suite parallel load, pre-existing.
- Red-before-green proof for the two invariants that cannot be caught by reading: forcing `unallocated_cents.max(0)` failed `earmark_breakdown_reports_negative_unallocated_when_over_earmarked`; adding `AND p.archived_at IS NULL` to the segment query failed `earmark_breakdown_keeps_archived_project_segments`. Both reverted.

### Completion Notes List

- `get_account_earmark_breakdown` reads `accounts.balance_cents` first and maps a missing row to `AppError::Validation { field: Some("account_id") }`, then runs the Dev Notes aggregation verbatim (`JOIN`, no `archived_at` filter, `COALESCE(SUM(...), 0)`, `ORDER BY earmarked_cents DESC, p.name`). `earmarked_cents` is summed in Rust from the segments rather than issuing a second aggregate — one query fewer, same value, and it makes the sum identity true by construction.
- **Sum-to-balance regression test**: `assert_sums_to_balance` asserts `Σ segments + unallocated == balance` as an identity and is called from every positive-path earmark test (multi-project, grouped, empty, cross-account, over-earmarked, archived). This is the SC4/FR5 criterion and it is what catches an accidental clamp or `archived_at` filter.
- `NetWorthBreakdownBar.tsx` is untouched (`git diff --stat` on it is empty). `AccountEarmarkBar` wraps it, passes `percentage: 0` / `color: ""` (both discarded by the consumer), and puts the account name in its own `<h3>` because `titleKey` is non-interpolating.
- **Deviation (documented choice):** the story's i18n table specifies four keys but Tasks 5–6 only render two (`accountEarmarkTitle`, `unallocated`). Rather than ship two dead keys, the accounts-page section renders `projects.earmarkSectionTitle` as its heading and `projects.earmarkNote` as its caption. To keep Task 6's "no filtering logic in the route, no extra query" constraint while avoiding a heading floating above nothing, the section is hidden by default and revealed with the Tailwind variant `has-[[data-testid=account-earmark-bar]]:flex` — verified present in the built CSS as `:has([data-testid=account-earmark-bar]){display:flex}`. No new token, no new query, no filtering pass.
- **Deviation (audit outcome):** `tests/navigation.spec.ts` was audited as instructed and needs **no** mock case — it installs no `__TAURI_INTERNALS__` stub at all (no `addInitScript`, no `invoke` switch), so there is no fall-through to break. It is listed in the File List because Playwright rewrote nothing in it; it appears modified in `git status` from prior stories, not this one. `tests/nav-qa.spec.ts` needed an *explicit* case despite its `default: return Promise.resolve([])`, because `[]` would make `data.segments` undefined and throw inside the bar; its `invoke` signature gained the `args` parameter to echo `account_id`.
- `invalidateContributionKeys` now takes the contribution row (`Pick<ProjectContribution, "project_id" | "account_id">`) instead of a bare `projectId`, so create (from mutation input) and delete (from the returned row) both invalidate the precise `accountEarmarks(accountId)` key. `useArchiveProject` uses the `["account-earmarks"]` prefix form with a one-line WHY comment, since it cannot know which accounts funded the project.
- Positive Playwright coverage lives in a new `Account earmark breakdown` describe in `accounts.spec.ts`; `setupTauriMock` gained an optional `earmarks: EarmarkFixture[]` argument (default `[]`, so the existing `beforeEach` reproduces the "no bar" state and every prior assertion is unaffected).
- No migration, no `f64` (`git diff` grep: 0 matches), no write to `accounts`, no `as any` / `@ts-ignore` / non-test `.unwrap()`, no version bump.

### File List

**Modified — Rust (`apps/desktop/src-tauri/`)**
- `src/models/mod.rs` — + `AccountEarmarkSegment`, + `AccountEarmarkBreakdown`
- `src/db/projects.rs` — + `get_account_earmark_breakdown`, + 8 tests and 2 test helpers
- `src/commands/projects.rs` — + `get_account_earmark_breakdown` read command (no audit log)
- `src/lib.rs` — registered `commands::projects::get_account_earmark_breakdown`

**New — Frontend**
- `apps/desktop/src/components/projects/AccountEarmarkBar.tsx`

**Modified — Frontend (`apps/desktop/src/`)**
- `lib/types.ts` — + `AccountEarmarkSegment`, + `AccountEarmarkBreakdown`
- `lib/constants.ts` — + `queryKeys.accountEarmarks(accountId)`
- `hooks/useProjects.ts` — + `useAccountEarmarkBreakdown`; earmark invalidation in create/delete contribution and archive
- `routes/wealth.accounts.tsx` — + `accounts-earmarks` section, one bar per account
- `locales/en.json`, `locales/fr.json` — + 4 `projects.*` earmark keys
- `locales/__tests__/projects-i18n.test.ts` — + 4 `REQUIRED_KEYS`, + 5 `netWorth.breakdown.*` foreign keys

**Modified — Tests (`apps/desktop/tests/`)**
- `accounts.spec.ts` — parameterized earmark mock + new `Account earmark breakdown` describe (2 tests)
- `accessibility.spec.ts` — + `get_account_earmark_breakdown` mock case
- `nav-qa.spec.ts` — + explicit `get_account_earmark_breakdown` mock case; `invoke` gained `args`

**Audited, no change required**
- `tests/navigation.spec.ts` — installs no Tauri invoke stub, so no mock case is reachable

