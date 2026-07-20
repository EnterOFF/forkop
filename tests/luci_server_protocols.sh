#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/server.js"
FORKOP_JS="$ROOT_DIR/luci-app-forkop/htdocs/luci-static/resources/view/forkop/forkop.js"
FE_SRC="$ROOT_DIR/fe-app-forkop/src"

node - "$SERVER_JS" "$FORKOP_JS" <<'NODE'
const fs = require("fs");
const source = fs.readFileSync(process.argv[2], "utf8");
const entrySource = fs.readFileSync(process.argv[3], "utf8");

function requireSource(needle) {
  if (!source.includes(needle)) {
    console.error(`FAIL: missing server UI contract: ${needle}`);
    process.exit(1);
  }
}

for (const protocol of ["naive", "ssh", "mieru", "anytls", "tuic"]) {
  requireSource(`${protocol}:`);
  requireSource(`depends("protocol", "${protocol}")`);
}

for (const option of [
  "naive_network",
  "ssh_host_key_path",
  "mieru_transport",
  "tuic_congestion_control",
  "tuic_zero_rtt_handshake",
]) {
  requireSource(`"${option}"`);
}

for (const protocol of ["naive", "anytls", "tuic"]) {
  requireSource(`${protocol}: ["tls"]`);
}

requireSource('option.depends("protocol", "tailscale")');

for (const legacy of [
  "singBoxExtended",
  "singBoxTiny",
  "singBoxTailscale",
  "normalizeServerCapabilities",
  "getDefaultProtocolForCapabilities",
  "applyServerCapabilities",
  "getServerCapabilities",
  "EXTENDED_PORT_PROTOCOLS",
  "mtproto_padding",
]) {
  if (source.includes(legacy) || entrySource.includes(legacy)) {
    console.error(`FAIL: legacy sing-box capability branch remains: ${legacy}`);
    process.exit(1);
  }
}
NODE

if grep -R -n -E 'singBoxVariant|sing_box_(extended|tiny|tailscale)|GET_SERVER_CAPABILITIES|GetServerCapabilities|Install another build|startsWith\(.install_' \
  "$FE_SRC" >/dev/null 2>&1; then
  printf 'FAIL: frontend still contains legacy sing-box variant code\n' >&2
  exit 1
fi

printf 'LuCI native server protocol checks passed\n'
