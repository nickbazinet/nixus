#!/usr/bin/env bash
#
# The AD-19 verification gate for multi-device sync, in one command.
#
# Runs every gate Milestone 2 is accepted against, in order, and prints a PASS/FAIL table with the
# wall time of each step. Exits non-zero if any step failed.
#
#   scripts/sync-verify.sh              # everything (this is the gate)
#   scripts/sync-verify.sh --dry-run    # list the steps and their commands, run nothing
#   scripts/sync-verify.sh --help
#
# Every step is skippable with an env var (SKIP_<STEP_ID>=1) and the simulator seed count is
# SIM_SEEDS (default 1000). Skipping a step prints SKIP in the table and is NOT a pass: the table
# footer says how many were skipped so a green run with half the gate turned off cannot be mistaken
# for a green gate.
#
# NO AWS CALL AND NO SECRET IS INVOLVED. The infrastructure checks are the offline ones only
# (`verify-template.py`, `cfn-lint`, `attest-deployed.py --self-test`); the deployed stack is
# verified by `.github/workflows/sync-infra.yml`, which is the only sanctioned path to AWS.
#
# Honours CARGO_TARGET_DIR, so a warm shared cache cuts the Rust steps dramatically.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly TAURI_DIR="$REPO_ROOT/apps/desktop/src-tauri"
readonly SIM_SEEDS="${SIM_SEEDS:-1000}"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  --help | -h)
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "") ;;
  *)
    echo "unknown argument: $1 (try --help)" >&2
    exit 2
    ;;
esac

# Each step is "ID|DESCRIPTION|WORKING DIR|COMMAND". The order is the order AD-19 states the gate
# in, cheapest-first inside each group so a broken build fails before an hour of simulation.
STEPS=(
  "BUILD_WARNINGS|Rust warnings = 0|$TAURI_DIR|__build_warnings"
  "CLIPPY|cargo clippy --all-targets -D warnings|$TAURI_DIR|cargo clippy --all-targets -- -D warnings"
  "TESTS|full cargo test|$TAURI_DIR|cargo test"
  "CAPTURE_REGRESSION|capture regression: REPLACE, DELETE without WHERE, cascades, WITHOUT ROWID|$TAURI_DIR|cargo test --lib sync::tests_capture:: -- --nocapture --skip latency"
  "WRITE_SITE_BUDGET|write-site budget ratchet (AD-3)|$TAURI_DIR|cargo test --lib sync::tests_write_site_budget -- --nocapture"
  "CLASSIFICATION|classification and registry coverage|$TAURI_DIR|cargo test --lib sync::registry:: -- --nocapture && cargo test --lib sync::identity:: -- --nocapture"
  "M1_PROOF|Milestone-1 end-to-end proof|$TAURI_DIR|cargo test sync_e2e -- --nocapture"
  "M2_PROOF|Milestone-2 two-computer proof|$TAURI_DIR|cargo test sync_m2_e2e -- --nocapture"
  "LATENCY|capture latency gate (release, single-threaded)|$TAURI_DIR|cargo test --release --lib sync::tests_capture_latency -- --test-threads=1 --nocapture"
  "SIMULATOR|convergence simulator, ${SIM_SEEDS} seeds (release)|$TAURI_DIR|__simulator"
  "INFRA_TEMPLATE|infra/sync/verify-template.py (offline)|$REPO_ROOT|__verify_template"
  "INFRA_LINT|cfn-lint infra/sync/template.yaml (offline, if installed)|$REPO_ROOT|__cfn_lint"
  "INFRA_ATTEST|infra/sync/attest-deployed.py --self-test (offline)|$REPO_ROOT|__attest_selftest"
  "FRONTEND_TYPES|desktop tsc --noEmit|$REPO_ROOT|pnpm --filter @nixus/desktop exec tsc --noEmit"
  "DESKTOP_UNIT|desktop vitest|$REPO_ROOT|pnpm --filter @nixus/desktop test"
  "WEB_TYPES|web typecheck|$REPO_ROOT|pnpm --filter @nixus/web typecheck"
  "WEB_UNIT|web vitest|$REPO_ROOT|pnpm --filter @nixus/web test"
  "PLAYWRIGHT|Playwright sync and recently-deleted specs|$REPO_ROOT|pnpm --filter @nixus/desktop exec playwright test tests/sync.spec.ts tests/recently-deleted.spec.ts"
)

# `cargo build` succeeding is not the claim: `docs/guidelines/warnings.md` makes ZERO warnings a
# gate, and a warning is an exit code of 0 with text on stderr. The output is scanned rather than
# `-D warnings`-ed so the failure message can show which warnings they were.
__build_warnings() {
  local log
  log="$(mktemp)"
  if ! cargo build --all-targets 2>&1 | tee "$log"; then
    rm -f "$log"
    return 1
  fi
  local found
  found="$(grep -c '^warning' "$log" || true)"
  if [ "$found" != "0" ]; then
    echo "--- $found warning line(s); warnings.md makes this a gate ---" >&2
    grep '^warning' "$log" >&2 || true
    rm -f "$log"
    return 1
  fi
  rm -f "$log"
}

# The simulator is the one step whose failure needs a replay instruction rather than a stack trace:
# a seed is a complete replay of the scenario.
__simulator() {
  if NIXUS_SIM_SEEDS="$SIM_SEEDS" cargo test --release sync::sim -- --nocapture; then
    return 0
  fi
  cat >&2 <<'HINT'
--- the simulator failed ---
The failing seed is printed above, together with the path of the trace file it wrote under
<temp>/nixus-sim-traces/. Replay exactly that scenario with:

    NIXUS_SIM_SEED=<seed> cargo test sync::sim

Do not re-run at a different seed count and call it green: a rare-seed failure is a real failure.
HINT
  return 1
}

# The three infra checks each need a Python package a dev machine may not have, and on a machine
# whose `python3` is an externally-managed install (PEP 668) `pip install` refuses outright — so
# `uv run --with`, which builds a throwaway environment, is the fallback that makes them runnable
# locally at all. With neither the package nor `uv`, the step reports SKIP and never PASS: the gate
# is "the template still says what it must", and `.github/workflows/sync-infra.yml` installs the
# packages and runs all three on every push.
__python_check() {
  local modules="$1" packages="$2"
  shift 2

  local missing=""
  local module
  for module in $modules; do
    python3 -c "import $module" >/dev/null 2>&1 || missing="$missing $module"
  done
  if [ -z "$missing" ]; then
    python3 "$@"
    return
  fi

  if command -v uv >/dev/null 2>&1; then
    local with_args=()
    local package
    for package in $packages; do
      with_args+=(--with "$package")
    done
    echo "python3 is missing:$missing — supplying them with uv instead"
    uv run --quiet --no-project "${with_args[@]}" python3 "$@"
    return
  fi

  echo "python3 is missing:$missing, and uv is not installed to supply them."
  echo "install either of these, then re-run:"
  echo "    uv run --no-project${packages:+ --with ${packages// / --with }} python3 $*"
  echo "    python3 -m pip install --user $packages   (add --break-system-packages on a PEP-668 python3)"
  echo "the sync-infra workflow installs $packages and runs this check on every push."
  return 2
}

__verify_template() {
  __python_check "yaml cfnlint" "pyyaml cfn-lint" infra/sync/verify-template.py
}

__attest_selftest() {
  __python_check "boto3" "boto3" infra/sync/attest-deployed.py --self-test
}

# Absent rather than failing: cfn-lint is an optional local tool and the workflow runs it anyway.
__cfn_lint() {
  if ! command -v cfn-lint >/dev/null 2>&1; then
    echo "cfn-lint is not installed; the sync-infra workflow runs it on every push."
    return 2
  fi
  cfn-lint infra/sync/template.yaml
}

if [ "$DRY_RUN" = "1" ]; then
  printf '%-20s %s\n' "STEP" "COMMAND"
  for step in "${STEPS[@]}"; do
    IFS='|' read -r id description workdir command <<<"$step"
    printf '%-20s %s\n' "$id" "$command"
    printf '%-20s   in %s — %s\n' "" "${workdir#"$REPO_ROOT"/}" "$description"
  done
  echo
  echo "${#STEPS[@]} steps. SIM_SEEDS=$SIM_SEEDS. Skip any with SKIP_<STEP>=1."
  exit 0
fi

results=()
failed=0
skipped=0

for step in "${STEPS[@]}"; do
  IFS='|' read -r id description workdir command <<<"$step"
  skip_var="SKIP_$id"
  if [ -n "${!skip_var:-}" ]; then
    results+=("SKIP|$id|0|$description")
    skipped=$((skipped + 1))
    continue
  fi

  echo
  echo "=============================================================================="
  echo "[$id] $description"
  echo "=============================================================================="
  started=$SECONDS
  status=0
  if [[ "$command" == __* ]]; then
    (cd "$workdir" && "$command") || status=$?
  else
    (cd "$workdir" && eval "$command") || status=$?
  fi
  elapsed=$((SECONDS - started))

  case "$status" in
    0) results+=("PASS|$id|$elapsed|$description") ;;
    # 2 is a step reporting "the tool I need is not here", which is not a failed gate.
    2)
      results+=("SKIP|$id|$elapsed|$description")
      skipped=$((skipped + 1))
      ;;
    *)
      results+=("FAIL|$id|$elapsed|$description")
      failed=$((failed + 1))
      ;;
  esac
done

echo
echo "=============================================================================="
echo "AD-19 verification gate"
echo "=============================================================================="
printf '%-6s %-20s %8s  %s\n' "RESULT" "STEP" "SECONDS" "WHAT IT PROVES"
for result in "${results[@]}"; do
  IFS='|' read -r outcome id elapsed description <<<"$result"
  printf '%-6s %-20s %8s  %s\n' "$outcome" "$id" "$elapsed" "$description"
done
echo "------------------------------------------------------------------------------"
echo "${#results[@]} steps, $failed failed, $skipped skipped, SIM_SEEDS=$SIM_SEEDS"

if [ "$failed" != "0" ]; then
  echo "GATE: FAIL — do not ship. A gate is never relaxed to get a green run."
  exit 1
fi
if [ "$skipped" != "0" ]; then
  echo "GATE: PASS with $skipped step(s) skipped — this is NOT the full gate."
  exit 0
fi

echo "GATE: PASS"
