---
baseline_commit: 9b45411e5d22d41705bd90eac8b78cf45e7c2238
---

# Story 26.3: Deep Link & Single-Instance Plugin Registration

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the `nixus://` custom URI scheme captured reliably on macOS and Windows,
so that a Cognito redirect reaches the already-running app instead of being lost or spawning a duplicate window.

## ⛔ CRITICAL CONTEXT — READ FIRST

**1. Paths.** There is no `/src-tauri` at the repo root. The Tauri backend is at **`apps/desktop/src-tauri/`**. Every path below is relative to repo root `/Users/nbazinet/projects/nixus`.

**2. `docs/project-context.md` is stale on the pnpm scope.** It says `@nkbaz/desktop` / `@nkbaz/shared`; the **actual** package names are **`@nixus/desktop`** and **`@nixus/shared`**. Use `@nixus/*` in every command — do not "correct" them back. The Rust crate name `nkbaz-finance` (lib `nkbaz_finance_lib`), the log filename `nkbaz-finance.log`, and the bundle identifier `com.nbazinet.nkbaz-finance` are legacy-but-correct and must **not** be renamed. `productName` is `Nixus`; these three names differing is expected.

**3. This story CREATES `apps/desktop/src-tauri/src/commands/auth.rs` and adds `pub mod auth;` to `commands/mod.rs`.** After this story that file exists and contains exactly one function, `dispatch_deep_link_url`. **Story 26.4 must ADD `start_login` / `handle_auth_callback` to this existing file — it must never recreate or overwrite it.** Story 26.4's file currently asserts under its own "CRITICAL CONTEXT" that "`commands/auth.rs` does not exist"; that statement is true only *before* this story lands, and 26.4's Prerequisite Gate row ("Story 26.3's callback-URL handler seam exists…adapt to the real name, do not create a second parallel handler") is the row that governs. Story 26.2's do-not-touch table attributing `commands/auth.rs` and `commands/mod.rs` to "Stories 26.4 / 26.5" predates this split and does not override the architecture delta tree, which places all auth Rust code in `commands/auth.rs`.

**4. Scope of the seam.** `dispatch_deep_link_url` logs only. No PKCE, no `reqwest`, no keyring, no `#[tauri::command]`, no `generate_handler!` entry, no Tauri event.

## Acceptance Criteria

### Epic acceptance criteria

1. **Dependencies added, forbidden dependency absent.** `apps/desktop/src-tauri/Cargo.toml` adds `tauri-plugin-deep-link` and `tauri-plugin-single-instance`; `apps/desktop/package.json` adds `@tauri-apps/plugin-deep-link`; `aws-sdk-cognitoidentityprovider` is **not** added.
2. **Scheme + permission configured.** `apps/desktop/src-tauri/tauri.conf.json` sets `plugins.deep-link.desktop.schemes` to `["nixus"]`, and `apps/desktop/src-tauri/capabilities/default.json` grants the `deep-link:default` permission.
3. **Registration order and single-instance behaviour.** In `apps/desktop/src-tauri/src/lib.rs`, `tauri_plugin_single_instance::init()` is registered **first** — before `tauri_plugin_deep_link::init()` and before every plugin already registered today. The single-instance handler focuses/unminimizes/shows the existing `main` window and lets the received argv/URL reach the running instance.
4. **Windows, app already running.** When the OS opens `nixus://auth/callback?code=...&state=...`, the URL is delivered to the existing process and **no** second app window is created.
5. **macOS, app already running.** The same URL is delivered to the existing process through the deep-link `on_open_url` path.
6. **Single seam + standalone verifiability.** A `nixus://` URL arriving is recorded/forwarded through one well-named function seam that Story 26.4 replaces with the real token exchange. Manually opening `nixus://auth/callback?code=test&state=test` while the app runs produces observable evidence (a log line) that the URL was received — with no dependency on any later story.
   *The epic offers "log line **or** emitted event"; this story deliberately takes the log-line option, because the only sensible event name (`auth:callback-received`) belongs to Story 26.4 and means "session stored" — emitting it here would signal a completed sign-in that did not happen.*
7. **Cold launch.** When the app is launched cold (not already running) by a `nixus://` URL, the URL is still captured after initialization rather than dropped silently.

### Non-regression and quality gates

*ACs 8-11 go beyond the epic's seven criteria. They are regression guards for risks that exist in this specific codebase, not new scope: restructuring `run()` endangers a 95-entry handler list, the callback URL carries a single-use secret, and two live `relaunch()` call sites can be broken by introducing single-instance.*

8. **Zero IPC regression.** All 95 command entries currently inside `tauri::generate_handler![...]` (`commands::get_db_status` through `commands::financial_health::set_emergency_fund_target`) are still registered, and all five existing plugins (`opener`, `dialog`, `updater`, `process`, plus the two new ones) are still registered. The entire existing `.setup(...)` closure body (tracing init, keyring init, DB init, AI init, `app.manage(...)` calls, catalog refresh, recurring-apply task) is preserved unchanged in behaviour and ordering.
9. **No secret leakage in logs.** No `code`, `state`, or `error_description` **value** from a deep-link URL is written to the log file. Only the scheme/host/path and boolean presence flags for those parameters may be logged.
10. **Relaunch paths still work.** Adding single-instance must not break the two existing `relaunch()` call sites — `apps/desktop/src/components/shared/UpdateChecker.tsx:72` (auto-update install → relaunch) and `apps/desktop/src/components/settings/DangerZone.tsx:100` (delete-all-data → relaunch). Both are manually re-verified after the change.
11. **No version bump, clean compile.** The `version` field in `tauri.conf.json`, `Cargo.toml`, and `package.json` stays at `0.3.2` — this is not a release story. `cargo build` and `tsc` complete with **zero** new warnings (`docs/guidelines/warnings.md`, `docs/project-context.md#9-compilation-warnings-policy`).

## Tasks / Subtasks

- [x] **Task 1: Add the two Rust plugin crates to `src-tauri/Cargo.toml`** (AC: #1)
  - [x] Inside the existing `[dependencies]` table, add `tauri-plugin-deep-link = "2"` (latest stable `2.4.9`), matching the bare-`"2"` style already used by `tauri-plugin-opener`, `tauri-plugin-updater`, `tauri-plugin-process`.
  - [x] Append a **new target-scoped table at the very end of the file** (TOML requires it after `[dependencies]`):
        `[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]` containing
        `tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }` (latest stable `2.4.3`).
        The `deep-link` feature is **mandatory** — without it the single-instance plugin will not re-trigger the deep-link event for the forwarded argv.
  - [x] Do **not** add `aws-sdk-cognitoidentityprovider`, `url`, or any other crate. Do not touch `version = "0.3.2"`.
  - [x] Run `cargo build` from `apps/desktop/src-tauri` and commit the resulting `Cargo.lock` change.

- [x] **Task 2: Add the frontend plugin package** (AC: #1)
  - [x] `pnpm --filter @nixus/desktop add @tauri-apps/plugin-deep-link` (latest `2.4.9`); it lands in `dependencies` alongside the existing `@tauri-apps/plugin-dialog` / `-opener` / `-process` / `-updater`.
  - [x] Write **no** frontend code in this story. The handler is Rust-side (`on_open_url`); the JS package is the declared dependency for later frontend use. An unimported dependency does not trip `noUnusedLocals`.
  - [x] Do not bump `"version": "0.3.2"` in `apps/desktop/package.json`.

- [x] **Task 3: Configure the scheme in `tauri.conf.json`** (AC: #2)
  - [x] Add a `"deep-link"` key inside the existing `"plugins"` object (which currently holds only `"updater"`), with value `{ "desktop": { "schemes": ["nixus"] } }`.
  - [x] Leave `"updater"`, `"version"`, `"identifier"`, `"app"`, and `"bundle"` untouched. On macOS this config is what generates the `CFBundleURLTypes` Info.plist entry at bundle time.

- [x] **Task 4: Grant the capability** (AC: #2)
  - [x] Add `"deep-link:default"` to the `permissions` array in `apps/desktop/src-tauri/capabilities/default.json`.
  - [x] Do **not** add `core:event:default` — it is already included by the existing `core:default` entry. Do not add a `single-instance` permission; that plugin exposes no commands.

- [x] **Task 5: Create the deep-link seam in `commands/auth.rs`** (AC: #6, #9)
  - [x] Create `apps/desktop/src-tauri/src/commands/auth.rs` containing **only** `pub fn dispatch_deep_link_url(_app: &tauri::AppHandle, url: &str, source: &str)` — no Tauri commands in this story (Story 26.4 adds `start_login` / `handle_auth_callback` to this same file).
  - [x] Body: split the URL once on `'?'`; `tracing::info!` the pre-query part plus `source` and three booleans for whether `code=`, `state=`, and `error=` params are present. Never log a parameter value (AC #9).
  - [x] Keep the `_app: &AppHandle` parameter (underscore-prefixed to satisfy the `unused_variables` lint) — Story 26.4 needs it to emit `auth:callback-received`.
  - [x] Do **not** emit any Tauri event in this story. `auth:callback-received` belongs to Story 26.4 *after* a successful token exchange; emitting it here would tell Epic 27's frontend a sign-in completed when it did not.
  - [x] Do **not** reference `AppError::Auth` — that variant is Story 26.2's deliverable, and this story must compile independently of 26.2's merge state.
  - [x] Add `pub mod auth;` to `apps/desktop/src-tauri/src/commands/mod.rs`, in alphabetical position between `pub mod asset;` (line 2) and `pub mod backup;` (line 3).

- [x] **Task 6: Restructure the builder in `lib.rs` and register single-instance first** (AC: #3, #8)
  - [x] Convert `tauri::Builder::default()` from one chained expression into `let mut builder = tauri::Builder::default();`, so the `#[cfg(desktop)]`-gated single-instance registration can precede everything else.
  - [x] Register `tauri_plugin_single_instance::init(|app, argv, _cwd| { ... })` as the first plugin. Closure body: `tracing::info!` that a second instance was intercepted (log `argv.len()`, **not** argv contents — argv carries the callback URL, AC #9), then `if let Some(window) = app.get_webview_window("main")` → `unminimize()`, `show()`, `set_focus()`, each with `let _ =`. `Manager` is already imported at `lib.rs:13`.
  - [x] Do **not** parse argv or call `dispatch_deep_link_url` from this closure. With the `deep-link` feature enabled the plugin has *already* fired the deep-link event before the closure runs; dispatching again would double-handle the URL and, in Story 26.4, burn the single-use authorization code twice.
  - [x] Then chain `.plugin(tauri_plugin_deep_link::init())` followed by the four existing plugin registrations in their current order (`opener`, `dialog`, `updater`, `process`).
  - [x] Verify with `git diff` that the `invoke_handler(tauri::generate_handler![...])` list still contains all 95 entries and that the `.setup(...)` body is byte-identical apart from the additions in Task 7.

- [x] **Task 7: Wire `on_open_url`, cold-start capture, and dev-mode scheme registration** (AC: #3, #5, #6, #7)
  - [x] At the **end** of the existing `.setup(...)` closure — after the tracing subscriber is initialized (`lib.rs:37-41`), so log lines actually reach the file, and immediately before the final `Ok(())` — add a block with `use tauri_plugin_deep_link::DeepLinkExt;` scoped inside it.
  - [x] Register the handler first: clone `app.handle()`, then `app.deep_link().on_open_url(move |event| { for url in event.urls() { commands::auth::dispatch_deep_link_url(&handle, url.as_str(), "on_open_url"); } })`.
  - [x] Then capture a cold start: `if let Ok(Some(urls)) = app.deep_link().get_current()` → dispatch each with `source = "cold_start"`.
  - [x] Add dev-mode OS registration gated exactly as `#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]` → `app.deep_link().register_all()`, logging a `tracing::warn!` on `Err` instead of propagating (a dev-convenience failure must never abort startup). This cfg deliberately excludes macOS: runtime scheme registration is unsupported there.
  - [x] Record in Completion Notes how many log lines a single cold-start deep link produces per platform (`on_open_url` only, `cold_start` only, or both) — Story 26.4 needs this contract to decide whether `handle_auth_callback` must tolerate a duplicate delivery.

- [ ] **Task 8: Verify on macOS** (AC: #5, #6, #7, #11)
  - [x] `cargo build` in `apps/desktop/src-tauri` → zero warnings. `pnpm --filter @nixus/desktop build` → zero TS warnings.
  - [ ] `pnpm --filter @nixus/desktop tauri build`, then install the produced `.app` into `/Applications` and launch it from there. Deep links on macOS only work for a bundled app installed in `/Applications` — `tauri dev` will **not** work for this verification, and no code change can make it work.
  - [ ] **The log file is at `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log.YYYY-MM-DD`** — keyed on the bundle *identifier*, not on `productName`. Do not look in `~/Library/Application Support/Nixus/`; it does not exist.
  - [ ] With the installed app running: `open "nixus://auth/callback?code=test&state=test"`. Confirm a `source=on_open_url` line with `code=true, state=true` appears in that log, and that no second window/dock icon appears.
  - [ ] Quit the app, then run the same `open` command cold. Confirm the URL is still logged (AC #7) and note which `source` fired.
  - [ ] Confirm the log contains no `code=test` / `state=test` literal (AC #9): `grep -c 'code=test' <logfile>` must return `0`.

- [ ] **Task 9: Verify on Windows, then clean up the dev registration** (AC: #3, #4, #6, #7)
  - [ ] Launch via `pnpm --filter @nixus/desktop tauri dev` (the `all(debug_assertions, windows)` `register_all()` path makes the scheme resolvable without installing).
  - [ ] **The log file is at `%APPDATA%\com.nbazinet.nkbaz-finance\nkbaz-finance.log.YYYY-MM-DD`.**
  - [ ] From another shell: `start "" "nixus://auth/callback?code=test&state=test"`. Confirm exactly one app window exists, the existing window is focused, and both the single-instance interception line and the `dispatch_deep_link_url` line appear in the log.
  - [ ] Repeat cold (app not running) and confirm the URL is captured after initialization (AC #7).
  - [ ] **Clean up afterwards — this is a real OS-level side effect outside the repo.** `register_all()` writes an `HKCU\Software\Classes\nixus` protocol-handler entry pointing at the **debug** exe path in `target/debug/`. After a `cargo clean`, a branch switch, or a later production install on the same machine, that stale entry can swallow or misroute `nixus://` links and silently break verification of Stories 26.4/26.5. Remove it with `reg delete HKCU\Software\Classes\nixus /f` (or one call to the plugin's `unregister("nixus")`) once Windows verification is done, and re-verify the scheme after any subsequent production install.

- [ ] **Task 10: Regression-verify the two relaunch paths and the dev loop** (AC: #10)
  - [ ] Trigger the Danger Zone delete-all-data flow (`apps/desktop/src/components/settings/DangerZone.tsx:100` → `relaunch()`) on both platforms and confirm the app comes back up instead of the new process being swallowed by single-instance.
  - [ ] **The failure mode to watch for, precisely:** `relaunch()` spawns the replacement process while the old one is still shutting down. Single-instance can intercept that new launch and merely refocus the old, about-to-exit window — leaving **zero** live windows once the old process dies, i.e. the app appears to vanish. If that happens, do not remove single-instance; report it and stop, because the fix (a shutdown handshake) is a design change beyond this story.
  - [ ] Exercise the updater relaunch path (`apps/desktop/src/components/shared/UpdateChecker.tsx:72`) — on Windows the updater's installer also expects the running app to exit, so it stacks the same risk. If no real update is available, confirm the Danger Zone `relaunch()` works and record the updater path as verified-by-proxy in Completion Notes, naming the failure mode above as the thing to watch on the next release.
  - [ ] Confirm the normal dev loop still behaves: a second `tauri dev` now focuses the first instance instead of opening a second window — note this in Completion Notes as expected new behaviour, not a bug.

- [x] **Task 11: Confirm scope boundaries** (AC: #1, #11)
  - [x] `git diff --stat` should touch only: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/auth.rs` (new), `apps/desktop/package.json`, `pnpm-lock.yaml`.
  - [x] No changes to `error.rs`, `credentials.rs`, `models/mod.rs`, any `db/` file, any migration, any locale file, or anything under `apps/desktop/src/`.
  - [x] No Playwright spec is added — see Dev Notes › Testing.

## Dev Notes

### Current state of the files this story modifies

**`apps/desktop/src-tauri/src/lib.rs` (191 lines).** `run()` is a single chained expression: `tauri::Builder::default()` → four `.plugin(...)` calls in this exact order — `tauri_plugin_opener::init()` (line 20), `tauri_plugin_dialog::init()` (21), `tauri_plugin_updater::Builder::new().build()` (22), `tauri_plugin_process::init()` (23) — then `.setup(|app| {...})` (24-91), then `.invoke_handler(tauri::generate_handler![...])` with **95 command entries** (92-188), then `.run(tauri::generate_context!())` (189). Module declarations at lines 1-9 (`ai, budget, commands, credentials, db, error, financial_health, maintenance, models`). Imports at 11-15 include `use tauri::{Emitter, Manager};` — `Manager` is what makes `get_webview_window` available, `Emitter` is what makes `app.emit` available; both already in scope, so no import churn is needed. The `setup` body, in order: resolve `app_data_dir`, `create_dir_all`, initialize `tracing_subscriber` with a daily rolling file appender named `nkbaz-finance.log` at `info` level with ANSI off (35-41), `keyring::use_native_store(false)` (44), `init_db` (48), `ai::init_ai_client` (54), two `app.manage(...)` calls (57-58), `maintenance::catalog::spawn_background_catalog_refresh` (61), and an async task that applies due recurring expenses and emits `recurring:applied` (63-88). **Nothing deep-link or single-instance related exists.** Because tracing is initialized *inside* `setup`, any deep-link log line must be emitted from a point at or after line 41 — putting it before that silently discards the output.

**`apps/desktop/src-tauri/Cargo.toml` (44 lines).** `[package] name = "nkbaz-finance"`, `version = "0.3.2"`, `edition = "2021"`. `[lib] name = "nkbaz_finance_lib"`. Sections in order: `[package]`, `[lib]`, `[build-dependencies]`, `[dependencies]`. `[dependencies]` is the **last** table in the file and holds `tauri = { version = "2.11", features = [] }`, `tauri-plugin-opener = "2"`, `tauri-plugin-dialog = "2.7.0"`, `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"`, plus `serde`, `serde_json`, `rusqlite 0.38`, `tracing`, `tracing-subscriber`, `tracing-appender`, `chrono`, `tempfile`, `base64`, `aws-config`, `aws-sdk-bedrockruntime`, `tokio`, `regex`, `keyring 4`, `keyring-core 1`, `async-openai`, `reqwest 0.12` (rustls-tls, no default features), `urlencoding`. There are **no `[target...]` tables today** — the one added in Task 1 must go at the end of the file, or TOML will silently absorb subsequent bare keys into it. No `url` crate is a direct dependency, which is why the seam takes `&str` rather than `&url::Url`.

**`apps/desktop/src-tauri/tauri.conf.json` (46 lines).** `productName: "Nixus"`, `version: "0.3.2"`, `identifier: "com.nbazinet.nkbaz-finance"`. `plugins` (lines 26-33) currently contains **only** `updater` with a `pubkey` and one GitHub `endpoints` entry. `app.security.csp` is `null`. `bundle.createUpdaterArtifacts` is `true` and `targets` is `"all"`. There is no `deep-link` key.

**`apps/desktop/src-tauri/capabilities/default.json` (13 lines, the only file in `capabilities/`).** `identifier: "default"`, `windows: ["main"]`, `permissions: ["core:default", "opener:default", "dialog:default", "updater:default", "process:default"]`.

**`apps/desktop/src-tauri/src/commands/mod.rs` (63 lines).** 20 alphabetical `pub mod` declarations (`account` … `yearly_summary`) followed by the `DbStatus` struct and the `get_db_status` command. There is no `auth` module yet.

### Reference implementation shape

`lib.rs` builder head — single-instance first, deep-link second, existing plugins after:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must precede deep-link so a Windows nixus:// launch is
    // forwarded into the running process instead of spawning a second window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            info!("Second instance intercepted ({} argv entries); focusing main window", argv.len());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // ... entire existing body unchanged ...

            {
                use tauri_plugin_deep_link::DeepLinkExt;

                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                if let Err(e) = app.deep_link().register_all() {
                    tracing::warn!("Runtime deep link scheme registration failed: {}", e);
                }

                let deep_link_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        commands::auth::dispatch_deep_link_url(
                            &deep_link_handle,
                            url.as_str(),
                            "on_open_url",
                        );
                    }
                });

                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let cold_start_handle = app.handle().clone();
                    for url in urls {
                        commands::auth::dispatch_deep_link_url(
                            &cold_start_handle,
                            url.as_str(),
                            "cold_start",
                        );
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ... all 95 existing entries, unchanged ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`commands/auth.rs` — the whole file for this story:

```rust
use tauri::AppHandle;
use tracing::info;

/// Single entry point for every `nixus://` URL the OS hands to this app.
/// Story 26.4 replaces this body with PKCE state validation + token exchange;
/// the signature is intentionally stable so that change is body-only.
pub fn dispatch_deep_link_url(_app: &AppHandle, url: &str, source: &str) {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let has = |name: &str| query.split('&').any(|p| p.starts_with(&format!("{name}=")));

    // Query values carry the single-use authorization code and CSRF state — never log them.
    info!(
        "Deep link received (source={}): {} [code={}, state={}, error={}]",
        source,
        path,
        has("code"),
        has("state"),
        has("error")
    );
}
```

### Critical constraints

- **Registration order is load-bearing, not stylistic.** `architecture-login.md` states plainly that without single-instance a Windows deep-link redirect launches a *new* process, so sign-in would spawn a duplicate window instead of completing in the original. macOS routes deep links to the running process by OS default and is unaffected — but the plugin is still registered on both (`#[cfg(desktop)]`) so behaviour is uniform.
- **The `deep-link` cargo feature on `tauri-plugin-single-instance` is required.** With it, the plugin re-triggers the deep-link event for the forwarded argv automatically. This is exactly why the single-instance closure must **not** parse argv itself: doing so produces two dispatches of one URL, which in Story 26.4 means two `POST /oauth2/token` attempts with the same single-use `code` — the second fails and surfaces a spurious auth error to the user.
- **Log redaction is a hard requirement, not a nicety.** The callback URL contains the authorization `code` and the CSRF `state`. Story 26.4's AC forbids token values in logs; the same reasoning applies to the code that mints them. Log presence booleans only. Likewise log `argv.len()`, never argv itself.
- **No event emission in this story.** `auth:callback-received` is Story 26.4's, emitted only *after* the session is stored. Emitting it here would make Epic 27's `useAuth.ts` listener invalidate `["auth", "session"]` and re-render as still-logged-out — a misleading signal with no corresponding state change.
- **This story must compile independently of Story 26.2.** 26.2 adds `AppError::Auth`, `CognitoSession`, `AuthState`, and the `credentials.rs` session functions. None of them are referenced here. Do not add an `AppError` variant, a model, or a keyring call in this story. The architecture delta tree confirms 26.2 and 26.3 touch disjoint files, so either can land first.
- **Handoff contract for Story 26.4:** `commands/auth.rs` and `pub mod auth;` exist after this story. 26.4 adds to them; it must not recreate the file or introduce a second deep-link handler. See CRITICAL CONTEXT §3.
- **This story must not anticipate Story 26.4.** No PKCE generation, no `reqwest` call, no `#[tauri::command]`, no `generate_handler!` addition. The seam's only job is to prove the URL arrived.
- **Preserve the 95-entry handler list.** Restructuring `run()` from a chained expression to `let mut builder` is the single largest regression risk in this story: an accidentally truncated `generate_handler!` list breaks arbitrary features with a runtime "command not found" rather than a compile error. Diff-review the list explicitly.
- **Do not bump the app version.** `docs/project-context.md#10-version-bumps` requires three files to move together *for a release*; this is a dependency/config story, so all three stay at `0.3.2`. Cargo.lock and pnpm-lock.yaml changes from the new deps are expected and must be committed.
- **`keyring::use_native_store(false)` at `lib.rs:44` must keep running before any credential access** — it sits inside the preserved `setup` body; do not reorder around it.

### Testing

- **Playwright cannot cover this story, and no spec should be written.** `apps/desktop/playwright.config.ts` starts `pnpm run dev` on port 1420 and points `baseURL` at `http://localhost:1420` — the 23 specs in `apps/desktop/tests/` run in a plain browser against the Vite dev server with `window.__TAURI_INTERNALS__.invoke` stubbed by a per-spec inline `setupTauriMock` helper. There is no compiled Tauri process, no OS URL-scheme handler, and no real plugin, so plugin registration and OS deep-link delivery are structurally untestable there. `docs/project-context.md#testing-rules` confirms Playwright E2E is the desktop app's only framework and there is no Rust unit-test harness.
- **Verification is therefore manual and platform-specific**, per Tasks 8-10. This is exactly what epic AC 6's "observable evidence (log line or emitted event)" anticipates.
- **Evidence to capture in Completion Notes:** the matching `Deep link received (source=...)` log lines for macOS-warm, macOS-cold, Windows-warm, Windows-cold; proof that `grep -c 'code=test'` against the log returns `0`; window-count observation for the Windows warm case; the outcome of both relaunch checks; and confirmation that the Windows dev registry entry was removed.
- **Log file location** (identifier-keyed, not `productName`-keyed): macOS `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log.YYYY-MM-DD`; Windows `%APPDATA%\com.nbazinet.nkbaz-finance\nkbaz-finance.log.YYYY-MM-DD`. Daily rotation, `info` level, ANSI off, file-only (no stdout).
- **macOS cannot be verified via `tauri dev`.** Runtime scheme registration is unsupported on macOS, so only a bundled app installed in `/Applications` will receive `nixus://`. Budget for a full `tauri build`.
- **`nixus://auth/signout` is covered by the same registration and needs no extra work.** Story 26.1 configures it as Cognito's sign-out URL, so it shares the `nixus` scheme registered here. The seam handles it safely already — `url.split_once('?').unwrap_or((url, ""))` copes with a query-less URL, and all three presence flags simply log `false`. It is inert in practice because Story 26.5's `sign_out` only clears the keyring locally and never navigates the browser to Cognito's logout endpoint. Do not add path-based routing to the seam; that belongs to Story 26.4 if it is ever needed.
- **Note for CI:** nothing in this story changes CI behaviour; a dedicated test Cognito pool remains an out-of-scope CI setup task per Story 27.4.

### Project Structure Notes

Every path in this story is already prescribed by `architecture-login.md`'s delta tree, and each is a modification of an existing file except one new module:

| Path | Change | Source |
|---|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | MODIFIED: + deep-link, + single-instance (target-scoped) | delta tree |
| `apps/desktop/src-tauri/Cargo.lock` | MODIFIED: lockfile update (repo commits it) | git history `314d945` |
| `apps/desktop/src-tauri/tauri.conf.json` | MODIFIED: + `plugins.deep-link.desktop.schemes` | delta tree |
| `apps/desktop/src-tauri/capabilities/default.json` | MODIFIED: + `deep-link:default` | delta tree |
| `apps/desktop/src-tauri/src/lib.rs` | MODIFIED: single-instance first, then deep-link; deep-link wiring at end of `setup` | delta tree |
| `apps/desktop/src-tauri/src/commands/auth.rs` | NEW: `dispatch_deep_link_url` seam only | delta tree (file is NEW for the feature; 26.4 adds the commands) |
| `apps/desktop/src-tauri/src/commands/mod.rs` | MODIFIED: + `pub mod auth;` | implied by `commands/{feature}.rs` convention |
| `apps/desktop/package.json` | MODIFIED: + `@tauri-apps/plugin-deep-link` | delta tree |
| `pnpm-lock.yaml` | MODIFIED: lockfile update | monorepo convention |

**Conventions honoured:** one Rust file per feature under `commands/` (`docs/project-context.md#rust-backend-structure`); `snake_case` Rust functions; `tracing::info!` for a successful/expected event and `tracing::warn!` for a non-fatal degraded path, matching `commands/danger_zone.rs:17,21`; zero compilation warnings (`docs/guidelines/warnings.md`).

**Deliberate variances:**
- `commands/auth.rs` is created without any `#[tauri::command]` in it. Every other `commands/*.rs` file contains commands. This is intentional: it keeps the seam in its architecturally-assigned home so Story 26.4 is a body-and-additions change rather than a file move, and avoids a throwaway module. The function is called from `lib.rs`, so no `#[allow(dead_code)]` is needed. This also means `commands/auth.rs` and `commands/mod.rs` are owned by **this** story, not by 26.4 as Story 26.2's do-not-touch table states — see CRITICAL CONTEXT §3.
- `@tauri-apps/plugin-deep-link` is added but not imported. Required explicitly by epic AC 1 and the architecture delta tree; the handler is Rust-side by design (`architecture-login.md` › Integration Points).
- A target-scoped `[target.'cfg(...)'.dependencies]` table appears in `Cargo.toml` for the first time. This is the official Tauri v2 pattern for `tauri-plugin-single-instance` and keeps a hypothetical mobile build (`#[cfg_attr(mobile, tauri::mobile_entry_point)]` at `lib.rs:17` implies the target is nominally considered) from trying to compile a desktop-only plugin.
- No new i18n keys, no locale changes: this story adds no user-facing string. The platform-wide i18n rule is not triggered.

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md#Story 26.3: Deep Link & Single-Instance Plugin Registration] — the seven epic acceptance criteria reproduced above.
- [Source: _bmad-output/planning-artifacts/epics-login.md#Additional Requirements] — "`tauri-plugin-deep-link` (captures `nixus://auth/callback`) and `tauri-plugin-single-instance` (required so a Windows deep-link redirect routes to the running process instead of spawning a duplicate app window — must be registered *before* `tauri_plugin_deep_link::init()`), plus `@tauri-apps/plugin-deep-link` on the frontend"; and "Explicitly not added: `aws-sdk-cognitoidentityprovider`".
- [Source: _bmad-output/planning-artifacts/epics-login.md#Epic 26: Cognito Account Sign-In] — Story 26.2 owns `CognitoSession`/`AuthState`/`AppError::Auth`/`credentials.rs` session functions; Story 26.4 owns `start_login`/`handle_auth_callback`, the `/oauth2/token` exchange, the `auth:callback-received` emit, and the "no token value in logs" rule; Story 26.5 owns `get_auth_session`/`sign_out`. None of these are in this story's scope. Sibling story files may not exist yet — `epics-login.md` is the authority for their content.
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Project Structure & Boundaries] — delta tree: `lib.rs # MODIFIED: register tauri_plugin_single_instance::init() (must be first plugin registered) + tauri_plugin_deep_link::init()`; `tauri.conf.json # MODIFIED: + plugins.deep-link.desktop.schemes = ["nixus"]`; `capabilities/default.json # MODIFIED: + deep-link:default permission`.
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Project Structure & Boundaries] Windows note — "nixus doesn't currently register `tauri-plugin-single-instance`. On Windows (and Linux), a deep-link redirect launches a *new* process rather than routing to the running instance — without single-instance handling, signing in could spawn a duplicate app window instead of completing login in the original one. `tauri-plugin-single-instance` must be added and registered *before* `tauri_plugin_deep_link::init()` in `lib.rs`. macOS is unaffected (deep links route to the existing process by OS default)."
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Authentication & Security] — "Callback handling: Custom URI scheme (`nixus://auth/callback`), captured via `tauri-plugin-deep-link`. No localhost redirect server needed."
- [Source: _bmad-output/planning-artifacts/architecture-login.md#Starter Template Evaluation] — deep-link is an official Tauri v2 plugin supported on macOS + Windows, nixus's target platforms; `tauri-plugin-opener`, `reqwest`, `keyring` are reused, not re-added.
- [Source: _bmad-output/planning-artifacts/architecture-login.md#File Organization Patterns] — "Test organization: Desktop has no unit test framework (Playwright E2E only)"; "Asset organization: No new static assets."
- [Source: docs/project-context.md#Rust Backend Structure] — `commands/{feature}.rs` per feature; `lib.rs` is where commands are registered.
- [Source: docs/project-context.md#9-compilation-warnings-policy] and [Source: docs/guidelines/warnings.md] — all Rust and TypeScript warnings must be resolved before committing; remove genuinely dead code rather than silencing it.
- [Source: docs/project-context.md#10-version-bumps] — the three-file version rule applies to releases; this story is not a release.
- [Source: docs/project-context.md#Testing Rules] — "No unit test framework in desktop — all testing is Playwright E2E. Tests live in `apps/desktop/tests/`."
- [Source: apps/desktop/src-tauri/src/lib.rs:19-23] — current plugin chain and its order.
- [Source: apps/desktop/src-tauri/src/lib.rs:35-41] — tracing initialization inside `setup`; daily rolling `nkbaz-finance.log` in `app_data_dir` at `info` level.
- [Source: apps/desktop/src-tauri/src/lib.rs:13] — `use tauri::{Emitter, Manager};` already in scope.
- [Source: apps/desktop/src-tauri/src/lib.rs:92-188] — the 95-entry `generate_handler!` list that must survive the restructure.
- [Source: apps/desktop/src-tauri/src/lib.rs:83] — existing colon-namespaced event precedent `app_handle.emit("recurring:applied", ...)`, matching the `auth:callback-received` convention Story 26.4 will follow.
- [Source: apps/desktop/src-tauri/Cargo.toml:20-43] — `[dependencies]` is the final table; existing plugins pinned as bare `"2"`.
- [Source: apps/desktop/src-tauri/tauri.conf.json:26-33] — `plugins` currently holds only `updater`.
- [Source: apps/desktop/src-tauri/capabilities/default.json:6-12] — current permissions array; `core:default` already implies `core:event:default`.
- [Source: apps/desktop/src-tauri/src/commands/mod.rs:1-20] — alphabetical `pub mod` list; insert `auth` after `asset`.
- [Source: apps/desktop/src-tauri/src/commands/danger_zone.rs:17,21] — `info!` for completion, `warn!` for a non-fatal degraded path; the logging style to match.
- [Source: apps/desktop/playwright.config.ts] — `webServer: pnpm run dev`, `baseURL: http://localhost:1420`; tests never launch a Tauri binary, hence no E2E coverage for this story.
- [Source: apps/desktop/src/components/shared/UpdateChecker.tsx:72] and [Source: apps/desktop/src/components/settings/DangerZone.tsx:100] — the two `relaunch()` call sites that single-instance could regress.
- [Source: https://v2.tauri.app/plugin/deep-linking] — `tauri.conf.json` shape `{"plugins":{"deep-link":{"desktop":{"schemes":[...]}}}}`; `tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }` declared under `[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]`; single-instance registered first inside `#[cfg(desktop)]` with the note that "the deep link event was already triggered" before the closure runs; `DeepLinkExt` + `on_open_url` + `get_current`; `register_all()` gated on `#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]`; "Registering deep links at runtime is not supported on macOS. Therefore, deep links can only be tested on bundled applications that have been installed in the `/Applications` directory."; `deep-link:default` capability permission.
- [Source: _bmad-output/implementation-artifacts/26-4-pkce-login-launch-and-callback-token-exchange.md] — its Prerequisite Gate row "Story 26.3's callback-URL handler seam exists but under a different name than assumed below → adapt to the real name; replace its body with the call into `handle_auth_callback`'s inner function. Do **not** create a second parallel handler." This is the row that governs; 26.4's "`commands/auth.rs` does not exist" statement describes the pre-26.3 state only.
- [Source: _bmad-output/implementation-artifacts/26-2-auth-models-error-variant-and-secure-session-storage.md] — its do-not-touch table assigns `Cargo.toml` / `tauri.conf.json` / `capabilities/default.json` to Story 26.3 (correct) and `commands/auth.rs` / `commands/mod.rs` to Stories 26.4/26.5 (superseded by this story, per the architecture delta tree).
- [Source: apps/desktop/package.json] and [Source: packages/shared/package.json] — actual package names are `@nixus/desktop` and `@nixus/shared`; `docs/project-context.md`'s `@nkbaz/` scope is stale. The Rust crate, log filename, and bundle identifier legitimately keep the `nkbaz-finance` name.
- Latest stable versions at story creation (2026-08-09): `tauri-plugin-deep-link` 2.4.9, `tauri-plugin-single-instance` 2.4.3, `@tauri-apps/plugin-deep-link` 2.4.9 — all compatible with the project's `tauri = "2.11"`.

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cargo build` (apps/desktop/src-tauri) — `Compiling nkbaz-finance v0.3.2` → `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 6.43s`. No warnings emitted.
- `cargo check` (forced recompile via `touch src/lib.rs src/commands/auth.rs src/commands/mod.rs`) — `Compiling tauri-plugin-deep-link v2.4.9` / `Compiling nkbaz-finance v0.3.2` / `Checking tauri-plugin-single-instance v2.4.3` → `Finished \`dev\` profile ... in 7.47s`. No warnings emitted.
- `pnpm --filter @nixus/desktop exec tsc --noEmit` — exit code 0, no output.
- `pnpm --filter @nixus/desktop build` (`tsc && vite build`) — `✓ 4304 modules transformed.` / `✓ built in 9.95s`. Zero TS diagnostics. The only advisory is Vite's pre-existing `chunks are larger than 500 kB` hint, which is unrelated to this story (no frontend code was added and the new JS package is not imported).
- `pnpm --filter @nixus/desktop exec playwright test` — 329 passed, 4 failed. See "Playwright status" below; none are caused by this story.

### Completion Notes List

**Files-collision check performed first (per the parallel-Story-26.1 hazard).** `ls apps/desktop/src-tauri/src/commands/auth.rs` → `No such file or directory`; `grep -n "pub mod auth;" commands/mod.rs` → no match (exit 1). So neither artifact existed and this story created both from scratch. No Cognito consts were written, and nothing from Story 26.1 was overwritten. If 26.1 lands its `pub const` block later it must **append into** the existing `commands/auth.rs`, above or below `dispatch_deep_link_url`, and must **not** re-add `pub mod auth;` (already present at `commands/mod.rs:3`).

**AC 8 — zero IPC regression, measured.** `generate_handler!` entry count **before = 95**, **after = 95** (counted with `awk` over the macro range piped to `grep -c "commands::"`; before-count taken against `lib.rs` at baseline commit `9b45411`). `git diff apps/desktop/src-tauri/src/lib.rs` produces exactly two hunks, both purely additive: the builder head (`tauri::Builder::default()` → `let mut builder = ...` + the `#[cfg(desktop)]` single-instance block + `.plugin(tauri_plugin_deep_link::init())`) and a block inserted immediately before the final `Ok(())`. The `.setup(...)` body and the entire `generate_handler!` list emit **zero** diff lines, i.e. they are byte-identical: tracing init, `keyring::use_native_store(false)`, `init_db`, `ai::init_ai_client`, both `app.manage(...)` calls, `spawn_background_catalog_refresh`, and the recurring-apply async task are all untouched in content and ordering. Plugin registrations after the change (`grep -n "\.plugin("`): `single_instance` (line 25, first), `deep_link` (41), `opener` (42), `dialog` (43), `updater` (44), `process` (45) — six total, original four in their original relative order.

**AC 9 — no secret leakage.** `dispatch_deep_link_url` logs only the pre-`?` portion of the URL, the `source` string, and three booleans. Query values are never formatted into the log record — the closure `has(name)` returns a `bool` and only the `bool` reaches `info!`. The single-instance closure logs `argv.len()` and never argv itself. No other new log statement touches URL data. Runtime `grep -c 'code=test'` proof is deferred to the manual GUI step (see below); the static guarantee is structural, since no code path holds a query value in a formatted argument.

**AC 6 — log line, not an event, as the story directs.** No `auth:callback-received` emit and no other Tauri event was added. `dispatch_deep_link_url` has no `#[tauri::command]` attribute, no `generate_handler!` entry, no `reqwest`/keyring/PKCE, and takes `&str`. No `AppError::Auth` reference, so the file compiles independently of Story 26.2's merge state.

**Task 7 delivery contract for Story 26.4 — how many dispatches one deep link produces.** Established by reading the installed crate sources rather than guessing (`tauri-plugin-deep-link-2.4.9/src/lib.rs`, `tauri-plugin-single-instance-2.4.3/src/`, `tauri-2.11.5/src/app.rs`):

- `on_open_url` is a thin listener on the `deep-link://new-url` Tauri event; `get_current()` just reads the plugin's `current: Mutex<Option<Vec<Url>>>`.
- `tauri-2.11.5/src/app.rs` — `initialize_plugins` (line 2440) runs **before** the app `setup` closure (line 2531).
- **Windows/Linux cold start → exactly 1 line, `source=cold_start`.** The URL arrives as the single argv entry. `handle_cli_arguments` runs during the deep-link plugin's own setup, which both `current.replace(...)` and `emit("deep-link://new-url")`. Because that emit happens before the app `setup` closure registers our listener, `on_open_url` **misses** it (Tauri `listen` does not replay past emits) — `get_current()` is the only path that catches it, which is precisely why it is required.
- **macOS cold start → exactly 1 line, `source=on_open_url`.** macOS delivers via `RunEvent::Opened`, handled in the plugin's `on_event` hook, which runs on the runtime event loop *after* `setup` completed, so our listener is already installed. `current` is only populated inside that same `on_event` handler, so `get_current()` during setup can never see it → no double dispatch.
- **Warm start, macOS → 1 line, `source=on_open_url`** (`RunEvent::Opened` → emit → our listener).
- **Warm start, Windows → 2 log lines but only 1 dispatch.** The OS launches a second process; single-instance finds the named mutex (`{id}-sim`), locates the hidden window (`{id}-siw`) and forwards `cwd|args` via `WM_COPYDATA`, then `exit(0)`s. In the running instance, `tauri-plugin-single-instance/src/lib.rs:72-74` calls `deep_link.handle_cli_arguments(args)` **before** invoking our callback — confirming empirically why the closure must not parse argv. Result: one "Second instance intercepted" line from our closure plus one `source=on_open_url` line from `dispatch_deep_link_url`.
- **Contract conclusion: no platform/launch combination ever dispatches the same URL twice.** Story 26.4's `handle_auth_callback` does **not** need to tolerate duplicate delivery, but it must accept the URL from either `cold_start` (Windows/Linux cold) or `on_open_url` (everything else).

**AC 10 — relaunch analysis (static; runtime step not performed, see below).** Both call sites read and left unmodified: `UpdateChecker.tsx:72` (`await relaunch()` after `downloadAndInstall`) and `DangerZone.tsx:100` (`await relaunch()` inside a try/catch that surfaces `settings.dangerZoneRestartFailed`). Traced `relaunch()` down to `tauri-2.11.5/src/process.rs:74` — `restart()` does `Command::new(path).args(...).spawn()` then `exit(0)` immediately, so the old process dies microseconds after the child is spawned, while the child needs tens-to-hundreds of ms to reach the single-instance setup hook. Per-platform:
- **Windows is structurally safe.** The early-exit path in `platform_impl/windows.rs` is guarded by `if !hwnd.is_null()`: if the mutex still exists but the old process's hidden message window is gone, the new instance falls through and launches its own window instead of exiting. It cannot silently vanish.
- **macOS carries the residual race, heavily biased safe.** `platform_impl/macos.rs` exits on any successful `UnixStream::connect` to `/tmp/com_nbazinet_nkbaz_finance_si.sock` with no window guard, so a child that connects while the parent is still listening would exit and leave zero windows. Two facts make this practically unreachable: (a) the parent reaches `exit(0)` far earlier than the child reaches the plugin hook, and (b) `exit(0)` bypasses `RunEvent::Exit`, so `destroy()` never removes the socket file — the child then gets `ECONNREFUSED` on the stale path, which the `ConnectionRefused` arm handles by cleaning up and claiming singleton. No code change in this story could remove the race; per Task 10 the fix (a shutdown handshake) is out of scope, so it is documented rather than "fixed".
- **Updater path shares the identical mechanism** (same `relaunch()` → same `process::restart`), plus the Windows NSIS installer's own expectation that the app exits. Watch for exactly the vanish failure mode above on the next real release.
- **Expected new dev-loop behaviour:** a second `pnpm tauri dev` now focuses the first instance instead of opening a second window. This is intended single-instance behaviour, not a bug.
- No change was made to either `.tsx` file; no break was proven, so per instruction they were left alone.

**AC 11 — no version bump, clean compile.** All three version fields verified still `0.3.2`: `Cargo.toml` `version = "0.3.2"`, `tauri.conf.json` `"version": "0.3.2"`, `apps/desktop/package.json` `"version": "0.3.2"`. `cargo build`, `cargo check`, `tsc --noEmit`, and `tsc && vite build` all produce zero warnings. No blanket `#![allow(dead_code)]` and no targeted `#[allow]` was needed — `dispatch_deep_link_url` is called from `lib.rs`, so it is live code.

**Cargo.toml table placement.** The `[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]` table is the final table in the file with `tauri-plugin-single-instance` as its only key; no bare keys follow it, so nothing can be silently absorbed. Resolved versions from `Cargo.lock` match the story's stated latest stable: `tauri-plugin-deep-link 2.4.9`, `tauri-plugin-single-instance 2.4.3`.

**Playwright status — 4 failures, all pre-existing on `master`, none caused by this story.** 329 passed / 4 failed. Re-running the four in isolation: `expenses.spec.ts:666` and `maintenance.spec.ts:1318` **passed** → flaky timing. `chat.spec.ts:250` (font-family assertion) and `design-system.spec.ts:110` (CSS custom-property assertion) failed again → genuine but pre-existing. Proof they cannot be this story's regression: `git status --porcelain` filtered to `\.(css|ts|tsx|js|jsx)$` returns **nothing**, and `git status --porcelain -- 'apps/desktop/src/' 'packages/'` (excluding `src-tauri`) returns **nothing** — no frontend source file is modified or added anywhere in the working tree. Playwright also never compiles or launches the Rust binary (`playwright.config.ts` runs `pnpm run dev` against Vite on port 1420 with `window.__TAURI_INTERNALS__.invoke` stubbed per spec), so plugin registration is structurally unreachable from these tests. Per Dev Notes › Testing, no spec was added for this story. **These two failures should be triaged separately; they are not a gate this story can clear or has affected.**

**⚠️ NOT VERIFIED — requires manual GUI/OS steps I could not perform (Tasks 8, 9, 10 left unchecked).** Nothing below is claimed as passing:
- **Task 8 (macOS runtime):** `tauri build` + install into `/Applications` + `open "nixus://auth/callback?code=test&state=test"` warm and cold, reading `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.log.YYYY-MM-DD`, and the `grep -c 'code=test'` → `0` proof. Requires launching a bundled GUI app and driving an OS URL handler — **not verified.** Only the first subtask (zero-warning `cargo build` / frontend build) is checked off, because that is the part actually executed.
- **Task 9 (Windows runtime + registry cleanup):** requires a Windows host; this ran on macOS (`darwin`). **Not verified.** The `HKCU\Software\Classes\nixus` cleanup step is consequently still outstanding for whoever runs Windows verification.
- **Task 10 (both `relaunch()` flows end-to-end, and the second-`tauri dev` focus behaviour):** requires interactive GUI runs on both platforms. **Not verified at runtime** — only the source-level analysis above was performed.
- AC 4, AC 5, AC 7, AC 10 therefore remain **unverified at runtime** and AC 9's runtime `grep` proof is outstanding, even though every code-level requirement behind them is implemented and statically checked. Reviewer should execute Tasks 8-10 on a real macOS bundle and a Windows host before treating this story as fully accepted.

### File List

- `apps/desktop/src-tauri/Cargo.toml` — MODIFIED: `tauri-plugin-deep-link = "2"` in `[dependencies]`; new target-scoped table at EOF with `tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }`
- `apps/desktop/src-tauri/Cargo.lock` — MODIFIED: lockfile update (deep-link 2.4.9, single-instance 2.4.3 + transitive deps)
- `apps/desktop/src-tauri/tauri.conf.json` — MODIFIED: `plugins.deep-link.desktop.schemes = ["nixus"]`
- `apps/desktop/src-tauri/capabilities/default.json` — MODIFIED: `+ "deep-link:default"`
- `apps/desktop/src-tauri/src/lib.rs` — MODIFIED: `let mut builder`, `#[cfg(desktop)]` single-instance registered first, then deep-link; `on_open_url` + `get_current()` cold-start capture + cfg-gated `register_all()` at the end of `setup`
- `apps/desktop/src-tauri/src/commands/auth.rs` — NEW: `dispatch_deep_link_url` seam only
- `apps/desktop/src-tauri/src/commands/mod.rs` — MODIFIED: `+ pub mod auth;` (line 3, between `asset` and `backup`)
- `apps/desktop/package.json` — MODIFIED: `+ "@tauri-apps/plugin-deep-link": "^2.4.9"`
- `pnpm-lock.yaml` — MODIFIED: lockfile update

### Change Log

- 2026-08-09 — Story 26.3 implemented: registered `tauri-plugin-single-instance` (with the mandatory `deep-link` feature) as the first plugin and `tauri-plugin-deep-link` second; configured the `nixus` scheme and `deep-link:default` capability; added the `dispatch_deep_link_url` log-only seam in the new `commands/auth.rs`; wired `on_open_url`, cold-start capture, and dev-mode scheme registration at the end of the existing `setup` closure. 95-entry `generate_handler!` list and the full `setup` body preserved byte-identical. No version bump. Runtime GUI verification (Tasks 8-10) outstanding.

### Review Findings

**Reviewed:** 2026-08-09 · adversarial code review of the 9-file declared File List against the 11 ACs, the 4 CRITICAL CONTEXT items, and `docs/guidelines/warnings.md`. Baseline `9b45411`. Every Dev Agent Record claim was re-derived independently; none was taken on trust.

#### Verdict: **NO BLOCKING FINDINGS.**

Stated unambiguously: there is **zero** correctness bug, **zero** security issue, **zero** AC/guardrail violation, and **zero** regression in this change set. Every AC that can be verified statically on darwin passes. The 4 non-blocking items below are hardening/informational only — none of them needs to be fixed for this story to be accepted.

**Independently confirmed (not copied from the Dev Agent Record):**

- **AC 8 — zero IPC regression.** `generate_handler![...]` contains **exactly 95** `commands::` entries, and `diff` of the macro range (baseline `lib.rs:92-188` ↔ current `lib.rs:147-243`) is **byte-identical**. The `.setup(...)` body is likewise byte-identical: baseline lines 24-89 ↔ current lines 46-111 diff clean, with the new deep-link block inserted only between the recurring-apply task and the final `Ok(())`. Tracing init, `keyring::use_native_store(false)`, `init_db`, `ai::init_ai_client`, both `app.manage(...)` calls, `spawn_background_catalog_refresh`, and the recurring-apply spawn are unchanged in content **and** ordering. All 4 pre-existing plugins survive at `lib.rs:42-45` in their original relative order (`opener` → `dialog` → `updater` → `process`, matching baseline `lib.rs:20-23`). `lib.rs` is 1 deletion / 56 insertions — the single deletion is the `tauri::Builder::default()` → `let mut builder = ...` head conversion, exactly as designed.
- **AC 3 — registration order.** `tauri_plugin_single_instance::init(...)` at `lib.rs:25`, inside the `#[cfg(desktop)]` block at 23-38, applied to `builder` **before** the `builder.plugin(...)` chain begins at line 40 — so it is plugin #1 and `tauri_plugin_deep_link::init()` at line 41 is #2. This order is load-bearing beyond the doc claim: Tauri runs plugin `setup` hooks in registration order, so on a Windows warm launch the second process hits single-instance's `exit(0)` *before* the deep-link plugin's own setup can run in the doomed process. Handler focuses the existing `main` window via `get_webview_window("main")` → `unminimize()` / `show()` / `set_focus()`, each `let _ =`.
- **AC 9 — no secret leakage (hard gate).** Traced every string reaching a log macro to its origin. In `commands/auth.rs:12-19` the only interpolated arguments are `source` (a `&'static str` literal, `"on_open_url"` or `"cold_start"`), `path` (the pre-`?` slice), and three `bool`s. `has()` (line 9) builds its needle with `format!("{name}=")` from a literal `name` — never from a query value — and returns only a `bool`; no query substring can escape it. The single-instance closure (`lib.rs:28-31`) logs `argv.len()` only; argv contents never reach a macro. No other new log statement exists in the diff. Also audited the newly-introduced **third-party** log paths, which the dev did not: `tauri-plugin-deep-link-2.4.9/src/lib.rs:218` does `tracing::warn!("argument {url} ...")` with the full URL — unreachable here, because it is gated behind `else if cfg!(debug_assertions)` **and** only fires when the scheme is *not* in `plugins.deep-link.desktop.schemes`, and `nixus` is. `tauri-plugin-single-instance-2.4.3/src/platform_impl/macos.rs` logs only at `debug!` (suppressed by the hardcoded `info` filter) plus one `error!` carrying a bind error, never argv.
- **AC 1 — dependencies.** `tauri-plugin-deep-link = "2"` in `[dependencies]` (`Cargo.toml:33`); `tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }` (`Cargo.toml:50`) — the mandatory `deep-link` feature **is** present, and its effect was verified in the crate source (`single-instance/src/lib.rs` `Builder::callback` wraps the user callback so `deep_link.handle_cli_arguments(args.iter())` runs first, under `#[cfg(feature = "deep-link")]`). `@tauri-apps/plugin-deep-link: ^2.4.9` in `apps/desktop/package.json:24`. No `aws-sdk-cognitoidentityprovider`; no `url` crate as a direct dependency (it is transitive only). All 9 new `Cargo.lock` entries audited and every one is a transitive closure member of the two new plugins: `tauri-plugin-deep-link 2.4.9` → `rust-ini` → `ordered-multimap` → `dlv-list` → `const-random` → `const-random-macro` → `tiny-keccak`, plus `windows-registry 0.5.3`; and `tauri-plugin-single-instance 2.4.3` (all its own deps pre-existing). Nothing crept in. `pnpm-lock.yaml` adds only `@tauri-apps/plugin-deep-link@2.4.9` (dep: `@tauri-apps/api` 2.11.0, already present).
- **`Cargo.toml` TOML correctness.** `[target."cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))".dependencies]` is at line 49 — the **last** table in a 51-line file, holding one key (line 50) followed only by a blank line. No bare key can be absorbed. A `// Must remain the LAST table` comment guards it for future editors. The escaped-quote cfg expression is proven well-formed: `cargo check` parses every `[target.'cfg(...)']` table regardless of host platform and succeeded, and the dependency resolves on `aarch64-apple-darwin` (the crate compiles and `lib.rs:25` links).
- **AC 2 — config.** `tauri.conf.json` `plugins.deep-link.desktop.schemes` is exactly `["nixus"]`; the `updater` block (pubkey + single GitHub endpoint) is byte-identical, and `version`/`identifier`/`app`/`bundle` are untouched. `capabilities/default.json` adds `"deep-link:default"` and nothing else — verified to be a real permission (`tauri-plugin-deep-link-2.4.9/permissions/default.toml` → `allow-get-current`). `gen/` is gitignored (`.gitignore:13`), so its absence from the File List is correct.
- **AC 6 — correct seam shape.** `dispatch_deep_link_url` is a plain `pub fn` — no `#[tauri::command]`, absent from `generate_handler!` (proven by the byte-identical macro diff), no PKCE, no `reqwest`, no keyring, no `AppError`, and **no Tauri event emission of any kind** — in particular no `auth:callback-received`, so nothing falsely signals a completed sign-in. Signature takes `url: &str`, consistent with `url` deliberately not being a direct dependency. Story 26.2's guardrail holds too: `keyring_core::Entry` appears nowhere in this story's diff.
- **AC 11 — version + warnings.** `0.3.2` confirmed in all three of `tauri.conf.json:4`, `Cargo.toml:3`, `apps/desktop/package.json:4`. `cargo check --all-targets` after `touch`ing all three changed Rust files: **zero warnings**, exit 0. `pnpm exec tsc --noEmit`: exit 0, **zero bytes of output**. No blanket `#![allow(dead_code)]`; the only `#[allow(...)]` in `src-tauri/src/` are in `credentials.rs`/`models/mod.rs` (Story 26.2, out of scope) and the pre-existing `ai/chat.rs:25` — this story added none, and needed none, because `dispatch_deep_link_url` is live code called from `lib.rs:125` and `lib.rs:136`.
- **Cold-start / duplicate-dispatch contract — independently re-derived, dev's analysis is CORRECT.** Read `tauri-plugin-deep-link-2.4.9/src/lib.rs`, `tauri-plugin-single-instance-2.4.3/src/`, and `tauri-2.11.5/src/app.rs`. Confirmed: (a) `init_deep_link` calls `handle_cli_arguments(std::env::args())` inside the plugin's own `.setup()`, and on Windows/Linux that both `current.replace(...)` **and** `emit("deep-link://new-url")`; (b) `app.rs:2440 initialize_plugins` runs strictly before `app.rs:2531 (setup)(app)`; (c) `on_open_url` is a plain `app.listen(...)` with no replay of past emits. ⇒ **Windows/Linux cold = 1 dispatch, `cold_start` only** (the emit predates our listener; `get_current()` is the sole capture path — so AC 7 is satisfied and the URL is *not* silently dropped). `handle_cli_arguments` is a no-op on macOS (`if cfg!(windows) || cfg!(target_os = "linux")`), and `current` is populated on macOS only inside the plugin's `on_event` `RunEvent::Opened` arm, which runs on the runtime event loop after `setup` ⇒ **macOS cold and warm = 1 dispatch, `on_open_url` only**, and `get_current()` during setup provably returns `None`. **Windows warm = 1 dispatch, `on_open_url` only** (second process `SendMessageW(WM_COPYDATA)` → original process's window proc → `Builder::callback` wrapper → `handle_cli_arguments` → emit → our listener), plus one separate "Second instance intercepted" line from our own closure. **No platform/launch combination dispatches the same URL twice.** Story 26.4 will not burn a single-use auth code twice.
- **`#[cfg]` gating.** `x86_64-pc-windows-msvc` is **not** installed (`rustup target list --installed` → `aarch64-apple-darwin` only), so this was reasoned from source rather than compiled. `use tauri_plugin_deep_link::DeepLinkExt;` (`lib.rs:115`) is consumed unconditionally by `app.deep_link()` at 123 and 133, so removing the `#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]`-gated `register_all()` statement on macOS/Windows-release cannot produce an unused-import warning on any target. `tracing::warn!` is fully qualified, so no import is orphaned either. `register_all()` exists for Windows (`windows_registry`-backed `register`), so the Windows-debug arm compiles.
- **AC 10 — relaunch call sites.** `UpdateChecker.tsx:72` and `DangerZone.tsx:100` read and confirmed **unmodified and clean** in `git status`. The dev's source-level race analysis was spot-checked against the crates and holds: Windows early-exit is guarded by `if !hwnd.is_null()` (so a live mutex with a dead message window falls through and launches normally — cannot vanish); macOS `notify_singleton` exits on any successful `UnixStream::connect` with no window guard, but `process::restart`'s `exit(0)` bypasses `RunEvent::Exit` so `destroy()` never unlinks `/tmp/com_nbazinet_nkbaz_finance_si.sock`, and the child then takes the `ErrorKind::ConnectionRefused` arm which cleans up and claims singleton. The residual macOS window is real but not demonstrably reachable, and the fix (a shutdown handshake) is explicitly out of scope per Task 10. **Not raised as a finding.**
- **Scope.** Exactly the 9 declared files changed. Zero frontend source touched: `git status --porcelain` filtered to `\.(css|ts|tsx|js|jsx)$` returns nothing, and `git status --porcelain -- 'apps/desktop/src/' 'packages/'` returns nothing. `credentials.rs` / `error.rs` / `models/mod.rs` (Story 26.2) and the dirty planning docs were treated as out of scope and not reviewed.

#### NON-BLOCKING findings

- [ ] [Review][Patch] **Fragment-borne query params bypass the redaction split in the log seam** [`apps/desktop/src-tauri/src/commands/auth.rs:8`] — `url.split_once('?').unwrap_or((url, ""))` separates only the *query*. For a URL with no `?` but a fragment — `nixus://auth/callback#code=X&state=Y` — the `unwrap_or` branch sets `path` to the **entire URL including the fragment**, and `info!` at line 12 writes it verbatim; the three presence flags additionally all read `false`, so the line is doubly misleading. This deviates from AC 9's "only the scheme/host/path … may be logged". **Why it is not blocking:** Cognito's authorization-code + PKCE flow (and its hosted-UI error responses) return `code` / `state` / `error` / `error_description` as **query** parameters, never in a fragment, so no value the app itself minted can reach this branch; anything arriving in a fragment would be a third-party-supplied value, not one of our secrets. **Concrete fix (1 line):** strip the fragment before splitting the query — `let url = url.split('#').next().unwrap_or(url);` as the first statement of the body — or, in Story 26.4 where a parsed `Url` is available anyway, log a reconstructed `scheme://host/path` instead of a raw slice.
- [ ] [Review][Patch] **AC 9's durability now rests on a hardcoded log level 60 lines away, with no comment saying so** [`apps/desktop/src-tauri/src/lib.rs:61`] — this story is what first brings a live authorization code into the process, and `tao-0.35.3/src/platform_impl/macos/app_delegate.rs:145` logs `trace!("Get \`application:openURLs:\` URLs: {:?}", urls)` — the **full URL** — on the exact code path that delivers every macOS deep link. Those records are not inert: `tracing-subscriber` 0.3.23 pulls in `tracing-log` as a *default* feature (confirmed in `Cargo.lock:7303`), and `SubscriberInitExt::try_init` (`tracing-subscriber/src/util.rs:69-74`) installs a global `LogTracer`, so `log`-crate records **are** bridged into this app's file subscriber. Today it is safe twice over: `EnvFilter::new("info")` is hardcoded (not `from_default_env()`, so `RUST_LOG` cannot widen it) and `try_init` also pins `log::set_max_level(Info)`. **Why it is not blocking:** with the current configuration the trace record is dropped before it is even dispatched — AC 9 holds as shipped. **Concrete fix:** either narrow the filter to `EnvFilter::new("info,tao=off")`, or add a `// WHY:` comment at `lib.rs:61` recording that lowering this level to `debug`/`trace` will write live auth codes into `nkbaz-finance.log` — so a future "let's enable verbose logging to debug X" change cannot silently violate AC 9.
- [ ] [Review][Patch] **`let mut builder` would warn `unused_mut` on a mobile target** [`apps/desktop/src-tauri/src/lib.rs:19`] — `builder` is mutated only inside the `#[cfg(desktop)]` block at lines 23-38, so on a mobile target (which `#[cfg_attr(mobile, tauri::mobile_entry_point)]` at line 17 nominally contemplates, and which Dev Notes cites as the rationale for the target-scoped Cargo table) the `mut` becomes unused and AC 11's zero-warning bar would break. **Why it is not blocking:** mobile is not a buildable target for this repo — there is no `gen/apple` or `gen/android`, the README ships macOS + Windows only, and `tauri-plugin-single-instance` is itself `#![cfg(not(any(target_os = "android", target_os = "ios")))]`. Verified zero warnings on the one installed target. **Concrete fix, only if mobile is ever added:** `#[cfg_attr(not(desktop), allow(unused_mut))]` on line 19, with a `// WHY` comment.
- [ ] [Review][Patch] **`#[cfg(desktop)]` is broader than the Cargo.toml target predicate** [`apps/desktop/src-tauri/src/lib.rs:23` vs `Cargo.toml:49`] — the code gate admits any non-mobile target, while the dependency is declared only for `any(target_os = "macos", windows, target_os = "linux")`. On an exotic desktop target (FreeBSD/OpenBSD) `desktop` is set but the crate is absent, giving an unresolved-crate error. **Why it is not blocking:** neither platform is supported or built, and this asymmetry is verbatim the pattern in the official Tauri v2 deep-linking documentation that the story cites. **Concrete fix (optional):** change the gate to `#[cfg(any(target_os = "macos", windows, target_os = "linux"))]` so the two predicates match exactly.
- [x] [Review][Defer] **`chat.spec.ts:250` font-family assertion fails** [`apps/desktop/tests/chat.spec.ts:250`] — deferred, pre-existing. **Reviewer agrees with the dev's triage.** This story modifies zero frontend source files (independently re-confirmed: `git status --porcelain` filtered to `\.(css|ts|tsx|js|jsx)$` is empty, and `git status --porcelain -- 'apps/desktop/src/' 'packages/'` is empty), and Playwright never compiles or launches the Rust binary, so plugin registration is structurally unreachable from these specs. Most plausible origin is `9b45411 "UI: Implement new color scheme"`. **Not a gate this story can clear or has affected.**
- [x] [Review][Defer] **`design-system.spec.ts:110` CSS custom-property assertion fails** [`apps/desktop/tests/design-system.spec.ts:110`] — deferred, pre-existing. Same reasoning and same evidence as the previous item. The other two failures (`expenses.spec.ts:666`, `maintenance.spec.ts:1318`) pass in isolation and are flaky timing, not defects.

#### Outstanding manual work (not defects — correctly left unchecked by the dev)

Tasks **8**, **9**, and **10** remain unverified at runtime and the dev flagged them honestly rather than claiming a pass; that is the desired behaviour. Consequently **AC 4, AC 5, AC 7, AC 10** are unverified at runtime, and AC 9's runtime `grep -c 'code=test'` → `0` proof is still outstanding. Blockers are environmental, not code: macOS deep links require a `tauri build` bundle installed in `/Applications` (they do not fire under `tauri dev`), Task 9 requires a Windows host (this review ran on darwin), and Task 10 requires interactive GUI runs on both platforms. Also still outstanding from Task 9: deleting the `HKCU\Software\Classes\nixus` entry that `register_all()` writes during Windows dev verification, since a stale debug-exe handler can misroute `nixus://` links and break verification of Stories 26.4/26.5.

*Story `Status:` and `sprint-status.yaml` were intentionally not modified by this review — the orchestrator owns both.*
