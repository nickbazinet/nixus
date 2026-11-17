---
title: 'Implementation Plan — Nixus Cloud Profile & Web Account'
date: 2026-11-17
spine: ARCHITECTURE-SPINE.md
status: final
---

# Implementation Plan — Nixus Cloud Profile & Web Account

The binding rules are in [ARCHITECTURE-SPINE.md](ARCHITECTURE-SPINE.md) (AD-1 to AD-17). This plan orders the work. The next step is `bmad-create-epics-and-stories`, which turns each epic below into stories.

## Order

```
Phase 0 ──► A ──┬─► B ──┬─► E ──► G
                ├─► C ──┤
                └─► D ──┘
Phase 0 + B ──► F ──────────────► G
```

- Once A is done, B, C and D can run in parallel.
- F needs B and the hosting spike from Phase 0.
- E needs B, C and D.
- G comes last and closes the rollout.

## Phase 0 — Prerequisites and hosting spike (owner, one-time)

- Confirm `api.nixusapp.com` uses an API-mapping routing mode (`aws apigatewayv2 get-domain-name`).
- Add the `nixus-api/profile` scope to the `nixus-api` resource server: read the current scopes (`DescribeResourceServer`), merge, then submit the full list. Confirm `ai.invoke` and `profile` both exist.
- Create the SSM `SecureString` path for the web client secret.
- Write and apply the `nixus-account` OIDC bootstrap from a workstation.
- **Spike:** a TanStack Start app (`~1.167.65`, Vite 7) built as a plain Node server, running on a Lambda Web Function behind CloudFront OAC. It must prove that a 302 redirect, a `__Host-` `Set-Cookie` and a server-function `POST` all work.
- **Exit:** spike passes, both scopes verified, bootstrap role exists.

## Epic A — Shared contract and reference data

- **Contract:** create `packages/shared/src/types/account.ts`. It covers the profile, avatar, locations, bracket and currency allow-lists, and the closed error union (AD-13).
- **ISO dataset:** move it to `packages/shared/data/iso3166.json` and point Rust's `include_str!` at it.
- **Tests:** an allow-list parity test against `profile_store::VALID_INCOME_BRACKET_CURRENCIES`, and a check that no second ISO copy exists.
- **Depends on:** nothing.

## Epic B — Profile API (`apps/api-account`, stack `nixus-account`)

- **SAM template:**
  - Regional REST API with a Cognito authorizer requiring `nixus-api/profile`.
  - `ApiGatewayV2::ApiMapping` with key `v1/profile`.
  - Profile table with PITR and `Retain`.
  - Log groups with 14-day retention, 5xx and throttle alarms, and a $10/month budget.
  - Every `GatewayResponses` type listed in AD-13.
- **Lambda (Node 24):**
  - Routes: `GET /`, `PUT /`, `GET /avatar`, `PUT /avatar`, `GET /locations`.
  - Server-side validation (AD-5).
  - `expected_version` concurrency, with `version_conflict` carrying the resource and current version (AD-4).
  - The `sub` must have a UUID shape before any key is built.
- **CI:** `account-ci.yml` (PR verify; deploy on `master` through `production`).
- **Gates:** API cross-account test; scope tests in both directions; `/v1/ai/status` still reaches Bedrock after deploy; contract tests.
- **Depends on:** Phase 0, A.

## Epic C — Desktop identity and client plumbing

- **Token accessor:** one scope-verifying accessor in `commands/auth.rs`. It replaces `hosted_ai_token` and `refresh_hosted_ai_token`, and never narrows a stored token.
- **Scopes:** add `nixus-api/profile` to `COGNITO_SCOPES`.
- **Network module:** one cloud profile client module, added to the `cloud_link.rs` network allowlist.
- **Errors:** `AppError::CloudProfile`, plus one narrowing in `appError.ts`.
- **API URL:** the override exists only under `debug_assertions`; release builds hard-code the production URL.
- **Gates:** token keeps `ai.invoke` after a profile refresh; allowlist test; release build has no override.
- **Depends on:** A.

## Epic D — Desktop profile homes

- **Cloud copy file:** `version` and `upload_declined` are optional fields with serde defaults; `schema_version` stays 1.
- **Legacy probe:** a raw, non-mutating probe that never quarantines a file.
- **Local profiles:** a `profiles/local/<dataset-id>.json` store.
- **Resolver:** returns a source token; the local branch never touches the session, and the cloud branch requires `is_signed_in`.
- **`/profile`:** branches on dataset kind first. Local profiles can edit with no session, and the menu entry is visible for them.
- **Cleanup:** `delete_dataset_at` removes the local document, and a launch sweep removes orphans.
- **Delete-all:** follows the AD-7 matrix. The cloud profile is kept, and only the active profile's local document is removed.
- **Avatar cache:** `avatars.db` gains a `version` column.
- **Gates:** legacy-document survival; delete-all matrix; desktop cross-account test; orphan sweep.
- **Depends on:** A.

## Epic E — Desktop ↔ cloud profile

- **Refresh:** runs in Rust when a cloud-linked profile opens, when the Profile page opens, and after each save. Never from an always-mounted component.
- **Save:** server confirmation first, then the local copy is rewritten. An unobserved response is resolved by a GET and comparison.
- **Missing scope:** the Profile page shows a re-sign-in state. Offline, Save is disabled.
- **Legacy upload:** the consent prompt (AD-8).
- **Avatar:** fetched only when `avatar_version` changes.
- **Gate:** a session with only `ai.invoke` shows re-sign-in, then the upload prompt after signing in again.
- **Depends on:** B, C, D.

## Epic F — Web account app (`apps/account`, `account.nixusapp.com`)

- **Hosting:** CloudFront in front of a Lambda Web Function, with static assets from S3.
- **Cognito:** a confidential web client plus `ManagedLoginBranding`; the client secret is read from SSM.
- **Sign-in and session:**
  - `state`, `nonce` and PKCE verifier in a single-use pre-auth record.
  - A new session id is minted at sign-in.
  - Idle and absolute expiry are checked in code on every request.
  - Only allow-listed redirect destinations.
  - Sign-out revokes only this session's token and never signs out the desktop.
- **Pages:** view and edit the profile; avatar upload (the browser makes the 256 px derivative); country list from `/locations`.
- **Language and copy:** EN/FR with `/fr` routes, and a notice on the form that the profile is stored in the user's Nixus Cloud account.
- **Marketing site:** add a Sign-in link to `account.nixusapp.com`.
- **Gates:** login-CSRF, session fixation, open-redirect, and expired-but-present session tests.
- **Depends on:** the Phase 0 spike, A, B.

## Epic G — Disclosure and rollout

- **Public docs:** update the README, Privacy Policy and Terms.
- **In-app copy:** rewrite `profile.signInRequiredBody` and `profile.avatar.hint` in EN and FR, and write the delete-all confirmation text ("your Nixus Cloud profile is not deleted").
- **Supersession notes:**
  - `architecture-entitlements-licensing.md`
  - `architecture-user-profile.md`
  - the sync spine
  - `architecture-web.md`
- **Release:** sign off all AD-15 gates. Ship the desktop release only after B is deployed.
- **Depends on:** E, F.

## Out of scope

Billing and payments (own spine), mobile purchases, Nixus Cloud account deletion, WAF, avatars for local profiles. See the spine's Deferred section.
