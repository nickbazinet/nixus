# Story 11 — Sync UI (implementation spec)

Serves CAP-1 (enable), CAP-3 (status indicator), CAP-5 (link choice), AD-14 (no tier name in the UI),
AD-16 (UI only invokes the six commands and listens to `sync:status`). Frontend only; no Rust change.

## UX pass (one pass, time-boxed)

**Surface 1 — rail status indicator** (`AppSidebar` utility footer, above `v{version}`; suppressed on
`/picker` for free because the whole sidebar is). A real `<button>` with an `aria-label` and a
`Tooltip`, icon + rail label, so it is keyboard-reachable and announced. Per state:
`idle` check "Synced" · `syncing` spinner "Syncing…" · `offline` cloud-off "Offline" · `frozen` pause
"Sync paused" · `update_needed` arrow-up "Update needed" · `error` alert "Sync problem" ·
`link_choice_required`/`remote_changed` question "Action needed". **`unlinked` renders nothing** — a
user who never turned sync on gets no chrome, which is what "unobtrusive" means here (DECISION).
Click: a pending prompt opens its dialog, every other state navigates to Settings → Your data.

**Surface 2 — settings section** `SettingsSection "Sync across my computers"` inside
`YourDataSettings` (before `DangerZone`), not a fifth sub-nav tab: the story asks for a section, the
sub-nav array is asserted by existing specs, and synced data belongs under "Your data" (DECISION).
Rows: what is synced / what is not · account + eligibility · enable (or disable + last sync) ·
diagnostics · error alert with retry.

**Surface 3 — first-sync dialog**: preparing → uploading first snapshot → done / failed + retry.
**Surface 4 — link-choice dialog** (CAP-5): the safe option first and focused; replace is a
`destructive` button whose body states that the current data is kept as a dated backup.
**Surface 5 — remote-changed dialog**: load the cloud copy (current file kept as a dated backup) or
keep this computer's copy.

Copy keys: `sync.*` (flat, like every other key in `en.json`/`fr.json`). a11y: dialogs are the shared
`Dialog` (focus trap, `role=dialog`, labelled title); the indicator announces transitions through an
`aria-live="polite"` label without stealing focus; no colour-only state (icon + text always);
destructive wording never relies on the button variant alone.

## Eligibility, without a tier name (AD-14)

`useActiveProfile()` already answers `kind: "local" | "cloud-linked"` and `is_signed_in`. Those two
decide whether the enable button is offered at all (local-only → disabled + explanation; signed out →
disabled + explanation pointing at /profile). Entitlement is **never** precomputed: the user clicks,
`sync_enable` rejects with `AppError::Sync { code: "not_entitled" }`, and that code is rendered
through its own i18n key. No tier string exists anywhere in the new code.

## Files

- `lib/constants.ts`: `queryKeys.syncStatus = ["sync-status"]`, `queryKeys.syncDiagnostics = ["sync-diagnostics"]`.
- `lib/types.ts`: `SyncState`, `SyncPrompt`, `SyncStatusPayload`, `SyncEnableOutcome`, `SyncDiagnostics` — mirrors of the Story-10 serde shapes (`prompt` tagged on `kind`, outcome tagged on `outcome`).
- `lib/appError.ts`: `syncMessageKey(SyncErrorCode)` (exhaustive switch, no `default`) + `syncIsRetryable`.
- `hooks/useSync.ts`: `useSyncStatus()` = one `useQuery(queryKeys.syncStatus)` over `sync_status` with
  `staleTime: Infinity` + a `listen("sync:status")` effect that `setQueryData`s the payload. **No
  polling, no refetch interval.** Plus `useEnableSync`, `useDisableSync`, `useSyncNow`,
  `useResolveRemoteChanged`, `useSyncDiagnostics`.
- `components/sync/SyncStatusIndicator.tsx` (rail button + hosts both prompt dialogs, so a prompt that
  arrives on any screen is answerable), `SyncLinkChoiceDialog.tsx`, `SyncRemoteChangedDialog.tsx`,
  `SyncFirstSyncDialog.tsx`.
- `components/settings/SyncSettings.tsx`; one `<SyncSettings />` line in `YourDataSettings.tsx`; one
  `<SyncStatusIndicator />` line in `AppSidebar.tsx`.
- `locales/en.json` + `fr.json`: every `sync.*` key, FR formal and consistent with existing FR copy.

## Tests

- `locales/__tests__/sync-i18n.test.ts`: required keys present in both, no key in one locale only,
  every `SyncState` and every `SyncErrorCode` has a key, interpolation placeholders preserved.
- `src/hooks/__tests__/useSync.test.tsx`: reads through `queryKeys.syncStatus`; a `sync:status` event
  replaces the cached payload; the listener is unlistened on unmount; no second `sync_status` invoke.
- `src/components/sync/__tests__/SyncStatusIndicator.test.tsx`: each state's accessible name, nothing
  rendered for `unlinked`, prompt states open their dialog.
- `src/components/settings/__tests__/SyncSettings.test.tsx`: local-only and signed-out disabled states
  with an explanation, enable/disable/diagnostics wiring, `not_entitled` copy, retry.
- `tests/sync.spec.ts` (Playwright, mocked IPC, event registry per `chat.spec.ts`): enable happy path,
  link choice replace, link choice separate, remote-changed prompt, each indicator state,
  disabled/ineligible, error + retry.
- **Mock audit (project-context)**: the indicator is always mounted, so every spec that renders the
  shell gets a `case "sync_status"`. `maintenance.spec.ts` additionally needs the `plugin:`
  passthrough, `transformCallback` and `__TAURI_EVENT_PLUGIN_INTERNALS__` stubs it never had, because
  its `default` rejects unknown commands.

## Decisions (unattended; rules section 6)

- Spec self-approved, all goals kept, no HALT, no review sub-agents — one self-review pass.
- `unlinked` renders no indicator; the settings section is the only discovery path for turning sync on.
- Sync lives inside the "Your data" settings surface rather than a new sub-nav tab.
- Entitlement is read from the failure code, never precomputed, so no tier name can enter the UI.
- No new dependency, no `packages/shared` edit, no `pnpm-lock.yaml`/`package.json` change.
