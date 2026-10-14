#!/usr/bin/env python3
"""Cross-account isolation gate (AD-7, AD-19 release gate).

Proves against the LIVE deployed resources that one Nixus account's vended
credentials cannot read, write or list another account's prefix. Read-only: it
calls only simulation and describe APIs, so it is safe on pull requests.

Two dedicated Cognito test accounts deliberately do not exist (this story must
not create users or touch the user pool), so the per-request claims are proven
with two synthetic identity ids against the real role document, and the claims a
simulator cannot express are proven on the parsed trust policy and identity-pool
settings. Every claim prints the method that proved it.
"""

from __future__ import annotations

import json
import sys
import urllib.parse

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
STACK = "nixus-sync"
SUB_VAR = "${cognito-identity.amazonaws.com:sub}"
IDENTITY_A = "us-east-1:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
IDENTITY_B = "us-east-1:bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"

ALLOWED = "allowed"

failures: list[str] = []
proofs: list[str] = []


def record(ok: bool, claim: str, method: str, detail: str = "") -> None:
    if ok:
        proofs.append(f"PASS  {claim}\n      PROVEN BY {method}")
    else:
        failures.append(f"{claim} [{method}] {detail}")
        proofs.append(f"FAIL  {claim}\n      PROVEN BY {method}: {detail}")


def stack_outputs() -> dict[str, str]:
    cfn = boto3.client("cloudformation", region_name=REGION)
    stack = cfn.describe_stacks(StackName=STACK)["Stacks"][0]
    return {o["OutputKey"]: o["OutputValue"] for o in stack.get("Outputs", [])}


def context_entries(sub: str, prefix: str | None) -> list[dict]:
    entries = [
        {
            "ContextKeyName": "cognito-identity.amazonaws.com:sub",
            "ContextKeyValues": [sub],
            "ContextKeyType": "string",
        },
        {
            "ContextKeyName": "aws:SecureTransport",
            "ContextKeyValues": ["true"],
            "ContextKeyType": "boolean",
        },
    ]
    if prefix is not None:
        entries.append(
            {
                "ContextKeyName": "s3:prefix",
                "ContextKeyValues": [prefix],
                "ContextKeyType": "string",
            }
        )
    return entries


def build_cases(bucket_arn: str) -> list[tuple[str, str, str, str | None, bool]]:
    """(claim, action, resource arn, s3:prefix or None, expect allowed)."""

    def obj(key: str) -> str:
        return f"{bucket_arn}/{key}"

    own = f"acct/{IDENTITY_A}"
    other = f"acct/{IDENTITY_B}"
    # An identity id that merely starts with A's: proves the trailing slash in the
    # policy resource is doing its job and prefixes cannot be confused.
    neighbour = f"acct/{IDENTITY_A}-extra"
    return [
        ("own prefix: GetObject allowed", "s3:GetObject", obj(f"{own}/snap/LATEST"), None, True),
        ("own prefix: PutObject allowed", "s3:PutObject", obj(f"{own}/log/install-1/1"), None, True),
        ("own prefix: ListBucket allowed", "s3:ListBucket", bucket_arn, f"{own}/", True),
        (
            "own prefix: ListBucket on an exact key allowed (the 403-vs-404 probe)",
            "s3:ListBucket",
            bucket_arn,
            f"{own}/snap/LATEST",
            True,
        ),
        ("other account: GetObject denied", "s3:GetObject", obj(f"{other}/snap/LATEST"), None, False),
        ("other account: PutObject denied", "s3:PutObject", obj(f"{other}/snap/x"), None, False),
        ("other account: ListBucket denied", "s3:ListBucket", bucket_arn, f"{other}/", False),
        ("root listing (no s3:prefix) denied", "s3:ListBucket", bucket_arn, None, False),
        ("root listing (empty s3:prefix) denied", "s3:ListBucket", bucket_arn, "", False),
        ("listing one level up (acct/) denied", "s3:ListBucket", bucket_arn, "acct/", False),
        ("key outside acct/ denied", "s3:GetObject", obj("ci-isolation-test/probe"), None, False),
        (
            "prefix-boundary confusion denied",
            "s3:GetObject",
            obj(f"{neighbour}/snap/LATEST"),
            None,
            False,
        ),
        (
            "prefix-boundary confusion denied for ListBucket",
            "s3:ListBucket",
            bucket_arn,
            f"{neighbour}/",
            False,
        ),
        # AD-13 retention (Story 23). The grant is deliberately narrower than the read/write one:
        # a client may reclaim its own log segments and superseded snapshots and NOTHING else, so
        # the four protocol pointers every other computer depends on stay undeletable.
        (
            "own prefix: DeleteObject on a log segment allowed (AD-13)",
            "s3:DeleteObject",
            obj(f"{own}/log/install-1/0000000000000001"),
            None,
            True,
        ),
        (
            "own prefix: DeleteObject on a snapshot allowed (AD-13)",
            "s3:DeleteObject",
            obj(f"{own}/snap/0123abcd"),
            None,
            True,
        ),
        (
            "own owner object: DeleteObject denied",
            "s3:DeleteObject",
            obj(f"{own}/owner"),
            None,
            False,
        ),
        (
            "own head pointer: DeleteObject denied",
            "s3:DeleteObject",
            obj(f"{own}/head/install-1"),
            None,
            False,
        ),
        (
            "own roster: DeleteObject denied",
            "s3:DeleteObject",
            obj(f"{own}/roster"),
            None,
            False,
        ),
        (
            "own blob: DeleteObject denied (orphan cleanup is deferred)",
            "s3:DeleteObject",
            obj(f"{own}/blob/aabbcc"),
            None,
            False,
        ),
        (
            "own snap/LATEST pointer: DeleteObject allowed only because it lives under snap/",
            "s3:DeleteObject",
            obj(f"{own}/snap/LATEST"),
            None,
            True,
        ),
        (
            "other account: DeleteObject on a log segment denied",
            "s3:DeleteObject",
            obj(f"{other}/log/install-1/0000000000000001"),
            None,
            False,
        ),
        (
            "other account: DeleteObject on a snapshot denied",
            "s3:DeleteObject",
            obj(f"{other}/snap/0123abcd"),
            None,
            False,
        ),
        (
            "prefix-boundary confusion denied for DeleteObject",
            "s3:DeleteObject",
            obj(f"{neighbour}/log/install-1/0000000000000001"),
            None,
            False,
        ),
    ]


def simulate_principal(iam, role_arn: str, action: str, resource: str, prefix: str | None) -> str:
    result = iam.simulate_principal_policy(
        PolicySourceArn=role_arn,
        ActionNames=[action],
        ResourceArns=[resource],
        ContextEntries=context_entries(IDENTITY_A, prefix),
    )
    return result["EvaluationResults"][0]["EvalDecision"]


def simulate_custom(iam, documents: list[str], action: str, resource: str, prefix: str | None) -> str:
    result = iam.simulate_custom_policy(
        PolicyInputList=documents,
        ActionNames=[action],
        ResourceArns=[resource],
        ContextEntries=context_entries(IDENTITY_A, prefix),
    )
    return result["EvaluationResults"][0]["EvalDecision"]


def rendered_documents(iam, role_name: str) -> list[str]:
    """The role's inline policies with the sub policy variable resolved to A."""
    documents = []
    for name in iam.list_role_policies(RoleName=role_name)["PolicyNames"]:
        document = iam.get_role_policy(RoleName=role_name, PolicyName=name)["PolicyDocument"]
        if isinstance(document, str):
            document = json.loads(urllib.parse.unquote(document))
        documents.append(json.dumps(document).replace(SUB_VAR, IDENTITY_A))
    return documents


def check_request_level(iam, outputs: dict[str, str]) -> None:
    role_arn = outputs["AuthenticatedRoleArn"]
    role_name = outputs["AuthenticatedRoleName"]
    cases = build_cases(outputs["BucketArn"])

    engine = "iam:SimulatePrincipalPolicy against the deployed role"
    documents: list[str] = []
    baseline = simulate_principal(iam, role_arn, *cases[0][1:4])
    if baseline != ALLOWED:
        # The simulator did not resolve ${cognito-identity.amazonaws.com:sub},
        # so the own-prefix baseline came back denied. Re-run the whole matrix
        # against the same live document with the variable resolved as IAM would.
        documents = rendered_documents(iam, role_name)
        engine = (
            "iam:SimulateCustomPolicy over the live iam:GetRolePolicy document with "
            "${cognito-identity.amazonaws.com:sub} resolved "
            "(SimulatePrincipalPolicy does not substitute the policy variable)"
        )
        print(f"note: own-prefix baseline was {baseline} under SimulatePrincipalPolicy; using {engine}")

    for claim, action, resource, prefix, expect_allowed in cases:
        if documents:
            decision = simulate_custom(iam, documents, action, resource, prefix)
        else:
            decision = simulate_principal(iam, role_arn, action, resource, prefix)
        ok = (decision == ALLOWED) if expect_allowed else (decision != ALLOWED)
        record(
            ok,
            claim,
            engine,
            f"{action} on {resource.split(':::')[-1]} prefix={prefix!r} -> {decision}",
        )


def check_trust_policy(iam, outputs: dict[str, str]) -> None:
    method = "parsed iam:GetRole trust policy (a simulator cannot evaluate a trust policy)"
    role = iam.get_role(RoleName=outputs["AuthenticatedRoleName"])["Role"]
    trust = role["AssumeRolePolicyDocument"]
    if isinstance(trust, str):
        trust = json.loads(urllib.parse.unquote(trust))
    statements = trust["Statement"]
    record(len(statements) == 1, "role trust has exactly one statement", method, json.dumps(trust))
    statement = statements[0]
    principal = statement.get("Principal", {})
    record(
        principal == {"Federated": "cognito-identity.amazonaws.com"},
        "only Cognito Identity may assume the role (no IAM user, no other federation)",
        method,
        json.dumps(principal),
    )
    actions = statement.get("Action")
    actions = actions if isinstance(actions, list) else [actions]
    record(
        actions == ["sts:AssumeRoleWithWebIdentity"],
        "the only assume action is sts:AssumeRoleWithWebIdentity",
        method,
        json.dumps(actions),
    )
    conditions = statement.get("Condition", {})
    aud = conditions.get("StringEquals", {}).get("cognito-identity.amazonaws.com:aud")
    record(
        aud == outputs["IdentityPoolId"],
        "trust pins :aud to the live identity pool, so another pool's token cannot assume it",
        method,
        f"aud={aud!r} pool={outputs['IdentityPoolId']!r}",
    )
    amr = conditions.get("ForAnyValue:StringLike", {}).get("cognito-identity.amazonaws.com:amr")
    amr_values = amr if isinstance(amr, list) else [amr]
    record(
        amr_values == ["authenticated"],
        "trust requires :amr to include authenticated, so an unauthenticated identity is denied",
        method,
        json.dumps(amr_values),
    )
    extra = set(conditions) - {"StringEquals", "ForAnyValue:StringLike"}
    record(not extra, "trust declares no other condition block", method, str(sorted(extra)))


def check_identity_pool(outputs: dict[str, str]) -> None:
    method = "parsed cognito-identity:DescribeIdentityPool (pool settings are not IAM policy)"
    cognito = boto3.client("cognito-identity", region_name=REGION)
    pool = cognito.describe_identity_pool(IdentityPoolId=outputs["IdentityPoolId"])
    record(
        pool.get("AllowClassicFlow") is False,
        "basic/classic flow is off, so a client cannot nominate the role itself",
        method,
        f"AllowClassicFlow={pool.get('AllowClassicFlow')!r}",
    )
    record(
        pool.get("AllowUnauthenticatedIdentities") is False,
        "the pool issues no unauthenticated identities",
        method,
        f"AllowUnauthenticatedIdentities={pool.get('AllowUnauthenticatedIdentities')!r}",
    )
    providers = pool.get("CognitoIdentityProviders", [])
    record(
        len(providers) == 1,
        "exactly one trusted provider, so no second user pool can mint credentials",
        method,
        json.dumps([p.get("ProviderName") for p in providers]),
    )
    if providers:
        record(
            providers[0].get("ProviderName", "").endswith("/us-east-1_7gfGQ0emg")
            and providers[0].get("ClientId") == "6525109r95las7odvuesf13joj",
            "the trusted provider is our user pool and our app client only",
            method,
            json.dumps({k: providers[0].get(k) for k in ("ProviderName", "ClientId")}),
        )
        record(
            providers[0].get("ServerSideTokenCheck") is True,
            "tokens are re-checked against the user pool on every credential vend",
            method,
            f"ServerSideTokenCheck={providers[0].get('ServerSideTokenCheck')!r}",
        )
    roles = cognito.get_identity_pool_roles(IdentityPoolId=outputs["IdentityPoolId"])
    record(
        set(roles.get("Roles", {})) == {"authenticated"},
        "only an authenticated role is attached to the pool",
        method,
        json.dumps(sorted(roles.get("Roles", {}))),
    )
    record(
        not roles.get("RoleMappings"),
        "no role mapping exists that could widen which role a token reaches",
        method,
        json.dumps(sorted(roles.get("RoleMappings", {}))),
    )


def main() -> int:
    outputs = stack_outputs()
    print(f"subject role: {outputs['AuthenticatedRoleArn']}")
    print(f"subject pool: {outputs['IdentityPoolId']}")
    print(f"bucket:       {outputs['BucketName']}")
    print(f"identity A:   {IDENTITY_A}")
    print(f"identity B:   {IDENTITY_B}\n")

    iam = boto3.client("iam", region_name=REGION)
    try:
        check_request_level(iam, outputs)
        check_trust_policy(iam, outputs)
        check_identity_pool(outputs)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        message = error.response.get("Error", {}).get("Message", "")
        print(f"isolation gate could not run: {code}: {message}")
        print(
            "The deploy credentials need iam:SimulatePrincipalPolicy, iam:GetRole, "
            "iam:GetRolePolicy, iam:ListRolePolicies, iam:SimulateCustomPolicy and "
            "cognito-identity:DescribeIdentityPool/GetIdentityPoolRoles. "
            "No credential or policy is created to work around this."
        )
        return 1

    print("\n".join(proofs))
    print(f"\n{len(proofs) - len(failures)}/{len(proofs)} isolation claims proven")
    if failures:
        print(f"isolation gate FAILED with {len(failures)} violation(s):")
        for failure in failures:
            print(f"  FAIL {failure}")
        return 1
    print("isolation gate PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
