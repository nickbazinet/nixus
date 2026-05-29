# Nixus

A **local-first desktop app** for organizing your personal life from one place — without sending your data to the cloud.

Nixus is built as a **modular platform**: each area of your life gets its own module in a shared shell (sidebar navigation, consistent design, one install). **Finance** is the first module and is fully functional today. More modules are planned — vacation planning, car maintenance, todos, healthy lifestyle, and others over time.

Built with Tauri 2, React 19, and SQLite. Runs natively on macOS and Windows; all data stays on your machine.

## Modules

| Module | Status | What it covers |
| ------ | ------ | -------------- |
| **Finance** | Available | Budgeting, expense tracking, accounts, income, net worth, AI chat, credit-card statement import |
| **Vacation planning** | Planned | Trips, itineraries, travel prep |
| **Car maintenance** | Planned | Service history, reminders, vehicle records |
| **Todos** | Planned | Tasks and personal checklists |
| **Healthy lifestyle** | Planned | Habits, wellness tracking |

The app shell (sidebar, module switching, shared UI) is designed so new modules can plug in without reinventing the desktop experience each time.

## Repository

This repository is a **pnpm monorepo** with three packages:

| Package | Path | Purpose |
| ------- | ---- | ------- |
| `@nixus/desktop` | `apps/desktop/` | Tauri desktop app — module shell + Finance module |
| `@nixus/web` | `apps/web/` | Public marketing site (TanStack Start) |
| `@nixus/shared` | `packages/shared/` | Shared UI primitives and design tokens (used by all surfaces) |

## Table of Contents

- [Modules](#modules)
- [Quick Start](#quick-start)
- [Monorepo Commands](#monorepo-commands)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Testing](#testing)
- [Building & Packaging](#building--packaging)
- [Database (Finance module)](#database-finance-module)
- [AI Features (Finance module)](#ai-features-finance-module)
- [Project Structure](#project-structure)
- [Logging](#logging)

## Quick Start

For a new developer getting the desktop app running locally:

```bash
# 1. Clone and enter the repo
git clone https://github.com/nickbazinet/nixus.git && cd nixus

# 2. Install dependencies (requires pnpm — see Prerequisites)
pnpm install

# 3. Install Playwright browser for E2E tests (optional, but recommended)
pnpm --filter @nixus/desktop exec playwright install chromium

# 4. Verify Rust toolchain
cargo --version   # should be 1.70+

# 5. Launch the full desktop app (Tauri + Rust backend + hot reload)
pnpm desktop:tauri dev
```

That opens the native **Nixus** window (1280×800). The Vite dev server starts automatically on port 1420.

### Frontend-only (no Rust backend)

Useful for UI work when you don't need live data or Tauri IPC:

```bash
pnpm desktop:dev
```

Opens http://localhost:1420 in the browser. `invoke()` calls won't work — data-dependent features show empty states or errors.

### Marketing site

```bash
pnpm --filter @nixus/web dev
```

Opens http://localhost:3000. See [`apps/web/README.md`](apps/web/README.md) for web-specific details.

### First-run notes

- The SQLite database is created automatically on first desktop launch.
- AI features (chat, CC import) require credentials — configure them in **Settings** inside the app, or see [AI Features](#ai-features). The app works without AI; all other features are unaffected.

## Monorepo Commands

Run these from the repo root. Use `pnpm --filter <package>` to target a specific workspace.

| Command | Description |
| ------- | ----------- |
| `pnpm desktop:dev` | Desktop frontend only (Vite on :1420) |
| `pnpm desktop:tauri dev` | Full Tauri desktop app |
| `pnpm desktop:tauri build` | Build desktop installer (.dmg / .msi) |
| `pnpm desktop:build` | Typecheck + Vite build for desktop frontend |
| `pnpm --filter @nixus/web dev` | Marketing site dev server (:3000) |
| `pnpm --filter @nixus/web build` | Static prerender to `apps/web/.output/public/` |
| `pnpm --filter @nixus/shared typecheck` | Typecheck shared package |

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Monorepo | pnpm workspaces |
| Framework | [Tauri 2](https://v2.tauri.app/) (Rust + webview) |
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| Routing | TanStack Router (file-based) |
| State | TanStack React Query (server-state), React Hook Form (forms) |
| Styling | Tailwind CSS 4, shadcn/ui via `@nixus/shared`, Lucide icons |
| Charts | Recharts |
| i18n | i18next + react-i18next |
| Backend | Rust (edition 2021) |
| Database | SQLite via rusqlite (bundled), WAL mode |
| AI | AWS Bedrock and OpenAI (configurable in Settings) |
| Testing | Playwright (E2E), Vitest (unit) |
| Logging | tracing + tracing-appender (daily rolling log files) |
| Marketing site | TanStack Start v1, Nitro (static prerender) |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Desktop Window                  │
│              (Tauri 2 Webview)                   │
├─────────────────────────────────────────────────┤
│  React 19 Frontend (@nixus/desktop)             │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐ │
│  │ TanStack │ │  TanStack  │ │ @nixus/shared │ │
│  │  Router  │ │React Query │ │  UI + tokens  │ │
│  └──────────┘ └────────────┘ └───────────────┘ │
├──────────────── Tauri IPC ──────────────────────┤
│  Rust Backend (apps/desktop/src-tauri/)         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐ │
│  │ Commands │ │  Database   │ │  AI Module    │ │
│  │ (IPC     │ │  (rusqlite  │ │  (Bedrock /   │ │
│  │  handlers│ │   + SQLite) │ │   OpenAI)     │ │
│  └──────────┘ └────────────┘ └───────────────┘ │
└─────────────────────────────────────────────────┘
```

### Frontend (`apps/desktop/`)

- **Routing**: TanStack Router with file-based routes in `src/routes/`. Routes auto-generate `src/routeTree.gen.ts` via the Vite plugin.
- **Data fetching**: TanStack React Query hooks in `src/hooks/` wrap Tauri `invoke()` calls. Each domain (budget, expenses, accounts, etc.) has its own hook file.
- **UI components**: Shared shadcn/ui primitives live in `packages/shared/src/ui/`. Domain components live in `apps/desktop/src/components/<domain>/`.
- **Styling**: Tailwind CSS 4 with design tokens from `@nixus/shared/styles/tokens.css`. Dark mode via `next-themes`.

### Backend (`apps/desktop/src-tauri/`)

- **Commands** (`src/commands/`): Tauri IPC command handlers, one file per domain.
- **Database** (`src/db/`): Query functions organized by domain.
- **AI** (`src/ai/`): Bedrock and OpenAI integration for chat and credit card statement parsing.
- **Credentials** (`src/credentials.rs`): OS keyring storage for AI provider credentials.
- **Models** (`src/models/`): Shared serde-serializable data structures.
- **Error handling** (`src/error.rs`): Centralized `AppError` type.

### Shared package (`packages/shared/`)

- UI primitives (`Button`, `Card`, `Dialog`, etc.) consumed by both desktop and web.
- Design tokens (`src/styles/tokens.css`) registered against Tailwind v4's `@theme`.
- Exported via `@nixus/shared` and `@nixus/shared/ui`.

### Data Flow

```
User action → React component → useQuery/useMutation hook
  → invoke("command_name", { args }) → Tauri IPC
  → Rust command handler → db query function → SQLite
  → Result<T, AppError> → JSON → React Query cache → UI update
```

## Prerequisites

- **[pnpm](https://pnpm.io/)** >= 9 (workspace package manager)
- **Node.js** >= 20
- **Rust** — install via [rustup](https://rustup.rs/)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10+ since 2022)

## Testing

### Desktop E2E (Playwright)

Tests run against the Vite dev server with mocked Tauri IPC — no Rust backend needed.

```bash
# From repo root
pnpm --filter @nixus/desktop exec playwright test

# Headed browser
pnpm --filter @nixus/desktop exec playwright test --headed

# Single file
pnpm --filter @nixus/desktop exec playwright test tests/budget.spec.ts
```

Test files live in `apps/desktop/tests/` and cover: accessibility, accounts, assets, budget, chat, dashboard, design system, expenses, import, navigation, net worth, onboarding, and AI navigation.

### Type checking

```bash
# Desktop frontend
pnpm --filter @nixus/desktop exec tsc --noEmit

# Rust backend
cd apps/desktop/src-tauri && cargo check

# Shared package
pnpm --filter @nixus/shared typecheck

# Web marketing site
pnpm --filter @nixus/web typecheck
```

### Unit tests

```bash
pnpm --filter @nixus/desktop test      # Vitest
pnpm --filter @nixus/web test          # Vitest
pnpm --filter @nixus/web test:e2e      # Playwright
```

## Building & Packaging

### Desktop (macOS / Windows)

```bash
pnpm desktop:tauri build
```

Outputs to `apps/desktop/src-tauri/target/release/bundle/`:

- **macOS**: `.app` bundle and `.dmg` installer
- **Windows**: `.msi` and `.exe` (NSIS) installers

The build runs `pnpm run build` (TypeScript check + Vite build) before compiling the Rust binary, as configured in `apps/desktop/src-tauri/tauri.conf.json`.

### Marketing site

```bash
pnpm --filter @nixus/web build
```

Produces a statically prerendered site under `apps/web/.output/public/`.

## Database (Finance module)

The Finance module stores data locally in SQLite.

**Engine**: SQLite via `rusqlite` with the `bundled` feature (compiles SQLite from source — no system dependency needed).

**Location**: Tauri's app data directory (legacy bundle ID from the original project name):

- macOS: `~/Library/Application Support/com.nbazinet.nkbaz-finance/nkbaz-finance.db`
- Windows: `%APPDATA%/com.nbazinet.nkbaz-finance/nkbaz-finance.db`

**Configuration**: WAL journal mode and foreign keys enabled on every connection.

**Migrations**: Embedded in the binary via `include_str!()`. Run automatically on startup. Tracked in a `schema_version` table. Current schema has 17 migrations covering budget, expenses, accounts, audit log, assets, net worth, chat, income, config, merchant hints, recurring expenses, and more.

**Backup/Restore**: Manual backup export and import via the `commands::backup` module.

## AI Features (Finance module)

The Finance module supports configurable AI providers for:

1. **Chat** — Natural language queries about your financial data, with write actions (with confirmation)
2. **Credit card statement import** — Parses uploaded CC statements, extracts transactions, and auto-categorizes them

### Setup

Configure credentials in the app's **Settings** page — they are stored in the OS keyring. Alternatively, set environment variables before launch:

```bash
# AWS Bedrock
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1

# OpenAI
export OPENAI_API_KEY=...
```

The AI client initializes asynchronously on app startup. If credentials are unavailable, the app still works — AI features return errors but all other functionality is unaffected.

## Project Structure

```
nixus/
├── apps/
│   ├── desktop/                  # @nixus/desktop — Tauri desktop app
│   │   ├── src/                  # React frontend
│   │   │   ├── routes/           # TanStack Router file-based routes
│   │   │   ├── components/       # Domain-specific UI (budget, expenses, etc.)
│   │   │   ├── hooks/            # React Query hooks (one per domain)
│   │   │   ├── contexts/         # React context providers
│   │   │   ├── locales/          # i18n translation files
│   │   │   └── routeTree.gen.ts  # Auto-generated (do not edit)
│   │   ├── src-tauri/            # Rust backend
│   │   │   ├── src/
│   │   │   │   ├── commands/     # IPC command handlers
│   │   │   │   ├── db/           # Database query functions
│   │   │   │   ├── ai/           # AI chat + CC statement parser
│   │   │   │   ├── models/       # Shared data structures
│   │   │   │   ├── credentials.rs
│   │   │   │   └── error.rs
│   │   │   ├── migrations/       # SQL migration files (001–017)
│   │   │   └── tauri.conf.json
│   │   └── tests/                # Playwright E2E tests
│   └── web/                      # @nixus/web — marketing site
│       ├── src/routes/           # TanStack Start routes
│       ├── src/components/       # Marketing-specific components
│       ├── content/              # Markdown content
│       └── tests/e2e/            # Playwright tests
├── packages/
│   └── shared/                   # @nixus/shared — shared UI + tokens
│       └── src/
│           ├── ui/               # shadcn/ui primitives
│           ├── styles/           # Design tokens (tokens.css)
│           └── types/            # Shared TypeScript types
├── docs/                         # Project guidelines and specs
├── pnpm-workspace.yaml           # Workspace definition
├── package.json                  # Root scripts (desktop:* shortcuts)
└── pnpm-lock.yaml
```

## Logging

Log files are written to the app data directory using daily rolling files (`nkbaz-finance.log`). Log level defaults to `info`. Configured via `tracing-subscriber` with `env-filter`.
