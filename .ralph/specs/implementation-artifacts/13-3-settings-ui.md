# Story 13.3: Settings UI

Status: ready-for-dev

## Story

As a user,
I want a Settings page where I can enter, update, and clear my AI provider credentials,
so that I can configure AWS Bedrock or OpenAI directly in the app without editing environment variables.

## Acceptance Criteria

**AC1: Settings page accessible from sidebar**
Given the app is running
When the user looks at the sidebar
Then a Settings item is visible at the bottom of the sidebar (near Backup/Restore)
And clicking it navigates to `/settings`
And the active route is highlighted in the sidebar

**AC2: Provider selector renders and switches form fields**
Given the user is on the `/settings` page
When the page loads
Then a radio group shows two options: "AWS Bedrock" and "OpenAI"
And the currently saved provider is pre-selected (from `get_ai_config`)
And selecting "AWS Bedrock" shows: Access Key ID, Secret Access Key, Region fields
And selecting "OpenAI" shows: API Key field only

**AC3: Already-configured state shows masked placeholders**
Given `get_ai_config` returns `{ configured: true, provider: "bedrock" }`
When the settings form renders
Then credential fields show `••••••••` placeholder text (not empty)
And a "Connected" status badge is shown
And a "Test Connection" button is available
And the form still allows re-entry to update credentials

**AC4: Save credentials — success path**
Given the user fills in valid credentials and clicks "Save"
When `save_aws_credentials` or `save_openai_credentials` is invoked
Then a loading spinner replaces the Save button during the async call
On success: an inline success banner renders — "Credentials saved and verified"
And the `["ai-config"]` TanStack Query key is invalidated
And the form re-renders with `configured: true` state

**AC5: Save credentials — invalid credentials error**
Given the user fills in invalid credentials and clicks "Save"
When the command returns `AiServiceError::InvalidCredentials`
Then an inline error message renders below the form: "Credentials are invalid. Please check your keys and try again."
And no success banner is shown
And credentials are NOT saved (nothing written to keyring — enforced by backend)

**AC6: "Test Connection" button**
Given the user is on the settings page with `configured: true`
When they click "Test Connection"
Then `test_ai_connection` is invoked
On success: inline "Connection successful" message shown
On `NotConfigured`: show "Not configured" inline
On `Unavailable`: show "Service unreachable — check your network"
On `InvalidCredentials`: show "Credentials rejected — please re-enter"

**AC7: "Clear Credentials" button**
Given credentials are configured (`configured: true`)
When the user clicks "Clear Credentials"
Then a confirmation prompt renders inline: "This will remove your stored credentials. Continue?"
On confirm: `clear_ai_credentials` is invoked
Then the form resets to unconfigured/empty state
And the `["ai-config"]` TanStack Query key is invalidated
And a "Credentials cleared" inline message is shown

**AC8: "Not configured" inline prompt in AI features**
Given `AiState.provider` is `None`
When the user tries to use the AI import or AI chat feature
Then the feature renders an inline prompt: "AI not configured — Open Settings"
And "Open Settings" is a router link to `/settings`
And the rest of the app (CRUD, dashboard, budget) is completely unaffected

## Tasks / Subtasks

### Task 1: Add `/settings` route [AC1]
- [ ] Create `src/routes/settings.tsx` — page component with `<PageHeader title="Settings" />` and `<CredentialsForm />`
- [ ] Register the route in TanStack Router (add to route tree — follow existing pattern in `routeTree.gen.ts` or the router config file)
- [ ] The route is a flat route at `/settings` (same level as `/budget`, `/chat`, etc.)

### Task 2: Add Settings nav item to sidebar [AC1]
- [ ] Open `src/components/shared/AppSidebar.tsx`
- [ ] Add a Settings nav item at the bottom of the sidebar (alongside or below the Backup/Restore/Language buttons)
- [ ] Use an appropriate icon (e.g., `Settings` from `lucide-react` — already used elsewhere in the project)
- [ ] The item links to `/settings` using the TanStack Router `<Link>` component
- [ ] Apply active-route highlight styling consistent with other sidebar nav items

### Task 3: Create `useAiConfig` hook [AC2, AC3]
- [ ] Create `src/hooks/useAiConfig.ts`
- [ ] Use `useQuery` with key `["ai-config"]` and query function `invoke("get_ai_config")`
- [ ] Return `{ data, isLoading, isError }` — `data` shape: `{ provider: string | null, configured: boolean, region: string }`
- [ ] Export a `useInvalidateAiConfig` helper that calls `queryClient.invalidateQueries(["ai-config"])`

### Task 4: Create `ProviderSelector` component [AC2]
- [ ] Create `src/components/settings/ProviderSelector.tsx`
- [ ] Props: `value: "bedrock" | "openai"`, `onChange: (v: "bedrock" | "openai") => void`
- [ ] Render as a shadcn `RadioGroup` with two `RadioGroupItem` options: "AWS Bedrock" and "OpenAI"
- [ ] Each option has a label and a short description ("Uses Amazon Bedrock via AWS credentials" / "Uses OpenAI API key")

### Task 5: Create `CredentialsForm` component [AC2–AC7]
- [ ] Create `src/components/settings/CredentialsForm.tsx`
- [ ] Import and use `useAiConfig` for initial state
- [ ] Local state: `selectedProvider` (radio), form field values, `status: "idle" | "saving" | "success" | "error" | "testing"`
- [ ] Conditional form fields:
  - [ ] `selectedProvider === "bedrock"`: three inputs — Access Key ID, Secret Access Key, Region (default `"us-east-1"`)
  - [ ] `selectedProvider === "openai"`: one input — API Key
- [ ] When `configured: true`, render `••••••••` placeholder and "Connected" badge alongside each credential section
- [ ] Save button: disabled when fields are empty; shows spinner when `status === "saving"`
  - [ ] On click: invoke `save_aws_credentials` or `save_openai_credentials` with form values
  - [ ] On success: set `status = "success"`, invalidate `["ai-config"]`
  - [ ] On `invalid_credentials` error: set `status = "error"`, show inline error message
- [ ] "Test Connection" button (only visible when `configured: true`):
  - [ ] Invoke `test_ai_connection`
  - [ ] Show appropriate inline message per response (AC6)
- [ ] "Clear Credentials" button (only visible when `configured: true`):
  - [ ] Show inline confirmation before invoking `clear_ai_credentials` (AC7)
  - [ ] On success: invalidate `["ai-config"]`, show "Credentials cleared" message
- [ ] All error/success messages are inline banners (no modals, no toasts for these states)

### Task 6: Add TypeScript types [AC2]
- [ ] Open `src/lib/types.ts`
- [ ] Add: `export type AiProvider = "bedrock" | "openai";`
- [ ] Add: `export interface AiConfig { provider: AiProvider | null; configured: boolean; region: string; }`

### Task 7: Wire "not configured" inline prompt to import and chat [AC8]
- [ ] In `src/hooks/useImport.ts` (or `src/routes/import.tsx`): check for `not_configured` error type in the TanStack Query error handler
  - [ ] If `error.type === "not_configured"`: render inline `"AI not configured — [Open Settings]"` with router link to `/settings`
  - [ ] This replaces the generic "Import unavailable" message for this specific case
- [ ] In `src/hooks/useChat.ts` (or `src/routes/chat.tsx`): same pattern for chat message send errors
- [ ] Use the existing `not_configured` error shape from the backend: `{ type: "not_configured", setup_url: "/settings" }`

## Dev Notes

### Architecture Reference
[Source: `_bmad-output/planning-artifacts/architecture-credentials.md#Settings UI`]

### TanStack Query Key for AI Config
```typescript
// Query key — use this exact string, not a variation
["ai-config"]

// Invalidate after save or clear:
queryClient.invalidateQueries({ queryKey: ["ai-config"] })
```

### Error Type Discrimination
The backend sends structured errors. The frontend must discriminate on `type`, not just presence of an error:
```typescript
// In TanStack Query onError or error handling:
if (error?.type === "not_configured") {
  // Show "Open Settings" prompt
} else if (error?.type === "invalid_credentials") {
  // Show "Invalid credentials" inline
} else if (error?.type === "unavailable") {
  // Show "Service unreachable" inline
}
```

The existing `useInvoke` hook (or however IPC errors are deserialized) should give you `error.type`. Check how `commands/chat.rs` errors are currently handled in `src/hooks/useChat.ts` for the pattern.

### Sidebar Nav Item Pattern
Look at the existing bottom-of-sidebar items (Backup, Restore, language toggle) in `AppSidebar.tsx` for the exact JSX pattern, icon usage, and active-state class logic. Follow the same structure — don't introduce a new pattern.

### Form Field Placeholder for Configured State
When `configured: true`, display `••••••••` as the `placeholder` prop on the input (not the `value`). The input's actual value should remain empty — this is a placeholder showing that something is stored, not a value the user can read or copy.

```tsx
<Input
  type="password"
  placeholder={configured ? "••••••••" : "Enter your access key"}
  value={formValue}
  onChange={...}
/>
```

### Inline Confirmation for Clear
Do NOT use a modal dialog. Use a simple inline conditional render:
```tsx
{showClearConfirm ? (
  <div>
    <span>Remove stored credentials?</span>
    <Button onClick={handleClear}>Confirm</Button>
    <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>Cancel</Button>
  </div>
) : (
  <Button variant="destructive" onClick={() => setShowClearConfirm(true)}>Clear Credentials</Button>
)}
```

### i18n Note
The existing app uses i18n (`useTranslation`). Check `AppSidebar.tsx` and other sidebar items — if they use translation keys like `t("sidebar.settings")`, add the corresponding key to both `en` and `fr` translation files. If the pattern is to add new keys, follow it. If it's not clear, use hardcoded strings for now and note it for future i18n pass.

### Scope Boundaries
**IN SCOPE:** `/settings` route, `CredentialsForm`, `ProviderSelector`, `useAiConfig` hook, TypeScript types, sidebar nav item, "not configured" prompt in import and chat.

**OUT OF SCOPE:** OpenAI chat/import prompt engineering (the client is wired, but using OpenAI as the AI provider for CC parsing or chat requires separate work). Playwright tests for the settings page (deferred — credentials can't be set in test environment without special setup).

**DEPENDS ON:** Story 13.2 — all 5 Tauri commands (`get_ai_config`, `save_aws_credentials`, etc.) must be registered and working.

### Project Structure Notes

**Files to create:**
- `src/routes/settings.tsx`
- `src/components/settings/CredentialsForm.tsx`
- `src/components/settings/ProviderSelector.tsx`
- `src/hooks/useAiConfig.ts`

**Files to modify:**
- `src/components/shared/AppSidebar.tsx` — add Settings nav item
- `src/lib/types.ts` — add `AiProvider`, `AiConfig` types
- `src/hooks/useImport.ts` or `src/routes/import.tsx` — add `not_configured` error handling
- `src/hooks/useChat.ts` or `src/routes/chat.tsx` — add `not_configured` error handling
- TanStack Router route config — register `/settings` route

### References
- Architecture: `_bmad-output/planning-artifacts/architecture-credentials.md#Settings UI` and `#Graceful Degradation`
- Existing sidebar: `src/components/shared/AppSidebar.tsx` — nav item patterns
- Existing form example: `src/components/accounts/AddAccountForm.tsx` — React Hook Form + TanStack Query mutation pattern
- Story 13.2: `_bmad-output/implementation-artifacts/13-2-settings-commands-backend.md` — provides all 5 Tauri commands this story calls
- shadcn RadioGroup: see `src/components/ui/` for available components

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
