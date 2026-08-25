---
review: technology-currency
target: '../ARCHITECTURE-SPINE.md'
companion: '../../../architecture-cloud-bedrock.md'
reviewed: '2026-08-25'
verdict: CHANGES REQUIRED
method: 'Every named technology, version, API, quota, price and repo convention checked against current official AWS/vendor documentation or live repository reality. No claim accepted on training data.'
---

# Technology Currency Review — Nixus Cloud Bedrock spine

## Verdict

**CHANGES REQUIRED.** The architecture is technically sound and unusually well-grounded — the two hardest calls (Regional REST + `ResponseTransferMode` streaming, and the `us.` cross-Region inference profile) are not only correct, they are *necessary*, and the docs prove it. But eight named claims are wrong, stale, internally contradictory, or contradict live repository code. Three are load-bearing enough to break the build or silently violate a stated NFR:

1. The IAM grant names `dynamodb:TransactWriteItems`, which is not how DynamoDB transactions are authorized.
2. AD-11's content-statelessness invariant is unachievable as written, because the chosen cross-Region inference profile explicitly may store prompts and outputs in destination Regions for abuse detection.
3. AD-10 mandates a 120-second refresh skew that directly overrides a deliberate, documented "no clock-skew buffer" decision in the live `commands/auth.rs` — and the spine presents it as if inherited rather than as a change.

None of these invalidate the paradigm or any AD's intent. All are correctable in place.

---

## 1. Verification matrix

| # | Claim (spine / companion) | Verdict | Evidence |
|---|---|---|---|
| 1 | API Gateway **REST** API supports Lambda response streaming; HTTP API does not | **CONFIRMED** | "Response streaming is only supported for REST APIs." "Response streaming works for all REST API endpoint types." [S1] |
| 2 | Streaming works on a **Regional** endpoint | **CONFIRMED** | All REST endpoint types supported; Regional/private idle timeout 5 min (edge-optimized only 30 s) [S1] |
| 3 | Streaming lets the design exceed the 29 s integration timeout (justifying a 300 s Lambda) | **CONFIRMED** | Use case: "Exceed API Gateway's 29 second timeout limit without requesting an integration timeout limit increase"; "You can stream your response for up to 15 minutes." [S1] |
| 4 | `AWS_PROXY` integration required | **CONFIRMED** | "You can only use response payload streaming for `HTTP_PROXY` or `AWS_PROXY` integration types." [S1] |
| 5 | SAM property spelling `ResponseTransferMode: RESPONSE_STREAM` (AD-2) | **CONFIRMED** | SAM `Api` event source, *Valid values*: `BUFFERED \| RESPONSE_STREAM` [S3] |
| 6 | Stack Seed spelling `ResponseTransferMode=STREAM` | **CONTRADICTS #5** — see Finding F5 | API Gateway developer guide uses `STREAM` [S1]; SAM uses `RESPONSE_STREAM` [S3]. Spine states both as one thing. |
| 7 | Cognito user-pool authorizer on REST API validates the token and injects verified `sub` | **CONFIRMED** | `COGNITO_USER_POOLS` authorizer; claims exposed to the integration via `$context.authorizer.claims.sub` [S4][S5] |
| 8 | Access token carrying custom resource-server scope is the enforcement mechanism | **CONFIRMED, with an unstated prerequisite** — see F6 | "If you do not configure any **Authorization scopes**, API Gateway treats the supplied token as an identity token." Scope match → success, else `401 Unauthorized`. [S5] |
| 9 | Scope string form `nixus-api/ai.invoke` | **PLAUSIBLE, unverified locally** | Scopes are given as full names (`resource-server-identifier/scope-name`); AWS's example is `https://my-petstore-api.example.com/cats.read` [S5]. Valid iff the resource server identifier is literally `nixus-api`. No such resource server exists yet — see F7. |
| 10 | Node.js 22, ARM64 Lambda is current and supported | **CONFIRMED but no longer the newest LTS** — see F8 | `nodejs22.x` on AL2023, deprecation **Apr 30 2027**. `nodejs24.x` GA (deprecation Apr 30 2028); `nodejs26.x` in public preview. "All supported Lambda runtimes support both x86_64 and arm64." [S2] |
| 11 | Model `us.anthropic.claude-sonnet-4-6` is a valid cross-Region inference profile in `us-east-1` | **CONFIRMED — and mandatory** | Geo inference ID `us.anthropic.claude-sonnet-4-6`; `us-east-1` In-Region = **not supported**, Geo = supported. Destinations from `us-east-1`: `us-east-1`, `us-east-2`, `us-west-2`. Model lifecycle **Active**, EOL N/A. [S6] |
| 12 | Model is one generation behind current | **TRUE** (advisory) | Current Sonnet on Bedrock is `anthropic.claude-sonnet-5`; Sonnet 4.6 is listed under "Legacy models (still available)". [S7][S8] |
| 13 | `ConverseStream` is the right API for this model | **CONFIRMED** | Sonnet 4.6 `bedrock-runtime`: Converse ✅, Invoke ✅, Messages ❌. Response streaming ✅. [S6] |
| 14 | Diagram labels the call `InvokeModelWithResponseStream` while AD-5/AD-7 say `ConverseStream` | **INTERNALLY INCONSISTENT** — see F4 | Both names are used for the same call across spine + companion. |
| 15 | IAM action `bedrock:InvokeModelWithResponseStream` authorizes the streaming call | **CONFIRMED** | `bedrock:InvokeModel` / `InvokeModelWithResponseStream` are the inference actions; "Other actions, such as `Converse` … are blocked automatically when `InvokeModel` is denied." [S9] |
| 16 | Cross-Region profile needs both the inference-profile ARN **and** destination foundation-model ARNs | **CONFIRMED — and the spine under-specifies it** — see F3 | Least-privilege example grants both `…::foundation-model/*` and `…:inference-profile/*`; cross-Region guidance: allow the inference actions "in all destination Regions included in your chosen inference profile". [S9][S10] |
| 17 | AD-8 output ceilings (4096 / 8192 / 1024) are within model limits | **CONFIRMED** | Sonnet 4.6 max output 64K tokens. [S6] |
| 18 | `TransactWriteItems` can atomically re-check `CONFIG` and conditionally increment `USAGE#` | **CONFIRMED** | Up to 100 distinct items; `ConditionCheck` + `Update` allowed; **serializable** isolation vs. `GetItem`/`UpdateItem`; distinct items required (CONFIG ≠ USAGE, so legal). [S11] |
| 19 | Distinguishing `403 premium_required` from `429 quota_exhausted` from one transaction is feasible | **CONFIRMED** | `TransactionCanceledException` carries `CancellationReasons` "ordered according to the list of items in the `TransactItems` request parameter". [S11] |
| 20 | AD-5 "prevents … double-charging" | **INCOMPLETE** — see F2 | `TransactWriteItems` is idempotent **only** when a client token is supplied; "default SDK behavior is to retry transactions". Design explicitly forbids using `client_request_id` for idempotency. [S11] |
| 21 | IAM grant `dynamodb:GetItem`/`TransactWriteItems`/`UpdateItem` | **WRONG ACTION NAME** — see F1 | AWS's canonical CRUD least-privilege policy enumerates `ConditionCheckItem`, `UpdateItem`, `PutItem`, `GetItem` … and **no** `TransactWriteItems`. [S12] |
| 22 | DynamoDB on-demand + transactions cost is negligible at beta scale | **CONFIRMED, with a caveat worth stating** | "DynamoDB performs two underlying reads or writes of every item in the transaction"; capacity "is consumed even when a transaction does not succeed" — so a rejected quota check still bills. [S11] |
| 23 | API Gateway REST: **$3.50 per million requests** in `us-east-1` | **CONFIRMED** | Pricing example: "5 million * $3.50/million"; tiering to $2.80 after 333M. [S13] |
| 24 | "$0 minimum/idle charge" | **CONFIRMED** | "you only pay when your APIs are in use. There are no minimum fees or upfront commitments." [S13] |
| 25 | "plus … streaming-specific charges" | **IMPRECISE** — see F9 | Streaming billing = `roundUp(payload / 10 MB)` billable requests, min 1. At chat scale (≈16 KB) that is exactly 1 request: "The customer benefits from streaming responses with no additional cost beyond standard request and data transfer charges." [S13] |
| 26 | Bedrock token pricing deliberately not fixed in the doc | **CORRECT PRACTICE** | Confirmed dynamic; per-model card defers to the pricing page. [S6] |
| 27 | `aws-actions/configure-aws-credentials@v4` | **STALE** — see F10 | Latest release **v6.2.3**, published 2026-07-22. v4 is two majors behind. [S14] |
| 28 | `web-ci.yml` establishes the GitHub Actions precedent, incl. `configure-aws-credentials@v4` in `us-east-1` | **CONFIRMED in repo** | `.github/workflows/web-ci.yml:131` uses `aws-actions/configure-aws-credentials@v4`; deploy job gated to push on `master`/`main`; job is self-labelled `"Deploy (stub)"`. |
| 29 | The licensing bridge's deploy posture is manual `sam deploy` (AD-12's stated divergence) | **CONFIRMED in doc; the service itself does not exist** | `architecture-entitlements-licensing.md:171` "manual `sam deploy` for now"; `:90` "AWS SAM (TypeScript, Node.js 22, ARM64)". No `apps/api-licensing/` and no `template.yaml` anywhere in the repo. |
| 30 | Repo convention: package scope `@nixus/` | **CONFIRMED** | `@nixus/desktop`, `@nixus/web`, `@nixus/shared`; `pnpm-workspace.yaml` globs `apps/*`, `packages/*`. |
| 31 | Repo convention: `packages/shared/src/types/` | **CONFIRMED** (contains only `api-error.ts`; `cloud-ai.ts` is new, as stated) | — |
| 32 | Repo convention: `apps/*` top-level deployables | **CONFIRMED** — `apps/desktop`, `apps/web` only | No AWS SAM app exists in the repo today. `template.yaml` / `template.yml`: **zero files.** |
| 33 | Repo convention: `AppError` is the only error shape | **CONFIRMED** | `apps/desktop/src-tauri/src/error.rs:5`; sole error-shaped enum in `src/`; `thiserror` appears only in `Cargo.lock` transitives. |
| 34 | Repo convention: `credentials.rs` is the sole keyring accessor | **CONFIRMED with one documented exception** — see F11 | 17 `Entry::new(...)` calls in `credentials.rs`; `lib.rs:79` `keyring::use_native_store(false)` is the one other keyring touch. |
| 35 | Companion enforcement rule "never call `keyring_core::Entry`" | **WRONG CRATE PATH** — see F11 | Live code uses the `keyring` crate (`keyring::Entry`, `keyring::use_native_store`). `keyring_core` is not what the codebase uses. |
| 36 | AD-10: access token "refreshed with a 120-second skew" | **CONTRADICTS LIVE CODE** — see F12 | `commands/auth.rs:757-761` documents the opposite as a deliberate decision: "there is no … clock-skew buffer either"; `is_session_expired` is `now_unix >= expires_at`. No `skew`/`120` constant exists. |
| 37 | Repo convention: snake_case wire JSON | **CONFIRMED** | `#[tauri::command(rename_all = "snake_case")]` across `commands/*.rs`; one documented exception (`AuthState` uses `#[serde(tag = "status")]` with PascalCase variants). |
| 38 | Repo convention: Vitest | **CONFIRMED** | `vitest ^3.2.4` + `vitest.config.ts` in all three packages. |
| 39 | Repo convention: Node.js 22 | **NOT a repo-wide convention** — see F8 | `release.yml:48` node 22; `web-ci.yml:55,121` node **20**. No root `engines`, no `.nvmrc`, no Volta. |
| 40 | `docs/project-context.md` supplies the Node 22 / ARM64 / SAM cloud conventions | **FALSE as the companion frames it** | Zero matches for "Node.js 22", "ARM64", "AWS SAM", "nodejs22" in `docs/project-context.md`. The spine attributes them correctly (to `architecture-entitlements-licensing.md`); the companion's Related-Documents framing blurs it. |
| 41 | The four live AI surfaces exist and are per-surface concrete clients (no port) | **CONFIRMED** | `ai/chat.rs` (`ConverseStream`), `ai/project_advice.rs`, `ai/trends_insight.rs`, `ai/cc_parser.rs`. |
| 42 | `AiBackend` / `hosted_state.rs` / `HostedAiState` exist today | **DO NOT EXIST** — correct as spine targets, **false as companion NFR5 states** — see F13 | Zero matches in any `.rs` file. Companion NFR5 says "the existing `AiBackend`-shaped routing". |
| 43 | Operation enum names match live surfaces | **3 of 4** — see F14 | `chat`, `project_advice`, `trends_insight` exist as real surfaces; the statement-import surface is `cc_parser`, not `statement_import`. |
| 44 | `nixus://auth/callback` is fallback plumbing (spine Deferred item) | **CONFIRMED ACCURATE** | `architecture-login.md:383` "Amended: the OAuth redirect target is now `http://127.0.0.1:52847/callback` … not `nixus://auth/callback`"; `:392` it "is still recognized … as a fallback shape". |
| 45 | `architecture-login.md` already defines a resource server / custom scopes | **NOT CLAIMED, and it does not** — see F7 | No resource server or custom scope concept appears in `architecture-login.md`. Spine's "adds a scope, not a second identity system" is accurate; the *resource server itself* must also be created. |
| 46 | `architecture.md` is stale/historical | **CONFIRMED** | `architecture-login.md:24` "contains a stale, never-implemented Cognito + DynamoDB + Stripe design coupled to licensing — superseded". |

---

## 2. Findings

Ordered by consequence. Each carries the exact correction.

### F1 — CRITICAL: `dynamodb:TransactWriteItems` is not an IAM action; the Lambda role as written cannot reserve quota

**Where:** spine Conventions ("IAM: … `GetItem`/`TransactWriteItems`/`UpdateItem` on the one table"), AD-6, companion "IAM scoping".

DynamoDB transactions are authorized by the **underlying item-level actions**, not by a `TransactWriteItems` action. AWS's own least-privilege CRUD policy for a table enumerates `BatchGetItem`, `BatchWriteItem`, **`ConditionCheckItem`**, `PutItem`, `DescribeTable`, `DeleteItem`, `GetItem`, `Scan`, `Query`, `UpdateItem` — and no `TransactWriteItems` [S12]. The reservation transaction is a `ConditionCheck` on `CONFIG` plus an `Update` on `USAGE#` [S11], so it needs `dynamodb:ConditionCheckItem` and `dynamodb:UpdateItem`. As written the role is missing `ConditionCheckItem` entirely and grants a name that will not match the request.

**Correction (spine Conventions, replace the DynamoDB clause):**
> `dynamodb:GetItem`, `dynamodb:UpdateItem`, `dynamodb:ConditionCheckItem` on the one table ARN — the reserve transaction is authorized by its underlying item actions, not by a `TransactWriteItems` action. Add `dynamodb:PutItem` only if the first-of-month `USAGE#` item is created with `Put` rather than an upserting `Update`.

Mirror the same fix in the companion's "IAM scoping" bullet.

*Confidence: high on the correction, high on `ConditionCheckItem` being the real action name [S12]. I could not render the DynamoDB Service Authorization Reference to prove `TransactWriteItems` is absent from the full action list, so treat "not a valid action" as strongly-evidenced rather than absolutely proven — but the required grant is `ConditionCheckItem` + `UpdateItem` either way.*

### F2 — CRITICAL: AD-5 claims to prevent double-charging, but the transaction is not idempotent as designed

**Where:** AD-5 ("Prevents: … double-charging or silent overcharge"), companion "Quota unit definition" and the invoke contract (`client_request_id` — "tracing only — never used for auth or idempotency").

`TransactWriteItems` is idempotent **only** when a client token is supplied: "You can optionally include a client token … to make sure that the request is *idempotent*", valid for 10 minutes; and "default SDK behavior is to retry transactions" [S11]. With the client request ID explicitly barred from idempotency use, a network timeout on the reserve call followed by an SDK retry can burn two quota units for one Bedrock invocation — precisely the failure AD-5 says it prevents.

**Correction:** either (a) pass `client_request_id` as the transaction's `ClientRequestToken` and drop "never used for … idempotency" — noting the 10-minute validity window and that reusing it with changed parameters yields `IdempotentParameterMismatch` [S11]; or (b) keep it tracing-only and soften AD-5's *Prevents* to "double-charging across a tool-call turn", explicitly accepting retry-induced double reservation alongside the crash-leak already accepted in Deferred. (a) is cheap and closes the hole; either way the current wording overclaims.

### F3 — MAJOR: the Bedrock IAM resource set is under-specified in the one place it matters

**Where:** spine Conventions ("`bedrock:InvokeModelWithResponseStream` on the approved inference profile ARN and its destination foundation-model ARNs").

The intent is right, but "its destination foundation-model ARNs" is not resolvable by an implementer without a second lookup, and the destination set is model- *and* source-Region-specific. For `us.anthropic.claude-sonnet-4-6` called from `us-east-1`, the destination Regions are exactly **`us-east-1`, `us-east-2`, `us-west-2`** [S6]. Cross-Region guidance is explicit that a blocked destination Region fails the request even when others are allowed [S10].

**Correction:** enumerate them in the spine.
> `bedrock:InvokeModelWithResponseStream` on `arn:aws:bedrock:us-east-1:<acct>:inference-profile/us.anthropic.claude-sonnet-4-6` **plus** `arn:aws:bedrock:{us-east-1,us-east-2,us-west-2}::foundation-model/anthropic.claude-sonnet-4-6` — the three destination Regions the US geo profile routes to from `us-east-1`. Re-verify this list if the model or Region changes.

Also worth recording as a validated (not corrected) point: **`us-east-1` does not support In-Region inference for Sonnet 4.6** [S6]. The `us.` profile is not a preference — it is the only way to call this model from `us-east-1`. AD-2's Region choice and the Stack Seed's profile choice are therefore jointly load-bearing and should say so.

### F4 — MAJOR: AD-11's content statelessness is unachievable as written

**Where:** AD-11 ("Bedrock request/response content exists only in Lambda memory for the duration of one invocation"), companion NFR3.

Two documented facts collide with this. Cross-Region inference profiles: "Your input prompts and output results **may be stored** in the opt-in Regions for abuse detection purposes" [S10]. And Sonnet 4.6 lists **Abuse detection: supported** on `bedrock-runtime` [S6]. AD-11's *Prevents* clause is precise and correct ("landing in DynamoDB or CloudWatch"); the *Rule* then overreaches into a claim about the whole world, which the chosen model + routing mode contradicts.

**Correction (AD-11 Rule):**
> Bedrock request/response content exists only in Lambda memory for the duration of one invocation **and is never written to any Nixus-controlled store**. Amazon Bedrock may retain prompts/outputs in the inference profile's destination Regions for abuse detection — that is AWS-side and outside this invariant's scope. Persisted/logged fields are limited to `sub`, period, counts, operation, timestamps, latency, status, token usage.

Add the same qualification to companion NFR3 so the privacy promise stays honest.

### F5 — MAJOR: `RESPONSE_STREAM` vs `STREAM` is stated as one value twice

AD-2 says `ResponseTransferMode: RESPONSE_STREAM`; the Stack Seed says `ResponseTransferMode=STREAM`. Both are real, at different layers: SAM's `Api` event source takes `BUFFERED | RESPONSE_STREAM` [S3]; the API Gateway developer guide describes the mode as `STREAM` [S1]. Presented as a single fact in one document, this will send an implementer to the wrong layer.

**Correction:** normalize the spine to the layer it actually authors — SAM — and annotate once.
> `ResponseTransferMode: RESPONSE_STREAM` (AWS SAM `Api` event property; the equivalent API Gateway console/REST-API-level value is `STREAM`). Confirm at `sam validate`/`sam build`.

Two adjacent facts belong with it, both currently unstated and both capable of producing a silent `500`:
- The Lambda must emit metadata JSON + an **8-null-byte delimiter** within the first 16 KB before any payload; if the function output doesn't match the format, "API Gateway invokes your Lambda function and return a 500 error response" [S15]. This is exactly how AD-7's pre-output HTTP status is achieved (statusCode lives in that prelude) — AD-7 is feasible *because of* this format, so the spine should name it.
- SAM's `TimeoutInMillis` maxes at 29,000 ms [S3], while `Api` streaming is what lets the design exceed 29 s [S1]. Do **not** set `TimeoutInMillis`.

### F6 — MAJOR: AD-3 names the scope but not the mechanism that enforces it

AD-3's Rule says the token "must carry resource-server scope `nixus-api/ai.invoke`". That is not self-enforcing. Per AWS: "If you do not configure any **Authorization scopes**, API Gateway treats the supplied token as an **identity token**" — i.e. omit `AuthorizationScopes` on the method and the scope is never checked and access tokens are the wrong token type. With scopes configured, "the method call succeeds if any scope that's specified on the method … matches a scope that's claimed in the incoming token. Otherwise, the call fails with a `401 Unauthorized`" [S5].

**Correction (AD-3 Rule, add):**
> Each method declares `AuthorizationScopes: [nixus-api/ai.invoke]` — that declaration is what makes API Gateway treat the credential as an access token and check the scope; omitting it silently downgrades the route to identity-token mode. Leave the authorizer's token-validation (`aud`) regex empty: it "rejects the request due to the access token not containing the `aud` field" [S5].

One consequence to note in the companion's error table: a missing/insufficient scope surfaces as `401`, not `403` — the table's `401 unauthorized` row already covers it, but the mapping should say so explicitly rather than leaving `premium_required` as the assumed entitlement failure.

### F7 — MAJOR: the implementation sequence assumes a Cognito resource server that does not exist

Companion step 1 says "add scope `nixus-api/ai.invoke` to the existing Cognito resource server/app client". `architecture-login.md` defines no resource server and no custom scopes at all — the concept is absent from that document. A scope cannot be added to a resource server that hasn't been created, and the scope's full name is `<resource-server-identifier>/<scope-name>` [S5], so the identifier `nixus-api` must be chosen and created first.

**Correction (companion step 1):** "Create Cognito resource server with identifier `nixus-api`, define scope `ai.invoke`, enable the resulting `nixus-api/ai.invoke` scope on the existing app client, and confirm the authorize request requests it." The spine's Inherited Invariants line is fine as written ("adds a scope, not a second identity system") — only the sequence is wrong.

### F8 — MAJOR: Node 22 is supported but is neither the newest LTS nor an existing repo convention

Two separate problems behind one number.

*Currency:* `nodejs22.x` is fully supported, AL2023, deprecating **Apr 30 2027**. But `nodejs24.x` is GA (deprecating Apr 30 2028) and `nodejs26.x` is in public preview [S2]. Choosing 22 for a greenfield service in Aug 2026 buys ~20 months before a forced runtime migration, versus ~32 for 24. That is a defensible consistency choice, but it should be a *recorded* choice with its expiry, not an unexamined inheritance.

*Convention:* the spine's Inherited Invariants presents "Node.js 22 ARM64" as a platform convention. In the live repo it is not one: `release.yml:48` pins node 22, `web-ci.yml:55` and `:121` pin node **20**, and there is no root `engines`, no `.nvmrc`, no Volta config. The only place "Node.js 22, ARM64" appears is `architecture-entitlements-licensing.md:90,103,169` — a document describing a service that does not exist. (The spine attributes it to that document correctly; the *companion* additionally implies `docs/project-context.md` carries cloud conventions, and it contains zero mentions of Node 22, ARM64 or AWS SAM.)

**Correction:** in the Stack Seed write `Node.js 22.x (nodejs22.x), ARM64 — supported through Apr 30 2027; nodejs24.x is available and buys a longer runway. Chosen for consistency with the api-licensing design; revisit before Q4 2026.` And soften the Inherited Invariant to "the *designed* cloud-service conventions of `architecture-entitlements-licensing.md` (not yet realized in any shipped service)". ARM64 itself is unconditionally fine: "All supported Lambda runtimes support both x86_64 and arm64" [S2].

### F9 — MINOR: the streaming cost claim is imprecise in a way that hides the real mechanic

The companion says "$3.50 per million requests … plus data-transfer and **streaming-specific charges**". The $3.50 figure is exactly right [S13]. The streaming mechanic is not a separate charge — it is a **request multiplier**: billable requests = `roundUp(response payload / 10 MB)`, minimum 1. AWS's own streaming example concludes "The customer benefits from streaming responses with no additional cost beyond standard request and data transfer charges" [S13]. At AD-8's 4096-output-token chat ceiling (≈16 KB) every response is 1 billable request, so this feature will never trip the multiplier.

Two adjacent cost facts worth adding, since the section exists to prevent surprises: transactional writes perform "two underlying reads or writes of every item", and that capacity "is consumed even when a transaction does not succeed" [S11] — so a quota-exhausted user still costs writes on every rejected attempt. And streaming beyond 10 MB is throttled to 2 MB/s [S1] (irrelevant here, but it's the boundary).

**Correction:** replace "streaming-specific charges" with the 10 MB-increment rule and state that this design sits in the 1-request bucket.

### F10 — MINOR: `configure-aws-credentials@v4` is two majors stale, and the credential shape contradicts the spine's own posture

Latest release is **v6.2.3**, published 2026-07-22; the v6 line added AWS-profile support, extra session tags, custom STS endpoints and retry/logging improvements [S14]. Pinning `@v4` matches the existing `web-ci.yml:131`, so this is consistency with a stale precedent rather than an isolated error — but the spine dates itself "verified 2026-08-25", which makes `@v4` a false currency claim.

Sharper point: companion step 5 provisions `AWS_INFRA_DEPLOY_ACCESS_KEY_ID`/`SECRET` — long-lived static IAM user keys — inside a feature whose AD-1 and companion "No static credentials at runtime" make credential-free operation the headline invariant. The action's primary supported path is GitHub OIDC role assumption, which needs no stored secret at all.

**Correction:** Stack Seed → `aws-actions/configure-aws-credentials@v6`. AD-12 / companion step 5 → prefer `id-token: write` + `role-to-assume` (GitHub OIDC) for the SAM deploy principal; if static keys are kept for parity with `web-ci.yml`, record that as an explicit, dated exception rather than leaving it implied. Note also that `web-ci.yml`'s deploy job is self-labelled `"Deploy (stub)"` — AD-12's "distinct from the web CDN key" is distinguishing itself from a key path that is not yet real.

### F11 — MINOR: two absolutes about the keyring are slightly false

*Spine:* "`credentials.rs` is the sole keyring accessor." Near-true and the right rule, but there is exactly one other keyring touch: `lib.rs:79` `keyring::use_native_store(false)`. It is a bootstrap call, not an `Entry` access. Recommend the precise form: "`credentials.rs` holds every `keyring::Entry` access; the only other keyring call in the tree is the one-time `use_native_store` bootstrap in `lib.rs`."

*Companion:* "Never call `keyring_core::Entry` from anywhere in the hosted-adapter code path." The codebase does not use `keyring_core` — it uses the `keyring` crate (`keyring::Entry`, 17 sites in `credentials.rs`). An enforcement rule naming a path that doesn't exist cannot be checked. Correct to `keyring::Entry`.

### F12 — CRITICAL (behavioral): AD-10's 120-second skew reverses a deliberate, documented live decision

`commands/auth.rs:757-761` states the current design and its reasoning inline:

> `expires_at` is the single source of truth for expiry — the `exp` claim is not independently checked, and there is no clock-skew buffer either …
> `fn is_session_expired(expires_at: i64, now_unix: i64) -> bool { now_unix >= expires_at }`

No `skew` constant and no `120` exist anywhere in the file. AD-10 mandates "a call-time access token refreshed with a 120-second skew" and frames it inside a decision whose *Binds* is the existing desktop credential boundary — reading as inherited convention when it is in fact a reversal. A future implementer will either "restore" the existing behavior or silently overwrite a considered choice.

Compounding it: `architecture-login.md:102` records refresh-token rotation as **OFF** for v1 with a single long-lived refresh token, so the refresh path AD-10 leans on is simple — which makes adding the skew cheap, but does not make it already-decided.

**Correction (AD-10 Rule, make the change explicit):**
> `commands/auth.rs` gains a call-time token helper that refreshes proactively at a 120-second skew before expiry — **a deliberate change from the current `now_unix >= expires_at` check, which documents having no skew buffer.** Update that comment in the same change so the two don't contradict. One 401 refresh+retry per call before falling back or erroring.

### F13 — MINOR: the companion asserts `AiBackend` already exists

Companion NFR5: "extends `AppError`, **the existing `AiBackend`-shaped routing**, TanStack Query…". `AiBackend`, `hosted_state`, and `HostedAiState` return **zero matches** across every `.rs` file in `apps/desktop/src-tauri/src/`. The four surfaces (`ai/chat.rs`, `ai/project_advice.rs`, `ai/trends_insight.rs`, `ai/cc_parser.rs`) each call concrete AWS/OpenAI clients directly — which the companion itself correctly states at line 61 ("currently spread across separate concrete AWS client call sites"). NFR5 contradicts line 61.

The spine is clean here: the Paradigm and AD-9 describe the target state, which is what a spine is for. Only NFR5 needs the fix: "extends `AppError`, TanStack Query and the Rust command/db layering; **introduces** the `AiBackend` port (no such seam exists today)."

### F14 — MINOR: one of four operation enum values has no counterpart in live code

`chat`, `project_advice` and `trends_insight` map to real modules. The statement-import surface is `ai/cc_parser.rs` — `statement_import` appears nowhere in source. Not a defect (the closed enum is a new wire contract and the name is better), but the mapping should be stated once so the retrofit doesn't hunt for a `statement_import` module: `statement_import` → `ai/cc_parser.rs`.

---

## 3. Validated, no action

Worth recording so a later reviewer doesn't re-litigate:

- **The transport decision is correct and the reasoning holds.** HTTP API genuinely cannot stream; REST can, at every endpoint type, and streaming is precisely how the design escapes the 29 s ceiling without a quota increase [S1]. The companion's Technical Constraints paragraph on this is accurate.
- **AD-7's pre-output-vs-committed boundary is mechanically supported**, not aspirational: API Gateway "begins the payload stream after it receives the valid metadata and delimiter from Lambda" [S15], so a real HTTP status before any body is exactly what the format provides.
- **The reserve/refund quota model is feasible as specified** — distinct-item `ConditionCheck` + `Update`, serializable against `GetItem`/`UpdateItem`, with ordered `CancellationReasons` to separate 403 from 429 [S11]. The strongly-consistent `CONFIG` read before the transaction is the right call given eventual-consistency behavior after transactional writes [S11].
- **Model, API and ceilings all check out**: Sonnet 4.6 is Active with no EOL, supports Converse + response streaming, 1M context, 64K max output — comfortably above AD-8's 8192 ceiling [S6].
- **REST request payload cap is 10 MB and request streaming is not supported** [S1]. The 4 MiB raw media cap plus ~33% base64 growth lands near 5.6 MB — inside the cap, which validates the `413` ceiling and the S3 deferral.
- **Lambda 300 s / 512 MB / reserved concurrency 10** are consistent with the streaming envelope: 15-minute stream ceiling, 5-minute Regional idle timeout [S1].
- **Repo conventions that do exist**: `@nixus/` scope, `apps/*` deployables, `packages/shared/src/types/`, `AppError` as sole error enum, snake_case IPC, Vitest `^3.2.4` in all three packages.
- **The `nixus://auth/callback` Deferred item is accurate** — `architecture-login.md` has already self-corrected to the loopback redirect and keeps the deep link as fallback only.
- **Not naming a Bedrock token price is the right call** and the pricing page is correctly cited as the live source.

---

## 4. Residual / not fully verified

Stated plainly rather than asserted:

1. **`Bearer ` prefix.** Both documents describe the desktop sending a "Bearer token". AWS says only "Include the token in the `Authorization` header" [S16] and never shows a `Bearer` scheme for `COGNITO_USER_POOLS` REST authorizers. I could not find primary documentation confirming the prefix is tolerated. **Verify against a deployed stage before baking `Bearer ` into the wire contract**; the safe default is the raw JWT.
2. **Time-to-first-metadata vs. the 29 s integration timeout.** Streaming is documented to bypass the 29 s limit [S1], but whether that also covers the wait for the *metadata prelude* (i.e. a slow Bedrock cold start before the first event) is not addressed in the docs I could reach. Given AD-7 deliberately delays `meta` until the first Bedrock event, this is the one timing assumption worth an empirical check on the first deployed stage.
3. **`nixus-api` as a resource server identifier.** Format-plausible; AWS's examples use URL-shaped identifiers [S5]. Confirm at creation time (see F7).
4. **`dynamodb:TransactWriteItems` non-existence.** See the confidence note in F1 — the required correction is unaffected.
5. **Vitest 3 vs. 4.** The repo pins `^3.2.4` across all packages, so `Vitest` in the Stack Seed is correct *as a consistency statement*. I did not verify whether a newer major exists; matching the monorepo is the right call regardless.
6. **Custom domain `api.nixusapp.com`.** Correctly flagged in the companion as an implementation-time AWS-account check. Not verifiable from docs or repo; unchanged.
7. **`logs:*`.** The companion grants `logs:*`; the spine says "CloudWatch Logs". A Lambda needs only `CreateLogGroup`/`CreateLogStream`/`PutLogEvents`. Tighten if least-privilege matters here — cosmetic against the other findings.

---

## 5. Sources (retrieved 2026-08-25)

| ID | Source |
|---|---|
| S1 | [API Gateway — Stream the integration response for your proxy integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html) |
| S2 | [AWS Lambda — Lambda runtimes (supported runtimes & deprecation dates)](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) |
| S3 | [AWS SAM — `Api` event source property reference (`ResponseTransferMode`, `TimeoutInMillis`)](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-api.html) |
| S4 | [API Gateway — Control access to REST APIs using Amazon Cognito user pools as an authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html) |
| S5 | [API Gateway — Integrate a REST API with an Amazon Cognito user pool (Authorization Scopes, `aud` validation)](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-enable-cognito-user-pool.html) |
| S6 | [Amazon Bedrock — Model card: Claude Sonnet 4.6 (IDs, geo profile destinations, Regional availability, APIs, limits)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html) |
| S7 | [Amazon Bedrock — Models at a glance (current Anthropic lineup)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) |
| S8 | [Anthropic — Models overview (Bedrock IDs; Sonnet 4.6 listed as legacy)](https://docs.claude.com/en/docs/about-claude/models/overview) |
| S9 | [Amazon Bedrock — Identity-based policy examples (inference actions; profile + foundation-model ARNs)](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html) |
| S10 | [Amazon Bedrock — Supported Regions and models for inference profiles (cross-Region IAM/SCP; abuse-detection storage)](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html) |
| S11 | [Amazon DynamoDB — Transactions: how it works (limits, ConditionCheck, isolation, idempotency, capacity)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) |
| S12 | [Amazon DynamoDB — IAM policy for read/write/update/delete on a table (`ConditionCheckItem`)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/iam-policy-example-data-crud.html) |
| S13 | [Amazon API Gateway pricing (REST $3.50/M; response-streaming 10 MB-increment billing)](https://aws.amazon.com/api-gateway/pricing/) |
| S14 | [aws-actions/configure-aws-credentials — releases (v6.2.3, 2026-07-22)](https://github.com/aws-actions/configure-aws-credentials/releases) |
| S15 | [API Gateway — Lambda proxy integration with payload response streaming (metadata + 8-null-byte delimiter; 500 on format mismatch)](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html) |
| S16 | [API Gateway — Call a REST API integrated with an Amazon Cognito user pool](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-invoke-api-integrated-with-cognito-user-pool.html) |

**Repository evidence (live reality, read-only):** `pnpm-workspace.yaml`; `apps/{desktop,web}/package.json`; `packages/shared/package.json`; `packages/shared/src/types/api-error.ts`; `apps/desktop/src-tauri/src/error.rs:5`; `apps/desktop/src-tauri/src/credentials.rs`; `apps/desktop/src-tauri/src/lib.rs:79`; `apps/desktop/src-tauri/src/commands/auth.rs:757-761`; `apps/desktop/src-tauri/src/ai/{chat,project_advice,trends_insight,cc_parser}.rs`; `.github/workflows/release.yml:48`; `.github/workflows/web-ci.yml:55,121,131`; `docs/project-context.md`; `_bmad-output/planning-artifacts/architecture-login.md:24,102,111-112,383,392`; `_bmad-output/planning-artifacts/architecture-entitlements-licensing.md:90,103,169,171,368`. Zero `template.yaml`/`template.yml` files exist in the repository; `AiBackend`, `hosted_state`, `HostedAiState` return zero matches in Rust source.
