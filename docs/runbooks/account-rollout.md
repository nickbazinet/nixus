# Runbook — Nixus Cloud account (profile API) rollout

Owner: Nixus operator (single-operator service)
Stack: `nixus-account` · region `us-east-1` · one production stack, no staging (AD-14)

The profile API serves `GET/PUT https://api.nixusapp.com/v1/profile`,
`GET/PUT .../v1/profile/avatar` and `GET .../v1/profile/locations`. It is reached
through a domain **stack `nixus-bedrock-api` owns**, so the order of the steps
below is load-bearing: the domain and the Cognito scope must be right before the
first deploy, and the pipeline asserts both before it touches CloudFormation.

Every step is run by the owner from a workstation **except the deploy itself**,
which only `.github/workflows/account-ci.yml` may perform, federating via GitHub
OIDC. There is no long-lived AWS key for this service.

---

## 0. What the pipeline may and may not do

| | |
|---|---|
| Stack | `nixus-account` (`apps/api-account/template.yaml`, pinned in `samconfig.toml`) |
| Deploy identity | `nixus-account-github-deploy`, created by `infra/bootstrap/account-oidc-deploy.yaml` |
| Trusted subject | `repo:nickbazinet/nixus:environment:production`, audience `sts.amazonaws.com` |
| Artifact bucket | `nixus-sam-artifacts-<account>-<region>`, reused from the hosted-AI rollout, prefix `nixus-account` |
| Retained data | The profile table has PITR and `Retain` deletion/replace policies, and the deploy role is explicitly **denied** `dynamodb:DeleteTable` on it |
| Never touched | The Cognito user pool, its `nixus-api` resource server, and the `api.nixusapp.com` domain itself (the role is denied `PUT`/`PATCH`/`DELETE` on it) |

---

## 1. Confirm the shared domain still accepts API mappings

An `AWS::ApiGatewayV2::ApiMapping` is only honoured when the domain is in an
API-mapping routing mode. In `ROUTING_RULE_ONLY` the mapping is created and
silently never matches, so `/v1/profile` would answer with the Bedrock API's own
rejection instead.

```bash
aws apigatewayv2 get-domain-name \
  --domain-name api.nixusapp.com \
  --region us-east-1 \
  --query '{RoutingMode: RoutingMode, Mappings: DomainNameConfigurations[].SecurityPolicy}'
```

`RoutingMode` must be `API_MAPPING_ONLY` or `ROUTING_RULE_THEN_API_MAPPING`. The
deploy job re-asserts this every run, so this step is a pre-flight rather than the
guarantee.

While here, confirm the Bedrock catch-all mapping is the empty key, which is what
makes the longest-match win for `v1/profile`:

```bash
aws apigatewayv2 get-api-mappings \
  --domain-name api.nixusapp.com --region us-east-1 \
  --query 'Items[].{Key: ApiMappingKey, Api: ApiId, Stage: Stage}'
```

---

## 2. Add the `nixus-api/profile` scope — read, merge, then submit the FULL list

**`UpdateResourceServer` is a full replace, not a merge.** Submitting
`--scopes` with only `profile` **deletes `ai.invoke`** and takes hosted AI down for
every user, instantly and silently. The console merges for you; the CLI does not.

Read what is there now:

```bash
aws cognito-idp describe-resource-server \
  --user-pool-id us-east-1_7gfGQ0emg \
  --identifier nixus-api \
  --region us-east-1 \
  --query 'ResourceServer.{Name: Name, Scopes: Scopes}'
```

Then submit **every** scope, the existing ones included, with the name and
descriptions exactly as `describe-resource-server` returned them (the values
below are the ones applied on 2026-11-17 — `--name` is also replaced, so a
different value renames the resource server):

```bash
aws cognito-idp update-resource-server \
  --user-pool-id us-east-1_7gfGQ0emg \
  --identifier nixus-api \
  --name "Nixus API" \
  --region us-east-1 \
  --scopes \
    'ScopeName=ai.invoke,ScopeDescription=Invoke Nixus hosted AI' \
    'ScopeName=profile,ScopeDescription=Read and edit the Nixus Cloud profile'
```

Confirm both survived:

```bash
aws cognito-idp describe-resource-server \
  --user-pool-id us-east-1_7gfGQ0emg --identifier nixus-api --region us-east-1 \
  --query 'ResourceServer.Scopes[].ScopeName'
```

The output must contain **both** `ai.invoke` and `profile`. The deploy job asserts
exactly this and refuses to deploy otherwise, which also makes an accidental wipe
visible on the next run rather than through a user report.

The desktop app also needs `nixus-api/profile` in the app client's allowed scopes
(Epic C adds it to `COGNITO_SCOPES`); a session issued before that lacks the scope
and the Profile page shows a re-sign-in state.

---

## 3. Apply the bootstrap stack

Plain CloudFormation, applied by hand, once. `CAPABILITY_NAMED_IAM` is required
because the role carries a fixed name the workflow's secret refers to.

```bash
aws cloudformation deploy \
  --template-file infra/bootstrap/account-oidc-deploy.yaml \
  --stack-name nixus-account-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides "HostedZoneId=<nixusapp.com zone id>"
```

`HostedZoneId` is the only required input; it is account-specific, so it is not
committed. Everything else defaults: `GitHubOrg=nickbazinet`, `GitHubRepo=nixus`,
`GitHubEnvironment=production`, `ApplicationStackName=nixus-account`,
`ApiDomainName=api.nixusapp.com`, `AccountDomainName=account.nixusapp.com`,
`CognitoUserPoolId=us-east-1_7gfGQ0emg`.

It does **not** create the GitHub OIDC provider: the account already holds one for
`token.actions.githubusercontent.com`, created and retained by the hosted-AI
bootstrap, and an account may hold only one per issuer URL.

Read the outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name nixus-account-github-oidc --region us-east-1 \
  --query 'Stacks[0].Outputs[].{Key: OutputKey, Value: OutputValue}' --output table
```

---

## 4. Wire the `production` environment

The `production` environment already exists from the hosted-AI rollout, with
required reviewers and the default branch as its only deployment branch. Add this
service's secret to it:

```bash
role_arn="$(aws cloudformation describe-stacks \
  --stack-name nixus-account-github-oidc --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text)"

gh secret set AWS_ACCOUNT_DEPLOY_ROLE_ARN --env production --body "${role_arn}"
```

| Name | Kind | Value | Status |
|---|---|---|---|
| `AWS_ACCOUNT_DEPLOY_ROLE_ARN` | environment secret | `DeployRoleArn` output | **new** |
| `COGNITO_USER_POOL_ARN` | environment secret | pool ARN | reused |
| `COGNITO_USER_POOL_ID` | environment secret | `us-east-1_7gfGQ0emg` | reused |
| `ALERT_EMAIL` | environment secret | alarm + budget subscriber | reused |
| `API_DOMAIN_NAME` | environment variable | `api.nixusapp.com` | reused |
| `SAM_ARTIFACT_BUCKET` | environment variable | `nixus-sam-artifacts-<account>-<region>` | reused |

The five reused entries are the same ones `api-bedrock-ci.yml` reads; this service
adds no second copy of any of them.

Then switch deployment on. `ACCOUNT_DEPLOY_ENABLED` is read in the deploy job's
`if`, which is evaluated before the environment resolves, so it must be a
**repository** variable — exactly as `API_BEDROCK_DEPLOY_ENABLED` is:

```bash
gh variable set ACCOUNT_DEPLOY_ENABLED --body true
```

Until it is set the deploy job is skipped entirely, so merging deploy-capable
source cannot deploy anything.

---

## 5. Deploy

```bash
gh workflow run account-ci.yml --ref master
```

The job refuses to proceed unless, in this order: the domain's routing mode
honours API mappings, the `nixus-api` resource server holds **both** scopes, and
`nixus-bedrock-api` exists in a steady state. After `sam deploy` it asserts that
the profile table still has PITR enabled, that the domain's empty-key mapping
still points at the Bedrock API id while `v1/profile` points at this stack's API,
that `GET /v1/ai/status` still answers `401` with the hosted-AI envelope, and that
`GET /v1/profile` answers `401` with the account envelope.

---

## 6. Verify by hand

```bash
# Unauthenticated: the authorizer rejects with the account envelope.
curl -s -o /dev/stdout -w '\n%{http_code}\n' https://api.nixusapp.com/v1/profile

# Hosted AI is unaffected by the new mapping.
curl -s -o /dev/stdout -w '\n%{http_code}\n' https://api.nixusapp.com/v1/ai/status
```

Both must answer `401` with `{"error":{"code":"unauthorized",...}}`. A `403` with
no `code` means the request reached API Gateway's default response rather than the
stack's `GatewayResponses`, and a `404` means the mapping is not matching.

An authenticated check needs an access token carrying `nixus-api/profile`; a token
with only `ai.invoke` must be refused by every profile route, which is the scope
gate in the other direction.

---

## 7. If something goes wrong

- **Hosted AI breaks after a deploy.** The only shared resource is the domain.
  Delete this stack's mapping to restore Bedrock-only routing; the Bedrock stack
  and its own mapping are never modified by this pipeline.

  ```bash
  aws apigatewayv2 get-api-mappings --domain-name api.nixusapp.com --region us-east-1
  aws apigatewayv2 delete-api-mapping \
    --domain-name api.nixusapp.com --api-mapping-id <id> --region us-east-1
  ```

- **The first CREATE failed.** A stack whose first create fails lands in
  `ROLLBACK_COMPLETE`, which CloudFormation cannot update: delete it and deploy
  again. That is safe for that state alone, because such a stack has no
  successfully created resources — and the profile table, if it was created,
  is retained by policy.

- **Profile data.** Never delete the table. `DeletionPolicy: Retain`,
  `UpdateReplacePolicy: Retain`, PITR and an explicit IAM `Deny` on
  `dynamodb:DeleteTable` are four independent guards; removing any one of them is
  a reviewed change, not a workaround.

- **The scope list was wiped.** Re-run §2 with the full list. Hosted AI recovers as
  soon as the resource server carries `ai.invoke` again; already-issued tokens are
  unaffected, because a user-pool authorizer validates signature, expiry and
  scopes locally.

---

## 8. Whenever the bootstrap template changes

Ordering is load-bearing, and the CI triggers are deliberately asymmetric to
enforce it: `infra/bootstrap/account-oidc-deploy.yaml` is a `pull_request` path
trigger (so it is `cfn-lint`ed and its contract tests run) but **not** a `push`
one, so merging a permission change never deploys the application against a role
that does not hold the new grant yet.

1. Merge the bootstrap change.
2. Re-apply §3. The role keeps its name, so no secret changes.
3. Deploy the application with §5.

---

## 9. Already granted for Epic F (the account app)

The bootstrap is applied **once**. It already covers what
`account.nixusapp.com` will need, so adding the account app to the same
`nixus-account` stack needs no new IAM work: a confidential Cognito user-pool
client and its managed-login branding on the existing pool, Lambda Web Functions
under `web-function/nixus-account-*`, CloudFront distributions with their origin
access control and cache / origin-request policies, an S3 bucket named
`nixus-account-*`, `ssm:GetParameter` under `/nixus-account/*`, ACM reads, and the
`account.nixusapp.com` DNS record in the supplied hosted zone.

Two things the owner still does by hand, because the pipeline deliberately cannot:

```bash
# The web client secret. The pipeline may READ this path and never write it.
aws ssm put-parameter \
  --name /nixus-account/web-client-secret \
  --type SecureString \
  --value '<client secret>' \
  --region us-east-1
```

- The account app's Lambda Web Function endpoint resource policy is not a
  CloudFormation resource; it is applied after the deploy with
  `lambda:PutResourcePolicy`, which the role holds.

The web-function IAM **action names** in the bootstrap were checked against the
Service Authorization Reference for AWS Lambda on 2026-11-17. An IAM action that
does not exist is silently inert in a policy, so re-check them whenever the list
changes — a missing one surfaces as an `AccessDenied` on a deploy, not on this
bootstrap.
