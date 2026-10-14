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
ATTEST = REPO / "infra" / "sync" / "attest-deployed.py"
AUTH_RS = REPO / "apps" / "desktop" / "src-tauri" / "src" / "commands" / "auth.rs"

SUB_PREFIX = "acct/${cognito-identity.amazonaws.com:sub}/"
ALLOWED_ACTIONS = {"s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"}
# AD-13: the ONLY two prefixes a client may ever delete from. `owner`, `head/*`,
# `roster` and `blob/*` must stay unreachable by DeleteObject, so the grant is
# asserted as an exact set rather than as "scoped to the sub prefix".
BUCKET_ARN = "${SyncBucket.Arn}/"
DELETABLE_PREFIXES = {
    BUCKET_ARN + SUB_PREFIX + "log/*",
    BUCKET_ARN + SUB_PREFIX + "snap/*",
}
# AD-18: the bucket's request-metrics filter id, which the alarm's FilterId
# dimension has to repeat exactly — S3 publishes request metrics per filter, so a
# mismatch leaves the alarm watching a series that is never written.
METRICS_FILTER_ID = "EntireBucket"
REQUEST_METRICS = {"AllRequests", "GetRequests", "PutRequests"}

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
    delete_statements = []
    for stmt in perm_statements:
        check(stmt.get("Effect") == "Allow", "every inline statement must be an Allow")
        stmt_actions = set(as_list(stmt.get("Action")))
        resources_rendered = [unescape_sub(r) for r in as_list(stmt.get("Resource"))]
        for rendered in resources_rendered:
            check(rendered != "*", "no statement may use Resource '*'")
            check("*" not in rendered.split("/")[0], "no statement may wildcard the bucket ARN")
        if "s3:DeleteObject" in stmt_actions:
            delete_statements.append(stmt)
            check(
                stmt_actions == {"s3:DeleteObject"},
                "DeleteObject must be its own statement, so widening it cannot widen a read grant: "
                f"{sorted(stmt_actions)}",
            )
            rendered_set = set(resources_rendered)
            check(
                rendered_set == DELETABLE_PREFIXES,
                "DeleteObject must be granted on exactly the own log/ and snap/ prefixes "
                f"({sorted(DELETABLE_PREFIXES)}), never wider: {sorted(rendered_set)}",
            )
            continue
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
    check(
        len(delete_statements) == 1,
        "exactly one DeleteObject statement is expected (AD-13)",
    )
    # The read/write grant must NOT carry DeleteObject, however the statements are arranged: that
    # grant covers acct/<id>/* and would make owner, head/*, roster and blob/* deletable.
    for stmt in perm_statements:
        stmt_actions = set(as_list(stmt.get("Action")))
        if stmt_actions == {"s3:DeleteObject"}:
            continue
        check(
            "s3:DeleteObject" not in stmt_actions,
            f"DeleteObject may not ride along with {sorted(stmt_actions - {'s3:DeleteObject'})}",
        )

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

    # 6b. AD-18 cost and abuse watching. Each of these would, if dropped, leave the
    # product with no signal that a client is burning requests or money — and
    # unlike the isolation properties above, nothing else in the pipeline notices.
    metrics = props.get("MetricsConfigurations")
    check(metrics, "the bucket must enable S3 request metrics (AD-18)")
    if metrics:
        whole_bucket = [m for m in metrics if "Prefix" not in m and "TagFilters" not in m]
        check(
            len(whole_bucket) >= 1,
            "one metrics configuration must cover the WHOLE bucket, with no prefix filter",
        )
        check(
            {m.get("Id") for m in metrics} == {METRICS_FILTER_ID},
            f"the metrics filter must be {METRICS_FILTER_ID}, the id the alarm's FilterId names",
        )

    topic_subscriptions = [
        r
        for r in resources.values()
        if r.get("Type") == "AWS::SNS::Subscription"
        and r["Properties"].get("TopicArn") == {"Ref": "SyncAlertTopic"}
    ]
    check(
        resources.get("SyncAlertTopic", {}).get("Type") == "AWS::SNS::Topic",
        "the alert topic must exist (AD-18)",
    )
    check(
        len(topic_subscriptions) == 1,
        "the alert topic must carry exactly one subscription",
    )
    for subscription in topic_subscriptions:
        check(
            subscription["Properties"].get("Protocol") == "email",
            "the alert subscription must be email, like the api-bedrock pattern",
        )
        check(
            subscription["Properties"].get("Endpoint") == {"Ref": "AlertEmail"},
            "the alert subscription must take the address from the AlertEmail parameter, "
            "never a committed literal",
        )
    check(
        "Default" not in params["AlertEmail"],
        "AlertEmail must have no default: the address comes from the ALERT_EMAIL secret",
    )
    check(
        "@" in str(params["AlertEmail"].get("AllowedPattern", "")),
        "AlertEmail must be pattern-checked as an address",
    )

    alarms = {
        name: r for name, r in resources.items() if r.get("Type") == "AWS::CloudWatch::Alarm"
    }
    check(alarms, "a request-volume alarm must exist (AD-18)")
    for name, alarm in alarms.items():
        alarm_props = alarm["Properties"]
        check(
            alarm_props.get("Namespace") == "AWS/S3",
            f"{name} must watch the AWS/S3 namespace",
        )
        check(
            alarm_props.get("MetricName") in REQUEST_METRICS,
            f"{name} must watch request volume, one of {sorted(REQUEST_METRICS)}: "
            f"{alarm_props.get('MetricName')}",
        )
        dimensions = {d["Name"]: d["Value"] for d in alarm_props.get("Dimensions", [])}
        check(
            dimensions.get("BucketName") == {"Ref": "SyncBucket"},
            f"{name} must be dimensioned on this stack's bucket",
        )
        check(
            dimensions.get("FilterId") == METRICS_FILTER_ID,
            f"{name} must name the bucket's metrics filter, or it watches a series that does "
            "not exist",
        )
        check(
            alarm_props.get("AlarmActions") == [{"Ref": "SyncAlertTopic"}],
            f"{name} must notify the alert topic and nothing else",
        )
        check(
            int(alarm_props.get("EvaluationPeriods", 0)) >= 1
            and int(alarm_props.get("Period", 0)) >= 300,
            f"{name} must evaluate at least one period of at least 5 minutes",
        )
        check(
            alarm_props.get("Threshold") == {"Ref": "RequestVolumeAlarmThreshold"},
            f"{name} must take its threshold from the parameter, so it is reviewable",
        )

    budgets = {name: r for name, r in resources.items() if r.get("Type") == "AWS::Budgets::Budget"}
    check(len(budgets) == 1, "exactly one AWS Budget is expected (AD-18)")
    for name, budget in budgets.items():
        spec = budget["Properties"]["Budget"]
        check(spec.get("BudgetType") == "COST", f"{name} must be a COST budget")
        check(spec.get("TimeUnit") == "MONTHLY", f"{name} must be monthly")
        check(
            spec["BudgetLimit"].get("Unit") == "USD"
            and spec["BudgetLimit"].get("Amount") == {"Ref": "MonthlyCostBudget"},
            f"{name} must take its amount from the MonthlyCostBudget parameter, in USD",
        )
        check(
            spec.get("CostFilters", {}).get("Service") == ["Amazon Simple Storage Service"],
            f"{name} must be scoped to S3 (AD-18)",
        )
        notifications = budget["Properties"]["NotificationsWithSubscribers"]
        thresholds = {
            (
                entry["Notification"]["Threshold"],
                entry["Notification"]["NotificationType"],
                entry["Notification"]["ThresholdType"],
            )
            for entry in notifications
        }
        # AD-18 names both alerts. 100% alone would only ever say "too late", and
        # 80% alone would never say "it kept going".
        for level in (80, 100):
            check(
                (level, "ACTUAL", "PERCENTAGE") in thresholds,
                f"{name} must alert at {level}% of ACTUAL spend: {sorted(thresholds)}",
            )
        for entry in notifications:
            subscribers = entry["Subscribers"]
            check(
                all(s.get("SubscriptionType") == "EMAIL" for s in subscribers),
                f"{name} notifications must reach the operator by email",
            )
            check(
                all(s.get("Address") == {"Ref": "AlertEmail"} for s in subscribers),
                f"{name} notifications must use the AlertEmail parameter",
            )

    # Alerts notify; they never stop traffic. Nothing in this stack may deny a
    # request on volume or on spend, so the only Deny stays the TLS one asserted
    # above and no alarm may carry an action that is not the topic.
    for name, alarm in alarms.items():
        for field in ("OKActions", "InsufficientDataActions"):
            check(
                not alarm["Properties"].get(field),
                f"{name} must declare no {field}: an alert is mail, not a control loop",
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
    # The attestation asserts the LIVE pool trusts exactly these two ids, so a
    # drifted copy there would attest the wrong provider and still pass.
    attest_text = ATTEST.read_text(encoding="utf-8")
    check(
        f'APP_CLIENT_ID = "{client_id}"' in attest_text,
        "attest-deployed.py APP_CLIENT_ID drifted from the template default",
    )
    check(
        f'USER_POOL_ID = "{params["UserPoolId"]["Default"]}"' in attest_text,
        "attest-deployed.py USER_POOL_ID drifted from the template default",
    )
    for literal in (
        "--stack-name nixus-sync",
        "--capabilities CAPABILITY_NAMED_IAM",
        "--disable-rollback",
        "--region us-east-1",
        # AD-18's address has no default, so a deploy that stopped passing it would
        # fail on the parameter instead of quietly alerting nobody.
        '"AlertEmail=${alert_email}"',
        "ParameterKey=AlertEmail,ParameterValue=${alert_email}",
        "secrets.ALERT_EMAIL",
        "::add-mask::",
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
        {"verify", "deploy", "isolation", "attest"} <= set(jobs),
        "workflow must define the verify, deploy, isolation and attest jobs",
    )
    check(
        jobs["deploy"].get("needs") in ("verify", ["verify"]),
        "deploy must depend on verify",
    )
    # The AD-19 isolation gate and the deployed-state attestation both have to
    # run on pull requests as well, so a merge cannot land without the
    # cross-account denial and the live bucket properties having been proven.
    for gate in ("isolation", "attest"):
        job = jobs.get(gate, {})
        check(
            set(as_list(job.get("needs"))) == {"verify", "deploy"},
            f"{gate} must depend on both verify and deploy",
        )
        check(
            "always()" in str(job.get("if", "")) and "skipped" in str(job.get("if", "")),
            f"{gate} must still run when deploy is skipped (pull requests)",
        )
        check(
            "head.repo.full_name == github.repository" in str(job.get("if", "")),
            f"{gate} must be skipped on fork pull requests, which carry no credentials",
        )
    attest_steps = [str(step.get("run", "")) for step in jobs.get("attest", {}).get("steps", [])]
    check(
        any("infra/sync/attest-deployed.py" in run for run in attest_steps),
        "attest must run infra/sync/attest-deployed.py",
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
