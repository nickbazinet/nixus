#!/usr/bin/env python3
"""Attestation of the DEPLOYED sync infrastructure (the owner's final gate).

`infra/sync/verify-template.py` proves the TEMPLATE asks for the right bucket;
it cannot prove the bucket in the account actually has those properties (a
manual console change, a half-applied update or a drifted resource would pass it
unchanged). This script reads the LIVE resources and asserts each property, so
every claim in the gate is backed by a named API call rather than by source.

Claims, each printed with a `PROVEN BY <api call>` line:

  stack      nixus-sync is CREATE_COMPLETE/UPDATE_COMPLETE, and the bucket, pool
             and role resources are *_COMPLETE
  bucket     SSE-S3 (AES256) default encryption, all four block-public-access
             flags, a TLS-only Deny on aws:SecureTransport=false, versioning
             Enabled, noncurrent expiry 30 days, abort incomplete multipart
             7 days, BucketOwnerEnforced, DeletionPolicy Retain
  pool       enhanced flow only (AllowClassicFlow=false,
             AllowUnauthenticatedIdentities=false) and exactly our user pool and
             app client
  watchers   (AD-18) whole-bucket S3 request metrics, a request-volume alarm on
             those metrics that notifies the alert topic and carries no other
             action, an email subscription on that topic, and a monthly S3 COST
             budget alerting at 80% and 100% of ACTUAL spend
  bedrock    nixus-bedrock-api still carries its pre-sync baseline

STRICTLY READ-ONLY: describe/get APIs only. It creates nothing, modifies nothing
and deletes nothing, which is why it runs on pull requests too (against the
already-deployed stack) and again after every master deploy.

A property the static credentials cannot READ is printed as
`UNPROVEN: <iam action>` and does not exit non-zero: an AccessDenied is a named
gap in the evidence, never a pass. Only a property that is readable AND wrong
fails the job.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
STACK = "nixus-sync"
BUCKET_LOGICAL_ID = "SyncBucket"
USER_POOL_ID = "us-east-1_7gfGQ0emg"
APP_CLIENT_ID = "6525109r95las7odvuesf13joj"

# The nixus-bedrock-api baseline, captured BEFORE the first nixus-sync deploy in
# PR run https://github.com/nickbazinet/nixus/actions/runs/38462713334 and
# recorded in the `[story 2]` lines of
# _bmad-output/implementation-artifacts/sync-m1-progress.md. The sync stack must
# never touch that stack, so both values have to stay exactly these.
BEDROCK_STACK = "nixus-bedrock-api"
BEDROCK_BASELINE_STATUS = "UPDATE_COMPLETE"
BEDROCK_BASELINE_LAST_UPDATED = "2026-09-16T00:00:18.481000+00:00"

COMPLETE_STACK_STATES = ("CREATE_COMPLETE", "UPDATE_COMPLETE")
# AD-18. The filter id the bucket publishes request metrics under, which the
# alarm's FilterId dimension has to repeat; kept in step with
# infra/sync/template.yaml by infra/sync/verify-template.py.
METRICS_FILTER_ID = "EntireBucket"
REQUEST_METRICS = ("AllRequests", "GetRequests", "PutRequests")
PAB_FLAGS = ("BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets")
# Codes that mean "the credentials may not read this", as opposed to "the
# property is missing", which is a real failure.
DENIED_CODES = (
    "AccessDenied",
    "AccessDeniedException",
    # SNS spells a denial this way, and budgets/cloudwatch reads were never
    # granted to the static repository credentials at all (AD-18 story 26).
    "AuthorizationError",
    "InsufficientPrivilegesException",
    "AllAccessDisabled",
    "UnauthorizedOperation",
    "InvalidAccessKeyId",
    "NotAuthorized",
)


class Report:
    """One line per claim plus a verdict, so the job log is the evidence."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.failures: list[str] = []
        self.unproven: list[str] = []

    def proven(self, claim: str, api: str, detail: str = "") -> None:
        self.lines.append(f"PASS {claim}")
        print(f"PASS {claim}")
        print(f"     PROVEN BY {api}{f' -> {detail}' if detail else ''}")

    def failed(self, claim: str, api: str, detail: str) -> None:
        self.failures.append(f"{claim} [{api}] {detail}")
        self.lines.append(f"FAIL {claim} -- {detail}")
        print(f"FAIL {claim}")
        print(f"     NOT PROVEN BY {api} -> {detail}")

    def denied(self, claim: str, iam_action: str, code: str) -> None:
        self.unproven.append(iam_action)
        self.lines.append(f"UNPROVEN {claim} -- needs {iam_action}")
        print(f"UNPROVEN: {iam_action}")
        print(f"     claim not attested: {claim} (the read returned {code})")

    def assert_that(self, ok: object, claim: str, api: str, detail: str = "") -> bool:
        if ok:
            self.proven(claim, api, detail)
            return True
        self.failed(claim, api, detail or "assertion failed")
        return False

    def verdict(self) -> int:
        print("\n--- attestation of the deployed nixus-sync stack ---")
        for line in self.lines:
            print(line)
        proven = len(self.lines) - len(self.failures) - len(self.unproven)
        print(f"\n{proven}/{len(self.lines)} claims proven, {len(self.unproven)} unproven, {len(self.failures)} failed")
        if self.unproven:
            actions = ", ".join(sorted(set(self.unproven)))
            # Copy-paste source for the `[fix F-2]` ledger line: the owner has to
            # be able to see the exact permission gap, not just a smaller count.
            print(f"LEDGER: - [fix F-2] UNPROVEN claims need these IAM actions: {actions}")
        if self.failures:
            print("verdict: FAILED")
            for failure in self.failures:
                print(f"  FAIL {failure}")
            return 1
        print("verdict: PASSED (every UNPROVEN line above names the missing IAM action; nothing is assumed)")
        return 0


def error_code(error: ClientError) -> str:
    return str(error.response.get("Error", {}).get("Code") or "")


def read(report: Report, claim: str, iam_action: str, call, **kwargs):
    """Make one read-only call; `None` means the claim could not be attested.

    AccessDenied is reported through `Report.denied` (an explicit, named gap).
    Any other error is a real failure: a bucket that answers
    NoSuchLifecycleConfiguration has no lifecycle rules, which is the very thing
    this gate exists to catch.
    """
    try:
        return call(**kwargs)
    except ClientError as error:
        code = error_code(error)
        if code in DENIED_CODES:
            report.denied(claim, iam_action, code)
        else:
            report.failed(claim, iam_action, f"{code}: {error.response.get('Error', {}).get('Message', '')}")
        return None


# --------------------------------------------------------------------------- #
# Pure assertions over API response shapes (exercised locally against fake
# responses, with no AWS call, before this ever runs in CI).
# --------------------------------------------------------------------------- #


def check_stack(report: Report, stack: dict) -> None:
    api = "cloudformation describe-stacks"
    status = stack.get("StackStatus")
    report.assert_that(
        status in COMPLETE_STACK_STATES,
        f"stack {STACK} is deployed and complete",
        api,
        f"StackStatus={status}",
    )


def check_stack_resources(report: Report, resources: list[dict], bucket_name: str) -> None:
    api = "cloudformation describe-stack-resources"
    by_id = {r.get("LogicalResourceId"): r for r in resources}
    for logical in (BUCKET_LOGICAL_ID, "SyncBucketPolicy", "SyncIdentityPool", "SyncAuthenticatedRole"):
        resource = by_id.get(logical, {})
        report.assert_that(
            str(resource.get("ResourceStatus", "")).endswith("_COMPLETE"),
            f"resource {logical} is deployed and complete",
            api,
            f"{logical} ResourceStatus={resource.get('ResourceStatus')}",
        )
    physical = by_id.get(BUCKET_LOGICAL_ID, {}).get("PhysicalResourceId")
    report.assert_that(
        physical == bucket_name,
        "the attested bucket is the one this stack owns",
        api,
        f"{BUCKET_LOGICAL_ID} PhysicalResourceId={physical!r} output BucketName={bucket_name!r}",
    )


def check_deletion_policy(report: Report, template: dict) -> None:
    """The DeletionPolicy lives in the template CloudFormation actually holds."""
    api = "cloudformation get-template (the deployed template, not the repo file)"
    bucket = template.get("Resources", {}).get(BUCKET_LOGICAL_ID, {})
    report.assert_that(
        bucket.get("DeletionPolicy") == "Retain",
        "the deployed bucket carries DeletionPolicy Retain",
        api,
        f"DeletionPolicy={bucket.get('DeletionPolicy')!r}",
    )
    report.assert_that(
        bucket.get("UpdateReplacePolicy") == "Retain",
        "the deployed bucket carries UpdateReplacePolicy Retain",
        api,
        f"UpdateReplacePolicy={bucket.get('UpdateReplacePolicy')!r}",
    )


def check_encryption(report: Report, response: dict) -> None:
    api = "s3 get-bucket-encryption"
    rules = response.get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
    defaults = [r.get("ApplyServerSideEncryptionByDefault", {}) for r in rules]
    algorithms = [d.get("SSEAlgorithm") for d in defaults]
    report.assert_that(
        algorithms == ["AES256"],
        "the bucket applies SSE-S3 (AES256) default encryption",
        api,
        f"SSEAlgorithm={algorithms}",
    )


def check_public_access_block(report: Report, response: dict) -> None:
    api = "s3 get-public-access-block"
    config = response.get("PublicAccessBlockConfiguration", {})
    for flag in PAB_FLAGS:
        report.assert_that(
            config.get(flag) is True,
            f"block-public-access flag {flag} is on",
            api,
            f"{flag}={config.get(flag)!r}",
        )


def check_bucket_policy(report: Report, response: dict, bucket_arn: str) -> None:
    api = "s3 get-bucket-policy"
    try:
        document = json.loads(response.get("Policy") or "{}")
    except ValueError as error:
        report.failed("the bucket policy denies plaintext transport", api, f"unparseable policy: {error}")
        return
    statements = document.get("Statement", [])
    if isinstance(statements, dict):
        statements = [statements]

    def as_list(value: object) -> list:
        return value if isinstance(value, list) else [value]

    tls_denies = [
        s
        for s in statements
        if s.get("Effect") == "Deny"
        and str(s.get("Condition", {}).get("Bool", {}).get("aws:SecureTransport")).lower() == "false"
        and ("s3:*" in as_list(s.get("Action")) or "*" in as_list(s.get("Action")))
    ]
    if not report.assert_that(
        len(tls_denies) == 1,
        "the bucket policy denies every s3 action over plaintext HTTP",
        api,
        f"{len(tls_denies)} matching Deny statement(s) of {len(statements)}",
    ):
        return
    deny = tls_denies[0]
    principal = deny.get("Principal")
    report.assert_that(
        principal == "*" or principal == {"AWS": "*"},
        "that Deny applies to every principal",
        api,
        f"Principal={principal!r}",
    )
    targets = [str(r) for r in as_list(deny.get("Resource"))]
    report.assert_that(
        bucket_arn in targets and f"{bucket_arn}/*" in targets,
        "that Deny covers the bucket and every object in it",
        api,
        f"Resource={targets}",
    )


def check_versioning(report: Report, response: dict) -> None:
    report.assert_that(
        response.get("Status") == "Enabled",
        "bucket versioning is Enabled",
        "s3 get-bucket-versioning",
        f"Status={response.get('Status')!r}",
    )


def check_lifecycle(report: Report, response: dict) -> None:
    api = "s3 get-bucket-lifecycle-configuration"
    rules = [r for r in response.get("Rules", []) if r.get("Status") == "Enabled"]
    noncurrent = [
        r.get("NoncurrentVersionExpiration", {}).get("NoncurrentDays")
        for r in rules
        if "NoncurrentVersionExpiration" in r
    ]
    report.assert_that(
        noncurrent == [30],
        "noncurrent object versions expire after 30 days",
        api,
        f"enabled NoncurrentDays={noncurrent}",
    )
    aborts = [
        r.get("AbortIncompleteMultipartUpload", {}).get("DaysAfterInitiation")
        for r in rules
        if "AbortIncompleteMultipartUpload" in r
    ]
    report.assert_that(
        aborts == [7],
        "incomplete multipart uploads abort after 7 days",
        api,
        f"enabled DaysAfterInitiation={aborts}",
    )


def check_ownership(report: Report, response: dict) -> None:
    api = "s3 get-bucket-ownership-controls"
    owners = [r.get("ObjectOwnership") for r in response.get("OwnershipControls", {}).get("Rules", [])]
    report.assert_that(
        owners == ["BucketOwnerEnforced"],
        "ACLs are disabled (ObjectOwnership BucketOwnerEnforced)",
        api,
        f"ObjectOwnership={owners}",
    )


def check_metrics_configurations(report: Report, response: dict) -> None:
    api = "s3 list-bucket-metrics-configurations"
    configurations = response.get("MetricsConfigurationList", [])
    whole_bucket = [
        c
        for c in configurations
        if c.get("Id") == METRICS_FILTER_ID and not c.get("Filter")
    ]
    report.assert_that(
        len(whole_bucket) == 1,
        f"S3 request metrics are published for the whole bucket as {METRICS_FILTER_ID} (AD-18)",
        api,
        f"ids={[c.get('Id') for c in configurations]}",
    )


def check_request_alarm(report: Report, response: dict, topic_arn: str) -> None:
    api = "cloudwatch describe-alarms"
    alarms = response.get("MetricAlarms", [])
    report.assert_that(
        len(alarms) == 1,
        "the request-volume alarm exists (AD-18)",
        api,
        f"names={[a.get('AlarmName') for a in alarms]}",
    )
    for alarm in alarms:
        dimensions = {d["Name"]: d["Value"] for d in alarm.get("Dimensions", [])}
        report.assert_that(
            alarm.get("Namespace") == "AWS/S3"
            and alarm.get("MetricName") in REQUEST_METRICS
            and dimensions.get("FilterId") == METRICS_FILTER_ID,
            "the alarm watches this bucket's S3 request metrics",
            api,
            f"{alarm.get('Namespace')}/{alarm.get('MetricName')} dimensions={dimensions}",
        )
        report.assert_that(
            alarm.get("AlarmActions") == [topic_arn] if topic_arn else bool(alarm.get("AlarmActions")),
            "the alarm notifies the sync alert topic",
            api,
            f"actions={alarm.get('AlarmActions')}",
        )
        # An alert must not be a control loop: AD-18 says these notify and never
        # stop traffic, so a deployed OK/InsufficientData action would be a
        # capability nobody reviewed.
        report.assert_that(
            not alarm.get("OKActions") and not alarm.get("InsufficientDataActions"),
            "the alarm carries no action other than the notification",
            api,
            f"ok={alarm.get('OKActions')} insufficient={alarm.get('InsufficientDataActions')}",
        )


def check_topic_subscription(report: Report, response: dict) -> None:
    api = "sns list-subscriptions-by-topic"
    protocols = sorted({s.get("Protocol") for s in response.get("Subscriptions", [])})
    report.assert_that(
        protocols == ["email"],
        "the alert topic has exactly an email subscription (AD-18)",
        api,
        # The address itself is never printed: an operator address in a public
        # build log is an address a scraper can read.
        f"protocols={protocols}",
    )


def check_budget(report: Report, response: dict) -> None:
    api = "budgets describe-budget"
    budget = response.get("Budget", {})
    report.assert_that(
        budget.get("BudgetType") == "COST" and budget.get("TimeUnit") == "MONTHLY",
        "the sync cost budget is a monthly COST budget (AD-18)",
        api,
        f"{budget.get('BudgetType')}/{budget.get('TimeUnit')}",
    )


def check_budget_notifications(report: Report, response: dict) -> None:
    api = "budgets describe-notifications-for-budget"
    notifications = response.get("Notifications", [])
    # ThresholdType PERCENTAGE is the Budgets API default, and the API OMITS
    # the key from this response when it applies -- confirmed by run
    # 38652636866 (commit 840bdbd), where the already-deployed, correctly
    # configured budget (the separate `check_budget` claim above PROVED it)
    # failed this claim because every notification came back with no
    # ThresholdType key at all. Only an explicit ABSOLUTE_VALUE is rejected.
    thresholds = sorted(
        n.get("Threshold")
        for n in notifications
        if n.get("NotificationType") == "ACTUAL"
        and n.get("ComparisonOperator") == "GREATER_THAN"
        and n.get("ThresholdType", "PERCENTAGE") == "PERCENTAGE"
    )
    ok = 80 in thresholds and 100 in thresholds
    if not ok:
        # Raw fields only, for diagnosing a future failure -- never an account
        # id or a subscriber address, matching this script's no-address rule.
        for n in notifications:
            print(
                "     raw notification: "
                f"type={n.get('NotificationType')!r} "
                f"comparison={n.get('ComparisonOperator')!r} "
                f"threshold={n.get('Threshold')!r} "
                f"threshold_type={n.get('ThresholdType')!r}"
            )
    report.assert_that(
        ok,
        "the budget alerts at 80% and 100% of ACTUAL spend (AD-18)",
        api,
        f"actual thresholds={thresholds}",
    )


def check_identity_pool(report: Report, pool: dict) -> None:
    api = "cognito-identity describe-identity-pool"
    report.assert_that(
        pool.get("AllowClassicFlow") is False,
        "the identity pool runs the enhanced flow only (AllowClassicFlow false)",
        api,
        f"AllowClassicFlow={pool.get('AllowClassicFlow')!r}",
    )
    report.assert_that(
        pool.get("AllowUnauthenticatedIdentities") is False,
        "the identity pool issues no unauthenticated identities",
        api,
        f"AllowUnauthenticatedIdentities={pool.get('AllowUnauthenticatedIdentities')!r}",
    )
    providers = pool.get("CognitoIdentityProviders", [])
    names = [(p.get("ProviderName"), p.get("ClientId")) for p in providers]
    report.assert_that(
        names == [(f"cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}", APP_CLIENT_ID)],
        "the pool trusts exactly our user pool and our app client",
        api,
        f"CognitoIdentityProviders={names}",
    )


def check_bedrock_baseline(report: Report, stack: dict) -> None:
    api = f"cloudformation describe-stacks {BEDROCK_STACK}"
    status = stack.get("StackStatus")
    report.assert_that(
        status == BEDROCK_BASELINE_STATUS,
        f"{BEDROCK_STACK} StackStatus still matches its pre-sync baseline",
        api,
        f"StackStatus={status!r} baseline={BEDROCK_BASELINE_STATUS!r}",
    )
    last_updated = stack.get("LastUpdatedTime")
    actual = last_updated.isoformat() if isinstance(last_updated, datetime) else str(last_updated)
    baseline = datetime.fromisoformat(BEDROCK_BASELINE_LAST_UPDATED)
    same = last_updated == baseline if isinstance(last_updated, datetime) else actual == BEDROCK_BASELINE_LAST_UPDATED
    report.assert_that(
        same,
        f"{BEDROCK_STACK} LastUpdatedTime still matches its pre-sync baseline (the stack was never touched)",
        api,
        f"LastUpdatedTime={actual} baseline={BEDROCK_BASELINE_LAST_UPDATED}",
    )


# --------------------------------------------------------------------------- #
# Offline self-test: no AWS call, no network. `--self-test` runs this instead
# of `main()`. Fixtures freeze the real `describe_notifications_for_budget`
# shapes (confirmed against run 38652636866, commit 840bdbd) so the
# ThresholdType regression this script just had cannot silently return.
# --------------------------------------------------------------------------- #


def _selftest_budget_notifications() -> bool:
    ok = True
    cases: list[tuple[str, dict, bool]] = [
        (
            "real API shape: ThresholdType omitted (the Budgets API default)",
            {
                "Notifications": [
                    {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 80.0},
                    {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 100.0},
                ]
            },
            True,
        ),
        (
            "mutation: one notification is explicitly ABSOLUTE_VALUE",
            {
                "Notifications": [
                    {
                        "NotificationType": "ACTUAL",
                        "ComparisonOperator": "GREATER_THAN",
                        "Threshold": 80.0,
                        "ThresholdType": "ABSOLUTE_VALUE",
                    },
                    {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 100.0},
                ]
            },
            False,
        ),
        (
            "mutation: the 100% threshold is missing",
            {
                "Notifications": [
                    {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 80.0},
                ]
            },
            False,
        ),
    ]
    for name, response, expect_pass in cases:
        report = Report()
        check_budget_notifications(report, response)
        passed = not report.failures
        status = "ok" if passed == expect_pass else "FAIL"
        if status == "FAIL":
            ok = False
        print(f"SELFTEST {status}: {name} (expected {'PASS' if expect_pass else 'FAIL'}, got {'PASS' if passed else 'FAIL'})")
    return ok


def selftest() -> int:
    return 0 if _selftest_budget_notifications() else 1


# --------------------------------------------------------------------------- #
# Wiring
# --------------------------------------------------------------------------- #


def load_deployed_template(cfn) -> dict | None:
    """`get-template` answers a dict for a JSON template and text for a YAML one.

    The YAML text carries short-form intrinsics (`!Sub`, `!GetAtt`), so unknown
    tags are reduced to their scalar/sequence payload. Only DeletionPolicy and
    UpdateReplacePolicy are read out of it, and neither is ever a tagged value.
    """
    body = cfn.get_template(StackName=STACK, TemplateStage="Original")["TemplateBody"]
    if isinstance(body, dict):
        return body
    import yaml  # imported here so a missing PyYAML degrades to one UNPROVEN claim

    class Loader(yaml.SafeLoader):
        pass

    def keep_payload(loader: yaml.SafeLoader, tag_suffix: str, node: yaml.Node) -> object:
        del tag_suffix
        if isinstance(node, yaml.ScalarNode):
            return loader.construct_scalar(node)
        if isinstance(node, yaml.SequenceNode):
            return loader.construct_sequence(node)
        return loader.construct_mapping(node)

    Loader.add_multi_constructor("!", keep_payload)
    parsed = yaml.load(body, Loader=Loader)  # noqa: S506 - SafeLoader subclass
    return parsed if isinstance(parsed, dict) else None


def main() -> int:
    report = Report()
    cfn = boto3.client("cloudformation", region_name=REGION)
    s3 = boto3.client("s3", region_name=REGION)
    cognito = boto3.client("cognito-identity", region_name=REGION)

    described = read(
        report,
        f"stack {STACK} is deployed and complete",
        "cloudformation:DescribeStacks",
        cfn.describe_stacks,
        StackName=STACK,
    )
    if described is None:
        # Without the stack there is no bucket name and no pool id to attest.
        print("the nixus-sync stack could not be described; no deployed property can be attested")
        return report.verdict()
    stack = described["Stacks"][0]
    outputs = {o["OutputKey"]: o["OutputValue"] for o in stack.get("Outputs", [])}
    bucket = outputs.get("BucketName", "")
    bucket_arn = outputs.get("BucketArn", f"arn:aws:s3:::{bucket}")
    pool_id = outputs.get("IdentityPoolId", "")
    print(f"stack={STACK} bucket={bucket} pool={pool_id} region={REGION}\n")

    check_stack(report, stack)

    resources = read(
        report,
        "the stack's resources are deployed and complete",
        "cloudformation:DescribeStackResources",
        cfn.describe_stack_resources,
        StackName=STACK,
    )
    if resources is not None:
        check_stack_resources(report, resources.get("StackResources", []), bucket)

    try:
        template = load_deployed_template(cfn)
    except ClientError as error:
        code = error_code(error)
        if code in DENIED_CODES:
            report.denied("the deployed bucket carries DeletionPolicy Retain", "cloudformation:GetTemplate", code)
            template = None
        else:
            raise
    except ImportError:
        report.denied(
            "the deployed bucket carries DeletionPolicy Retain",
            "PyYAML (not an IAM action: the deployed template is YAML and cannot be parsed here)",
            "ImportError",
        )
        template = None
    if template is not None:
        check_deletion_policy(report, template)

    if bucket:
        bucket_reads = (
            ("the bucket applies SSE-S3 (AES256) default encryption", "s3:GetEncryptionConfiguration",
             s3.get_bucket_encryption, check_encryption, None),
            ("all four block-public-access flags are on", "s3:GetBucketPublicAccessBlock",
             s3.get_public_access_block, check_public_access_block, None),
            ("the bucket policy denies plaintext transport", "s3:GetBucketPolicy",
             s3.get_bucket_policy, check_bucket_policy, bucket_arn),
            ("bucket versioning is Enabled", "s3:GetBucketVersioning",
             s3.get_bucket_versioning, check_versioning, None),
            ("the bucket's lifecycle rules are in force", "s3:GetLifecycleConfiguration",
             s3.get_bucket_lifecycle_configuration, check_lifecycle, None),
            ("ACLs are disabled on the bucket", "s3:GetBucketOwnershipControls",
             s3.get_bucket_ownership_controls, check_ownership, None),
        )
        for claim, action, call, checker, extra in bucket_reads:
            response = read(report, claim, action, call, Bucket=bucket)
            if response is None:
                continue
            if extra is None:
                checker(report, response)
            else:
                checker(report, response, extra)
    else:
        report.failed(
            "the stack publishes the sync bucket name",
            "cloudformation describe-stacks",
            "output BucketName is absent",
        )

    if pool_id:
        pool = read(
            report,
            "the identity pool runs the enhanced flow only",
            "cognito-identity:DescribeIdentityPool",
            cognito.describe_identity_pool,
            IdentityPoolId=pool_id,
        )
        if pool is not None:
            check_identity_pool(report, pool)
    else:
        report.failed(
            "the stack publishes the identity pool id",
            "cloudformation describe-stacks",
            "output IdentityPoolId is absent",
        )

    # AD-18's watchers, each read-only. The static repository credentials were
    # never granted cloudwatch, sns or budgets reads, so an AccessDenied here is
    # expected and is reported as UNPROVEN with the exact action rather than as a
    # pass or a failure.
    if bucket:
        metrics = read(
            report,
            f"S3 request metrics are published for the whole bucket as {METRICS_FILTER_ID} (AD-18)",
            "s3:GetMetricsConfiguration",
            s3.list_bucket_metrics_configurations,
            Bucket=bucket,
        )
        if metrics is not None:
            check_metrics_configurations(report, metrics)

    topic_arn = outputs.get("AlertTopicArn", "")
    alarm_name = outputs.get("RequestVolumeAlarmName", "")
    budget_name = outputs.get("CostBudgetName", "")

    if alarm_name:
        alarms = read(
            report,
            "the request-volume alarm exists (AD-18)",
            "cloudwatch:DescribeAlarms",
            boto3.client("cloudwatch", region_name=REGION).describe_alarms,
            AlarmNames=[alarm_name],
        )
        if alarms is not None:
            check_request_alarm(report, alarms, topic_arn)

    if topic_arn:
        subscriptions = read(
            report,
            "the alert topic has exactly an email subscription (AD-18)",
            "sns:ListSubscriptionsByTopic",
            boto3.client("sns", region_name=REGION).list_subscriptions_by_topic,
            TopicArn=topic_arn,
        )
        if subscriptions is not None:
            check_topic_subscription(report, subscriptions)

    if budget_name:
        account = stack["StackId"].split(":")[4]
        budgets = boto3.client("budgets", region_name="us-east-1")
        described_budget = read(
            report,
            "the sync cost budget is a monthly COST budget (AD-18)",
            "budgets:ViewBudget",
            budgets.describe_budget,
            AccountId=account,
            BudgetName=budget_name,
        )
        if described_budget is not None:
            check_budget(report, described_budget)
        notifications = read(
            report,
            "the budget alerts at 80% and 100% of ACTUAL spend (AD-18)",
            "budgets:DescribeNotificationsForBudget",
            budgets.describe_notifications_for_budget,
            AccountId=account,
            BudgetName=budget_name,
        )
        if notifications is not None:
            check_budget_notifications(report, notifications)

    bedrock = read(
        report,
        f"{BEDROCK_STACK} is unchanged versus its pre-sync baseline",
        "cloudformation:DescribeStacks",
        cfn.describe_stacks,
        StackName=BEDROCK_STACK,
    )
    if bedrock is not None:
        check_bedrock_baseline(report, bedrock["Stacks"][0])

    return report.verdict()


if __name__ == "__main__":
    sys.exit(selftest() if "--self-test" in sys.argv[1:] else main())
