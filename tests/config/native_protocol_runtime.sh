#!/usr/bin/env bash
set -eo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
if [ -z "${FORKOP_SING_BOX_BIN:-}" ]; then
    printf 'SKIP native protocol runtime: set FORKOP_SING_BOX_BIN to a 1.14 core\n'
    exit 0
fi
node "$TESTS_DIR/lib/native_protocol_fixture.cjs" "$WORK_DIR"
# Exercise the released JSON -> endpoint migration with real TLS credentials,
# then send traffic through its result rather than only inspecting its shape.
node - "$WORK_DIR" <<'NODE'
const fs = require('fs');
const dir = process.argv[2];
const native = JSON.parse(fs.readFileSync(`${dir}/native.json`));
const endpoint = native.endpoints.find(e => e.tag === 'openvpn-tls');
const old = { ...endpoint, type: 'openvpn', proto: endpoint.network, cipher: 'AES-256-CBC', tls: {
  ca: endpoint.tls.certificate, certificate: endpoint.tls.client_certificate,
  key: endpoint.tls.client_key, verify_x509_name: endpoint.tls.server_name,
} };
delete old.network;
fs.writeFileSync(`${dir}/released.json`, JSON.stringify({
  settings: { '.name': 'settings', '.type': 'settings', config_version: '1.0.5' },
  section: [{ '.name': 'vpn', '.type': 'section', action: 'connection', outbound_jsons: [JSON.stringify(old)] }],
}));
NODE
FORKOP_DEFAULT_CONFIG_PATH="$FORKOP_FILES/etc/config/forkop" ucode -L "$FORKOP_LIB" "$FORKOP_LIB/config/migration.uc" migrate-fixture "$WORK_DIR/released.json" > "$WORK_DIR/migrated.json"
node - "$WORK_DIR" <<'NODE'
const fs = require('fs'), assert = require('assert/strict');
const dir = process.argv[2];
const result = JSON.parse(fs.readFileSync(`${dir}/migrated.json`));
assert.equal(result.error, undefined);
const endpoint = JSON.parse(result.config.tunnel[0].endpoint_json);
assert.equal(endpoint.type, 'openvpn-client');
assert.equal(endpoint.cipher, undefined);
const native = JSON.parse(fs.readFileSync(`${dir}/native.json`));
native.endpoints = native.endpoints.map(e => e.tag === 'openvpn-tls' ? endpoint : e);
fs.writeFileSync(`${dir}/native.json`, JSON.stringify(native));
NODE
sh "$TESTS_DIR/lib/native_protocol_runtime.sh" "$FORKOP_SING_BOX_BIN" "$WORK_DIR"
