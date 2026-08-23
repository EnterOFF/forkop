#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

reject_runtime_pattern() {
  local pattern="$1"
  local label="$2"

  if rg -n --fixed-strings "$pattern" "$ROOT_DIR/forkop/files" >/dev/null 2>&1; then
    rg -n --fixed-strings "$pattern" "$ROOT_DIR/forkop/files" >&2
    fail "$label"
  fi
}

reject_runtime_regex() {
  local pattern="$1"
  local label="$2"

  if rg -n "$pattern" "$ROOT_DIR/forkop/files" >/dev/null 2>&1; then
    rg -n "$pattern" "$ROOT_DIR/forkop/files" >&2
    fail "$label"
  fi
}

reject_runtime_pattern "ucode sing-box runtime generator" \
  "sing-box logs must not expose the implementation language"
reject_runtime_pattern "runtime generator" \
  "sing-box generator errors must describe config generation, not the internal generator"
reject_runtime_pattern "Reload signature changes:" \
  "reload logs must not dump internal signature vectors"
reject_runtime_pattern "Reload plan: sing-box=" \
  "reload logs must not dump boolean plan internals"
reject_runtime_pattern "Applying reload changes: " \
  "reload logs must not announce the subsystems of the plan; each step reports itself"
# Lines that fire when nothing happened are the bulk of what makes the log
# unreadable: replacing the nftables table used to take seven of them to say one
# thing, four reporting that something was already in place.
reject_runtime_pattern 'already exists"' \
  "logs must report what was done, not that something was already in place"
# Applying a configuration change usually restarts nothing, and often changes
# nothing at all, so it must not be reported as the service reloading.
reject_runtime_pattern 'log_message("Reloading Forkop"' \
  "applying a configuration change must not be announced as reloading Forkop"
reject_runtime_pattern "Starting subscription update" \
  "native subscription refresh must not duplicate core update logs"
reject_runtime_pattern "Subscription providers refreshed without reloading sing-box" \
  "native subscription refresh must not log orchestration success"
reject_runtime_pattern "Current sing-box config hash:" \
  "sing-box config logs must not emit duplicate hash lines"
reject_runtime_pattern "Temporary sing-box config hash:" \
  "sing-box config logs must not emit duplicate hash lines"
reject_runtime_pattern "Forkop did not reach a stable running state after start" \
  "startup rollback logs must not be fatal secondary errors"
reject_runtime_pattern "Flush nft" \
  "stop logs must not expose routine nft cleanup as user-facing info"
reject_runtime_pattern "Flush ip rule" \
  "stop logs must not expose routine ip-rule cleanup as user-facing info"
reject_runtime_pattern "Flush ip route" \
  "stop logs must not expose routine route cleanup as user-facing info"
reject_runtime_pattern "Create IPv4 marking rule" \
  "nft logs must use polished wording"
reject_runtime_pattern "Create IPv6 marking rule" \
  "nft logs must use polished wording"
reject_runtime_pattern "marking rule exist" \
  "nft logs must use correct grammar"
reject_runtime_pattern "br_netfilter enabled detected. Disabling" \
  "nft logs must use polished bridge-netfilter wording"
reject_runtime_pattern "IP/port entries" \
  "native rule-set nft sync must log only the total number of nft values"
reject_runtime_pattern "rule(s) that cannot be represented" \
  "native rule-set nft sync must not expose ignored-rule details"
# What the sets ended up holding is the one number worth a line. A second line
# saying part of a third-party list is not expressible as addresses fires on
# every sync and cannot be acted on, and a line per chunk of elements written
# says the same thing again in pieces.
reject_runtime_pattern "rule-set entries whose conditions" \
  "native rule-set nft sync must not report what a list could not contribute"
reject_runtime_pattern "elements to nft set" \
  "filling a set must not be reported chunk by chunk"

reject_runtime_regex 'log_message\("singbox/runtime\.uc: ' \
  "runtime logs must not expose singbox/runtime.uc as a user-facing prefix"

printf 'log hygiene checks passed\n'
