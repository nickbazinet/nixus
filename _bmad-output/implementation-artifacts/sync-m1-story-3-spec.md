# Story 3 — Cross-account isolation gate + the owner object (implementation spec)

Serves CAP-9 / AD-19 (the cross-account denial test is a release gate). Binds AD-7 (prefix-scoped role, pinned identity, create-only `owner`) and AD-19. Subject: the live `nixus-sync-authenticated` role deployed by Story 2. No Rust (Stories 5/9 implement the client side from the contract below).

Deliverables: `infra/sync/isolation-simulate.py`, `infra/sync/owner-object-test.py`, `infra/sync/live-two-account-test.py`, a new `isolation` job in `.github/workflows/sync-infra.yml`, two assertions added to `infra/sync/verify-template.py`. No template change (Story 2's spec §7 predicted none).

## 1. Why simulation, and what each method proves

Two dedicated **Cognito** test accounts do not exist and must not be created (no new users, no change to the existing user pool or app client), so the denial claims are proven against the deployed role with **two synthetic identity ids** rather than two real logins. Every claim prints `PROVEN BY <method>` in the job log.

- **`iam:SimulatePrincipalPolicy`** on the deployed role ARN, with `cognito-identity.amazonaws.com:sub` (and `s3:prefix` for `ListBucket`) as context entries — proves what the role's identity policy allows per request. If the simulator does not substitute the `${cognito-identity.amazonaws.com:sub}` policy variable (the own-prefix baseline would come back denied), the script retries the whole matrix with **`iam:SimulateCustomPolicy`** over the document read back from `iam:GetRolePolicy`, substituting the identity id exactly as IAM would, and says so for every claim. Both engines evaluate the same live document; neither relaxes it.
- **Parsed `iam:GetRole` trust JSON** — proves the claims the simulator cannot express: only `cognito-identity.amazonaws.com` may assume the role, only `sts:AssumeRoleWithWebIdentity`, `:aud` equals the **live** identity pool id, and `:amr` must include `authenticated` (so an unauthenticated identity, whose `amr` carries `unauthenticated`, can never assume it).
- **Parsed `cognito-identity:DescribeIdentityPool`** — proves `AllowClassicFlow` is false (basic flow off, so a client cannot nominate its own role), `AllowUnauthenticatedIdentities` is false, and that exactly our user pool + app client are trusted providers (no second pool or client can mint credentials for this role).

## 2. Simulation matrix (A and B are two synthetic identity ids)

Caller context `sub = A`. Allowed: `GetObject acct/A/snap/LATEST`; `PutObject acct/A/log/<install>/1`; `ListBucket` with `s3:prefix=acct/A/`; `ListBucket` with `s3:prefix=acct/A/snap/LATEST` (the exact-key form the Story-4 403-probe sends). Denied: `GetObject`/`PutObject` on `acct/B/...`; `ListBucket` with `s3:prefix=acct/B/`; `ListBucket` with **no** `s3:prefix` (root listing) and with `s3:prefix=""`; `ListBucket` with `s3:prefix=acct/` (one level up); `GetObject` on a key outside `acct/` entirely; `GetObject`/`ListBucket` on `acct/<A-with-a-suffix>/...` (prefix-boundary confusion); `DeleteObject` on the caller's own key (not granted in Milestone 1). Any `allowed` where `denied` is expected fails the job, and vice versa.

## 3. The create-only owner object (contract for Stories 5/9)

- Key: `acct/<identity-id>/owner`, where `<identity-id>` is the id `GetId` returned for this login (`us-east-1:<uuid>`).
- Body: UTF-8 JSON, exactly `{"v":1,"sub":"<user-pool sub>","identity_id":"<identity-id>","created_ms":<unix ms>}`. `sub` is the `sub` claim of the user-pool ID token. No other field; readers ignore unknown fields but writers emit only these.
- Written **once**, with `If-None-Match: *`, alongside the AD-8 object metadata the adapter already sends. `200` ⇒ this device created the binding. `412 PreconditionFailed` ⇒ it already exists: the client GETs it and compares; same `sub` ⇒ normal operation, different `sub` ⇒ refuse to sync and report `error` (AD-7). A second write never overwrites — that is the property proven below.
- The object is never updated and never deleted in Milestone 1 (`s3:DeleteObject` is not granted).

`infra/sync/owner-object-test.py` proves the semantics with the workflow's own static credentials under the test-only prefix `ci-isolation-test/<run-id>/owner` (never `acct/<real-id>/`): first `put_object(IfNoneMatch="*")` must return `200`, the second must fail `412`, and a `get_object` must still return the first body byte-for-byte. If those credentials have no S3 access to the bucket, the script prints `SKIP` with the exact `AccessDenied` action and exits 0 — the matrix in §2 still proves `s3:PutObject` is granted on the own prefix only. Objects are left in place (nothing is deleted in AWS); the test prefix is run-id scoped and outside every `acct/` prefix.

## 4. Live two-account test (written, skipped)

`infra/sync/live-two-account-test.py`: real end-to-end proof — user-pool `InitiateAuth` for two test users, `GetId` + `GetCredentialsForIdentity` for each, then real S3 `Get`/`Put`/`List` within and across the two `acct/<identity-id>/` prefixes under a test-only key prefix. It reads `NIXUS_SYNC_TEST_{POOL_CLIENT_ID,USER_A_USERNAME,USER_A_PASSWORD,USER_B_USERNAME,USER_B_PASSWORD}`; with any of them missing it prints `SKIP` naming the missing variables and the reason (no Cognito test accounts exist and this story must not create users or touch the user pool / app client) and exits 0. The workflow runs it on every trigger so the skip reason is visible in the log, and it turns into a real gate the day those secrets are configured.

## 5. Workflow job

`isolation` — `needs: [verify, deploy]`, `if: always() && verify succeeded && (deploy succeeded || deploy skipped) && not a fork PR`. So it runs read-only on every PR against the already-deployed role (proving isolation **before** a merge) and again after each master deploy. Same static credentials, `aws-region: us-east-1`, no GitHub environment. Steps: the three scripts above, in that order. Needed permissions: `iam:SimulatePrincipalPolicy`, `iam:GetRole`, `iam:GetRolePolicy`, `cognito-identity:DescribeIdentityPool` (+ `iam:SimulateCustomPolicy` for the fallback) and, optionally, S3 on the test prefix. An `AccessDenied` on a simulation API is recorded as a blocker naming the action — never worked around with new credentials.

## Decisions

- Two synthetic identity ids instead of "two dedicated test accounts": creating Cognito users is forbidden here, and the role's isolation depends on the identity id in the request context, which simulation supplies faithfully. The real-login proof is written and skipped (§4).
- The role ARN/pool id are **discovered at run time** from the `nixus-sync` stack outputs, not hard-coded, so the gate cannot pass against a stale resource.
- Unattended auto-decisions per rules §6: spec self-approved, all goals kept, no HALT taken, one self-review pass.
