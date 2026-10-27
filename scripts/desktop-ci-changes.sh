#!/usr/bin/env bash
# Decides which parts of Desktop CI a change actually needs. Used by
# .github/workflows/desktop-ci.yml; runnable by hand to see what CI would do:
#
#   scripts/desktop-ci-changes.sh <base-sha> <head-sha>
#
# Prints `key=true|false` lines (and appends them to $GITHUB_OUTPUT when set):
#
#   frontend  desktop frontend / shared package / workspace manifests changed
#   rust      anything the Rust crate builds from changed
#   sync      the sync engine, the database layer or the dependency set changed: the
#             surfaces the convergence simulator and the release latency gate measure
#   deps      dependencies or build configuration changed: what the cross-arch macOS
#             build exists to prove (bindgen generating the SQLite bindings)
#
# Fails OPEN: no usable base (first push, force-push to an unknown sha, manual dispatch)
# means every key is true. A pure version bump (only the version fields of the four
# version-carrying files) means every key is false: Release builds that commit anyway.

set -euo pipefail

base="${1:-}"
head="${2:-HEAD}"

emit() {
  local line
  for line in "frontend=$1" "rust=$2" "sync=$3" "deps=$4"; do
    echo "$line"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$line" >> "$GITHUB_OUTPUT"; fi
  done
}

if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] \
  || ! merge_base="$(git merge-base "$base" "$head" 2>/dev/null)"; then
  echo "No usable diff base ('$base'); running everything." >&2
  emit true true true true
  exit 0
fi

changed="$(git diff --name-only "$merge_base" "$head")"
echo "Changed files ($merge_base..$head):" >&2
echo "${changed:-<none>}" | sed 's/^/  /' >&2

# The files the version-bump skill rewrites. A diff confined to their version fields
# changes nothing Desktop CI could fail on.
version_files=(
  apps/desktop/package.json
  apps/desktop/src-tauri/Cargo.toml
  apps/desktop/src-tauri/Cargo.lock
  apps/desktop/src-tauri/tauri.conf.json
)
if [ -n "$changed" ] && ! grep -qvxF -f <(printf '%s\n' "${version_files[@]}") <<< "$changed"; then
  edits="$(git diff -U0 "$merge_base" "$head" -- "${version_files[@]}" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' || true)"
  lock_edits="$(git diff -U0 "$merge_base" "$head" -- apps/desktop/src-tauri/Cargo.lock | grep -E '^[+-]' | grep -cvE '^(\+\+\+|---) ' || true)"
  version_line='^[+-][[:space:]]*("version":[[:space:]]*"[^"]*",?|version[[:space:]]*=[[:space:]]*"[^"]*")[[:space:]]*$'
  # Cargo.lock: a dependency bump also edits `version = ` lines, but never only one pair
  # of them (its checksum moves too), so the crate's own bump is at most two lines.
  if [ -n "$edits" ] && ! grep -qvE "$version_line" <<< "$edits" && [ "${lock_edits:-0}" -le 2 ]; then
    echo "Version bump only; nothing to verify." >&2
    emit false false false false
    exit 0
  fi
fi

matches() { grep -qE "$1" <<< "$changed"; }

# Changing how CI decides must re-run all of it.
ci='^(\.github/workflows/desktop-ci\.yml|scripts/desktop-ci-changes\.sh)$'
crate='^apps/desktop/src-tauri/'

frontend=false; rust=false; sync=false; deps=false
# Everything under apps/desktop/ except the crate, plus chat.rs, which the frontend test
# src/lib/__tests__/chatActions.test.ts reads.
if matches "$ci|^packages/shared/|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$|^${crate}src/commands/chat\.rs$" \
  || grep '^apps/desktop/' <<< "$changed" | grep -qv "$crate"; then
  frontend=true
fi
if matches "$ci|$crate|^rust-toolchain\.toml$"; then rust=true; fi
if matches "$ci|^rust-toolchain\.toml$|${crate}(src/(sync|db)/|migrations/|Cargo\.(toml|lock)$)"; then sync=true; fi
if matches "$ci|^rust-toolchain\.toml$|${crate}(Cargo\.(toml|lock)|build\.rs|tauri\.conf\.json)$|${crate}\.cargo/"; then deps=true; fi

emit "$frontend" "$rust" "$sync" "$deps"
