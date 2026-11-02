#!/usr/bin/env bash
# Pre-deploy guard: prove the supplied inference-profile secret names the approved model.
#
# A well-formed ARN proves nothing about what it names. Resolving the PUBLIC model id
# instead would succeed for a secret naming another account's profile, a deleted profile,
# an unreadable one, or one still routing to the superseded model - so this resolves the
# EXACT supplied ARN and compares every identity-bearing field of the response.
#
# Runs BEFORE `sam deploy`, because the value becomes the IAM resource the Lambda streams
# against. It needs exactly one Bedrock permission - read-only bedrock:GetInferenceProfile
# on the one approved profile ARN - and makes no other AWS call.
#
# The ARN is account-bearing: it is never echoed, never written to a step summary, and the
# CLI's own stderr is redacted rather than trusted to GitHub's secret masking, which only
# knows the strings registered as secrets.
set -euo pipefail

# Pathname expansion off for the whole script. Destination ARNs are matched against the
# IAM pattern as a `case` glob, and no unquoted expansion anywhere else may be able to
# turn into a list of filenames.
set -f

REGION="us-east-1"

PROFILE_ARN="${BEDROCK_INFERENCE_PROFILE_ARN:-}"
APPROVED_MODEL_ID="${APPROVED_BEDROCK_MODEL_ID:-}"
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
test -n "${APPROVED_MODEL_ID}" || fail "APPROVED_BEDROCK_MODEL_ID is not set."
test -n "${APPROVED_PATTERN}" \
  || fail "APPROVED_BEDROCK_FOUNDATION_MODEL_ARN_PATTERN is not set."

# The approved destination model is DERIVED from the IAM pattern rather than written a
# second time: two literals are how the grant and the check that guards it start
# disagreeing. A pattern carrying no `foundation-model/` segment would derive an empty
# prefix that matches every destination, so the derivation is validated before use.
case "${APPROVED_PATTERN}" in
  *foundation-model/*) ;;
  *) fail "the approved destination pattern names no foundation model." ;;
esac
APPROVED_DESTINATION_MODEL="${APPROVED_PATTERN##*foundation-model/}"
APPROVED_DESTINATION_MODEL="${APPROVED_DESTINATION_MODEL%\*}"
test -n "${APPROVED_DESTINATION_MODEL}" \
  || fail "the approved destination pattern derives an empty foundation model."
case "${APPROVED_DESTINATION_MODEL}" in
  us.* | eu.* | apac.*)
    fail "the approved destination must be a foundation model, not an inference profile."
    ;;
esac

# An `application-inference-profile` is a different resource type with an operator-chosen
# id, so it can carry any destination set and name anything; it is refused outright
# rather than validated.
case "${PROFILE_ARN}" in
  *:application-inference-profile/*)
    fail "an application inference profile is not the approved system-defined profile."
    ;;
esac

if [[ ! "${PROFILE_ARN}" =~ ^arn:aws[a-zA-Z-]*:bedrock:${REGION}:[0-9]{12}:inference-profile/ ]]; then
  fail "the supplied ARN is not a ${REGION} Bedrock inference-profile ARN."
fi

case "${PROFILE_ARN}" in
  *":inference-profile/${APPROVED_MODEL_ID}") ;;
  *) fail "the supplied ARN does not end in exactly the approved profile id." ;;
esac

# Unique per run and always removed, so two runs on one machine cannot read each other's
# captured stderr and a failure cannot leave an account-bearing file behind.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nixus-profile-validate.XXXXXX")"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT
ERR_FILE="${WORK_DIR}/get-inference-profile.err"

redact() {
  sed -e "s|${PROFILE_ARN}|<redacted-profile-arn>|g" -e 's|[0-9]\{12\}|<redacted-account>|g'
}

if ! profile="$(aws bedrock get-inference-profile \
    --region "${REGION}" \
    --inference-profile-identifier "${PROFILE_ARN}" \
    --output json 2>"${ERR_FILE}")"; then
  echo "FAIL: get-inference-profile failed for the supplied ARN:" >&2
  redact <"${ERR_FILE}" >&2
  exit 1
fi

field() {
  printf '%s' "${profile}" | jq -r "$1"
}

resolved_arn="$(field '.inferenceProfileArn // ""')"
resolved_id="$(field '.inferenceProfileId // ""')"
status="$(field '.status // ""')"
profile_type="$(field '.type // ""')"
model_count="$(field '(.models // []) | length')"
named_count="$(field '[(.models // [])[] | select((.modelArn // "") != "")] | length')"

test "${resolved_arn}" = "${PROFILE_ARN}" \
  || note "the resolved profile ARN is not the ARN that was supplied."
test "${resolved_id}" = "${APPROVED_MODEL_ID}" \
  || note "the profile resolves to id '${resolved_id}', expected '${APPROVED_MODEL_ID}'."
test "${status}" = "ACTIVE" || note "the profile status is '${status}', expected ACTIVE."
test "${profile_type}" = "SYSTEM_DEFINED" \
  || note "the profile type is '${profile_type}', expected SYSTEM_DEFINED."

if [ "${model_count}" -lt 1 ]; then
  note "the profile declares no destination models."
elif [ "${named_count}" != "${model_count}" ]; then
  note "${model_count} destination model(s) declared but only ${named_count} carry a modelArn."
else
  # One foreign destination is enough to route a request to a model the IAM grant does
  # not cover, which surfaces at run time as an outage rather than at deploy time as a
  # mistake. The pattern is deliberately unquoted so its wildcards stay active as a glob.
  while IFS= read -r destination; do
    test -n "${destination}" || continue
    case "${destination}" in
      ${APPROVED_PATTERN}) ;;
      *) note "a destination model is outside the approved pattern for ${APPROVED_DESTINATION_MODEL}." ;;
    esac
  done <<<"$(field '(.models // [])[] | .modelArn // ""')"
fi

test "${failed}" = "0" \
  || fail "the supplied inference-profile secret does not identify the approved model."

echo "profile_validated=true model_id=${APPROVED_MODEL_ID} status=ACTIVE type=SYSTEM_DEFINED destinations=${model_count}"
