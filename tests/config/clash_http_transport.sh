#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
CLASH_HTTP_UC="$ROOT_DIR/forkop/files/usr/lib/singbox/clash_http.uc"

fake_bin="$WORK_DIR/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/curl" <<'SH'
#!/usr/bin/env sh
printf '%s\n' "$*" >>"$FAKE_CURL_LOG"
status_format=""
url=""
method="GET"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -w) status_format="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    http://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [ "$method" = "GET" ]; then
  case "$url" in
    *'/providers/proxies') body='{"providers":{}}' ;;
    *'/proxies/provider%2Fnode/link') body='{"url":"vless://id@example.com:443"}' ;;
    *'/proxies') body='{"proxies":{"proxy-a":{"type":"VLESS"}}}' ;;
    *'/connections') body='{"downloadTotal":10,"uploadTotal":20,"memory":30,"connections":[{"id":"a","metadata":{}},{"id":"b","metadata":{}}]}' ;;
    *'/delay'*) body='{"delay":1}' ;;
    *) body='{}' ;;
  esac
else
  body=''
fi
printf '%s' "$body"
printf '%s' "$status_format" | sed 's/%{http_code}/204/'
SH
chmod +x "$fake_bin/curl"
uci_state="$WORK_DIR/uci-state.txt"
cat >"$uci_state" <<'EOF'
forkop.settings=settings
forkop.settings.latency_test_url=https://latency.example/generate_204
forkop.settings.yacd_secret_key=local-secret
EOF

clash_http() {
  FAKE_CURL_LOG="$1" \
  FORKOP_UCI_STATE_FILE="$uci_state" \
  FORKOP_LIB="$FORKOP_LIB" \
  PATH="$fake_bin:$PATH" \
    ucode -L "$FORKOP_LIB" "$CLASH_HTTP_UC" request "$2" "$3" "${4-}"
}

link_response="$(clash_http "$WORK_DIR/fake-link-curl.log" GET '/proxies/provider%2Fnode/link')" ||
  fail "the transport must return an allowlisted read through curl"
JSON_VALUE="$link_response" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.status !== 204) process.exit(1);
if (JSON.parse(value.body).url !== 'vless://id@example.com:443') process.exit(1);
NODE
grep -Fq '/proxies/provider%2Fnode/link' "$WORK_DIR/fake-link-curl.log" ||
  fail "proxy links must be requested from the native per-outbound endpoint"
grep -Fq 'Authorization: Bearer local-secret' "$WORK_DIR/fake-link-curl.log" ||
  fail "local Clash API calls must authenticate whenever the generated API has a secret"
grep -Fq -- '--path-as-is' "$WORK_DIR/fake-link-curl.log" ||
  fail "the transport must not let curl normalize an allowlisted path"

clash_http "$WORK_DIR/fake-provider-curl.log" GET '/providers/proxies' >/dev/null ||
  fail "the transport must reach the native provider endpoint"
grep -Fq '/providers/proxies' "$WORK_DIR/fake-provider-curl.log" ||
  fail "provider dashboard data must come from the native provider API"

clash_http "$WORK_DIR/fake-delay-curl.log" GET \
  '/proxies/proxy-out/delay?url=https%3A%2F%2Flatency.example%2Fgenerate_204&timeout=5000' >/dev/null ||
  fail "the transport must forward an allowlisted latency probe"
grep -Fq 'timeout=5000' "$WORK_DIR/fake-delay-curl.log" ||
  fail "the transport must forward the caller latency query untouched"

set_group_response="$(clash_http "$WORK_DIR/fake-put-curl.log" PUT '/proxies/main-out' '{"name":"main-1-out"}')" ||
  fail "the transport must forward an allowlisted selector change"
grep -Fq -- '-X PUT' "$WORK_DIR/fake-put-curl.log" ||
  fail "the transport must preserve the requested HTTP method"
grep -Fq 'Content-Type: application/json' "$WORK_DIR/fake-put-curl.log" ||
  fail "the transport must send a JSON body with a JSON content type"
JSON_VALUE="$set_group_response" node - <<'NODE'
const value = JSON.parse(process.env.JSON_VALUE);
if (value.status !== 204 || value.body !== '') process.exit(1);
NODE

clash_http "$WORK_DIR/fake-rules-curl.log" PUT '/providers/rules' >/dev/null ||
  fail "the transport must forward an allowlisted rule-set refresh"
grep -Fq '/providers/rules' "$WORK_DIR/fake-rules-curl.log" ||
  fail "rule-set refreshes must reach the native rule provider collection"

clash_http "$WORK_DIR/fake-delete-curl.log" DELETE '/connections/abc-123' >/dev/null ||
  fail "the transport must forward an allowlisted connection close"
grep -Fq -- '-X DELETE' "$WORK_DIR/fake-delete-curl.log" ||
  fail "the transport must preserve a DELETE method"

: >"$WORK_DIR/fake-rejected-curl.log"
for rejected in \
  'GET|/configs|' \
  'PUT|/configs|{"mode":"global"}' \
  'POST|/proxies|{"name":"main-1-out"}' \
  'GET|/proxies/../configs|' \
  'PUT|/proxies/main-out|{"name":"main-1-out","extra":1}' \
  'PUT|/proxies/main-out|not-json' \
  'GET|/proxies/main-out/delay?url=x&timeout=abc|' \
  'DELETE|/connections|{"all":true}' \
  'PUT|/providers/rules|{"name":"geosite"}' \
  'PUT|/providers/rules/geosite%2Fextra|'
do
  method="${rejected%%|*}"
  rest="${rejected#*|}"
  path="${rest%%|*}"
  body="${rest#*|}"
  if clash_http "$WORK_DIR/fake-rejected-curl.log" "$method" "$path" "$body" >/dev/null 2>&1; then
    fail "the transport must reject $method $path"
  fi
done
[ ! -s "$WORK_DIR/fake-rejected-curl.log" ] ||
  fail "the transport must reject a request before it reaches the controller"

# The controller address is whatever the generated configuration told sing-box to
# bind, because that is the socket it is actually listening on. Asking the
# sing-box runtime module to recompute it cost a second ucode process on every
# request, and after a LAN address change it would answer with an address the
# running core never bound.
endpoint() {  # <external_controller value, or empty for no clash_api>
  local config="$WORK_DIR/endpoint-config.json"
  local state="$WORK_DIR/endpoint-uci.state"
  if [ -n "$1" ]; then
    printf '{"experimental":{"clash_api":{"external_controller":"%s"}}}\n' "$1" >"$config"
  else
    printf '{"experimental":{}}\n' >"$config"
  fi
  printf 'forkop.settings=settings\nforkop.settings.config_path=%s\n' "$config" >"$state"
  FORKOP_UCI_STATE_FILE="$state" \
    ucode -L "$FORKOP_LIB" "$CLASH_HTTP_UC" controller-endpoint-fixture "$config"
}

[ "$(endpoint '192.168.1.1:9090')" = '192.168.1.1:9090' ] ||
  fail "the transport must dial the address the configuration bound"
# A wildcard is what the controller binds, not somewhere to connect to.
[ "$(endpoint '0.0.0.0:9090')" = '127.0.0.1:9090' ] ||
  fail "a wildcard controller must be reached over the loopback"
[ "$(endpoint '[::]:9090')" = '127.0.0.1:9090' ] ||
  fail "an IPv6 wildcard controller must be reached over the loopback"
[ "$(endpoint '[fd00::1]:9090')" = '[fd00::1]:9090' ] ||
  fail "a bracketed IPv6 controller must keep its brackets and port"
[ "$(endpoint '')" = '127.0.0.1:9090' ] ||
  fail "a configuration without a controller must fall back to the loopback"

# The Dashboard widgets read four numbers out of a snapshot that carries every
# open connection, and rpcd refuses a reply past about 256KB. The router narrows
# it so the page never has to carry the list it would discard.
summary="$(FAKE_CURL_LOG="$WORK_DIR/fake-summary-curl.log" \
  FORKOP_UCI_STATE_FILE="$uci_state" \
  FORKOP_LIB="$FORKOP_LIB" \
  PATH="$fake_bin:$PATH" \
    ucode -L "$FORKOP_LIB" "$CLASH_HTTP_UC" summary)" ||
  fail "the transport must answer a connections summary"
case "$summary" in
  *downloadTotal*10*uploadTotal*20*memory*30*connections*2*) ;;
  *) fail "the summary must carry the totals and the connection count, got: $summary" ;;
esac
case "$summary" in
  *metadata*) fail "the summary must not carry the connection list it exists to drop" ;;
  *) ;;
esac
grep -Fq -- '-X GET' "$WORK_DIR/fake-summary-curl.log" ||
  fail "the summary must read the connections snapshot over the same transport"

printf 'Clash API transport checks passed\n'
