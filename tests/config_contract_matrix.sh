#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STABLE_REF="${FORKOP_STABLE_REF:-0.7.19.9}"
STABLE_REPO="${FORKOP_STABLE_REPO:-}"
MATRIX_SCRIPT="$ROOT_DIR/tests/helpers/config_contract_matrix.js"
WORK_DIR="$(mktemp -d)"
LEGACY_STEM="$(printf '\160\157\144\153\157\160')"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

ensure_stable_ref() {
  if git -C "$ROOT_DIR" rev-parse --verify "$STABLE_REF^{commit}" >/dev/null 2>&1; then
    return 0
  fi

  git -C "$ROOT_DIR" fetch --force --depth=1 origin "refs/tags/$STABLE_REF:refs/tags/$STABLE_REF" >/dev/null 2>&1 ||
    fail "stable ref is unavailable and could not be fetched: $STABLE_REF"
}

prepare_stable_repo() {
  if [ -n "$STABLE_REPO" ]; then
    if [ ! -r "$STABLE_REPO/forkop/files/etc/config/forkop" ] &&
      [ ! -r "$STABLE_REPO/$LEGACY_STEM/files/etc/config/$LEGACY_STEM" ]; then
      fail "stable repo is missing the expected config template: $STABLE_REPO"
    fi
    return 0
  fi

  ensure_stable_ref
  STABLE_REPO="$WORK_DIR/stable-$STABLE_REF"
  mkdir -p "$STABLE_REPO"
  git -C "$ROOT_DIR" archive "$STABLE_REF" | tar -x -C "$STABLE_REPO" ||
    fail "failed to materialize stable baseline: $STABLE_REF"
}

prepare_stable_repo

node "$MATRIX_SCRIPT" --current "$ROOT_DIR" --stable "$STABLE_REPO" >"$WORK_DIR/matrix.json"

node - "$WORK_DIR/matrix.json" <<'NODE'
const fs = require("fs");
const matrix = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const retiredMissingCurrent = new Set([
  "conffile",
  // Never written by the released UI or shipped template; the stable baseline
  // only read it inside the unreferenced NFT text diagnostic that Forkop dropped.
  "domain_list_enabled",
  "local_domain_lists",
  "log_stderr",
  "remote_domain_lists",
  "remote_subnet_lists",
  // podkop names the per-section user domain list with these three. Forkop never
  // routed by them: the only reader was the Zapret runtime signature, which went
  // with the DPI actions, so nothing in the current schema looks at them.
  "user_domain_list_type",
  "user_domains",
  "user_domains_text",
  "urltest_exclude_countries",
  "urltest_hide_filtered_outbounds",
  "urltest_include_countries",
  "workdir",
]);
const missing = matrix.fields.filter((field) => field.status === "missing_current" && !retiredMissingCurrent.has(field.name));
if (missing.length) {
  fail(`stable config fields missing in current contract: ${missing.map((field) => field.name).join(", ")}`);
}

for (const name of ["dns_type", "subscription_urls", "selector_proxy_links", "action", "protocol", "transport", "security", "rule_set", "rule_set_with_subnets", "fully_routed_ips", "server_uuid", "tailscale_auth_key"]) {
  const field = matrix.fields.find((item) => item.name === name);
  if (!field) fail(`expected config field is absent from matrix: ${name}`);
  if (field.status !== "supported" && field.status !== "migrated") {
    fail(`expected config field ${name} to be supported or migrated, got ${field.status}`);
  }
}

if ((matrix.summary.supported || 0) < 135) {
  fail(`unexpectedly small supported config surface: ${matrix.summary.supported || 0}`);
}

if (matrix.stable.version !== "0.7.19.9") {
  fail(`unexpected stable baseline: ${matrix.stable.version}`);
}

function uiValues(field) {
  const result = new Set();
  for (const entry of field?.ui || []) {
    for (const value of entry.values || []) {
      result.add(value);
    }
  }
  return [...result].sort();
}

function assertCurrentKeepsStableValues(name, required = [], retired = []) {
  const field = matrix.fields.find((item) => item.name === name);
  if (!field) fail(`expected enum field is absent from matrix: ${name}`);

  const stableValues = uiValues(field.stable);
  const currentValues = uiValues(field.current);
  const missingStable = stableValues.filter((value) => !currentValues.includes(value) && !retired.includes(value));
  if (missingStable.length) {
    fail(`current UI contract for ${name} is missing stable values: ${missingStable.join(", ")}`);
  }

  const missingRequired = required.filter((value) => !currentValues.includes(value));
  if (missingRequired.length) {
    fail(`current UI contract for ${name} is missing required values: ${missingRequired.join(", ")}`);
  }
}

assertCurrentKeepsStableValues("action", ["connection", "bypass", "block", "dns"], ["direct", "proxy", "vpn", "outbound", "zapret", "zapret2", "byedpi"]);
// The SOCKS inbound became the mixed inbound, which answers SOCKS5 and HTTP on one
// port with the same accounts; migration rewrites the stored protocol.
assertCurrentKeepsStableValues("protocol", ["tailscale", "vless", "vmess", "trojan", "shadowsocks", "hysteria2", "mixed", "mtproto", "naive", "ssh", "mieru", "anytls", "tuic", "json_inbound"], ["socks"]);
assertCurrentKeepsStableValues("security", ["reality", "tls", "none"]);
assertCurrentKeepsStableValues("transport", ["tcp", "ws", "grpc", "http", "httpupgrade", "xhttp"]);
assertCurrentKeepsStableValues("routing_mode", ["rules", "direct", "section"]);
assertCurrentKeepsStableValues("shadowsocks_method", ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"]);
// VLESS flow is a per-client value now, so it is checked with the client editor in
// tests/luci_server_protocols.sh instead of as a server option.
assertCurrentKeepsStableValues("transport_xhttp_mode", ["auto", "packet-up", "stream-up", "stream-one"]);
NODE

printf 'config contract matrix checks passed\n'
