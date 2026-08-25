# Review — Security & Privacy Lens (Public, Cost-Bearing AI API)

- **Reviewed:** `ARCHITECTURE-SPINE.md` — Nixus Cloud Bedrock (feature altitude, `status: draft`, 2026-08-25)
- **Companion read:** `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md`
- **Grounding:** `architecture-login.md`, `architecture-entitlements-licensing.md`, `.memlog.md` (same run folder), `.github/workflows/web-ci.yml`, live desktop AI call sites (`apps/desktop/src-tauri/src/ai/*`), plus current AWS documentation retrieved 2026-08-25 (cited inline).
- **Lens:** Treat `POST /v1/ai/invoke` as what it actually is — **an internet-reachable endpoint that spends Nixus's money and processes the user's financial records under Nixus's AWS account.** Attack it as (a) an attacker holding a stolen Cognito token, (b) a legitimate premium user running a modified open-source client, (c) an anonymous person who just self-registered, (d) an attacker who owns the CI pipeline. Then ask of every control: *is it written as an enforceable rule an implementer cannot accidentally omit, or is it an intention?*
- **Adversary model:** no AWS-account compromise assumed. Assumed instead: the desktop client is fully attacker-controlled (the repo is public and the app is open source — every client-side rule is advisory), Cognito self-registration is open, and a valid access token is obtainable by anyone.
- **Date:** 2026-08-25
- **Verdict:** **CHANGES REQUESTED (blocking).** The paradigm is the right one — AD-1's server-side brokering, AD-3's authorizer-derived `sub`, AD-6's fail-closed invoke, and AD-8's server-owned model and output ceilings are a genuinely strong spine, and several of them are better than what comparable designs ship with. But the spine is **not yet safe to expose publicly**, for one recurring structural reason: **its cost and privacy invariants are stated at the Bedrock boundary, while the actual exposure sits in front of it and around it.** Five blocking findings: the privacy posture silently changes who controls the user's financial data with no consent path (**B1**); AD-11's content-statelessness invariant is *already violated* by the live code AD-9 wraps (**B2**); the quota unit does not bound cost, because input tokens are uncapped (**B3**); any self-registered account can exhaust the whole service's capacity and spend money the quota system never meters (**B4**); and the deploy design puts a second long-lived, IAM-mutating AWS key in GitHub with no approval gate (**B5**). Eleven majors follow, several of which are one template line each.

**Note on scope discipline:** every control this review *mandates* is zero-idle-cost (stage settings, IAM conditions, in-Lambda checks, existing DynamoDB items, AWS Budgets, template declarations). The one cost-bearing option (AWS WAF, ~fixed monthly) is raised only as an **optional** alternative and is never the sole recommendation for any finding. Nothing here asks for always-on compute, a staging stack, or a reconciler.

**Note on inheritance discipline:** premium hosted-AI capability is treated throughout as a DynamoDB-managed capability with no relationship to Keygen/LemonSqueezy licensing, per the spine's Inherited Invariants. No finding below depends on conflating them.

---

## Severity key

| Sev | Meaning |
| --- | --- |
| **S1** | Ship-blocking. Unbounded cost, an untrue privacy claim, or an exposure reachable by anyone on the internet. |
| **S2** | Must be closed before implementation hardens. A named control is missing or unenforceable as written. |
| **S3** | Fix before ship, but the shape of the architecture doesn't change. |
| **Nit** | Consistency/wording. |

**Verified-current AWS facts this review relies on** (retrieved 2026-08-25):

- Response streaming: Regional REST endpoints have a **5-minute idle timeout**, a 15-minute max stream, and — critically — *"When the connection between the client and API Gateway or between API Gateway and Lambda is closed due to timeout, the Lambda function might continue to execute."* Request streaming is **not** supported (the edge buffers the whole request). [Stream the integration response](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- Account-level API Gateway throttle default: **10,000 rps, 5,000 burst**, per Region, across all API types. [API Gateway quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html)
- Execution logging *"includes errors or execution traces (such as request or response parameter values or payloads)"*; Data tracing *"can result in logging sensitive data"* and AWS recommends against it in production. Authorization headers are redacted. [Set up CloudWatch logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html)
- A `COGNITO_USER_POOLS` authorizer is bound to a **user pool** (optionally one in another account), and *"The identity token is used to authorize API calls based on identity claims... The access token is used to authorize API calls based on the custom scopes."* [Control access with Cognito user pools](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html)
- `disableExecuteApiEndpoint` exists for REST APIs and returns `403` on the default endpoint. [Disable the default endpoint](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-disable-default-endpoint.html)
- Bedrock is **zero-data-retention and zero-operator-access by default**, but named models are exempt (retained up to 30 days), CSAM-flagged **image inputs are stored and reviewed** and blocked with a `ValidationException` (HTTP 400), *"You are responsible for the content you (and your end users) upload"*, and *"AWS may suspend your access to any model or Amazon Bedrock."* For cross-region inference, retained I/O is stored **in destination Regions**. [Abuse detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html)
- Granting an inference profile requires also granting the destination foundation-model ARNs — and AWS documents the **`bedrock:InferenceProfileArn` condition key** as the way to stop that grant from becoming direct model access, plus a `aws:RequestedRegion = unspecified` Deny to block Global routing. [Inference profile prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)

---

# S1 — Blocking

## B1 — AD-9 silently changes who controls the user's financial data, with no consent and no opt-out — S1 (privacy)

**The finding.** AD-9's Rule: *"Hosted Bedrock has highest precedence whenever a signed-in premium user has quota, **even over an explicitly configured OpenAI provider**."* The companion is blunter: *"no user-facing toggle"* and *"a deliberate override of user provider choice."* Deferred then removes the last visibility: *"Any status/quota UI (e.g. a premium badge)… v1 has no status UI at all."*

Compose those three and the result is precise: **on the release where this ships, a premium user's bank statements, transaction history, and financial questions stop flowing to the AWS account they chose and start flowing to Nixus's AWS account — silently, with no indicator, no toggle, and no way to decline while remaining premium.** The data controller changes. Under BYO, Nixus never held the content; after this, Nixus is the party responsible to AWS for it (see B-fact above: *"You are responsible for the content you (and your end users) upload"*), and content transits multiple US Regions via the `us.` cross-region profile.

This is not a hypothetical mismatch with the product's positioning. `README.md` states *"your data never leaves your machine"* and *"AI import requires your own API credentials (stored in your OS keychain)."* Both become false for premium users. NFR3 in the companion reads *"Privacy: no financial content… is ever persisted in DynamoDB or CloudWatch"* — which is a **retention** guarantee, and the spine has quietly substituted it for a **transmission/controllership** guarantee it never makes.

Why the existing rules don't cover it: AD-11 governs persistence, not who receives the content. AD-1 governs credentials, not data flow. Nothing in the spine requires the user to know, agree, or be able to refuse.

**AD to add — AD-13 (Consent and disclosure gate for hosted content):**
> **Binds:** the first hosted invocation for any user, and AD-9's precedence evaluation.
> **Prevents:** financial content leaving the user's own provider account for Nixus's AWS account without the user's knowledge or a way to decline.
> **Rule:** `HostedBedrockAdapter` may not be selected until a persisted, per-install consent record exists that names (a) Nixus's AWS account as the processor, (b) Amazon Bedrock as the sub-processor, (c) the `us.` cross-region profile's US destination Regions, and (d) the no-retention posture with its stated exceptions. Consent is obtained once, is revocable, and is stored locally (not in DynamoDB — no new content-adjacent server state). AD-9's precedence rule reads: hosted wins **only when consent is present and not revoked**; a revoked or absent consent makes hosted ineligible and the prior configured provider authoritative — which is the fallback path AD-9 already defines, so this adds a predicate, not a new code path.

**Additional required amendments:**
1. **AD-9's Rule** gains the consent predicate above, so "no user-facing toggle" is scoped to *provider selection among consented providers* — its actual intent — rather than reading as "no way to decline."
2. **Deferred** must stop deferring the *disclosure* while deferring the *badge*. Split the entry: a quota/premium **badge** stays deferred; the consent/disclosure surface is **not** a status UI and is in scope.
3. Add a ship gate to Deferred or Conventions: the public privacy statement and `README.md` claim must be updated in the same release, since both are currently contradicted.

**Why S1:** this is the one finding where the architecture as written would make a published privacy claim untrue for real users' financial records. Cheap to close — one predicate and one local record.

---

## B2 — AD-11's content-statelessness invariant is already violated by the live code AD-9 wraps — S1 (privacy)

**The finding.** AD-11 binds *"all logging and persistence in **this feature**"* and prevents *"any prompt, response, financial content, attachment, or **file name/path** landing in DynamoDB or CloudWatch."* AD-9 then routes all four existing surfaces through the new `AiBackend` port. So AD-11 binds code paths that exist today — and two of them break it right now:

- `apps/desktop/src-tauri/src/ai/cc_parser.rs:191-196` — `info!("Sending file to Bedrock: {} ({} bytes, type: {})", file_path, …)` logs the **local file path** of the user's statement. AD-11 names file names/paths explicitly.
- `apps/desktop/src-tauri/src/ai/cc_parser.rs:284` — on a JSON parse failure the raw model output is embedded in the error value: `AppError::AiService { message: format!("Failed to parse AI response: {}. Raw: {}", e, output_text), … }`. That string is then (a) logged at `apps/desktop/src-tauri/src/commands/import.rs:370-378` and (b) emitted to the frontend and **rendered verbatim to the user** at `apps/desktop/src/routes/import.tsx:1021`. `output_text` for `statement_import` is *the extracted transaction list* — the most sensitive payload in the product.

So the spine asserts an invariant that the code it binds violates on a path the spine itself is re-routing. An implementer following AD-11 literally will apply it to the *new* Lambda and shared-contract code and quite reasonably not treat a pre-existing `cc_parser.rs` log line as in scope — the retrofit is described as a port introduction, not a logging audit. The invariant then ships false.

The fix pattern already exists in the repo: chat, project advice, and trends insight all surface generic i18n error copy and never render `AppError.message` for AI failures (`useChat.ts:178-190`, `TrendsInsightPanel.tsx:106-125`, `ProjectDetail.tsx:265-279`). Only the import path was never brought in line.

**AD-11 — amend the Rule** (add, verbatim):
> Retrofitting the four surfaces onto `AiBackend` (AD-9) includes bringing their **existing** log and error paths into compliance: no AI call site may log an attachment path or file name, and no `AppError` message may embed model output, prompt text, or provider response bodies. Named remediation targets: `ai/cc_parser.rs` (attachment-path log; raw `output_text` in the parse-failure `AppError`) and the `import:error` → UI passthrough in `commands/import.rs` / `routes/import.tsx`, which must adopt the generic-copy pattern the chat and advice/insight surfaces already use. Compliance with this rule is a precondition for the hosted adapter shipping, not a follow-up.

**Why S1:** AD-11 is the load-bearing privacy invariant of the whole feature, and it is provably false against `main` on the exact surface (`statement_import`) that handles the most sensitive content.

---

## B3 — One quota unit does not bound cost: input tokens are uncapped, and there is no account-level ceiling — S1 (denial-of-wallet)

**The finding.** AD-5 fixes the unit: *"one quota unit = one Bedrock invocation."* AD-8 caps *"per-operation **output**-token ceiling"* as a server constant. The companion's ceilings table caps **serialized JSON size** — chat at 1 MiB — and output tokens at 4096.

Nothing caps **input tokens**. 1 MiB of prose is on the order of 250,000 input tokens. At Claude Sonnet-class input pricing that is roughly a dollar of input per single request, against 4096 output tokens costing a small fraction of that. A well-behaved chat turn costs perhaps a tenth of a cent. **So one "quota unit" spans roughly three orders of magnitude of real cost, and the client — which is open source and fully attacker-controlled — picks where in that range each unit lands.** A premium user with `monthly_request_limit = 500` is not authorized to spend a predictable amount; they are authorized to spend anywhere from a few cents to several hundred dollars, at their sole discretion.

The companion already saw the hole and closed the wrong half: *"AD-8's server-owned output-token ceilings and AD-5's per-invocation quota unit both exist as independent controls — either one alone would leave a gap the other closes."* The memlog is even more explicit (`:34`): *"monthly request quota is not the sole denial-of-wallet control."* Both statements are true and both controls are on the **output** side. The input side has one control — a byte ceiling — and bytes are the wrong unit for a token-priced service.

Second half of the finding: **there is no aggregate ceiling anywhere.** Per-user quotas multiply by the number of premium users, and premium is granted by hand-editing DynamoDB (AD-6, FR3). A mis-typed `monthly_request_limit` (an extra zero) or a compromised premium account has no backstop — no global cap, no kill switch, no budget alarm. The companion lists a CloudWatch alarm only under *"Nice-to-Have Gaps."* For the single cost driver the companion itself calls *"the dominant, unbounded-if-uncapped cost,"* a nice-to-have is the wrong tier.

**AD-8 — amend the Rule** (add):
> A per-operation **input-token ceiling** is a server constant alongside the output ceiling. The Lambda computes input tokens before invoking Bedrock (via `CountTokens` or an equivalent server-side estimate over the finalized `messages`/`system`/`media`) and rejects over-ceiling requests `413 payload_too_large` **without reserving quota and without calling Bedrock**. The byte ceilings remain as a cheap pre-filter; they are not the token control. Any change to the model constant or to either token ceiling is a deliberate cost decision and is recorded as such.

**AD-5 — amend the Rule** (add):
> Alongside the per-user reservation, the same `TransactWriteItems` increments a **global period counter** (`pk=GLOBAL`, `sk=USAGE#<YYYY-MM>`) and fails closed `429` when it reaches a server-owned account-wide monthly invocation ceiling. A `GLOBAL#CONFIG` item carries an `enabled` flag the invoke path reads and honours as an immediate, console-editable **kill switch** for all hosted AI. Both are zero-idle-cost items in the existing table and add no request to the hot path.

**Conventions — add:** an AWS Budgets monthly cost budget with an alarm action on the Bedrock/API Gateway spend for this stack. Zero-idle-cost, and it is the only control that catches a mistake in the two ceilings above.

**Why S1:** the spine's stated cost model ("quota bounds spend") is not true as written, and the gap is client-controlled on a public endpoint.

---

## B4 — Anyone who self-registers can exhaust the entire service and spend money the quota system never counts — S1 (DoS + denial-of-wallet)

**The finding.** Three facts compose badly:

1. **Registration is open.** `architecture-login.md:31` — *"User can create a Cognito account (email/password) or sign in with Google"* — with no MFA, no documented email-verification gate, and no invite/allowlist anywhere in that document. Anyone on the internet can hold a valid token for this pool.
2. **The scope is granted at the app-client level, not per user.** AD-3 requires scope `nixus-api/ai.invoke`; AD-6 makes *premium* the entitlement. So **every** self-registered account passes the authorizer on both routes. Premium only gates what happens *after* the Lambda is already running.
3. **AD-4 sets `reserved concurrency 10` on one Lambda serving both routes, with a 300s timeout.**

Therefore: a non-premium attacker with one freshly registered account, or a hundred of them, can hold all 10 concurrency slots and **deny hosted AI to every paying premium user**, while incurring per-request API Gateway charges, Lambda invocations, and a strongly consistent DynamoDB `GetItem` per request (AD-6's enforcement sequence reads `CONFIG` *before* deciding entitlement) — **none of which the quota system meters, because the quota counter is only touched after the premium check passes.** `GET /v1/ai/status` is worse: AD-6 makes it return `200` for non-premium users, so it is an unlimited, free, authenticated read for anyone in the pool.

And there is no throttle anywhere. The spine's Stack Seed and Conventions name none; the memlog names none (no entry addresses throttling, WAF, or rate limiting); and the inherited convention is actively wrong for this service — `architecture-entitlements-licensing.md:158` says *"Default API Gateway throttling is sufficient at this volume — no custom rate limiting needed yet."* Default throttling is **10,000 rps account-wide**, shared with `apps/web`'s API surface if one ever exists. Inheriting a webhook bridge's throttle posture onto a cost-bearing AI gateway is the specific inheritance error here.

**AD-2 — amend the Rule** (add):
> The stage declares explicit `MethodSettings` throttles as named server constants — a per-method `ThrottlingRateLimit`/`ThrottlingBurstLimit` sized to the reserved concurrency, not the account default. The account-level 10,000 rps default is never relied on as this API's rate control.

**AD-6 — amend the Rule** (add):
> Entitlement is checked in cheapest-first order, and a **per-`sub` in-flight and short-window request cap** is enforced in the same `TransactWriteItems` as the reservation, so no single subject can occupy the Lambda's reserved concurrency. `GET /v1/ai/status` is rate-limited per `sub` independently of the invoke quota, so a non-premium subject cannot generate unbounded billable reads.

**AD-3 — amend the Rule** (add):
> The resource-server scope is an authentication fact, not an entitlement. Because pool registration is open, every route must assume an arbitrary internet user holds a valid scoped token, and no cost-bearing or unbounded work may occur before the premium/quota decision.

**Optional, cost-bearing, explicitly not mandated:** an AWS WAF rate-based rule on the stage adds per-IP throttling ahead of API Gateway billing. It carries a fixed monthly charge and therefore violates the near-zero-idle-cost constraint; list it under Deferred with that trade-off stated rather than adopting it.

**Why S1:** reachable by anyone, denies service to paying users, and spends money outside the metering system entirely.

---

## B5 — The deploy design puts a second long-lived, IAM-mutating AWS key in GitHub with no approval gate — S1

**The finding.** AD-12's Rule: auto-deploy on push to the default branch *"using a separately scoped SAM deploy IAM principal."* The companion is concrete: *"a new, separately scoped `AWS_INFRA_DEPLOY_ACCESS_KEY_ID`/`SECRET` pair."* The memlog (`:32`) confirms the intent is to *"reuse the existing `web-ci.yml` pattern."*

What that pattern actually is, verified: `web-ci.yml:131-135` uses `aws-actions/configure-aws-credentials@v4` with static `secrets.AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — **no `role-to-assume`, no OIDC**. The file has **no `permissions:` block at all** (`release.yml` does, at `:22-23` — so the repo already knows the pattern). The deploy job is gated only on a branch-name conditional (`web-ci.yml:101-106`); there is **no `environment:` key**, hence no required reviewers and no approval.

Copying that onto this service is materially worse than the CDN key, because of what a SAM deploy principal must hold. `sam deploy` creates the Lambda execution role, the API Gateway resources, and the DynamoDB table — so the principal needs `iam:CreateRole`, `iam:AttachRolePolicy`/`PutRolePolicy`, and `iam:PassRole`. **A credential that can create a role and attach a policy to it is equivalent to account takeover**, regardless of how narrowly the rest of it is scoped. AD-12 says "separately scoped," which is true and insufficient: separating it from the CDN key limits lateral movement *from* the web pipeline while creating a strictly more powerful credential in the same secret store, reachable by the same set of people, with no approval step. And it is the credential that controls the entitlement enforcement path from B3/M1.

Second exposure: AD-12 says the pipeline *"verifies every PR (install, lint/typecheck/test, `sam validate`, `sam build`)."* `sam build` runs a dependency install, which executes lifecycle scripts from whatever the PR's lockfile resolves to. The verify job must therefore hold no AWS credentials and run with a frozen lockfile and scripts disabled — otherwise a PR is an arbitrary-code-execution path in a job that may sit adjacent to deploy secrets.

**AD-12 — replace the Rule:**
> A dedicated `.github/workflows/api-bedrock-ci.yml` verifies every PR and auto-deploys on push to the default branch. Authentication to AWS is **GitHub OIDC (`role-to-assume`)** with a trust policy conditioned on this repository and the default branch ref; **no long-lived AWS access key is created for this service.** The assumed role's own privilege is confined to `cloudformation:*` on this one stack plus `iam:PassRole` to a dedicated CloudFormation service role, and that service role creates IAM roles only under a **permissions boundary** — the deploy principal never holds `iam:CreateRole`/`iam:AttachRolePolicy` directly. Every workflow declares an explicit least-privilege `permissions:` block. The deploy job runs in a GitHub **Environment** whose protection rules (and default-branch protection) are a stated precondition of the auto-deploy posture. The PR verify job receives **no AWS credentials**, installs with a frozen lockfile and lifecycle scripts disabled, and is triggered by `pull_request` (never `pull_request_target`).

**Why S1:** this is the credential that owns the enforcement path. It is also the cheapest blocker to fix, and the right moment is now — before the second static key pair is provisioned.

---

# S2 — Major

## M1 — The principal that enforces entitlement can rewrite its own entitlement — S2

AD-6 puts `sk=CONFIG` (`premium`, `monthly_request_limit`) and `sk=USAGE#<YYYY-MM>` in **one table** under **one partition key**. Conventions grant the Lambda role `GetItem`/`TransactWriteItems`/`UpdateItem` **on that table**. DynamoDB IAM cannot scope writes by sort key. Therefore the invoke path — the code that decides whether a caller is premium — holds an unconditional write path to the record that answers that question. AD-5's refund is an `UpdateItem`; one wrong key builder in `lib/quota.ts`, or one injection into the key path, mutates `CONFIG` instead of `USAGE#`, and the failure mode is *self-granted unlimited premium*, silently. There is no audit trail: entitlement is granted by hand-editing the item (AD-6, FR3), and CloudTrail data events for DynamoDB are off by default, so a programmatic `CONFIG` mutation is indistinguishable from an admin edit.

**AD-6 — amend the Rule:** the enforcement input must not be writable by the enforcing principal. Either (a) move `CONFIG` to a second table on which the Lambda role holds **`GetItem` only**, with writes made exclusively out-of-band by an administrator, or (b) keep one table and constrain every write statement with a `dynamodb:Attributes` condition that excludes `premium` and `monthly_request_limit`. State which, and state that the role holds no `PutItem`, `DeleteItem`, `Scan`, or `Query`. Also enable CloudTrail data events for the entitlement table so a `CONFIG` change is attributable.

## M2 — The authorizer accepts more tokens than AD-3 assumes — S2

AD-3's Rule: *"Cognito user-pool authorizer validates the access token and derives `sub` from verified context; token must carry resource-server scope `nixus-api/ai.invoke`."* Two gaps against documented behaviour:

1. A `COGNITO_USER_POOLS` authorizer is bound to a **user pool**, not an app client, and AWS documents the pool may even be *"owned by another AWS account."* It performs **no `client_id` allowlisting.** Any app client on this pool that can obtain the scope produces a token this API accepts — so adding, say, a web app client to the same pool later silently grants it Bedrock spend. The spine treats the scope as the boundary; the pool is the boundary.
2. The scope is only enforced where `AuthorizationScopes` is configured **on the method**. Absent it, the same authorizer accepts an **ID token** (*"The identity token is used to authorize API calls based on identity claims… The access token… based on the custom scopes"*). AD-3 says "every API route" but names no mechanism, so an implementer wiring `GET /v1/ai/status` (or a CORS `OPTIONS`) without `AuthorizationScopes` produces a route that accepts an ID token — which the desktop already holds (`architecture-login.md:111`).

**AD-3 — amend the Rule:** `AuthorizationScopes: [nixus-api/ai.invoke]` is declared on **every** method of the API, and a method without it is a template defect. As defense in depth the Lambda asserts, from authorizer claims, that `token_use == "access"`, that `client_id` is in a server-owned allowlist, and that the scope is present — deriving `sub` only after all three pass.

## M3 — AD-11 is not enforceable at the AWS layer, and the 14-day retention claim is false by default — S2

AD-11 forbids content in CloudWatch, and Conventions state *"structured CloudWatch JSON logs, no request/response bodies, 14-day retention."* Both are written as properties of *Nixus's application code*. Every mechanism that would actually violate them is a **stage or account setting outside the handler**, and the spine names none:

- **API Gateway execution logging** *"includes… request or response parameter values or **payloads**"*, and **Data tracing** *"can result in logging sensitive data"* (AWS recommends against it in production). Either can be flipped in the console, post-deploy, by someone who has never read AD-11 — and AD-11 would silently become false. (Credit where due: Authorization headers *are* redacted by API Gateway, so the Bearer token does not leak this way.)
- **Log-group retention.** Lambda auto-creates `/aws/lambda/<fn>` with **Never Expire** if the template doesn't declare it, and API Gateway auto-creates `API-Gateway-Execution-Logs_{id}/{stage}` the same way. So *"14-day retention"* is true only for log groups the template explicitly declares — as written, the claim is likely false for both groups that matter.
- **Access log `Format`** is a free-text field; `$input.body` in it puts request bodies in CloudWatch.
- **X-Ray** subsegment metadata can capture payloads if tracing is enabled with default instrumentation.
- **Bedrock model invocation logging** is an account-level Bedrock setting that persists prompts and completions to CloudWatch/S3. It is entirely outside this stack and would defeat AD-11 wholesale.
- **The model constant is a privacy dependency.** Bedrock is ZDR/ZOA *by default*, and `us.anthropic.claude-sonnet-4-6` is not on the documented retention-exempt list — so AD-11 currently holds upstream, which is worth crediting. But named models *are* exempt (30-day retention, one requiring opt-in to provider sharing), and for cross-region inference retained I/O is stored **in destination Regions**. A future model swap in AD-8 could therefore silently break AD-11 with no code change.

**AD-11 — amend the Rule** (add): the template declares `AWS::Logs::LogGroup` for the Lambda **and** for API Gateway access logs with `RetentionInDays: 14`, and sets retention on the API Gateway execution log group. Stage `MethodSettings` set `DataTraceEnabled: false` and `LoggingLevel: ERROR`. The access-log `Format` is a fixed, content-free `$context` allowlist and never references request or response bodies. X-Ray is either disabled or configured with no payload capture. Bedrock **model invocation logging must be off** for this account/Region, asserted as a deploy precondition. Any change to AD-8's model constant requires re-verifying that model's Bedrock retention posture before it ships.

**AD-11 — also scope the claim honestly:** state that content statelessness is an invariant over **Nixus-controlled systems**, and that AWS retains flagged image inputs for CSAM review and may retain I/O for specific models — otherwise the invariant reads as a guarantee Nixus is not in a position to make.

## M4 — Request size and decompression: the ceilings are not enforceable in the order the spine implies — S2

AD-8's ceilings (companion table: 1 MiB chat JSON, 4 MiB raw media) are checked **in the Lambda**. Four problems:

1. **The edge does not help.** Request streaming is not supported, so API Gateway buffers and bills the full request — up to the REST 10 MB limit — before the handler sees a byte. The 1 MiB ceiling never prevents a cost; it only prevents a Bedrock call. Combined with B4 (no throttle) this is a cheap amplifier.
2. **No ordering rule.** AD-8 says the Lambda *"enforces payload/size ceilings"* without saying **when**. An implementer who validates after `JSON.parse` and after base64-decoding a media array has already spent the memory and CPU. The rule must be: reject on raw byte length **before** parse or decode.
3. **`Content-Encoding` is unaddressed anywhere in either document or the memlog.** If the handler (or a middleware) honours `Content-Encoding: gzip`, every byte ceiling above becomes a *compressed* ceiling — a 1 MiB gzip body expands to hundreds of MiB against a 512 MB Lambda, and the token ceiling from B3 is bypassed by the same factor. This is a one-line control and it is missing.
4. **"4 MiB raw pre-base64" is not a server-side rule.** The server only ever sees encoded bytes; *"rejected… before base64 encoding"* describes a client-side check, and the client is untrusted. Also, `media` is an **array** with no cap on element count — N × 4 MiB is bounded only by the 10 MB edge limit, not by the stated ceiling.

**AD-8 — amend the Rule:** ceilings are enforced against `Content-Length` and raw body byte length **before** `JSON.parse` and before any base64 decode, returning `413` with no reservation and no Bedrock call. Any request carrying a `Content-Encoding` header is rejected `400`; the Lambda never decompresses a request body. Media is capped by **decoded byte length derived from the base64 length** (no allocation) *and* by a maximum element count, both server constants. A per-operation media MIME/format allowlist is a server constant.

## M5 — Refund is not idempotent, has no floor, and can land in the wrong month — S2

AD-5: *"refund the same period only on failure before the first valid Bedrock event is received."* The companion: *"a second, targeted `UpdateItem` against the same `USAGE#` item"*, with *"`YYYY-MM` is computed in UTC at request time."* Four concrete defects:

1. **Month-boundary refund.** "Computed at request time" plus two computations (reserve, refund) means a request that reserves at `23:59:59.9` on the last day of the month and fails at `00:00:00.1` refunds **next month's** item — creating a negative count that is free quota. AD-5's *"the same period"* gestures at this; it must be stated as a mechanism.
2. **No floor.** An unconditional decrement can drive `request_count` below zero. A refund bug then hands out unbounded free invocations rather than failing loudly.
3. **Not idempotent, and not gated on having reserved.** Nothing states that only a request that *actually completed a reservation* may refund, or that a refund executes at most once. A retried or double-invoked handler (Lambda at-least-once behaviour on some paths) refunds twice.
4. **Cost continues after the client leaves.** AWS documents that when the client↔API Gateway or API Gateway↔Lambda connection closes on timeout, *"the Lambda function might continue to execute."* So an abandoned request still burns the full output-token budget and a concurrency slot with no cancellation — which is correct per AD-5 (charged after `meta`) but should be **stated**, because an implementer may otherwise add a "refund on client disconnect" path that is a free-invocation exploit.

**AD-5 — amend the Rule:** the period key is computed **once** per request and both the reservation and the refund address that captured key. The reservation records a marker (e.g. `client_request_id` under a reservation attribute) and the refund is conditional on that marker being present and unconsumed, making it idempotent and impossible without a prior reservation. The refund's condition expression requires the counter to remain `>= 0`; a violated condition is logged as an accounting defect, never retried blindly. Client disconnect is explicitly **not** a refund trigger.

## M6 — Cross-user leakage on both sides of the boundary — S2

**Lambda side:** nothing in the spine forbids module-scope caching of per-user data. Warm-container reuse across users is the standard Lambda leak: a `CONFIG` or status object cached at module scope in `lib/table.ts` serves user A's `premium`/`monthly_request_limit` — and, if the status handler shares it, A's `request_count` — to user B on the same container. AD-6's *"consistent read CONFIG"* implies a per-request read but does not forbid the cache, and an implementer optimizing the strongly consistent read is being *helpful* when they add one.

**Desktop side:** `HostedAiState` is *"a process-wide `HostedAiState`"* holding *"the last-known `/v1/ai/status` response."* The rules cover logged-out (no call) and login (refresh once) — but **nothing clears it on sign-out or on a session change to a different `sub`.** The app supports sign-out and sign-in without restart, and `credentials.rs` sign-out is a local keyring wipe (`architecture-login.md:114`). So user A's premium status, limit, and consumption remain in memory and govern AD-9's precedence for user B until the 5-minute staleness window elapses.

**AD-11 — amend the Rule** (add): the Lambda holds **no per-user state at module scope**; every entitlement, usage, and status value is request-scoped. Module scope is reserved for stateless clients and constants.

**AD-10 — amend the Rule** (add): `HostedAiState` is keyed by the `sub` it was fetched for, is cleared on sign-out and on any session change, and a cache entry whose `sub` does not match the current session is treated as absent.

## M7 — The server owns the model but not the prompt, and there is no guardrail — S2

AD-8 makes model and output ceilings server constants and the operation enum closed — good. But *"Desktop sends finalized messages/system/media"*, and the companion confirms *"the Lambda does not re-derive prompts, it forwards them to Bedrock."* Since the client is open source and attacker-controlled, `operation: "chat"` plus an arbitrary `system` and `messages` means **the server enforces cost but not purpose.** Consequences that belong in the spine:

- The premium entitlement is a general-purpose LLM proxy. Cost is bounded (once B3 is fixed); *use* is not.
- Nixus's AWS account carries the Bedrock AUP exposure for content it never inspects. Per AWS: *"You are responsible for the content you (and your end users) upload"*, image inputs may be **stored and reviewed** for CSAM with a report filed to NCMEC, and *"AWS may suspend your access to any model or Amazon Bedrock"* on non-response to an abuse inquiry. That last one is a single-point-of-failure for the whole premium tier.
- Bedrock **Guardrails** are not mentioned anywhere in the spine, companion, or memlog — the one server-side content control available at this boundary is simply absent.

**AD-8 — amend the Rule:** the **system prompt is a server constant per operation**, not client input; the client supplies conversation turns and media only, and a client-supplied `system` field is rejected (or ignored) rather than forwarded. A Bedrock **guardrail identifier is a server constant** applied to every invocation. If either is deliberately declined for v1, that is an explicit Deferred entry naming the accepted AUP and account-suspension risk — not a silence.

**Conventions — add:** the AWS account's contact address must be monitored, since AWS routes abuse inquiries there and non-response escalates to suspension.

## M8 — IAM is broader than the spine's own intent — S2

Three concrete over-grants:

1. **`logs:*`.** The companion grants *"`logs:*` (CloudWatch)"* while the spine says *"scoped to CloudWatch Logs."* `logs:*` includes `DeleteLogGroup`, `DeleteLogStream`, and `PutRetentionPolicy` — a compromised or buggy function can destroy its own audit trail (directly undermining M3's retention rule and any billing-dispute forensics) and read log groups belonging to other services in the account.
2. **Foundation-model ARNs granted without the documented condition.** Cross-region profiles require granting the destination foundation-model ARNs — but AWS documents `bedrock:InferenceProfileArn` as the condition key that keeps that grant from also being **direct** model access outside the profile. Without it, the role can invoke those models directly, which defeats the point of pinning a profile.
3. **No Region bound.** AWS documents a `Deny` on `aws:RequestedRegion = "unspecified"` to block Global inference-profile routing. Without it, a future edit of AD-8's model constant to a `global.` profile silently widens where the user's financial content is processed — which is exactly the data-residency fact B1 requires Nixus to disclose.

**Conventions — replace the IAM line:** `logs:CreateLogStream` and `logs:PutLogEvents` on the function's **own log-group ARN only** (no `logs:*`, no log deletion, no retention mutation). `dynamodb:GetItem`/`TransactWriteItems`/`UpdateItem` on the named table ARN only — no `Scan`, `Query`, `PutItem`, `DeleteItem`, no `/index/*`, and no `dynamodb:*` — subject to M1's `CONFIG` separation. `bedrock:InvokeModelWithResponseStream` (never `InvokeModel*`) on the inference-profile ARN, plus the **explicitly enumerated** destination foundation-model ARNs — no Region or model wildcard — each conditioned on `bedrock:InferenceProfileArn` matching the approved profile, with a `Deny` on `aws:RequestedRegion = "unspecified"`.

*(Credit: the spine already grants only the streaming action rather than `InvokeModel*`, which is tighter than AWS's own example policy.)*

## M9 — Custom domain, TLS, and the client's transport policy are all unspecified — S2

The custom domain appears only in the companion's *"Important Decisions"* and step 6 (*"if a Route53 hosted zone/ACM certificate… already exist"*). No memlog entry addresses domain, TLS, or certificates at all. Four missing controls:

1. **`disableExecuteApiEndpoint` is not set.** Once `api.nixusapp.com` exists, the default `execute-api` URL remains fully live unless disabled — so any client-side host allowlist or future domain-level control is trivially bypassed. AWS documents the exact setting and its `403` behaviour.
2. **No minimum TLS policy** is declared on the `DomainName`. It must be pinned in the template, not inherited from whatever the default is at create time.
3. **The client has no transport policy to inherit.** Verified: the repo's only explicit `reqwest` timeouts are in `commands/auth.rs:454-455,856-857`; other call sites use bare `reqwest::Client::new()` with no timeout, and there is **no shared HTTP-client factory**. So the hosted adapter will get whatever its author writes. It must set its own timeout, and — critically — **refuse to follow redirects**: `reqwest`'s default redirect policy would forward the `Authorization: Bearer` header on a cross-host 3xx, turning any misconfiguration or DNS compromise into token exfiltration. *(Credit: `Cargo.toml:43` pins `rustls-tls` with `default-features = false`, and nothing anywhere sets `danger_accept_invalid_certs` — a good baseline.)*
4. **The base URL must be a compile-time constant in release builds.** If it is env- or config-overridable, a modified client or tampered config points a valid Cognito token at an attacker-controlled host.

**AD-2 — amend the Rule** (add): if a custom domain is used, `disableExecuteApiEndpoint` is set so the default `execute-api` endpoint is unreachable, and the `DomainName` declares an explicit minimum TLS policy. **AD-10 — amend the Rule** (add): the hosted adapter's HTTP client sets an explicit request timeout, **disables redirect following**, and targets a base URL that is a compile-time constant in release builds — never an env or config override.

## M10 — Error detail leakage has no owner, and one Bedrock error class is silently misclassified — S2

- **`error.message` is unowned.** AD-7 defines the frame as `error` with `code` and `message`; the companion's table defines the six `code` values but never says who authors `message`. If it carries an upstream Bedrock/AWS SDK string, it can echo the offending input (violating AD-11 in-band), reveal the model ID or an ARN, or expose throttling and IAM-denial detail. The existing codebase makes this the *likely* outcome, not a hypothetical: `ai/cc_parser.rs:259-265` already does `format!("Bedrock API error: {:?}", e)`, and that string reaches the UI (see B2). The companion's *"never surfaces the raw code or an upstream Bedrock error string to the user"* is a desktop-side aspiration with no server-side rule behind it.
- **CSAM blocks are misclassified.** Bedrock returns `ValidationException` (HTTP 400) when it blocks apparent CSAM in an image input — indistinguishable, under the companion's mapping, from a malformed body. It maps to `validation`/`400`, gets no distinct log signal, and no one is alerted to an event that carries reporting obligations and an account-suspension path.
- **API Gateway's default gateway responses** (e.g. `Missing Authentication Token`, authorizer failure bodies) leak authorizer shape to unauthenticated callers.
- **`client_request_id`** is client-supplied, logged, and unvalidated — a log-injection and log-volume vector. Separately, `$context.requestId` is client-overridable via `x-amzn-RequestId` (AWS-documented); `$context.extendedRequestId` is not.

**AD-7 — amend the Rule** (add): both the `error` frame's `message` and every pre-output error body are **server-owned constants selected by `code`** — never an upstream provider string, never an exception message, never a stack trace. The Lambda's log serializer emits an allowlist of fields (`name`, `code`, `http_status`, `request_id`) and never interpolates a payload or an SDK error object. A Bedrock content-policy/AUP rejection maps to a **distinct internal code** with its own log event and alarm, not to `validation`. API Gateway `GatewayResponses` are overridden with content-free bodies. `client_request_id` is validated as a UUID and length-capped before it is logged.

## M11 — Stolen-token blast radius is undefined, and revocation is deferred upstream — S2

The token is a bearer credential with no proof-of-possession, and this feature converts token theft into **direct spend from Nixus's account**, which BYO never did. What the login architecture actually provides, verified: no access/ID/refresh token TTLs are stated anywhere (`architecture-login.md` gives only the JSON shape at `:111`); refresh-token rotation is *"not enabled for v1"* (`:102`); server-side revocation via `/oauth2/revoke` is *"deferred"* (`:114`) and sign-out is a **local keyring wipe only**. Consequence: **an exfiltrated refresh token remains valid after the user signs out**, and there is no sign-out-everywhere. Contributing factor from the same document: the loopback redirect is a **fixed, non-OS-assigned port** (`http://127.0.0.1:52847/callback`, `:391`) because Cognito's allow-list requires exact matches — a known local-interception surface that document does not address — and the superseded `nixus://auth/callback` handler is left wired (`:392`).

Those are `architecture-login.md`'s decisions to make, and this review does not reopen them. What belongs **here** is the consequence and the one control this feature does own: **AD-6's fail-closed invoke path makes `premium=false` an immediate, effective kill switch for a compromised account** — genuinely good, and better than a token-revocation-only design, because it takes effect on the very next invoke regardless of token validity. It is currently implicit.

**AD-10 — amend the Rule** (add): hosted AI inherits the Cognito refresh-token blast radius, and because rotation and server-side revocation are deferred upstream, **`CONFIG.premium = false` is the designated incident control for a compromised account** — effective on the next invoke via AD-6's fail-closed read, independent of token validity and independent of the status cache (which AD-9 already invalidates on `403`/`429`). The spine records the access-token lifetime it assumes, since that value bounds the window in which a stolen token can spend; a change to it upstream is a change to this feature's risk.

---

# S3 — Minor

| # | Finding | Fix |
| --- | --- | --- |
| **m1** | **Lambda timeout equals the platform idle timeout.** AD-4 sets 300s; AWS documents the Regional streaming **idle** timeout as exactly 5 minutes (max stream 15 min). Zero headroom means a slow model turn is indistinguishable from a hang, and per AWS the Lambda keeps running after the connection drops (M5.4). | State the relationship in AD-4: set the Lambda timeout below the 5-minute idle timeout so the function's own timeout always fires first and is observable. |
| **m2** | **`429` is ambiguous, and AD-9 turns that into an amplifier.** Lambda throttling under AD-4's reserved concurrency surfaces as a `429`/`5xx` with **no NDJSON body** — indistinguishable from `quota_exhausted`. AD-9 invalidates `HostedAiState` on *any* `429`, so a throttling storm makes every client re-fetch `/v1/ai/status` through the same saturated Lambda: load-induced cache invalidation amplifying load. | Distinguish platform throttling from quota exhaustion (an explicit `hosted_unavailable` mapping for a bodyless `429`/`5xx`), and invalidate the cache only on a `429` that carries the `quota_exhausted` code. |
| **m3** | **No entitlement audit trail.** Premium is granted by hand-editing DynamoDB (AD-6, FR3). CloudTrail data events for DynamoDB are off by default, so grants, limit changes, and any programmatic `CONFIG` mutation (M1) are unattributable. | Enable CloudTrail data events for the entitlement table. Zero idle cost, and it is the only evidence source for a billing dispute. |
| **m4** | **AD-1's scope vs. existing ambient credentials.** AD-1 reads *"the desktop never holds an AWS credential"* as an absolute, but `ai/mod.rs` builds BYO clients from keyring credentials with an ambient-credential fallback for the default dataset. AD-1 means the **hosted** path; as written it reads as a claim about the whole app and an implementer could "fix" the wrong thing. | Scope AD-1's Rule to the hosted path and state that BYO/ambient credentials remain the user's own, unchanged by this feature. |
| **m5** | **14-day retention vs. billing forensics.** For an endpoint that spends money, 14 days is short for reconstructing a disputed month or a slow abuse pattern. | Either keep 14 days and state the accepted trade-off, or retain the (content-free, per AD-11) usage log longer than the operational log. |
| **m6** | **No alarms on the two signals that indicate abuse.** The companion lists a CloudWatch alarm on `hosted_unavailable`/`quota_exhausted` rates only as *"Nice-to-Have."* With B3/B4 open these are the detection layer, not a nicety. | Promote to Conventions alongside the AWS Budgets alarm from B3: alarms on `429` rate, `403` rate, and Bedrock invocation volume. All within free-tier alarm counts. |

---

# Nits

- **n1** — Spine Conventions say the role is *"scoped to CloudWatch Logs"*; the companion says `logs:*`. The two documents disagree on a security boundary (see M8). Make the spine's wording the enforceable one.
- **n2** — Key-shape drift: `.memlog.md:35` records `USAGE#<sub>#<YYYY-MM>` while AD-6 specifies `pk=USER#<sub>` / `sk=USAGE#<YYYY-MM>`. AD-6 is right; the memlog line will mislead anyone resuming from it.
- **n3** — The companion states *"TLS terminates at API Gateway; no additional application-layer encryption is needed for a Bearer-token-authenticated **internal** API."* This API is not internal — it is a public, unauthenticated-until-the-authorizer internet endpoint. The conclusion is fine; the reasoning shouldn't establish an "internal" mental model for the implementer.
- **n4** — `AD-6`'s deliberate `200`-vs-`403` split between `/status` and `/invoke` is well-reasoned and correctly documented in both files. No change — noted so a later reviewer doesn't "fix" it.

---

# What this spine already gets right

Recorded so the fixes above don't erode them, and so the volume of findings isn't mistaken for a weak design:

- **AD-1** — no AWS credential ever reaches a device. This is the single most valuable decision in the document and it removes an entire class of exposure that BYO-plus-vended-credentials designs never escape.
- **AD-3** — the managed authorizer instead of hand-rolled JWT verification, `sub` from verified context, and *"never trusting any body-supplied user identifier"* stated as a prevention. The body-supplied-`user_id` trap is closed explicitly, which most designs leave implicit.
- **AD-6** — fail closed on invoke; missing/malformed config is *not* entitled; no bootstrap Lambda, so a non-premium user has no server-side footprint at all. And the `premium=false` kill switch it enables is immediate and token-independent (M11).
- **AD-8** — model, inference profile, output ceilings, and a **closed** operation enum are server constants. Client-selected model and client-selected token limits — the two classic denial-of-wallet holes — are named and prevented. B3 extends this reasoning to the input side; it does not contradict it.
- **AD-7** — the commit boundary at the first Bedrock event. Getting "never fall back after output has begun" right prevents duplicate AI output and duplicate downstream tool actions, and the pre-output/in-band split is what makes fallback safe at all. Well beyond typical rigor.
- **AD-11's intent**, and the memlog's `:33` insistence that logs exclude bodies *and* file names/paths. The intent is exactly right — B2 and M3 are about making it true, not about redirecting it.
- **No SSM, no Secrets Manager, no static runtime credentials.** Correctly reasoned: nothing at runtime is secret, so no secret store is introduced to be leaked.
- **IAM grants `InvokeModelWithResponseStream` only**, not `InvokeModel*` — tighter than AWS's own documented example policy.
- **The model constant is currently ZDR-safe.** `us.anthropic.claude-sonnet-4-6` is not on Bedrock's retention-exempt list, so AD-11 holds upstream today. M3 asks only that this be re-verified when the constant changes.
- **AD-12's instinct** to refuse the licensing precedent's manual-deploy posture, and to separate this pipeline's principal from the web CDN key. B5 pushes further in the same direction the AD is already pointing.

---

## Blocking set

Do not begin `apps/api-bedrock` until **B1–B5** are resolved in the spine. **M1, M2, M3, M4** should land in the same pass: each is a small number of template or Rule lines now, and each is expensive to retrofit once IaC and the shared contract harden. **M5–M11** must be closed before the feature ships publicly.

Everything mandated above is zero-idle-cost. The only cost-bearing control raised (WAF, in B4) is explicitly optional and belongs under Deferred with its trade-off stated.
