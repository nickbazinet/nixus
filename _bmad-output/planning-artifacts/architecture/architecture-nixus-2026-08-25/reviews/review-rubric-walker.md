---
review: rubric-walker
lens: 'good-spine checklist (bmad-architecture reviewer-gate)'
target: '../ARCHITECTURE-SPINE.md'
companion: '../../../architecture-cloud-bedrock.md'
reviewed: '2026-08-25'
verdict: CHANGES-REQUESTED
findings: { critical: 3, high: 8, medium: 12, low: 6 }
---

# Rubric Walker — Nixus Cloud Bedrock spine

## Gate verdict

**CHANGES REQUESTED — do not move `status` off `draft`.** The spine is unusually strong on the axes it chose to fight (quota semantics, the fallback boundary, content statelessness, server-owned ceilings) and its named tech survived verification almost intact — but it leaves the entire deployment/environment/configuration dimension silent, never binds the Cognito scope migration it forces on every existing user, and never decides whether routing users' financial data through Nixus's own AWS account by default requires disclosure. Those three are spine-altitude calls that cannot be delegated to the companion, because the companion is explicitly non-enforceable (`architecture-cloud-bedrock.md:395`: "the spine's `AD` wording is the enforceable statement").

Mechanical floor: `lint_spine.py` returns `{"ok": true, "total_findings": 0}` — placeholders, duplicate IDs, missing Binds/Prevents/Rule, and unpinned versions are all clean. Every finding below is semantic.

The load-bearing structural problem is a recurring pattern rather than twelve unrelated misses: **a decision was made during coaching, written into the companion, and never promoted into an AD.** The status-cache contract, the per-operation ceilings, the `CONFIG.version` recheck, the 4 MiB media cap, the `AppError` mapping, and the refund arithmetic are all in this category. Each is individually fixable; collectively they mean an implementer who obeys every AD to the letter can still build something that does not work.

---

## Critical

### C-1 — AD-3 forces a scope migration that AD-10 converts into a permanent, silent downgrade

AD-3 requires the access token to carry `nixus-api/ai.invoke`. Verified against live code, that requirement cannot be met by any user who is already signed in:

- `apps/desktop/src-tauri/src/commands/auth.rs:50` — `pub const COGNITO_SCOPES: &str = "openid email profile";` is a **hardcoded Rust constant compiled into the shipped binary**. The scope is not configurable at runtime.
- Per OAuth 2.0 (RFC 6749 §6), which Cognito's token endpoint implements, a refreshed access token's scope can only equal or narrow the originally granted scope — it can never expand. (AWS does not state this verbatim for Cognito; it is the documented OAuth semantic and the practical behavior.)
- `architecture-login.md:102` deliberately disabled refresh-token rotation for v1 — "single long-lived refresh token, default rotation OFF" — so existing scope-less sessions persist indefinitely rather than aging out.
- `architecture-login.md:111` fixes the stored session shape as `{ access_token, id_token, refresh_token, expires_at }`. **There is no `scope` field**, so the desktop cannot detect that its own token is ineligible without decoding the JWT.

Now compose that with AD-10: "one 401 refresh+retry per call before falling back or erroring." The refresh returns another scope-less token, the retry fails identically, and AD-9's fallback fires. Result: every pre-existing premium user is permanently and silently routed to BYO (or hard-errors on the two Bedrock-only surfaces) with no signal, while `architecture-login.md:113`'s existing "your session expired, please sign in again" path — the correct remedy — is never reached, because the session has not expired.

The companion has this ("Existing sessions lack the scope and must sign in again after this ships — a one-time, expected re-auth, not a bug", line 128). The spine does not: not in AD-3, not in AD-10, not in Inherited Invariants, not in Deferred. An implementer working from the enforceable artifact ships the silent-downgrade build.

**Autofix.** Extend AD-3's Rule: *"Adding this scope invalidates every pre-existing session. `CognitoSession` gains a `scope` field; a stored session lacking `nixus-api/ai.invoke` is treated as re-auth-required — surfaced through `architecture-login.md`'s existing 'please sign in again' state — and never as a hosted-unavailable fallback."* Extend AD-10's Rule: *"the one 401 refresh+retry applies only to expiry; a 401 whose cause is a missing scope must not be retried and must not fall back."* Add to Inherited Invariants that this amends `architecture-login.md:102/111`, and offer to update that document.

### C-2 — AD-9 silently makes Nixus a processor of users' financial data, against the product's headline claim, with no disclosure and no opt-out

AD-9 gives hosted Bedrock highest precedence across all four surfaces "whenever a signed-in premium user has quota, even over an explicitly configured OpenAI provider," and AD-9's Prevents explicitly forbids "a user-facing provider toggle overriding hosted precedence." Combined with Deferred's "v1 has no status UI at all," a premium user gets **no indication and no control** that their prompts, chat history, and credit-card statement images now transit Nixus's AWS account instead of their own.

Today's posture is BYO: `README.md` states "your data never leaves your machine", "**Data** | Local SQLite on your machine — no cloud account required", and "AI import requires your own API credentials (stored in your OS keychain)." Under BYO Bedrock the statement image goes to the *user's* AWS account. Under AD-9 it goes to Nixus's. That is a different trust and legal posture, not an optimization — and it becomes the silent default.

AD-11 is the right instinct and does real work (nothing is persisted or logged), but content statelessness is not the same as consent. The spine has no AD binding disclosure, consent, or an escape hatch, and Deferred does not name the omission — so it reads as decided rather than skipped.

**Autofix.** Add an AD (e.g. AD-13 "Hosted routing is disclosed and escapable"): **Binds** first-use of the hosted path on any surface. **Prevents** a premium user's financial content transiting Nixus infrastructure without their knowledge, and a precedence rule with no user-side escape. **Rule** — hosted precedence takes effect only after a one-time, per-install acknowledgement recorded locally; a persistent per-dataset opt-out returns the user to BYO precedence permanently. If the intent is genuinely to ship v1 without this, it must be an explicit Deferred entry naming the accepted risk, plus a README/marketing correction — not silence.

### C-3 — The whole deployment / environments / configuration dimension is silent

There is **no Structural Seed section**. The spine template calls this out specifically (`spine-template.md:62`): "DEPLOYMENT & ENVIRONMENTS and external provider/infra topology (cover the operational envelope here when this altitude owns it — **don't let it fall through**)", plus a minimal source tree. The good-spine checklist repeats it: "every dimension the altitude owns is decided, deferred, or an open question — a whole dimension left silent is a finding, especially the operational/environmental envelope."

Concretely undecided, and each is a fork two implementers resolve differently:

1. **How the desktop learns the API base URL.** Nothing in the spine says. `architecture-login.md:271` already left the analogous Cognito question ambiguous ("a build-time constant **or** `tauri.conf.json`-adjacent config file"), and the companion (line 210) leaves the URL itself bimodal — `api.nixusapp.com` if Route53/ACM exist, otherwise an `execute-api` URL. So the adapter must handle either, chosen at an unspecified layer.
2. **How the Cognito user pool ARN reaches the SAM template.** AD-2/AD-3 require a user-pool authorizer, which needs the pool ARN. Verified: **the pool ID appears nowhere in the repo** — only `COGNITO_CLIENT_ID` and the hosted-UI domain (`auth.rs:27,31`), because the pool was provisioned by hand (`auth.rs:1-2`: "provisioned out-of-band in the AWS Console"). Nothing records where the ARN comes from, or that it must not be imported into the stack (that instruction exists only in the companion, line 205).
3. **Local and dev builds.** Deferred says "v1 ships one production stack plus local SAM." If the base URL is a compile-time constant, local SAM is unreachable; if it isn't, nothing constrains it. Worse: with one stack and one constant, **every developer debug build consumes production quota against the developer's real `sub`** — the exact case AD-5's accounting is supposed to make trustworthy.
4. **Stack parameters generally** — table name, model ID, per-operation ceilings, reserved concurrency: parameters, mappings, or literals? Unstated, so `template.yaml` cannot be written from the spine.

This is the finding that most directly blocks starting implementation: neither `template.yaml` nor the Rust adapter can be authored from the spine alone.

**Autofix.** Add a `## Structural Seed` section carrying (a) a deployment/environments mermaid diagram — one `us-east-1` production stack, local SAM, the out-of-band Cognito pool as an external unowned resource; (b) the `apps/api-bedrock` + desktop source tree (promote it from `architecture-cloud-bedrock.md:263-303`); and (c) one AD fixing configuration flow, e.g.: *"The API base URL is a single build-time Rust constant alongside `COGNITO_*` in `commands/auth.rs`, overridable only by an explicit debug-build override; the Cognito user pool ARN and table name are SAM template parameters supplied via `samconfig.toml`; no runtime discovery, no environment-variable indirection on the desktop. Non-production desktop builds must not default to the production endpoint."*

---

## High

### H-1 — AD-5/AD-6 leave the quota arithmetic underdetermined; a compliant build can have refunds that don't refund

AD-6 names the usage attributes "reserved/completed/refunded counts"; the companion's table (line 118) names them `request_count`, `completed_count`, `refunded_count` — there is no `reserved` attribute at all. Beyond the naming clash, three semantics are missing:

- **Does a refund restore available quota?** AD-5 says "refund the same period," and the companion (line 123) makes refund "a second, targeted `UpdateItem`." If refund only increments `refunded_count`, the limit condition still counts the failed call and the refund is cosmetic. If it decrements the counter the condition reads, it works. Both readings satisfy AD-5 verbatim. One of them makes the entire reserve/refund mechanism — the spine's most carefully argued decision — a no-op.
- **Who writes `completed`, the per-operation counters, and the token aggregates?** AD-6 requires them to exist; AD-5 defines only reserve and refund. That implies a third DynamoDB write *after* the stream ends, on the critical path, while the response is already committed — a whole step with no invariant, and one that cannot happen if the Lambda is killed.
- **The `CONFIG.version` recheck is not required.** AD-6 lists `version` but never says what it is for. The companion (line 122) uses it to close the read-then-write race between concurrent requests. AD-5 says only "Reserve via `TransactWriteItems`" — so an implementer can use a transaction that never re-asserts `version`/`premium`/`limit` and reintroduce the exact race the design solved.

**Autofix.** Rewrite AD-5's Rule to pin the arithmetic and the writers: *"`available = limit − (reserved − refunded)`; the limit condition reads that expression. Reserve is one `TransactWriteItems` that re-asserts `CONFIG.version`, `premium`, and `monthly_request_limit` as just read, and conditionally increments `reserved`. Refund decrements `reserved` and increments `refunded`. After `end`, one `UpdateItem` increments `completed` and the per-operation/token aggregates; that write is best-effort and never blocks or alters the response."* Then align AD-6's attribute names to those exact identifiers and correct the companion table to match.

### H-2 — Two independently released units share a wire contract with no compatibility rule

Verified release topology: the cloud service auto-deploys on every push to the default branch (AD-12), while the desktop ships only on `v*` tags (`.github/workflows/release.yml:3-7`). The companion celebrates this ("each keeps its own release cadence", line 318) — but the desktop compiles the contract in: `COGNITO_SCOPES`, the operation enum, the NDJSON frame shapes, and (per C-3) the endpoint are all in the binary, and users update on their own schedule.

`/v1` in the route versions the path but no AD binds what `/v1` guarantees. Nothing prevents a Lambda deploy from adding a required request field, renaming a frame, tightening a ceiling, or dropping an operation while thousands of installs still speak the old shape. This is the reviewer-gate's own adversarial test — two units obeying every AD that still build incompatibly — and it is wide open.

**Autofix.** Add an AD: *"`/v1` is append-only. The Lambda accepts every request shape any shipped desktop version can emit and never removes or renames a frame type, operation, or error code within `/v1`; contract-narrowing changes require `/v2` alongside `/v1`. Desktop sends its app version on every request; the Lambda logs it and may refuse only via a documented `hosted_unavailable`."*

### H-3 — AD-9's "one `AiBackend` port" is undecided in the one respect that determines the implementation

Verified against live code:

- **There are zero traits in `src-tauri/src`** (`grep '^pub trait\|^trait '` → no matches). The codebase convention is enums plus `match`: `ai::AiProvider` (`ai/mod.rs:11-14`), and two hand-duplicated `ProviderClient` enums (`ai/project_advice.rs:25-28`, `ai/trends_insight.rs:22-25`).
- `AiState` is a **per-dataset singleton built once at dataset load** (`ai/mod.rs:56` `init_ai_client`, invoked from `lib.rs:108`) off a single `ai_provider` config key.
- Hosted eligibility is **machine-level and per-call** — it depends on the Cognito session and live quota, neither of which is dataset-scoped or knowable at load time.

So AD-9 silently requires `AiState`'s lifecycle to change from load-time-resolved to per-call-resolved, and a trait-based port would be the **first trait in the codebase** — against convention, and non-trivial for the streaming path (chat streams via `converse_stream()` plus `chat:response-chunk` Tauri events, `ai/chat.rs:253-320`, so an async streaming trait needs `async_trait`/`dyn` decisions and a new dependency). The companion hedges rather than deciding ("or the existing `ai/` module gains this boundary if a suitable seam already exists at implementation time — verify against live code", line 227) and files it as an Important Gap (line 382). That is precisely the kind of fork a spine exists to settle.

**Autofix.** Decide in AD-9's Rule: dispatch mechanism (extend the existing `AiProvider` enum with a `Hosted` variant — convention-consistent, no new dependency — versus a trait), and state that hosted-vs-BYO selection is resolved per call, so `AiState` may no longer cache the resolved provider at dataset load. Name the two duplicate `ProviderClient` enums as the thing being collapsed.

### H-4 — AD-9's precedence condition is unobservable, because no AD governs the status cache

AD-9 gives hosted precedence "whenever a signed-in premium user **has quota**." Nothing in the spine says how the desktop knows that. The Conventions only say status is Rust-internal. Compliant readings:

- Call `GET /v1/ai/status` before every AI call — doubles API Gateway requests and adds a round trip to every prompt.
- Never call it; always attempt hosted — every signed-in non-premium user pays one API Gateway request plus a 403 per AI call, and "has quota" degrades to "try and fail."
- The companion's actual design (5-minute TTL, refresh once after login and once after launch, never while logged out, invalidate on 403/429) — which exists only at `architecture-cloud-bedrock.md:195-200` and is therefore unenforceable.

**Autofix.** Promote the cache contract into an AD: **Binds** hosted eligibility resolution. **Prevents** a `/status` call per AI call, and status polling. **Rule** — `HostedAiState` is refreshed once after login, once after launch when a session exists, and lazily when older than 5 minutes before an AI call; never fetched while logged out; invalidated immediately on any 403/429; no background timer.

### H-5 — Lambda throttling and quota exhaustion collide on 429

AD-4 pins reserved concurrency at 10 against a 300-second timeout — ten concurrent long-lived streams for the entire user base. AD-4 never says what happens at saturation. Lambda throttling surfaces as 429, which the companion's error table maps to `quota_exhausted` (line 180), so at saturation a user is told their **monthly quota is exhausted**, `HostedAiState` is invalidated (H-4), and AD-9 falls back — all for a transient capacity event. The user-visible message is simply false, and there is no signal distinguishing the two.

**Autofix.** Add to AD-4's Rule: *"concurrency exhaustion is a transient capacity condition and must surface as `503 hosted_unavailable`, never as `429 quota_exhausted`; only a failed quota reservation may produce 429."* Confirm the Lambda distinguishes its own reservation failure from an upstream throttle, and note that reserved concurrency 10 is a deliberate beta cap.

### H-6 — Stack Seed pins a two-major-versions-stale action under a "verified" heading

The section is titled "Stack Seed (verified 2026-08-25)" and pins `aws-actions/configure-aws-credentials@v4`. Verified live against the action's releases: **the current release is v6.2.3 (2026-07-22); v6 is the current major.** The README's first section is "Quick Start (OIDC, recommended)" and Security Recommendations state "Use temporary credentials when possible. OIDC is recommended because it provides temporary credentials and it's easy to set up."

This matters more than a version bump, because AD-12 introduces a principal with CloudFormation/Lambda/IAM/DynamoDB mutation rights. The existing precedent (`web-ci.yml:131-134`) uses long-lived static keys (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, not OIDC), and the companion propagates that shape (`AWS_INFRA_DEPLOY_ACCESS_KEY_ID`/`SECRET`, line 209). AD-12 already frames itself as diverging from the precedent by design; static keys for an infra-mutating principal is the wrong thing to inherit.

This is also the one checklist item — "named tech is verified-current" — that the Stack Seed explicitly claims to have satisfied.

**Autofix.** Bump to `aws-actions/configure-aws-credentials@v6` and extend AD-12's Rule: *"the deploy principal is a GitHub OIDC role (`role-to-assume` + `id-token: write`), scoped to this stack's resources; no long-lived access keys."* Update the companion's secret names accordingly.

### H-7 — `packages/shared/src/types/cloud-ai.ts` provides no drift protection and re-couples the two services

Two verified problems with the Conventions line "shared contracts `packages/shared/src/types/cloud-ai.ts`":

1. **It protects nothing.** The desktop consumer is Rust, which cannot import TypeScript; the companion has the Rust wire models hand-mirrored ("mirrored Rust wire models in the existing Rust models location", line 207). So `cloud-ai.ts`'s only consumer is the Lambda itself, and the one boundary that can actually drift — TS Lambda ↔ Rust adapter — has no binding mechanism at all. Two independently-built units, one wire format, zero enforcement.
2. **It re-couples the services AD-12 exists to separate.** `web-ci.yml:17-30` path-filters on `packages/shared/**`. Putting the contract there means **every contract edit triggers the web verify job and, on the default branch, the `s3 sync` + CloudFront invalidation** (`web-ci.yml:138-141`) — the precise entanglement AD-12's "distinct from both the web CDN key" is meant to prevent.

**Autofix.** Either (a) move the contract to `apps/api-bedrock/src/lib/contract.ts` and add an AD naming the Rust wire models canonical, bound by checked-in golden NDJSON/request fixtures that **both** the Vitest and Rust test suites assert against; or (b) keep it in `packages/shared` and add `packages/shared/src/types/cloud-ai.ts` to `web-ci.yml`'s `paths-ignore`. Option (a) is preferable — it fixes the real drift risk rather than the CI symptom.

### H-8 — Hosted error mapping into `AppError` is unbound, and the mandatory i18n consequence is unaddressed

Verified live enum (`apps/desktop/src-tauri/src/error.rs:5-14`): `Validation | Database | AiService{message, recoverable} | Auth{message, recoverable} | File | NotConfigured | InvalidCredentials | Unavailable`. **There is no quota or rate-limit variant**, and today's AI failures land in `AiService{recoverable: true}` with a formatted debug string (`ai/chat.rs:264-267`).

The spine's Inherited Invariants say only "`AppError` is the only error shape on the desktop; no parallel error type." That does not decide whether the six hosted error codes reuse `AiService` or add a variant — and the choice is observable: `docs/project-context.md:101-103` documents that the JSON carries a `type` discriminator and that "frontend uses [`recoverable`] to decide retry vs redirect," so a new `type` string silently misses existing frontend switches. The companion picks "an AI-hosted-specific variant carrying `recoverable: bool`" (line 183); the spine does not.

Two compounding brownfield constraints the spine never mentions:

- **i18n is mandatory** — `docs/project-context.md:231` "All user-visible strings go through i18next — no hardcoded English strings in JSX." Quota-exhausted and hosted-unavailable are new user-visible states.
- **Locale parity is CI-enforced** — `docs/project-context.md:291` describes i18n locale-parity specs under `src/locales/__tests__/`. EN-only keys fail the suite. Combined with the zero-warning policy (`docs/guidelines/warnings.md:3`, `project-context.md:126`), a partial implementation breaks the build.

**Autofix.** Add to Conventions: *"The six hosted error codes map into the existing `AppError::AiService { message, recoverable }` variant — `quota_exhausted` and `hosted_unavailable` are `recoverable: true`, `premium_required`/`validation`/`payload_too_large` are `recoverable: false` — so no new `type` discriminator reaches the frontend. Every new user-visible hosted-AI message ships an i18next key in both EN and FR."*

---

## Medium

**M-1 — `ConverseStream` and `InvokeModelWithResponseStream` are conflated across the spine.** AD-7 says the Lambda "calls `ConverseStream`"; the capability map labels the Bedrock node `InvokeModelWithResponseStream`; the sequence diagram writes `ConverseStream (InvokeModelWithResponseStream)`; the companion prices quota per "actual `InvokeModelWithResponseStream` call" (line 124). Verified: these are **two distinct SDK operations with different request/response shapes** that merely share one IAM action — AWS's ConverseStream reference states verbatim "This operation requires permission for the `bedrock:InvokeModelWithResponseStream` action", and there is no `bedrock:ConverseStream` action. So the IAM line in Conventions is *correct*, but the diagrams carry a competing API choice: an implementer reading the capability map builds model-native Anthropic payloads, one reading AD-7 builds Converse-format payloads. *Autofix:* label both diagrams `ConverseStream`, and add a parenthetical in Conventions that `bedrock:InvokeModelWithResponseStream` is the IAM action for it, not a second API.

**M-2 — The frame set is viable only because of an unrecorded property of the live tool protocol.** Verified: chat's tool calling is **regex over text** — `parse_tool_call` matches a ```` ```tool_call ```` block (`ai/chat.rs:130-136`), and `commands/chat.rs:254-310` is a plain `if/else` hard-capped at 2 model turns ("1-round limit", line 312); a second requested tool call is stripped as text. Separately verified: in Converse, `contentBlockDelta.delta` is a union whose `text` and `toolUse` members are **mutually exclusive**, so a text-only `delta` channel provably cannot transport native tool use. The spine's `meta|delta|end|error` set therefore works *today* and forecloses native `toolConfig` tool use permanently — and AD-5's "a visible chat message that triggers a local tool consumes two units" quietly depends on the 2-turn cap for its bound. Neither fact is recorded. *Autofix:* add to AD-8's Rule that tool orchestration stays desktop-side and text-encoded, that `toolConfig` is never sent, and that chat is capped at two model turns per user message — so the quota bound is two units and the frame set stays sufficient.

**M-3 — No dependency-direction diagram, and the diagram present reads against the named paradigm.** `spine-template.md:34` requires one and says "it IS a rule." The spine leads with ports-and-adapters, whose load-bearing rule is dependency inversion — and the only structural diagram shows `AiBackend --> Hosted` (dataflow), the inverse of the hexagonal dependency direction, with nothing stating that adapters depend on the port and never the reverse, and that no surface may reach a concrete AWS/OpenAI client. Also missing per the template: the Design Paradigm section does not map layers to directories. *Autofix:* add a dependency-direction mermaid graph plus one Convention row: "the four surfaces depend only on `AiBackend`; adapters depend on the port; no surface references `aws_sdk_bedrockruntime` or `async_openai` directly."

**M-4 — AD-2 forces streaming on a route that doesn't need it, and never pins the integration timeout.** Verified, and better than the memlog assumed: with `ResponseTransferMode=STREAM` on a Regional REST API the effective ceiling is **15 minutes with no service-quota increase** (AWS frames "exceed the 29-second timeout without requesting an increase" as a headline benefit), so AD-4's 300s Lambda is fine. But two real constraints go unrecorded: Regional endpoints carry a **5-minute idle timeout between chunks — exactly equal to AD-4's 300s Lambda timeout**, which is safe for continuous tokens and not for a long reasoning pause; and nothing says whether `Integration.TimeoutInMillis` is set, so an implementer defaulting it to the buffered-mode 29,000ms could cap streams at 29s. Separately, AD-2's blanket rule applies `RESPONSE_STREAM` to `GET /v1/ai/status`, forcing the status path through `streamifyResponse` and `HttpResponseStream.from()` for a small JSON body. *Autofix:* in AD-2's Rule, state that `TimeoutInMillis` is left unset (streaming ceiling applies), record the 15-minute cap and 5-minute Regional idle timeout as the operative bounds, and say whether status is `BUFFERED` or deliberately uniform.

**M-5 — AD-10 contradicts live, deliberately-commented behavior and amends a parent decision without saying so.** AD-10 is phrased in the present tense — "`commands/auth.rs` **provides** a call-time access token refreshed with a 120-second skew; one 401 refresh+retry per call" — as though it exists. Verified: it does not. `is_session_expired` is `now_unix >= expires_at` (`auth.rs:762-763`) with a comment **explicitly rejecting a skew buffer** ("not a clock-skew buffer either: AC 2 is literally 'still in the future'"), tied to an acceptance criterion; and there is **no 401-retry anywhere** in `auth.rs` or `cloud_link.rs`. Refresh is expiry-triggered at session-check time only. `architecture-login.md:175` further fixed refresh as "checked once on app launch, not polled — matches the local-first, no-unnecessary-network-calls posture," which call-time refresh changes. *Autofix:* mark AD-10 as new work amending `architecture-login.md:175` and overriding the no-skew acceptance criterion, and offer to update that document plus the code comment.

**M-6 — AD-6 omits three details it depends on.** (a) The period key never says **UTC** — the memlog and companion both do, the enforceable AD does not. (b) `version` is listed with no stated purpose, which is why H-1's race can be reintroduced. (c) Nothing forbids the runtime from writing `CONFIG`; "No PostConfirmation Lambda" only rules out a *bootstrap* Lambda, so lazy auto-create-on-first-read is compliant, adding writes and a second CONFIG author alongside the console. *Autofix:* "`USAGE#<YYYY-MM>` where the period is computed in UTC at request time; `CONFIG` is written only out-of-band (console/admin) and never by the runtime; the reserve transaction re-asserts `CONFIG.version`."

**M-7 — The `meta` frame payload is unspecified, and AD-8's server-private facts can leak through it.** AD-7 fixes the four frame names; only `delta.text` is specified anywhere (companion, line 155). AD-11 forbids content but says nothing about the model ID or inference profile, which AD-8 makes server-owned and never client input. A compliant `meta` can carry `{"type":"meta","model":"us.anthropic.claude-sonnet-4-6","operation":"chat"}`, handing the client exactly what AD-8 withholds. *Autofix:* AD-7 should name the shared contract as the sole definition of frame payloads and forbid the model ID, inference profile ARN, and raw upstream error strings from appearing in any frame.

**M-8 — No client-side retry rule, so pre-output retries double-charge quota.** AD-7 forbids fallback and retry only *after* the first Bedrock event. Before `meta`, fallback to another provider is legal — but nothing forbids retrying **hosted** `/invoke`, and `client_request_id` is explicitly "tracing only — never used for auth or idempotency" (companion, line 148). A 503-with-backoff retry, the obvious thing to add, silently consumes two units per user action; a post-reservation network timeout is indistinguishable from "never arrived." *Autofix:* add to AD-9's Rule: "a pre-output hosted failure falls back at most once and never re-attempts hosted for the same operation; the desktop never retries `/v1/ai/invoke`."

**M-9 — Deferred references a ceiling no AD establishes.** "S3-backed statement upload — only if real statement media exceeds the 4 MiB raw ceiling" is the spine's only mention of 4 MiB; no AD sets it, and the per-operation JSON/output-token ceilings live only in the companion table (lines 163-170). AD-8 says ceilings are "server constants" without fixing the one its own Deferred is conditioned on. *Autofix:* put the raw-media cap and the 413-before-base64 rule in AD-8's Rule; leave the per-operation numbers in the companion but reference them from AD-8 as the single source.

**M-10 — The operations dimension is thin for a feature whose dominant cost is unbounded.** The spine's entire operational content is 14-day log retention and structured logs. AD-8 caps per request and AD-5 caps per user per month, but there is **no aggregate or account-level ceiling, no budget or anomaly alarm, and no kill switch** — disabling hosted AI requires a redeploy or a sweep of every `CONFIG` item, and Deferred rules out the admin UI that would make that feasible. The sibling document already flagged an alarm as "worth a CloudWatch alarm eventually" (`architecture-entitlements-licensing.md:237`), and the companion demotes it to nice-to-have (line 385). *Autofix:* either add an AD for a global enable flag plus a Bedrock spend/anomaly alarm, or add an explicit Deferred entry naming the accepted denial-of-wallet residual and the revisit trigger.

**M-11 — The canonical agent-rules file has no third app class, and the CI commands AD-12 requires do not exist.** `docs/project-context.md` is loaded as this workflow's `persistent_facts` (`customize.toml`) and describes only `apps/desktop`, `apps/web`, `packages/shared` — nothing about a Lambda service. Nothing in the spine binds extending it, so implementers of `apps/api-bedrock` have no canonical conventions. Verified adjacent gap: AD-12 requires CI to run "lint/typecheck/test", but there are **no root-level lint/typecheck/test scripts**, `@nixus/desktop` has neither a `lint` nor a `typecheck` script, and `@nixus/shared` has no `lint` — so the scripts AD-12 depends on must be created. *Autofix:* add a Convention requiring `docs/project-context.md` to gain an `apps/api-bedrock` section, and name the exact `pnpm --filter @nixus/api-bedrock <script>` targets AD-12 invokes.

**M-12 — No capability→AD traceability.** The heading "Capability Map" carries two mermaid diagrams rather than the template's capability → lives-in → governed-by table. No spec drove this run, so cutting the table is defensible — but the four AI surfaces are the real capabilities and the companion's FR1-FR5 exist, so an FR→AD map is buildable and its absence leaves no auditor checklist. FR4 (streaming preserved) and FR5 (automated CI) map to files in the companion and to no AD from the spine side. *Autofix:* either add a short FR/surface → AD table or rename the heading to match its contents.

---

## Low

**L-1** Inherited Invariants are prose bullets, not the template's `Inherited | From parent | Binds here` table, and no bullet states what it constrains *here*. Two of the five (the entitlements-conventions scoping note, the `architecture.md`-is-historical note) are document-authority disclaimers rather than invariants that bind code — correct content, wrong section, and they dilute the three that do bind.

**L-2** Log field casing is unpinned in the spine. The sibling precedent uses camelCase `{ event, requestId, ... }` (`architecture-entitlements-licensing.md:230`); the companion chose `snake_case` `request_id` with a rationale (line 221). Since only the spine is enforceable, two Nixus Lambda services will end up with differently-cased log fields and no shared CloudWatch query. *Autofix:* one Conventions row pinning `snake_case` log fields.

**L-3** The IAM Conventions line omits the condition key. Verified: AWS's documented cross-region-profile pattern is two statements, the foundation-model statement scoped by `"Condition": {"StringLike": {"bedrock:InferenceProfileArn": "...inference-profile/us.anthropic..."}}`. As written, granting both ARNs unconditionally lets the role invoke the destination foundation models directly, outside the approved profile. *Autofix:* add "...and its destination foundation-model ARNs, conditioned on `bedrock:InferenceProfileArn`."

**L-4** Both mermaid blocks use `\n` inside quoted node labels (`"ai/hosted_state.rs\n(HostedAiState cache, Rust-only)"`). `<br/>` is the documented form; `\n` rendering is version-dependent.

**L-5** Naming drift between the operation enum and live code: `statement_import` is implemented by `ai/cc_parser.rs` behind the command `import_cc_statement`. Nothing records the mapping, so the closed enum and the module names read as unrelated.

**L-6 (open question, not a defect)** `_bmad-output/implementation-artifacts/sprint-status.yaml` carries a backlog epic 35 "Nixus Cloud Login/Migration" that is not among the spine's `sources` and not reconciled anywhere. Possible scope overlap with this feature's Cognito/cloud surface — worth a deliberate check rather than an assumption.

---

## Verified correct — do not "fix" these

Recorded so a later pass doesn't undo work that survived verification:

- **`us.anthropic.claude-sonnet-4-6` is a valid, current cross-region inference profile ID** (AWS Claude Sonnet 4.6 model card: model `anthropic.claude-sonnet-4-6`, US geo profile `us.anthropic.claude-sonnet-4-6`). It correctly has **no** date stamp and **no** `-v1:0` suffix — that pattern held for Sonnet 4.5 and does not generalize (Opus 4.6 uses a third form, `anthropic.claude-opus-4-6-v1`). Do not "correct" this to a dated ID.
- **`bedrock:InvokeModelWithResponseStream` is genuinely the IAM action for `ConverseStream`** (stated verbatim in the ConverseStream API reference); there is no `bedrock:ConverseStream` action. Granting both the profile ARN and the destination foundation-model ARNs is AWS's own documented pattern.
- **Response streaming on a Regional REST API with `AWS_PROXY` is real**, and the SAM `RESPONSE_STREAM` → CFN `STREAM` spelling split is real and layer-specific (SAM's translator maps one to the other). AD-2 and the Stack Seed are each correct for their layer — see M-4 only for the timeout bounds they omit.
- **AD-3 is right that `sub` is available.** Setting `AuthorizationScopes` forces API Gateway to treat the token as an **access** token, whose claim set is smaller than the ID token's (`sub`, `client_id`, `scope`, `token_use` — no `email`/`name`). AD-3 needs only `sub`, which is present, and the desktop's id_token-based profile (`architecture-login.md:115`) is unaffected. The "never trust a body-supplied user identifier" clause is exactly right.
- **Deferred's `nixus://auth/callback` framing is accurate.** The live redirect is already the loopback URI (`auth_listener.rs:26`, `http://127.0.0.1:52847/callback`); the deep link is legacy fallback owned by `architecture-login.md`. Correctly scoped out.
- **The brownfield premise checks out.** Three duplicated provider abstractions exist as claimed (`ai/mod.rs:11`, `ai/project_advice.rs:25`, `ai/trends_insight.rs:22`), plus two hardcoded-Bedrock call sites; chat and statement import genuinely reject OpenAI with `NotConfigured` (`commands/chat.rs:216`, `commands/import.rs:292`), which AD-9's "Bedrock-only surfaces require BYO Bedrock or return a typed error" ratifies correctly. `credentials.rs` is verifiably the sole `keyring_core::Entry` caller. `hosted_state.rs`, `AiBackend`, and `HostedBedrockAdapter` correctly do not exist yet.
- **AD-6's deliberate status-code asymmetry** (invoke fails closed, status returns 200 with zeroed fields) is well-argued and states its own reasoning — a status read is not an enforcement gate.
- **AD-11 is the cleanest AD in the document**: an enforceable allowlist of persisted fields rather than a prohibition list.
- **The "no Tauri command, no frontend hook, no query key" convention** deliberately sidesteps a documented project pitfall — `docs/project-context.md:295` warns that any new always-mounted component calling `invoke()` breaks every existing Playwright spec's mock. Keeping hosted state Rust-internal avoids it by construction. Worth keeping explicit for that reason.

---

## Suggested disposition

| Finding | Action |
|---|---|
| C-1, C-2, C-3 | **Discuss** — each needs a product/owner call (forced re-auth UX, disclosure posture, config strategy) before the AD text can be written |
| H-1, H-5, H-6, H-8, M-1, M-6, M-7, M-8, M-9, L-2, L-3, L-4, L-5 | **Autofix** — mechanical AD/Conventions edits, wording given above |
| H-2, H-3, H-4, H-7, M-3, M-4 | **Autofix, then confirm** — the fix is clear but changes the implementation shape; worth one review pass |
| M-2, M-10, M-11, M-12, L-1 | **Autofix or Defer** — acceptable as explicit Deferred entries with a named revisit trigger, but not as silence |
| L-6 | **Open question** — reconcile against sprint-status epic 35 before finalize |
