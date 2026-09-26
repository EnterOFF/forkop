#!/usr/bin/env bash
set -eo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

node - "$WORK_DIR" <<'NODE'
const fs = require('fs');
const dir = process.argv[2];
const endpoint = {
  type: 'openvpn-client', mode: 'static_key', server: '127.0.0.1', server_port: 1194,
  network: 'udp', address: ['10.44.0.2/30'], peer_address: '10.44.0.1',
  cipher: 'AES-256-CBC', auth: 'SHA256',
  static_key: ['-----BEGIN OpenVPN Static key V1-----', ...Array(16).fill('0123456789abcdef0123456789abcdef'), '-----END OpenVPN Static key V1-----'],
  ping_interval: '10s', ping_restart: '60s',
};
const fixture = {
  settings: { '.name': 'settings', '.type': 'settings', dns_server: ['1.1.1.1'], bootstrap_dns_server: ['1.1.1.1'], dns_timeout: '4s', dns_optimistic: '1', dns_optimistic_timeout: '2h', service_listen_address: '127.0.0.1', cache_path: `${dir}/cache.db` },
  section: [{ '.name': 'vpn', '.type': 'section', enabled: '1', action: 'connection', user_domains: 'example.test' }],
  tunnel: [{ '.name': 'openvpn', '.type': 'tunnel', section: 'vpn', kind: 'openvpn-client', name: 'OpenVPN', endpoint_json: JSON.stringify(endpoint) }],
};
fs.writeFileSync(`${dir}/fixture.json`, JSON.stringify(fixture));
fixture.settings.enable_native_api = '1';
fixture.settings.native_api_secret = 'test-secret';
fs.writeFileSync(`${dir}/api.json`, JSON.stringify(fixture));
NODE

if [ -n "${FORKOP_SING_BOX_BIN:-}" ]; then
  generate_config "$WORK_DIR/fixture.json" "$WORK_DIR/config.json"
  "$FORKOP_SING_BOX_BIN" check -c "$WORK_DIR/config.json" >"$WORK_DIR/check.log" 2>&1 || fail "1.14 core rejected generated OpenVPN config: $(tail -1 "$WORK_DIR/check.log")"
  generate_config "$WORK_DIR/api.json" "$WORK_DIR/api-config.json"
  "$FORKOP_SING_BOX_BIN" check -c "$WORK_DIR/api-config.json" >"$WORK_DIR/api-check.log" 2>&1 || fail "1.14 core rejected native API: $(tail -1 "$WORK_DIR/api-check.log")"
fi

printf 'native 1.14 config checks passed\n'
