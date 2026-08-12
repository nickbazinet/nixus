---
title: 'Project pace & on-track status'
type: 'feature'
created: '2026-08-12'
status: 'ready-for-dev'
context: ['{project-root}/docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Savings Projects show saved/target/% but never answer "am I actually going to hit this by the target date, and how much do I need to set aside now?" — a gap the original PRD promised ("pace-to-date projection") but never turned into a shipped FR. Users must do this math themselves.

**Approach:** Add a pure, deterministic Rust computation of `required_monthly_cents` (remaining ÷ months-to-target) vs. the project's own trailing-3-month `actual_monthly_cents`, exposed as a `good`/`caution`/`over`/`neutral` status. Surface it as a badge on the collapsed project row (replacing the plain "remaining" badge for dated, unreached projects) and as a transparent-math line in the expanded detail. No new tables, no AI, no new primitives.

## Boundaries & Constraints

**Always:** Reuse `Badge` variants `good`/`caution`/`over`/`neutral` only — never color the `Meter` fill (project rule: fill is always brand). Reuse the existing `whole_months`/`months_to_target` date logic from `projects/allocation.rs` (promote to `pub(crate)`, do not duplicate). Compute on read only — no new column, no migration. Status/rate is Rust-computed and returned by one command; the frontend performs no arithmetic.

**Ask First:** None — thresholds below are final per PM sign-off.

**Never:** No AI, no advisory text, no new panel/route (that is a separate spec). No change to `projects/allocation.rs`'s public behavior or Epic 32's suggested-allocation math. No weekly/monthly toggle or per-project cadence setting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| On track | `target_date` set, `actual_monthly_cents / required_monthly_cents >= 1.0` | status `good` | N/A |
| Behind | ratio in `[0.75, 1.0)` | status `caution` | N/A |
| Way behind | ratio `< 0.75`, or target date passed with `remaining_cents > 0` | status `over` | N/A |
| No deadline | `target_date IS NULL` | status `neutral`, `required_monthly_cents = null`, no rate shown | N/A |
| Too new to judge | project created < 1 full month ago AND zero contributions | status `neutral`, rate fields `null` | N/A |
| Goal already met | `remaining_cents <= 0` | status `good` regardless of pace | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src-tauri/src/projects/allocation.rs` -- `whole_months`/`months_to_target` become `pub(crate)` for reuse; no behavior change
- `apps/desktop/src-tauri/src/projects/pace.rs` (NEW) -- pure `compute_project_pace(&PaceInput) -> ProjectPace`, mirrors `allocation.rs`'s style (no DB, no clock, injected `today`)
- `apps/desktop/src-tauri/src/models/mod.rs` -- add `ProjectPace { project_id, required_monthly_cents: Option<i64>, actual_monthly_cents: Option<i64>, status: String }`
- `apps/desktop/src-tauri/src/db/projects.rs` -- add `get_active_project_pace_inputs(conn, recent_since: &str)`: one query per project with `target_cents`, `target_date`, `created_at`, `saved_cents` (all-time sum), `recent_cents` (sum where `date >= recent_since`)
- `apps/desktop/src-tauri/src/commands/projects.rs` -- add `get_project_pace` command: computes `today` and `recent_since` (today − 3 months) via `chrono::Local`, reads, maps through `pace::compute_project_pace`
- `apps/desktop/src-tauri/src/lib.rs` -- add `mod pace;` under `projects`, register command
- `apps/desktop/src/lib/types.ts` -- mirror `ProjectPace`
- `apps/desktop/src/lib/constants.ts` -- add flat `queryKeys.projectPace`
- `apps/desktop/src/hooks/useProjects.ts` -- add `useProjectPace()` (`useQuery`, no args); add `queryKeys.projectPace` to `invalidateContributionKeys` and to `useCreateProject`/`useUpdateProject`'s `onSuccess` (target/date edits change the rate)
- `apps/desktop/src/components/projects/ProjectRow.tsx` -- when `target_date` is set and not reached, swap the `remainingBadge` for a pace badge (variant = status, text = status word + `{{amount}}/mo`); `neutral`/reached/no-date rows unchanged
- `apps/desktop/src/components/projects/ProjectDetail.tsx` -- add one line: required pace + benchmark, with a `MetricInfoTooltip` explaining the math (mirror `SuggestedAllocationPanel.tsx:169`); weekly figure (`required_monthly_cents * 12 / 52`) shown only when target date is within 8 weeks
- `apps/desktop/src/locales/en.json` + `fr.json` -- new `projects.pace*` keys per Design Notes
- `apps/desktop/tests/nav-qa.spec.ts` -- add `get_project_pace` mock case to the invoke switch
- `apps/desktop/tests/projects.spec.ts` -- add pace-badge assertions for on-track/behind/no-deadline projects

## Tasks & Acceptance

**Execution:**
- [ ] `projects/allocation.rs` -- widen `whole_months`/`months_to_target` visibility to `pub(crate)` -- lets `pace.rs` reuse the exact date math, no drift
- [ ] `projects/pace.rs` -- implement `PaceInput`/`ProjectPace`/`compute_project_pace` with the gate, ratio, and threshold logic from the I/O matrix; `#[cfg(test)] mod tests` covering every matrix row plus the ratio boundaries (0.749, 0.75, 0.999, 1.0)
- [ ] `models/mod.rs` -- add `ProjectPace` (`Serialize, Deserialize, PartialEq`)
- [ ] `db/projects.rs` -- add `get_active_project_pace_inputs`, in-memory SQLite tests for the "too new", "no contributions", and "recent window excludes older rows" cases
- [ ] `commands/projects.rs` -- add `get_project_pace`, no writes, no audit log (pure read + pure compute, mirrors `get_suggested_allocation`)
- [ ] `lib.rs` -- register module + command
- [ ] Frontend types/keys/hook per Code Map
- [ ] `ProjectRow.tsx` + `ProjectDetail.tsx` -- wire the badge and detail line
- [ ] i18n EN/FR keys
- [ ] Playwright mock + assertions

**Acceptance Criteria:**
- Given a project with `target_date` 6 months out, `remaining_cents = 600000`, and trailing-3-month contributions averaging `100000`/mo, when the row renders, then the badge reads `good` with "$1,000/mo"
- Given the same project with average contributions of `50000`/mo, when the row renders, then the badge reads `over`
- Given a project with no `target_date`, when the row renders, then the badge is unchanged (`neutral`, "X to go") and no rate appears
- Given identical inputs and identical injected `today`, when `get_project_pace` is called twice, then both results are byte-identical

## Design Notes

Copy (EN, sentence case, status word first so color is never load-bearing alone):
```
projects.paceBadgeGood    = "On track · {{amount}}/mo"
projects.paceBadgeCaution = "Behind · {{amount}}/mo"
projects.paceBadgeOver    = "Off track · {{amount}}/mo"
projects.paceLine         = "{{amount}}/mo to reach {{target}} by {{date}}"
projects.paceWeeklyLine   = "That's about {{amount}}/wk"
projects.paceMathInfo     = "Still needed, divided by the full months between now and your target date, compared to what you've set aside per month over the last 3 months."
```

## Verification

**Commands:**
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml projects` -- expect all pace + pace-input tests green
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets` -- zero new warnings
- `pnpm --filter @nixus/desktop exec tsc --noEmit` -- clean
- `pnpm --filter @nixus/desktop test` -- green
- `pnpm exec playwright test tests/projects.spec.ts tests/nav-qa.spec.ts` -- green
</content>
