#!/usr/bin/env python3
"""Offline security assertions for infra/sync/template.yaml and sync-infra.yml.

Every property asserted here is load-bearing for AD-6/7/8/17 account isolation:
each one, if silently dropped or widened in a future edit, would open another
account's data or weaken the bucket without breaking any deploy. cfn-lint checks
that the template is valid CloudFormation; this checks that it is the RIGHT
CloudFormation. It parses files and makes no network or AWS call.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml
from cfnlint.decode import cfn_yaml

REPO = Path(__file__).resolve().parents[2]
TEMPLATE = REPO / "infra" / "sync" / "template.yaml"
WORKFLOW = REPO / ".github" / "workflows" / "sync-infra.yml"
AUTH_RS = REPO / "apps" / "desktop" / "src-tauri" / "src" / "commands" / "auth.rs"

SUB_PREFIX = "acct/${cognito-identity.amazonaws.com:sub}/"
ALLOWED_ACTIONS = {"s3:GetObject", "s3:PutObject", "s3:ListBucket"}

failures: list[str] = []


def check(condition: object, message: str) -> None:
    if not condition:
        failures.append(message)


def as_list(value: object) -> list:
    return value if isinstance(value, list) else [value]


def unescape_sub(value: object) -> str:
    """Render a scalar or ``Fn::Sub`` resource to a comparable string."""
    if isinstance(value, dict):
        value = value.get("Fn::Sub", value.get("Fn::GetAtt", str(value)))
    if isinstance(value, list):
        value = "/".join(str(part) for part in value)
    return str(value).replace("${!", "${")


def load_template() -> dict:
    """cfn-lint's loader understands !Ref/!Sub/!GetAtt; its arity varies by version."""
    loaded = cfn_yaml.load(str(TEMPLATE))
    if isinstance(loaded, tuple):
        template, matches = loaded[0], loaded[1]
        if matches:
            raise SystemExit(f"template failed to decode: {matches}")
        return template
    return loaded


def main() -> int:
    template = load_template()
    resources = template["Resources"]
    params = template["Parameters"]

    # 1. Bucket
    bucket = resources["SyncBucket"]
    props = bucket["Properties"]
    check(bucket.get("DeletionPolicy") == "Retain", "SyncBucket DeletionPolicy must be Retain")
    check(
        bucket.get("UpdateReplacePolicy") == "Retain",
        "SyncBucket UpdateReplacePolicy must be Retain",
    )
    sse = props["BucketEncryption"]["ServerSideEncryptionConfiguration"][0]
    check(
        sse["ServerSideEncryptionByDefault"]["SSEAlgorithm"] == "AES256",
        "bucket default encryption must be SSE-S3 (AES256)",
    )
    pab = props["PublicAccessBlockConfiguration"]
    for flag in ("BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"):
        check(pab.get(flag) is True, f"PublicAccessBlockConfiguration.{flag} must be true")
    check(
        props["VersioningConfiguration"]["Status"] == "Enabled",
        "bucket versioning must be Enabled",
    )
    check(
        props["OwnershipControls"]["Rules"][0]["ObjectOwnership"] == "BucketOwnerEnforced",
        "bucket ObjectOwnership must be BucketOwnerEnforced (ACLs disabled)",
    )
    rules = {rule["Id"]: rule for rule in props["LifecycleConfiguration"]["Rules"]}
    check(
        rules.get("expire-noncurrent-objects", {}).get("NoncurrentVersionExpirationInDays") == 30,
        "noncurrent versions must expire after 30 days",
    )
    check(
        rules.get("abort-incomplete-uploads", {})
        .get("AbortIncompleteMultipartUpload", {})
        .get("DaysAfterInitiation")
        == 7,
        "incomplete multipart uploads must abort after 7 days",
    )
    for rule in rules.values():
        check(rule.get("Status") == "Enabled", f"lifecycle rule {rule.get('Id')} must be Enabled")

    # 2. Bucket policy: TLS-only
    statements = resources["SyncBucketPolicy"]["Properties"]["PolicyDocument"]["Statement"]
    deny = [s for s in statements if s.get("Effect") == "Deny"]
    check(len(deny) == 1, "bucket policy must hold exactly one Deny statement")
    if deny:
        tls = deny[0]
        check(tls.get("Principal") == "*", "TLS deny must apply to every principal")
        check("s3:*" in as_list(tls.get("Action")), "TLS deny must cover s3:*")
        check(
            tls.get("Condition", {}).get("Bool", {}).get("aws:SecureTransport") in (False, "false"),
            "TLS deny must be conditioned on aws:SecureTransport false",
        )
        targets = [unescape_sub(r) for r in as_list(tls.get("Resource"))]
        check(len(targets) == 2, "TLS deny must cover the bucket and its objects")
        check(
            any(t.endswith("/*") for t in targets),
            "TLS deny must cover object ARNs (bucket/*)",
        )

    # 3. Identity pool: enhanced flow only, our pool and client only
    pool = resources["SyncIdentityPool"]["Properties"]
    check(
        pool.get("AllowUnauthenticatedIdentities") is False,
        "identity pool must refuse unauthenticated identities",
    )
    check(pool.get("AllowClassicFlow") is False, "identity pool must disable the basic/classic flow")
    providers = pool["CognitoIdentityProviders"]
    check(len(providers) == 1, "identity pool must trust exactly one provider")
    provider = providers[0]
    check(
        provider.get("ServerSideTokenCheck") is True,
        "provider must enable ServerSideTokenCheck",
    )
    check(
        "${UserPoolId}" in unescape_sub(provider.get("ProviderName")),
        "ProviderName must be built from the UserPoolId parameter",
    )
    check(
        provider.get("ClientId") == {"Ref": "AppClientId"},
        "provider ClientId must reference the AppClientId parameter",
    )

    # 4. Role trust policy
    role = resources["SyncAuthenticatedRole"]["Properties"]
    check(
        unescape_sub(role["RoleName"]).startswith("${AWS::StackName}-"),
        "role name must be derived from the stack name (nixus-sync-*)",
    )
    trust = role["AssumeRolePolicyDocument"]["Statement"]
    check(len(trust) == 1, "role must have exactly one trust statement")
    trust_stmt = trust[0]
    check(trust_stmt.get("Effect") == "Allow", "trust statement must be an Allow")
    check(
        trust_stmt["Principal"].get("Federated") == "cognito-identity.amazonaws.com",
        "role must only be assumable by cognito-identity.amazonaws.com",
    )
    check(
        as_list(trust_stmt.get("Action")) == ["sts:AssumeRoleWithWebIdentity"],
        "trust action must be sts:AssumeRoleWithWebIdentity only",
    )
    conditions = trust_stmt["Condition"]
    aud = conditions.get("StringEquals", {}).get("cognito-identity.amazonaws.com:aud")
    check(
        aud == {"Ref": "SyncIdentityPool"},
        "trust must pin :aud to this stack's identity pool resource",
    )
    amr = conditions.get("ForAnyValue:StringLike", {}).get("cognito-identity.amazonaws.com:amr")
    check(amr == "authenticated", "trust must require :amr to include authenticated")

    # 5. Permission policy: own prefix only
    policies = role["Policies"]
    check(len(policies) == 1, "role must carry exactly one inline policy")
    perm_statements = policies[0]["PolicyDocument"]["Statement"]
    actions = {a for s in perm_statements for a in as_list(s.get("Action"))}
    check(
        actions <= ALLOWED_ACTIONS,
        f"role grants actions outside {sorted(ALLOWED_ACTIONS)}: {sorted(actions - ALLOWED_ACTIONS)}",
    )
    list_statements = []
    for stmt in perm_statements:
        check(stmt.get("Effect") == "Allow", "every inline statement must be an Allow")
        stmt_actions = set(as_list(stmt.get("Action")))
        resources_rendered = [unescape_sub(r) for r in as_list(stmt.get("Resource"))]
        for rendered in resources_rendered:
            check(rendered != "*", "no statement may use Resource '*'")
            check("*" not in rendered.split("/")[0], "no statement may wildcard the bucket ARN")
        if stmt_actions == {"s3:ListBucket"}:
            list_statements.append(stmt)
            prefix = stmt.get("Condition", {}).get("StringLike", {}).get("s3:prefix")
            check(
                prefix == SUB_PREFIX + "*",
                f"ListBucket must be conditioned on s3:prefix {SUB_PREFIX}*",
            )
            check(
                as_list(stmt.get("Resource")) == [{"Fn::GetAtt": ["SyncBucket", "Arn"]}],
                "ListBucket must target exactly the bucket ARN, never an object ARN",
            )
        else:
            for rendered in resources_rendered:
                check(
                    SUB_PREFIX in rendered,
                    f"object-level resource must be scoped to {SUB_PREFIX}: {rendered}",
                )
    check(len(list_statements) == 1, "exactly one ListBucket statement is expected")

    # 6. Role attachment: authenticated only, no role mappings
    attachment = resources["SyncIdentityPoolRoleAttachment"]["Properties"]
    check(
        set(attachment["Roles"].keys()) == {"authenticated"},
        "role attachment must map the authenticated role only",
    )
    check(
        "RoleMappings" not in attachment,
        "role attachment must declare no RoleMappings (they widen reachable roles)",
    )

    # 7. Drift between the template, the workflow and the desktop client
    workflow_text = WORKFLOW.read_text(encoding="utf-8")
    workflow = yaml.safe_load(workflow_text)
    auth_rs = AUTH_RS.read_text(encoding="utf-8")
    client_id = params["AppClientId"]["Default"]
    rust_client = re.search(r'COGNITO_CLIENT_ID: &str = "([^"]+)"', auth_rs)
    check(rust_client is not None, "COGNITO_CLIENT_ID not found in auth.rs")
    if rust_client:
        check(
            rust_client.group(1) == client_id,
            f"AppClientId default {client_id} drifted from auth.rs {rust_client.group(1)}",
        )
    rust_region = re.search(r'COGNITO_REGION: &str = "([^"]+)"', auth_rs)
    check(rust_region is not None, "COGNITO_REGION not found in auth.rs")
    if rust_region:
        check(
            rust_region.group(1) == "us-east-1",
            "the sync stack region must match auth.rs COGNITO_REGION",
        )
    check(
        re.fullmatch(r"[\w-]+_[0-9a-zA-Z]+", params["UserPoolId"]["Default"]) is not None,
        "UserPoolId default is not a Cognito pool id",
    )
    check(client_id in workflow_text, "workflow must pass the same app client id")
    check(
        params["UserPoolId"]["Default"] in workflow_text,
        "workflow must pass the same user pool id",
    )
    for literal in (
        "--stack-name nixus-sync",
        "--capabilities CAPABILITY_NAMED_IAM",
        "--disable-rollback",
        "--region us-east-1",
    ):
        check(literal in workflow_text, f"workflow deploy command must contain {literal}")
    check(
        not re.search(r"^\s*environment:", workflow_text, re.MULTILINE),
        "workflow must not use a GitHub environment",
    )
    check(
        not re.search(r"^\s*pull_request_target:", workflow_text, re.MULTILINE),
        "workflow must never trigger on pull_request_target",
    )
    jobs = workflow["jobs"]
    check(
        {"verify", "deploy", "isolation"} <= set(jobs),
        "workflow must define the verify, deploy and isolation jobs",
    )
    check(
        jobs["deploy"].get("needs") in ("verify", ["verify"]),
        "deploy must depend on verify",
    )
    # The AD-19 isolation gate has to run on pull requests as well, so a merge
    # cannot land without the cross-account denial having been proven.
    isolation = jobs.get("isolation", {})
    check(
        set(as_list(isolation.get("needs"))) == {"verify", "deploy"},
        "isolation must depend on both verify and deploy",
    )
    check(
        "always()" in str(isolation.get("if", ""))
        and "skipped" in str(isolation.get("if", "")),
        "isolation must still run when deploy is skipped (pull requests)",
    )
    for job_name, job in jobs.items():
        check(
            "environment" not in job,
            f"job {job_name} must not declare a GitHub environment",
        )

    if failures:
        print(f"verify-template: {len(failures)} violation(s)")
        for failure in failures:
            print(f"  FAIL {failure}")
        return 1
    print("verify-template: all assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
