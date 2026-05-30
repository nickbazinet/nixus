---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-14'
inputDocuments:
  - architecture-desktop.md
workflowType: 'architecture'
project_name: 'nkbaz-finance'
user_name: 'Nbazinet'
date: '2026-04-14'
scope: 'platform'
moduleDocuments:
  desktop: architecture-desktop.md
  web: architecture-web.md
  api: architecture-api.md
---

# Platform Architecture Decision Document

_This is the root architecture document for the nkbaz-finance platform. It covers monorepo structure, cross-module decisions, and shared infrastructure. Each module has its own architecture document for internal implementation details._

**Module Architecture Documents:**
- [Desktop App](architecture-desktop.md) — Tauri desktop application (React + Rust + SQLite)
- [Web App](architecture-web.md) — Marketing site + user portal (Vite + React)
- [API](architecture-api.md) — Backend services (Rust Lambda + API Gateway + DynamoDB)

## Project Context Analysis

### Platform Scope

nkbaz-finance is expanding from a single desktop application into a multi-module platform. The desktop app (Tauri — React + Rust + SQLite) is already built and working. The platform expansion adds commercialization capabilities: a marketing website, user accounts, module licensing, and subscription management.

**Module Overview:**

| Module | Technology | Purpose |
|--------|-----------|---------|
| Desktop App | Tauri (React + Rust + SQLite) | Personal finance application (existing) |
| Web App | Vite + React SPA | Marketing site + authenticated user portal |
| API | Rust on AWS Lambda + API Gateway v2 | User management, licensing, subscriptions, payments |
| Shared | TypeScript package | API types and validation shared by desktop + web |

**Monorepo Structure:** npm/pnpm workspaces with apps/ and packages/ directories. All modules live in one repository for solo developer efficiency.

### Requirements Overview

**New Functional Requirements (Platform):**

- FR-P1: Marketing pages (landing, pricing, features) — public, SEO-adequate
- FR-P2: User registration and login (Cognito hosted UI or custom)
- FR-P3: User profile management (view/edit profile, preferences)
- FR-P4: Module catalog and purchase flow (browse modules, select, pay via Stripe)
- FR-P5: Subscription management (view plan, upgrade/downgrade, cancel)
- FR-P6: License verification from desktop app (startup check, cached offline grace)
- FR-P7: Stripe webhook processing (payment success/failure, subscription lifecycle)
- FR-P8: User preference sync between desktop and cloud

**Non-Functional Requirements (Platform):**

| NFR | Requirement | Architectural Impact |
|-----|------------|---------------------|
| NFR-P1 | ~$0/month at zero traffic | All infrastructure must use AWS free tier or pay-per-use |
| NFR-P2 | Solo developer maintainability | Monorepo, minimal services, no complex DevOps |
| NFR-P3 | Desktop works offline | License check must cache and degrade gracefully when API unreachable |
| NFR-P4 | Canadian payment processing | Stripe (supports CAD), sales tax handling deferred |
| NFR-P5 | Sub-second web page loads | Static SPA on CDN, no server rendering |
| NFR-P6 | Secure auth across platforms | JWT-based auth (Cognito) validated at API Gateway level |
| NFR-P7 | No Node.js servers | Web app = static files; API = Rust Lambda; no runtime servers to manage |

**Scale & Complexity:**

- Platform complexity: Medium
- Primary domain: Full-stack (SPA + serverless API + desktop)
- Data model: Simple — users, licenses, subscriptions, preferences
- Expected scale: Single-digit to low hundreds of users initially

### Technical Constraints & Dependencies

- **AWS ecosystem** — already committed via Bedrock; Lambda, API Gateway, Cognito, DynamoDB, S3, CloudFront all within same account
- **Solo developer** — every technology choice biased toward simplicity and low operational burden
- **Existing desktop patterns** — snake_case JSON, TanStack Query, feature-based organization, shadcn/ui carry forward into web app
- **No server runtime** — web app served as static files; API runs only on Lambda invocation
- **Stripe as payment processor** — zero monthly cost, 2.9% + 30c per transaction, Canadian support

### Cross-Cutting Concerns Identified

1. **Authentication flow** — Cognito JWT tokens shared by web SPA and desktop app. API Gateway validates tokens natively (no custom auth Lambda). Desktop caches tokens locally for offline resilience.

2. **License verification** — Desktop checks license on startup via API call. On success, caches license locally with expiry. On failure (network down, API error), honors cached license with configurable grace period. Never blocks app launch.

3. **Shared TypeScript types** — `packages/shared/` contains API response types, user models, and validation schemas consumed by both `apps/desktop/` and `apps/web/`. The Rust API defines canonical types; TypeScript mirrors them.

4. **Monorepo build orchestration** — Each app builds independently (Vite for web, Tauri for desktop, Cargo Lambda for API). Workspace config provides shared dependencies but no cross-app build coupling.

5. **Deployment independence** — Web deploys to S3+CloudFront, API deploys via SAM to Lambda+API Gateway, Desktop produces local build artifacts. No shared deployment pipeline required.

6. **Consistent frontend patterns** — Both React apps (desktop and web) follow the same conventions: TanStack Router, TanStack Query, shadcn/ui, feature-based component organization, snake_case JSON contract with backend.

## Starter Template Evaluation

### Primary Technology Domain

Multi-module platform (SPA + serverless API + desktop) — requires separate starters per module, unified by a monorepo workspace.

### Monorepo: pnpm Workspaces (Manual Setup)

**Why pnpm over npm workspaces:**
- 60-80% disk reduction through content-addressable storage
- 3-5x faster installs via intelligent caching and hard linking
- `--filter` syntax for targeted commands (`pnpm --filter @nkbaz/web dev`)
- `workspace:*` protocol for seamless internal package linking

**Migration from npm:** Delete `node_modules/` and `package-lock.json`, add `pnpm-workspace.yaml`, run `pnpm install`. Straightforward for a solo developer.

**Initialization:**

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### Web App: Vite + React + TypeScript Scaffold

**Selected Starter:** Official `create-vite` with `react-ts` template

**Rationale:**
- Matches the desktop app's frontend stack exactly
- Minimal scaffold — no unwanted opinions
- Same post-scaffold additions as desktop (Tailwind, shadcn/ui, TanStack Router/Query)
- Vite 7 with Node.js 20.19+ requirement

**Initialization Command:**

```bash
pnpm create vite@latest apps/web -- --template react-ts
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript (strict mode), React 19, Vite 7
- **Styling:** None — add Tailwind CSS + shadcn/ui post-scaffold
- **Build Tooling:** Vite for bundling, HMR in development
- **Testing:** None — add Playwright post-scaffold (consistent with desktop)
- **Code Organization:** Standard Vite React structure (`src/`, `public/`, `index.html`)

**Additional Setup Required Post-Scaffold:**
1. Tailwind CSS + shadcn/ui
2. TanStack Router + TanStack Query
3. Auth integration (Cognito SDK / Amplify Auth)
4. Stripe.js for payment UI

### API: SAM + Cargo Lambda (Rust)

**Selected Starter:** `sam init` with Rust runtime (provided.al2023)

**Rationale:**
- Provides both Rust Lambda handler AND infrastructure-as-code (template.yaml)
- SAM template.yaml defines API Gateway, Lambda, DynamoDB tables, Cognito — all in one file
- Cargo Lambda handles building Rust for Lambda's ARM64/x86_64 target
- AWS official tooling, actively maintained, Rust GA support since November 2025

**Initialization Command:**

```bash
sam init --runtime rust --app-template hello-world --name api
# Move generated files into apps/api/
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** Rust, compiled to provided.al2023 (Amazon Linux 2023)
- **Build Method:** `rust-cargolambda` in SAM template
- **Handler:** `bootstrap` binary (standard Lambda custom runtime)
- **IaC:** SAM template.yaml (CloudFormation-based)
- **Testing:** Basic Rust test in generated code

**Additional Setup Required Post-Scaffold:**
1. Extend template.yaml: API Gateway v2 (HTTP API), Cognito authorizer, DynamoDB tables
2. Add route handlers (users, licenses, subscriptions, webhooks)
3. Add dependencies: aws-sdk-dynamodb, serde, stripe-rust
4. Configure Stripe webhook endpoint

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data storage: DynamoDB multi-table design (Users, Licenses, Subscriptions)
- Authentication: AWS Cognito with Hosted UI, JWT authorizer on API Gateway
- API: Single Rust Lambda with internal path-based routing
- Payments: Stripe Checkout (redirect) + Stripe Customer Portal
- Token storage (desktop): tauri-plugin-stronghold (cross-platform encrypted vault)

**Important Decisions (Shape Architecture):**
- Monorepo: pnpm workspaces
- Web routing: public pages + authenticated dashboard area
- CORS: API Gateway v2 built-in config (web domain + tauri://localhost)
- DNS: nicolasbazinet.net zone in Route 53

**Deferred Decisions (Post-MVP):**
- CI/CD pipeline (manual deploys for now)
- Staging environment (prod-only for now)
- Cognito custom domain (use default Cognito domain initially)
- Stripe Tax (add when revenue exists)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | DynamoDB multi-table | Simple data model (users, licenses, subscriptions); each table within free tier; easier to reason about than single-table design |
| Users table | PK = user_id (Cognito sub) | One-to-one with Cognito identity; stores profile, preferences |
| Licenses table | PK = user_id, SK = module_id | Lookup by user, verify specific module; sparse — only active licenses stored |
| Subscriptions table | PK = user_id, SK = subscription_id | Subscription lifecycle tracking; maps to Stripe subscription objects |
| Desktop preference sync | GET/PUT /users/me via API | Desktop caches preferences locally; writes go to API → DynamoDB; local fallback if API unreachable |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth provider | AWS Cognito User Pool | 50K MAU free tier; native API Gateway JWT authorizer; handles registration, login, password reset, MFA |
| Auth UI | Cognito Hosted UI | Fastest to implement; supports CSS customization and custom domain; swap to custom UI later if branding demands it |
| Desktop auth flow | System browser OAuth → localhost redirect | Desktop opens Hosted UI in default browser; Cognito redirects to localhost callback with auth code; app exchanges for tokens |
| Token storage (desktop) | tauri-plugin-stronghold | Cross-platform encrypted vault; no OS keychain dependency; works identically on macOS, Windows, Linux |
| Token storage (web) | In-memory + Cognito refresh token | Access token in memory (not localStorage); refresh via Cognito SDK on expiry |
| API authorization | API Gateway v2 JWT authorizer | Native Cognito integration; no custom Lambda authorizer needed; validates JWT on every request |
| Stripe webhooks | Signature verification in Lambda | Verify Stripe-Signature header using signing secret; webhook endpoint is public (no JWT) |

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Lambda architecture | Single Lambda with internal routing | Simpler deployment; one build artifact; Rust cold starts are fast (~10-50ms); split later if needed |
| API style | REST (HTTP API Gateway v2) | Simple CRUD operations; no complex query patterns that would benefit from GraphQL |
| Route structure | Resource-based REST | /users/me, /users/me/licenses, /subscriptions/checkout, /webhooks/stripe |
| Error handling | Typed Rust error enums → HTTP status codes + JSON body | ValidationError → 400, NotFoundError → 404, PaymentError → 402, AuthError → 401 |
| CORS | API Gateway v2 built-in CORS | Allow origins: web domain + tauri://localhost; no custom middleware |

**API Routes:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /users/me | JWT | Get current user profile + preferences |
| PUT | /users/me | JWT | Update profile/preferences |
| GET | /users/me/licenses | JWT | List user's active licenses |
| GET | /users/me/license/{module} | JWT | Verify specific module license (desktop calls this) |
| POST | /subscriptions/checkout | JWT | Create Stripe Checkout session → return redirect URL |
| GET | /subscriptions/me | JWT | Get current subscription status |
| POST | /subscriptions/portal | JWT | Create Stripe Customer Portal session → return redirect URL |
| POST | /webhooks/stripe | None (signature) | Stripe webhook handler |

### Frontend Architecture (Web)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Routing | TanStack Router with public/auth split | Public routes (/, /pricing, /features) + authenticated routes (/dashboard/*) |
| Auth state | TanStack Query + useAuth hook | Token in memory, refresh via Cognito SDK; auth state managed like server state |
| Stripe integration | Stripe Checkout redirect + Customer Portal redirect | Zero payment UI to build; PCI compliant; API returns redirect URL |
| State management | TanStack Query only | No Zustand/Redux; auth, user profile, and subscription data all managed as server state |
| Component library | shadcn/ui + Tailwind | Consistent with desktop app; same component patterns |

**Web Route Structure:**

| Route | Auth | Purpose |
|-------|------|---------|
| / | Public | Landing page |
| /pricing | Public | Pricing plans |
| /features | Public | Feature showcase |
| /login | Public | Redirects to Cognito Hosted UI |
| /callback | Public | OAuth callback (receives token from Cognito) |
| /dashboard | JWT | User home (after login) |
| /dashboard/profile | JWT | Profile management |
| /dashboard/modules | JWT | Browse and purchase modules |
| /dashboard/subscription | JWT | Manage subscription |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IaC | AWS SAM (template.yaml) | Defines Lambda, API Gateway, DynamoDB, Cognito in one file; simpler than CDK for this scope |
| Web hosting | S3 + CloudFront | Static SPA; near-zero cost; ACM certificate for HTTPS |
| DNS | Route 53 (nicolasbazinet.net) | Existing hosted zone; app.nicolasbazinet.net (web), api.nicolasbazinet.net (API) |
| Environments | Prod only | Solo developer, no customers yet; test locally with sam local + vite dev; add staging when needed |
| CI/CD | Manual deploys | sam deploy (API), s3 sync (web), tauri build (desktop); add GitHub Actions later |
| Monitoring | CloudWatch (default) | Lambda logs go to CloudWatch automatically; no external tools needed at this scale |
| Certificates | ACM in us-east-1 | Required for CloudFront; *.nicolasbazinet.net wildcard or per-subdomain |

**Deploy Commands:**

```bash
# API
cd apps/api && sam build && sam deploy

# Web
cd apps/web && pnpm build && aws s3 sync dist/ s3://nkbaz-web-bucket --delete

# Desktop
cd apps/desktop && pnpm tauri build
```

### Decision Impact Analysis

**Implementation Sequence:**
1. Restructure monorepo (pnpm workspaces, move desktop to apps/desktop/)
2. Scaffold apps/web (Vite + React) and apps/api (SAM + Cargo Lambda)
3. Deploy SAM stack (Cognito + API Gateway + DynamoDB + Lambda)
4. Build web auth flow (Cognito Hosted UI → callback → dashboard)
5. Build API handlers (users, licenses)
6. Integrate Stripe (checkout session creation, webhook handler, customer portal)
7. Build web dashboard pages (profile, modules, subscription)
8. Add license verification to desktop app (API call + Stronghold caching)
9. Add preference sync to desktop app

**Cross-Component Dependencies:**
- Cognito must be deployed before web auth or desktop auth can work
- API must be deployed before web dashboard or desktop license checks
- Stripe webhook endpoint must be live before testing payment flows
- DynamoDB tables must exist before API handlers can function
- Shared TypeScript package must mirror Rust API types before frontend integration

## Implementation Patterns & Consistency Rules

### Scope

These patterns govern cross-module consistency and the new platform modules (web, API). The desktop app's internal patterns are documented in [architecture-desktop.md](architecture-desktop.md) and remain authoritative for desktop-specific code. The patterns below extend those conventions to the full platform.

### Naming Patterns

**Package Naming:**
- Scope: `@nkbaz/` for all workspace packages
- Package names: `@nkbaz/shared`, `@nkbaz/web`, `@nkbaz/desktop`
- The API is Rust (not an npm package) — no scope needed; crate name: `nkbaz-api`

**DynamoDB Table Naming:**
- Tables: `PascalCase` — `Users`, `Licenses`, `Subscriptions`
- Attributes: `snake_case` — `user_id`, `module_id`, `created_at`, `stripe_customer_id`
- Index names: `gsi_{table}_{attribute}` — `gsi_Licenses_module_id`

**API Route Naming:**
- Paths: lowercase with hyphens — `/users/me`, `/users/me/licenses`, `/subscriptions/checkout`
- Path parameters: `{snake_case}` — `/users/me/license/{module_id}`
- Query parameters: `snake_case` — `?page_size=10&cursor=abc`

**Web App Code Naming:**
- Same conventions as desktop: PascalCase components, camelCase hooks/utils, snake_case JSON fields
- Route files: `kebab-case` — `dashboard.profile.tsx`, `dashboard.modules.tsx`
- Auth hooks: `useAuth.ts`, `useRequireAuth.ts`

**Rust API Code Naming:**
- Same conventions as desktop Rust: PascalCase structs, snake_case functions/modules
- Handler modules: `handlers/users.rs`, `handlers/licenses.rs`, `handlers/subscriptions.rs`, `handlers/webhooks.rs`
- DynamoDB modules: `db/users.rs`, `db/licenses.rs`, `db/subscriptions.rs`

### Structure Patterns

**Monorepo Organization:**

```
nkbaz-finance/
├── apps/
│   ├── desktop/           # Tauri app (moved from root)
│   │   ├── src/           # React frontend
│   │   ├── src-tauri/     # Rust backend
│   │   └── package.json   # @nkbaz/desktop
│   ├── web/               # Marketing + user portal
│   │   ├── src/
│   │   └── package.json   # @nkbaz/web
│   └── api/               # Rust Lambda
│       ├── src/
│       ├── Cargo.toml
│       └── template.yaml  # SAM infrastructure
├── packages/
│   └── shared/            # Shared TypeScript
│       ├── src/
│       └── package.json   # @nkbaz/shared
├── pnpm-workspace.yaml
├── package.json           # Workspace root
└── _bmad/                 # BMAD config (stays at root)
```

**Web App Organization (mirrors desktop conventions):**

```
apps/web/src/
├── components/
│   ├── ui/                # shadcn components
│   ├── marketing/         # Landing, pricing, features components
│   ├── dashboard/         # Authenticated area components
│   └── shared/            # Cross-feature components
├── hooks/
│   ├── useAuth.ts         # Auth state + token management
│   ├── useApi.ts          # API call wrapper for TanStack Query
│   ├── useUser.ts         # User profile queries/mutations
│   ├── useLicenses.ts     # License queries
│   └── useSubscription.ts # Subscription queries/mutations
├── lib/
│   ├── api.ts             # HTTP client (fetch wrapper with auth headers)
│   ├── auth.ts            # Cognito SDK integration
│   └── constants.ts       # API URLs, route paths, query keys
├── routes/
│   ├── __root.tsx
│   ├── index.tsx          # Landing page
│   ├── pricing.tsx
│   ├── features.tsx
│   ├── login.tsx
│   ├── callback.tsx       # OAuth callback
│   └── dashboard/
│       ├── index.tsx      # Dashboard home
│       ├── profile.tsx
│       ├── modules.tsx
│       └── subscription.tsx
└── main.tsx
```

**API Organization:**

```
apps/api/
├── src/
│   ├── main.rs            # Lambda entry point, router setup
│   ├── router.rs          # Path-based route matching
│   ├── error.rs           # ApiError enum (Auth, Validation, NotFound, Payment, Internal)
│   ├── auth.rs            # JWT claims extraction from API Gateway context
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── users.rs       # GET/PUT /users/me
│   │   ├── licenses.rs    # GET /users/me/licenses, GET /users/me/license/{module}
│   │   ├── subscriptions.rs # POST /subscriptions/checkout, GET /subscriptions/me, POST /subscriptions/portal
│   │   └── webhooks.rs    # POST /webhooks/stripe
│   ├── db/
│   │   ├── mod.rs         # DynamoDB client initialization
│   │   ├── users.rs       # Users table operations
│   │   ├── licenses.rs    # Licenses table operations
│   │   └── subscriptions.rs # Subscriptions table operations
│   └── models/
│       └── mod.rs         # User, License, Subscription structs
├── Cargo.toml
└── template.yaml          # SAM: Lambda + API Gateway + DynamoDB + Cognito
```

**Key structural rules:**
- Handlers call db functions — handlers never contain DynamoDB operations directly
- Models shared across handlers and db (same pattern as desktop)
- One handler file per API route group
- One db file per DynamoDB table

### Format Patterns

**API Response Format (HTTP):**

Successful responses return the data directly with appropriate HTTP status:

```json
// GET /users/me → 200
{ "user_id": "abc-123", "email": "user@example.com", "display_name": "Nick", "preferences": { ... } }

// POST /subscriptions/checkout → 200
{ "checkout_url": "https://checkout.stripe.com/..." }

// PUT /users/me → 200
{ "user_id": "abc-123", "email": "user@example.com", "display_name": "Nick", "preferences": { ... } }
```

Error responses return a consistent error object:

```json
// 400 Validation Error
{ "error": { "type": "validation", "message": "Display name is required", "field": "display_name" } }

// 401 Auth Error
{ "error": { "type": "auth", "message": "Token expired" } }

// 404 Not Found
{ "error": { "type": "not_found", "message": "License not found for module budget" } }

// 402 Payment Error
{ "error": { "type": "payment", "message": "Subscription creation failed" } }
```

**Data Exchange (API JSON):**
- Field naming: `snake_case` (consistent with desktop IPC convention)
- Dates: ISO 8601 strings (`"2026-04-14T10:30:00Z"`)
- Booleans: `true`/`false`
- Nulls: explicit `null` for missing optional fields
- IDs: string (Cognito sub for user_id, UUIDs or Stripe IDs for others)

**Shared Type Contract:**

`packages/shared/` mirrors the API's Rust types:

```typescript
// packages/shared/src/types/user.ts
export interface User {
  user_id: string;
  email: string;
  display_name: string | null;
  preferences: UserPreferences;
  created_at: string;
}

// packages/shared/src/types/license.ts
export interface License {
  user_id: string;
  module_id: string;
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
}

// packages/shared/src/types/api-error.ts
export interface ApiError {
  error: {
    type: "validation" | "auth" | "not_found" | "payment" | "internal";
    message: string;
    field?: string;
  };
}
```

### Communication Patterns

**API Client Pattern (shared by web and desktop):**

Both frontends use the same HTTP call pattern via TanStack Query:

```typescript
// Fetch wrapper with auth header injection
async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAccessToken(); // source differs: web = memory, desktop = Stronghold
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}
```

**TanStack Query Keys (web + desktop API calls):**
- `["api", "user"]` — current user profile
- `["api", "licenses"]` — user's licenses
- `["api", "license", moduleId]` — specific module license check
- `["api", "subscription"]` — current subscription

These are namespaced with `"api"` to distinguish from the desktop's local data query keys (e.g., `["budgets"]`, `["expenses"]`).

**Desktop License Check Pattern:**

```
App launch → check Stronghold for cached license
  → if valid (not expired): proceed normally
  → if expired or missing: call GET /users/me/license/{module}
    → if success: cache in Stronghold with expiry, proceed
    → if network error: grace period (7 days from last successful check)
    → if 401 (token expired): attempt token refresh, retry once
    → if 404 (no license): show upgrade prompt, allow limited access
```

### Process Patterns

**Auth Flow (Web):**
1. User clicks Login → redirect to Cognito Hosted UI
2. Cognito authenticates → redirects to `/callback?code=xxx`
3. Callback page exchanges code for tokens via Cognito SDK
4. Access token stored in memory, refresh token in cookie or Cognito SDK storage
5. TanStack Query `useAuth` hook manages token state
6. On token expiry → Cognito SDK refreshes automatically
7. On refresh failure → redirect to login

**Auth Flow (Desktop):**
1. User clicks Login → open system browser to Cognito Hosted UI
2. Cognito authenticates → redirects to `http://localhost:{port}/callback`
3. Tauri captures the callback, exchanges code for tokens in Rust
4. Tokens stored in Stronghold
5. On app launch → load tokens from Stronghold, verify expiry
6. On token expiry → refresh via Cognito SDK (Rust)
7. On refresh failure → prompt re-login

**Error Handling (API calls from frontends):**
1. TanStack Query catches non-2xx responses
2. Error parsed as `ApiError` type from `@nkbaz/shared`
3. Component renders inline error based on `error.type`
4. Auth errors (401) trigger token refresh or redirect to login
5. Network errors show "Unable to connect" with retry option

### Enforcement Guidelines

**All AI Agents MUST:**
1. Use `snake_case` for all JSON fields in API responses (consistent with desktop IPC)
2. Use `PascalCase` for DynamoDB table names, React components, TypeScript types, Rust structs
3. Use `snake_case` for DynamoDB attributes, Rust functions, API query parameters
4. Return consistent error format from API: `{ "error": { "type", "message", "field?" } }`
5. Place DynamoDB operations in `db/` modules, never in `handlers/`
6. Namespace API-related TanStack Query keys with `["api", ...]`
7. Import shared types from `@nkbaz/shared`, never duplicate type definitions
8. Handle auth token injection in the shared `apiCall` wrapper, never in individual hooks
9. Handle license check failures gracefully — never block desktop app launch
10. Verify Stripe webhook signatures before processing any webhook event

**Anti-Patterns to Avoid:**
- Defining the same TypeScript type in both `apps/web/` and `apps/desktop/` instead of `packages/shared/`
- Calling DynamoDB directly from handler functions (use db/ layer)
- Storing access tokens in localStorage (web) or plain files (desktop)
- Mixing `camelCase` and `snake_case` in API JSON responses
- Making API calls without the auth header wrapper
- Blocking desktop app launch on failed license checks
- Processing Stripe webhooks without signature verification

## Project Structure & Boundaries

### Complete Project Directory Structure

```
nkbaz-finance/
├── .gitignore
├── .env.example                     # Shared env var documentation
├── package.json                     # Workspace root (no dependencies, just scripts)
├── pnpm-workspace.yaml              # Workspace package definitions
├── CLAUDE.md
├── README.md
│
├── _bmad/                           # BMAD config (unchanged)
├── _bmad-output/                    # Planning artifacts (unchanged)
├── docs/                            # Project documentation (unchanged)
│
├── apps/
│   ├── desktop/                     # Tauri desktop app (moved from root)
│   │   ├── package.json             # @nkbaz/desktop — depends on @nkbaz/shared
│   │   ├── tsconfig.json
│   │   ├── tsconfig.node.json
│   │   ├── vite.config.ts
│   │   ├── components.json          # shadcn/ui config
│   │   ├── index.html
│   │   ├── playwright.config.ts
│   │   ├── public/
│   │   ├── src/                     # React frontend (existing, unchanged)
│   │   │   ├── main.tsx
│   │   │   ├── index.css
│   │   │   ├── vite-env.d.ts
│   │   │   ├── routeTree.gen.ts
│   │   │   ├── assets/
│   │   │   ├── components/          # (existing structure preserved)
│   │   │   ├── contexts/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── locales/
│   │   │   └── routes/
│   │   ├── src-tauri/               # Rust backend (existing, unchanged)
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json
│   │   │   ├── build.rs
│   │   │   ├── icons/
│   │   │   ├── migrations/
│   │   │   └── src/
│   │   └── tests/                   # Playwright E2E tests
│   │
│   ├── web/                         # Marketing site + user portal
│   │   ├── package.json             # @nkbaz/web — depends on @nkbaz/shared
│   │   ├── tsconfig.json
│   │   ├── tsconfig.node.json
│   │   ├── vite.config.ts
│   │   ├── components.json          # shadcn/ui config
│   │   ├── index.html
│   │   ├── public/
│   │   │   ├── favicon.ico
│   │   │   └── og-image.png         # Social sharing image
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── index.css            # Tailwind directives, CSS variables
│   │       ├── vite-env.d.ts
│   │       ├── routeTree.gen.ts
│   │       ├── components/
│   │       │   ├── ui/              # shadcn components
│   │       │   ├── marketing/
│   │       │   │   ├── Hero.tsx
│   │       │   │   ├── FeatureCard.tsx
│   │       │   │   ├── PricingTable.tsx
│   │       │   │   ├── Footer.tsx
│   │       │   │   └── Navbar.tsx
│   │       │   ├── dashboard/
│   │       │   │   ├── ProfileForm.tsx
│   │       │   │   ├── ModuleCard.tsx
│   │       │   │   ├── SubscriptionStatus.tsx
│   │       │   │   └── DashboardNav.tsx
│   │       │   └── shared/
│   │       │       ├── AuthGuard.tsx       # Redirects unauthenticated users
│   │       │       └── PageHeader.tsx
│   │       ├── hooks/
│   │       │   ├── useAuth.ts             # Cognito token management
│   │       │   ├── useRequireAuth.ts      # Route guard hook
│   │       │   ├── useApi.ts             # API call wrapper
│   │       │   ├── useUser.ts            # GET/PUT /users/me
│   │       │   ├── useLicenses.ts        # GET /users/me/licenses
│   │       │   └── useSubscription.ts    # Subscription queries/mutations
│   │       ├── lib/
│   │       │   ├── api.ts               # HTTP client with auth headers
│   │       │   ├── auth.ts              # Cognito SDK init + helpers
│   │       │   ├── constants.ts         # API URL, query keys, routes
│   │       │   └── utils.ts             # General utilities
│   │       └── routes/
│   │           ├── __root.tsx           # Root layout (Navbar + Footer)
│   │           ├── index.tsx            # Landing page
│   │           ├── pricing.tsx
│   │           ├── features.tsx
│   │           ├── login.tsx            # Redirect to Cognito
│   │           ├── callback.tsx         # OAuth callback handler
│   │           └── dashboard/
│   │               ├── index.tsx        # User home
│   │               ├── profile.tsx
│   │               ├── modules.tsx
│   │               └── subscription.tsx
│   │
│   └── api/                          # Rust Lambda API
│       ├── Cargo.toml                # nkbaz-api crate
│       ├── Cargo.lock
│       ├── template.yaml             # SAM: Lambda + APIGW + DynamoDB + Cognito
│       ├── samconfig.toml            # SAM deploy configuration
│       ├── .env.example              # STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
│       └── src/
│           ├── main.rs               # Lambda entry point, handler setup
│           ├── router.rs             # HTTP method + path → handler dispatch
│           ├── error.rs              # ApiError enum → HTTP response
│           ├── auth.rs               # Extract user_id from API Gateway JWT context
│           ├── handlers/
│           │   ├── mod.rs
│           │   ├── users.rs          # GET/PUT /users/me
│           │   ├── licenses.rs       # GET /users/me/licenses, /users/me/license/{module}
│           │   ├── subscriptions.rs  # POST /checkout, GET /me, POST /portal
│           │   └── webhooks.rs       # POST /webhooks/stripe
│           ├── db/
│           │   ├── mod.rs            # DynamoDB client init
│           │   ├── users.rs          # Users table CRUD
│           │   ├── licenses.rs       # Licenses table CRUD
│           │   └── subscriptions.rs  # Subscriptions table CRUD
│           ├── models/
│           │   └── mod.rs            # User, License, Subscription, Preferences structs
│           └── stripe/
│               ├── mod.rs            # Stripe client init
│               ├── checkout.rs       # Create checkout session
│               ├── portal.rs         # Create customer portal session
│               └── webhooks.rs       # Webhook event parsing + signature verification
│
└── packages/
    └── shared/                       # Shared TypeScript types
        ├── package.json              # @nkbaz/shared
        ├── tsconfig.json
        └── src/
            ├── index.ts              # Public API barrel export
            ├── types/
            │   ├── user.ts           # User, UserPreferences
            │   ├── license.ts        # License
            │   ├── subscription.ts   # Subscription
            │   └── api-error.ts      # ApiError
            └── validation/
                └── user.ts           # Shared validation schemas (if needed)
```

### Architectural Boundaries

**Module Boundary (apps are independent):**
- `apps/desktop/` builds and runs independently — `pnpm --filter @nkbaz/desktop tauri dev`
- `apps/web/` builds and runs independently — `pnpm --filter @nkbaz/web dev`
- `apps/api/` builds independently — `cd apps/api && sam build`
- No app imports code from another app. Shared code goes through `packages/shared/`

**API Boundary (HTTP contract):**
- Web and desktop ONLY interact with the API via HTTP (API Gateway endpoint)
- API Gateway handles JWT validation — Lambda receives verified `user_id` in request context
- The Stripe webhook endpoint is the only public (unauthenticated) API route
- All other routes require a valid Cognito JWT in the Authorization header

**Data Boundary:**
- Desktop owns its local SQLite database — API never touches it
- API owns DynamoDB tables — frontends never access DynamoDB directly
- User preferences exist in both places: DynamoDB is source of truth, desktop caches locally
- Conflict resolution: last-write-wins (acceptable for single-user preference data)

**Shared Package Boundary:**
- `@nkbaz/shared` contains ONLY types and validation — no runtime dependencies, no React code
- Types mirror the API's Rust models — if the API changes, shared types update to match
- Both `@nkbaz/desktop` and `@nkbaz/web` depend on `@nkbaz/shared` via `workspace:*`

### Requirements to Structure Mapping

| FR | Web | API | Desktop |
|----|-----|-----|---------|
| FR-P1: Marketing pages | `routes/index.tsx`, `routes/pricing.tsx`, `routes/features.tsx`, `components/marketing/*` | — | — |
| FR-P2: User registration/login | `routes/login.tsx`, `routes/callback.tsx`, `hooks/useAuth.ts`, `lib/auth.ts` | Cognito (managed service) | — |
| FR-P3: User profile management | `routes/dashboard/profile.tsx`, `components/dashboard/ProfileForm.tsx`, `hooks/useUser.ts` | `handlers/users.rs`, `db/users.rs` | — |
| FR-P4: Module purchase | `routes/dashboard/modules.tsx`, `components/dashboard/ModuleCard.tsx`, `hooks/useLicenses.ts` | `handlers/subscriptions.rs`, `stripe/checkout.rs`, `db/licenses.rs` | — |
| FR-P5: Subscription management | `routes/dashboard/subscription.tsx`, `components/dashboard/SubscriptionStatus.tsx`, `hooks/useSubscription.ts` | `handlers/subscriptions.rs`, `stripe/portal.rs`, `db/subscriptions.rs` | — |
| FR-P6: License verification | — | `handlers/licenses.rs`, `db/licenses.rs` | New: `src-tauri/src/commands/license.rs`, `src-tauri/src/license/` |
| FR-P7: Stripe webhooks | — | `handlers/webhooks.rs`, `stripe/webhooks.rs`, `db/licenses.rs`, `db/subscriptions.rs` | — |
| FR-P8: Preference sync | — | `handlers/users.rs` (GET/PUT preferences) | New: `src-tauri/src/commands/sync.rs` |

### Data Flow

**Module Purchase Flow:**
```
User on web /dashboard/modules → clicks "Buy Module"
  → useSubscription.ts calls POST /subscriptions/checkout
  → API handlers/subscriptions.rs → stripe/checkout.rs creates Stripe Checkout Session
  → API returns { checkout_url }
  → Web redirects user to Stripe Checkout
  → User completes payment on Stripe
  → Stripe sends webhook to POST /webhooks/stripe
  → API handlers/webhooks.rs → stripe/webhooks.rs verifies signature
  → API db/licenses.rs creates license record in DynamoDB
  → API db/subscriptions.rs updates subscription record
  → User redirected back to web /dashboard/modules (success page)
  → Next desktop app launch: license check finds new license via API
```

**License Verification Flow (Desktop):**
```
Desktop app launch → src-tauri/src/commands/license.rs
  → Check Stronghold for cached license
  → If valid and not expired: return license, app proceeds
  → If expired/missing: call GET /users/me/license/{module}
    → Load token from Stronghold
    → HTTP request to api.nicolasbazinet.net
    → On 200: cache license in Stronghold with expiry, proceed
    → On 401: attempt token refresh, retry once
    → On 404: no license — show upgrade prompt
    → On network error: check grace period (7 days)
      → Within grace: proceed with cached license
      → Expired grace: show "connect to verify" prompt
```

**Preference Sync Flow:**
```
Desktop user changes preference → save to local SQLite (immediate)
  → If authenticated: PUT /users/me (background, non-blocking)
    → On success: preference synced to DynamoDB
    → On failure: queued for next sync attempt

Desktop app launch (authenticated) → GET /users/me
  → Compare cloud preferences with local
  → If cloud is newer: update local
  → If local is newer: PUT /users/me
  → Conflict: last-write-wins (timestamp comparison)
```

### Development Workflow

**Development Commands (from repo root):**

```bash
# Desktop app development
pnpm --filter @nkbaz/desktop dev          # Vite dev server only
pnpm --filter @nkbaz/desktop tauri dev     # Full Tauri dev (Vite + Rust)

# Web app development
pnpm --filter @nkbaz/web dev               # Vite dev server

# API local development
cd apps/api && cargo lambda watch           # Hot-reload Lambda locally
cd apps/api && sam local start-api          # Full SAM local API

# Shared package
pnpm --filter @nkbaz/shared build          # Build shared types

# Build all
pnpm --filter @nkbaz/web build             # Web production build
pnpm --filter @nkbaz/desktop tauri build   # Desktop production build
cd apps/api && sam build                    # API production build

# Deploy
cd apps/api && sam deploy                   # Deploy API to AWS
pnpm --filter @nkbaz/web build && aws s3 sync apps/web/dist/ s3://nkbaz-web-bucket --delete
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are compatible. pnpm workspaces supports both Vite (web) and Tauri (desktop) build processes. SAM natively supports Cargo Lambda builds. Cognito integrates natively with API Gateway v2 JWT authorizer. Stronghold is an official Tauri plugin.

**Pattern Consistency:** snake_case flows end-to-end from DynamoDB attributes through Rust API JSON through shared TypeScript types to both React frontends. PascalCase consistent for DynamoDB table names, component naming, and struct naming across all modules.

**Structure Alignment:** Directory structure physically enforces all architectural boundaries (module isolation, API-only data access, types-only shared package).

### Requirements Coverage Validation

**Platform Functional Requirements:** 8/8 FR-Ps fully covered. Every requirement maps to specific files in web, API, and/or desktop.

**Platform Non-Functional Requirements:** 7/7 NFR-Ps addressed by technology choices. Zero-cost infrastructure via AWS free tier. Solo-developer maintainability via monorepo + manual deploys. Desktop resilience via Stronghold license caching with grace period.

### Implementation Readiness Validation

**Decision Completeness:** All critical decisions documented with specific technology choices. No ambiguous "TBD" items remain for platform scope.

**Structure Completeness:** Full project tree defined with every file and directory. Requirements-to-structure mapping provides explicit guidance for all 8 platform FRs.

**Pattern Completeness:** 10 enforcement rules + 7 anti-patterns cover all identified cross-module conflict points. Naming, structure, format, communication, and process patterns all specified.

### Gap Analysis Results

No critical or important gaps. Four minor observations:

1. **CORS origin for desktop** — `tauri://localhost` may vary by platform in Tauri v2. Verify exact origin during implementation and update API Gateway CORS config accordingly.
2. **Stripe product catalog** — Module-to-Stripe-Product mapping is a business decision. Architecture supports it via `module_id` in Licenses table. Define catalog before implementing FR-P4.
3. **npm → pnpm migration** — First implementation step. Delete `node_modules/` and `package-lock.json`, run `pnpm install`, verify all desktop dependencies resolve.
4. **Cognito configuration** — Password policy, MFA, email verification are SAM template configuration details, not architecture decisions.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Platform scope thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped (auth, licensing, shared types, deployment)

**Architectural Decisions**
- [x] Critical decisions documented with specific technology choices
- [x] Technology stack fully specified (pnpm, Vite, React, Rust Lambda, SAM, Cognito, DynamoDB, Stripe, Stronghold)
- [x] Integration patterns defined (HTTP API, JWT auth, Stripe webhooks)
- [x] Cost considerations addressed (all AWS free tier)

**Implementation Patterns**
- [x] Naming conventions established (packages, DynamoDB, API routes, code)
- [x] Structure patterns defined (monorepo, web app, API, shared package)
- [x] Communication patterns specified (API client, query keys, license check, preference sync)
- [x] Process patterns documented (auth flows, error handling, data flows)

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established (module isolation, API boundary, data boundary, shared package boundary)
- [x] Integration points mapped (data flows for purchase, license verification, preference sync)
- [x] Requirements to structure mapping complete (all 8 FR-Ps mapped)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Clean module isolation — each app builds and deploys independently
- Zero-cost infrastructure at low traffic — entire platform runs on AWS free tier
- Consistent patterns across modules — same conventions in web and desktop frontends
- Graceful desktop degradation — license caching ensures the app works offline
- Simple data model — DynamoDB multi-table design is straightforward and debuggable

**Areas for Future Enhancement:**
- CI/CD pipeline (GitHub Actions for automated deploys)
- Staging environment (add when protecting real users)
- Cognito custom domain (when branding matters)
- Custom auth UI (when Hosted UI customization is insufficient)
- Stripe Tax integration (when revenue requires tax compliance)
- Windows/Linux Tauri builds (architecture supports it, needs testing)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all modules
- Respect module boundaries — no cross-app imports
- Import shared types from `@nkbaz/shared`, never duplicate
- Refer to this document for platform decisions; refer to architecture-desktop.md for desktop-internal decisions

**First Implementation Priority:**
1. Restructure repository into pnpm monorepo (move desktop to apps/desktop/)
2. Scaffold apps/web (Vite + React) and apps/api (SAM + Cargo Lambda)
3. Create packages/shared with initial type definitions
4. Verify all three apps build independently

---
*Architecture workflow completed 2026-04-14. This document is the single source of truth for all platform-level technical decisions.*
