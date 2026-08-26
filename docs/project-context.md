---
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-05-18'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 38
optimized_for_llm: true
---

# Project Context for AI Agents

_Critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Monorepo
- **Package manager:** pnpm with workspaces (`pnpm-workspace.yaml`)
- **Package scope:** `@nixus/` for all npm packages
- **Workspace packages:** `apps/desktop`, `apps/web`, `apps/api-bedrock`, `packages/shared`

### Desktop App (`@nixus/desktop` — `apps/desktop/`)
- React 19.1.0
- TypeScript ~5.8.3 (strict mode)
- Vite 7.x
- Tailwind CSS 4.2.1 (`@tailwindcss/vite` plugin)
- TanStack Router 1.167.0 (file-based, auto-generated routeTree)
- TanStack Query 5.90.21
- Tauri 2.x (`@tauri-apps/api ^2`)
- i18next 26.0.3 + react-i18next 17.0.2
- date-fns 4.1.0
- react-hook-form 7.71.2
- recharts 3.8.0
- Playwright 1.58.2 (E2E tests)
- `@nixus/shared` (via `workspace:*`)

### Rust Backend (`apps/desktop/src-tauri/`)
- Rust edition 2021
- tauri 2, tauri-build 2
- rusqlite 0.38 (bundled SQLite)
- serde 1 + serde_json 1
- chrono 0.4 (serde feature enabled)
- tracing 0.1 + tracing-subscriber 0.3
- aws-sdk-bedrockruntime 1.127.0
- async-openai 0.27
- tokio 1.50.0 (full features)
- keyring 4 + keyring-core 1 (OS credential store for AI keys and auth sessions) — actual entry API used in code is `keyring_core::Entry`, not `keyring::Entry`; `keyring` v4 is only used once, in `lib.rs`, to call `use_native_store(false)`

### Web App (`@nixus/web` — `apps/web/`)
- React 19.1.0
- TypeScript ~5.8.3 (strict mode)
- Vite 7.x
- **TanStack Start 1.167.0** (NOT plain Vite SPA — SSR/prerendering enabled)
- nitro vite plugin (nightly) — required alongside TanStack Start
- Tailwind CSS 4.2.1
- TanStack Router 1.167.0 (file-based)
- i18next 26.0.3 + react-i18next 17.0.2
- Vitest 3.2.4 + @testing-library/react 16.1.0 (unit tests)
- Playwright 1.58.2 (E2E tests)
- `@nixus/shared` (via `workspace:*`)

### Shared Package (`@nixus/shared` — `packages/shared/`)
- TypeScript ~5.8.3
- `@base-ui/react ^1.3.0` — underlying primitive for all shared UI components
- Exports: `@nixus/shared` (types + index), `@nixus/shared/ui` (components), `@nixus/shared/lib/cn`, `@nixus/shared/styles/tokens.css`
- The root `@nixus/shared` export is both the wire-type barrel **and** the whole UI surface (`export * from "./ui"`) — desktop/web import components from the package root, never `@nixus/shared/ui`

### Hosted AI Service (`@nixus/api-bedrock` — `apps/api-bedrock/`)
- AWS SAM application, fully implemented. Stack `nixus-bedrock-api`, region `us-east-1`, both pinned in `samconfig.toml` under `[default.global.parameters]`. Bedrock runs in the same region — there is **no** `BedrockRegion` parameter and no `BEDROCK_REGION` variable; the runtime client inherits the Lambda's region
- **Enabled for the first premium beta account.** `GLOBAL#CONFIG` is enabled with a 1000-request monthly cap; one premium `USER#<sub>/CONFIG` record has `monthly_request_limit=200`. `enabled=false` remains the immediate kill switch. See `docs/runbooks/hosted-ai-rollout.md`
- **Local deployment is prohibited.** `.github/workflows/api-bedrock-ci.yml` federating via GitHub OIDC is the only path that may mutate the stack; there is no long-lived AWS key for this service. Locally, only `sam:validate` / `sam:build` (offline) may be run
- **The model is `us.anthropic.claude-sonnet-4-6`, a cross-region inference profile, in `us-east-1`.** IAM grants `bedrock:InvokeModelWithResponseStream` on the profile ARN plus its destination foundation-model ARN pattern (the one place a region wildcard on a resource is required, because profiles fan out per region). `bedrock:CountTokens` is **not** granted
- Input is bounded in **bytes** before any reservation: per-operation serialized-JSON ceilings plus the 4 MiB decoded-media cap in `src/lib/validation.ts`. There is no input-token ceiling, because nothing counts input tokens
- **Quota is per REQUEST, and there is no `CountTokens` call anywhere.** One `charged_count` unit per actual `ConverseStream` invocation; a chat turn with a tool round-trip consumes two. Input/output token figures come from the stream's own metadata and are observability counters only — never a gate, never a bill, never locally estimated. Do not add a token preflight, a `countInputTokens` port method, an input-token ceiling, or a `bedrock:CountTokens` grant
- **No function-level concurrency reservation.** By explicit user decision for the pre-revenue build, the Lambda uses the account's shared 50-concurrency pool. API Gateway throttling (10 RPS / burst 20), the atomic per-user/global request caps, input byte ceilings, and output `maxTokens` remain the cost controls. The deploy job asserts `get-function-concurrency` has no reservation key, distinguishing this from reserved concurrency `0` (which makes a function inert)
- `BedrockModelId` is pinned by a single-entry `AllowedValues`; the account-specific `BedrockInferenceProfileArn` is a deploy-time secret. CloudFormation preserves prior parameter values on UPDATE, so the workflow passes both explicitly and then asserts the deployed model on the stack output **and** the Lambda environment
- One Lambda, one entry point: `src/functions/api.ts` is the sole `streamifyResponse` handler and routes both `/v1/ai/status` and `/v1/ai/invoke`. Never add a second Lambda per route or per operation
- `src/lib/{table,quota,validation,bedrock-client}.ts` + `src/handlers/{status,invoke}.ts`. `charged_count` is the sole net quota authority; reserve/refund/finalize are each one `TransactWriteItems` over BOTH the user and `GLOBAL` items, with three server-generated idempotency tokens computed once per request
- `messageStart` is the exact commit event. Before it, failures are pre-output and refundable; after it, they are in-band, charged, and never retried or fallen back from
- Never log or persist `system`, `messages`, any content block, Bedrock response text, or a file name — only `sub`, period, operation, timestamps, latency, status, and token counts (AD-11)
- Build uses `BuildMethod: makefile` (see `Makefile`), not SAM's esbuild builder: the latter runs `npm install`, which cannot resolve pnpm's `workspace:*`. The Makefile also asserts the bundled artifact exports a handler
- Node.js 22 (`nodejs22.x`) + ARM64 Lambda conventions live in `template.yaml` `Globals.Function`
- TypeScript ~5.8.3, self-contained strict tsconfig (`noUnusedLocals`/`noUnusedParameters`/`noUncheckedIndexedAccess`)
- ESLint flat config (`typescript-eslint`), Node globals; `no-restricted-globals` blocks the DOM globals most likely to be reached for by accident
- Vitest 3.2.4 (`environment: "node"`), tests co-located under `src/`. Infrastructure, pipeline, and runbook contracts are themselves tested (`template-scaffold`, `deploy-pipeline`, `rollout-runbook`)
- Consumes the canonical cloud-AI wire contract from the root `@nixus/shared` export — never redefines it locally
- Requires the AWS SAM CLI on PATH for `sam:validate` / `sam:build`; `.aws-sam/` is generated output and gitignored
- Scripts: `pnpm --filter @nixus/api-bedrock {lint,typecheck,test,sam:validate,sam:build}`

### Desktop Hosted-AI Boundaries (`apps/desktop/src-tauri/src/ai/`)
- All four AI surfaces (chat, statement import, project advice, trends insight) route through the one `ai/backend.rs` port. Never call a concrete Bedrock/OpenAI client from a surface — a source guard fails the build if you do
- Hosted Bedrock takes precedence whenever a signed-in premium user has quota, even over an explicitly configured OpenAI provider. There is no provider toggle, and none may be added
- Fallback is one lookup in `backend::fallback_for`. `validation`, `payload_too_large`, and `unsupported_encoding` never fall back; `unauthorized` refreshes exactly once. Statement import is Bedrock-only — OpenAI is never a valid fallback there
- Each chat tool-loop invocation is routed independently, so one visible turn may use hosted then BYO
- `ai/hosted_state.rs` is Rust-internal and `subject_sub`-scoped: no Tauri command, no frontend hook, no query key. Cleared on sign-out, session expiry, and any subject mismatch
- `ai/hosted_bedrock.rs` must never touch `credentials.rs` or `keyring_core`; it obtains a call-time token from `commands/auth.rs` only. It also never constructs an AWS SDK client — no AWS credential exists on a device
- `commands/auth.rs` requests scope `nixus-api/ai.invoke` and uses a 120-second expiry skew. A session lacking the scope is `reauthentication_required`; a refresh cannot add a scope
- `commands/settings.rs::test_ai_connection` stays BYO-only — never route it through the port
- Errors surface as `AppError::HostedAi { code, message, recoverable }`. The frontend narrows them via `src/lib/appError.ts`; never let a `hosted_ai` error fall through to a generic message

---

## Critical Implementation Rules

### 1. Monetary Values — Always Integers (Cents)
- All money stored as `i64` (Rust) / `number` (TypeScript) representing **cents**
- Field names MUST end in `_cents` (e.g., `amount_cents`, `target_cents`, `spent_cents`)
- NEVER use floating point for currency at any layer
- Display formatting happens in the UI layer only (`useFormatCurrency` hook in desktop)

### 2. Tauri IPC Commands
- Every command MUST have `#[tauri::command(rename_all = "snake_case")]`
- All commands return `Result<T, AppError>` — never return raw errors or panic
- DB state access: `state: State<DbState>` → lock with `.lock().map_err(|e| AppError::Database { message: e.to_string() })?`
- Frontend invokes with: `invoke<T>("command_name", { snake_case_param: value })`
- Parameter names in `invoke({})` must be `snake_case` to match Rust signature

### 3. Database Operations Belong in `db/` Only
- Commands in `commands/` orchestrate: **lock state → call db function → write audit log → return**
- DynamoDB/SQLite queries NEVER appear directly in command files
- One `db/` file per domain (e.g., `db/expense.rs`, `db/budget.rs`)
- Audit logging on every create/update/delete: capture old JSON → do operation → `audit_db::insert_audit_log()`

### 4. Rust Model Structs
- All models derive exactly: `#[derive(Debug, Clone, Serialize, Deserialize)]`
- All fields `snake_case`
- Dates always `String` (ISO 8601 format like `"2026-01-15"`)
- Input types named `Create<Domain>Input` and `Update<Domain>Input`
- Models live in `src-tauri/src/models/mod.rs`

### 5. Error Handling (`AppError`)
- Use `AppError` enum from `error.rs` — never create ad-hoc error types
- Serializes to JSON: `{ "type": "...", "message": "...", "field"?: "..." }`
- Error types: `validation`, `database`, `ai_service`, `file`, `not_configured`, `invalid_credentials`, `unavailable`
- AI service errors include `recoverable: bool` — frontend uses this to decide retry vs redirect
- Never block app launch on AI/service errors — all AI features degrade gracefully

### 6. TanStack Query Keys
- ALL query keys defined in `apps/desktop/src/lib/constants.ts` → `queryKeys` object
- Format: kebab-case string arrays, e.g., `["expenses", year, month]`
- Never hardcode query keys in hooks — always import from `queryKeys`
- Every mutation's `onSuccess` MUST invalidate all affected query keys

### 7. TypeScript Strictness
- Strict mode + `noUnusedLocals: true` + `noUnusedParameters: true` enforced
- Fix ALL TypeScript warnings — unused imports/variables will cause CI failure
- `@/*` path alias maps to `./src/*` in both desktop and web apps
- `moduleResolution: "bundler"`, `isolatedModules: true`

### 8. Shared UI Components
- Check `@nixus/shared/ui` FIRST before creating any new UI component
- Shared components use `@base-ui/react` as the primitive layer (NOT Radix UI directly)
- Import with: `import { Button } from "@nixus/shared/ui"`
- Desktop can add shadcn components locally, but prefer shared package for cross-app reuse
- Never duplicate a component that exists in `packages/shared/src/ui/`

### 9. Compilation Warnings Policy
- All Rust and TypeScript compilation warnings MUST be resolved before committing
- Dead code in Rust: remove it if truly unused; add `#[allow(dead_code)]` only if it will be used
- The CI pipeline will fail on TypeScript warnings due to strict compiler flags

### 10. Version Bumps
- THREE files must be updated together: `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`
- CI reads the version from `tauri.conf.json` — missing update there breaks the release

---

## Code Organization Patterns

### Desktop App Structure
```
apps/desktop/src/
├── components/
│   └── {feature}/      # Components grouped by feature (e.g., expenses/, budget/)
│       └── shared/     # Cross-feature shared components
├── hooks/
│   └── use{Feature}.ts # One file per feature, exports multiple related hooks
├── lib/
│   ├── constants.ts    # queryKeys + other constants
│   ├── types.ts        # TypeScript types for IPC data shapes
│   └── utils.ts        # General utilities
├── routes/
│   └── {feature}.tsx   # File-based routing — never edit routeTree.gen.ts manually
└── locales/            # i18n translation files
```

### Rust Backend Structure
```
apps/desktop/src-tauri/src/
├── commands/
│   └── {feature}.rs    # Tauri command handlers (thin orchestration only)
├── db/
│   └── {feature}.rs    # All SQL queries live here
├── models/
│   └── mod.rs          # All domain structs (single file)
├── ai/                 # AI service integration
├── error.rs            # AppError enum
└── lib.rs              # Command registration
```

### Web App Structure
```
apps/web/src/
├── components/
│   └── {Feature}.tsx      # Co-located with {Feature}.test.tsx
├── features/
│   └── {feature}/         # Feature-scoped state/logic (e.g., download/)
├── routes/
│   ├── __root.tsx          # Root layout with shellComponent pattern
│   ├── index.tsx           # English landing page
│   └── fr/
│       └── index.tsx       # French landing page
└── lib/
    └── i18n.ts             # i18next configuration
```

### Naming Conventions
| Context | Convention | Example |
|---------|-----------|---------|
| React components | PascalCase | `ExpenseForm.tsx` |
| Hooks | camelCase with `use` prefix | `useExpenses.ts` |
| Route files | kebab-case | `spending-trends.tsx` |
| TypeScript types | PascalCase | `CreateExpenseInput` |
| Rust structs | PascalCase | `BudgetCategory` |
| Rust functions | snake_case | `get_expenses_by_month` |
| Rust modules | snake_case | `expense_db`, `audit_db` |
| JSON / IPC fields | snake_case | `amount_cents`, `budget_category_id` |
| Query keys | kebab-case strings | `"budget-status"`, `"net-worth-history"` |
| pnpm workspace packages | `@nixus/` scope | `@nixus/desktop` |

---

## Framework-Specific Patterns

### TanStack Router (Both Apps)
- File-based routing auto-generates `routeTree.gen.ts` — **never edit this file manually**
- Run `pnpm --filter @nixus/desktop dev` (or build) to regenerate routeTree
- Web app: `createRootRoute({ shellComponent: RootDocument })` pattern — `shellComponent` renders the full HTML shell

### TanStack Start (Web Only)
- Uses SSR with `prerender: { enabled: true, crawlLinks: true }` — pages are prerendered at build time
- `nitro` vite plugin MUST be included alongside `tanstackStart` plugin
- `head()` in route definitions sets `<meta>`, `<link>`, and `<script>` tags — not a standalone `index.html`
- Inline sync scripts (no `defer`/`async`) are used to prevent theme flash on first paint

### Hooks Pattern (Desktop)
```typescript
// One file exports all hooks for a feature
export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) =>
      invoke<Expense>("create_expense", { ...flattenedSnakeCaseArgs }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses });
      // Invalidate ALL related keys
    },
  });
}
```

### i18n (Both Apps)
- All user-visible strings go through i18next — no hardcoded English strings in JSX
- Web app supports EN (default) and FR (`/fr/*` routes)
- Translation hook: `const { t } = useTranslation()`

### Web Test Co-location
- Unit test files sit next to the component: `Component.tsx` + `Component.test.tsx`
- No separate `__tests__/` directories
- Run with: `pnpm --filter @nixus/web test`

---

## Language-Specific Rules

### TypeScript
- Strict mode + `noUnusedLocals` + `noUnusedParameters` — unused vars/imports are CI failures
- Path alias `@/*` → `./src/*` in both apps; always use this alias, never relative `../../`
- `moduleResolution: "bundler"`, `isolatedModules: true` — no CommonJS, ESM only
- All types for IPC data shapes live in `apps/desktop/src/lib/types.ts`

### Rust
- All structs derive exactly `#[derive(Debug, Clone, Serialize, Deserialize)]`
- All field names `snake_case`; date fields always `String` (ISO 8601)
- Monetary fields always `i64` with `_cents` suffix — never `f64` for money
- Errors use `?` propagation with `From` impls — avoid `.unwrap()` except in tests

---

## Framework-Specific Rules

### Tauri IPC
- Every command requires `#[tauri::command(rename_all = "snake_case")]`
- All commands return `Result<T, AppError>` — never panic, never return raw strings
- DB access: lock `State<DbState>` with `.map_err(|e| AppError::Database { message: e.to_string() })?`
- `invoke<T>("cmd", { snake_case_arg: val })` — arg names must match Rust parameter names exactly
- Register every new command in `lib.rs`

### TanStack Router (Both Apps)
- File-based routing — `routeTree.gen.ts` is auto-generated; **never edit it manually**
- New routes: create the file in `src/routes/`, re-run dev/build to regenerate routeTree

### TanStack Start (Web Only)
- Use `createRootRoute({ shellComponent })` — shell renders full `<html>` with `<HeadContent>` and `<Scripts>`
- Meta, links, scripts go in `head()` on route definitions — NOT in a standalone `index.html`
- Theme/preference inline scripts must be sync (no `defer`/`async`) to prevent hydration flash
- Prerendering enabled (`crawlLinks: true`) — avoid runtime-only APIs in prerendered routes

### TanStack Query (Desktop)
- All query keys in `queryKeys` object in `lib/constants.ts` — never hardcode strings in hooks
- Every mutation's `onSuccess` must invalidate ALL affected query keys
- Use `keepPreviousData` on paginated/filtered queries (e.g., expenses by month)

### i18n (Both Apps)
- All user-visible strings through i18next — no hardcoded English text in JSX
- Web supports EN (default) and FR routes under `src/routes/fr/`

---

## Testing Rules

### Desktop (Vitest Unit + Playwright E2E)
- Vitest + jsdom for unit tests: i18n locale-parity specs (`src/locales/__tests__/*.test.ts`) and hook tests (`src/hooks/__tests__/*.test.ts`) — no `@testing-library/react` dependency, tests use `createRoot`/`act` directly
- Run: `pnpm --filter @nixus/desktop test`
- Playwright E2E for everything user-flow-shaped — tests live in `apps/desktop/tests/`
- **E2E runs against the plain Vite dev server (port 1420), not a built Tauri binary** — `window.__TAURI_INTERNALS__.invoke` is stubbed per-spec via `page.addInitScript`; there is no real IPC layer in this suite
- **When adding any always-mounted root-level component that calls `invoke()` on load** (e.g. an app-shell dialog, header widget) — every existing spec's Tauri mock must add a case for the new command(s), or that spec's mock falls through to `Promise.reject("Unknown command")` and the new component renders in its error state. Audit all existing specs' mock switch statements before merging, not after.

### Web (Vitest Unit + Playwright E2E)
- Unit test files co-located with components: `Component.tsx` + `Component.test.tsx`
- No `__tests__/` directories — keep tests next to the source file
- Use `@testing-library/react` for component tests
- Run: `pnpm --filter @nixus/web test`

---

## Code Quality & Style Rules

- **Compilation warnings:** ALL Rust and TypeScript warnings must be resolved before committing
- **Dead code:** Remove if truly unused; add `#[allow(dead_code)]` in Rust only if it will be used soon
- **Comments:** No comments explaining what code does — only comment WHY (hidden constraint, workaround, non-obvious invariant)
- **No console.log:** Remove debug logging before committing

---

## Development Workflow Rules

- **Version bumps require 3 files:** `apps/desktop/package.json` + `apps/desktop/src-tauri/tauri.conf.json` + `apps/desktop/src-tauri/Cargo.toml` (CI reads version from tauri.conf.json)
- **Build commands:**
  - Desktop dev: `pnpm --filter @nixus/desktop tauri dev`
  - Web dev: `pnpm --filter @nixus/web dev`
  - Desktop build: `pnpm --filter @nixus/desktop tauri build`

---

## Anti-Patterns to Avoid

- Floating point for any monetary value — always use integer cents
- SQL queries inside `commands/` — belongs in `db/` layer
- Hardcoded query keys as strings in hooks — use `queryKeys` from `constants.ts`
- Editing `routeTree.gen.ts` manually — it will be overwritten on next dev/build
- Creating UI components that already exist in `@nixus/shared/ui`
- Leaving TypeScript or Rust compilation warnings — CI will fail
- Ignoring `noUnusedLocals`/`noUnusedParameters` — remove unused code or use `_` prefix
- Partial version bumps (updating only 1-2 of the 3 required version files)
- Blocking app functionality when Bedrock/OpenAI is unavailable — AI features must degrade gracefully
- Duplicating types across apps — shared types go in `packages/shared/src/types/`
- Skipping audit log on mutations — every create/update/delete must call `audit_db::insert_audit_log`

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code in this project
- Follow ALL rules exactly as documented — when in doubt, prefer the more restrictive option
- Update this file if new patterns emerge during implementation

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack or conventions change
- Remove rules that become obvious over time

_Last Updated: 2026-08-26_
