---
review: tech-currency
target: ARCHITECTURE-SPINE.md
spine: architecture-cloud-profile-billing-2026-11-17
reviewed: '2026-11-17'
method: 'Reality-check every committed technology decision against the live web (npm registry, AWS docs, vendor docs, GitHub issues) and against the existing repository. Training-data assertions are treated as unverified until a URL or command output backs them.'
verdict: 'Four decisions were genuinely reality-checked and hold. Two load-bearing hosting decisions (CloudFront OAC in front of a Lambda function URL, and TanStack Start on Nitro v3 `aws_lambda`) were asserted from a shallow existence check and are wrong in ways that break the account app''s write path and its session cookie — the spine is not buildable as written.'
findings: 11
tiers: { critical: 2, high: 4, medium: 3, low: 2 }
---

# Tech-Currency Review — Nixus Cloud Profile & Web Account spine

**Scope of this review.** Not "is the design good" — *was each committed technology claim checked against reality, and does it survive the check.* Every verdict below is backed by a fetched URL with a quoted line, or by a command run against the npm registry / this repository. The spine was not edited.

---

## 1. Verification-provenance audit

The `.memlog.md` decision log is the record of what was reality-checked. Cross-referencing it against the spine's committed decisions:

| Spine decision | Memlog provenance | Actually verified? |
| --- | --- | --- |
| AD-3 multi-level `ApiMapping` key `v1/profile`, longest match, base path stripped | `(version)` line 56, dated 2026-11-17, cites `rest-api-mappings.html` | **Yes — and it holds** (see F6) |
| Deferred: LemonSqueezy closes 2027-03-31; Stripe Managed Payments MoR, Canada, +3.5% | `(version)` line 15, dated 2026-11-17, via librarian | **Yes — and it holds exactly** (see F10) |
| Deferred: WAF pricing / CloudFront flat-rate | `(version)` line 74, dated 2026-11-17 | Yes (out of scope of this review's check list) |
| Stack: `nitro` exact `3.0.261103-rc`; `@tanstack/react-start ^1.167.0`; dynamodb SDK | `(version)` line 80, dated 2026-11-17 | **Partially — version *strings* were confirmed to exist; the *combination* was never checked** (F1, F2) |
| AD-14 account app hosting: CloudFront → Lambda function URL via OAC | `(decision)` line 62 — **no `(version)` entry, no date, no URL** | **No** (F3) |
| AD-10 confidential Cognito client + PKCE; shared Managed Login | `(decision)` line 61 — **no verification entry** | **No** (F4, F7) |
| AD-10 `__Host-` cookie; 24 h/7 d session TTL; refresh-token revoke on sign-out | `(assumption)` line 84 — **self-labelled assumption** | **No** (F5, F8, F9) |
| AD-4 / AD-14 DynamoDB conditional writes, TTL, PITR, 400 KB vs 64 KiB avatar | **no entry at all** | **No** (F5, F11) |
| Stack: Node.js 22.x both Lambdas | **no entry** — inherited from `nixus-bedrock-api` | **No** (F8) |
| Deferred: Cognito resource server stays console-managed, scope added by hand | `(decision)` line 340 of spine; no API semantics checked | **No** (F7) |

**Pattern.** The verification effort clustered on the two things that felt riskiest at authoring time (the API Gateway domain mapping, and the billing provider) and those two are correct. Everything in the *account-app hosting and session* cluster — CloudFront OAC, the TanStack Start runtime, the Cognito web client, the session table's expiry mechanism — was asserted. That cluster is where both critical findings live. The one check that was performed in that cluster (memlog line 46: "*Nitro preset aws_lambda (verified at nitro.build/deploy/providers/aws 2026-11-17)*") verified that a preset with that name exists, and stopped there; it did not ask whether a TanStack Start app running on it can set a cookie or serve a redirect.

---

## 2. Findings

### F1 — CRITICAL — CloudFront OAC in front of a Lambda function URL breaks every `POST`/`PUT`, which is the account app's entire write path

**Spine claim.** AD-14: *"Account app hosting: CloudFront in front of a Lambda function URL reachable only via CloudFront Origin Access Control, with static assets from S3 behind the same distribution."*

**Reality.** OAC for Lambda function URLs exists and is correctly described as far as it goes — `AuthType: AWS_IAM`, plus a resource policy granting `lambda:InvokeFunctionUrl` to `cloudfront.amazonaws.com` scoped by `AWS:SourceArn` to the distribution:

> "To use OAC, you must specify `AWS_IAM` as the value for the `AuthType` parameter."
> — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html

But the same page carries a caveat the spine does not mention anywhere:

> "**Important** If you use `PUT` or `POST` methods with your Lambda function URL, your users must compute the SHA256 of the body and include the payload hash value of the request body in the `x-amz-content-sha256` header when sending the request to CloudFront. **Lambda doesn't support unsigned payloads.**"
> — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html

CloudFront does **not** compute this hash. The caller does. The OAC signing-behavior setting (`always` / `never` / "don't override the viewer `Authorization` header") controls *whether* CloudFront signs — none of the three waives the body-hash requirement.

**Why this is critical here, not cosmetic.** The spine's account app is a BFF whose every mutation is a non-GET TanStack Start server function — AD-10: *"Every non-GET server function verifies `Origin`"*; AD-1: *"A Nixus Cloud profile changes only through `PUT /v1/profile` and `PUT /v1/profile/avatar`"*, driven from the browser. The OAuth callback POST, profile save, avatar upload and sign-out all become `POST`s from browser JS to the account origin. TanStack Start server-function clients do not compute `x-amz-content-sha256`. Every one of those requests fails at the origin. The spine's v1 feature list (memlog line 77: *"account app v1 = sign in, view/edit profile, avatar, sign out"*) is exactly the set of operations that cannot work.

The obvious workaround is also closed: CloudFront Functions cannot do it, because the viewer-request event object exposes no request body (`method`, `uri`, `querystring`, `headers`, `cookies` only — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html), even though the runtime does have `crypto.createHash('sha256')` (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html).

**Fix (pick one, then record the choice in AD-14).**
1. *Preferred — change the origin type.* AWS shipped a separate **Lambda Web Function** origin type that signs with an unsigned payload and removes the requirement outright: > "For `PUT`, `POST`, and `PATCH` requests, CloudFront signs the origin request with an unsigned payload (`UNSIGNED-PAYLOAD`). The request body is not covered by the CloudFront signature… **You do not need to include an `x-amz-content-sha256` header in requests to CloudFront.**" — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html . Note it uses a different auth model (`IamAuth`) and a different IAM action (`lambda:InvokeWebFunctionEndpoint`); AD-14's deploy-role grant list must change accordingly.
2. *AWS-documented alternative.* Drop OAC: `AuthType: NONE` plus a CloudFront custom origin header that the function rejects when absent — > "You can also add a custom origin header to the requests that CloudFront sends to the origin, and write function code to return an error response if the header isn't present… This helps to make sure that users can only access your web application through CloudFront, not directly using the Lambda function URL." — https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html . This weakens AD-14's "reachable only via CloudFront OAC" to a shared-secret guarantee — state that trade-off explicitly if chosen.
3. Lambda@Edge with the "Include Body" option can inject the header (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-generating-http-responses.html), but AWS does not document this as the fix for this problem and it adds a per-request cost plus a body-size truncation limit. Not recommended.

---

### F2 — CRITICAL — TanStack Start on Nitro v3 `aws_lambda` is an undocumented target with filed bugs on exactly the two mechanisms AD-10 depends on, and the `^1.167.0` pin crosses a breaking Vite peer boundary

**Spine claim.** Stack table: *"`@tanstack/react-start` (account app) | `^1.167.0` — the workspace line used by `apps/web` (latest 1.169.5)"* and *"`nitro` (account app server, preset `aws_lambda`) | exact `3.0.261103-rc` — pinned"*. AD-14 commits the account app's server runtime to this.

Four separate problems, each independently verified:

**(a) The version strings are real, but AWS Lambda is not a documented TanStack Start target.** The spine's version numbers check out — `npm view @tanstack/react-start version` → `1.169.5`; `npm view nitro dist-tags --json` → `{"latest": "3.0.261103-rc"}`. And the preset name is right, including the v3 underscore form:

> "**Preset:** `aws_lambda`" … "To enable response streaming, set the `awsLambda.streaming` flag… `awsLambda: { streaming: true }`"
> — https://nitro.build/deploy/providers/aws

But TanStack Start's own hosting page never mentions AWS Lambda:

> "we recommend using one of our **Official Hosting Partners**: Cloudflare, Netlify, or Railway."
> — https://tanstack.com/start/latest/docs/framework/react/guide/hosting

The full documented target list on that page is Cloudflare Workers, Netlify, Railway (the three partners), generic Nitro, Vercel, Node.js/Docker, Bun, Appwrite Sites. Lambda support is inherited incidentally through Nitro, with no official guidance, no partner status and no CI coverage. (Note: `https://tanstack.com/start/latest/docs/framework/react/hosting` — the path without `/guide/` — 404s.)

**(b) Nitro v3 is not GA.** > "Nitro v3 RC is out with a stable API… Please try the RC and report any issues… **Stable is close!**" — https://nitro.build/blog/v3-rc . Latest GitHub release is `v3.0.261103-rc`, published 2026-11-03 (https://api.github.com/repos/nitrojs/nitro/releases). Meanwhile the stable line is a *different npm package*: `npm view nitropack dist-tags --json` → `{"latest": "2.13.6"}`, last published 2026-11-02 — i.e. the maintainers are still shipping v2 patches in parallel. The spine pins a release candidate as the production server runtime for a service that holds session tokens, and does not say so.

**(c) The known bugs are precisely the two things AD-10 requires.** AD-10 is built on (i) a `__Host-` session cookie and (ii) an OAuth redirect to `/auth/callback`. Both have filed TanStack issues on Lambda:
- **#3796** *"setCookie doesn't work in awsLambda streaming"* (opened 2025-03-17, closed 2025-03-27) — `set-cookie` dropped under `preset: aws-lambda` + `awsLambda: { streaming: true }`.
- **#6008** *"Redirect timeouts when deployed to AWS lambda using SST"* (opened and closed 2025-12-02) — `redirect()` in `beforeLoad` times out the Lambda, on `nitro: 3.0.1-alpha.1`.
- **#4404** *"Start: Custom Nitro config, post vinxi→vite migration"* (2025-06-12 → 2025-09-28) — community reliance on hand-rolled Lambda config after the Vite migration.
  (Queried via `https://api.github.com/search/issues?q=repo:TanStack/router+lambda`.)

A BFF that cannot reliably set a cookie or serve a redirect is a BFF that cannot sign a user in.

**(d) `^1.167.0` is not "the workspace line" and silently demands Vite 8.** Verified directly:

```
$ npm view @tanstack/react-start@1.167.65 peerDependencies --json   # highest 1.167.x
{ "vite": ">=7.0.0", "react": ">=18.0.0 || >=19.0.0", "@rsbuild/core": "^2.0.0" }
$ npm view @tanstack/react-start@1.169.5 peerDependencies --json    # what ^1.167.0 resolves to today
{ "vite": ">=8.0.0", "react": ">=18.0.0 || >=19.0.0", "@rsbuild/core": "^2.0.5" }
$ npm view vite version
8.3.8
```

`apps/web/package.json` pins `"vite": "^7.0.4"`, and `pnpm-lock.yaml` has it resolved at `vite@7.3.2` with `@tanstack/react-start@1.167.49`. A fresh `pnpm add @tanstack/react-start@^1.167.0` in a new `apps/account` resolves to `1.169.5` and demands Vite 8 — a monorepo-wide upgrade the spine does not scope. The caret range crosses a breaking peer boundary between `1.167.65` and `1.169.x`.

Also: **nitro is not a dependency of TanStack Start at all.** `npm view @tanstack/react-start@1.169.5 dependencies --json` lists only internal `@tanstack/*` packages; neither `@tanstack/start-plugin-core` nor `@tanstack/start-server-core` depends on `nitro`/`nitropack`. The hosting doc instructs `npm install nitro` as a user-added Vite plugin. So there is **no npm-enforced compatibility range between the two versions the spine pins** — nothing will fail at install time if they are incompatible; it fails at runtime. The repository already shows the drift: `pnpm-lock.yaml` resolves `apps/web`'s `nitro` (aliased `npm:nitro-nightly@latest`) to `nitro-nightly@3.0.1-20260425-084511-feebdc1e` — an April 2026 nightly — and the installed TanStack server chain to `srvx@0.11.15`, while `nitro@3.0.261103-rc` depends on `srvx: ^1.0.8`. A major-version split. The spine's instruction to pin "the exact `3.0.261103-rc` and the workspace's TanStack Start line" is pinning two things that have never been installed together in this repo.

**Fix.**
1. Before anything else, **spike it**: scaffold a throwaway TanStack Start app, build with `preset: 'aws_lambda'`, deploy behind the F1-corrected origin, and prove three things — an OAuth-style 302 redirect completes, a `Set-Cookie` with `__Host-` survives to the browser, and a server-function `POST` round-trips. Treat this as a gate on AD-14, not an implementation detail.
2. Change the Stack pin from `^1.167.0` to an exact or tilde pin (`~1.167.65`) and state the Vite 7 constraint, **or** scope a monorepo Vite 8 upgrade and pin `1.169.x`. Do not ship a caret range that silently jumps peer majors.
3. Record in the Stack table that `nitro` is an unmanaged peer of TanStack Start with no semver linkage, and that `3.0.261103-rc` is a release candidate — with the named fallback if the spike fails (Nitro's `node_server` preset on Lambda Web Adapter, or a non-Nitro Node handler, or one of the three official partners).
4. If the spike needs streaming, note the correct limits: `BUFFERED` = 6 MB max payload, `RESPONSE_STREAM` = **200 MB** (not 20 MB), with a 2 MBps cap after the first 6 MB — https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html and https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html . No AWS doc describes CloudFront's buffering behaviour for a streamed Lambda function URL response; that interaction is undocumented and must be measured, not assumed.

---

### F3 — HIGH — An IaC-created Cognito app client gets no Managed Login branding, so sign-in is dead on first deploy

**Spine claim.** AD-10: *"Sign-in uses the same `auth.nixusapp.com` Managed Login as the desktop."* AD-14 and memlog line 61 put the web app client in `nixus-account` IaC (`AWS::Cognito::UserPoolClient`) against the console-managed pool.

**Reality.** One domain does serve all clients — > "When a domain is active in your user pool, all app clients serve public authentication pages on that domain." But branding is **per app client**, and it is only auto-created through the console:

> "Each app client can have a distinct branding style, but a user pool domain serves either managed login or the hosted UI."
> "When you create an app client in the AWS Management Console, Amazon Cognito automatically assigns a branding style to your app client. When you programmatically create an app client with the `CreateUserPoolClient` operation, no branding style is created. **Managed login isn't available for an app client created with an AWS SDK until you create one with a `CreateManagedLoginBranding` request.**"
> — https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html

CloudFormation's `AWS::Cognito::UserPoolClient` is the `CreateUserPoolClient` path. The spine's own design — console-managed pool, IaC-managed client — lands exactly in the unsupported combination. The precise failure mode for a style-less client is not documented, which makes it worse, not better: it is untestable from docs alone.

**Fix.** Either add a `AWS::Cognito::ManagedLoginBranding` resource for the new client to the `nixus-account` template (and the matching `cognito-idp:CreateManagedLoginBranding` grant to the AD-14 deploy role, which the spine's grant list does not include), or move the web app client to the same one-time console step the spine already accepts for the resource-server scope (Deferred: *"the `nixus-api/profile` scope is a one-time console step before the first deploy"*) and say so. Also confirm the pool's feature plan is Essentials or Plus — the branding editor is tier-gated (https://aws.amazon.com/cognito/pricing/); Lite pools get Hosted UI (classic) CSS only.

---

### F4 — HIGH — DynamoDB TTL is "within a few days", so the 24 h / 7 d session policy is not enforced by TTL

**Spine claim.** AD-10: *"Tokens live in a session table keyed by the SHA-256 of the cookie value, with TTL (24 h idle / 7 d absolute)."* AD-14: *"The session table is disposable."* Nothing in the spine says the application must check expiry itself.

**Reality.** TTL mechanics are as described — > "The timestamp must be stored as a Number data type in Unix epoch time format at the seconds granularity." — but deletion is explicitly best-effort and, in the current wording, *slower than the commonly cited 48 hours*:

> "DynamoDB automatically deletes expired items within a few days of their expiration time, without consuming write throughput."
> "Items with valid, expired TTL attributes might be deleted by the system at any time, typically within a few days after their expiration."
> — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html (and `howitworks-ttl.html`, same wording)

So an expired session row stays fully readable via `GetItem` for days. If the BFF treats "row present" as "session valid", the stated 24 h idle / 7 d absolute policy is fiction and a stale cookie keeps working — a silent authentication-lifetime bypass of AD-10's own rule. (Note: the "within 48 hours" figure some of this design's ancestry assumes is **not** the current AWS wording; it was not found on the live pages.)

**Fix.** Add to AD-10 that session expiry is enforced in application code on every read — the row carries explicit `idle_expires_at` and `absolute_expires_at`, both checked before the session is honoured, with the DynamoDB TTL attribute present only as storage reclamation. Add a release gate under AD-15: a test that a row whose expiry has passed but which still exists is rejected.

---

### F5 — HIGH — `UpdateResourceServer` replaces the scope list, so adding `nixus-api/profile` can silently delete `nixus-api/ai.invoke` and break hosted AI

**Spine claim.** Deferred: *"Cognito user pool and resource server under IaC. They stay console-managed: the `nixus-api/profile` scope is a one-time console step before the first deploy."* AD-9 adds `nixus-api/profile` to `COGNITO_SCOPES`.

**Reality.** The resource server `nixus-api` already carries `ai.invoke`, which the entire `nixus-bedrock-api` authorizer depends on (`apps/api-bedrock/template.yaml` line 147–148: `AuthorizationScopes: - nixus-api/ai.invoke`). The update API is full-replace, not merge:

> "Updates the name and scopes of a resource server. All other fields are read-only."
> "**Important** If you don't provide a value for an attribute, it is set to the default value."
> — https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateResourceServer.html

Any CLI, SDK or future CloudFormation path that submits `Scopes: [profile]` wipes `ai.invoke` and takes hosted AI down for every user. The console merges for you, which is precisely why a console-only runbook is fragile: the spine's Deferred list also says the pool should move under IaC later, and that migration is the moment this fires.

**Fix.** Make the runbook step explicit and non-optional in the spine: `DescribeResourceServer` → merge → submit the **full** scope array (`ai.invoke` + `profile`, each with its description). Add it to AD-15 as a pre-deploy verification: assert both scopes are present on `nixus-api` before the `nixus-account` deploy proceeds. When the pool eventually moves to IaC, the resource server must be imported with both scopes in one template, never patched.

---

### F6 — HIGH — Node.js 22 deprecates 2027-05-30, inside this build's lifetime, with no upgrade milestone

**Spine claim.** Stack: *"Node.js (both Lambdas) | 22.x, ARM64 (matches `nixus-bedrock-api`)"*. Confirmed against the repo: `apps/api-bedrock/template.yaml` line 114 `Runtime: nodejs22.x`, line 116 `arm64`.

**Reality.**

> "| Node.js 22 | `nodejs22.x` | Amazon Linux 2023 | **May 30, 2027** | Jul 29, 2027 | Aug 31, 2027 |"
> "| Node.js 24 | `nodejs24.x` | Amazon Linux 2023 | Apr 30, 2028 | Jun 1, 2028 | Jul 1, 2028 |"
> — https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html

Upstream Node.js 22 security support ends **2027-04-30** (https://endoflife.date/nodejs). That is ~5 months from today for upstream, ~6 for Lambda block-function-create. AWS's own console walkthrough now uses Node.js 24 as its example runtime. Node.js 26 is public preview only.

**Fix.** Either start `nixus-account` on `nodejs24.x` (and note the deliberate divergence from `nixus-bedrock-api`, which is a one-line `Runtime:` change there too), or keep 22.x for consistency and add a dated runtime-upgrade item to AD-14's operating envelope with a deadline before 2027-04-30. "Matches `nixus-bedrock-api`" is not a currency argument; it propagates an expiring choice into a new stack.

---

### F7 — MEDIUM — API Gateway multi-level mapping holds, with two unverified preconditions and a forward-compatibility note

**Spine claim.** AD-3: *"attached to `api.nixusapp.com` by an `AWS::ApiGatewayV2::ApiMapping` with key `v1/profile`. The longest-match mapping takes precedence over the Bedrock catch-all, and the base path is stripped."*

**Reality — the core claim is CONFIRMED**, and this is the one hosting-adjacent decision that was properly checked (memlog line 56):

> "For a Regional custom domain names with the TLS 1.2 security policy, API Gateway supports multi-level API mappings."
> "**Note** To create API mappings with multiple levels, you must use `AWS::ApiGatewayV2`."
> "When you create a mapping with multiple levels, API Gateway sends requests to the API mapping that has the longest matching path."
> "When you map a custom domain name to a stage of your API, API Gateway strips the incoming base path."
> — https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-mappings.html

The existing domain satisfies the TLS 1.2 precondition (`apps/api-bedrock/template.yaml` line 137: `SecurityPolicy: TLS_1_2`). SAM's `BasePath: - /` becomes the empty catch-all, not a literal `/`, because `NormalizeBasePath` defaults to `True` and strips non-alphanumerics (https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-api-domainconfiguration.html) — which is exactly the `(none)` row in the AWS precedence example, so `v1/profile` and the Bedrock catch-all cannot overlap. Cross-stack is permitted: the only documented restriction is > "In an API mapping, the custom domain name and mapped APIs must be in the same AWS account." and > "A custom domain name can have multiple API mappings, but the paths can't overlap." (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigatewayv2-apimapping.html).

Three gaps the spine should close:
1. **Routing mode is unverified against the live domain.** > "Your custom domain name must have a routing mode set to either `ROUTING_RULE_THEN_API_MAPPING` or `API_MAPPING_ONLY`." … > "When your custom domain name uses [`ROUTING_RULE_ONLY`] mode, you can't create an API mapping." (https://docs.aws.amazon.com/apigateway/latest/developerguide/set-routing-mode.html). The default for existing domains is `API_MAPPING_ONLY` so this very likely passes, but it is a one-command check that has not been run: `aws apigatewayv2 get-domain-name --domain-name api.nixusapp.com`.
2. **`ApiMapping.Stage` is a plain string**, not a stage ARN or ref — the new template must pass the literal stage name.
3. **AWS now steers REST APIs away from API mappings**: > "We recommend that when possible, you use routing rules. Only use API mappings to send traffic to an HTTP or WebSocket API." (https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-routing-mode.html). The chosen path is fully supported today but is the legacy-recommended one; worth a sentence so a future reader does not assume it is current best practice.

Also note: `AWS::ApiGateway::BasePathMappingV2` is *not* an alternative here — > "Supported only for private custom domain names." (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigateway-basepathmappingv2.html). The spine's choice of `ApiGatewayV2::ApiMapping` is the only correct one.

---

### F8 — MEDIUM — "Sign-out revokes the refresh token" does not invalidate the issued access token at the profile API

**Spine claim.** AD-10: *"Sign-out deletes the row and revokes the refresh token."* Its *Prevents* line frames cookie-held Cognito tokens as bad partly because they are *"unrevocable"*, implying revocation here yields real invalidation.

**Reality.** Revocation works for a confidential client — > "If your app client has a client secret, the application must pass its `client_id` and `client_secret` in the authorization header through Basic HTTP authorization." — and Cognito does cascade: > "This endpoint also revokes the refresh token itself and all subsequent access and identity tokens from the same refresh token." (https://docs.aws.amazon.com/cognito/latest/developerguide/revocation-endpoint.html). But an API Gateway Cognito user-pool authorizer validates the JWT locally — signature, `exp`, scopes — and does not call back to Cognito per request. The `jti`/`origin_jti` claims exist so a resource server *can* check a revocation list if it chooses (https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-with-identity-providers.html). The spine's profile API does not. So a not-yet-expired access token captured before sign-out would still pass the AD-3 authorizer until `exp`.

In practice the exposure is small because AD-10 also deletes the session row, so the BFF itself can no longer present the token. But the claim as written overstates what revocation buys, and the window is whatever the access-token TTL is — which the spine never states.

**Fix.** State the access-token TTL for the web client in AD-10 (short — 5–15 min) and reword the revocation sentence to "prevents new tokens being minted" rather than implying immediate invalidation. Confirm `EnableTokenRevocation` is true on the new client — > "If the token isn't present in the request or if the feature is disabled for the app client, you receive an HTTP 400 and error `invalid_request`." (same URL).

---

### F9 — MEDIUM — The hot-partition ceiling on `pk = USER#<sub>` and the conditional-write cost are unstated

**Spine claim.** AD-4: *"One on-demand DynamoDB table with key `pk = USER#<sub>`"*, with conditional writes on `version`.

**Reality.** The conditional-write design is exactly the documented pattern — > "Testing `attribute_not_exists()` on a key attribute… is true only when no item with that partition key and sort key already exists, so it prevents overwriting that item." (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) — and failures surface as documented: > "When a conditional PutItem, UpdateItem, or DeleteItem operation fails its condition, it returns a `ConditionalCheckFailedException`." Two details worth capturing:

- Failed conditions still cost capacity: > "If a `ConditionExpression` evaluates to false during a conditional write, DynamoDB still consumes write capacity from the table." — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html
- AD-7's `version_conflict` → reload path can be one round-trip instead of two: > "To have DynamoDB return those attributes, set the `ReturnValuesOnConditionCheckFailure` parameter to `ALL_OLD`." (same URL).
- Per-partition ceiling, regardless of on-demand: > "Every partition in a DynamoDB table is designed to deliver a maximum capacity of 3,000 read units per second and 1,000 write units per second." — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html . A single `USER#<sub>` is pinned to one partition. Harmless for a per-user profile at this scale, but AD-4 reserves `ENTITLEMENT` and `BILLING_CUSTOMER` on the same `pk` for the billing spine, which is where webhook fan-in could concentrate.

**Fix.** Add `ReturnValuesOnConditionCheckFailure: ALL_OLD` to AD-4's conflict contract so AD-7's conflict reload is free. Note the 1,000 WCU / 3,000 RCU per-partition ceiling as a constraint the billing spine inherits on the reserved sort keys.

---

### F10 — LOW — The Deferred billing claims are all correct, to the digit

Every number in the Deferred section survives verification — the one cluster that was researched properly (memlog line 15) and the only one that needs no change:

- > "Lemon Squeezy is no longer accepting new sign-ups and will shut down on March 31, 2027." / > "Lemon Squeezy will stop processing transactions for all businesses on March 31, 2027." — https://www.lemonsqueezy.com/
- > "The key difference is that Stripe (via Link) becomes the merchant of record for Managed Payments transactions, handling global indirect tax (sales, VAT, GST), fraud prevention, dispute responses and transaction-level support through Link." and > "Managed Payments adds 3.5% per successful transaction to your standard Stripe processing fees." — https://stripe.com/managed-payments
- Canada supported: > "Supported business locations ### North America - CA - US" — https://docs.stripe.com/payments/managed-payments/eligibility
- Paddle: > "5% + 50¢ per Checkout transaction" — https://www.paddle.com/pricing

Two additions worth carrying into the billing spine: migration tooling from Lemon Squeezy to Stripe Managed Payments *launches 2026-12-02* and migration "usually takes 4–8 weeks" (lemonsqueezy.com) — relevant only if any Lemon Squeezy footprint ever existed, which per memlog line 14 it does not. And Managed Payments eligibility is gated by product category (digital goods / software / SaaS; physical goods, consulting and live 1:1 services excluded) plus restricted customer countries — confirm Nixus's tax code maps before committing in that spine.

---

### F11 — LOW — The 64 KiB avatar fits 400 KB either way, but AD-4/AD-5 should say which encoding it means

**Spine claim.** AD-4: *"`sk = AVATAR` holds the bounded avatar derivative (256 px, ≤ 64 KiB, same contract as `avatar_store.rs`)"*. AD-5 sets *"byte ceilings of 16 KiB for the profile body and 64 KiB for the avatar"*. Confirmed against the repo: `apps/desktop/src-tauri/src/avatar_store.rs` — *"Only the bounded derivative is stored — 256 px longest edge, at most 64 KiB"*.

**Reality.** The 400 KB item limit is real — > "The length of a binary attribute can be zero… and is constrained by the maximum DynamoDB item size limit of 400 KB." (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html; also the FAQ: > "The maximum size of an item that can be stored in a DynamoDB table is 400 KB."). 64 KiB = 65,536 raw bytes; as a base64 `String` that is 87,384 bytes — ~4.5× under the ceiling. No limit risk either way.

The detail that matters is sizing asymmetry: > "A binary value must be encoded in base64 format before it can be sent to DynamoDB, but the value's raw byte length is used for calculating size." (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/CapacityUnitCalculations.html). A `B` attribute costs 64 KB of item budget and WCU; a base64 `S` attribute costs ~85 KB — a ~33% write-capacity premium for the same image.

Secondary ambiguity: AD-13 mandates snake_case JSON on every wire, so the avatar `PUT` body is base64 — meaning the *request* is ~87 KB while AD-5's "16 KiB for the profile body" ceiling applies to the other route. That split is correct but implicit; a reader could apply the wrong ceiling.

**Fix.** State in AD-4 that the avatar is stored as a DynamoDB Binary (`B`) attribute (cheaper, raw-byte sizing) while the wire payload is base64 per AD-13, and in AD-5 that the 64 KiB ceiling is measured on *decoded* bytes with the base64 request body bounded separately (~88 KiB).

---

## 3. What held up

For the record, so the next reviewer does not re-litigate these: the multi-level `ApiMapping` + longest-match + base-path-stripping design (F7 core), the whole Deferred billing section to the digit (F10), the 400 KB ceiling and conditional-write/PITR mechanics (F9, F11 — PITR is > "up to 35 days of recovery points at a per second granularity" and now configurable 1–35 via `RecoveryPeriodInDays`, https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html; `Retain` semantics per https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html), the confidential-client-plus-PKCE pattern (Cognito's own token-endpoint doc shows `Authorization: Basic` alongside `code_verifier` in one request — https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html), custom scopes landing in the access-token `scope` claim and being checked by the authorizer (> "User pool scopes are in the access token `scope` claim." — https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html), and the `__Host-` cookie design including the subtle part: a `SameSite=Lax` cookie *is* delivered on the top-level GET redirect back from `auth.nixusapp.com`, because > "Lax… sends same-site cookies along with cross-site requests if and only if they are top-level navigations which use a 'safe'… HTTP method" (https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-22.txt), so the PKCE/state cookie survives the OAuth round-trip. `__Host-` being host-only (> "they must not have a `Domain` attribute specified, and the `Path` attribute must be set to `/`" — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies) is also consistent with AD-11, which never shares the cookie with `api.nixusapp.com` — the BFF presents a bearer token instead.

AD-14's claim that `infra/bootstrap/github-oidc-deploy.yaml` cannot deploy `nixus-account` is also correct against the repo: both roles are scoped by `${ApplicationStackName}` (default `nixus-bedrock-api`) down to `function:${ApplicationStackName}-api`, `table/${ApplicationStackName}-*` and `role/${ApplicationStackName}-Hosted*`, and the OIDC trust is pinned to `repo:${GitHubOrg}/${GitHubRepo}:environment:${GitHubEnvironment}`. Note the existing cfn-exec role *does* already carry `apigateway:*` on `/domainnames` and `/domainnames/*` — the new bootstrap needs the same, plus (per F1 and F3) whichever Lambda-origin actions the corrected hosting choice requires and `cognito-idp:CreateManagedLoginBranding` if branding moves into IaC.

---

## 4. Recommended sequencing

1. Resolve F1 (choose the origin type) and F2 (run the spike) **before** any `apps/account` code exists. Both change AD-14's text and the new bootstrap's grant list.
2. Fold F3, F4, F5, F6 into AD-10 / AD-14 / AD-15 and the Stack table as rule and gate changes — each is a one-paragraph edit with a concrete test.
3. Run the single `aws apigatewayv2 get-domain-name` check from F7 to retire the last precondition on AD-3.
4. F8–F11 are wording and parameter precision; batch them into the next spine revision.
