# Runbook — Hosted AI (Nixus Cloud Bedrock) rollout

Owner: Nixus operator (single-operator service)
Stack: `nixus-bedrock-api` · API region `us-east-1` · Bedrock region `eu-west-2` · one production stack, no staging (AD-15)

`GLOBAL.enabled` is the single switch that turns hosted AI on. **It must stay `false`
until every gate in [Enablement gates](#enablement-gates) has recorded evidence.**
Deploying the stack does not enable traffic; only the manual item flip does.

---

## 0. Model capability probes — both passed

**STATUS: `CountTokens` PASSES. `ConverseStream` PASSES. NO CONCURRENCY DEPENDENCY REMAINS (§2.1). REMAINING GATES ARE THE UNRUN CAPABILITY CHECKS (§0.3) AND THE STANDARD ROLLOUT GATES BELOW.**

The architecture mandates a `bedrock:CountTokens` call against the exact selected model
before any quota reservation (AD-8), so a model that rejects `CountTokens` makes the gate
unimplementable and every eligible request a `503 hosted_unavailable`.

Probe both against the values the stack actually deployed, never a remembered pair — the
stack outputs both for exactly this reason:

```bash
MODEL="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='BedrockModelIdEcho'].OutputValue" --output text)"
REGION="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='BedrockRegionEcho'].OutputValue" --output text)"
```

Both probes must pass against the *same* `$MODEL`/`$REGION` pair: a count taken on one
identity says nothing about a stream issued on another.

### 0.1 `CountTokens` — resolved by a user-approved model and region change

The original `us.anthropic.claude-sonnet-4-6` cross-region inference profile was probed
and **rejected**:

```
ValidationException: The provided model doesn't support counting tokens
```

Every other `us.anthropic.*` inference profile probed, and the Nova direct models,
answered the same way. Runtime `CountTokens` is a foundation-model capability that
inference profiles do not carry.

The approved resolution is a **specification change, not a runbook workaround**: the
service now calls the bare foundation model
`anthropic.claude-3-7-sonnet-20250219-v1:0` **directly in `eu-west-2`**, which returned
an input-token count for the identical probe:

```bash
aws bedrock-runtime count-tokens \
  --region "$REGION" --model-id "$MODEL" \
  --input '{"converse":{"messages":[{"role":"user","content":[{"text":"probe"}]}]}}'
```

The amendment is recorded in `_bmad-output/planning-artifacts/architecture-cloud-bedrock.md`
and the architecture spine's Stack Seed. The API, Lambda, and quota table stay in
`us-east-1`; only the Bedrock runtime calls move, via the `BedrockRegion` parameter and
the Lambda's `BEDROCK_REGION` variable.

**What still must NOT happen.** Each of these alters cost enforcement or data
processing and needs its own review, exactly as the profile swap did:

- do **not** switch to a different model, and do **not** reintroduce an inference profile,
- do **not** change the region away from `eu-west-2`,
- do **not** remove, weaken, or reorder the pre-reservation token gate,
- do **not** substitute a locally estimated token count for the gate.

### 0.2 `ConverseStream` — passed

`CountTokens` succeeding does not prove the model can stream, so streaming is its own
gate:

```bash
aws bedrock-runtime converse-stream \
  --region "$REGION" --model-id "$MODEL" \
  --messages '[{"role":"user","content":[{"text":"probe"}]}]' \
  --inference-config '{"maxTokens":16}'
```

Recorded outcome: the probe **streamed text and completed** — the model replied `OK.`
on `anthropic.claude-3-7-sonnet-20250219-v1:0` in `eu-west-2`. Both AD-8 gate calls are
therefore proved on the one deployed identity.

### 0.3 Text streaming is not the whole capability surface — checks still to run

A one-line text stream proves the model answers `ConverseStream`. It proves nothing
about the rest of what the four surfaces need, and this model is an older generation than
the one originally specified. **None of the following has been run yet; do not treat any
of them as passed.** They are pre-enable gates 1c–1f.

| Check | Why it is not covered by §0.1/§0.2 | How to check |
|---|---|---|
| Model lifecycle and access | A legacy model can be scheduled for deprecation, or be gated behind a per-account access grant that the probe's identity happened to hold | `aws bedrock get-foundation-model --region "$REGION" --model-identifier "$MODEL"` and Bedrock → Model access; confirm no announced end-of-life inside the rollout horizon |
| Multimodal PDF + image | Statement import sends `document`/`image` content blocks, which a text probe never exercises; format support differs per model generation | `converse` once with a small real PDF and once with a PNG, both through the same `$MODEL`/`$REGION` |
| Output ceilings | AD-8's per-operation output ceilings (chat 4096; statement_import 8192; advice/trends 1024) must be within this model's own `maxTokens` limit, or `ConverseStream` rejects the call for the largest operation | `converse` with `maxTokens` at 8192 and confirm no validation error |
| `eu-west-2` model quotas | Bedrock per-model requests/tokens-per-minute quotas are regional, and London limits are not the `us-east-1` ones. Reserved concurrency 10 could exceed the model's own RPM | Service Quotas → Amazon Bedrock, in `eu-west-2`, for this model's on-demand RPM/TPM |

`GLOBAL.enabled` stays `false` until every enablement gate below is evidenced. The
function itself is no longer the constraint: it carries no concurrency reservation and
draws on the account's shared pool (§2.1), so it is deployable, inspectable, and able to
run — the `GLOBAL` item is what keeps traffic off.


---

## 1. One-time, out-of-band AWS setup

These are **not** created by `nixus-bedrock-api` and must exist before the first deploy.

### 1.1 Cognito resource-server scope (AD-3)

The existing user pool from `architecture-login.md` is the sole identity authority.
This stack never imports or owns it.

1. Cognito → your user pool → **App integration → Resource servers**.
2. Create (or edit) resource server with identifier **`nixus-api`**.
3. Add custom scope **`ai.invoke`**. The full scope string becomes `nixus-api/ai.invoke`.
4. App integration → your app client → **Hosted UI / OAuth 2.0 settings** → add
   `nixus-api/ai.invoke` to the allowed custom scopes.

The desktop already requests this scope (`COGNITO_SCOPES` in `commands/auth.rs`).

> **Existing sessions do not gain the scope.** A refresh grant cannot add a scope.
> Every already-signed-in user must sign out and sign in again. The desktop detects
> the missing scope locally and classifies it as `reauthentication_required` rather
> than looping on refresh.

### 1.2 GitHub OIDC provider and deploy roles (AD-12)

**`nixus-bedrock-api` must never define the role that deploys it** — a contract test
asserts the application template contains no OIDC provider and no
`token.actions.githubusercontent.com`. `infra/bootstrap/github-oidc-deploy.yaml` is the
separately reviewed bootstrap stack AD-12 refers to, and it is deployed by its own
one-time workflow.

**The bootstrap paradox, and how it is resolved.** The application pipeline must
authenticate via OIDC, but nothing can create the OIDC provider *over* OIDC, because
neither the provider nor the role exists yet. Rather than create them by hand — which
would contradict the rule that every infrastructure change runs through GitHub Actions
— there is one temporary workflow that borrows the repository's pre-existing static
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (already present for `web-ci.yml`)
exactly once. It is the only file permitted to use them, and a test enforces that
`api-bedrock-ci.yml` contains no static credential.

#### What the bootstrap stack creates

| Resource | Purpose |
|---|---|
| GitHub OIDC provider | `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`. Retained, so removing the bootstrap stack cannot break another pipeline that federates through it |
| **Deploy role** `nixus-bedrock-api-github-deploy` | Assumed by GitHub Actions. Drives CloudFormation on the one application stack, uploads packages, and reads deployed state. Holds **no** permission to create application resources, and no IAM write except `PassRole` to the one execution role |
| **CloudFormation execution role** `nixus-bedrock-api-cfn-exec` | Assumed only by `cloudformation.amazonaws.com`. The sole identity that may create the application's resources. Carries an explicit **Deny** on `dynamodb:DeleteTable` |
| Artifact bucket `nixus-sam-artifacts-<account>-<region>` | Private, AES256-encrypted, versioned, TLS-only, retained. Replaces SAM's managed bucket, which would sit outside these policies |

Two roles rather than one is the point: a single role able to both assume from GitHub
*and* create IAM roles could grant itself anything. Neither role carries
`AdministratorAccess`, and no statement grants a wildcard action.

#### Bootstrap sequence

1. **Merge the source.** The bootstrap workflow is `workflow_dispatch`-only, so merging
   it deploys nothing.

2. **Run it.** Actions → *API Bedrock OIDC Bootstrap (TEMPORARY)* → **Run workflow**,
   from `master`:
   - `create_oidc_provider`: **`true`** on a first run. The workflow prechecks the
     account and fails with the exact ARN to adopt if a provider already exists — an
     account may hold only one per issuer URL.
   - `existing_oidc_provider_arn`: leave blank unless adopting.
   - `confirm`: type **`BOOTSTRAP`**. Without it the run refuses to start.

3. **Read the outputs.** The final step prints a table and the exact mapping to copy.

4. **Create the `production` environment.** GitHub → Settings → Environments → new
   environment named **`production`**:
   - Required reviewers: yourself.
   - Deployment branches: **Selected branches** → default branch only.

5. **Populate it** from the bootstrap outputs:

   | Name | Kind | From bootstrap output |
   |---|---|---|
   | `AWS_BEDROCK_DEPLOY_ROLE_ARN` | secret | `DeployRoleArn` |
   | `AWS_BEDROCK_CFN_EXEC_ROLE_ARN` | secret | `CloudFormationExecutionRoleArn` |
   | `SAM_ARTIFACT_BUCKET` | variable | `SamArtifactBucketName` |

   Plus the account-specific inputs the deploy job passes through:

   | Name | Kind | Purpose |
   |---|---|---|
   | `COGNITO_USER_POOL_ARN` | secret | Authorizer target |
   | `COGNITO_USER_POOL_ID` | secret | Operator traceability echo |
   | `COGNITO_APP_CLIENT_ID` | secret | Client that carries the scope |
   | `API_CERTIFICATE_ARN` | secret | ACM cert for the custom domain, in `us-east-1` |
   | `HOSTED_ZONE_ID` | secret | Route53 zone for `nixusapp.com` |
   | `ALERT_EMAIL` | secret | Alarm + budget subscriber |
   | `API_DOMAIN_NAME` | variable | `api.nixusapp.com` |

   There is no Bedrock model or ARN input. A foundation-model ARN carries no account
   ID, so the template derives it from `BedrockModelId` + `BedrockRegion` and nothing
   account-specific is left to pass. The former `BEDROCK_INFERENCE_PROFILE_ARN` secret
   is obsolete and should be deleted rather than left as a misleading unused input.

6. **Enable deployment.** Set the **repository** variable
   `API_BEDROCK_DEPLOY_ENABLED` = `true`. Until this is set the deploy job is skipped
   entirely, so merging deploy-capable source cannot deploy anything.

7. **Delete the bootstrap workflow.** Its job is done and it is the only remaining
   static-key path:

   ```bash
   git rm .github/workflows/api-bedrock-oidc-bootstrap.yml
   ```

   The bootstrap **stack** stays — only the workflow goes. Re-adding the file is the
   only way to re-run it, which keeps that a deliberate, visible act.

#### Verifying the trust subject

The trust policy pins the `sub` claim to exactly:

```
repo:nickbazinet/nixus:environment:production
```

This repository has **immutable subject claims disabled** (`use_default: true`,
`use_immutable_subject: false`), so GitHub emits the plain `repo:owner/name` form. Were
immutable claims ever enabled, the claim becomes
`repo:OWNER@OWNER_ID/REPO@REPO_ID:environment:production` and the trust policy must be
updated to match. A `sub` that does not match fails every deploy closed, which is the
safe direction; a `sub` that is too broad is privilege escalation.

The stack outputs `TrustedSubject` so a failing run can be compared against it directly.

#### Why the branch restriction is separate

The trust policy's `sub` **cannot** encode both an environment and a branch. Restricting
deployment to the default branch therefore comes from three independent controls:

- the workflow's `push: branches: [master, main]` trigger,
- the deploy job's `if`, which requires `github.ref` to be `master`/`main` for a manual
  dispatch as well as a push, and
- the `production` environment's deployment-branch policy.

### 1.2b Manual dispatch of a normal deployment

Once §1.2 is complete, a deployment can be triggered without an empty commit — the
normal case for the first deployment, or for re-running one that failed on an
account-side problem rather than a code problem:

> Actions → **API Bedrock CI** → **Run workflow** → branch `master`.

A dispatch from any other branch is refused by the job's `if`, and by the environment's
branch policy. The `production` approval still applies.

**Local deployment remains prohibited** (§2). Manual dispatch is a manual *trigger* of
the GitHub-Actions deployment, not a local one.

### 1.3 ACM certificate

Issue/verify a certificate covering `api.nixusapp.com` **in `us-east-1`** (a Regional
REST custom domain needs the certificate in the API's own region). Validate via DNS
in the existing Route53 zone.

### 1.4 Confirm Bedrock model-invocation logging is OFF (AD-15)

Model-invocation logging is configured **per region**, so it must be checked in **both**
regions. `eu-west-2` is where invocations now happen; `us-east-1` is where they used to be
aimed, so a configuration left there from earlier probing is exactly the kind of thing that
survives a region change unnoticed.

```bash
for region in eu-west-2 us-east-1; do
  echo "== ${region}"
  aws bedrock get-model-invocation-logging-configuration --region "${region}" \
    || echo "no logging configuration (expected)"
done
```

Expected in each: no logging configuration, or one that does not capture request/response
data. If logging is enabled, request content would be persisted to a Nixus-controlled
destination, contradicting the Privacy Policy. **Disable it in that region before enabling
traffic.**

```bash
aws bedrock delete-model-invocation-logging-configuration --region eu-west-2
aws bedrock delete-model-invocation-logging-configuration --region us-east-1
```

---

## 2. Deploy — GitHub Actions only

**Local deployment is prohibited.** The only path that may mutate the stack is the
`deploy` job in `.github/workflows/api-bedrock-ci.yml`, which federates via GitHub
OIDC into the deploy role from §1.2 and runs behind the protected `production`
environment. There is no long-lived AWS key for this service, so there is no local
credential to deploy with, and none may be created.

Two clarifications, because both look like exceptions and are not:

- **The one-time bootstrap** (§1.2) also runs in GitHub Actions. It uses the legacy
  static keys because nothing can create an OIDC provider over OIDC, and it is deleted
  once it has succeeded.
- **Manual dispatch** (§1.2b) is a manual *trigger* of the GitHub-Actions deployment
  from `master`. It is not a local deploy, and it is still gated on
  `API_BEDROCK_DEPLOY_ENABLED`, the branch check, and `production` approval.

Locally you may run only the offline gates:

```bash
cd apps/api-bedrock
pnpm lint && pnpm typecheck && pnpm test
pnpm sam:validate
pnpm sam:build      # bundles the artifact; touches no AWS account
```

The bootstrap template is CloudFormation rather than SAM, so `sam validate` does not
cover it. Lint it offline with:

```bash
pipx run cfn-lint infra/bootstrap/github-oidc-deploy.yaml
```

To deploy, merge to the default branch and approve the `production` environment, or
dispatch from `master` (§1.2b). Stack name and region come from `samconfig.toml`.
`resolve_s3` is **off**: the workflow passes `--s3-bucket` and `--s3-prefix` explicitly,
because SAM's managed bucket would be created outside the bootstrap stack and therefore
outside the deploy role's S3 policy and the bucket's encryption, versioning, and
retention guarantees. Account-specific parameters are passed at deploy time and
deliberately not committed.

`sam deploy` runs with `--role-arn` pointing at the CloudFormation execution role, so
CloudFormation — not the GitHub-assumed deploy role — creates the resources. Omitting
it would make CloudFormation act with the deploy role's own permissions, which
deliberately cannot create anything.

### 2.1 Concurrency: no function-level reservation (user decision, 2026-08-26)

**The function carries no `ReservedConcurrentExecutions` and no parameter to set one.**
It draws on the account's shared pool of 50 unreserved executions.

**Why.** AWS refuses any reservation that would drop the account's *unreserved*
concurrency below a floor of 50, and this account's total Lambda concurrent-execution
quota **is** 50. Every positive reservation was therefore rejected — the first deployment
attempt rolled back into `ROLLBACK_COMPLETE` on exactly this — leaving `0` as the only
deployable value. A reservation of `0` is not a mild setting: it throttles the function to
zero concurrent executions, so the service can never serve a request while it stands.

Faced with "permanently inert" versus "raise the quota and wait", **the user chose
neither and waived the reservation**, accepting the account's shared 50. The quota-increase
request may stay open, but **it is no longer a rollout dependency** and nothing waits on it.

**What this trades away, stated plainly.** The reservation was one of AD-4/AD-14's layered
bounds, and it was the only one that isolated this function from the rest of the account.
Without it, a burst here can exhaust the shared pool and throttle other functions, and
theirs can throttle this one — callers see `503 hosted_unavailable` either way. The
`Throttles` alarm (threshold 1) is what makes that visible.

**What is unchanged.** Every other bound still stands, and the waiver did not touch any of
them:

| Bound | Where |
|---|---|
| Cognito authorizer with the required scope at the edge | `template.yaml` `Auth` |
| Stage throttle 10 RPS / burst 20 | `template.yaml` `MethodSettings` |
| Per-user monthly cap (`charged_count` vs `monthly_request_limit`) | DynamoDB, enforced in every reserve transaction |
| `GLOBAL` monthly hard cap and `enabled` kill switch | DynamoDB, same transaction, atomically |
| Per-operation input/output token ceilings, `CountTokens`-gated | `src/lib/validation.ts`, AD-8 |
| AWS Budget $50/month on Bedrock, 80%/100% alerts | `template.yaml` |

Re-adding a reservation is a specification change, not a tuning knob: it would have to
clear the same quota arithmetic that rejected it, and it needs the user's decision
reversed.

### 2.2 Assert the function is unreserved

"Unreserved" and "reserved 0" are opposite states that look nearly identical in a console.
`get-function-concurrency` returns an **empty object** for an unreserved function, so query
the whole response and check the key is absent — `--query 'ReservedConcurrentExecutions'`
on a missing field prints the string `None`, which is easy to mistake for a real answer.

The deploy workflow does this automatically after every deploy and fails the job if a
reservation is present. By hand:

```bash
FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)"

aws lambda get-function-concurrency --function-name "$FUNCTION_NAME" --output json
# expect: {}   → unreserved, the intended state
# a ReservedConcurrentExecutions key of any value → wrong; 0 means it cannot execute
```

Account-level capacity, for context when triaging a `Throttles` alarm:

```bash
aws lambda get-account-settings \
  --query 'AccountLimit.{Concurrent:ConcurrentExecutions,Unreserved:UnreservedConcurrentExecutions}'
```

A template that says nothing about reservations proves nothing about the deployed
function, which is why this asserts the function itself.

### 2.3 Removing the reservation from an already-deployed stack

The stack was previously deployed with a reservation of `0`. Deleting the property from
the template is enough — CloudFormation removes the reservation on UPDATE, and the
function moves to the shared pool. It does **not** require a stack replacement, and it
does not touch the retained table.

CloudFormation preserves previous parameter values on UPDATE, so the deploy job passes
`BedrockModelId` and `BedrockRegion` explicitly rather than relying on the new template
defaults; a parameter deleted from the template simply ceases to exist on the stack.
Verify with §2.2 immediately after the deploy.

### 2.4 The orphaned rollback artefacts

The failed first attempt left two things behind:

- **The stack in `ROLLBACK_COMPLETE`.** This is a terminal state CloudFormation cannot
  update, so it must be deleted before a `CREATE` can be retried. The deploy job does
  this automatically, but **only** when the status is exactly `ROLLBACK_COMPLETE` —
  a state in which no resource was successfully created, so nothing can be lost. Every
  other state, including a live stack or a failed `UPDATE` that still serves traffic,
  is left strictly alone.
- **An empty retained DynamoDB table with a generated name.** `DeletionPolicy: Retain`
  kept it when the stack rolled back, so it survives as an orphan. It is empty and
  costs effectively nothing on-demand, but it is not the table the next deployment will
  use. Identify and delete it **by hand**, after confirming it holds no items and is
  not the current stack's table:

  ```bash
  CURRENT="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
    --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)"
  # For each candidate orphan, confirm it is NOT "$CURRENT" and that:
  aws dynamodb scan --table-name "<orphan>" --select COUNT --query 'Count'
  # expect 0 before deleting
  ```

  Left in place it is harmless; it is listed so it is not mistaken later for the live
  quota table.

### 2.5 Protect the quota table from the deploy role (AD-15)

`DeletionPolicy: Retain` / `UpdateReplacePolicy: Retain` stop CloudFormation from
deleting or replacing the table, but they do not stop a direct `DeleteTable` API call
by the deploy role. Verify **both**:

```bash
# 1. PITR is on (CI asserts this after every deploy).
aws dynamodb describe-continuous-backups --table-name "$TABLE" \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus'
# expect: ENABLED

# 2. Deletion protection is on — belt and braces beyond the Retain policies.
aws dynamodb update-table --table-name "$TABLE" --deletion-protection-enabled
```

Confirm the deploy role's policy grants no `dynamodb:DeleteTable` on this table.

---

## 3. One-time operational seed (manual, post-deploy, pre-traffic)

No code path creates these items. There is no bootstrap Lambda and no
PostConfirmation trigger — this is deliberate (AD-6/AD-15).

### 3.1 GLOBAL config — created disabled

```bash
TABLE=$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)

aws dynamodb put-item --table-name "$TABLE" --item '{
  "pk": {"S": "GLOBAL"},
  "sk": {"S": "CONFIG"},
  "enabled": {"BOOL": false},
  "monthly_request_limit": {"N": "1000"},
  "updated_at": {"S": "2026-08-26T00:00:00Z"}
}' --condition-expression "attribute_not_exists(pk)"
```

`enabled: false` means every `POST /v1/ai/invoke` returns `503 hosted_unavailable`
and `GET /v1/ai/status` reports non-premium. That is the intended pre-rollout state.

### 3.2 Per-premium-user config

One item per premium user, created by hand. Nothing about the account is hardcoded here:
the operator supplies the email, and the pool and table are read back from the deployed
stack rather than pasted, so this block cannot drift onto a stale table or a pool the
stack does not authorize against. **Which accounts hold premium belongs in the deployment
evidence, not in committed command text.**

```bash
: "${PREMIUM_EMAIL:?set PREMIUM_EMAIL to the account to grant}"

POOL_ID="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolIdEcho'].OutputValue" --output text)"
TABLE="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)"
for v in POOL_ID TABLE; do
  test -n "${!v}" && test "${!v}" != "None" || { echo "${v} unresolved" >&2; exit 1; }
done
```

The lookup must match **exactly one confirmed** account. A filter that matched two
accounts, or an unconfirmed one, would otherwise silently grant premium to whichever
happened to sort first:

```bash
SUBS="$(aws cognito-idp list-users \
  --user-pool-id "$POOL_ID" \
  --filter "email = \"${PREMIUM_EMAIL}\"" \
  --query 'Users[?UserStatus==`CONFIRMED`].Attributes[?Name==`sub`].Value[]' \
  --output text)"
COUNT="$(printf '%s\n' $SUBS | grep -c . || true)"
test "$COUNT" -eq 1 || { echo "expected exactly 1 confirmed match, got ${COUNT}" >&2; exit 1; }
SUB="$SUBS"
```

The write is conditional, so re-running it can never silently overwrite an existing
configuration — a rewrite would reset `monthly_request_limit` under a user who is mid
month while `charged_count` keeps its accumulated value:

```bash
aws dynamodb put-item --table-name "$TABLE" --item '{
  "pk": {"S": "USER#'"$SUB"'"},
  "sk": {"S": "CONFIG"},
  "premium": {"BOOL": true},
  "monthly_request_limit": {"N": "200"},
  "updated_at": {"S": "'"$(date -u +%FT%TZ)"'"}
}' --condition-expression "attribute_not_exists(pk) AND attribute_not_exists(sk)"
```

A `ConditionalCheckFailedException` means the item already exists: inspect it and
decide deliberately, never re-run with the condition removed.

**Verify the item, and verify it holds nothing it should not** (AD-11: the table carries
the subject identifier, entitlement, and limit — never an email, a name, or any content):

```bash
aws dynamodb get-item --table-name "$TABLE" --consistent-read \
  --key '{"pk":{"S":"USER#'"$SUB"'"},"sk":{"S":"CONFIG"}}' \
  --query 'Item'
# expect exactly: pk, sk, premium=true, monthly_request_limit=200, updated_at
# expect NO email, name, phone, or any prompt/response attribute

aws dynamodb get-item --table-name "$TABLE" --consistent-read \
  --key '{"pk":{"S":"USER#'"$SUB"'"},"sk":{"S":"CONFIG"}}' \
  --query 'keys(Item)' --output text | tr '\t' '\n' | sort
# expect: monthly_request_limit, pk, premium, sk, updated_at — and nothing else
```

Record the outcome in gate 11b's evidence cell (which account, when, verified attribute
set) — not by editing the commands above.

Fail-closed shapes, for reference: a missing item, `premium: false`, a
`monthly_request_limit <= 0`, or a malformed item all resolve to `403 premium_required`
on invoke. Never edit a `USAGE#` item to grant quota — `charged_count` is the accounting
authority and lowering it hands out free requests silently.

Re-check [Bedrock token pricing](https://aws.amazon.com/bedrock/pricing/) before
setting or raising any `monthly_request_limit`.

---

## 4. Verify the deployed API

```bash
bash apps/api-bedrock/scripts/smoke-test.sh
```

Asserts, without a user credential: the custom domain serves over TLS, both routes
reject an unauthenticated call with `401` **and** the canonical error envelope
(`error.code == "unauthorized"`, not API Gateway's generic body), and the default
`execute-api` endpoint is disabled.

Then, with a scoped premium test user and **BYO credentials cleared**, exercise all
four surfaces from one release build and confirm each uses hosted Bedrock while
preserving its existing observable behaviour:

| Surface | Expected |
|---|---|
| AI chat | Streams incrementally, token by token |
| Statement import | Image and PDF both parse into transactions |
| Project advice | Returns a parseable result |
| Spending-trends insight | Returns a parseable result |

Then confirm the negative paths:

- Set `monthly_request_limit` below `charged_count` → surfaces fall back to BYO, or
  report a typed error where no fallback is permitted.
- Flip `GLOBAL.enabled` to `false` → all four surfaces stop using hosted AI.
- Confirm CloudWatch logs contain **no** prompt, response, transaction, or file name —
  only `sub`, period, operation, timestamps, latency, status, counts, and token counts.

---

## Enablement gates

`GLOBAL.enabled = true` is forbidden until every row below has recorded evidence.

**Currently blocked on the unrun capability checks 1c–1f.** Both AD-8 model probes pass
on the direct model in `eu-west-2` (§0.1, §0.2), and gate 1b is waived — the concurrency
reservation is gone and the quota increase is no longer a dependency (§2.1). Gates 1g–1h
remain: they prove the deployed function is genuinely unreserved rather than reserved at
zero, and that it still points at the one model/region the probes covered.

| # | Gate | Reference | Evidence | Date |
|---|---|---|---|---|
| 1 | Deployed `CountTokens` probe succeeds on the exact model/region | §0.1, AD-8 | **PASSED** — `anthropic.claude-3-7-sonnet-20250219-v1:0` in `eu-west-2` returned an input-token count. Reached by a reviewed specification change away from the cross-region profile, which rejected the call. | 2026-08-26 |
| 1a | Deployed `ConverseStream` probe succeeds on that same model/region | §0.2, AD-7 | **PASSED** — streamed text to completion on `anthropic.claude-3-7-sonnet-20250219-v1:0` in `eu-west-2`; the model replied `OK.` | 2026-08-26 |
| 1b | ~~Lambda concurrent-executions quota raised~~ — **WAIVED** by the user on 2026-08-26: the function carries no reservation and uses the account's shared 50. Request `87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8` may stay `CASE_OPENED` but is no longer a rollout dependency. | §2.1 | **NOT A DEPENDENCY** | 2026-08-26 |
| 1c | Direct model lifecycle and account access confirmed (no announced end-of-life in the rollout horizon, access granted) | §0.3 | **NOT RUN** | |
| 1d | Multimodal compatibility confirmed: one real PDF and one image through `converse` on the same model/region | §0.3, CAP-2 | **NOT RUN** | |
| 1e | AD-8 output ceilings accepted by this model, checked at the largest (8192) | §0.3, AD-8 | **NOT RUN** | |
| 1f | `eu-west-2` per-model Bedrock RPM/TPM quotas checked against the account's shared 50 concurrency | §0.3, AD-4 | **NOT RUN** | |
| 1g | Deployed function reports **no** `ReservedConcurrentExecutions` (unreserved, not reserved-zero) | §2.2 | | |
| 1h | Deployed model/region assertions pass on both the stack outputs and the Lambda environment | §2.2, AD-8 | | |
| 2 | Cognito `nixus-api/ai.invoke` scope added to pool + app client | §1.1, AD-3 | | |
| 3 | Bootstrap stack deployed: OIDC provider, deploy role, CloudFormation execution role, artifact bucket. `sub` verified against `TrustedSubject` | §1.2, AD-12 | | |
| 3a | `production` environment populated with both role ARNs and the artifact bucket | §1.2 step 5 | | |
| 3b | Repository variable `API_BEDROCK_DEPLOY_ENABLED` set to `true` | §1.2 step 6 | | |
| 3c | Bootstrap workflow file deleted, so no static-key path to AWS remains | §1.2 step 7 | | |
| 4 | `production` environment requires approval and is default-branch-only | §1.2, AD-12 | | |
| 5 | Bedrock model-invocation logging confirmed disabled **in `eu-west-2`** | §1.4, AD-15 | | |
| 6 | Quota table: PITR `ENABLED`, deletion protection on, `Retain` policies present | §2.5, AD-15 | | |
| 7 | CloudWatch alarms exist (API 5XX, Lambda Errors, Lambda Throttles) and the SNS email subscription is **confirmed** | AD-14 | | |
| 8 | AWS Budget `$50/mo` on Bedrock with 80% / 100% notifications | AD-14 | | |
| 9 | Terms of Service and Privacy Policy published, EN + FR, stating: transmission through Nixus to AWS Bedrock; direct processing in `eu-west-2` (United Kingdom) and abuse-detection implications; non-retention is Nixus-controlled only and does not bind AWS; request quota; BYO fallback | AD-13 | | |
| 10 | `README.md` and all marketing copy no longer claim data never leaves the machine, and no longer describe US cross-region processing | AD-13 | | |
| 11 | `GLOBAL#CONFIG` seeded with `enabled: false` | §3.1, AD-15 | | |
| 11a | Orphaned retained table from the rolled-back first attempt identified, confirmed empty, and removed by hand | §2.4 | | |
| 11b | Premium `USER#<sub>/CONFIG` written conditionally and verified: `premium=true`, `monthly_request_limit=200`, and the attribute set carries no email, name, or content | §3.2, AD-6/AD-11 | | |
| 12 | Deployed smoke test passes | §4, AD-2/AD-3 | | |
| 13 | All four surfaces verified hosted on one release build, BYO cleared | §4, CAP-1/CAP-2 | | |
| 14 | Quota-exhaustion and global-disable fallback verified | §4, CAP-5 | | |
| 15 | CloudWatch logs verified free of prompts, responses, and file paths | §4, AD-11 | | |

**SNS note:** an email subscription stays `PendingConfirmation` until the recipient
clicks the confirmation link. An unconfirmed subscription silently delivers nothing,
so gate 7 requires confirmed, not merely created.

### Flip the switch

Only once **every** gate above is evidenced — including gates 1c–1f (the capability
checks a text-only stream probe does not cover) and gates 1g/1h (the deployed function is
unreserved and still pointed at the approved model/region):

```bash
aws dynamodb update-item --table-name "$TABLE" \
  --key '{"pk":{"S":"GLOBAL"},"sk":{"S":"CONFIG"}}' \
  --update-expression "SET enabled = :t, updated_at = :now" \
  --expression-attribute-values '{":t":{"BOOL":true},":now":{"S":"2026-08-26T00:00:00Z"}}'
```

---

## Rollback and incident response

### Emergency stop (seconds, no deploy)

`GLOBAL.enabled = false` is the kill switch. It is enforced in the same transaction as
every reservation, so it takes effect on the very next request.

```bash
aws dynamodb update-item --table-name "$TABLE" \
  --key '{"pk":{"S":"GLOBAL"},"sk":{"S":"CONFIG"}}' \
  --update-expression "SET enabled = :f, updated_at = :now" \
  --expression-attribute-values '{":f":{"BOOL":false},":now":{"S":"'"$(date -u +%FT%TZ)"'"}}'
```

Desktop clients see `503 hosted_unavailable`, fall back to BYO where permitted, and
cache "unavailable" for at most 60 seconds. In-flight committed streams finish and
stay charged — that is intended (AD-7), not a leak.

### Reduce blast radius without a full stop

- Lower `GLOBAL.monthly_request_limit` to throttle total spend.
- Lower or remove a single user's `USER#<sub>/CONFIG` to cut off one account.

### Roll back code

Revert the offending commit and let the pipeline redeploy, or
`aws cloudformation cancel-update-stack` / deploy the previous template. **The
DynamoDB table is `Retain`-protected**, so quota state and recovery history survive
stack changes; a rollback does not reset anyone's `charged_count`.

### Known accepted risk

A hard Lambda crash or timeout past the 10-second soft deadline can leak one
`charged_count` increment (the user is charged for a request that produced nothing).
This is an explicitly accepted v1 risk with **no reconciler** (AD-7). To compensate a
user, raise their `monthly_request_limit` — do **not** edit `charged_count`.

### Alarm triage

| Alarm | Likely cause | First action |
|---|---|---|
| API Gateway `5XXError` | Lambda faulting or timing out | Check the function log group for `unhandled_error` |
| Lambda `Errors` | Handler exception | Check `invoke_rejected` / `invoke_failed_after_commit` entries |
| Lambda `Throttles` | The **account's** shared unreserved pool (50) is exhausted — by this function or another, since there is no function-level reservation (§2.1) | Check `get-account-settings` for the current pool, then decide whether it is genuine load, abuse, or another function; consider the kill switch |
| Budget 80% / 100% | Bedrock spend | Lower `GLOBAL.monthly_request_limit`; the budget only notifies, it never stops traffic |

---

## Deferred (not in v1)

S3-backed statement upload · a `charged_count` reconciler · a staging stack · an admin
UI for premium/quota · any in-app status or quota UI · WAF in front of the API.
