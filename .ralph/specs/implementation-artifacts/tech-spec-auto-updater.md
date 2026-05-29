---
title: 'Auto-Updater with User Consent'
type: 'feature'
created: '2026-03-30'
status: 'done'
baseline_commit: '300f727a'
context: []
---

# Auto-Updater with User Consent

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have no way to know a new version is available and must manually download releases from GitHub. This creates friction and leaves users on stale versions.

**Approach:** Integrate `tauri-plugin-updater` to check GitHub releases on app startup, prompt the user with a dialog showing release notes, and auto-download + install on consent. Requires generating a signing keypair and updating the CI workflow to produce updater artifacts.

## Boundaries & Constraints

**Always:** Ask for user consent before downloading. Show version number and release notes in the dialog. Gracefully handle network failures (no crash, no blocking).

**Ask First:** Whether to use a toast/dialog or a dedicated UI component for the update prompt. Whether draft releases should be skipped (current workflow creates drafts).

**Never:** Auto-update without consent. Block app startup while checking for updates. Store signing private keys in the repository.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Update available | App starts, newer release exists | Dialog with version + notes, Accept/Dismiss | N/A |
| No update | App starts, already on latest | Silent, no UI | N/A |
| Network offline | App starts, no connectivity | Silent, app loads normally | Log warning, no user-facing error |
| User dismisses | User clicks dismiss on dialog | Dialog closes, app continues | N/A |
| User accepts | User clicks update | Download with progress, install, relaunch | Show error toast if download fails |
| Download interrupted | Network drops mid-download | Inform user download failed | Toast with retry option |

</frozen-after-approval>

## Code Map

- `src-tauri/Cargo.toml` -- Add updater + process plugin dependencies
- `src-tauri/tauri.conf.json` -- Enable updater artifacts, configure plugin endpoint + pubkey
- `src-tauri/capabilities/default.json` -- Add updater + process permissions
- `src-tauri/src/lib.rs` -- Register updater + process plugins
- `package.json` -- Add @tauri-apps/plugin-updater and @tauri-apps/plugin-process
- `src/components/shared/UpdateChecker.tsx` -- New component: check for update on mount, show dialog
- `src/routes/__root.tsx` -- Mount UpdateChecker in root layout
- `.github/workflows/release.yml` -- Add signing key env vars, set `updaterJsonKeepUniversal` for macOS

## Tasks & Acceptance

**Execution:**
- [ ] Generate signing keypair with `tauri signer generate` and document the secret setup
- [ ] `src-tauri/Cargo.toml` -- Add `tauri-plugin-updater` and `tauri-plugin-process` dependencies
- [ ] `src-tauri/src/lib.rs` -- Register both plugins in builder chain
- [ ] `src-tauri/tauri.conf.json` -- Add `createUpdaterArtifacts`, plugin config with pubkey + GitHub endpoint
- [ ] `src-tauri/capabilities/default.json` -- Add `updater:default` and `process:default` permissions
- [ ] `package.json` -- Add `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`
- [ ] `src/components/shared/UpdateChecker.tsx` -- Create update checker component with consent dialog and download progress
- [ ] `src/routes/__root.tsx` -- Mount `<UpdateChecker />` in root layout
- [ ] `.github/workflows/release.yml` -- Add `TAURI_SIGNING_PRIVATE_KEY` env var, set `updaterJsonKeepUniversal: true`

**Acceptance Criteria:**
- Given the app starts and a newer GitHub release exists, when the update check completes, then a dialog appears showing the new version and release notes
- Given the user accepts the update, when the download completes, then the app installs and relaunches
- Given the user dismisses the dialog, when they continue using the app, then no further update prompt appears in that session
- Given no network connectivity, when the app starts, then it loads normally with no error shown

## Verification

**Commands:**
- `cd src-tauri && cargo check` -- expected: compiles without errors
- `npm run build` -- expected: frontend builds without errors
- `npx tauri build` -- expected: produces updater artifacts (.sig files alongside installers)

**Manual checks:**
- Confirm `latest.json` is generated in the build output
- Confirm the update dialog appears when a newer version is detected (test against a mock endpoint or older local version)
