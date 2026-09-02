#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

MIGRATION="$FORKOP_LIB/config/migration.uc"
DEFAULT_CONFIG="$FORKOP_FILES/etc/config/forkop"
export FORKOP_DEFAULT_CONFIG_PATH="$DEFAULT_CONFIG"

grep -Fq 'require("core.uci")' "$MIGRATION" ||
  fail "runtime migration must write through the shared core.uci owner"
if grep -Fq 'require("uci")' "$MIGRATION" || grep -Fq 'uci.cursor(' "$MIGRATION"; then
  fail "runtime migration must not create a second UCI owner"
fi
grep -Fq 'uci -q show' "$MIGRATION" ||
  fail "runtime migration must preflight the real parser for line-specific syntax errors"
grep -Fq './files/etc/config/forkop $(1)/usr/share/forkop/default-config' "$ROOT_DIR/forkop/Makefile" ||
  fail "OpenWrt packages must carry the canonical reset configuration"
grep -Fq 'usr/share/forkop/default-config' "$ROOT_DIR/build.sh" ||
  fail "standalone IPK/APK packages must carry the canonical reset configuration"

cat >"$WORK_DIR/full-1.0.2.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings", "config_version": "1.0.2",
    "applied_migrations": ["interface_sections", "enable_component_checks"],
    "dns_type": "doh",
    "dns_server": ["dns.google/dns-query", "1.1.1.1:444/custom"],
    "bootstrap_dns_server": ["1.1.1.1", "[2606:4700:4700::1111]:5353"],
    "dns_check_interval": "10s", "dns_recovery_check_interval": "60s", "dns_check_timeout": "2s",
    "dont_touch_dhcp": "1", "shutdown_correctly": "0",
    "dns_detour_enabled": "1", "dns_detour_section": "zap",
    "download_lists_via_proxy": "1", "download_lists_via_proxy_section": "zap"
  },
  "section": [
    {
      ".name": "main", ".type": "section", "label": "Main/Primary", "enabled": "1", "action": "connection",
      "domain_ip_lists": ["existing"], "local_domain_lists": ["local"],
      "remote_domain_lists": ["remote-domain"], "remote_subnet_lists": ["remote-subnet"],
      "dashboard_filter_mode": "include", "dashboard_detect_server_country": "1",
      "dashboard_include_countries": ["DE"], "dashboard_include_outbounds": ["Primary"],
      "dashboard_include_regex": ["primary"], "dashboard_include_proxy_parameters": ["grpc"],
      "dashboard_include_protocols": ["vless"], "dashboard_include_transports": ["ws"],
      "dashboard_include_securities": ["tls"], "dashboard_include_groups": ["Fastest"],
      "dashboard_exclude_countries": ["US"], "dashboard_exclude_outbounds": ["Backup"],
      "dashboard_exclude_regex": ["backup"], "dashboard_exclude_proxy_parameters": ["grpc"],
      "dashboard_exclude_protocols": ["trojan"], "dashboard_exclude_transports": ["grpc"],
      "dashboard_exclude_securities": ["reality"], "dashboard_exclude_groups": ["Backup"],
      "detect_server_country": "1",
      "include_urltest_groups": "1", "hide_urltest_group_outbounds": "1", "hide_detour_outbounds": "1",
      "include_proxy_parameters": ["grpc"], "include_protocols": ["vless"],
      "include_transports": ["ws"], "include_securities": ["tls"],
      "exclude_proxy_parameters": ["udp"], "exclude_protocols": ["trojan"],
      "exclude_transports": ["grpc"], "exclude_securities": ["reality"],
      "urltest_exclude_proxy_parameters": ["ws"], "urltest_include_protocols": ["vless"],
      "sort_by_latency": "1", "resolve_real_ip_for_routing": "1",
      "mixed_proxy_enabled": "1", "mixed_proxy_port": "2080", "mixed_proxy_auth_enabled": "1",
      "mixed_proxy_username": "Ivan Petrov", "mixed_proxy_password": "proxy-secret",
      "outbound_detour_enabled": "1", "outbound_detour_section": "zap"
    },
    {
      ".name": "dns_rule", ".type": "section", "label": "DNS", "action": "dns",
      "dns_type": "dot", "dns_server": "9.9.9.9:5353",
      "domain_ip_lists": ["dns-existing"], "remote_domain_lists": ["dns-remote"],
      "domain_suffix": ["example.org"]
    },
    {
      ".name": "zap", ".type": "section", "label": "Zapret", "enabled": "1", "action": "zapret",
      "nfqws_opt": "--filter-tcp=443", "domain_list_enabled": "1", "domain_list": ["hetzner"],
      "user_domain_list_type": "text", "user_domains": "example.org", "user_domains_text": "example.net"
    },
    {
      ".name": "zap2", ".type": "section", "label": "Zapret2", "enabled": "1", "action": "zapret2",
      "nfqws2_opt": "--filter-tcp=443"
    },
    {
      ".name": "bye", ".type": "section", "label": "ByeDPI", "enabled": "1", "action": "byedpi",
      "byedpi_cmd_opts": "--auto=t,r,a,s"
    }
  ],
  "subscription_url": [
    {
      ".name": "sub", ".type": "subscription_url", "section": "main", "url": "https://sub.example",
      "auto_user_agent": "0", "user_agent": "Custom Agent", "auto_hwid": "0", "hwid": "CUSTOM-HWID",
      "filter_mode": "include", "include_countries": ["DE"], "include_proxy_parameters": ["grpc"],
      "include_protocols": ["vless"], "include_transports": ["ws"], "include_securities": ["tls"],
      "exclude_protocols": ["trojan"], "exclude_transports": ["grpc"], "exclude_securities": ["reality"],
      "include_urltest_groups": "1", "hide_urltest_group_outbounds": "1",
      "node_prefix": "Premium", "prefix_nodes": "1"
    },
    {".name":"zap_sub", ".type":"subscription_url", "section":"zap", "url":"https://zap.example"}
  ],
  "section_interface": [
    {
      ".name": "iface", ".type": "section_interface", "section": "main", "name": "awg0",
      "domain_resolver_dns_type": "doh", "domain_resolver_dns_server": "dns.example/dns-query",
      "domain_resolver_dns_detour_enabled": "1", "domain_resolver_dns_detour_section": "zap"
    }
  ],
  "urltest": [
    {
      ".name": "fast", ".type": "urltest", "section": "main", "name": "Fast",
      "filter_mode": "include", "include_countries": ["NL"], "detect_server_country": "1",
      "exclude_countries": ["US"], "include_proxy_parameters": ["grpc"],
      "include_protocols": ["vless"], "include_transports": ["ws"], "include_securities": ["tls"],
      "exclude_proxy_parameters": ["udp"], "exclude_protocols": ["trojan"],
      "exclude_transports": ["grpc"], "exclude_securities": ["reality"],
      "hide_added_outbounds": "1", "pin_dashboard": "1", "interrupt_exist_connections": "1"
    }
  ],
  "priority_group": [
    {
      ".name": "group", ".type": "priority_group", "section": "main", "name": "Fallback",
      "health_url": "https://example.com/ping", "active_check_interval": "30s",
      "check_timeout": "2s", "recovery_check_interval": "60s", "pick_fastest": "1",
      "switch_to_faster_same_priority": "1", "fastest_check_interval": "5s",
      "hide_added_outbounds": "1", "pin_dashboard": "1", "interrupt_exist_connections": "1"
    }
  ],
  "priority_level": [
    {
      ".name": "level", ".type": "priority_level", "group": "group", "name": "Direct", "order": "0",
      "direct": "1", "country": "US", "detect_server_country": "1", "include_proxy_parameters": ["grpc"]
    }
  ],
  "server": [
    {
      ".name": "vless", ".type": "server", "label": "VLESS", "protocol": "vless",
      "server_uuid": "44444444-4444-4444-8444-444444444444", "vless_flow": "xtls-rprx-vision",
      "reality_handshake_server": "www.apple.com", "reality_handshake_server_port": "8443",
      "reality_max_time_difference": "1m"
    },
    {
      ".name": "socks", ".type": "server", "label": "SOCKS", "protocol": "socks",
      "socks_auth_enabled": "0", "server_username": "Ivan Petrov", "server_password": "socks-secret"
    },
    {
      ".name": "ss2022", ".type": "server", "label": "SS 2022", "protocol": "shadowsocks",
      "shadowsocks_method": "2022-blake3-aes-128-gcm", "server_password": "ajXWye37k0IsLRrpEhB3pA=="
    },
    {
      ".name": "mtproto", ".type": "server", "label": "MTProto", "protocol": "mtproto",
      "mtproto_secret": "eeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa676f6f676c652e636f6d",
      "mtproto_padding": "1", "mtproto_concurrency": "1024", "mtproto_idle_timeout": "5m",
      "mtproto_domain_fronting_ip": "1.1.1.1", "mtproto_domain_fronting_port": "443",
      "mtproto_domain_fronting_proxy_protocol": "1", "mtproto_prefer_ip": "prefer-ipv4",
      "mtproto_auto_update": "1", "mtproto_allow_fallback_on_unknown_dc": "1",
      "mtproto_tolerate_time_skewness": "3s", "mtproto_handshake_timeout": "10s"
    },
    {
      ".name": "legacy_user", ".type": "server", "label": "Legacy", "protocol": "vless",
      "server_users": ["phone|55555555-5555-4555-8555-555555555555|xtls-rprx-vision"]
    },
    {
      ".name": "vmess", ".type": "server", "label": "VMess", "protocol": "vmess",
      "server_uuid": "66666666-6666-4666-8666-666666666666", "vmess_alter_id": "0"
    },
    {
      ".name": "trojan", ".type": "server", "label": "Trojan", "protocol": "trojan",
      "server_password": "trojan-secret"
    },
    {
      ".name": "hysteria2", ".type": "server", "label": "Hysteria2", "protocol": "hysteria2",
      "server_password": "hysteria-secret"
    },
    {
      ".name": "tailscale", ".type": "server", "label": "Tailscale", "protocol": "tailscale",
      "tailscale_advertise_exit_node": "0"
    }
  ]
}
JSON

FORKOP_RUNTIME_STATE_DIR="$WORK_DIR/runtime" \
FORKOP_PERSISTENT_SUBSCRIPTION_CACHE_DIR="$WORK_DIR/persistent" \
FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/full-1.0.2.json" >"$WORK_DIR/full-1.0.2.out.json"

node - "$WORK_DIR/full-1.0.2.out.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = out.config;
const section = Object.fromEntries(c.section.map((item) => [item['.name'], item]));
const server = Object.fromEntries(c.server.map((item) => [item['.name'], item]));
const clients = {};
for (const item of c.server_client || []) (clients[item.server] ||= []).push(item);
const only = (name) => {
  if ((clients[name] || []).length !== 1) throw new Error(`${name} must own one migrated client`);
  return clients[name][0];
};
const assert = (value, message) => { if (!value) throw new Error(message); };
const absent = (item, key) => assert(!Object.prototype.hasOwnProperty.call(item, key), `${item['.name'] || 'settings'} kept ${key}`);

assert(out.changed && c.settings.config_version === 'NEXT', '1.0.2 must reach the canonical dev schema');
absent(c.settings, 'applied_migrations');
for (const key of ['dns_type', 'dns_check_interval', 'dns_recovery_check_interval',
  'dns_check_timeout', 'dont_touch_dhcp', 'shutdown_correctly']) absent(c.settings, key);
assert(c.settings.unified_delay === '1', 'missing Unified Delay must receive the current enabled default');
assert(JSON.stringify(c.settings.dns_server) === JSON.stringify([
  'https://dns.google/dns-query', 'https://1.1.1.1:444/custom'
]), 'global DNS hosts, ports, paths and order must survive URI conversion');
assert(JSON.stringify(c.settings.bootstrap_dns_server) === JSON.stringify([
  '1.1.1.1', '[2606:4700:4700::1111]:5353'
]), 'bootstrap DNS endpoints must remain plain UDP endpoints');

assert(!section.zap && !section.zap2 && !section.bye,
  'every released DPI provider action must remove its whole section');
assert(!(c.subscription_url || []).some((item) => ['zap', 'zap2', 'bye'].includes(item.section)),
  'children of a removed DPI section must leave');
assert(c.settings.dns_detour_enabled === '0' && !c.settings.dns_detour_section,
  'settings references to a removed DPI section must be disabled');
assert(c.settings.download_lists_via_proxy === '0' && !c.settings.download_lists_via_proxy_section,
  'download references to a removed DPI section must be disabled');
assert(section.main.outbound_detour_enabled === '0' && !section.main.outbound_detour_section,
  'section references to a removed DPI section must be disabled');

for (const key of ['dashboard_filter_mode', 'dashboard_detect_server_country',
  'dashboard_include_countries', 'dashboard_include_outbounds', 'dashboard_include_regex',
  'dashboard_include_proxy_parameters', 'dashboard_include_protocols', 'dashboard_include_transports',
  'dashboard_include_securities', 'dashboard_include_groups',
  'dashboard_exclude_countries', 'dashboard_exclude_outbounds', 'dashboard_exclude_regex',
  'dashboard_exclude_proxy_parameters', 'dashboard_exclude_protocols', 'dashboard_exclude_transports',
  'dashboard_exclude_securities', 'dashboard_exclude_groups',
  'detect_server_country', 'include_urltest_groups', 'hide_urltest_group_outbounds', 'hide_detour_outbounds',
  'include_proxy_parameters', 'include_protocols', 'include_transports', 'include_securities',
  'exclude_proxy_parameters', 'exclude_protocols', 'exclude_transports', 'exclude_securities',
  'urltest_exclude_proxy_parameters', 'urltest_include_protocols', 'sort_by_latency', 'resolve_real_ip_for_routing',
  'mixed_proxy_enabled', 'mixed_proxy_port', 'mixed_proxy_auth_enabled', 'mixed_proxy_username', 'mixed_proxy_password']) {
  absent(section.main, key);
}
assert(new Set(section.main.rule_set_with_subnets).size === 4 &&
  ['existing', 'local', 'remote-domain', 'remote-subnet'].every((value) => section.main.rule_set_with_subnets.includes(value)),
  'connection rule-set sources must merge losslessly and keep order without duplicates');
assert(JSON.stringify(section.dns_rule.rule_set) === JSON.stringify(['dns-existing', 'dns-remote']),
  'DNS rules must keep domain-only universal rule sets');
assert(JSON.stringify(section.dns_rule.dns_server) === JSON.stringify(['tls://9.9.9.9:5353']) && !section.dns_rule.dns_type,
  'per-rule DNS transport must become a URI');

const sub = c.subscription_url.find((item) => item['.name'] === 'sub');
assert(sub.tag === 'Premium' && sub.show_subscription_name === '1', 'subscription prefix fields must become tag/display fields');
assert(sub.server_filter_mode === 'include' && sub.include_regex.includes('🇩🇪'),
  'subscription country filters must become explicit regex filters');
assert(sub.header.includes('User-Agent: Custom Agent') && sub.header.includes('X-HWID: CUSTOM-HWID'),
  'subscription User-Agent and HWID must become explicit headers');
for (const key of ['auto_user_agent', 'user_agent', 'auto_hwid', 'hwid', 'filter_mode', 'include_countries',
  'include_proxy_parameters', 'include_protocols', 'include_transports', 'include_securities',
  'exclude_protocols', 'exclude_transports', 'exclude_securities',
  'include_urltest_groups', 'hide_urltest_group_outbounds', 'node_prefix', 'prefix_nodes']) {
  absent(sub, key);
}
const iface = c.section_interface[0];
assert(iface.display_name === 'awg0' &&
  JSON.stringify(iface.domain_resolver_dns_server) === JSON.stringify(['https://dns.example/dns-query']),
  'interface display name and resolver URI must survive');
assert(iface.domain_resolver_dns_detour_enabled === '0' && !iface.domain_resolver_dns_detour_section,
  'interface detours to a removed section must be disabled');
const urltest = c.urltest[0];
assert(urltest.expected_status === '*' && urltest.server_filter_mode === 'include' && urltest.include_regex.includes('🇳🇱'),
  'URLTest defaults and country filters must migrate');
for (const key of ['detect_server_country', 'filter_mode', 'include_countries', 'exclude_countries',
  'include_proxy_parameters', 'include_protocols', 'include_transports', 'include_securities',
  'exclude_proxy_parameters', 'exclude_protocols', 'exclude_transports', 'exclude_securities',
  'hide_added_outbounds', 'pin_dashboard', 'interrupt_exist_connections']) absent(urltest, key);

assert(!c.priority_group && !c.priority_level, 'legacy priority section types must leave');
const group = c.fallback_group[0];
assert(group['.type'] === 'fallback_group' && group.health_check_url === 'https://example.com/ping',
  'priority group must become fallback group while preserving its probe URL');
for (const key of ['health_url', 'active_check_interval', 'check_timeout', 'recovery_check_interval',
  'pick_fastest', 'switch_to_faster_same_priority', 'fastest_check_interval',
  'hide_added_outbounds', 'pin_dashboard', 'interrupt_exist_connections']) absent(group, key);
const level = c.fallback_level[0];
assert(level['.type'] === 'fallback_level' && level.server_filter_mode === 'direct',
  'priority level and its direct selection must become native fallback fields');
for (const key of ['direct', 'country', 'detect_server_country', 'include_proxy_parameters']) absent(level, key);

const mixed = c.server.find((item) => item.routing_section === 'main' && item.protocol === 'mixed');
assert(mixed && mixed.listen_port === '2080' && mixed.mixed_auth_enabled === '1',
  'section-owned mixed listener must become a routed mixed server');
assert(only(mixed['.name']).name === 'ivan-petrov' && only(mixed['.name']).password === 'proxy-secret',
  'section-owned mixed credentials must become a client');
assert(server.socks.protocol === 'mixed' && server.socks.mixed_auth_enabled === '0',
  'released SOCKS server must become mixed without changing authentication state');
assert(only('socks').name === 'ivan-petrov' && only('socks').password === 'socks-secret',
  'SOCKS credentials must reach the mixed client');
assert(only('vless').uuid === '44444444-4444-4444-8444-444444444444' && only('vless').flow === 'xtls-rprx-vision',
  'VLESS UUID and flow must move together to a client');
assert(server.vless.tls_server_name === 'www.apple.com', 'Reality target must fill a missing SNI');
assert(server.ss2022.shadowsocks_psk === 'ajXWye37k0IsLRrpEhB3pA==' &&
  only('ss2022').password === 'ajXWye37k0IsLRrpEhB3pA==', 'Shadowsocks 2022 listener and client keys must survive');
assert(only('mtproto').secret === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' && server.mtproto.mtproto_faketls === 'google.com',
  'MTProto FakeTLS secret must split into client key and server host');
assert(only('legacy_user').name === 'phone' && only('legacy_user').uuid === '55555555-5555-4555-8555-555555555555' &&
  only('legacy_user').flow === 'xtls-rprx-vision', 'legacy server_users must become a typed client');
assert(only('vmess').uuid === '66666666-6666-4666-8666-666666666666',
  'VMess UUID must move to a typed client while alterId is retired');
assert(only('trojan').password === 'trojan-secret' && only('hysteria2').password === 'hysteria-secret',
  'released password-based server protocols must keep their credentials in client sections');
absent(server.tailscale, 'tailscale_advertise_exit_node');
for (const item of c.server) {
  for (const key of ['server_users', 'server_uuid', 'server_username', 'server_password', 'mtproto_secret',
    'vless_flow', 'vmess_alter_id', 'socks_auth_enabled', 'mtproto_padding', 'mtproto_concurrency',
    'mtproto_idle_timeout', 'mtproto_domain_fronting_ip', 'mtproto_domain_fronting_port',
    'mtproto_domain_fronting_proxy_protocol', 'mtproto_prefer_ip', 'mtproto_auto_update',
    'mtproto_allow_fallback_on_unknown_dc', 'mtproto_tolerate_time_skewness', 'mtproto_handshake_timeout',
    'reality_handshake_server', 'reality_handshake_server_port',
    'reality_max_time_difference']) absent(item, key);
}
assert(out.restore_dnsmasq === true, 'the supported-version transition must request one dnsmasq restoration');
assert(out.removed_caches.some((value) => value.includes('server-country-cache.json')) &&
  out.removed_cron_markers.length === 2, 'retired country, fallback and list workers must request cleanup');
NODE

# The dnsmasq restore is planned separately because it owns /etc/config/dhcp,
# while the versioned model owns /etc/config/forkop.
restore_plan() {
  FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" restore-dnsmasq-fixture "$1"
}

cat >"$WORK_DIR/dnsmasq.json" <<'JSON'
{
  "dnsmasq": {
    "server": ["127.0.0.42"], "noresolv": "1", "cachesize": "0", "rebind_protection": "0",
    "forkop_server": ["1.1.1.1", "tls://8.8.8.8"], "forkop_noresolv": "1",
    "forkop_cachesize": "321", "forkop_rebind_protection": "__unset__"
  }
}
JSON
restore_plan "$WORK_DIR/dnsmasq.json" >"$WORK_DIR/dnsmasq.out.json"
node - "$WORK_DIR/dnsmasq.out.json" <<'NODE'
const fs = require('fs');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!plan.changed || JSON.stringify(plan.set_lists.server) !== JSON.stringify(['1.1.1.1', 'tls://8.8.8.8']) ||
  plan.set.noresolv !== '1' || plan.set.cachesize !== '321' ||
  !['forkop_server', 'forkop_noresolv', 'forkop_cachesize', 'forkop_rebind_protection', 'rebind_protection']
    .every((key) => plan.delete_options.includes(key))) {
  throw new Error('dnsmasq takeover backup must be restored exactly and its private keys removed');
}
NODE

cat >"$WORK_DIR/dnsmasq-clean.json" <<'JSON'
{"dnsmasq":{"server":["192.168.1.1"],"noresolv":"0","cachesize":"150"}}
JSON
restore_plan "$WORK_DIR/dnsmasq-clean.json" >"$WORK_DIR/dnsmasq-clean.out.json"
node - "$WORK_DIR/dnsmasq-clean.out.json" <<'NODE'
const fs = require('fs');
if (JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).changed) {
  throw new Error('an untouched dnsmasq configuration must remain untouched');
}
NODE

printf 'config migration transformation checks passed\n'
