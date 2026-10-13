#!/usr/bin/env python3
"""Proves the create-only semantics of the AD-7 owner object.

Contract (the Rust client implements this in Stories 5/9):

    key   acct/<identity-id>/owner
    body  {"v":1,"sub":"<user-pool sub>","identity_id":"<identity-id>",
           "created_ms":<unix ms>}
    write once, with If-None-Match: *

A first write returns 200 and binds that identity id to that user-pool sub. A
second write MUST fail 412 PreconditionFailed, so the binding can never be
silently replaced by another device or another account.

This runs with the workflow's own static credentials, under a test-only prefix
(ci-isolation-test/<run id>/), never under acct/<a real identity id>/. Nothing
is deleted: Milestone 1 grants no s3:DeleteObject and the standing rules forbid
deleting anything in AWS.
"""

from __future__ import annotations

import json
import os
import sys
import time

import boto3
from botocore.exceptions import ClientError, ParamValidationError

REGION = "us-east-1"
STACK = "nixus-sync"
SYNTHETIC_IDENTITY = "us-east-1:cccccccc-3333-4333-8333-cccccccccccc"
SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000000"


def skip(reason: str) -> int:
    print(f"SKIP owner-object create-only proof: {reason}")
    print(
        "The contract itself is unchanged and the role-level grant is still proven by "
        "infra/sync/isolation-simulate.py (s3:PutObject is allowed on the caller's own "
        "prefix and denied everywhere else)."
    )
    return 0


def owner_body() -> bytes:
    document = {
        "v": 1,
        "sub": SYNTHETIC_SUB,
        "identity_id": SYNTHETIC_IDENTITY,
        "created_ms": int(time.time() * 1000),
    }
    return json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")


def main() -> int:
    cfn = boto3.client("cloudformation", region_name=REGION)
    outputs = {
        o["OutputKey"]: o["OutputValue"]
        for o in cfn.describe_stacks(StackName=STACK)["Stacks"][0].get("Outputs", [])
    }
    bucket = outputs["BucketName"]
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    key = f"ci-isolation-test/{run_id}-{attempt}/owner"
    if not key.startswith("ci-isolation-test/"):
        return skip("refusing to write anywhere but the test-only prefix")

    s3 = boto3.client("s3", region_name=REGION)
    first = owner_body()
    print(f"bucket={bucket} key={key}")

    try:
        s3.put_object(Bucket=bucket, Key=key, Body=first, IfNoneMatch="*")
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code in ("AccessDenied", "AllAccessDisabled", "InvalidAccessKeyId"):
            return skip(
                f"the deploy credentials cannot write to {bucket} (s3:PutObject -> {code}); "
                "no credential or policy is created to work around this"
            )
        print(f"FAIL the first create-only write must return 200, got {code}: {error}")
        return 1
    except ParamValidationError:
        return skip(
            "the installed botocore does not support IfNoneMatch on put_object, so "
            "conditional-write semantics cannot be exercised here"
        )
    print("PASS first write with If-None-Match: * returned 200")

    second = json.dumps({"v": 1, "sub": "11111111-1111-4111-8111-111111111111"}).encode("utf-8")
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=second, IfNoneMatch="*")
    except ClientError as error:
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = error.response.get("Error", {}).get("Code")
        if status != 412:
            print(f"FAIL the second write must fail 412, got {status} {code}")
            return 1
        print(f"PASS second write with If-None-Match: * was refused {status} {code}")
    else:
        print("FAIL the second write with If-None-Match: * succeeded; the binding is replaceable")
        return 1

    try:
        stored = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        print(f"NOTE read-back skipped: s3:GetObject -> {code}; the 412 above already proves create-only")
    else:
        if stored != first:
            print("FAIL the stored owner object is not the body the first write created")
            return 1
        print("PASS the stored owner object is still the first write's body, byte for byte")
    print("owner-object create-only proof PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
