---
baseline_commit: 314d9455053c2f8b6e62bda3820702f9f95075c7
---

# Story 26.1: Cognito User Pool & Public App Client Setup

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the AWS-side Cognito User Pool, PKCE public app client, hosted domain, and Google social IdP provisioned and documented,
so that the desktop app has a working OAuth endpoint to talk to before any code is written.

**Scope:** Mostly **out-of-band AWS Console work** (one User Pool, one prefix domain, one Google social IdP, one public app client) plus exactly **three in-repo artifacts**: (1) a new `apps/desktop/src-tauri/src/commands/auth.rs` holding only the non-secret Cognito config `pub const`s + a `#[cfg(test)] mod tests` drift guard, (2) one line `pub mod auth;` in `commands/mod.rs`, (3) one new `## Account sign-in (Cognito)` section in `CONTRIBUTING.md`. **No IaC file. No Lambda/API Gateway/DynamoDB/Identity Pool. No Tauri command, no `lib.rs` change, no `Cargo.toml` change, no `tauri.conf.json` change, no `capabilities/default.json` change, no keyring code, no frontend, no migration, no Playwright.**

**FRs:** FR1 (login-scoped — AWS-side half) · **NFRs:** NFR2 (nothing secret committed), NFR3 (zero new AWS compute), NFR4 (`sub` available as durable identity key)
**Epic:** [epics-login.md § Epic 26, Story 26.1](../planning-artifacts/epics-login.md) (lines 115-155)
**Architecture:** [architecture-login.md](../planning-artifacts/architecture-login.md) — § Authentication & Security, § Decision Impact Analysis (Implementation Sequence step 1), § File Organization Patterns, § Implementation Handoff ("First Implementation Priority")
**Predecessors:** none. **This is the first story of Epic 26 and the first story of the login feature.** Nothing in this feature is implemented yet.
**Successors (blocked by this story):** 26.2 (models + keyring), 26.3 (deep-link plugins), 26.4 (PKCE login + token exchange), 26.5 (session read/refresh/sign-out).

---

## ⛔ READ FIRST — What This Story Actually Delivers

This story is **90% AWS Console clicking and 10% Rust consts**. Its value is that Stories 26.2–26.5 can be written against a *live, already-verified* OAuth endpoint instead of a guess. Two failure modes make this story worthless if you get them wrong:

1. **Skipping the manual end-to-end verification.** If you provision and mark this done without proving in a browser that `/oauth2/authorize` → sign-in → `302 Location: nixus://auth/callback?code=…&state=…` → `/oauth2/token` → an `id_token` containing `sub`/`email`/`name` actually works, then Story 26.4 will be debugging *your* AWS config while thinking it is debugging *its* Rust. AC #9/#10 exist precisely to prevent that. **Do the curl round-trip.**
2. **Getting an immutable setting wrong.** `UsernameAttributes` (sign-in with email), username case sensitivity, and the **required-attributes** list are **fixed at User Pool creation and cannot be changed afterwards** — the only remedy is deleting the pool and starting over. AC #1 pins them. Read § Immutable-At-Creation Settings before you click "Create user pool".

**You must have AWS Console (or CLI) access to the nixus AWS account and access to a Google Cloud project.** If you do not, stop and report that — do **not** stub fake values into `commands/auth.rs` and mark the story done.

---

## ⛔ PREREQUISITE GATE

Verified at story-creation time (2026-08-09) against `314d945`: **nothing of the login feature exists.** Repo-wide, the only occurrence of "cognito" outside `architecture-login.md` / `epics-login.md` is the `backlog` line in `sprint-status.yaml:222`. There is no `commands/auth.rs`, no `tauri-plugin-deep-link`, no `nixus://` handling, and **no infrastructure-as-code of any kind anywhere in the repo** (no `*.tf`, no `cdk.json`, no `template.yaml`, no `serverless.*`, no `Pulumi.yaml`, no `infra/`).

**Run this gate before writing any code:**

```bash
cd /Users/nbazinet/projects/nixus
ls apps/desktop/src-tauri/src/commands/auth.rs 2>/dev/null && echo "EXISTS -> prepend, do not overwrite"
grep -rn "COGNITO_CLIENT_ID\|COGNITO_DOMAIN_PREFIX" apps/desktop/src-tauri/src/ || echo "no cognito consts yet (expected)"
grep -n "pub mod auth;" apps/desktop/src-tauri/src/commands/mod.rs || echo "not registered yet (expected)"
grep -rn "Cognito\|cognito" CONTRIBUTING.md docs/ || echo "undocumented yet (expected)"
aws sts get-caller-identity   # must succeed against the nixus AWS account
```

| Gate | Result | Action |
|---|---|---|
| `aws sts get-caller-identity` fails / wrong account | **HARD STOP** | Report "no AWS access". Do not fabricate config values. |
| `commands/auth.rs` does **not** exist | Expected | Create it in this story containing **only** the const block + tests (Task 3). |
| `commands/auth.rs` **exists** (Story 26.4 landed first) | **SOFT** | **Prepend** the const block to the top of the existing file. Do **not** overwrite it, do **not** duplicate consts, and drop the `#[allow(dead_code)]` attributes for any const 26.4 already consumes. |
| `pub mod auth;` already in `commands/mod.rs` | **SOFT** | Leave it; do not add a second line. |

---

## Acceptance Criteria

1. **Given** the nixus AWS account
   **When** the Cognito **User Pool** is created (Console: *Cognito → User pools → Create user pool*)
   **Then** it exists in region **`us-east-1`** (matching the app's existing AWS default at `ai/mod.rs:55` and `commands/settings.rs:32`) with sign-in option **Email** — i.e. `UsernameAttributes = ["email"]` — and username case sensitivity **off**
   **And** **self-service sign-up is ENABLED** (without it, "Create Account" from the Hosted UI is impossible and FR1 cannot be met)
   **And** **password is a permitted sign-in factor**, and the Essentials-plan **passwordless options (email/SMS one-time code, passkeys) are NOT enabled** for v1 — the epic requires an *email/password* form (FR1), and a passwordless-only pool would render a page that satisfies no AC here
   **And** the **only required attribute is `email`**; `name` is present but **optional** (a required attribute the Google IdP does not supply makes federated sign-in fail outright)
   **And** MFA is **off** for v1, and the default password policy is retained
   **And** **no infrastructure-as-code file is added to this repository** — provisioning is Console/CLI only, matching how the app already treats AWS Bedrock (`CONTRIBUTING.md:267-281` documents env vars, never resource creation)

2. **Given** the User Pool's **feature plan**
   **When** chosen
   **Then** it is recorded explicitly in Completion Notes, and the chosen plan supports the login pages actually used (**Essentials** → managed login; **Lite** → classic hosted UI only)
   **And** the choice is justified against NFR3: both Lite and Essentials include a **10,000 MAU/month free tier**, so at pre-alpha scale either is $0 — cost is not the deciding factor, feature fit is
   **And** if **Lite** is chosen, Completion Notes record that managed login, login-page localization, and refresh-token rotation are unavailable on that plan (see § Decisions Resolved Here for the recommended default)

3. **Given** the **hosted prefix domain**
   **When** created (*User pool → Branding → Domain → Create Cognito domain*)
   **Then** `https://<prefix>.auth.us-east-1.amazoncognito.com` serves the sign-in pages, where `<prefix>` contains only lowercase letters/digits/hyphens and contains none of `aws`, `amazon`, `cognito`
   **And** the domain's **branding version** is recorded (Managed login **or** Hosted UI (classic)) and is consistent with the feature plan from AC #2
   **And** `curl -sS https://<prefix>.auth.us-east-1.amazoncognito.com/.well-known/openid-configuration` returns JSON whose `authorization_endpoint` and `token_endpoint` are on that same host (proves the domain is live; a prefix domain can take up to 60 seconds to become available)

4. **Given** Google as a federated provider
   **When** configured
   **Then** a Google Cloud **OAuth 2.0 Web application client** exists whose *Authorized JavaScript origin* is `https://<prefix>.auth.us-east-1.amazoncognito.com` and whose *Authorized redirect URI* is exactly `https://<prefix>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
   **And** Google is registered as a **social IdP on the Cognito user pool** (*Social and external providers → Add identity provider → Google*) with authorized scopes `profile email openid` (space-separated) and attribute mapping **`email` → `email`** and **`name` → `name`**
   **And** the Google OAuth **client secret is entered into Cognito only** — it is never written to this repository, never to `.env`, never to the keyring, and never to a story/commit
   **And** nixus code never calls a Google API directly — Cognito owns the federation; verifiable by `grep -ri "googleapis\|accounts.google.com" apps/` returning nothing, and by the fact that the only host in `commands/auth.rs` is the Cognito domain (AC #7)

5. **Given** the **app client**
   **When** created (*App clients → Create app client → Native/public client*)
   **Then** it is a **public client with NO client secret** (`--no-generate-secret`), because a desktop binary cannot hold a secret
   **And** "Enable Hosted UI / use the Cognito-hosted authorization server" is on (`AllowedOAuthFlowsUserPoolClient = true`)
   **And** the **Authorization code grant is enabled and the Implicit grant is disabled** (`AllowedOAuthFlows = ["code"]` only)
   **And** **PKCE with `code_challenge_method=S256`** is the code-exchange method actually exercised in AC #9 (Cognito's authorize endpoint accepts `code_challenge`/`code_challenge_method` on the code grant; there is no separate toggle to enable)
   **And** **refresh token rotation is left DISABLED** (v1 decision — architecture-login.md § Deferred Decisions)
   **And** the auth-flow list contains **`ALLOW_REFRESH_TOKEN_AUTH`** (required by Story 26.5's `grant_type=refresh_token`) and **does not** contain `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_USER_SRP_AUTH`, or `ALLOW_ADMIN_USER_PASSWORD_AUTH` — the app must be structurally incapable of accepting a password, since the user only ever types credentials into the system browser
   **And** `SupportedIdentityProviders` contains **both** `COGNITO` **and** `Google` (omitting `COGNITO` removes the email/password form; omitting `Google` removes the Google button)
   **And** token validity is recorded in Completion Notes (defaults: access 1h, id 1h, refresh 30 days — see § Known v1 Limitations for the consequence of the 30-day refresh window)

6. **Given** the app client's allowed callback and sign-out URLs
   **When** configured
   **Then** the **only** callback URL is exactly `nixus://auth/callback` and the **only** sign-out URL is exactly `nixus://auth/signout` (Cognito accepts custom schemes such as `myapp://example`; URLs must be absolute and must not contain a fragment)
   **And** **no `http://localhost` callback is left registered** — if one was added temporarily for verification it is removed before this story is marked done, and its temporary use is recorded in Completion Notes
   **And** the app client's requested OAuth scopes are exactly `openid`, `email`, `profile` — `openid` yields `sub`, `email` yields `email`, and `profile` is what releases `name`
   **And** `name` and `email` are in the app client's **read attributes**, otherwise the claims are withheld from the `id_token` even though the scopes are granted

7. **Given** the non-secret configuration values (region, domain prefix, client id)
   **When** this story completes
   **Then** they exist as **Rust build-time `pub const`s** in `apps/desktop/src-tauri/src/commands/auth.rs`, byte-for-byte as specified in § Non-Secret Config — Exact File Contents, with `pub mod auth;` added to `commands/mod.rs` **between `pub mod asset;` (line 2) and `pub mod backup;` (line 3)** (alphabetical)
   **And** they are **not** in the keyring, **not** in SQLite, **not** in a `.env` file, **not** in `tauri.conf.json` (see § Why Not tauri.conf.json), and **not** in webview storage
   **And** committing these values is correct and required — a public client id and a hosted domain are public by design (both travel in the browser's address bar on every authorize request); the only secret in this feature is Google's OAuth client secret, which lives solely in Cognito
   **And** `COGNITO_REDIRECT_URI` / `COGNITO_SIGNOUT_URI` **byte-match** the URLs registered on the app client, and `COGNITO_CLIENT_ID` / `COGNITO_HOSTED_UI_BASE_URL` byte-match the real app client id / real domain — a single character of drift makes `/oauth2/authorize` reject the request with `redirect_mismatch`, which Story 26.4 would then spend its budget debugging

8. **Given** `commands/auth.rs`'s `#[cfg(test)] mod tests`
   **When** `cd apps/desktop/src-tauri && cargo test` runs
   **Then** these pass: `hosted_ui_base_url_matches_prefix_and_region` (the composed URL const cannot drift from the prefix/region consts); `redirect_and_signout_uris_use_the_nixus_scheme`; `scopes_include_openid_email_and_profile`; `client_id_is_populated` (fails while the placeholder is still in place — this is the guard that makes "provisioned but not recorded" impossible)
   **And** all pre-existing Rust tests still pass
   **And** `cd apps/desktop/src-tauri && cargo check` produces **zero warnings** (`docs/guidelines/warnings.md`)

9. **Given** the provisioned Hosted UI and a real `code_challenge`
   **When** the **email/password** flow is manually driven end-to-end per § Manual End-to-End Verification
   **Then** the sign-in page renders **both** an email/password form **and** a "Continue with Google" button
   **And** a new account can be created through the page (email verification code delivered by Cognito's default email sender)
   **And** the browser's final redirect is observably `nixus://auth/callback?code=<…>&state=<…>` — captured as a `302` `Location` header in DevTools, because `nixus://` is not registered until Story 26.3 and the browser therefore cannot follow it
   **And** `POST /oauth2/token` with `grant_type=authorization_code` + `code` + `redirect_uri=nixus://auth/callback` + `client_id` + `code_verifier` and **no client secret** returns `200` with `access_token`, `id_token`, `refresh_token`, `expires_in`
   **And** the `id_token` payload decodes to include **`sub`**, **`email`**, and (for a user who has one) **`name`** — proving the exact claim set Stories 26.4/26.5 depend on
   **And** the raw token values are **not** pasted into the story file, a commit, or any log

10. **Given** the same manual procedure
    **When** the **Google** flow is driven (clicking "Continue with Google")
    **Then** it completes to the same `nixus://auth/callback?code=…&state=…` redirect and the same successful token exchange
    **And** the resulting `id_token` contains `email` and `name` populated from the Google attribute mapping
    **And** if Google refuses the sign-in for a tester, the cause is diagnosed and recorded (the usual cause is the Google OAuth consent screen still being in *Testing* mode, which restricts sign-in to explicitly listed test users)

11. **Given** NFR3 (zero new AWS compute for this feature)
    **When** this story completes
    **Then** **no** Lambda function, API Gateway REST/HTTP API, DynamoDB table, or **Cognito Identity Pool** was created for this feature — the only new resources are one Cognito **User Pool**, one prefix domain, one social IdP, and one app client
    **And** the proof commands in § Zero-New-Compute Proof were run and their outcome recorded in Completion Notes

12. **Given** the documentation obligation
    **When** this story completes
    **Then** `CONTRIBUTING.md` gains a `## Account sign-in (Cognito)` section inserted **between the AI-features section (ends line 281, followed by the `---` on line 283) and `## Project structure` (line 285)**, following the brevity of the existing Bedrock "### Setup" precedent
    **And** it states: the User Pool / domain / IdP / app client are provisioned **out-of-band in the AWS Console (no IaC in this repo)**; the non-secret values live in `apps/desktop/src-tauri/src/commands/auth.rs`; a contributor needs **no** AWS credentials to build or run the app, because sign-in is entirely optional and no feature is gated by it (NFR1)
    **And** it points to `_bmad-output/planning-artifacts/architecture-login.md` as the sole authority for login questions, and explicitly notes that `architecture.md`'s April 2026 Cognito + DynamoDB + Stripe design is **superseded and must not be used as a reference**
    **And** the amendment to `architecture-entitlements-licensing.md` is **NOT** made here — that belongs to Story 27.4

13. **Given** the provisioned resource identifiers
    **When** this story is marked done
    **Then** Completion Notes record: AWS account id (or "nixus prod account"), region, User Pool **id**, User Pool **name**, domain **prefix**, app client **name**, app client **id**, feature plan, branding version, token validities, and the Google Cloud project + OAuth client id
    **And** **no secret** appears there — not the Google client secret, not a token, not a password

---

## Tasks / Subtasks

> **Tasks 0-2 were completed out-of-band by the user in the AWS Console**, with each step verified by the orchestrator probing live public endpoints. They were **not** performed by the dev agent, which had no AWS credentials for this account (and needed none). Subtasks left unchecked below were genuinely not done — see deviations (b) and (d) in Completion Notes.

- [x] **Task 0: Prerequisite gate** (see ⛔ PREREQUISITE GATE) — *completed out-of-band by user*
  - [x] Run all five gate commands; HARD STOP if `aws sts get-caller-identity` fails — *the four repo-side gate commands were re-run by the dev agent; the `aws sts` gate was satisfied by the user's own Console session, not by CLI on this machine*
  - [x] Read § Immutable-At-Creation Settings **before** creating the pool
  - [x] Decide and write down: region, domain prefix, pool name, app client name, feature plan, branding version — *recorded in the AC 13 table below; a **custom** domain was chosen over a prefix domain — deviation (a)*

- [~] **Task 1: Provision the AWS side, in this exact order** (AC: #1, #2, #3, #4, #5, #6) — *completed out-of-band by user, except the two Google subtasks*
  - [x] 1a. Create the **User Pool** — sign-in option Email, case-insensitive usernames, self-registration ON, required attributes = `email` only, `name` optional, MFA off, default password policy, feature plan per AC #2 (AC #1, #2)
  - [x] 1b. Create the **prefix domain** and wait for it to serve (up to 60s); set branding version; verify with the `openid-configuration` curl (AC #3) — *a **custom** domain (`auth.nixusapp.com`) was created instead; a prefix domain also exists as an unused fallback. The `openid-configuration` curl is **unsatisfiable** against either domain (both 404) — verified by other means, see deviation (b)*
  - [ ] 1c. In **Google Cloud**: create/reuse a project, configure the OAuth consent screen (scopes `openid`, `email`, `profile` — non-sensitive), create a **Web application** OAuth client with the origin + `/oauth2/idpresponse` redirect URI from AC #4 (AC #4) — **NOT DONE — deferred, deviation (d)**
  - [ ] 1d. In **Cognito**: add **Google** as a social IdP with the Google client id + secret, scopes `profile email openid`, attribute mapping `email`→`email` and `name`→`name` (AC #4) — **NOT DONE — deferred, deviation (d)**
  - [~] 1e. Create the **app client**: public/no secret, hosted UI enabled, `code` grant only, callbacks/sign-out URLs from AC #6, scopes `openid email profile`, `name`+`email` readable, identity providers `COGNITO` + `Google`, `ALLOW_REFRESH_TOKEN_AUTH` only, refresh-token rotation disabled (AC #5, #6) — *all as specified **except** identity providers, which are `COGNITO` only (deviation (d)), and the `name`/`email` read attributes, which could not be positively confirmed (deviation (i))*
  - [x] 1f. If (and only if) the app client was created via **CLI/SDK** and managed login is the branding version, run `aws cognito-idp create-managed-login-branding --use-cognito-provided-values` for it — SDK-created clients get **no** managed-login style and managed login will not render without one (Console-created clients get a style automatically) — *N/A: created in the Console, so a managed-login style was auto-assigned; managed login was observed rendering*
  - [x] 1g. Re-open the app client and confirm every setting stuck (Cognito silently drops OAuth settings if `AllowedOAuthFlowsUserPoolClient` is off) — *confirmed by the successful live `/oauth2/authorize` → sign-in → code → token round-trip in Task 2*

- [~] **Task 2: Manual end-to-end verification** (AC: #9, #10) — *email/password flow PASSED; Google flow not run*
  - [x] 2a. Generate a PKCE `code_verifier` + `S256` `code_challenge` and a random `state` using the snippets in § Manual End-to-End Verification
  - [x] 2b. Open the authorize URL in a browser with DevTools → Network → **Preserve log** enabled; confirm the page shows both the email/password form and the Google button (AC #9) — *email/password form rendered. The Google button rendered only while `Google` was temporarily ticked on the app client and **failed on click** — deviation (d)*
  - [x] 2c. Sign up a throwaway test user with email/password, complete the emailed verification code, and capture the `302 Location: nixus://auth/callback?code=…&state=…` (AC #9)
  - [x] 2d. `curl` the token exchange within **5 minutes** (authorization codes are single-use and expire in ~5 min); confirm `200` + all four fields (AC #9)
  - [x] 2e. Base64url-decode the `id_token` **payload only** and confirm `sub`, `email`, `name`; confirm `aud` == client id and `iss` == `https://cognito-idp.us-east-1.amazonaws.com/<pool-id>` (AC #9) — *`sub`, `email`, `aud`, `iss` all confirmed. `name` **MISSING** — expected and correct for an email-only pool, deviation (g)*
  - [ ] 2f. Repeat 2b–2e via "Continue with Google" (AC #10) — **NOT DONE — deferred, deviation (d)**
  - [x] 2g. Delete any temporary `http://localhost` callback URL, if one was used (AC #6) — *N/A: none was ever registered; the `302 Location:` capture method was used instead — deviation (h)*
  - [x] 2h. Record *that* it worked and the claim **names** observed. **Never paste token values anywhere.** — *claim names only, recorded below; no token value appears anywhere in this story, the repo, or any log*

- [x] **Task 3: Record the non-secret config in the repo** (AC: #7, #8)
  - [x] 3a. Create `apps/desktop/src-tauri/src/commands/auth.rs` with the const block + `#[cfg(test)] mod tests` from § Non-Secret Config — Exact File Contents, substituting the **real** client id, prefix, and region (or prepend to the file if 26.4 landed first — see the gate) — *file already existed (created by Story 26.3); const block **prepended** above `dispatch_deep_link_url`, test module **appended** below it. Adapted for the custom domain — see deviations (a) and (c).*
  - [x] 3b. Add `pub mod auth;` to `apps/desktop/src-tauri/src/commands/mod.rs` between line 2 (`pub mod asset;`) and line 3 (`pub mod backup;`) — *already present at line 3 from Story 26.3; verified, not edited (a second line would be a compile error). SOFT gate outcome per § PREREQUISITE GATE.*
  - [x] 3c. Do **not** touch `lib.rs` — this story registers no Tauri command, so `generate_handler!` is unchanged — *verified untouched; `generate_handler!` remains at 95 entries.*
  - [x] 3d. `cd apps/desktop/src-tauri && cargo check` → **zero warnings**; `cargo test` → the four new tests plus all pre-existing tests pass (AC #8) — *`cargo check --all-targets`: zero warnings. `cargo test`: 289 passed / 0 failed (285 baseline + 4 new).*

- [x] **Task 4: Document it** (AC: #12)
  - [x] 4a. Insert the `## Account sign-in (Cognito)` section into `CONTRIBUTING.md` at the position given in AC #12, using the draft in § Documentation Obligation — *inserted between the AI-features `---` and `## Project structure`; corrected for the custom domain and for the deferred Google IdP.*
  - [x] 4b. Confirm no secret and no token value appears in the new section — *scanned; only the words "non-secret", "email/password" and "tokens are stored in the OS keyring" appear. No values.*

- [x] **Task 5: Close out** (AC: #11, #13)
  - [~] 5a. Run the § Zero-New-Compute Proof commands and record the outcome (AC #11) — *PARTIAL: CLI proof not runnable (no credentials for this account on this machine). Recorded from the Console/provisioning process instead — see deviation (e).*
  - [x] 5b. Fill in Completion Notes with the identifier table from AC #13 — **no secrets**
  - [x] 5c. Record the § Known v1 Limitations you accepted (no account linking, 30-day refresh window, Cognito default email sender, Google consent-screen mode)

### Review Findings

**Adversarial code review — 2026-08-09 · verdict: NO BLOCKING FINDINGS.**

Scope reviewed: the three repo-side deliverables of Tasks 3-5 only — `apps/desktop/src-tauri/src/commands/auth.rs`, `CONTRIBUTING.md`, `deferred-work.md`. Every Dev Agent Record claim was re-verified from scratch rather than trusted.

#### BLOCKING

**None.** No correctness bug, no security issue, no spec/AC violation, and no regression was found. This is stated unambiguously: there is nothing here that must be fixed before this story can be marked done. Verification evidence below.

#### Independently verified (evidence, not assertion)

- **A · Security — CLEAN (hard gate passed).** Scanned all three changed files plus the full story file and `deferred-work.md` for: 3-segment base64url JWTs (both an `eyJ`-anchored pattern and a generic `[A-Za-z0-9_-]{20,}` × 3 pattern), `client_secret`, `GOCSPX-`, `AKIA`/`ASIA[0-9A-Z]{16}`, `-----BEGIN`, `secret_key`/`private_key`, `password=`, and token/code value assignments. Zero hits. A ≥25-char high-entropy sweep across all four files returns only URL path fragments, constant names, the `baseline_commit` SHA, and the public app client id `6525109r95las7odvuesf13joj` — which AC 7 explicitly requires to be committed. No AWS account id, no pool-id-adjacent secret, no Google secret (none exists), no token, no authorization code, no password anywhere.
- **B · Const values byte-match the live deployment.** All 7 consts match the required values exactly, including `COGNITO_HOSTED_UI_BASE_URL` with no trailing slash and `COGNITO_SCOPES` as single-space-separated with no commas and no `+`. Re-confirmed live, credential-free: `GET https://auth.nixusapp.com/oauth2/authorize?...` → `HTTP/2 302`, `location: https://auth.nixusapp.com/login?...` with every parameter echoed intact — **no `invalid_scope`, no `redirect_mismatch`**. The canonical discovery document at `cognito-idp.us-east-1.amazonaws.com/us-east-1_7gfGQ0emg/.well-known/openid-configuration` reports `authorization_endpoint: https://auth.nixusapp.com/oauth2/authorize`, `token_endpoint: https://auth.nixusapp.com/oauth2/token`, and `issuer: .../us-east-1_7gfGQ0emg`. AC 7's `redirect_mismatch` risk to Story 26.4 is closed.
- **C · Story 26.3's code is untouched — proven byte-for-byte.** `commands/auth.rs` is untracked, so `git diff` cannot show it; instead the 20-line block at `auth.rs:36-55` was diffed against Story 26.3's verbatim spec block (`26-3-…md:211-230`): **zero differences, identical SHA-256 `b9db9f28…cb544`** — `use` statements, doc comment, function signature, body, and the `info!` line all unchanged. Structure confirmed correct: consts at 1-34 (above), function at 42-55, test module at 57-89 (below). 26.3's log-safety guardrail is intact — only boolean presence flags are logged, never `code`/`state`/`error` values.
- **D · The drift guards actually guard — proven by mutation, not by reading.** `cargo test` → **289 passed, 0 failed** (285 baseline + 4 new), all four `commands::auth::tests::*` present. Nine mutations were injected one at a time and reverted, with the file's SHA-256 confirmed restored to `1d978116…668b77` after every round: domain/base-URL divergence → **FAILED** ✓; trailing slash on the domain const (the case the `assert_eq!` alone cannot catch) → **FAILED**, so the `ends_with('/')` assertion is load-bearing ✓; `REPLACE_WITH_APP_CLIENT_ID` → **FAILED** ✓; empty client id → **FAILED**, so the `is_empty()` assertion is load-bearing ✓; `nixus://auth/callback/` one-char drift → **FAILED** ✓; `nixus://auth/logout` → **FAILED** ✓; comma-separated scopes → **FAILED** ✓; `+`-separated scopes → **FAILED** ✓; dropped `profile` scope → **FAILED** ✓. Two mutations pass and are recorded as NON-BLOCKING #3.
- **E · Warnings policy — ZERO warnings, allowances proven load-bearing.** `cargo check --all-targets` after `touch`ing the file to force a real recompile: zero warnings. `mod commands;` is confirmed **private** at `lib.rs:3` (no `pub mod commands` anywhere), so the dev's stated cause is correct. `cargo rustc --lib -- --force-warn dead_code` emits `constant X is never used` for **all seven** COGNITO consts — every `#[allow(dead_code)]` is therefore load-bearing, none is decorative. All 7 carry a `// WHY:` comment naming the consuming story (26.4 ×4, 26.4+26.5 ×1, 26.5 ×1, 26.4 ×1). No blanket `#![allow(...)]` exists anywhere in the crate. Compliant with `docs/guidelines/warnings.md` and `docs/project-context.md` §9 ("add `#[allow(dead_code)]` only if it will be used").
- **F · Scope contained.** `commands/mod.rs`'s single added line is `pub mod auth;` at line 3 — Story 26.3's change, correctly left alone (a duplicate would be a compile error). `generate_handler!` is still **95** entries; this story registers no Tauri command. No IaC of any kind exists in the repo (`*.tf`, `cdk.json`, `template.yaml`, `serverless.*`, `Pulumi.yaml`, `*.tfvars`, `infra/` — all absent). Version is `0.3.2` in all three files. `auth.rs` contains no `#[tauri::command]`, no `reqwest`, no PKCE/`code_verifier`, no `keyring`/`keyring_core::Entry`, no `Emitter`/`emit(`, i.e. zero 26.4/26.5 leakage. Zero frontend files changed (`git status --porcelain -- apps/desktop/src/ packages/` is empty), so the Rust-only-token-exchange guardrail holds. `grep -ri "googleapis|accounts.google.com" apps/` hits only a comment in `index.css` explaining that Inter is vendored *instead of* being fetched from Google — no Google API call exists.
- **G · AC 12 satisfied.** The section sits exactly between the AI-features `---` and `## Project structure`. It states: out-of-band AWS Console provisioning with **"there is no infrastructure-as-code in this repo"**; non-secret values in `apps/desktop/src-tauri/src/commands/auth.rs`; **"Contributors need no AWS credentials"** plus "Sign-in is entirely optional: **no feature is gated by it**" (NFR1); `architecture-login.md` as the **sole** authority; and `architecture.md`'s April 2026 Cognito + DynamoDB + Stripe design as **"superseded and must not be used as a reference"**. It contains **no** `architecture-entitlements-licensing.md` amendment (correctly left to Story 27.4). Correctly adapted for the deferral ("Google sign-in is **deferred** — it is not available yet") and correctly drops the draft's Google-client-secret sentence. Four short paragraphs — comparable in weight to the Bedrock `### Setup` precedent at `CONTRIBUTING.md:267-281`.
- **H · Honesty audit — the Completion Notes are accurate and do not overclaim.** All ten required disclosures are present and correctly labelled: (a) custom domain as an approved decision naming AC 3 + AC 7; (b) the discovery-doc 404 — **independently reproduced: `auth.nixusapp.com` → HTTP 404 and the prefix domain → HTTP 404**, exactly as claimed, with the "*intent* satisfied, *literal command* not and cannot be" framing preserved rather than papered over (the fallback prefix domain is also confirmed live, `/oauth2/authorize` → 302); (c) the `COGNITO_DOMAIN_PREFIX`→`COGNITO_CUSTOM_DOMAIN` and test rename — and the claim that the **other three tests are byte-for-byte as specified is verified by diff, identical**; (d) Google **"AC 4 and AC 10 are NOT met"** stated in those words, subtasks 1c/1d/2f left genuinely `[ ]`, parent tasks `[~]`, `SupportedIdentityProviders = COGNITO` only, deferral also written to `deferred-work.md` with a re-enablement checklist; (e) AC 11 CLI proof **"were not executed"** with the AWS-managed CloudFront distribution volunteered as an honest caveat rather than glossed; (f) AC 9 passed with **claim names only**, no values; (g) the missing `name` claim documented as expected and correct for an email-only pool; (h) no `localhost` callback ever registered; (i)/(j)/(k) read attributes, feature plan, branding version, and refresh-token validity/rotation all marked **UNVERIFIED / INFERRED, NOT CONFIRMED** — never asserted as passed, including in the AC 13 table rows themselves. **No unmet or unverified AC is presented anywhere as satisfied.**
- **I · Project standards.** `docs/guidelines/warnings.md` and `docs/project-context.md` §9/§10 are both satisfied (zero warnings; targeted allowances justified by future use; no version bump).

#### NON-BLOCKING

- [ ] [Review][Patch] **Header comment still documents a Google client secret that does not exist** [`apps/desktop/src-tauri/src/commands/auth.rs:4-5`] — the block comment reads "The only secret in this feature is Google's OAuth client secret, which lives solely in the Cognito IdP config." Per deviation (d) no Google Cloud OAuth client and no Cognito Google IdP exist, so there is no such secret and no such IdP config. Notably, Completion Notes › Scope discipline (line 639) records that this *exact sentence* was deliberately deleted from the `CONTRIBUTING.md` draft for precisely this reason — the identical claim simply survived in the source header. Nothing leaks; this is documentation accuracy only. **Fix:** replace lines 4-5 with something like "No secret exists in this feature today: Google federation is deferred (see `deferred-work.md`). If Google is enabled later, its OAuth client secret lives solely in the Cognito IdP config and never in this repo."
- [ ] [Review][Patch] **`use` statements now sit below the const block, inverting a 100%-consistent crate convention** [`apps/desktop/src-tauri/src/commands/auth.rs:36-37`] — every analogous module in this crate puts imports first and consts after: `credentials.rs:1-8`, `ai/chat.rs:1-10`, `ai/trends_insight.rs:1-19`, `maintenance/catalog.rs:1-9`. `auth.rs` now has consts at 13-34 and `use tauri::AppHandle;` / `use tracing::info;` at 36-37. This is a direct consequence of the story's own instruction to "**Prepend** the const block to the top of the existing file" (§ PREREQUISITE GATE, Task 3a), so the dev is spec-compliant — but the file reads unlike every sibling. Zero functional impact (Rust permits `use` at any module position; verified compiling and warning-free). **Fix (cheapest folded into Story 26.4, which edits this file anyway):** move lines 36-37 above the line-1 comment block. Story 26.3's bytes are preserved either way.
- [ ] [Review][Patch] **`scopes_include_openid_email_and_profile` lets two drift classes through** [`apps/desktop/src-tauri/src/commands/auth.rs:76-82`] — membership assertions rather than an exact pin. Mutation-proven gaps: `"openid  email profile"` (double space) → test **PASSES**, and `"openid email profile aws.cognito.signin.user.admin"` (superset) → test **PASSES**. Both would change the emitted `scope` parameter; the superset scope is not on the app client and would draw `invalid_scope`. Severity is low because a live probe with `scope=openid%20%20email%20profile` still returns `302 → /login`, so the double-space form is tolerated by Cognito today, and because the test's name and the story spec's literal body both describe membership, not equality. **Fix:** add `assert_eq!(COGNITO_SCOPES, "openid email profile");` alongside the existing three asserts.
- [ ] [Review][Patch] **`client_id_is_populated` does not pin the client id, unlike its sibling test** [`apps/desktop/src-tauri/src/commands/auth.rs:84-88`] — it rejects the `REPLACE_WITH` placeholder and the empty string (both mutation-proven to fail correctly), but any other non-empty string passes. `redirect_and_signout_uris_use_the_nixus_scheme` pins its two consts to exact literals, so the treatment is inconsistent — and AC 7 names client-id drift as one of the two failure modes that would burn Story 26.4's budget on `redirect_mismatch`/`invalid_client` debugging. Matches the story spec's literal test body as written, hence non-blocking. **Fix:** add `assert_eq!(COGNITO_CLIENT_ID, "6525109r95las7odvuesf13joj");`.
- [ ] [Review][Patch] **AC 13's User Pool *name* and app client *name* are not recorded** [this story file:565,569] — both rows read "not separately recorded". AC 13 (line 152) enumerates "User Pool **name**" and "app client **name**" among the required identifiers. This is honestly disclosed rather than fabricated, and it is functionally inert: nothing in `auth.rs` or in Stories 26.2-26.5/27.x consumes a resource *name*, and the operative identifiers (pool id `us-east-1_7gfGQ0emg`, client id `6525109r95las7odvuesf13joj`) are both recorded. Thin-disclosure class, not an overclaim. **Fix:** read both names off the Console and fill the two rows, or have the orchestrator explicitly accept the id-only record.
- [ ] [Review][Patch] **AC 9's "Continue with Google" button clause is not named as unmet** [this story file:606 (deviation (f)), 177 (subtask 2b)] — deviation (f)'s header reads "AC 9 manual end-to-end verification PASSED (email/password)". AC 9's first clause (line 125) also requires the sign-in page to render a "Continue with Google" button, which the shipped app client cannot do now that `Google` is un-ticked (deviation (d)). The underlying fact is fully disclosed at subtask 2b — "The Google button rendered only while `Google` was temporarily ticked on the app client and **failed on click**" — and the "(email/password)" parenthetical scopes the pass, so this is not a misrepresentation. What is missing is naming that clause as unmet the way AC 4 and AC 10 are named. **Fix:** add one line to deviation (d) or (f): "Consequence: AC 9's 'Continue with Google' button clause is also unmet — email/password is the only rendered sign-in option in v1."
- [ ] [Review][Patch] **Subtask 1e is marked `[x]` although its annotation names two exceptions** [this story file:171] — the same line discloses that identity providers are `COGNITO` only (deviation (d)) and that the `name`/`email` read attributes could not be positively confirmed (deviation (i)). Parent Task 1 is correctly `[~]`. Bookkeeping only — nothing is concealed, since both exceptions sit inline on the checkbox line. **Fix:** change `[x]` to `[~]` for consistency with Tasks 1, 2, and 5a.
- [ ] [Review][Patch] **`auth.nixusapp.com` is hardcoded in prose with no drift guard** [`CONTRIBUTING.md:291`] — the new section names the domain in text. The `hosted_ui_base_url_matches_custom_domain` test guards `auth.rs` only, so a future domain change would leave the documentation silently stale. Low value; documentation drift, not a defect. **Fix (optional):** drop the parenthetical `(auth.nixusapp.com)` and let `auth.rs` remain the single source of truth for the value, which the surrounding sentence already points readers to.

---

## Dev Notes

### Critical Rules (DO NOT VIOLATE)

1. **No IaC.** Do not add terraform/CDK/CloudFormation/SAM/Pulumi. The repo has none today (verified) and this feature deliberately keeps Cognito out-of-band, exactly like Bedrock.
2. **No new AWS compute.** No Lambda, no API Gateway, no DynamoDB, no Cognito **Identity Pool**. Cognito's own endpoints are the entire backend (NFR3).
3. **No client secret on the app client.** PKCE public client. A desktop binary cannot hold a secret.
4. **Google's OAuth client secret never enters this repo.** It is typed into the Cognito IdP config in the AWS Console and lives only there.
5. **No token value is ever written to the story, a commit, a log, or a screenshot.**
6. **No password auth flows on the app client.** `ALLOW_USER_PASSWORD_AUTH` / `ALLOW_USER_SRP_AUTH` / `ALLOW_ADMIN_USER_PASSWORD_AUTH` stay off — the app must be architecturally incapable of collecting a password.
7. **Only two callback/sign-out URLs, both `nixus://`.** No lingering localhost entry.
8. **Zero compilation warnings** before you stop (`docs/guidelines/warnings.md`). Never a blanket `#![allow(dead_code)]`.

### Decisions Resolved Here (Binding)

The epic and architecture leave four things open. They are decided here so no downstream story re-litigates them:

| Open item | Decision | Rationale |
|---|---|---|
| Region | **`us-east-1`** | The app already hardcodes `us-east-1` as its AWS default in two places (`ai/mod.rs:55`, `commands/settings.rs:32`) and the web deploy job uses it (`web-ci.yml`). One region for the whole account. |
| Feature plan / login pages | **Essentials + branding version "Managed login"** (recommended default; **Lite + classic hosted UI is an acceptable fallback** if recorded per AC #2) | New pools default to Essentials; the 10,000-MAU free tier makes it $0 at pre-alpha scale; managed login is the only option that supports **login-page localization**, which matters because nixus ships EN + FR (platform i18n rule). Lite would also forfeit refresh-token rotation as a future option. |
| Where non-secret config lives | **Rust `pub const`s in `commands/auth.rs`** | It is a build-time constant (what the epic AC asks for), it is the file that consumes it (26.4/26.5), and it stays inside architecture-login.md's delta tree — no new module invented. See § Why Not tauri.conf.json. |
| Domain prefix / names | `nixus-auth` prefix, pool `nixus-users`, app client `nixus-desktop` (adjust only if the prefix is taken — prefixes are globally unique per region) | Prefix must be lowercase alphanumeric+hyphen and may not contain `aws`, `amazon`, or `cognito`. |

### Immutable-At-Creation Settings (get these right or delete the pool)

These **cannot be changed after the User Pool is created**:

- **Sign-in attribute** — `UsernameAttributes = ["email"]` ("Email" as the sign-in option). Choosing "Username" instead is unrecoverable.
- **Username case sensitivity** — set case-**insensitive**.
- **Required attributes** — `email` only. Adding `name` as *required* here is the single most likely way to break Google federation and email/password sign-up simultaneously, and you cannot undo it.

Changeable later, so don't agonize: password policy, MFA, token validity, callbacks, scopes, IdPs, feature plan, branding version. (Note: switching branding version invalidates all existing hosted sessions and takes up to ~4 minutes to propagate.)

### Provisioning Order Matters (do not reorder)

Pool → **domain** → Google Cloud OAuth client → Cognito Google IdP → app client → (CLI only) managed-login style.

Why: Google's *Authorized redirect URI* is `https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`, so the **domain must exist before you can configure Google**; and the Cognito Google IdP must exist before the app client can list `Google` in its supported identity providers.

### Non-Secret Config — Exact File Contents

`apps/desktop/src-tauri/src/commands/auth.rs` (new file in this story; Story 26.4 appends its commands **below** this block):

```rust
// Non-secret Cognito configuration, provisioned out-of-band in the AWS Console
// (see CONTRIBUTING.md § Account sign-in (Cognito)). These values are public by
// design: the client id, domain, and scopes travel in the browser's address bar
// on every /oauth2/authorize request. The only secret in this feature is
// Google's OAuth client secret, which lives solely in the Cognito IdP config.

#[allow(dead_code)] // consumed by Story 26.4 (start_login) — remove the allowance there
pub const COGNITO_REGION: &str = "us-east-1";

#[allow(dead_code)] // consumed by Story 26.4 (start_login)
pub const COGNITO_DOMAIN_PREFIX: &str = "nixus-auth";

#[allow(dead_code)] // consumed by Story 26.4 (start_login, handle_auth_callback)
pub const COGNITO_CLIENT_ID: &str = "REPLACE_WITH_APP_CLIENT_ID";

// Pre-composed so Stories 26.4 and 26.5 never rebuild it and cannot disagree
// about the shape; the test below guarantees it stays in sync with the parts.
#[allow(dead_code)] // consumed by Stories 26.4 and 26.5
pub const COGNITO_HOSTED_UI_BASE_URL: &str = "https://nixus-auth.auth.us-east-1.amazoncognito.com";

#[allow(dead_code)] // consumed by Story 26.4; must byte-match the app client's allowed callback URL
pub const COGNITO_REDIRECT_URI: &str = "nixus://auth/callback";

#[allow(dead_code)] // registered on the app client; unused in v1 (sign-out is local-only, Story 26.5)
pub const COGNITO_SIGNOUT_URI: &str = "nixus://auth/signout";

#[allow(dead_code)] // consumed by Story 26.4; space-separated per OAuth 2.0
pub const COGNITO_SCOPES: &str = "openid email profile";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_ui_base_url_matches_prefix_and_region() {
        assert_eq!(
            COGNITO_HOSTED_UI_BASE_URL,
            format!(
                "https://{}.auth.{}.amazoncognito.com",
                COGNITO_DOMAIN_PREFIX, COGNITO_REGION
            )
        );
    }

    #[test]
    fn redirect_and_signout_uris_use_the_nixus_scheme() {
        assert_eq!(COGNITO_REDIRECT_URI, "nixus://auth/callback");
        assert_eq!(COGNITO_SIGNOUT_URI, "nixus://auth/signout");
    }

    #[test]
    fn scopes_include_openid_email_and_profile() {
        let scopes: Vec<&str> = COGNITO_SCOPES.split(' ').collect();
        assert!(scopes.contains(&"openid"));
        assert!(scopes.contains(&"email"));
        assert!(scopes.contains(&"profile"));
    }

    #[test]
    fn client_id_is_populated() {
        assert!(!COGNITO_CLIENT_ID.starts_with("REPLACE_WITH"));
        assert!(!COGNITO_CLIENT_ID.is_empty());
    }
}
```

Substitute the **real** prefix/region/client id in **all** places (including inside `COGNITO_HOSTED_UI_BASE_URL`) — `hosted_ui_base_url_matches_prefix_and_region` fails loudly if you miss one, and `client_id_is_populated` fails while the placeholder remains. That pair of tests is the entire reason this story has automated coverage at all.

`apps/desktop/src-tauri/src/commands/mod.rs` — one added line, alphabetical:

```rust
pub mod account;
pub mod asset;
pub mod auth;          // <-- ADD THIS LINE (line 3)
pub mod backup;
```

### Why Not tauri.conf.json

The epic AC permits "build-time constants **or** a `tauri.conf.json`-adjacent config file". Use the constants. Reasons, so nobody re-opens this:

- Tauri v2's config structs are deserialized with `#[serde(rename_all = "camelCase", deny_unknown_fields)]`, so an invented top-level key in `tauri.conf.json` is a **build failure**, not a config extension.
- The only arbitrary-JSON escape hatch is `plugins.<name>`, which today holds exactly one real entry (`updater`, `tauri.conf.json:26-33`). Parking non-plugin config under a fake plugin name would need a runtime `app.config().plugins` lookup with no compile-time typing and no test guard.
- The desktop app has **zero** Vite env vars and **no** `.env` file (only `apps/web` uses `VITE_*`), so an env-var scheme would be a brand-new pattern for this app.
- Module-top `pub const` is the app's established convention for non-secret fixed values: `ai/chat.rs:10` (`MODEL_ID`), `ai/trends_insight.rs:19-20`, `maintenance/catalog.rs:8-10` (`NHTSA_BASE`, an external API base URL — the closest analogue to a Cognito domain), `credentials.rs:3` (`KEYRING_SERVICE`).
- Do **not** copy the `aws_region` precedent (`commands/settings.rs:71,84` dual-writes region to keyring *and* the SQLite `config` table). That exists because the user *enters* it. The Cognito domain/client id are shipped properties of the build, not user settings.

### Manual End-to-End Verification (no app code required)

`nixus://` is not registered until Story 26.3, so the browser **cannot** follow the final redirect. That is expected — you capture the redirect as a `302` `Location` header instead. Preferred method; do **not** register a localhost callback just to make the browser happy (and if you do, AC #6 requires removing it).

```bash
# --- 1. PKCE + state (bash/zsh, macOS) ---
VERIFIER=$(openssl rand -base64 96 | tr -d '\n=' | tr '+/' '-_' | cut -c1-128)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr -d '\n=' | tr '+/' '-_')
STATE=$(openssl rand -hex 16)
DOMAIN=https://nixus-auth.auth.us-east-1.amazoncognito.com
CLIENT_ID=<app client id>
echo "verifier=$VERIFIER"

# --- 2. Authorize URL: open in a browser with DevTools > Network > Preserve log ---
echo "$DOMAIN/oauth2/authorize?response_type=code&client_id=$CLIENT_ID\
&redirect_uri=nixus%3A%2F%2Fauth%2Fcallback&scope=openid+email+profile\
&code_challenge=$CHALLENGE&code_challenge_method=S256&state=$STATE"

# --- 3. Sign in (email/password, then repeat with Google). In DevTools, find the
#        302 whose Location is nixus://auth/callback?code=...&state=...
#        Verify the returned state equals $STATE. Copy the code:
CODE=<code from the Location header>

# --- 4. Token exchange (within ~5 minutes; codes are single-use) ---
curl -sS -X POST "$DOMAIN/oauth2/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=authorization_code \
  -d "client_id=$CLIENT_ID" \
  -d "code=$CODE" \
  -d 'redirect_uri=nixus://auth/callback' \
  -d "code_verifier=$VERIFIER" | tee /tmp/nixus-token.json | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print(sorted(d.keys()))'
# expect: ['access_token', 'expires_in', 'id_token', 'refresh_token', 'token_type']

# --- 5. Inspect the id_token CLAIM NAMES only (never record values) ---
python3 - <<'PY'
import base64, json
tok = json.load(open('/tmp/nixus-token.json'))['id_token']
p = tok.split('.')[1]; p += '=' * (-len(p) % 4)
c = json.loads(base64.urlsafe_b64decode(p))
print('claims present:', sorted(c.keys()))
for k in ('sub','email','name','aud','iss','token_use'):
    print(k, 'PRESENT' if k in c else 'MISSING')
PY

# --- 6. Clean up ---
rm -f /tmp/nixus-token.json
```

Expected: `sub`, `email`, `token_use=id`, `aud` == client id, `iss` == `https://cognito-idp.us-east-1.amazonaws.com/<pool-id>`. `name` is `PRESENT` for the Google user and may be `MISSING` for an email/password user who never supplied one — **that is the correct, expected outcome**, and it is exactly why Story 26.2 models `name` as `Option<String>`. Record which case you saw.

**If `/oauth2/authorize` errors instead of rendering a page**, check in this order: `AllowedOAuthFlowsUserPoolClient` off → `code` grant not enabled → `redirect_uri` not byte-identical to a registered callback → requested scope not in the app client's allowed scopes → domain not finished provisioning.

### Zero-New-Compute Proof (NFR3)

```bash
aws cognito-idp list-user-pools --max-results 20 --region us-east-1   # expect exactly the one new pool
aws cognito-identity list-identity-pools --max-results 20 --region us-east-1  # expect NO identity pool for nixus
aws lambda list-functions --region us-east-1 --query 'Functions[].FunctionName'
aws apigateway get-rest-apis --region us-east-1 --query 'items[].name'
aws apigatewayv2 get-apis --region us-east-1 --query 'Items[].Name'
aws dynamodb list-tables --region us-east-1
```

Record in Completion Notes that **nothing in the last four lists is new for this feature**. Pre-existing unrelated resources are fine; what matters is that this story created none. Note that a Cognito **Identity Pool** (`cognito-identity`) is a *different service* from a **User Pool** (`cognito-idp`) — this feature needs only the User Pool, and creating an Identity Pool would be scope creep with an IAM blast radius.

### Known v1 Limitations (record as accepted; do NOT fix here)

1. **No automatic account linking.** A person who signs up with email/password and later signs in with Google using the same address becomes **two** users with two different `sub`s. Cognito does not merge them; `AdminLinkProviderForUser` would, and it is out of scope. Since `sub` is the durable identity key (NFR4), record this explicitly — it matters the day cloud sync is built.
2. **30-day refresh window (default).** Story 26.5 refreshes only on app launch. With the default 30-day refresh-token validity, a user who does not open nixus for 30+ days lands in `SessionExpired` and must sign in again. Raising refresh validity (max 3650 days) is a one-field app-client change needing **no** code change. Record whichever value you chose.
3. **Cognito's default email sender** is used for sign-up verification codes: a low daily send quota and a generic `no-reply@verificationemail.com` sender. Adequate for pre-alpha beta; switching to SES is a later ops task.
4. **Google consent screen mode.** While the Google OAuth app is in *Testing*, only explicitly listed test users can sign in with Google. `openid`/`email`/`profile` are non-sensitive scopes, so publishing does not require Google's verification review. Record the mode you left it in.
5. **No token signature verification.** Story 26.5 reads `id_token` claims without validating the JWT signature, which is acceptable because the token is fetched directly from Cognito over TLS and stored in the OS keyring. For whenever that changes, the JWKS URL is `https://cognito-idp.us-east-1.amazonaws.com/<pool-id>/.well-known/jwks.json` — record the pool id so it can be composed later.
6. **No `/oauth2/revoke` on sign-out** and **refresh-token rotation disabled** — both explicitly deferred by architecture-login.md § Deferred Decisions. Token revocation stays *enabled* on the app client (default) so a future story can start calling it without an app-client change.

### Dead Code (this WILL bite you)

`mod commands;` is **private** in `lib.rs:3`, so unreferenced `pub` items inside `commands::auth` still trigger `dead_code`, and `#[cfg(test)]` usage does **not** suppress it under plain `cargo check` (established in Story 25.1 § Dead Code).

- Every const in this story is unused by non-test code until Story 26.4/26.5 → each keeps an `#[allow(dead_code)]` **with a WHY comment naming the consuming story**.
- Story 26.4 removes the allowances for the consts it consumes; Story 26.5 removes the one on `COGNITO_HOSTED_UI_BASE_URL` if 26.4 hasn't. `COGNITO_SIGNOUT_URI` stays allowed until a story actually uses `/logout`.
- Never delete a const to silence a warning. Never add a blanket `#![allow(dead_code)]`.

### Scope Boundary vs. Stories 26.2–26.5 / 27.x (binding)

| Item | Story |
|---|---|
| `CognitoSession` / `AuthState` models, `AppError::Auth`, `store/load/clear_cognito_session` in `credentials.rs` | 26.2 |
| `tauri-plugin-deep-link` + `tauri-plugin-single-instance` in `Cargo.toml`, `plugins.deep-link.desktop.schemes`, `deep-link:default` capability, `lib.rs` plugin registration | 26.3 |
| `start_login`, `handle_auth_callback`, PKCE generation in Rust, `reqwest` token exchange, `auth:callback-received` event, `generate_handler!` entries | 26.4 |
| `get_auth_session`, `grant_type=refresh_token` on launch, `sign_out`, JWT claim parsing | 26.5 |
| `queryKeys.auth.session`, `AuthState` TS type, `hooks/useAuth.ts` | 27.1 |
| `AccountPromptDialog.tsx`, `ProfileMenu.tsx`, i18n keys | 27.2 / 27.3 |
| Playwright E2E, **amendment to `architecture-entitlements-licensing.md`**, FR4 coupling audit | 27.4 |
| Dedicated **test/CI** Cognito user pool or app client | Explicitly out of scope — a CI/ops task, per epic § Testing and architecture § Test organization |
| Any Lambda / API Gateway / DynamoDB / Identity Pool / cloud sync / push notifications / community features | **Never** in this feature (NFR3, architecture § Deferred Decisions) |
| `aws-sdk-cognitoidentityprovider` crate | **Never** — Cognito's OAuth endpoints are plain REST; `reqwest` is already a dependency |

### Documentation Obligation

Insert into `CONTRIBUTING.md` between line 283 (`---`, after the AI-features section) and line 285 (`## Project structure`). Match the Bedrock section's brevity (`CONTRIBUTING.md:260-281`) — this is a contributor note, not a runbook; the runbook is this story file.

```markdown
## Account sign-in (Cognito)

Nixus supports an optional account (email/password or Google) backed by an **AWS Cognito user pool**. Sign-in is entirely optional: **no feature is gated by it**, and the app is fully functional offline with no account.

The user pool, its hosted domain, the Google social identity provider, and the public app client are **provisioned out-of-band in the AWS Console — there is no infrastructure-as-code in this repo**, the same way AWS Bedrock is treated. The non-secret configuration (region, domain prefix, app client id) is committed as build-time constants in `apps/desktop/src-tauri/src/commands/auth.rs`; a public OAuth client id and a hosted domain are public by design. The only secret involved is Google's OAuth client secret, which lives solely in the Cognito identity-provider configuration in AWS.

**Contributors need no AWS credentials** to build or run the desktop app. Sign-in opens the Cognito hosted page in your system browser; tokens are stored in the OS keyring, never in the webview.

See `_bmad-output/planning-artifacts/architecture-login.md` for the full design — it is the **sole** authority on login. The Cognito + DynamoDB + Stripe design in `_bmad-output/planning-artifacts/architecture.md` (April 2026) is **superseded and must not be used as a reference**.
```

### Project Structure Notes

- Monorepo path `apps/desktop/src-tauri/` (`@nkbaz/desktop`). Rust edition 2021, `tauri 2.11`.
- `commands/auth.rs` is the file architecture-login.md's delta tree already sanctions (§ Project Structure & Boundaries). This story creates it early with config only; it does **not** invent a new `src/auth/` module.
- `lib.rs` currently declares private modules alphabetically (`ai, budget, commands, credentials, db, error, financial_health, maintenance, models` — lines 1-9). **No `lib.rs` change is needed in this story.**
- Every existing Rust model derives exactly `#[derive(Debug, Clone, Serialize, Deserialize)]` and lives in `models/mod.rs` (project-context.md §4) — this story adds **no** model.
- `reqwest 0.12` (features `json`, `rustls-tls`, `default-features = false`), `keyring 4` + `keyring-core 1`, `tauri-plugin-opener 2`, `urlencoding 2`, `chrono 0.4` (serde) are **already** direct dependencies — Stories 26.4/26.5 need **no** new crate for the token exchange. Do not add one here.
- `credentials.rs:3` already pins `const KEYRING_SERVICE: &str = "nkbaz-finance"`; the login feature's `nixus-auth` service is a **second, separate** keyring service added in Story 26.2 — not this story.
- `error.rs` hand-writes `Serialize` for `AppError` (no derive) and only `AiService` carries `recoverable` today; `AppError::Auth` is Story 26.2's work.
- Verify with `cd apps/desktop/src-tauri && cargo check && cargo test` (`CONTRIBUTING.md:196-197`). There is **no Rust step in CI** (`.github/workflows/release.yml` builds via `tauri-action`; `web-ci.yml` is web-only), so the zero-warning rule is procedural — run it yourself.
- No `clippy.toml`, no `#![deny(warnings)]`, no `rust-toolchain.toml`.
- This story adds **no** migration; no SQLite work exists anywhere in this feature.
- **Regression surface is zero by construction:** the only in-repo changes are one brand-new file, one added `pub mod` line, and one added `CONTRIBUTING.md` section. No existing Rust function, model, command registration, dependency, Tauri config, capability, or frontend file is edited, so no existing behaviour or test can change. If `cargo test`'s pre-existing test count or results move, you have edited something outside this story's scope — revert it.

### Previous Story Intelligence

No previous story exists in Epic 26 — this is the first. Carry-forwards from the last shipped work:

- **From Story 25.1 (§ Dead Code):** unreferenced `pub` items inside a **privately** declared module still warn under `cargo check`, and `#[cfg(test)]` usage does not suppress it. Hence the per-const `#[allow(dead_code)]` + WHY comments here, and the requirement that 26.4 remove them.
- **From Story 25.1 (§ Naming Collision Warning):** the project's convention is to prefix every new identifier so it cannot be confused with an existing concept. Every const here is `COGNITO_*`; no bare `CLIENT_ID`/`DOMAIN`/`REGION`.
- **From Stories 24.x/25.x:** the "create-or-append" gate pattern (a file may already exist because a sibling story landed first) — reused verbatim in this story's PREREQUISITE GATE for `commands/auth.rs`.
- **From Story 23.1:** `cargo check` had to be warning-free and scope creep into shared files (`error.rs`, `models/mod.rs`, `lib.rs`) required an approved exception. **If you find yourself editing `lib.rs`, `error.rs`, `models/mod.rs`, `credentials.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, or anything under `apps/desktop/src/`, stop — that is a scope violation, not a necessity.**
- **Do not commit** unless explicitly asked. The working tree holds planning artifacts.

### Recent Commit Context

`git log` head is `314d945 chore: bump version to 0.3.2`, preceded by `c983604 feat(budget): budget templates with import/export and starter template onboarding` (Epic 24/25 shipped) and `1bc5427 fix(trends): show friendly fallback instead of raw error on AI insight failure`. **Zero login/auth/Cognito commits exist — this feature is 100% greenfield.** The recent direction (friendly canned user-facing copy instead of raw error text) is why this feature's later stories surface "your session expired, please sign in again" rather than an OAuth error string; nothing in *this* story is user-facing.

Version is `0.3.2` in all three version files (`apps/desktop/package.json`, `tauri.conf.json:4`, `Cargo.toml`). **This story does not bump the version.**

### Latest Tech Information (AWS Cognito, verified 2026-08-09)

- **Custom URI schemes are supported callback URLs.** Cognito app-client callback URLs must be absolute, pre-registered, and must not contain a fragment; HTTPS is required *except* `http://localhost` for testing, and custom schemes such as `myapp://example` are explicitly supported. `nixus://auth/callback` is therefore valid. No localhost redirect server is needed because Cognito — not Google — is the direct OAuth party.
- **PKCE** is used by adding `code_challenge` + `code_challenge_method=S256` to `/oauth2/authorize` on the code grant, and `code_verifier` to `/oauth2/token`. There is no separate console toggle.
- **Feature plans:** the default for new user pools is **Essentials**; `CreateUserPool`/`UpdateUserPool` take `UserPoolTier`. **Managed login is Essentials+ only; the classic hosted UI is available on all tiers.** Login-page **localization** requires managed login (Essentials+). **Refresh-token rotation requires Essentials+** (irrelevant for v1, where it is deliberately off). Both Lite and Essentials include a **10,000 MAU/month free tier**; Plus has none.
- **Console vs SDK asymmetry:** creating an app client in the **Console** auto-assigns a managed-login branding style. Creating it with an **AWS SDK/CLI** creates **no** style, and managed login will not work for that client until `CreateManagedLoginBranding` runs (`--use-cognito-provided-values` is enough). Prefix domains take up to 60s to serve; branding-version changes take up to ~4 minutes and invalidate existing hosted sessions.
- **Google IdP wiring:** in Google Cloud, the OAuth client's authorized JavaScript origin is `https://<domain>` and the authorized redirect URI is `https://<domain>/oauth2/idpresponse`. In Cognito, Google's authorize scopes are **space-separated** (`profile email openid`), and the IdP must then be **added to the app client** to appear on the login page.
- **Claim ↔ scope mapping:** `openid` → `sub`; `email` → `email`/`email_verified`; `profile` → the remaining standard attributes including `name`. The attribute must also be in the app client's **read attributes**.
- **`aws-sdk-cognitoidentityprovider` is deliberately NOT added** — every runtime interaction is plain OAuth REST over `reqwest`, which is already a dependency.
- **MAU billing note:** `AdminGetUser` marks a user active and bills them; `ListUsers` does not. Irrelevant to this feature (no admin APIs are called) but relevant if you poke at the pool while testing.

### UX / i18n Note (flag, do not resolve here)

No UX design specification covers this feature (epics-login.md § UX Design Requirements is intentionally empty of UX-DRs). This story has **no user-visible surface in the app**, but it fixes one thing users will see: **the Cognito-hosted sign-in page itself**, which is AWS-branded unless styled.

Two items for the Story 27.2 / 27.3 UX review — decide there, not here:

1. **Hosted-page branding.** With managed login (Essentials) a no-code branding editor is available; with the classic hosted UI only a logo + limited CSS. Applying nixus branding is optional and explicitly **not** required by any AC in this story.
2. **Hosted-page language.** Nixus ships EN + FR, but the sign-in page's language is Cognito's, not the app's. Localization exists **only** for managed login. Whatever is chosen in AC #2 determines whether a French user sees a French sign-in page — record the consequence so the UX review is informed rather than surprised.

### Secrets Handling

| Value | Secret? | Where it lives |
|---|---|---|
| Cognito region, domain prefix, User Pool id, app client id | **No** (public by design) | Committed: `commands/auth.rs` consts; ids also in Completion Notes |
| Google OAuth **client id** | No | Google Cloud + Cognito IdP config; may appear in Completion Notes |
| Google OAuth **client secret** | **YES** | Cognito IdP config in AWS **only**. Never in the repo, never in a story, never in a log |
| `access_token` / `id_token` / `refresh_token` | **YES** | OS keyring at runtime (Story 26.2). Never committed, never logged, never pasted into this story |
| Test user's password | **YES** | Nowhere. Use a throwaway account |

### References

- [Source: _bmad-output/planning-artifacts/epics-login.md — **Story 26.1 all ACs (lines 115-155)**, Epic 26 statement (lines 97-100, 111-113), § Requirements Inventory FR1-FR4 / NFR1-NFR4 (lines 31-42), § Additional Requirements (lines 46-65: no IaC line 47, no `aws-sdk-cognitoidentityprovider` line 49, PKCE + `state` line 50, Rust-only token exchange line 51, keyring sole-accessor line 52, non-secret config line 63, testing line 64, documentation obligation line 65), § UX Design Requirements (lines 69-77), § FR Coverage Map (lines 81-93), Stories 26.2-26.5 (lines 157-346) and 27.1-27.4 (lines 354-526) for the scope boundary]
- [Source: _bmad-output/planning-artifacts/architecture-login.md — § Feature Brief (17-24), § Project Context Analysis FR/NFR (30-40), § Starter Template Evaluation / Technology Additions (69-71), § Auth Flow Summary (79-82), **§ Authentication & Security (106-116: public client no secret, code+PKCE+`state`, Google social IdP, custom-scheme callback, token exchange endpoint, keyring shape, refresh, sign-out, profile from `id_token`, no backend component)**, § Frontend Architecture IPC surface (123-128), § Decision Impact Analysis Implementation Sequence step 1 (133), § Implementation Patterns (146-188), § Project Structure delta tree (194-227), § Architectural Boundaries (231-242), § File Organization Patterns (268-271: non-secret config placement, test organization), § Deferred Decisions (99-102), § Implementation Handoff / First Implementation Priority (363-372)]
- [Source: docs/project-context.md — §2 Tauri IPC conventions (not exercised here; no command added), §4 Rust model conventions, §5 `AppError`, §9 compilation-warnings policy, § Rust Backend Structure (`commands/{feature}.rs`), § Naming Conventions (Rust `snake_case` modules, `PascalCase` structs), § Anti-Patterns (leaving warnings)]
- [Source: docs/guidelines/warnings.md — all compilation warnings must be resolved; dead code is either removed or given an explicit ignore]
- [Source: apps/desktop/src-tauri/src/commands/mod.rs:1-20 — alphabetical `pub mod` list; `asset` line 2 / `backup` line 3 is the exact insertion point for `pub mod auth;`]
- [Source: apps/desktop/src-tauri/src/lib.rs:1-9 — private alphabetical `mod` block; unchanged by this story]
- [Source: apps/desktop/src-tauri/src/ai/mod.rs:33-45,54-55 — AWS region resolution: keyring first, then `std::env::var("AWS_REGION")`, hardcoded `"us-east-1"` default]
- [Source: apps/desktop/src-tauri/src/commands/settings.rs:31-32,71,84 — `aws_region` dual-written to keyring + SQLite `config`; the precedent this story deliberately does **not** follow]
- [Source: apps/desktop/src-tauri/src/ai/chat.rs:10, ai/trends_insight.rs:19-20, maintenance/catalog.rs:8-10, credentials.rs:3 — module-top `const` precedent for non-secret fixed values, including an external API base URL]
- [Source: apps/desktop/src-tauri/src/financial_health/constants.rs:1-26 — feature-scoped constants-module precedent (considered and set aside in favour of the sanctioned `commands/auth.rs`)]
- [Source: apps/desktop/src-tauri/Cargo.toml:21-43 — `tauri 2.11`, `reqwest 0.12` (`json`, `rustls-tls`, no default features), `keyring 4`, `keyring-core 1`, `tauri-plugin-opener 2`, `urlencoding 2`, `chrono 0.4` serde, `tokio 1.50` full; **no** `tauri-plugin-deep-link`, **no** `tauri-plugin-single-instance`, **no** AWS Cognito SDK]
- [Source: apps/desktop/src-tauri/tauri.conf.json:1-46 — `$schema` config/2, version `0.3.2`, identifier `com.nbazinet.nkbaz-finance`, `plugins` object containing only `updater` (26-33); untouched by this story]
- [Source: apps/desktop/src-tauri/capabilities/default.json:1-13 — permissions `core:default`, `opener:default`, `dialog:default`, `updater:default`, `process:default`; `deep-link:default` is Story 26.3's addition, not this story's]
- [Source: apps/desktop/src-tauri/src/error.rs:4-13,31-90 — `AppError` variants and hand-written `Serialize`; `recoverable` exists only on `AiService` today. `AppError::Auth` is Story 26.2]
- [Source: apps/desktop/src-tauri/src/credentials.rs:1-56 — sole keyring accessor, `KEYRING_SERVICE = "nkbaz-finance"`, inline account-name literals, `.ok()?` "missing == None" handling. Extended by Story 26.2, not here]
- [Source: CONTRIBUTING.md:260-283 — `## AI features (Finance module)` → `### Setup` env-var block: the exact precedent for documenting an out-of-band AWS dependency; :285 `## Project structure` is the insertion boundary; :196-197 `cd apps/desktop/src-tauri && cargo check`]
- [Source: .github/workflows/release.yml — Tauri build via `tauri-action`, injects only `TAURI_SIGNING_*`; no Rust `cargo check`/`cargo test` step exists in CI, so the zero-warning gate is manual]
- [Source: .github/workflows/web-ci.yml — `Configure AWS credentials` deploy step (`aws-region: us-east-1`) is the repo's existing AWS-secret-injection convention; unchanged by this story]
- [Source: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html — callback URLs must be absolute, pre-registered, fragment-free; HTTPS required except `http://localhost`; custom schemes such as `myapp://example` supported; `create-user-pool-client --no-generate-secret --allowed-o-auth-flows code --allowed-o-auth-scopes openid email profile --allowed-o-auth-flows-user-pool-client --supported-identity-providers`]
- [Source: https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html — `/oauth2/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256`]
- [Source: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html — `UserPoolTier`, default Essentials for new pools; managed login Essentials+; classic hosted UI all tiers]
- [Source: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html — branding version per domain (Managed login vs Hosted UI (classic)); prefix domain up to 60s, custom domain up to 5 min, branding switch up to 4 min and invalidates sessions; SDK-created app clients need `CreateManagedLoginBranding`; localization is managed-login-only]
- [Source: https://aws.amazon.com/cognito/pricing/ — 10,000 MAU/month free tier for Lite and Essentials (none for Plus); refresh-token rotation is Essentials+; MAU counted on sign-in/sign-up/token refresh/`AdminGetUser`]
- [Source: https://docs.aws.amazon.com/cognito/latest/developerguide/tutorial-create-user-pool-social-idp.html and .../cognito-user-pools-identity-provider.html — Google authorized origin `https://<domain>` and redirect URI `https://<domain>/oauth2/idpresponse`; Google scopes are space-separated; the IdP must be added to the app client to appear on the login page]
- [Source: https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html — `logout_uri` must be a registered sign-out URL for the app client (why `nixus://auth/signout` is registered now even though v1 never calls `/logout`)]
- [Source: tauri-apps/tauri crates/tauri-utils/src/config.rs — config structs use `#[serde(rename_all = "camelCase", deny_unknown_fields)]`, so unknown `tauri.conf.json` keys are a build failure]

## Dev Agent Record

### Agent Model Used

amazon-bedrock/us.anthropic.claude-opus-5

### Debug Log References

- `cd apps/desktop/src-tauri && cargo test` — **baseline before any edit: 285 passed, 0 failed.**
- `cargo check --all-targets` with **no** `#[allow(dead_code)]` attributes — **7 warnings**, one `constant \`X\` is never used` for each of the seven consts (`COGNITO_REGION`, `COGNITO_CUSTOM_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_HOSTED_UI_BASE_URL`, `COGNITO_REDIRECT_URI`, `COGNITO_SIGNOUT_URI`, `COGNITO_SCOPES`). This empirically confirms § Dead Code: `mod commands;` is private in `lib.rs:3`, so unreferenced `pub` items still warn, and `#[cfg(test)]` usage does **not** suppress it.
- `cargo check --all-targets` after adding one targeted `#[allow(dead_code)]` per const — **zero warnings**.
- `cargo test` final — **289 passed, 0 failed** (285 baseline + 4 new). The four new tests: `commands::auth::tests::hosted_ui_base_url_matches_custom_domain`, `redirect_and_signout_uris_use_the_nixus_scheme`, `scopes_include_openid_email_and_profile`, `client_id_is_populated`.
- Byte-for-byte proof that Story 26.3's code was not disturbed: `sed -n '36,55p' commands/auth.rs` diffed against the pre-edit file content → **identical** (imports, doc comment, function body, and the `info!` line unchanged).
- `git diff commands/mod.rs` → a single added line, `pub mod auth;`, which is **Story 26.3's** change, not this story's. This story edited that file **zero** times.

### Completion Notes List

#### AC 13 — Provisioned resource identifiers (no secrets)

| Item | Value |
|---|---|
| AWS account | nixus account (id not recorded — not required, "nixus prod account" per AC 13) |
| Region | `us-east-1` |
| User Pool id | `us-east-1_7gfGQ0emg` |
| User Pool name | not separately recorded by the user; the pool is uniquely identified by the id above |
| Hosted domain (**shipped**) | **custom** domain `auth.nixusapp.com` → `https://auth.nixusapp.com` (Route53 zone owned by the user + own ACM cert) |
| Hosted domain (fallback, live but unused) | prefix domain `us-east-17gfgq0emg.auth.us-east-1.amazoncognito.com` |
| App client id | `6525109r95las7odvuesf13joj` — **public client, no client secret** |
| App client name | not separately recorded; uniquely identified by the id above |
| Callback URL | `nixus://auth/callback` (the only one) |
| Sign-out URL | `nixus://auth/signout` (the only one) |
| Scopes | `openid email profile` |
| Issuer | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_7gfGQ0emg` |
| JWKS URL (for a future signature-verification story) | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_7gfGQ0emg/.well-known/jwks.json` |
| Feature plan | **INFERRED, not confirmed** — see deviation (j) |
| Branding version | **INFERRED** managed login — see deviation (j) |
| Access / id token validity | `expires_in` **3600s** observed in the live token response |
| Refresh token validity | **not independently verified** — see deviation (k) |
| CloudFront distribution backing the custom domain | `d1k3sg9okg95oo.cloudfront.net` (AWS-managed, $0 — see deviation (e)) |
| TLS certificate | CN `nixusapp.com`, valid through 2027-02-23, curl-verified for `auth.nixusapp.com` |
| Google Cloud project / OAuth client id | **none — never created.** Google is deferred, see deviation (d) |

**No secret appears above or anywhere in this story**: no Google client secret (none exists), no token value, no authorization code, no password.

#### Deviations and limitations

**(a) Custom domain instead of a Cognito prefix domain — approved user decision, not a defect.**
The story spec (§ Decisions Resolved Here, AC 3) assumed a prefix domain `nixus-auth.auth.us-east-1.amazoncognito.com`. The user instead provisioned a **custom** domain, `auth.nixusapp.com`, on a Route53 hosted zone they own with their own ACM certificate, to get a **branded sign-in page** on the product's own domain. A prefix domain (`us-east-17gfgq0emg.auth.us-east-1.amazoncognito.com`) is also live but unused. **Affects AC 3 and AC 7.** Consequence for code: `COGNITO_HOSTED_UI_BASE_URL` cannot be composed from prefix + region, so `COGNITO_DOMAIN_PREFIX` became `COGNITO_CUSTOM_DOMAIN` — see (c).

**(b) AC 3's verification command is unsatisfiable as written.**
`curl https://auth.nixusapp.com/.well-known/openid-configuration` returns **404**, and so does the same path on the prefix domain — **neither** Cognito hosted-UI domain serves an OIDC discovery document; only the `cognito-idp` identity-provider endpoint does. Verified instead by two other means:
1. The canonical discovery document `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_7gfGQ0emg/.well-known/openid-configuration`, which reports `authorization_endpoint: https://auth.nixusapp.com/oauth2/authorize` — i.e. Cognito itself confirms the custom domain is the pool's authorization host — and the expected issuer.
2. A live `GET /oauth2/authorize` probe against the custom domain, returning `302 → /login` and then `200` with a rendered sign-in page.
The *intent* of AC 3 (prove the domain is live and is the pool's authorization host) is satisfied; the *literal command* is not and cannot be.

**(c) `COGNITO_DOMAIN_PREFIX` replaced by `COGNITO_CUSTOM_DOMAIN`; drift-guard test renamed.**
The story's literal const block and its `hosted_ui_base_url_matches_prefix_and_region` test are unsatisfiable under (a). Replaced by `COGNITO_CUSTOM_DOMAIN` and `hosted_ui_base_url_matches_custom_domain`, which preserves the **identical drift-guard purpose** — the composed URL const still cannot silently disagree with its parts — and adds a trailing-slash assertion. The other three tests are byte-for-byte as specified. **Affects AC 7 and AC 8.**

**(d) Google social IdP DEFERRED by user decision — AC 4 and AC 10 are NOT met.**
A Google Cloud OAuth client was **never created**, so no Google IdP exists on the pool. `Google` was briefly ticked on the app client, which rendered a "Continue with Google" button that **failed on click** with `errorMessage="Login option is not available. Please try another one"` — the expected response when an app client lists a provider the pool does not have. The user is un-ticking `Google`: a visible button that always errors is worse than no button. **Consequence: AC 5's `SupportedIdentityProviders` is `COGNITO` only, not `COGNITO` + `Google`.** Also appended to `_bmad-output/implementation-artifacts/deferred-work.md` with the full re-enablement checklist.

**(e) AC 11 zero-new-compute proof could NOT be run via CLI.**
There are no working credentials for this account on this machine, so the six `aws` commands in § Zero-New-Compute Proof were **not executed**. Recorded instead from the Console/provisioning process: **no Lambda, no API Gateway (REST or HTTP), no DynamoDB table, and no Cognito Identity Pool** were created for this feature. The new resources are one Cognito **User Pool**, one custom domain, and one public app client.
**Honest caveat:** the Cognito **custom domain** provisions an **AWS-managed CloudFront distribution** (`d1k3sg9okg95oo.cloudfront.net`). This is inherent to the custom-domain feature, costs $0, is not user-managed, and is **not** one of the four resource types AC 11 forbids — but it *is* a new AWS resource that would not exist had a prefix domain been used, so it is disclosed rather than glossed over. NFR3's intent (no new compute to operate, patch, or pay for) holds.

**(f) AC 9 manual end-to-end verification PASSED (email/password).**
PKCE `code_challenge_method=S256`, no client secret. `POST /oauth2/token` returned `200` with keys **exactly** `['access_token','expires_in','id_token','refresh_token','token_type']` — `refresh_token` is **PRESENT**, which is the precondition for Story 26.5's `grant_type=refresh_token` and for Story 26.2's non-optional `refresh_token: String` field. `expires_in` = 3600, `token_type` = Bearer. `id_token` claim **names** present: `at_hash, aud, auth_time, cognito:username, email, email_verified, event_id, exp, iat, iss, jti, origin_jti, sub, token_use`. `aud` == the app client id: **true**. `iss` matched the pool issuer. **Claim names only — no token value, code, or password is recorded here or anywhere in the repo.**

**(g) The `name` claim is MISSING for email/password users — expected and correct.**
The pool's only required attribute is `email`, so sign-up never collects a name and no `name` attribute exists to release, regardless of the `profile` scope. § Manual End-to-End Verification explicitly predicts this. This is precisely why Story 26.2 models `name` as `Option<String>` and why Story 27.3 AC 5 handles email-only degradation — in v1 that degradation path is now the **only** path, not an edge case.

**(h) No temporary `http://localhost` callback was ever registered — AC 6 satisfied by construction.**
The `302 Location:` capture method was used, as § Manual End-to-End Verification prefers. There was therefore nothing to remove in subtask 2g.

**(i) UNVERIFIED — whether `name` and `email` are in the app client's read attributes (AC 6).**
This could **not** be confirmed. With `email` as the only required attribute and Google deferred, **no user carrying a `name` attribute exists**, so the absence of the `name` claim cannot distinguish "no name is stored" from "the read attribute was not granted". Moot for v1 (nothing consumes `name`), but it **must be re-checked when Google federation is enabled**, or a federated user's name will silently fail to appear. Flagged in `deferred-work.md`.

**(j) UNVERIFIED — feature plan (Essentials vs Lite) and branding version (AC 2).**
Neither was explicitly confirmed by the user. **Managed login was OBSERVED**: `/oauth2/authorize` `302`s to `/login`, and the page is JS-driven, ~33KB, `<title>Sign-in</title>` — which *implies* Essentials + managed login, since managed login is Essentials-and-above only. Recorded as **INFERRED, NOT CONFIRMED** rather than asserted. If it is actually **Lite**, then AC 2's fallback clause applies and login-page localization + refresh-token rotation are unavailable — which matters for the EN/FR sign-in page question flagged to Story 27.2/27.3.

**(k) Token validity partially verified (AC 5).**
Access/id token `expires_in` **observed as 3600s** in the live response. **Refresh-token validity and the refresh-token-rotation-disabled status were NOT independently verified** from the Console. Per § Known v1 Limitations item 2, if refresh validity is the 30-day default, a user who does not open Nixus for 30+ days lands in `SessionExpired`; raising it (max 3650 days) is a one-field app-client change needing no code change.

#### § Known v1 Limitations accepted (unchanged, recorded per subtask 5c)

1. **No automatic account linking** — currently moot because Google is deferred (only one identity provider exists, so there is nothing to link). Becomes live the day Google federation is enabled: same email via two providers = two distinct `sub`s, and `sub` is the durable identity key (NFR4).
2. **Refresh window** — see deviation (k); value not confirmed.
3. **Cognito's default email sender** was used for the sign-up verification code (low daily quota, generic `no-reply@verificationemail.com`). Adequate for pre-alpha; SES is a later ops task.
4. **Google consent-screen mode** — N/A, no Google OAuth app exists (deviation (d)).
5. **No token signature verification** in Story 26.5 — accepted; the JWKS URL is recorded in the AC 13 table so it can be composed later.
6. **No `/oauth2/revoke` on sign-out** and **refresh-token rotation disabled** — deferred per architecture-login.md; rotation status unconfirmed, see (k).

#### Scope discipline notes

- **`commands/mod.rs` was NOT edited.** `pub mod auth;` was already at line 3 (Story 26.3), alphabetically between `asset` and `backup` exactly as AC 7 requires. The § PREREQUISITE GATE's SOFT outcome applied: leave it, do not add a second line (which would be a duplicate-definition compile error).
- **`commands/auth.rs` already existed** (Story 26.3's `dispatch_deep_link_url`). Per the gate's SOFT outcome the const block was **prepended** and the test module **appended**; the existing function, its doc comment, its `use` statements, and its `info!` line are byte-for-byte unchanged (proof in Debug Log).
- **Zero files outside this story's scope were touched.** No `lib.rs`, `error.rs`, `models/mod.rs`, `credentials.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, or `package.json` change. `generate_handler!` remains at **95** entries — this story registers no Tauri command. No dependency added. No IaC added. Version stays `0.3.2`. `architecture-entitlements-licensing.md` untouched (that amendment is Story 27.4's, per AC 12).
- **`#[allow(dead_code)]` was determined empirically, not copied.** With no allows, all seven consts warned (see Debug Log), so one targeted allow with a `// WHY:` comment naming the consuming story was added per const — never a blanket `#![allow(dead_code)]`. This matches `docs/guidelines/warnings.md` and the story's § Dead Code prediction.
- **CONTRIBUTING.md deviation from the § Documentation Obligation draft:** the draft's sentence *"The only secret involved is Google's OAuth client secret, which lives solely in the Cognito identity-provider configuration in AWS"* was **omitted**, because Google is deferred and no Google OAuth client secret exists — shipping that sentence would have documented a secret that does not exist. The section also says "email/password" rather than "email/password or Google", and notes Google sign-in is deferred.
- **Nothing from Stories 26.4 / 26.5 was implemented**: no `start_login`, no `handle_auth_callback`, no PKCE code, no `reqwest` call, no keyring access, no `#[tauri::command]`.

### File List

| File | Change |
|---|---|
| `apps/desktop/src-tauri/src/commands/auth.rs` | Modified — 7 non-secret Cognito `pub const`s + header comment **prepended** above `dispatch_deep_link_url`; `#[cfg(test)] mod tests` with 4 drift-guard tests **appended** at end of file |
| `CONTRIBUTING.md` | Modified — new `## Account sign-in (Cognito)` section inserted between the AI-features section and `## Project structure` |
| `_bmad-output/implementation-artifacts/deferred-work.md` | Modified — appended the Google social IdP deferral (AC 4 / AC 10 unmet) with evidence and a re-enablement checklist |
| `_bmad-output/implementation-artifacts/26-1-cognito-user-pool-and-public-app-client-setup.md` | Modified — task checkboxes, Dev Agent Record, File List, Change Log, Status → review |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Modified — `26-1-…` → `review` |

*Not modified, deliberately:* `apps/desktop/src-tauri/src/commands/mod.rs` (`pub mod auth;` already present from Story 26.3 — verified only).

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-09 | Story created from epics-login.md § Story 26.1 + architecture-login.md | create-story |
| 2026-08-09 | Tasks 0-2 (AWS provisioning + manual end-to-end verification) completed out-of-band in the AWS Console by the user; verified against live public endpoints | user |
| 2026-08-09 | Tasks 3-5: recorded the non-secret Cognito config as 7 `pub const`s + 4 drift-guard tests in `commands/auth.rs`, documented it in `CONTRIBUTING.md`, recorded the Google deferral in `deferred-work.md`. `cargo check --all-targets` zero warnings; `cargo test` 289 passed / 0 failed. Adapted for a custom domain instead of a prefix domain (approved deviation); Google IdP deferred, so AC 4 and AC 10 are unmet | dev-story |
