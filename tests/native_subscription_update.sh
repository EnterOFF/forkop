#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cat >"$WORK_DIR/uci.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.yacd_secret_key=test-secret
forkop.settings.service_listen_address=192.0.2.1
forkop.proxy=section
forkop.proxy.enabled=1
forkop.proxy.action=connection
forkop.source_one=subscription_url
forkop.source_one.section=proxy
forkop.source_one.url=https://example.com/one
forkop.source_two=subscription_url
forkop.source_two.section=proxy
forkop.source_two.url=https://example.com/two
EOF_UCI

mkdir -p "$WORK_DIR/bin"
cat >"$WORK_DIR/bin/curl" <<'EOF_CURL'
#!/bin/sh
printf '%s\n' "$*" >>"$CURL_LOG"
[ "${CURL_FAIL:-0}" != 1 ]
EOF_CURL
chmod +x "$WORK_DIR/bin/curl"

cat >"$WORK_DIR/bin/logger" <<'EOF_LOGGER'
#!/bin/sh
printf '%s\n' "$*" >>"$LOGGER_LOG"
EOF_LOGGER
chmod +x "$WORK_DIR/bin/logger"

PATH="$WORK_DIR/bin:$PATH" \
CURL_LOG="$WORK_DIR/curl.log" \
FORKOP_UCI_STATE_FILE="$WORK_DIR/uci.state" \
ucode -L "$FORKOP_LIB" "$FORKOP_LIB/components/updates.uc" subscription-update proxy 2

expected='-fsS -X PUT http://192.0.2.1:9090/providers/proxies/proxy%2Fsub2 -H Authorization: Bearer test-secret'
actual="$(cat "$WORK_DIR/curl.log")"
if [[ "$actual" != "$expected" ]]; then
  printf 'FAIL: native provider update request: expected %q, got %q\n' "$expected" "$actual" >&2
  exit 1
fi

if PATH="$WORK_DIR/bin:$PATH" \
  CURL_FAIL=1 \
  CURL_LOG="$WORK_DIR/curl.log" \
  LOGGER_LOG="$WORK_DIR/logger.log" \
  FORKOP_UCI_STATE_FILE="$WORK_DIR/uci.state" \
  ucode -L "$FORKOP_LIB" "$FORKOP_LIB/components/updates.uc" subscription-update proxy 2; then
  printf 'FAIL: failed native provider update returned success\n' >&2
  exit 1
fi
grep -Fq 'Failed to refresh subscription provider proxy/sub2' "$WORK_DIR/logger.log" || {
  printf 'FAIL: failed native provider update did not identify its provider\n' >&2
  exit 1
}
printf 'native subscription update tests passed\n'
