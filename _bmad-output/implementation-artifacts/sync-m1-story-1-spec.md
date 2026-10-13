# Story 1 — Toolchain and SQLite build prerequisites (implementation spec)

Milestone 1, story id `1`. Architecture: AD-3, Stack table, Inherited Invariants
(`_bmad-output/planning-artifacts/architecture/architecture-multi-device-sync-2026-10-13/ARCHITECTURE-SPINE.md`).

## Intent

Raise the Rust toolchain to 1.94.1+, upgrade rusqlite 0.38 → 0.40 with the `preupdate_hook`,
`hooks` and `backup` features, and make bindgen and libclang available on dev machines and both
release runners. The app must build and its existing tests must pass on macOS and Windows before
anything else in the milestone starts.

No sync code. No behavior change. No version bump, no tags, no release.

## Why this story exists at all

AD-3 makes the SQLite pre-update hook the capture mechanism for the whole sync design. That
feature is gated behind `rusqlite/preupdate_hook`, which forces `buildtime_bindgen` in
`libsqlite3-sys`: from here on, *every* build of the desktop app runs bindgen and must link
libclang. If that prerequisite is discovered during story 4 or 8 it blocks them; worse, it would
be discovered on the Windows release runner, where the only feedback channel is a failed publish.

## Scope

| Area | Change |
| --- | --- |
| `apps/desktop/src-tauri/Cargo.toml` | `rusqlite 0.38 {bundled}` → `0.40 {bundled, preupdate_hook, hooks, backup}`; add `rust-version = "1.94.1"` |
| `apps/desktop/src-tauri/Cargo.lock` | resolved: `rusqlite 0.40.2`, `libsqlite3-sys 0.38.2`, `bindgen` in the tree |
| `rust-toolchain.toml` (new, repo root) | pin channel `1.94.1`, components `clippy`, `rustfmt` |
| `.github/workflows/desktop-ci.yml` (new) | `Desktop CI`: macOS + Windows build/test/clippy gate |
| `.github/workflows/release.yml` | libclang on both runners; toolchain rev pinned to match the pin |
| `CONTRIBUTING.md` | bindgen/libclang prerequisite per OS; Rust floor replaces the stale `1.70+`; rusqlite feature list; Desktop CI |
| `src-tauri/src/**` | mechanical clippy cleanup so `-D warnings` can be a gate (see decision 3) |

## Verification

- `cargo build`, `cargo test`, `cargo clippy --all-targets -- -D warnings` in
  `apps/desktop/src-tauri`.
- `pnpm --filter @nixus/desktop exec tsc --noEmit`, `pnpm --filter @nixus/desktop test`,
  `pnpm desktop:build` at the repo root.
- `cargo tree -i libsqlite3-sys -f "{p} {f}"` must list `buildtime_bindgen` and `preupdate_hook`
  — the actual proof that the feature is on, rather than just named in the manifest.
- `actionlint` on both workflows.
- Desktop CI green on `macos-latest` *and* `windows-latest` on the PR. This is the only Windows
  proof available; there is no Windows machine.
- macOS leg additionally builds `x86_64-apple-darwin`, because the Release workflow's
  `universal-apple-darwin` bundle compiles the crate per architecture and Release cannot be run
  as a gate.

## Decisions

1. **rusqlite `0.40.2`, `libsqlite3-sys 0.38.2`.** Both exist on crates.io and
   `libsqlite3-sys 0.38.2` matches the Stack table exactly. No conflict with the spine.
2. **The toolchain is pinned to `1.94.1`, not floated to `stable`.** Latest stable is `1.99.0`.
   Building on it produced 242 `clippy` errors and a rustfmt diff across most of the backend —
   all from lint/format rules that changed between 1.94 and 1.99, none related to this story.
   Floating the toolchain would make every future compiler release an unrelated repo-wide
   refactor landing in whatever story happened to run next. `1.94.1` is the floor the Stack table
   states (AWS SDK MSRV), so the pin satisfies "1.94.1 or newer" and is reproducible.
   `rust-version` in `Cargo.toml` states the same floor for anyone who bypasses the file.
   Consequence: `dtolnay/rust-toolchain@stable` in `release.yml` had to become
   `@1.94.1`, otherwise the action would install the universal-build targets onto a `stable`
   toolchain that `rust-toolchain.toml` then overrides. Desktop CI asserts the two agree, so the
   pin cannot drift unnoticed.
3. **238 pre-existing clippy lints were cleared.** `master` does not pass
   `cargo clippy --all-targets -- -D warnings` (232 × `needless_borrow`, 4 × `useless_vec`,
   2 × `empty_line_after_doc_comments`, 1 × `map_err`-over-`inspect_err`) — unsurprising, since
   no CI ever ran clippy. The story is required to add that gate, and weakening a gate to get
   green is forbidden, so the lints had to go. All fixes are mechanical and behavior-preserving:
   `cargo clippy --fix` for the borrows and `vec!`s, and the two dangling `///` module headers
   became `//!` with their prose unchanged. This inflates the diff, but the alternative is a gate
   that is red on arrival.
4. **`cargo fmt --check` is deliberately *not* a Desktop CI step.** `master` does not pass it
   either, on any toolchain, and nothing in `CONTRIBUTING.md` or any existing workflow runs it —
   so it has never been a repo gate. Adding it would require reformatting the entire backend,
   which is a far larger and more conflict-prone diff than this story may justify. Flagged for
   the owner as a separate decision rather than silently taken.
5. **Two tests were repaired, neither weakened.**
   - `ai::backend::…::the_user_chat_turn_persists_only_the_typed_message` is a *source-text*
     guard pinned to the literal `insert_message(&conn, …)`. The `needless_borrow` fix rewrote
     that call site to `insert_message(conn, …)`, so the guard's expected string was updated to
     match. What it asserts — that the user's turn persists only the typed message and never the
     attachment path — is unchanged, including every `forbidden` pattern.
   - `db::aggregates::…::windowed_income_average_excludes_months_outside_the_window` was already
     failing on `master`: it hard-codes `'2026-07-15'` against a 2-month trailing window, so it
     broke on its own in September 2026. Rewritten to the relative
     `date('now', 'start of month', '-1 month', …)` form its sibling expense test already uses,
     which asserts the same property without the time bomb.
6. **No `rusqlite` API breaks.** 0.38 → 0.40 compiled without a single source change in this
   codebase; the only `rusqlite`-attributable edits are in `Cargo.toml`/`Cargo.lock`.
7. **Unattended-mode auto-decisions** (per `sync-m1-agent-rules.md` §6): spec approved without
   human review; all goals kept; subagents authorized. No HALT taken.

## Out of scope / not touched

`packages/shared`, `apps/api-bedrock`, `pnpm-lock.yaml`, `web-ci.yml`, `api-bedrock-ci.yml`,
app version, tags, releases, AWS. No sync module, no `sync_log`, no capture hook — those are
stories 4+.
