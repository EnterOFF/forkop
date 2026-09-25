#!/usr/bin/env bash
set -eo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
export FORKOP_DEFAULT_CONFIG_PATH="$FORKOP_FILES/etc/config/forkop"

node - "$WORK_DIR" <<'NODE'
const fs = require('fs');
const dir = process.argv[2];
const outbounds = [
  { type: 'openvpn', tag: 'Office', servers: [{ server: 'vpn.example', server_port: 1194 }], proto: 'udp', username: 'alice', password: ' secret ', auth: 'SHA256', tls: { ca: 'CA', certificate: 'CERT', key: 'KEY', verify_x509_name: 'server', verify_x509_name_mode: 'name-prefix' }, tls_auth: 'CONTROL', key_direction: 1 },
  { type: 'snell', tag: 'Snell', version: 4, server: 'snell.example', server_port: 443, psk: 'psk', obfs: { mode: 'http', host: 'cdn.example' } },
];
const fixture = { settings: { '.name': 'settings', '.type': 'settings', config_version: '1.0.5' }, section: [{ '.name': 'main', '.type': 'section', action: 'connection', outbound_jsons: outbounds.map(o => JSON.stringify(o)) }] };
outbounds[0].cipher = 'AES-256-CBC';
fixture.section[0].outbound_jsons = outbounds.map(o => JSON.stringify(o));
fs.writeFileSync(`${dir}/released.json`, JSON.stringify(fixture));
const singular = structuredClone(fixture);
singular.section[0].action = 'outbound';
singular.section[0].outbound_json = JSON.stringify(outbounds[0]);
delete singular.section[0].outbound_jsons;
fs.writeFileSync(`${dir}/singular.json`, JSON.stringify(singular));
const unsupported = structuredClone(singular);
unsupported.section[0].outbound_json = JSON.stringify({ ...outbounds[0], system: true });
fs.writeFileSync(`${dir}/unsupported.json`, JSON.stringify(unsupported));
fixture.settings.config_version = 'NEXT';
fs.writeFileSync(`${dir}/dev.json`, JSON.stringify(fixture));
NODE

for source in released dev singular unsupported; do
  if ! ucode -L "$FORKOP_LIB" "$FORKOP_LIB/config/migration.uc" migrate-fixture "$WORK_DIR/$source.json" >"$WORK_DIR/$source.out.json" 2>"$WORK_DIR/$source.log"; then
    [ "$source" = unsupported ] || fail "Unexpected migration failure: $source"
  fi
done
node - "$WORK_DIR" <<'NODE'
const fs = require('fs'), assert = require('assert/strict');
const dir = process.argv[2];
const load = name => JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
const migrated = load('released.out');
assert.equal(migrated.error, undefined);
assert.equal(migrated.config.tunnel.length, 1);
const tunnel = migrated.config.tunnel[0];
assert.equal(tunnel.kind, 'openvpn-client');
assert.equal(tunnel.section, 'main');
const endpoint = JSON.parse(tunnel.endpoint_json);
assert.equal(endpoint.password, ' secret ');
assert.equal(endpoint.network, 'udp');
assert.equal(endpoint.cipher, undefined);
assert.equal(endpoint.data_ciphers_fallback, 'AES-256-CBC');
assert.equal(endpoint.tls.certificate, 'CA');
assert.equal(endpoint.tls.client_certificate, 'CERT');
assert.equal(endpoint.tls.client_key, 'KEY');
assert.equal(endpoint.tls.server_name_type, 'name-prefix');
assert.deepEqual(endpoint.tls.control_wrap, { type: 'tls_auth', key: 'CONTROL', direction: 'client' });
const snell = JSON.parse(migrated.config.section[0].outbound_jsons[0]);
assert.equal(snell.obfs, undefined);
assert.equal(snell.obfs_mode, 'http');
assert.equal(snell.obfs_host, 'cdn.example');
const dev = load('dev.out');
assert.equal(dev.changed, false);
assert.deepEqual(dev.config.section, load('dev').section);
assert.equal(dev.config.tunnel, undefined);
const singular = load('singular.out');
assert.equal(singular.error, undefined);
assert.equal(singular.config.section[0].action, 'connection');
assert.equal(singular.config.section[0].outbound_json, undefined);
assert.equal(singular.config.tunnel[0].kind, 'openvpn-client');
assert.match(fs.readFileSync(`${dir}/unsupported.log`, 'utf8'), /section 'main'.*outbound_json.*system/);
NODE
printf 'public native protocol migration checks passed; dev schema untouched\n'
