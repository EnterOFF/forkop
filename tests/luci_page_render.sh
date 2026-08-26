#!/usr/bin/env bash
# Renders the whole Forkop page out of the shipped bundle, once, and asserts that
# it declares every tab and writes nothing.
#
# Every other LuCI check here builds one tab at a time, which is how the page was
# reachable at all while it was eight view modules. It is one entry now -
# view/forkop/forkop.js hands ForkopView to view.extend() - so a page that throws
# on the way up takes every tab with it, and nothing else exercises that path.
#
# A plain page load must not write: LuCI keeps whatever load() returned as an
# option's stored value, so a value the page invents while rendering compares
# unequal on the next save and reaches the config without anyone asking.
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# One section per action, a server with an account, a tunnel with a peer, and the
# settings section: enough that every tab has something to render.
cat >"$WORK_DIR/uci.json" <<'JSON'
{
  "values": {
    "settings": { ".type": "settings", "dns_server": ["tls://77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"], "config_path": "/etc/sing-box/config.json", "cache_path": "/tmp/sing-box/cache.db", "log_level": "warn", "latency_test_url": "https://www.gstatic.com/generate_204", "source_network_interfaces": ["br-lan"] },
    "block_rule": { ".type": "section", "enabled": "1", "action": "block", "label": "Block", "community_lists": ["ads_hagezi_pro"] },
    "bypass_rule": { ".type": "section", "enabled": "1", "action": "bypass", "label": "Bypass", "domain": "example.com" },
    "dns_rule": { ".type": "section", "enabled": "1", "action": "dns", "label": "DNS", "dns_server": "tls://1.1.1.1" },
    "proxy_rule": { ".type": "section", "enabled": "1", "action": "connection", "label": "Proxy", "selector_proxy_links": ["vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=tls#node"], "routing_mode": "rules" },
    "tun_a1b2c3": { ".type": "tunnel", "section": "proxy_rule", "kind": "wireguard", "name": "wg", "private_key": "wIWKZmAoiFsYIPFCwG8FRPHKn0P6PLh0hbBjPfKgpU0=", "address": ["10.8.0.2/32"], "mtu": "1420", "order": "0" },
    "peer_a1b2c3": { ".type": "tunnel_peer", "tunnel": "tun_a1b2c3", "address": "example.com", "port": "51820", "public_key": "SSw7I859PPdN4DQ7fxV9fobXM61Ms3mqZRlIY1aJvHQ=", "allowed_ips": ["0.0.0.0/0"], "order": "0" },
    "urltest_a1b2c3": { ".type": "urltest", "section": "proxy_rule", "name": "URLTest", "check_interval": "3m", "tolerance": "50", "testing_url": "https://www.gstatic.com/generate_204", "expected_status": "*", "server_filter_mode": "all" },
    "group_a1b2c3": { ".type": "fallback_group", "section": "proxy_rule", "name": "Fallback", "health_check_url": "https://www.gstatic.com/generate_204", "health_check_interval": "5m", "health_check_timeout": "5s", "max_failed_times": "5", "expected_status": "*", "idle_timeout": "5m" },
    "level_a1b2c3": { ".type": "fallback_level", "group": "group_a1b2c3", "name": "Group #1", "order": "0", "server_filter_mode": "direct" },
    "sub_a1b2c3": { ".type": "subscription_url", "section": "proxy_rule", "url": "https://example.com/sub", "tag": "sub1", "server_filter_mode": "all", "subscription_update_enabled": "1", "subscription_update_interval": "1h" },
    "server_a1b2c3": { ".type": "server", "label": "Server #1", "enabled": "1", "protocol": "mixed", "listen": "0.0.0.0", "listen_port": "30000", "public_host": "192.168.1.1", "security": "none", "mixed_auth_enabled": "1", "routing_mode": "rules" },
    "client_a1b2c3": { ".type": "server_client", "server": "server_a1b2c3", "name": "client-1", "password": "Ux-2LP-vrTXCc1wxJt5QUUvK" }
  }
}
JSON

# The page logs what its services are doing; only the verdict is wanted here,
# and the whole log if the verdict is a failure.
if ! ROOT_DIR="$ROOT_DIR" SNAPSHOT="$WORK_DIR/uci.json" node - >"$WORK_DIR/out" 2>&1 <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.env.ROOT_DIR;
const { createHarness } = require(path.join(root, 'tests/helpers/luci_form.js'));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

(async () => {
  const harness = createHarness(root);
  const data = JSON.parse(fs.readFileSync(process.env.SNAPSHOT, 'utf8')).values;
  for (const [sid, section] of Object.entries(data)) {
    harness.uci.add('forkop', section['.type'], sid);
    const target = harness.store.get(sid);
    for (const [key, value] of Object.entries(section)) {
      if (key.startsWith('.')) continue;
      target[key] = Array.isArray(value) ? value.slice() : value;
    }
  }
  harness.operations.length = 0;

  const view = harness.bundle.ForkopView;
  if (!view || typeof view.render !== 'function') {
    fail('the bundle must export a renderable ForkopView');
  }

  const rendered = await view.render();
  if (!rendered) {
    fail('ForkopView.render() answered with nothing');
  }

  if (harness.operations.length) {
    console.error('FAIL: rendering the page wrote to the configuration:');
    harness.operations.forEach((op) => console.error(`  ${op}`));
    process.exit(1);
  }

  // Every tab the page is made of, by the section type it hangs off. A tab that
  // stops being declared disappears from the interface without any error.
  const declared = harness.form.Map.declaredSectionTypes || [];
  const expected = [
    'section',
    'server',
    'settings',
    'diagnostic',
    'dashboard',
    'monitoring',
    'logs',
    'updates',
  ];
  const missing = expected.filter((type) => !declared.includes(type));
  if (missing.length) {
    fail(`the page did not declare: ${missing.join(', ')}`);
  }
  if (declared.join(',') !== expected.join(',')) {
    fail(`unexpected tab order: ${declared.join(', ')}`);
  }

  console.log(`the page rendered ${declared.length} tabs and wrote nothing`);
  // The page starts its polling services on the way out, and those keep the
  // process alive; the render is what this asks about.
  process.exit(0);
})().catch((error) => {
  console.error(`FAIL: ForkopView.render() threw: ${error && error.stack}`);
  process.exit(1);
});
NODE
then
  cat "$WORK_DIR/out" >&2
  exit 1
fi
grep -v '^\[' "$WORK_DIR/out" || true

printf 'LuCI page render checks passed\n'
