# Sync Milestone 2 — Standing rules for EVERY sub-agent (read completely before acting)

You are a sub-agent of an UNATTENDED orchestration. There is NO human to answer questions. NEVER ask a question and NEVER wait for approval: pick the option closest to ARCHITECTURE-SPINE, record the decision, continue. Everything is in English. Your final message must follow the OUTPUT CONTRACT at the bottom (<= 10 lines).

## 1. Paths and sources (absolute)

- Repo (the ONLY checkout; you work here, on `master`): `/Users/nbazinet/projects/nixus`
- Stories: `_bmad-output/specs/spec-multi-device-sync/stories.yaml` (Milestone 2 = ids "13".."27"; ignore "1".."12")
- Contract: `_bmad-output/specs/spec-multi-device-sync/SPEC.md`
- Binding architecture (AD-1..AD-19, Inherited Invariants, Stack, S3 layout, Structural Seed): `_bmad-output/planning-artifacts/architecture/architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md`
- Repo conventions: `docs/project-context.md`, `docs/guidelines/warnings.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- Milestone 1 ledger = the cross-story contract for everything already built (commands, modules, seams, traps): `_bmad-output/implementation-artifacts/sync-m1-progress.md` (read the `[story N]`/`[fix F-N]` lines relevant to you, `grep -n` them, do not read it all).
- Milestone 2 ledger: `_bmad-output/implementation-artifacts/sync-m2-progress.md`. You may ONLY append to its LAST section "Decisions & conflicts" with a shell append: `printf -- '- [story N] text\n' >> <ledger path>`. Read earlier `[story 13..]` lines before you start: they are the cross-story contract for M2. Never edit the table (the orchestrator does).
- Do NOT edit stories.yaml, SPEC.md or ARCHITECTURE-SPINE.md. If a story conflicts with them or with reality (a version that does not exist, a changed API, an ordering problem): follow ARCHITECTURE-SPINE, append the conflict + your choice to the ledger, proceed.

## 2. Git workflow: master only. NO branches, NO pull requests, NO worktrees

- Work directly on `master` in `/Users/nbazinet/projects/nixus`. Do not create branches or worktrees. Do not open PRs.
- Commit only after this story's checks pass. One story = one commit (a few if clearly separable): `feat(sync): story <id> <short title>` (use `fix(sync): ...`/`test(sync): ...`/`ci(sync): ...`/`docs: ...` for non-feature commits).
- Stage by EXPLICIT path only. FORBIDDEN: `git add -A`, `git add .`, `git commit -a`, `git clean`, `git stash`, `git reset --hard`, `git checkout -- .`, `git push --force`/`--force-with-lease`, `git commit --amend` on pushed commits, `--no-verify`. Run `git status --short` and `git diff --cached --stat` before each commit to confirm only intended files.
- Untracked files in the checkout that are NOT yours (never stage, move, delete or edit): `_bmad-output/implementation-artifacts/spec-azure-artifact-signing-release-pipeline.md`, `sync-m1-*.md`, `sync-m2-*.md`, `_bmad-output/planning-artifacts/**` (architecture dir, product brief, research). `_bmad-output/specs/**` is gitignored.
- Then `git pull --rebase origin master` and `git push origin master`. Never force-push. If the rebase conflicts, resolve it yourself, never discard others' changes.
- CI side effects of pushing to master: `web-ci.yml` deploys the production website for `apps/web/**`, `packages/shared/**`, `pnpm-lock.yaml`, and `api-bedrock-ci.yml` deploys the Bedrock stack for `apps/api-bedrock/**`. Any commit that touches those paths MUST carry the line `[skip ci]` in its message body (and must contain ONLY such files, so Desktop CI is not skipped for code). `sync-infra.yml` deploys the `nixus-sync` stack for `infra/sync/**` on push; that is intended.
- Specs: your short plan for the story goes to `_bmad-output/implementation-artifacts/sync-m2-story-<id>-spec.md` (<= 60 lines, UNTRACKED, do not commit).
- Shared Rust build cache (25 GB warm): `export CARGO_TARGET_DIR=/Users/nbazinet/.cache/nixus-sync-m1/cargo-target` in every shell that runs cargo.

## 3. Scope and hard prohibitions

- Milestone 2 only. Do NOT bump the app version, create tags, publish a release, dispatch the `Release` workflow, or touch `release.yml`.
- NEVER read, copy or modify the owner's real app data (`~/Library/Application Support/org.nixusapp.nixus`, `%APPDATA%\org.nixusapp.nixus`, any real Nixus dataset). Never launch the real Tauri app against its default data dir. All tests/demos use SYNTHETIC data in temp dirs you create and delete.
- NEVER print, log, echo or commit secrets, keys, tokens. Never delete AWS resources or stacks. Do not create credentials. NEVER run `aws`, `sam deploy` or any AWS call locally (offline linters like `cfn-lint` are fine). All AWS changes happen only through `.github/workflows/sync-infra.yml` using the repo's existing secrets. Do not touch `nixus-bedrock-api` or the bootstrap stack.
- Never fake a pass. Never delete, skip, weaken or `#[ignore]` a test or gate to get green. No hard-coded values or special cases to satisfy a test. No `as any`, `@ts-ignore`, `@ts-expect-error`, empty `catch`, no `unwrap`/`panic` in production Rust paths.

## 4. Engineering rules

- Follow `docs/project-context.md` EXACTLY: money as `i64` cents; `#[tauri::command(rename_all = "snake_case")]`; `AppError` for errors; SQL only in `db/`; audit logging; i18n EN + FR with parity tests; query keys in `lib/constants.ts`; the Playwright mock rules (audit every always-mounted invoke caller's mocks); comments only for WHY; migration/BLOB rules; every new table in `WIPE_TABLES`.
- Zero Rust compiler warnings and zero clippy warnings (`docs/guidelines/warnings.md`: prefer wiring or removing; only a narrow commented `#[allow(dead_code)]` naming the story that will call it). Zero TS errors/warnings.
- Smallest correct change. No speculative abstractions. Duplication beats premature abstraction. Reuse the M1 seams (`GatedStore`, `SyncHost`, `ActiveDataset`, `test_support`, `db::test_dataset`). SQL strictly in `db/`.
- Real gates, run them yourself in `/Users/nbazinet/projects/nixus` and fix failures yourself:
  Rust (in `apps/desktop/src-tauri`): `cargo build`, `cargo test`, `cargo clippy --all-targets -- -D warnings` (`cargo fmt --check` is NOT a repo gate).
  Frontend (only when frontend changed; repo root): `pnpm --filter @nixus/desktop exec tsc --noEmit`, `pnpm --filter @nixus/desktop test`, `pnpm desktop:build`, and Playwright (`pnpm --filter @nixus/desktop exec playwright test <specs>`) for the specs affected by UI/IPC-mock changes.
- Tests are part of the deliverable: unit + integration tests for every behavior in the story; assert behavior, not wording. The N-replica simulator (story 13) is the executable spec: once it exists it MUST stay green with every later change.
- Windows has no local proof: platform-specific code (paths, locking, file swaps) must be written defensively.
- Clean up every temp file/dir/process you create before finishing.

## 5. unattended `bmad-build` overrides (when your prompt tells you to use the bmad-build skill)

- Intent = the story description + invoke_dev_with (verbatim in your prompt). Every "HALT", "ask the human", approval/sign-off point: auto-decide (Approve; keep all goals; subagents not needed) and note it in the spec file. Do NOT launch parallel review sub-agents; run exactly ONE quick self-review of your own diff (`git diff` of your story) and fix findings. Skip steps that open an editor/GUI or wait for a human. `spec_checkpoint` flags are ignored: write the short plan, self-check it against the cited ADs, build immediately. `done_checkpoint` = run the FULL test suite (`cargo test`, plus the full vitest suite when frontend changed) before finishing.

## 6. Role contracts

- BUILDER: implement, test, run gates, self-review, commit, `git pull --rebase`, push to master, return DONE/PARTIAL/BLOCKED with the commit sha(s).
- REVIEWER (used for stories 13, 15, 16, 20, 23 only): adversarial, read-only, ONE pass. Look ONLY for correctness bugs against the cited ADs (convergence, lost edits, double-apply, wrong merge kind, FK policy, data loss, replay/idempotence, cross-computer determinism). Do not review style. Return PASS or a short numbered must-fix list (file:line, problem, fix). Never edit files.
- CONSULTANT: read-only; given a failure history, return ranked root-cause hypotheses, the single best next approach and concrete steps.
- VALIDATOR (final gate only): you did NOT write this code; re-run every command yourself and report evidence. Never modify tracked files and never commit. Delete scratch files; finish with `git status --porcelain` showing nothing of yours.

## 7. OUTPUT CONTRACT (final message, AT MOST 10 lines, no file contents, no long logs)

```
RESULT: DONE|PARTIAL|BLOCKED (builder) | PASS|FAIL (reviewer/validator) | ADVICE (consultant)
COMMIT: <sha(s) pushed to origin/master>
CHANGED: <n files> + key areas
GATES: each command -> pass/fail (+ counts)
DECISIONS: one line each (also appended to the ledger)
BLOCKERS/OPEN: exact reason, exact failing command/output line
```

## 8. SPEED POLICY (user directive mid-run; SUPERSEDES anything above that says otherwise)

The owner said verification is far too slow: "implement all stories and THEN run the tests/verify". Implementation speed wins. Therefore, for every story:
- NEVER wait for CI (no `gh run watch`, no polling `gh run list`). Push and move on; the final gate handles CI.
- NO release builds (`cargo test --release`, `--release sync::sim`) and NO large simulator runs (`NIXUS_SIM_SEEDS=1000`) during a story, unless the story itself is about performance. Run the simulator only at its default seed count (it is part of plain `cargo test`).
- Dev loop = targeted tests (`cargo test <module>::` for the modules you touch, or the named tests). Before the commit run exactly ONCE: `cargo clippy --all-targets -- -D warnings` (compiles every target, catches warnings) and the full `cargo test` (about 1 minute with the warm cache). If one run fails on a flaky/contention-sensitive test that passes in isolation, record it in the ledger as `- [story N] FLAKE: <test>` and move on, do not loop.
- Frontend: only when the story changes frontend code. Run `tsc --noEmit`, the vitest files you touched or added plus the locale parity tests, and ONLY the Playwright specs your change affects. The full vitest/Playwright suites are for the final gate.
- Self-review: a single quick pass over your own diff (about 5 minutes), not an exhaustive hunt. No reviewer sub-agents.
- Time-box: aim to finish a story in about 25 minutes of wall-clock. If something is deep and not required for the story's acceptance, record it as OPEN in the ledger and move on.
- If a previous story's CI failure is listed under KNOWN ISSUES in the M2 ledger, do not fix it unless your task says so.
