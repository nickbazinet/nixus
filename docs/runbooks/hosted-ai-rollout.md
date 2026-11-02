# Runbook — Hosted AI (Nixus Cloud Bedrock) rollout

Owner: Nixus operator (single-operator service)
Stack: `nixus-bedrock-api` · region `us-east-1` (API and Bedrock) · one production stack, no staging (AD-15)

`GLOBAL.enabled` is the single switch that turns hosted AI on. It was enabled on
2026-08-26 for the first premium beta account after the direct model passed text,
PDF, image, and output-ceiling probes. Set it to `false` for an immediate stop.

---

## 0. Model and quota design — what is verified, and what is not

**STATUS: quota is per request. NO TOKEN-COUNTING CALL EXISTS ANYWHERE. NO CONCURRENCY DEPENDENCY REMAINS (§2.1). The model is `us.anthropic.claude-sonnet-4-6` on BOTH the hosted path and the desktop BYO adapter. Streaming, multimodal, and the output ceiling were verified on `anthropic.claude-sonnet-4-6`; §0.3 is the re-confirmation owed through that model's `us.` profile.**

> **Rolled back — 2026-11-02.** `us.anthropic.claude-sonnet-5-5` was adopted on
> 2026-10-28 and reverted the same way it arrived. This AWS account has **0 TPM and 0 RPM
> quota** for Sonnet 5.5: Bedrock answers every call with
> `AccessDeniedException … anthropic.claude-sonnet-5-5 is not available for this account`,
> so no amount of code was ever going to make it stream. Sonnet 4.6 was re-confirmed live
> on the same date — a `converse` returned OK through
> `arn:aws:bedrock:us-east-1:<account>:inference-profile/us.anthropic.claude-sonnet-4-6`,
> `ACTIVE`, `SYSTEM_DEFINED`, fanning out to `us-east-1`, `us-east-2`, and `us-west-2`.
> **Re-adopting Sonnet 5.5 requires an approved Bedrock throughput quota increase for that
> model in this account first (§0.4); it is not a code change.** Everything the 5.5 attempt
> added to the deploy path — the explicit `BedrockFoundationModelArnPattern`, the
> pre-deploy profile validation, the post-deploy grant assertion, the bootstrap read grant
> (gate 1j), and the `cfn-lint` of the bootstrap template — is kept and now names 4.6.

### 0.1 Quota is per request, and streaming is the only Bedrock call

The monthly entitlement is a **request count**. Each actual `ConverseStream` invocation
consumes exactly one `charged_count` unit; a chat turn that makes two model calls around a
local tool consumes two. Input and output token counts are read from the stream's own
metadata and recorded for **observability only** — they never gate a request, never bill,
and are never estimated locally.

That makes `ConverseStream` the only Bedrock call the service makes. There is **no
`bedrock:CountTokens` call anywhere**, no token preflight, and no `bedrock:CountTokens` in
the execution role — an action nothing calls would only be an invitation to start calling
it. Input size is bounded before any reservation from the request itself: the per-operation
serialized-JSON ceilings and the 4 MiB decoded-media cap, both computable without an
upstream call. Output stays token-bounded because only the model can enforce that, through
`inferenceConfig.maxTokens`.

Because no CountTokens call exists, the model is a **cross-region inference profile**
again: `us.anthropic.claude-sonnet-4-6` in `us-east-1`. Profiles do not support
`CountTokens`, which is what once forced a bare foundation model; nothing asks them to now.
API, Lambda, table, and Bedrock all sit in `us-east-1`, and the Lambda inherits its region
— there is no Bedrock region parameter or environment variable to set.

The unprefixed `anthropic.claude-sonnet-4-6` is the foundation-model identity, not an
invocation identity: it has no direct in-region on-demand endpoint. It appears only as the
destination in the IAM pattern `arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*`.

Probe against the value the stack actually deployed, never a remembered one. The lookup
fails fast rather than probing an empty model id, which Bedrock would reject with a
message about the request shape instead of about the stack:

```bash
set -euo pipefail

MODEL="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='BedrockModelIdEcho'].OutputValue" --output text)"
test -n "$MODEL" && test "$MODEL" != "None" || { echo "BedrockModelIdEcho unresolved" >&2; exit 1; }
test "$MODEL" = "us.anthropic.claude-sonnet-4-6" \
  || { echo "deployed model is ${MODEL}, expected us.anthropic.claude-sonnet-4-6" >&2; exit 1; }

aws bedrock-runtime converse-stream \
  --region us-east-1 --model-id "$MODEL" \
  --messages '[{"role":"user","content":[{"text":"probe"}]}]' \
  --inference-config '{"maxTokens":16}'
```

Expected: streamed text to completion. That is the whole model gate — a `CountTokens`
probe is not part of this design and must not be reintroduced as one.

**What must NOT change without a review.** Each of these alters cost enforcement or data
processing:

- do **not** add a `CountTokens` call, a token preflight, or a locally estimated count,
- do **not** make quota token-based; `charged_count` counts requests,
- do **not** change the model or move Bedrock out of `us-east-1`,
- do **not** invoke the unprefixed foundation model; it is a destination, not an endpoint,
- do **not** remove the pre-reservation byte and media checks, which are what stop an
  oversized request from costing a unit.

### 0.2 Obtain, validate, and set the profile secret

`BEDROCK_INFERENCE_PROFILE_ARN` is the account-specific half of the model identity and it
must name the 4.6 profile **before** the application deploy. Every command below
fails closed, because the failure this sequence exists to prevent is a well-formed ARN that
names something else — a profile in another account, a deleted one, or one still routing to
the superseded model. The deploy would accept such a value silently and make it the IAM
resource the Lambda streams against.

```bash
set -euo pipefail

PROFILE_ARN="$(aws bedrock get-inference-profile \
  --region us-east-1 \
  --inference-profile-identifier us.anthropic.claude-sonnet-4-6 \
  --query 'inferenceProfileArn' --output text)"
test -n "$PROFILE_ARN" && test "$PROFILE_ARN" != "None" \
  || { echo "the approved profile is not readable in this account" >&2; exit 1; }
```

Then validate what that ARN actually resolves to. These are the **same checks the deploy
workflow re-runs** on the supplied secret
(`apps/api-bedrock/scripts/validate-inference-profile.sh`), so a value that passes here
cannot fail there for a reason you have not already seen. Every one of them must pass —
including the exact ARN echo-back and a non-empty destination list, because a profile that
declares no destinations has nothing the IAM grant can cover:

```bash
set -euo pipefail

PROFILE="$(aws bedrock get-inference-profile --region us-east-1 \
  --inference-profile-identifier "$PROFILE_ARN" --output json)"

# The response must name back exactly the ARN that was asked for: a resolved ARN that
# differs means the identifier was treated as a name, not as the account's own resource.
test "$(jq -r '.inferenceProfileArn' <<<"$PROFILE")" = "$PROFILE_ARN" \
  || { echo "the resolved ARN is not the ARN supplied" >&2; exit 1; }
test "$(jq -r '.inferenceProfileId' <<<"$PROFILE")" = "us.anthropic.claude-sonnet-4-6" \
  || { echo "the ARN does not name the approved profile" >&2; exit 1; }
test "$(jq -r '.status' <<<"$PROFILE")" = "ACTIVE" \
  || { echo "the profile is not ACTIVE" >&2; exit 1; }
test "$(jq -r '.type' <<<"$PROFILE")" = "SYSTEM_DEFINED" \
  || { echo "the profile is not the system-defined one" >&2; exit 1; }

# A non-empty destination list, every entry carrying a modelArn, every modelArn under the
# approved pattern. An entry without a modelArn is a route this check cannot see.
test "$(jq -r '(.models // []) | length' <<<"$PROFILE")" -ge 1 \
  || { echo "the profile declares no destination models" >&2; exit 1; }
jq -e 'all((.models // [])[]; (.modelArn // "") != "")' <<<"$PROFILE" >/dev/null \
  || { echo "a destination model carries no modelArn" >&2; exit 1; }
jq -e 'all((.models // [])[].modelArn; test("foundation-model/anthropic\\.claude-sonnet-4-6"))' \
  <<<"$PROFILE" >/dev/null \
  || { echo "a destination model is outside the approved pattern" >&2; exit 1; }

echo "profile_validated=true"
```

Only then set the secret. **Do not echo `$PROFILE_ARN`** — it carries the account id:

> GitHub → Settings → Environments → `production` → secret `BEDROCK_INFERENCE_PROFILE_ARN`.

Record the outcome against gate 1h, whose post-deploy assertion is what proves the value
actually landed. Updating the secret is a prerequisite of the deploy, not a substitute for
that assertion: the workflow reads the deployed parameter back and compares it to this
value, because CloudFormation preserves a parameter an UPDATE omits.

### 0.3 Re-confirm the capability evidence through the profile

Streaming, multimodal PDF + image, and the 8192 output ceiling were all verified against
`anthropic.claude-sonnet-4-6` — the foundation model this profile routes to — so the
capability evidence is about the same model. **What changed is the invocation identity:**
requests name `us.anthropic.claude-sonnet-4-6`, and a profile carries its own model access
and its own regional capacity. Re-run these through the profile after the deploy and record
them against gates 1c–1e; until then they are evidence for the direct model, not for what
production calls. The 2026-08-26 dates stay: they are what makes the rows a record rather
than a tick.

| Check | Why the identity change matters | How to check | Gate |
|---|---|---|---|
| Streaming | A profile's streaming support and capacity are its own, not the direct model's | `converse-stream` per §0.1 with `$MODEL` | 1a |
| Profile model access and lifecycle | Access is granted per profile *and* per destination model; either can be missing | Bedrock → Model access in `us-east-1`, plus `aws bedrock get-foundation-model --model-identifier anthropic.claude-sonnet-4-6` | 1c |
| Multimodal PDF + image | Statement import sends `document`/`image` blocks; profile routing must accept them the same way | `converse` once with a small real PDF and once with a PNG, using `$MODEL` | 1d |
| Output ceiling | The largest operation asks for 8192 output tokens and must not be rejected | `converse` with `maxTokens` at 8192 | 1e |
| BYO Bedrock on 4.6 | A BYO user never reaches this stack: their own account needs 4.6 model access, and `ai/backend.rs` invokes the same profile with *their* credentials. Hosted evidence proves nothing for them | From a release desktop build with BYO Bedrock credentials configured and hosted AI unavailable, run one chat turn and one statement import | 1i |

`GLOBAL` is already enabled for the first premium beta account (gate 11). These checks are
therefore **post-change verification on live configuration**, not a gate holding traffic
back — if any of them fails, flip `enabled` to `false` (see Emergency stop) rather than
leaving a broken model in service.

### 0.4 Per-model Bedrock throughput quotas

`charged_count` caps how many requests Nixus will pay for; it says nothing about how many
AWS will *accept*. Those are per-model, per-region account quotas, and a new model starts
with its own — which is exactly what sank the 2026-11-02 Sonnet 5.5 rollback: this account
holds **0 TPM / 0 RPM** for that model, so Bedrock refused every call with
`AccessDeniedException` before any throughput was ever used. Exhausting a quota the account
*does* hold surfaces instead as `ThrottlingException`, which the service classifies
`503 hosted_unavailable` and the desktop treats as an outage with BYO fallback.

Read the current values rather than assuming them:

```bash
set -euo pipefail

aws service-quotas list-service-quotas --service-code bedrock --region us-east-1 \
  --query "Quotas[?contains(QuotaName, 'Claude Sonnet 4.6')].[QuotaName,Value]" \
  --output table
```

If that returns nothing, the quotas are not yet published under that name — fall back to
the Service Quotas console (Bedrock → `us-east-1`) and search for the model. Record the
on-demand requests-per-minute and tokens-per-minute figures against gate 1f.

This is **deferred for real traffic**, not waived: at beta volume the 10 RPS stage
throttle and the monthly request caps bind first. It becomes a blocker only when real
usage approaches the account figures. Raising a quota is a separate AWS request and is
not part of this change — and it is the **precondition** for ever re-adopting Sonnet 5.5:
run this query against that model's name first, and do not change a single identity
authority until the figures come back non-zero.


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
   | `BEDROCK_INFERENCE_PROFILE_ARN` | secret | ARN of the approved `us.anthropic.claude-sonnet-4-6` profile — obtain and validate it per §0.2 |

   `BEDROCK_INFERENCE_PROFILE_ARN` is the **only** Bedrock input, and it exists because a
   profile ARN carries an account id. The model id and the destination foundation-model
   ARN pattern are not inputs: each is pinned to a single `AllowedValues` entry in the
   template and passed explicitly by the workflow, so neither can be chosen, widened, or
   preserved from a previous deploy.

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

#### Bootstrap before application, whenever the bootstrap stack changes

**Ordering is load-bearing, not cosmetic.** The application deploy job now resolves the
supplied inference-profile ARN through `bedrock:GetInferenceProfile` *before* deploying
(§0.2), and the only identity holding that permission is `GitHubDeployRole` — created by
this bootstrap stack. Deploy them out of order and the validation step fails closed on
**authorization**, not on a stale ARN, which looks like a broken check rather than a
missing grant.

So, on any change under `infra/bootstrap/`:

1. Merge the bootstrap change. CI runs this service's contract tests and `cfn-lint`
   against the bootstrap template on that change, because `infra/bootstrap/**` is one of
   the workflow's path triggers.
2. Re-deploy the bootstrap stack. It is a normal CloudFormation UPDATE of whichever
   stack `infra/bootstrap/github-oidc-deploy.yaml` was deployed as; the OIDC provider,
   both roles, and the artifact bucket are all `Retain`-protected, so an UPDATE cannot
   strand the pipeline. Re-adding the deleted bootstrap workflow is the only way to run
   it through Actions — which keeps that a deliberate, visible act (§1.2 step 7).
3. Confirm the grant is live, then record gate **1j** (a *pre-deploy* gate — it must pass
   before the application stack is deployed, not after). The role name is read back from
   the bootstrap stack's own output rather than typed in, so this cannot pass against a
   role the stack does not actually own:

   ```bash
   set -euo pipefail
   : "${BOOTSTRAP_STACK:?set BOOTSTRAP_STACK to the deployed bootstrap stack name}"

   ROLE_ARN="$(aws cloudformation describe-stacks --stack-name "$BOOTSTRAP_STACK" \
     --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text)"
   test -n "$ROLE_ARN" && test "$ROLE_ARN" != "None" \
     || { echo "DeployRoleArn unresolved on $BOOTSTRAP_STACK" >&2; exit 1; }
   ROLE="${ROLE_ARN##*/}"

   STATEMENT="$(aws iam get-role-policy --role-name "$ROLE" \
     --policy-name post-deploy-verification-reads \
     --query 'PolicyDocument.Statement[?Sid==`ResolveTheOneApprovedInferenceProfile`]' \
     --output json)"

   # Exactly one statement, exactly one action, exactly one resource. A second action or
   # a profile wildcard would let the pre-deploy check pass for any profile in the
   # account, which is the whole thing it exists to rule out.
   jq -e 'length == 1' <<<"$STATEMENT" >/dev/null \
     || { echo "the single-ARN profile read grant is not deployed" >&2; exit 1; }
   jq -e '.[0] | ([.Action] | flatten) == ["bedrock:GetInferenceProfile"]' <<<"$STATEMENT" >/dev/null \
     || { echo "the grant is not exactly one read action" >&2; exit 1; }
   jq -e '.[0] | ([.Resource] | flatten | length) == 1' <<<"$STATEMENT" >/dev/null \
     || { echo "the grant is not scoped to exactly one resource" >&2; exit 1; }
   jq -e '.[0] | ([.Resource] | flatten | .[0])
            | test("inference-profile/us\\.anthropic\\.claude-sonnet-4-6$") and (test("\\*") | not)' \
     <<<"$STATEMENT" >/dev/null \
     || { echo "the grant does not name exactly the approved profile ARN" >&2; exit 1; }

   echo "bootstrap_profile_read_grant=ok role=${ROLE}"
   ```

4. Only then deploy the application stack (§2).

The grant is read-only, one action, and scoped to one profile ARN. It holds no invoke,
list, or write action — the deploy role must never be able to spend Bedrock tokens.

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
regions. `us-east-1` is where invocations happen; `eu-west-2` is where they were briefly
aimed, so a configuration left there from that period is exactly the kind of thing that
survives a region change unnoticed. A cross-region profile can also route to other US
regions, so check any region the profile has served.

```bash
set -uo pipefail
for region in us-east-1 eu-west-2; do
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
aws bedrock delete-model-invocation-logging-configuration --region us-east-1
aws bedrock delete-model-invocation-logging-configuration --region eu-west-2
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
| Per-operation input byte ceilings + 4 MiB media cap, checked before reservation | `src/lib/validation.ts`, AD-8 |
| Per-operation output token ceiling, applied by the model | `inferenceConfig.maxTokens`, AD-8 |
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
set -euo pipefail

FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionName'].OutputValue" --output text)"
test -n "$FUNCTION_NAME" && test "$FUNCTION_NAME" != "None" \
  || { echo "FunctionName unresolved" >&2; exit 1; }

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
every model-bearing parameter explicitly — `BedrockModelId`, `BedrockInferenceProfileArn`,
and `BedrockFoundationModelArnPattern` — and asserts all three on the deployed stack
afterwards. Changing only the model id would leave the IAM grant authorizing the
superseded model, which no runtime check would notice. A parameter deleted from the
template simply ceases to exist on the stack, which is what happened to `BedrockRegion`.
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
  set -euo pipefail
  CURRENT="$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
    --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)"
  test -n "$CURRENT" && test "$CURRENT" != "None" \
    || { echo "TableName unresolved" >&2; exit 1; }
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
set -euo pipefail
: "${TABLE:?set TABLE to the deployed quota table name, read back from the stack}"

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
set -euo pipefail

TABLE=$(aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)
test -n "$TABLE" && test "$TABLE" != "None" \
  || { echo "TableName unresolved" >&2; exit 1; }

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
set -euo pipefail
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
set -euo pipefail
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
set -euo pipefail
: "${TABLE:?run the lookup block above first}"
: "${SUB:?run the lookup block above first}"

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
set -euo pipefail
: "${TABLE:?run the lookup block above first}"
: "${SUB:?run the lookup block above first}"

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

Then, with **BYO Bedrock credentials configured and hosted AI unavailable**, run one chat
turn and one statement import from the same build (gate 1i). This is a separate path, not
a repeat: a BYO user never reaches this stack, `ai/backend.rs` invokes the 4.6 profile with
*their* AWS credentials, and 4.6 model access in their own account is a prerequisite
nothing on the hosted side can prove. A hosted-only verification leaves every BYO user
unverified.

---

## Enablement gates

`GLOBAL.enabled = true` is forbidden until every row below has recorded evidence.

The core first-customer gates are complete for the direct model. Gates 1a, 1c, 1d, 1e,
and 1h are owed a re-confirmation through the `us.` profile, and 1i (BYO on 4.6) and 1j
(the bootstrap read grant) have no evidence yet. The 2026-11-02 Sonnet 5.5 rollback
changed none of that: 4.6 is the identity those dated rows were recorded against, so they
stand as they did. Remaining operational checks below are follow-up hardening, not
blockers for this beta account.

| # | Gate | Reference | Evidence | Date |
|---|---|---|---|---|
| 1 | Quota is per request: no `CountTokens` call, no token preflight, no `bedrock:CountTokens` grant | §0.1, AD-8 | **BY DESIGN** — enforced by service tests (`no CountTokens command/IAM/action`, one reservation per stream call) | 2026-08-26 |
| 1a | `ConverseStream` succeeds on the deployed model | §0.1, AD-7 | **PASSED for `anthropic.claude-sonnet-4-6`** — streamed `OK.`; **RE-RUN REQUIRED against `us.anthropic.claude-sonnet-4-6`** | 2026-08-26 |
| 1b | ~~Lambda concurrent-executions quota raised~~ — **WAIVED** by the user on 2026-08-26: the function carries no reservation and uses the account's shared 50. Request `87ed4948ee0d48d59c3637f58a2ed33bo8DRLke8` may stay `CASE_OPENED` but is no longer a rollout dependency. | §2.1 | **NOT A DEPENDENCY** | 2026-08-26 |
| 1c | Profile model access and lifecycle confirmed | §0.3 | **PASSED for `anthropic.claude-sonnet-4-6`** — `ACTIVE`, streaming supported; re-confirm through the profile | 2026-08-26 |
| 1d | Multimodal compatibility confirmed: one real PDF and one image | §0.3, CAP-2 | **PASSED for `anthropic.claude-sonnet-4-6`** — `PDF_OK`, `IMAGE_OK`; re-confirm through the profile | 2026-08-26 |
| 1e | Output ceiling accepted at 8192 | §0.3, AD-8 | **PASSED for `anthropic.claude-sonnet-4-6`** — `LIMIT_OK`; re-confirm through the profile | 2026-08-26 |
| 1f | `us-east-1` per-model Bedrock RPM/TPM quotas read and recorded for `anthropic.claude-sonnet-4-6` | §0.4 | **DEFERRED FOR REAL TRAFFIC** — the on-demand RPM/TPM figures for the deployed model are **not yet confirmed** against Service Quotas; a zero figure is what made Sonnet 5.5 undeployable on 2026-11-02 | |
| 1g | Deployed function reports **no** `ReservedConcurrentExecutions` | §2.2 | **PASSED** — GitHub run `32997823488` | 2026-08-26 |
| 1h | Deployed model assertion passes on all three model-bearing parameters (stack output, Lambda env, and the deployed profile ARN / destination pattern against the validated secret), and no orphaned `BEDROCK_REGION` survives | §0.2, §2.2, AD-8 | **RE-RUN REQUIRED** — the recorded pass was against the direct model in `eu-west-2` and predates the parameter assertions | |
| 1i | BYO Bedrock verified on 4.6 from a release desktop build, with hosted AI unavailable: one chat turn and one statement import, and the user's own account confirmed to hold 4.6 model access | §0.3, CAP-1/CAP-2 | **NOT RUN** — no BYO evidence exists for the profile `ai/backend.rs` invokes | |
| 1j | **PRE-DEPLOY.** Bootstrap stack re-deployed with the single-ARN `bedrock:GetInferenceProfile` grant and verified exactly one action / one non-wildcard resource, with the role name derived from the stack output. Must pass **before** the application deploy | §1.2 bootstrap-before-application | **NOT RUN** — without it the pre-deploy profile validation fails closed on authorization, not on a stale ARN | |
| 2 | Cognito `nixus-api/ai.invoke` scope added to pool + app client | §1.1, AD-3 | | |
| 3 | Bootstrap stack deployed: OIDC provider, deploy role, CloudFormation execution role, artifact bucket. `sub` verified against `TrustedSubject` | §1.2, AD-12 | | |
| 3a | `production` environment populated with both role ARNs and the artifact bucket | §1.2 step 5 | | |
| 3b | Repository variable `API_BEDROCK_DEPLOY_ENABLED` set to `true` | §1.2 step 6 | | |
| 3c | Bootstrap workflow file deleted, so no static-key path to AWS remains | §1.2 step 7 | | |
| 4 | `production` environment requires approval and is default-branch-only | §1.2, AD-12 | | |
| 5 | Bedrock model-invocation logging confirmed disabled **in `us-east-1`, and swept in `eu-west-2`** | §1.4, AD-15 | | |
| 6 | Quota table: PITR `ENABLED`, deletion protection on, `Retain` policies present | §2.5, AD-15 | | |
| 7 | CloudWatch alarms exist (API 5XX, Lambda Errors, Lambda Throttles) and the SNS email subscription is **confirmed** | AD-14 | | |
| 8 | AWS Budget `$50/mo` on Bedrock with 80% / 100% notifications | AD-14 | | |
| 9 | Terms of Service and Privacy Policy published, EN + FR, stating: transmission through Nixus to AWS Bedrock; US cross-region processing and abuse-detection implications; non-retention is Nixus-controlled only and does not bind AWS; a **monthly request** quota; BYO fallback | AD-13 | | |
| 10 | `README.md` and all marketing copy no longer claim data never leaves the machine, and describe US cross-region processing accurately | AD-13 | | |
| 11 | `GLOBAL#CONFIG` present with monthly limit 1000 | §3.1, AD-15 | **ENABLED by explicit user decision for first premium beta** | 2026-08-26 |
| 11a | Orphaned retained table from the rolled-back first attempt identified, confirmed empty, and removed by hand | §2.4 | | |
| 11b | Premium `USER#<sub>/CONFIG` written conditionally and verified: `premium=true`, `monthly_request_limit=200`, and the attribute set carries no email, name, or content | §3.2, AD-6/AD-11 | | |
| 12 | Deployed smoke test passes | §4, AD-2/AD-3 | | |
| 13 | All four surfaces verified hosted on one release build, BYO cleared, against the deployed 4.6 profile | §4, CAP-1/CAP-2 | | |
| 14 | Quota-exhaustion and global-disable fallback verified | §4, CAP-5 | | |
| 15 | CloudWatch logs verified free of prompts, responses, and file paths | §4, AD-11 | | |

**SNS note:** an email subscription stays `PendingConfirmation` until the recipient
clicks the confirmation link. An unconfirmed subscription silently delivers nothing,
so gate 7 requires confirmed, not merely created.

### Flip the switch

The first-customer switch was enabled after gates 1–1e, 1g, and 1h passed against the
direct model. The switch stays on by the same explicit user decision, so gates 1a, 1c, 1d,
1e, 1h, 1i, and 1j are **post-change verification on live configuration** (§0.3) rather
than a hold on traffic — a failure there is an incident to stop with the kill switch, not a
gate to wait on. For later rollout, complete the remaining operational evidence before
broadening access:

```bash
set -euo pipefail
: "${TABLE:?set TABLE to the deployed quota table name}"

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
set -euo pipefail
: "${TABLE:?set TABLE to the deployed quota table name}"

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
