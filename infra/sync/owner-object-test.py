#!/usr/bin/env python3
"""Proves, on the REAL versioned bucket, the conditional primitives the Rust
`ObjectStore` adapter is built on.

Two claim groups:

1. The AD-7 owner object is create-only.

       key   acct/<identity-id>/owner
       body  {"v":1,"sub":"<user-pool sub>","identity_id":"<identity-id>",
              "created_ms":<unix ms>}
       write once, with If-None-Match: *

   A first write returns 200 and binds that identity id to that user-pool sub. A
   second write MUST fail 412 PreconditionFailed, so the binding can never be
   silently replaced by another device or another account.

2. The AD-6 compare-and-swap primitives `snap/LATEST` depends on. Every move of a
   mutable pointer is one of these, and until now they were only proven against
   the in-process fake (`sync/test_support.rs`), because no S3-compatible server
   could be started in CI:

       If-Match <current etag>   PUT -> 200, the pointer moves
       If-Match <superseded tag> PUT -> 412, the pointer never moves
       If-Match <any etag>       PUT -> 404/412 on a key that does not exist
       If-None-Match <etag>      GET -> 304, so a poll that finds no change
                                        pays for no body

This runs with the workflow's own static credentials, under a test-only prefix
(ci-isolation-test/<run id>-<attempt>/), never under acct/<a real identity id>/.
Nothing is deleted: Milestone 1 grants no s3:DeleteObject and the standing rules
forbid deleting anything in AWS.

Every claim prints PASS, FAIL or SKIP with a reason, and the run ends with a
summary of all of them. A primitive the static credentials cannot exercise is
SKIPPED and named — never reported as proven. A botocore too old to express a
conditional header falls back to `aws s3api`, whose bundled botocore is its own,
newer one.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

import boto3
import botocore
from botocore.exceptions import ClientError, ParamValidationError

REGION = "us-east-1"
STACK = "nixus-sync"
SYNTHETIC_IDENTITY = "us-east-1:cccccccc-3333-4333-8333-cccccccccccc"
SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000000"
TEST_PREFIX = "ci-isolation-test/"
# Shaped like an ETag and impossible for an object to carry, so a stale-ETag
# comparison can never match by accident.
STALE_ETAG = '"00000000000000000000000000000000"'
DENIED_CODES = ("AccessDenied", "AllAccessDisabled", "InvalidAccessKeyId")


class Report:
    """One line per claim, so the job log ends with a readable verdict."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.failed = False

    def passed(self, claim: str) -> None:
        self.lines.append(f"PASS {claim}")
        print(f"PASS {claim}")

    def skipped(self, claim: str, reason: str) -> None:
        self.lines.append(f"SKIP {claim} -- {reason}")
        print(f"SKIP {claim}: {reason}")

    def failure(self, claim: str, detail: str) -> None:
        self.failed = True
        self.lines.append(f"FAIL {claim} -- {detail}")
        print(f"FAIL {claim}: {detail}")

    def verdict(self) -> int:
        print("\n--- conditional primitives on the real bucket ---")
        for line in self.lines:
            print(line)
        if self.failed:
            print("verdict: FAILED")
            return 1
        print("verdict: PASSED (every skip above is named, nothing is assumed)")
        return 0


def error_code(error: ClientError) -> str:
    return str(error.response.get("Error", {}).get("Code") or "")


def error_status(error: ClientError) -> int:
    return int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)


def cli_available() -> bool:
    try:
        subprocess.run(["aws", "--version"], check=True, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def cli_put(bucket: str, key: str, body: bytes, flag: str, value: str) -> tuple[bool, str]:
    """`aws s3api put-object` with one conditional flag.

    Returns `(ok, code)`, where `code` is the service error code the CLI prints
    ("An error occurred (PreconditionFailed) when calling ...") or the captured
    stderr when no code can be read out of it.
    """
    with tempfile.NamedTemporaryFile(delete=False) as handle:
        handle.write(body)
        path = handle.name
    try:
        result = subprocess.run(
            [
                "aws", "s3api", "put-object",
                "--bucket", bucket,
                "--key", key,
                "--body", path,
                "--region", REGION,
                flag, value,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return False, f"the aws CLI could not run: {error}"
    finally:
        os.unlink(path)

    if result.returncode == 0:
        return True, ""
    stderr = result.stderr.strip()
    marker = "An error occurred ("
    start = stderr.find(marker)
    if start >= 0:
        rest = stderr[start + len(marker) :]
        end = rest.find(")")
        if end > 0:
            return False, rest[:end]
    return False, stderr or f"exit {result.returncode}"


def owner_body() -> bytes:
    document = {
        "v": 1,
        "sub": SYNTHETIC_SUB,
        "identity_id": SYNTHETIC_IDENTITY,
        "created_ms": int(time.time() * 1000),
    }
    return json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")


def prove_create_only(s3, bucket: str, key: str, report: Report) -> None:
    """Claim group 1: the owner object is written once and never replaced."""
    claim = "owner object is create-only"
    first = owner_body()
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=first, IfNoneMatch="*")
    except ClientError as error:
        code = error_code(error)
        if code in DENIED_CODES:
            report.skipped(
                claim,
                f"the deploy credentials cannot write to {bucket} (s3:PutObject -> {code}); "
                "no credential or policy is created to work around this",
            )
            return
        report.failure(claim, f"the first If-None-Match: * write must return 200, got {code}")
        return
    except ParamValidationError:
        report.skipped(
            claim, "the installed botocore does not support IfNoneMatch on put_object"
        )
        return
    report.passed("first write with If-None-Match: * returned 200")

    second = json.dumps({"v": 1, "sub": "11111111-1111-4111-8111-111111111111"}).encode("utf-8")
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=second, IfNoneMatch="*")
    except ClientError as error:
        status, code = error_status(error), error_code(error)
        if status != 412:
            report.failure(claim, f"the second write must fail 412, got {status} {code}")
            return
        report.passed(f"second write with If-None-Match: * was refused {status} {code}")
    else:
        report.failure(
            claim, "the second If-None-Match: * write succeeded; the binding is replaceable"
        )
        return

    readback = "owner object reads back byte-identical"
    try:
        stored = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except ClientError as error:
        report.skipped(
            readback,
            f"s3:GetObject -> {error_code(error)}; the 412 above already proves create-only",
        )
        return
    if stored != first:
        report.failure(readback, "the stored body is not what the first write created")
        return
    report.passed("the stored owner object is still the first write's body, byte for byte")


def prove_compare_and_swap(s3, bucket: str, key: str, report: Report) -> None:
    """Claim group 2: the AD-6 pointer primitives, on the real bucket."""
    cas = "If-Match CAS moves the pointer"
    stale_claim = "If-Match with a superseded ETag is refused 412"
    absent_claim = "If-Match on a key that does not exist does not create it"
    get_claim = "If-None-Match GET answers 304"

    try:
        created = s3.put_object(Bucket=bucket, Key=key, Body=b'{"v":1,"pointer":"first"}')
    except ClientError as error:
        code = error_code(error)
        reason = (
            f"the deploy credentials cannot write to {bucket} (s3:PutObject -> {code})"
            if code in DENIED_CODES
            else f"the pointer fixture could not be created (s3:PutObject -> {code})"
        )
        for claim in (cas, stale_claim, absent_claim, get_claim):
            report.skipped(claim, reason)
        return

    etag = created["ETag"]
    print(f"pointer fixture key={key} etag={etag}")

    # The CAS itself. A botocore without IfMatch is answered by the CLI rather
    # than by a skip, because the header is the whole point of the claim.
    use_cli = False
    fresh_etag = etag
    try:
        updated = s3.put_object(
            Bucket=bucket, Key=key, Body=b'{"v":1,"pointer":"second"}', IfMatch=etag
        )
    except ParamValidationError:
        if not cli_available():
            for claim in (cas, stale_claim, absent_claim):
                report.skipped(
                    claim,
                    "the installed botocore does not support IfMatch on put_object and no "
                    "aws CLI is available to express the header instead",
                )
            prove_conditional_get(s3, bucket, key, etag, get_claim, report)
            return
        use_cli = True
        ok, code = cli_put(bucket, key, b'{"v":1,"pointer":"second"}', "--if-match", etag)
        if not ok:
            report.failure(cas, f"a PUT with the current ETag must return 200, got {code}")
        else:
            fresh_etag = s3.head_object(Bucket=bucket, Key=key)["ETag"]
            if fresh_etag == etag:
                report.failure(cas, "the ETag did not change, so the pointer did not move")
            else:
                report.passed(
                    "If-Match with the current ETag returned 200 and the ETag moved "
                    "(expressed through the aws CLI)"
                )
    except ClientError as error:
        report.failure(
            cas,
            f"a PUT with the current ETag must return 200, got "
            f"{error_status(error)} {error_code(error)}",
        )
    else:
        fresh_etag = updated["ETag"]
        if fresh_etag == etag:
            report.failure(cas, "the ETag did not change, so the pointer did not move")
        else:
            report.passed("If-Match with the current ETag returned 200 and the ETag moved")

    # `etag` is now superseded, which is exactly the state a second computer is in
    # after the first one published. Falling back to the never-issued STALE_ETAG
    # keeps the claim meaningful even if the CAS above did not move the pointer.
    stale = etag if fresh_etag != etag else STALE_ETAG
    if use_cli:
        ok, code = cli_put(bucket, key, b'{"v":1,"pointer":"third"}', "--if-match", stale)
        if ok:
            report.failure(
                stale_claim, "the superseded-ETag write succeeded; a pointer could be overwritten"
            )
        elif code != "PreconditionFailed":
            report.failure(stale_claim, f"expected PreconditionFailed, got {code}")
        else:
            report.passed(
                "If-Match with the superseded ETag was refused PreconditionFailed "
                "(expressed through the aws CLI)"
            )
        ok, code = cli_put(bucket, f"{key}-absent", b"{}", "--if-match", STALE_ETAG)
        report_absent_outcome(ok, 0, code, absent_claim, report)
    else:
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=b'{"v":1,"pointer":"third"}', IfMatch=stale)
        except ClientError as error:
            status, code = error_status(error), error_code(error)
            if status != 412:
                report.failure(stale_claim, f"expected 412, got {status} {code}")
            else:
                report.passed(f"If-Match with the superseded ETag was refused {status} {code}")
        else:
            report.failure(
                stale_claim, "the superseded-ETag write succeeded; a pointer could be overwritten"
            )

        try:
            s3.put_object(Bucket=bucket, Key=f"{key}-absent", Body=b"{}", IfMatch=STALE_ETAG)
        except ClientError as error:
            report_absent_outcome(
                False, error_status(error), error_code(error), absent_claim, report
            )
        else:
            report_absent_outcome(True, 200, "", absent_claim, report)

    prove_conditional_get(s3, bucket, key, fresh_etag, get_claim, report)


def report_absent_outcome(
    ok: bool, status: int, code: str, claim: str, report: Report
) -> None:
    """S3 may answer an If-Match on a missing key with either 404 or 412.

    Both are correct for the adapter: both mean "the pointer is not what you
    think it is", and neither creates the object. Only a 200 is a failure.
    """
    if ok:
        report.failure(
            claim, "the write succeeded, so a CAS that matched nothing created the pointer"
        )
        return
    if code in ("NoSuchKey", "404", "PreconditionFailed") or status in (404, 412):
        report.passed(f"If-Match on an absent key was refused {status or 'n/a'} {code}")
        return
    report.failure(claim, f"expected 404 or 412, got {status} {code}")


def prove_conditional_get(
    s3, bucket: str, key: str, etag: str, claim: str, report: Report
) -> None:
    """A poll that finds the pointer unchanged must pay for no body (AD-6)."""
    try:
        s3.get_object(Bucket=bucket, Key=key, IfNoneMatch=etag)
    except ParamValidationError:
        report.skipped(claim, "the installed botocore does not support IfNoneMatch on get_object")
        return
    except ClientError as error:
        status, code = error_status(error), error_code(error)
        if status == 304 or code in ("NotModified", "304"):
            report.passed(f"conditional GET with If-None-Match answered {status or 304} {code}")
            return
        if code in DENIED_CODES:
            report.skipped(claim, f"s3:GetObject -> {code}")
            return
        report.failure(claim, f"expected 304, got {status} {code}")
        return
    report.failure(claim, "the conditional GET returned a body, so every poll pays for one")


def main() -> int:
    cfn = boto3.client("cloudformation", region_name=REGION)
    outputs = {
        o["OutputKey"]: o["OutputValue"]
        for o in cfn.describe_stacks(StackName=STACK)["Stacks"][0].get("Outputs", [])
    }
    bucket = outputs["BucketName"]
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    prefix = f"{TEST_PREFIX}{run_id}-{attempt}/"
    if not prefix.startswith(TEST_PREFIX):
        print("FAIL refusing to write anywhere but the test-only prefix")
        return 1

    print(f"bucket={bucket} prefix={prefix} boto3={boto3.__version__} botocore={botocore.__version__}")
    s3 = boto3.client("s3", region_name=REGION)
    report = Report()
    prove_create_only(s3, bucket, f"{prefix}owner", report)
    prove_compare_and_swap(s3, bucket, f"{prefix}pointer", report)
    return report.verdict()


if __name__ == "__main__":
    sys.exit(main())
