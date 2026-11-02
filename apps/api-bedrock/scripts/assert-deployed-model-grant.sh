#!/usr/bin/env bash
# Post-deploy guard: the IAM grant identifies the SAME model the code invokes.
#
# The model identity is carried by three parameters, and two of them decide what the IAM
# policy authorizes rather than what the code reads - so a deploy that moved only
# BedrockModelId passes a model-environment assertion while still granting streaming on
# the superseded model.
#
# CloudFormation preserves a parameter an UPDATE omits, so the DEPLOYED values are read
# back and compared to the exact inputs the pre-deploy validation accepted - never to a
# template default, which an existing stack never adopts.
#
# The deployed profile ARN is account-bearing: it is compared, never printed. Only the
# destination pattern, which carries no account id, is reported.
set -euo pipefail

STACK_NAME="${STACK_NAME:-nixus-bedrock-api}"
PROFILE_ARN="${BEDROCK_INFERENCE_PROFILE_ARN:-}"
APPROVED_PATTERN="${APPROVED_BEDROCK_FOUNDATION_MODEL_ARN_PATTERN:-}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

failed=0
note() {
  echo "MISMATCH: $1" >&2
  failed=1
}

test -n "${PROFILE_ARN}" \
  || fail "BEDROCK_INFERENCE_PROFILE_ARN is not set on the production environment."
test -n "${APPROVED_PATTERN}" \
  || fail "APPROVED_BEDROCK_FOUNDATION_MODEL_ARN_PATTERN is not set."

parameters="$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Parameters' --output json)"

# `first // ""` rather than a bare select: a select that matches nothing emits nothing,
# which would read as an empty-but-present parameter instead of an absent one.
value_of() {
  printf '%s' "${parameters}" \
    | jq -r --arg key "$1" '[.[] | select(.ParameterKey == $key) | .ParameterValue] | first // ""'
}

deployed_profile="$(value_of BedrockInferenceProfileArn)"
deployed_pattern="$(value_of BedrockFoundationModelArnPattern)"

echo "deployed_destination_pattern=${deployed_pattern}"

if [ -z "${deployed_profile}" ]; then
  note "the stack carries no BedrockInferenceProfileArn parameter value."
elif [ "${deployed_profile}" != "${PROFILE_ARN}" ]; then
  note "the deployed profile ARN is not the validated secret."
fi

if [ "${deployed_pattern}" != "${APPROVED_PATTERN}" ]; then
  note "deployed destination pattern: expected '${APPROVED_PATTERN}', got '${deployed_pattern}'."
fi

test "${failed}" = "0" || fail "a superseded model-bearing parameter survived this deploy."

echo "iam_grant_matches_approved_model=true"
