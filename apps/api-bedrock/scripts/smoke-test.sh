#!/usr/bin/env bash
# Deployed API smoke test (AD-2, AD-3, AD-15).
#
# Runs against the real stack after deployment and asserts only what can be
# proven without a user credential:
#   - the custom domain serves the API over TLS,
#   - both routes reject an unauthenticated call at the authorizer,
#   - that rejection carries the canonical pre-output error envelope rather than
#     API Gateway's generic body, and
#   - the default execute-api endpoint is disabled.
#
# Authenticated four-surface acceptance needs a scoped premium test user and is a
# manual release gate in docs/runbooks/hosted-ai-rollout.md, not a CI step.
set -euo pipefail

STACK_NAME="${STACK_NAME:-nixus-bedrock-api}"

# Unique per run and always cleaned up: a fixed /tmp path collides when two
# checkouts or two workflow runs share a machine, and the collision surfaces as a
# confusing assertion failure rather than an obvious clash.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nixus-smoke.XXXXXX")"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

require() {
  local name="$1" value="$2"
  if [[ -z "${value}" || "${value}" == "None" ]]; then
    echo "FAIL: could not resolve ${name} for stack ${STACK_NAME}" >&2
    exit 1
  fi
}

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

endpoint="$(stack_output ApiEndpoint)"
require "ApiEndpoint" "${endpoint}"
echo "endpoint=${endpoint}"

fail=0

assert_unauthorized() {
  local method="$1" path="$2" body="${3:-}"
  local body_file="${WORK_DIR}/response-${method}.json"
  local status payload code

  if [[ -n "${body}" ]]; then
    status="$(curl -sS --tlsv1.2 -o "${body_file}" -w '%{http_code}' \
      -X "${method}" "${endpoint}${path}" \
      -H 'Content-Type: application/json' \
      --data "${body}")"
  else
    status="$(curl -sS --tlsv1.2 -o "${body_file}" -w '%{http_code}' \
      -X "${method}" "${endpoint}${path}")"
  fi

  payload="$(cat "${body_file}")"

  if [[ "${status}" != "401" ]]; then
    echo "FAIL ${method} ${path}: expected 401 unauthenticated, got ${status}" >&2
    fail=1
    return
  fi

  code="$(printf '%s' "${payload}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["error"]["code"])' 2>/dev/null || true)"
  if [[ "${code}" != "unauthorized" ]]; then
    echo "FAIL ${method} ${path}: expected canonical error.code=unauthorized, got body: ${payload}" >&2
    fail=1
    return
  fi

  echo "PASS ${method} ${path}: 401 unauthorized with canonical envelope"
}

assert_unauthorized GET /v1/ai/status
assert_unauthorized POST /v1/ai/invoke \
  '{"operation":"chat","system":"s","messages":[],"client_request_id":"00000000-0000-4000-8000-000000000000"}'

# Resolved from the stack's own resource rather than `get-rest-apis`, which pages at
# 25 items by default: on an account with more APIs than that, a name filter over
# the first page silently finds nothing and this check would pass vacuously.
api_id="$(aws cloudformation describe-stack-resource \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id HostedAiApi \
  --query 'StackResourceDetail.PhysicalResourceId' \
  --output text)"
require "HostedAiApi physical id" "${api_id}"
echo "rest_api_id=${api_id}"

disabled="$(aws apigateway get-rest-api --rest-api-id "${api_id}" \
  --query 'disableExecuteApiEndpoint' --output text)"
if [[ "${disabled}" != "True" ]]; then
  echo "FAIL: default execute-api endpoint is still enabled (${disabled})" >&2
  fail=1
else
  echo "PASS: default execute-api endpoint is disabled"
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "smoke test FAILED" >&2
  exit 1
fi

echo "smoke test PASSED"
