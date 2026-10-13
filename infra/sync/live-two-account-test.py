#!/usr/bin/env python3
"""Live two-account isolation test (real logins, real credentials, real S3).

This is the end-to-end form of the AD-19 gate: sign in as two dedicated test
users, vend their real identity-pool credentials, and prove each one can only
reach its own acct/<identity-id>/ prefix. It is written and wired into
.github/workflows/sync-infra.yml, but it SKIPS with an explicit reason until the
test accounts exist, because this story must not create Cognito users and must
not change the existing user pool or app client.

Required environment (all of them, or the run skips):
  NIXUS_SYNC_TEST_POOL_CLIENT_ID   app client allowing USER_PASSWORD_AUTH
  NIXUS_SYNC_TEST_USER_A_USERNAME  / NIXUS_SYNC_TEST_USER_A_PASSWORD
  NIXUS_SYNC_TEST_USER_B_USERNAME  / NIXUS_SYNC_TEST_USER_B_PASSWORD

Keys are confined to a test-only suffix inside each test account's own prefix,
and nothing is ever deleted (Milestone 1 grants no s3:DeleteObject).
"""

from __future__ import annotations

import json
import os
import sys
import time

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
STACK = "nixus-sync"
USER_POOL_ID = "us-east-1_7gfGQ0emg"
REQUIRED = (
    "NIXUS_SYNC_TEST_POOL_CLIENT_ID",
    "NIXUS_SYNC_TEST_USER_A_USERNAME",
    "NIXUS_SYNC_TEST_USER_A_PASSWORD",
    "NIXUS_SYNC_TEST_USER_B_USERNAME",
    "NIXUS_SYNC_TEST_USER_B_PASSWORD",
)

failures: list[str] = []


def record(ok: bool, claim: str, detail: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'} {claim} ({detail})")
    if not ok:
        failures.append(f"{claim}: {detail}")


def sign_in(client_id: str, username: str, password: str) -> str:
    idp = boto3.client("cognito-idp", region_name=REGION)
    response = idp.initiate_auth(
        ClientId=client_id,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    return response["AuthenticationResult"]["IdToken"]


def vend(pool_id: str, client_id: str, id_token: str) -> tuple[str, boto3.Session]:
    """Enhanced flow: GetId then GetCredentialsForIdentity."""
    cognito = boto3.client("cognito-identity", region_name=REGION)
    logins = {f"cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}": id_token}
    identity_id = cognito.get_id(IdentityPoolId=pool_id, Logins=logins)["IdentityId"]
    vended = cognito.get_credentials_for_identity(IdentityId=identity_id, Logins=logins)
    credentials = vended["Credentials"]
    session = boto3.Session(
        aws_access_key_id=credentials["AccessKeyId"],
        aws_secret_access_key=credentials["SecretKey"],
        aws_session_token=credentials["SessionToken"],
        region_name=REGION,
    )
    print(f"  identity {identity_id} credentials expire {credentials['Expiration']} (client_id {client_id[:4]}...)")
    return identity_id, session


def denied(error: ClientError) -> bool:
    status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return status in (403, 404) or error.response.get("Error", {}).get("Code") == "AccessDenied"


def main() -> int:
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        print("SKIP live two-account isolation test: " + ", ".join(missing) + " not set.")
        print(
            "No Cognito test accounts exist, and this story must not create users or "
            "change the existing user pool or app client. The same claims are proven "
            "read-only by infra/sync/isolation-simulate.py against the deployed role, "
            "trust policy and identity-pool settings. Configure the variables above and "
            "this becomes a real end-to-end gate with no code change."
        )
        return 0

    cfn = boto3.client("cloudformation", region_name=REGION)
    outputs = {
        o["OutputKey"]: o["OutputValue"]
        for o in cfn.describe_stacks(StackName=STACK)["Stacks"][0].get("Outputs", [])
    }
    bucket, pool_id = outputs["BucketName"], outputs["IdentityPoolId"]
    client_id = os.environ["NIXUS_SYNC_TEST_POOL_CLIENT_ID"]
    run_tag = f"live-test-{os.environ.get('GITHUB_RUN_ID', 'local')}-{int(time.time())}"

    accounts = {}
    for label in ("A", "B"):
        token = sign_in(
            client_id,
            os.environ[f"NIXUS_SYNC_TEST_USER_{label}_USERNAME"],
            os.environ[f"NIXUS_SYNC_TEST_USER_{label}_PASSWORD"],
        )
        accounts[label] = vend(pool_id, client_id, token)

    identity_a, session_a = accounts["A"]
    identity_b, _ = accounts["B"]
    record(identity_a != identity_b, "the two test accounts get distinct identity ids", f"{identity_a} vs {identity_b}")

    s3_a = session_a.client("s3")
    own_key = f"acct/{identity_a}/{run_tag}"
    other_key = f"acct/{identity_b}/{run_tag}"
    body = json.dumps({"test": run_tag}).encode("utf-8")

    s3_a.put_object(Bucket=bucket, Key=own_key, Body=body)
    record(True, "A can write its own prefix", own_key)
    record(
        s3_a.get_object(Bucket=bucket, Key=own_key)["Body"].read() == body,
        "A can read back its own object",
        own_key,
    )
    listed = s3_a.list_objects_v2(Bucket=bucket, Prefix=f"acct/{identity_a}/")
    record(listed.get("KeyCount", 0) >= 1, "A can list its own prefix", f"KeyCount={listed.get('KeyCount')}")

    for claim, call in (
        ("A cannot read B's prefix", lambda: s3_a.get_object(Bucket=bucket, Key=other_key)),
        ("A cannot write B's prefix", lambda: s3_a.put_object(Bucket=bucket, Key=other_key, Body=body)),
        ("A cannot list B's prefix", lambda: s3_a.list_objects_v2(Bucket=bucket, Prefix=f"acct/{identity_b}/")),
        ("A cannot list the bucket root", lambda: s3_a.list_objects_v2(Bucket=bucket)),
        ("A cannot list acct/", lambda: s3_a.list_objects_v2(Bucket=bucket, Prefix="acct/")),
    ):
        try:
            call()
        except ClientError as error:
            record(denied(error), claim, error.response.get("Error", {}).get("Code", "?"))
        else:
            record(False, claim, "the call SUCCEEDED")

    if failures:
        print(f"live two-account isolation test FAILED with {len(failures)} violation(s)")
        return 1
    print("live two-account isolation test PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
