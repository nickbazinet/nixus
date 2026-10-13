# Story 2 — Sync infrastructure stack (implementation spec)

Serves CAP-9 (account isolation, cost). Binds AD-6 (key layout), AD-7 (identity pool + prefix-scoped role), AD-8 (SSE-S3, TLS-only, block public access), AD-17 (separate compute-free stack `nixus-sync`, us-east-1), AD-12-inherited (scoped deviation: static repo AWS keys, not OIDC).

Deliverables (Phase B): `infra/sync/template.yaml`, `infra/sync/verify-template.py`, `.github/workflows/sync-infra.yml`. Nothing in `apps/`, `packages/`, `apps/api-bedrock/`, `infra/bootstrap/` is touched. AD-18 (request metrics, alarm, Budget) is Story 26 / Milestone 2 and is deliberately absent.

## 1. Template — `infra/sync/template.yaml` (stack `nixus-sync`, us-east-1)

Plain CloudFormation (`AWSTemplateFormatVersion: '2010-09-09'`, no `Transform`): there is no compute, so SAM buys nothing and `sam build` is not needed. Style mirrors `infra/bootstrap/github-oidc-deploy.yaml` (banner comment per block, WHY comments only).

### Parameters (non-secret, with defaults)

| Parameter | Default | Pattern | Rationale |
| --- | --- | --- | --- |
| `UserPoolId` | `us-east-1_7gfGQ0emg` | `^[\w-]+_[0-9a-zA-Z]+$` | The existing pool. Public by design (it is in the OIDC discovery URL); provenance: `_bmad-output/implementation-artifacts/26-1-cognito-user-pool-and-public-app-client-setup.md` (verified live against the public discovery document). No in-repo Rust const holds it, so the drift guard checks format only. |
| `AppClientId` | `6525109r95las7odvuesf13joj` | `^[a-z0-9]+$` | Already committed as `COGNITO_CLIENT_ID` in `apps/desktop/src-tauri/src/commands/auth.rs:27` and public by design (it travels in the address bar). Drift-guarded against that const. |

Defaults, not secrets: both values are already in the repo or in a public document, and a default keeps the deploy command reproducible from a `workflow_dispatch` with no repo variables configured. The workflow still passes both explicitly (§2) and the verify script asserts workflow literals == template defaults == `auth.rs`, so the three cannot drift apart silently. The pool and app client are **referenced only**; this stack never creates, imports or updates them.

### `SyncBucket` — `AWS::S3::Bucket`

`DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`. `BucketName: !Sub 'nixus-sync-${AWS::AccountId}-${AWS::Region}'`.

Bucket-name decision (collision-safe vs. a retained bucket after a failed create): a **deterministic account-scoped name**, not a CloudFormation-generated one. A generated name is unique but changes on every retry, so a `Retain`ed bucket from a failed create becomes an unreachable orphan and the client's bucket name is unpredictable. The deterministic name is globally unique in practice (a 12-digit account id nobody else can guess-squat), is the convention already used by `SamArtifactBucket`, and — critically — is **the same name on a retry**: with `--disable-rollback` (§3) the failed create stays `CREATE_FAILED` with the already-created bucket still owned by the stack as `CREATE_COMPLETE`, so the follow-up deploy does not re-create it and cannot hit `BucketAlreadyOwnedByYou`.

Properties: `PublicAccessBlockConfiguration` all four `true`; `BucketEncryption` → `ServerSideEncryptionByDefault.SSEAlgorithm: AES256` (no `BucketKeyEnabled`: S3 Bucket Keys only affect SSE-KMS, and copying it here would be inert cargo cult); `VersioningConfiguration.Status: Enabled`; `OwnershipControls` → `BucketOwnerEnforced` (ACLs disabled, so the only access path is IAM/bucket policy); `LifecycleConfiguration` with exactly two rules — `expire-noncurrent-objects` (`NoncurrentVersionExpirationInDays: 30`) and `abort-incomplete-uploads` (`AbortIncompleteMultipartUpload.DaysAfterInitiation: 7`). No tags: tagging adds `s3:PutBucketTagging`/`iam:TagRole`/`cognito-identity:TagResource` to the unknown-permission surface for no operational benefit.

### `SyncBucketPolicy` — `AWS::S3::BucketPolicy`

One `Deny` statement, verbatim shape of `SamArtifactBucketPolicy`: `Sid: DenyInsecureTransport`, `Principal: '*'`, `Action: 's3:*'`, `Resource: [bucket ARN, bucket ARN + '/*']`, `Condition.Bool.'aws:SecureTransport': false` (AD-8: plaintext transport refused, not merely discouraged).

### `SyncIdentityPool` — `AWS::Cognito::IdentityPool`

`IdentityPoolName: !Ref AWS::StackName` (`nixus-sync`), `AllowUnauthenticatedIdentities: false`, `AllowClassicFlow: false` (basic flow off ⇒ **enhanced flow only**: Cognito itself calls STS and picks the role, so a client cannot nominate a role of its choosing — AD-7), `CognitoIdentityProviders: [{ ProviderName: !Sub 'cognito-idp.${AWS::Region}.amazonaws.com/${UserPoolId}', ClientId: !Ref AppClientId, ServerSideTokenCheck: true }]`. `ServerSideTokenCheck: true` so a deleted or globally signed-out user stops getting credentials instead of riding a still-unexpired ID token for up to an hour; cost is one extra pool lookup per `GetId`/`GetCredentialsForIdentity`.

### `SyncAuthenticatedRole` — `AWS::IAM::Role`

`RoleName: !Sub '${AWS::StackName}-authenticated'` → `nixus-sync-authenticated`, satisfying the `nixus-sync-*` naming rule; named (not generated) because Story 3 needs a stable ARN to simulate against. Requires `CAPABILITY_NAMED_IAM`.

Trust policy (exactly one statement):

```json
{ "Version": "2012-10-17", "Statement": [{
  "Effect": "Allow",
  "Principal": { "Federated": "cognito-identity.amazonaws.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals":           { "cognito-identity.amazonaws.com:aud": "<!Ref SyncIdentityPool>" },
    "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" }
  }
}]}
```

`aud` is `!Ref SyncIdentityPool`, which both pins the role to this pool and creates the implicit dependency that orders pool-before-role at create time. `amr` is `ForAnyValue:StringLike` because `amr` is a multi-valued key (it also carries the provider name); the condition therefore says "at least one value is `authenticated`", which an unauthenticated identity (`unauthenticated` in `amr`) can never satisfy.

Inline policy `nixus-sync-prefix-access` (exact draft, `<bucket>` = `!GetAtt SyncBucket.Arn`):

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "ReadWriteOwnPrefixOnly",
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "<bucket>/acct/${cognito-identity.amazonaws.com:sub}/*" },
  { "Sid": "ListOwnPrefixOnly",
    "Effect": "Allow",
    "Action": "s3:ListBucket",
    "Resource": "<bucket>",
    "Condition": { "StringLike": { "s3:prefix": "acct/${cognito-identity.amazonaws.com:sub}/*" } } }
]}
```

Why `${cognito-identity.amazonaws.com:sub}` resolves under the enhanced flow: the enhanced flow's `GetCredentialsForIdentity` has Cognito call `AssumeRoleWithWebIdentity` with the OIDC token Cognito mints for the identity, whose `sub` claim **is the identity id** (`us-east-1:<uuid>`). IAM exposes that claim as the request key `cognito-identity.amazonaws.com:sub`, and a `${...}` policy variable (legal because `Version` is `2012-10-17`) substitutes it at evaluation time. So one role serves every account and each caller can only name its own `acct/<identity-id>/` prefix — exactly the AD-6 key layout. The colon inside the identity id is a legal S3 key character and legal inside the resource segment of an S3 ARN (this is AWS's own documented Cognito example form).

Scope justification: `s3:GetObject` covers HEAD and conditional GET (`If-None-Match`/`If-Match`); `s3:PutObject` covers create-only (`If-None-Match: *`) and CAS (`If-Match`) writes. Deliberately **absent**: `s3:DeleteObject` (retention/compaction is AD-13, Milestone 2 Story 23 — adding it now would be unreviewed scope creep), `s3:GetObjectVersion` (versioning is an owner-side recovery net, not a client surface), `s3:AbortMultipartUpload`/`ListMultipartUploadParts` (AD-18 caps object sizes well under the 5 GB single-PUT limit, and the lifecycle rule sweeps aborted uploads), any KMS action (SSE-S3 needs none — one reason AD-8 chose it). No statement uses `Resource: "*"`.

### `SyncIdentityPoolRoleAttachment` — `AWS::Cognito::IdentityPoolRoleAttachment`

`IdentityPoolId: !Ref SyncIdentityPool`, `Roles: { authenticated: !GetAtt SyncAuthenticatedRole.Arn }`. No `unauthenticated` key (the pool forbids unauthenticated identities anyway) and **no `RoleMappings`** — a rules-based or token-based mapping is the documented way to widen which role a token can reach, so its absence is load-bearing and asserted by the verify script.

### Outputs

`BucketName`, `BucketArn`, `IdentityPoolId`, `AuthenticatedRoleArn`, `AuthenticatedRoleName`, `Region` (`!Ref AWS::Region`). No `Export`: nothing consumes them cross-stack and an export would pin the names forever.

## 2. Workflow — `.github/workflows/sync-infra.yml`

`name: Sync Infra`. Triggers: `pull_request` and `push: branches: [master]`, both with `paths: ["infra/sync/**", ".github/workflows/sync-infra.yml"]`, plus `workflow_dispatch`. Top level: `permissions: contents: read`; cancellable concurrency `sync-infra-${{ github.workflow }}-${{ github.ref }}` / `cancel-in-progress: true`. **No GitHub `environment`** anywhere. Workflow-level `env: AWS_REGION: us-east-1`, `STACK_NAME: nixus-sync`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID` (the two literals of §1, drift-guarded).

**Job `verify`** (every trigger, `ubuntu-latest`, timeout 10):
1. `actions/checkout@v4`; `actions/setup-python@v5` (3.12); `pip install "cfn-lint==1.57.*"` (the version used locally).
2. `cfn-lint infra/sync/template.yaml --regions us-east-1 --format parseable` — default rule set, no `--ignore-checks`, default `--non-zero-exit-code informational`, so any E/W/I finding fails the job and gets fixed rather than suppressed.
3. `python3 infra/sync/verify-template.py` — the offline property assertions of §6.
4. Guarded on `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository` (fork PRs have no secrets): `aws-actions/configure-aws-credentials@v4` with the repo secrets, then `aws cloudformation validate-template --template-body file://infra/sync/template.yaml` (read-only) and the Bedrock read-only baseline of §4. Nothing in `verify` mutates anything.

**Job `deploy`** (`needs: verify`, `if: github.ref == 'refs/heads/master' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')`, timeout 20, own concurrency group `sync-infra-deploy-nixus-sync` with `cancel-in-progress: false` — cancelling a deploy mid-flight strands the stack `*_IN_PROGRESS`):
1. checkout; `aws-actions/configure-aws-credentials@v4` (same major as `web-ci.yml`) with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `aws-region: us-east-1`.
2. `echo "aws_account=$(aws sts get-caller-identity --query Account --output text)"` — account id only; no key, ARN or user name is ever printed.
3. Pre-flight stack-state gate (§3) and the Bedrock "before" baseline (§4).
4. `aws cloudformation deploy --stack-name nixus-sync --template-file infra/sync/template.yaml --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --disable-rollback --region us-east-1 --parameter-overrides "UserPoolId=${COGNITO_USER_POOL_ID}" "AppClientId=${COGNITO_APP_CLIENT_ID}"`. Every step runs `set -euo pipefail`.
5. `describe-stacks` → print `StackStatus` and the full `Outputs` array; then the Bedrock "after" baseline.

The workflow creates/updates only `nixus-sync`; it never calls `delete-stack`, `delete-*`, `s3 rm`, or any Cognito/IAM mutation outside CloudFormation.

## 3. Decision O-3 — `--disable-rollback`

Recorded owner-orchestrator decision: the deploy uses `--disable-rollback`. A first `CREATE` that fails with rollback **enabled** lands in `ROLLBACK_COMPLETE`, which CloudFormation cannot update — the only exit is deleting the stack, and deleting stacks is forbidden by the standing rules, so the pipeline would be permanently wedged. With rollback **disabled** the stack stays `CREATE_FAILED` with successfully provisioned resources preserved, and AWS documents that a `CREATE_FAILED`/`UPDATE_FAILED` stack with preserved resources is repaired by a follow-up stack operation (the next `deploy`, also with `--disable-rollback`), which resumes from the last successful resource. Offline verification done on this machine: `aws cloudformation deploy help` (aws-cli/2.27.4) lists `[--disable-rollback | --no-disable-rollback]`; no AWS call was made.

Pre-flight gate (read-only `describe-stacks`, never a delete):

| Observed `StackStatus` | Action |
| --- | --- |
| absent (`DOES_NOT_EXIST`), `CREATE_COMPLETE`, `UPDATE_COMPLETE`, `UPDATE_ROLLBACK_COMPLETE`, `IMPORT_COMPLETE`, `REVIEW_IN_PROGRESS` | proceed |
| `CREATE_FAILED`, `UPDATE_FAILED` | print a notice ("repairable, resuming") and proceed |
| `ROLLBACK_COMPLETE`, `ROLLBACK_FAILED`, `UPDATE_ROLLBACK_FAILED`, `DELETE_FAILED`, `DELETE_COMPLETE`, any `*_IN_PROGRESS`, anything unrecognised | **fail** with the status, the reason it is terminal for this pipeline, and the explicit statement that this workflow will not delete a stack — a human decides |

Residual risk (recorded, not hidden): if `cloudformation deploy`'s change-set path should refuse a `CREATE_FAILED` stack, the gate still surfaces the exact status and the run fails loudly instead of thrashing; the repair is then an operator decision, logged as a blocker.

## 4. Read-only guard for `nixus-bedrock-api`

In `verify` (credentialed path only) and both immediately before and immediately after the deploy step:

```
aws cloudformation describe-stacks --stack-name nixus-bedrock-api \
  --query 'Stacks[0].[StackStatus,LastUpdatedTime]' --output text
```

Best effort: `|| echo "notice: cannot read nixus-bedrock-api (AccessDenied or absent); continuing"` and never fails the job. Purpose is a before/after baseline in the run log proving the Bedrock stack's status and `LastUpdatedTime` did not move while `nixus-sync` deployed. No other Bedrock action, read or write, appears anywhere.

## 5. Permission risks

The repository's static key has unknown permissions (it is today only proven able to `s3 sync`, `cloudfront create-invalidation`/`wait`). The first deploy needs, at minimum:

- CloudFormation: `CreateChangeSet`, `DescribeChangeSet`, `ExecuteChangeSet`, `DeleteChangeSet`, `DescribeStacks`, `DescribeStackEvents`, `GetTemplateSummary`, `ValidateTemplate`
- S3: `CreateBucket`, `PutBucketPublicAccessBlock`, `PutEncryptionConfiguration`, `PutBucketVersioning`, `PutLifecycleConfiguration`, `PutBucketOwnershipControls`, `PutBucketPolicy`, plus the read-backs CloudFormation does (`GetBucketPublicAccessBlock`, `GetEncryptionConfiguration`, `GetBucketVersioning`, `GetLifecycleConfiguration`, `GetBucketOwnershipControls`, `GetBucketPolicy`, `ListBucket`)
- Cognito Identity: `CreateIdentityPool`, `DescribeIdentityPool`, `UpdateIdentityPool`, `SetIdentityPoolRoles`, `GetIdentityPoolRoles` (`cognito-idp:DescribeUserPoolClient` may be required by `ServerSideTokenCheck` validation — treated as possible, not certain)
- IAM: `CreateRole`, `GetRole`, `PutRolePolicy`, `GetRolePolicy`, `UpdateAssumeRolePolicy`, and `PassRole` on `nixus-sync-authenticated` (required by `SetIdentityPoolRoles`)
- STS: `GetCallerIdentity`

Escalation rule: **never create or modify credentials, IAM users, access keys, OIDC providers or policies to make a deploy pass.** On `AccessDenied`, read the denied action out of the message, simplify the template where the property is genuinely optional (e.g. drop the read-back-only property, never a security property), and otherwise stop and record a blocker naming the exact action, the resource and the run URL. Security properties (PAB, TLS deny, versioning, lifecycle, `AllowClassicFlow: false`, the trust conditions, the prefix scoping) are never dropped to get green.

## 6. Verification plan (automated, on every PR)

`infra/sync/verify-template.py` (~130 lines, stdlib + `cfnlint.decode.cfn_yaml.load`, which is already installed by step 2 and understands `!Sub`/`!Ref`/`!GetAtt`). It parses the template and the workflow and asserts, failing with one line per violation:

1. Bucket: `SSEAlgorithm == AES256`; all four PAB flags `true`; `VersioningConfiguration.Status == Enabled`; `NoncurrentVersionExpirationInDays == 30`; `AbortIncompleteMultipartUpload.DaysAfterInitiation == 7`; `ObjectOwnership == BucketOwnerEnforced`; `DeletionPolicy == UpdateReplacePolicy == Retain`.
2. Bucket policy: a `Deny` on `s3:*` for `Principal: '*'` over both the bucket and `/*`, conditioned on `Bool aws:SecureTransport false`.
3. Identity pool: `AllowUnauthenticatedIdentities is False`, `AllowClassicFlow is False`, exactly one provider, `ServerSideTokenCheck is True`, `ProviderName` built from the `UserPoolId` parameter.
4. Role: `RoleName` resolves to the `nixus-sync-*` prefix; exactly one trust statement with the `cognito-identity.amazonaws.com` federated principal, `sts:AssumeRoleWithWebIdentity`, `StringEquals` on `:aud` referencing the pool resource, and `ForAnyValue:StringLike` on `:amr == authenticated`.
5. Permission policy: action set ⊆ `{s3:GetObject, s3:PutObject, s3:ListBucket}`; no `Resource` equal to or containing a bare `*`; every object-level resource contains `acct/${cognito-identity.amazonaws.com:sub}/`; the `ListBucket` statement targets the bucket ARN and carries the `s3:prefix` `StringLike` condition on the same `sub` prefix.
6. Role attachment: `Roles` keys == `{authenticated}` and no `RoleMappings` key.
7. Drift: `AppClientId` default == `COGNITO_CLIENT_ID` in `apps/desktop/src-tauri/src/commands/auth.rs`; the region used is `us-east-1` == `COGNITO_REGION`; `UserPoolId` default matches the pool-id format; the workflow's deploy command contains `--stack-name nixus-sync`, `--capabilities CAPABILITY_NAMED_IAM`, `--disable-rollback` and `--region us-east-1`; the workflow declares no `environment:`.

Local gates before commit: `cfn-lint` (same command), `python3 infra/sync/verify-template.py`, `uvx actionlint-py .github/workflows/sync-infra.yml` (plus a YAML parse as fallback). No AWS call is made locally, ever.

## 7. What Story 3 (cross-account isolation) will need

Already provided, no later template change expected: `AuthenticatedRoleArn` and `AuthenticatedRoleName` outputs (the simulation subject), `BucketName`/`BucketArn` (resource ARNs to simulate), `IdentityPoolId` (to mint two test identities). Flagged for Story 3: `simulate-principal-policy` cannot substitute `${cognito-identity.amazonaws.com:sub}`, so it will most likely need `simulate-custom-policy` over the rendered document (readable read-only via `iam:GetRolePolicy`) with the two identity ids substituted, plus `iam:SimulatePrincipalPolicy`/`SimulateCustomPolicy` permission. The create-only `acct/<identity-id>/owner` object is pure client behaviour (AD-7) and needs nothing from this template.

## 8. Merge/deploy flow and create-time failure modes

Merging to `master` auto-deploys (push trigger on `infra/sync/**`); the very first create is the riskiest moment, and `--disable-rollback` exists so it is repairable rather than terminal.

| Foreseen create-time failure | How the template/workflow avoids or survives it |
| --- | --- |
| Global bucket-name collision | Name is account-and-region scoped (`nixus-sync-<account>-us-east-1`); unguessable by a squatter and identical on every retry |
| Missing IAM/Cognito/S3 permissions on the static key | §5 enumerates the actions; `CREATE_FAILED` is preserved and resumable; `AccessDenied` is recorded as a blocker naming the action, never worked around with new credentials |
| Malformed trust policy | `:aud` is `!Ref SyncIdentityPool`, so the pool is ordered first and the value cannot be a stale literal; cfn-lint + `validate-template` + assertion 4 all run pre-merge |
| Invalid identity-pool provider | `ProviderName` is `!Sub`-composed from the region and a pattern-validated `UserPoolId`; `AppClientId` is pattern-validated and drift-guarded against `auth.rs` |
| Role-attachment race / IAM eventual consistency | `IdentityPoolRoleAttachment` depends on the role through `!GetAtt`, so CloudFormation orders and retries it |
| `CAPABILITY_NAMED_IAM` not granted to the change set | The flag is in the deploy command and assertion 7 pins it |
| Concurrent or cancelled deploy stranding the stack | Non-cancelling `cancel-in-progress: false` deploy group, plus the pre-flight gate that refuses any `*_IN_PROGRESS` state |

## Decisions

- Spine conflict (recorded, proceeding): **AD-17 says the sync workflow deploys "`master` only, `production` environment"**, but the standing rules (§3) and owner requirement 2 forbid a GitHub `environment` for this workflow. Chosen: no `environment`; `master`-only is enforced by the `push: branches: [master]` trigger plus the job-level `if`. Rationale: the rules file is the later, binding instruction, and the `production` environment carries the Bedrock OIDC deploy-role branch policy that this static-key path must not inherit.
- Minor spine inconsistency: the Structural Seed's deployment line says "region pending (Deferred)" while AD-17's body and SPEC Assumptions both say us-east-1. Chosen: us-east-1 everywhere.
- Plain CloudFormation, not SAM: no compute, so `Transform` and `sam build` add a toolchain dependency for nothing.
- Deterministic account-scoped bucket name over a CloudFormation-generated one: survives a `Retain`ed failed create and keeps the client's bucket name predictable.
- `s3:DeleteObject` intentionally not granted in Milestone 1: retention (AD-13) is Milestone 2 Story 23 and will add it under its own review.
- Unattended auto-decisions per rules §6: spec self-approved, all goals kept, subagents authorized, no HALT taken.
