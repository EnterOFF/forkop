#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
RUNTIME_MIGRATION="$FORKOP_LIB/config/migration.uc"
INSTALLER="$ROOT_DIR/install.sh"
WORK_DIR="$(mktemp -d)"
MIGRATION="$RUNTIME_MIGRATION"
MIGRATIONS_DIR="$FORKOP_LIB/config/migrations"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

if grep -n -E 'FORKOP_CONFIG_MIGRATION_EOF|installer_config_migration_path' "$INSTALLER" >/dev/null 2>&1; then
  fail "install.sh must not embed configuration migration logic"
fi
[ -s "$MIGRATION" ] || fail "runtime configuration migration module is missing"
[ ! -e "$MIGRATIONS_DIR" ] || fail "configuration migrations must stay in one migration.uc file"

if grep -n -E 'require\("uci"\)\.cursor|uci -q|uci", "-q"' "$MIGRATION" >/dev/null 2>&1; then
  fail "installer config migration must use core.uci instead of direct UCI cursor or CLI access"
fi
grep -Fq 'require("core.uci")' "$MIGRATION" ||
  fail "installer config migration must import core.uci"
grep -Fq '{ id: "interface_sections", run: migrate_interface_sections }' "$MIGRATION" ||
  fail "interface section migration must have a stable named marker"
grep -Fq '{ id: "enable_component_checks", run: migrate_enable_component_checks }' "$MIGRATION" ||
  fail "component check migration must have a stable named marker"
grep -Fq '{ id: "http_connection_urls", run: migrate_http_connection_urls }' "$MIGRATION" ||
  fail "HTTP connection URL migration must have a stable named marker"
grep -Fq '{ id: "native_fallbacks", run: use_native_fallbacks }' "$MIGRATION" ||
  fail "native fallback migration must have a stable named marker"
grep -Fq '{ id: "dns_fallback_modes", run: migrate_dns_fallback_modes }' "$MIGRATION" ||
  fail "DNS fallback mode migration must have a stable named marker"
grep -Fq '{ id: "native_rule_sets", run: use_native_rule_sets }' "$MIGRATION" ||
  fail "native rule-set migration must have a stable named marker"
grep -Fq '{ id: "universal_rule_sets", run: use_universal_rule_sets }' "$MIGRATION" ||
  fail "universal rule-set migration must have a stable named marker"
grep -Fq '{ id: "leaf_subscription_providers", run: use_leaf_subscription_providers }' "$MIGRATION" ||
  fail "leaf subscription provider migration must have a stable named marker"
grep -Fq '{ id: "extended_server_defaults", run: add_extended_server_defaults }' "$MIGRATION" ||
  fail "extended server defaults migration must have a stable named marker"
grep -Fq '{ id: "fallback_uci_tags", run: migrate_fallback_uci_tags }' "$MIGRATION" ||
  fail "Fallback UCI tag migration must have a stable named marker"
grep -Fq '{ id: "reset_fallback_defaults", run: reset_fallback_defaults }' "$MIGRATION" ||
  fail "Fallback default reset must have a stable named marker"
grep -Fq '{ id: "remove_proxy_parameter_filters", run: remove_proxy_parameter_filters }' "$MIGRATION" ||
  fail "proxy parameter filter removal must have a stable named marker"
grep -Fq '{ id: "server_filter_model", run: migrate_server_filter_model }' "$MIGRATION" ||
  fail "server filter migration must have a stable named marker"
grep -Fq '{ id: "server_filter_modes", run: migrate_server_filter_modes }' "$MIGRATION" ||
  fail "server filter mode migration must have a stable named marker"
grep -Fq '{ id: "single_subscription_user_agent", run: migrate_single_subscription_user_agent }' "$MIGRATION" ||
  fail "single subscription User-Agent migration must have a stable named marker"
grep -Fq '{ id: "subscription_headers", run: migrate_subscription_headers }' "$MIGRATION" ||
  fail "subscription header migration must have a stable named marker"
grep -Fq '{ id: "subscription_user_agent_header", run: migrate_subscription_user_agent_header }' "$MIGRATION" ||
  fail "subscription User-Agent header migration must have a stable named marker"
grep -Fq '{ id: "interface_display_names", run: migrate_interface_display_names }' "$MIGRATION" ||
  fail "interface display name migration must have a stable named marker"
grep -Fq '{ id: "remove_section_cache", run: remove_section_cache }' "$MIGRATION" ||
  fail "section-cache removal must have a stable named marker"
grep -Fq '{ id: "remove_dashboard_sort_options", run: remove_dashboard_sort_options }' "$MIGRATION" ||
  fail "dashboard sort option removal must have a stable named marker"
grep -Fq '{ id: "dns_server_uris", run: migrate_dns_server_uris }' "$MIGRATION" ||
  fail "DNS server URI migration must have a stable named marker"
grep -Fq '{ id: "interface_domain_resolver_uris", run: migrate_interface_domain_resolver_uris }' "$MIGRATION" ||
  fail "interface domain resolver URI migration must have a stable named marker"
grep -Fq '{ id: "readable_runtime_tags", run: migrate_readable_runtime_tags }' "$MIGRATION" ||
  fail "readable runtime tag migration must have a stable named marker"
grep -Fq '{ id: "urltest_expected_status", run: migrate_urltest_expected_status }' "$MIGRATION" ||
  fail "URLTest expected status migration must have a stable named marker"
grep -Fq '{ id: "group_interrupt_defaults", run: migrate_group_interrupt_defaults }' "$MIGRATION" ||
  fail "group interrupt default migration must have a stable named marker"
grep -Fq "list applied_migrations 'native_rule_sets'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the native rule-set migration as already applied"
grep -Fq "option dns_main_fallback_strategy 'parallel'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must default Main DNS fallback to parallel"
grep -Fq "option dns_bootstrap_fallback_strategy 'parallel'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must default Bootstrap DNS fallback to parallel"
grep -Fq "list applied_migrations 'dns_fallback_modes'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the DNS fallback mode migration as already applied"
grep -Fq "list applied_migrations 'universal_rule_sets'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the universal rule-set migration as already applied"
grep -Fq "list applied_migrations 'leaf_subscription_providers'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the leaf subscription migration as already applied"
grep -Fq "list applied_migrations 'fallback_uci_tags'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the Fallback UCI tag migration as already applied"
grep -Fq "list applied_migrations 'reset_fallback_defaults'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the Fallback default reset as already applied"
grep -Fq "list applied_migrations 'remove_proxy_parameter_filters'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the proxy parameter filter removal as already applied"
grep -Fq "list applied_migrations 'server_filter_model'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the server filter migration as already applied"
grep -Fq "list applied_migrations 'server_filter_modes'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the server filter mode migration as already applied"
grep -Fq "list applied_migrations 'single_subscription_user_agent'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the single subscription User-Agent migration as already applied"
grep -Fq "list applied_migrations 'subscription_headers'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the subscription header migration as already applied"
grep -Fq "list applied_migrations 'subscription_user_agent_header'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the subscription User-Agent header migration as already applied"
grep -Fq "list applied_migrations 'interface_display_names'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the interface display name migration as already applied"
grep -Fq "list applied_migrations 'remove_section_cache'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the section-cache removal as already applied"
grep -Fq "list applied_migrations 'remove_dashboard_sort_options'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the dashboard sort option removal as already applied"
grep -Fq "list applied_migrations 'dns_server_uris'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the DNS server URI migration as already applied"
grep -Fq "list applied_migrations 'interface_domain_resolver_uris'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the interface domain resolver URI migration as already applied"
grep -Fq "list applied_migrations 'readable_runtime_tags'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the readable runtime tag migration as already applied"
grep -Fq "list applied_migrations 'urltest_expected_status'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "shipped config must record the urltest expected status migration"
grep -Fq "list applied_migrations 'group_interrupt_defaults'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the group interrupt default migration as already applied"
grep -Fq 'release_at_most(ctx, "1.0.1")' "$MIGRATION" ||
  fail "release-specific migrations must use the source release only as a condition"
grep -Fq 'release_at_most(ctx, "1.0.4")' "$MIGRATION" ||
  fail "HTTP connection URLs must only migrate from Forkop 1.0.4 and below"

eval "$(ucode -L "$FORKOP_LIB" "$FORKOP_LIB/core/constants.uc" shell-env)"
export ZAPRET_LEGACY_DEFAULT_NFQWS_OPT ZAPRET_DEFAULT_NFQWS_OPT

node >"$WORK_DIR/fixture.json" <<'NODE'
const fixture = {
  settings: {
    '.name': 'settings',
    '.type': 'settings',
    download_lists_via_proxy: '1',
    download_subscriptions_via_proxy: '1',
    download_lists_via_proxy_section: 'legacy-urltest',
    dns_server: '9.9.9.9',
    bootstrap_dns_server: '1.1.1.1',
    dns_fallback_strategy: 'sequential',
    dns_check_interval: '10s',
    dns_recovery_check_interval: '60s',
    dns_check_timeout: '2s',
    routing_excluded_ips: [ '192.0.2.0/24' ]
  },
  rule: [
    {
      '.name': 'legacy-url',
      '.type': 'rule',
      enabled: '1',
      connection_type: 'proxy',
      proxy_config_type: 'url',
      proxy_string: 'vless://one\n//commented\n ss://two ',
      enable_udp_over_tcp: '1',
      outbound_detour_enabled: '1',
      outbound_detour_section: 'legacy-sub',
      urltest_check_interval_disabled: '1',
      domain: [ 'Example.COM', 'full:Already.EXAMPLE' ],
      domain_keyword_text_mode: '1',
      domain_keyword_text: 'Video, Stream # comment',
      domain_regex_text: '^api[.]example$, ^cdn[.]example$',
      rule_set: [ 'https://example.com/domains.srs' ],
      rule_set_with_subnets: [ 'https://example.com/mixed.srs' ]
    }
  ],
  section: [
    {
      '.name': 'legacy-sub',
      '.type': 'section',
      action: 'proxy',
      proxy_config_type: 'subscription',
      subscription_url: 'https://example.com/sub.txt',
      subscription_user_agent: 'Agent/1.0',
      subscription_update_interval_disabled: '1',
      urltest_enabled: '1',
      urltest_filter_mode: 'include',
      detect_server_country: '1',
      dashboard_filter_mode: 'mixed',
      dashboard_include_regex: [ '^Primary' ]
    },
    {
      '.name': 'legacy-urltest',
      '.type': 'section',
      connection_type: 'proxy',
      proxy_config_type: 'urltest',
      urltest_proxy_links: [ 'vmess://a', 'vmess://a', 'trojan://b' ],
      urltest_exclude_regex: [ 'bad.*' ],
      urltest_enabled: '1',
      detect_server_country: '0'
    },
    {
      '.name': 'legacy-list-sub',
      '.type': 'section',
      action: 'proxy',
      subscription_urls: [
        'https://example.com/list.txt | ListAgent/2.0',
        'https://example.com/auto.txt'
      ],
      subscription_update_interval: '6h'
    },
    {
      '.name': 'legacy-direct',
      '.type': 'section',
      action: 'direct',
      ip_cidr: [ '198.51.100.0/24' ],
      domain_ip_lists: [ 'existing.txt', 'duplicate.txt' ],
      local_domain_lists: [ 'local-domains.txt', 'duplicate.txt' ],
      local_subnet_lists: [ '/etc/forkop/local-subnets.txt' ],
      remote_domain_lists: [ 'https://example.com/domains.txt' ],
      remote_subnet_lists: [ 'https://example.com/subnets.txt', 'duplicate.txt' ]
    },
    {
      '.name': 'legacy-exclusion',
      '.type': 'section',
      connection_type: 'exclusion',
      ip_cidr: [ '203.0.113.0/24' ]
    },
    {
      '.name': 'legacy-dns-list',
      '.type': 'section',
      action: 'dns',
      domain_ip_lists: [ '/etc/forkop/dns-list.txt' ]
    },
    {
      '.name': 'legacy-zap',
      '.type': 'section',
      action: 'zapret',
      nfqws_opt: process.env.ZAPRET_LEGACY_DEFAULT_NFQWS_OPT,
      cmd_opts: '--legacy-bye'
    },
    {
      '.name': 'legacy-vpn',
      '.type': 'section',
      connection_type: 'vpn',
      proxy_config_type: 'interface',
      interface: 'awg0',
      domain_resolver_enabled: '1',
      domain_resolver_dns_type: 'doh',
      domain_resolver_dns_server: 'https://dns.example/dns-query'
    },
    {
      '.name': 'legacy-outbound',
      '.type': 'section',
      action: 'outbound',
      outbound_json: '{"type":"socks","server":"127.0.0.1","server_port":1080,"version":"5"}',
      outbound_detour_enabled: '1',
      outbound_detour_section: 'legacy-url'
    },
    {
      '.name': 'legacy-outbound-collision',
      '.type': 'section',
      action: 'outbound',
      outbound_jsons: [ '{"type":"direct","tag":"legacy-outbound-collision-json-2-out"}' ],
      outbound_json: '{"type":"socks","server":"127.0.0.2","server_port":1080}'
    }
  ],
  server: [
    { '.name': 'naive', '.type': 'server', protocol: 'naive', naive_network: 'udp' },
    { '.name': 'mieru', '.type': 'server', protocol: 'mieru' },
    { '.name': 'tuic', '.type': 'server', protocol: 'tuic', tuic_heartbeat: '20s' },
    { '.name': 'ssh', '.type': 'server', protocol: 'ssh' },
    { '.name': 'legacy-vless', '.type': 'server', protocol: 'vless', server_users: [ 'client|11111111-1111-4111-8111-111111111111|xtls-rprx-vision' ] },
    { '.name': 'legacy-vmess', '.type': 'server', protocol: 'vmess', server_users: [ 'client|22222222-2222-4222-8222-222222222222|7' ] },
    { '.name': 'legacy-shadowsocks', '.type': 'server', protocol: 'shadowsocks', server_users: [ 'client|ss-password' ] },
    { '.name': 'legacy-socks', '.type': 'server', protocol: 'socks', server_users: [ 'alice|socks-password' ] },
    { '.name': 'legacy-trojan', '.type': 'server', protocol: 'trojan', server_users: [ 'client|trojan-password' ] },
    { '.name': 'legacy-hysteria2', '.type': 'server', protocol: 'hysteria2', server_users: [ 'client|hy2-password' ] },
    { '.name': 'legacy-mtproto', '.type': 'server', protocol: 'mtproto', mtproto_padding: '0', server_users: [ 'client|eeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa676f6f676c652e636f6d' ] }
  ],
  priority_group: [
    {
      '.name': 'legacy-priority',
      '.type': 'priority_group',
      section: 'legacy-sub',
      name: 'Priority',
      health_url: 'https://example.com/ping',
      active_check_interval: '30s',
      check_timeout: '3s',
      recovery_check_interval: '15s',
      pick_fastest: '1',
      switch_to_faster_same_priority: '1',
      fastest_check_interval: '5m',
      interrupt_exist_connections: '0'
    }
  ],
  priority_level: [
    {
      '.name': 'legacy-priority-level',
      '.type': 'priority_level',
      group: 'legacy-priority',
      name: 'Primary',
      order: '0'
    }
  ]
};

process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture "$WORK_DIR/fixture.json" podkop >"$WORK_DIR/output.json"

node - "$WORK_DIR/output.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const config = out.config;
const sections = Object.fromEntries(config.section.map(section => [section['.name'], section]));
const childByType = type => config[type] || [];
const subscriptionUrls = childByType('subscription_url');
const interfaces = childByType('section_interface');
const urltests = childByType('urltest');

assert(JSON.stringify(config.settings.dns_server) === JSON.stringify(['9.9.9.9']), 'legacy main DNS scalar migrated to ordered list');
assert(JSON.stringify(config.settings.bootstrap_dns_server) === JSON.stringify(['1.1.1.1']), 'legacy Bootstrap DNS scalar migrated to ordered list');
assert(config.settings.unified_delay === '0', 'Unified Delay default missing');
assert(config.settings.config_version === '1.0.5', 'legacy config should be marked at the current schema version');
assert(config.settings.component_update_check_enabled === '1', 'component update checks should be enabled during migration');
assert(JSON.stringify(config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'dns_fallback_modes', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'reset_fallback_defaults', 'remove_proxy_parameter_filters', 'server_filter_model', 'server_filter_modes', 'single_subscription_user_agent', 'subscription_headers', 'interface_display_names', 'remove_section_cache', 'remove_dashboard_sort_options', 'dns_server_uris', 'interface_domain_resolver_uris', 'readable_runtime_tags', 'urltest_expected_status', 'group_interrupt_defaults', 'subscription_user_agent_header']), 'legacy config should record named migrations');

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function absent(object, key, label) {
  assert(!Object.prototype.hasOwnProperty.call(object, key), `${label}: ${key} should be absent`);
}

function headerValue(source, name) {
  const prefix = `${name}:`.toLowerCase();
  const line = (source.header || []).find(value => `${value}`.toLowerCase().startsWith(prefix));
  return line == null ? undefined : `${line}`.slice(`${line}`.indexOf(':') + 1).trim();
}

function assertSubscriptionUserAgent(source, expected, label) {
  assert(headerValue(source, 'User-Agent') === expected, `${label}: User-Agent header`);
  assert(`${(source.header || [])[0]}` === `User-Agent: ${expected}`, `${label}: User-Agent header comes first`);
  absent(source, 'user_agent', label);
}

function assertDefaultSubscriptionHeaders(source, label) {
  assert(headerValue(source, 'X-Device-OS') === 'OpenWrt Linux', `${label}: device OS header`);
  assert(Boolean(headerValue(source, 'X-Device-Model')), `${label}: device model header`);
  assert(headerValue(source, 'Accept-Language') === 'ru-RU,en,*', `${label}: language header`);
  assert(headerValue(source, 'X-Device-Locale') === 'EN', `${label}: locale header`);
  assert(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/.test(headerValue(source, 'X-HWID') || ''), `${label}: generated HWID header`);
}

function childObjects(parent, children) {
  return children.filter(child => child.section === parent['.name']);
}

function childValues(parent, children, valueKey) {
  return childObjects(parent, children).map(child => child[valueKey]).filter(Boolean);
}

function childByValue(parent, children, valueKey, value) {
  return childObjects(parent, children).find(child => child[valueKey] === value);
}

function urltestByOwner(parent) {
  return urltests.find(item => item.section === parent['.name']);
}

assert(out.changed === true, 'migration should report changes');
assert(!config.rule, 'legacy rule sections should be converted');

assert(config.settings.list_update_enabled === '0', 'missing list_update_enabled should become disabled');
assert(config.settings.update_interval === '1d', 'missing update_interval should get 1d default');
assert(config.settings.dns_main_fallback_strategy === 'parallel', 'Main DNS fallback should default to parallel');
assert(config.settings.dns_bootstrap_fallback_strategy === 'parallel', 'Bootstrap DNS fallback should default to parallel');
absent(config.settings, 'dns_fallback_strategy', 'settings');
absent(config.settings, 'dns_check_interval', 'settings');
absent(config.settings, 'dns_recovery_check_interval', 'settings');
absent(config.settings, 'dns_check_timeout', 'settings');
assert(config.settings.download_lists_via_proxy === '1', 'download_lists_via_proxy should be preserved');
assert(config.settings.download_components_via_proxy === '1', 'download_components_via_proxy should be copied');
assert(config.settings.download_lists_via_proxy_section === 'legacy-urltest', 'download section should be preserved for lists/components');
assert(config.settings.download_components_via_proxy_section === 'legacy-urltest', 'component download section should be migrated from the legacy common selector');
absent(config.settings, 'download_subscriptions_via_proxy', 'settings');
absent(config.settings, 'routing_excluded_ips', 'settings');

const legacyUrl = sections['legacy-url'];
assert(legacyUrl['.type'] === 'section', 'legacy rule should become section');
assert(legacyUrl.action === 'connection', 'legacy-url action');
assert(JSON.stringify(legacyUrl.selector_proxy_links) === JSON.stringify(['vless://one', 'ss://two']), 'proxy_string links');
assert(legacyUrl.outbound_detour_enabled === '1', 'section cascade enabled preserved');
assert(legacyUrl.outbound_detour_section === 'legacy-sub', 'section cascade target preserved');
absent(legacyUrl, 'enable_udp_over_tcp', 'legacy-url');
const legacyUrlDomains = (legacyUrl.domain || '').split(/\s+/).filter(Boolean);
assert(legacyUrlDomains.includes('full:Example.COM'), 'full domain list value migrated');
assert(legacyUrlDomains.includes('full:Already.EXAMPLE'), 'prefixed full domain list value migrated without duplicate prefix');
assert(!legacyUrlDomains.includes('full:full:Already.EXAMPLE'), 'prefixed full domain list value should not get duplicate prefix');
assert(legacyUrlDomains.includes('keyword:Video'), 'keyword migrated');
assert(legacyUrlDomains.includes('keyword:Stream'), 'keyword comment stripped');
assert(legacyUrlDomains.includes('regex:^api[.]example$'), 'regex migrated');
assert(legacyUrlDomains.includes('regex:^cdn[.]example$'), 'second regex migrated');
assert(JSON.stringify(legacyUrl.rule_set) === JSON.stringify(['https://example.com/domains.srs']), 'domain rule set preserved');
assert(JSON.stringify(legacyUrl.rule_set_with_subnets) === JSON.stringify(['https://example.com/mixed.srs']), 'rule set subnet list preserved');
absent(legacyUrl, 'proxy_string', 'legacy-url');
absent(legacyUrl, 'proxy_config_type', 'legacy-url');
absent(legacyUrl, 'connection_type', 'legacy-url');
absent(legacyUrl, 'urltest_enabled', 'legacy-url');
absent(legacyUrl, 'rule_set_settings', 'legacy-url');
absent(legacyUrl, 'domain_suffix', 'legacy-url');
absent(legacyUrl, 'rule_set_items', 'legacy-url');
absent(legacyUrl, 'domain_keyword_text', 'legacy-url');
absent(legacyUrl, 'domain_regex_text', 'legacy-url');

const legacySub = sections['legacy-sub'];
assert(JSON.stringify(childValues(legacySub, subscriptionUrls, 'url')) === JSON.stringify(['https://example.com/sub.txt']), 'subscription entry');
assert(legacySub.action === 'connection', 'legacy-sub action');
const legacySubSource = childObjects(legacySub, subscriptionUrls)[0];
assertSubscriptionUserAgent(legacySubSource, 'Agent/1.0', 'subscription source');
absent(legacySubSource, 'auto_user_agent', 'subscription source');
assertDefaultSubscriptionHeaders(legacySubSource, 'subscription source');
absent(legacySubSource, 'auto_hwid', 'subscription source');
absent(legacySubSource, 'hwid', 'subscription source');
assert(legacySubSource.show_subscription_name === '0', 'subscription name display disabled by default');
absent(legacySubSource, 'include_urltest_groups', 'subscription source');
absent(legacySubSource, 'hide_urltest_group_outbounds', 'subscription source');
absent(legacySubSource, 'hide_detour_outbounds', 'subscription source');
assert(legacySubSource.subscription_update_enabled === '0', 'subscription update disabled flag');
assert(legacySubSource.download_via_proxy_enabled === '1', 'subscription download through section flag');
assert(legacySubSource.download_via_proxy_section === 'legacy-urltest', 'subscription download target');
absent(legacySub, 'urltests', 'legacy-sub');
const legacySubUrltest = urltestByOwner(legacySub);
assert(Boolean(legacySubUrltest), 'legacy-sub URLTest child migrated');
assert(legacySubUrltest.section === 'legacy-sub', 'legacy-sub URLTest owner migrated');
absent(legacySubUrltest, 'id', 'legacy-sub URLTest');
absent(legacySubUrltest, 'display_name', 'legacy-sub URLTest');
assert(legacySubUrltest.name === 'Fastest', 'legacy-sub URLTest name migrated');
assert(legacySubUrltest.check_interval === '3m', 'legacy-sub URLTest interval default migrated');
assert(legacySubUrltest.tolerance === '50', 'legacy-sub URLTest tolerance default migrated');
assert(legacySubUrltest.testing_url === 'https://www.gstatic.com/generate_204', 'legacy-sub URLTest URL default migrated');
assert(legacySubUrltest.expected_status === '*', 'legacy-sub URLTest expected status default migrated');
assert(legacySubUrltest.server_filter_mode === 'include', 'legacy-sub URLTest filter mode migrated');
absent(legacySubUrltest, 'filter_mode', 'legacy-sub URLTest');
absent(legacySubUrltest, 'detect_server_country', 'legacy-sub URLTest');
absent(legacySubUrltest, 'interrupt_exist_connections', 'legacy-sub URLTest');
absent(legacySubUrltest, 'pin_dashboard', 'legacy-sub URLTest');
absent(legacySub, 'subscription_update_enabled', 'legacy-sub');
absent(legacySub, 'subscription_update_interval', 'legacy-sub');
absent(legacySub, 'subscription_urls', 'legacy-sub');
absent(legacySub, 'subscription_url_items', 'legacy-sub');
absent(legacySub, 'subscription_url_settings', 'legacy-sub');
absent(legacySub, 'subscription_url', 'legacy-sub');
absent(legacySub, 'subscription_user_agent', 'legacy-sub');
absent(legacySub, 'proxy_config_type', 'legacy-sub');
absent(legacySub, 'urltest_enabled', 'legacy-sub');
absent(legacySub, 'urltest_filter_mode', 'legacy-sub');
absent(legacySub, 'detect_server_country', 'legacy-sub');
absent(legacySub, 'dashboard_filter_mode', 'legacy-sub');
absent(legacySub, 'dashboard_include_regex', 'legacy-sub');

const legacyListSub = sections['legacy-list-sub'];
assert(JSON.stringify(childValues(legacyListSub, subscriptionUrls, 'url')) === JSON.stringify(['https://example.com/list.txt', 'https://example.com/auto.txt']), 'legacy list subscription entries normalized');
const legacyListSubSource = childByValue(legacyListSub, subscriptionUrls, 'url', 'https://example.com/list.txt');
const legacyListSubAutoSource = childByValue(legacyListSub, subscriptionUrls, 'url', 'https://example.com/auto.txt');
assertSubscriptionUserAgent(legacyListSubSource, 'ListAgent/2.0', 'legacy list subscription source');
absent(legacyListSubSource, 'auto_user_agent', 'legacy list subscription source');
assert(legacyListSubSource.subscription_update_interval === '6h', 'legacy list subscription interval migrated');
assertSubscriptionUserAgent(legacyListSubAutoSource, 'sing-box', 'legacy automatic subscription source');
absent(legacyListSubAutoSource, 'auto_user_agent', 'legacy automatic subscription source');
absent(legacyListSub, 'subscription_url_settings', 'legacy-list-sub');
absent(legacyListSub, 'subscription_url_items', 'legacy-list-sub');

const legacyUrltest = sections['legacy-urltest'];
assert(legacyUrltest.action === 'connection', 'legacy-urltest action');
assert(JSON.stringify(legacyUrltest.selector_proxy_links) === JSON.stringify(['vmess://a', 'trojan://b']), 'urltest links deduped');
absent(legacyUrltest, 'urltests', 'legacy-urltest');
const legacyUrltestConfig = urltestByOwner(legacyUrltest);
assert(Boolean(legacyUrltestConfig), 'legacy-urltest URLTest child migrated');
absent(legacyUrltestConfig, 'id', 'legacy-urltest URLTest');
absent(legacyUrltestConfig, 'display_name', 'legacy-urltest URLTest');
assert(legacyUrltestConfig.name === 'Fastest', 'legacy-urltest URLTest name migrated');
assert(legacyUrltestConfig.expected_status === '*', 'legacy-urltest URLTest expected status default migrated');
assert(legacyUrltestConfig.server_filter_mode === 'exclude', 'legacy-urltest URLTest filter mode migrated');
absent(legacyUrltestConfig, 'filter_mode', 'legacy-urltest URLTest');
absent(legacyUrltestConfig, 'detect_server_country', 'legacy-urltest URLTest');
assert(legacyUrltestConfig.exclude_regex === 'bad.*', `legacy-urltest exclude regex migrated: ${JSON.stringify(legacyUrltestConfig)}`);
absent(legacyUrltest, 'urltest_proxy_links', 'legacy-urltest');
absent(legacyUrltest, 'urltest_enabled', 'legacy-urltest');
absent(legacyUrltest, 'urltest_filter_mode', 'legacy-urltest');
absent(legacyUrltest, 'detect_server_country', 'legacy-urltest');
absent(legacyUrltest, 'urltest_exclude_regex', 'legacy-urltest');

const legacyDirect = sections['legacy-direct'];
assert(legacyDirect.action === 'bypass', 'direct action migrated to bypass');
assert(JSON.stringify(legacyDirect.rule_set_with_subnets) === JSON.stringify([
  'existing.txt',
  'duplicate.txt',
  'local-domains.txt',
  '/etc/forkop/local-subnets.txt',
  'https://example.com/domains.txt',
  'https://example.com/subnets.txt',
]), 'legacy domain and subnet sources should merge into universal rule sets without duplicates');
absent(legacyDirect, 'domain_ip_lists', 'legacy-direct');
for (const key of ['local_domain_lists', 'local_subnet_lists', 'remote_domain_lists', 'remote_subnet_lists'])
  absent(legacyDirect, key, 'legacy-direct');

const legacyDnsList = sections['legacy-dns-list'];
assert(JSON.stringify(legacyDnsList.rule_set) === JSON.stringify(['/etc/forkop/dns-list.txt']), 'DNS lists should migrate without subnet settings');
absent(legacyDnsList, 'domain_ip_lists', 'legacy-dns-list');

const legacyExclusion = sections['legacy-exclusion'];
assert(legacyExclusion.action === 'bypass', 'legacy exclusion connection type migrated to bypass');
absent(legacyExclusion, 'connection_type', 'legacy-exclusion');

const legacyZap = sections['legacy-zap'];
assert(legacyZap.nfqws_opt === process.env.ZAPRET_DEFAULT_NFQWS_OPT, 'zapret legacy default migrated');
assert(legacyZap.byedpi_cmd_opts === '--legacy-bye', 'cmd_opts copied to byedpi_cmd_opts');
absent(legacyZap, 'cmd_opts', 'legacy-zap');

const legacyVpn = sections['legacy-vpn'];
assert(legacyVpn.action === 'connection', 'vpn action inferred');
assert(JSON.stringify(childValues(legacyVpn, interfaces, 'name')) === JSON.stringify(['awg0']), 'vpn interface migrated to interface item');
const legacyVpnInterface = childObjects(legacyVpn, interfaces)[0];
assert(legacyVpnInterface.domain_resolver_enabled === '1', 'vpn domain resolver enabled migrated');
absent(legacyVpnInterface, 'domain_resolver_dns_type', 'legacy-vpn interface');
assert(JSON.stringify(legacyVpnInterface.domain_resolver_dns_server) === JSON.stringify(['https://dns.example/dns-query']), 'vpn domain resolver server migrated to a URI list');
absent(legacyVpn, 'proxy_config_type', 'legacy-vpn');
absent(legacyVpn, 'interface', 'legacy-vpn');
absent(legacyVpn, 'interfaces', 'legacy-vpn');
absent(legacyVpn, 'interface_items', 'legacy-vpn');
absent(legacyVpn, 'domain_resolver_enabled', 'legacy-vpn');
absent(legacyVpn, 'domain_resolver_dns_type', 'legacy-vpn');
absent(legacyVpn, 'domain_resolver_dns_server', 'legacy-vpn');

const legacyOutbound = sections['legacy-outbound'];
assert(legacyOutbound.action === 'connection', 'outbound action inferred');
assert(Array.isArray(legacyOutbound.outbound_jsons) && legacyOutbound.outbound_jsons.length === 1, 'legacy JSON outbound migrated to list');
const migratedLegacyOutbound = JSON.parse(legacyOutbound.outbound_jsons[0]);
assert(migratedLegacyOutbound.detour === 'legacy-url', 'legacy JSON cascade embedded in outbound');
assert(migratedLegacyOutbound.tag === 'legacy-outbound-json-1', 'legacy tagless JSON outbound gets a stable list tag');
absent(legacyOutbound, 'outbound_detour_enabled', 'legacy-outbound');
absent(legacyOutbound, 'outbound_detour_section', 'legacy-outbound');

const legacyOutboundCollision = sections['legacy-outbound-collision'];
assert(legacyOutboundCollision.outbound_jsons.length === 2, 'legacy JSON outbound is appended to an existing list');
assert(JSON.parse(legacyOutboundCollision.outbound_jsons[1]).tag === 'legacy-outbound-collision-json-2', 'legacy JSON outbound tag avoids existing list tags');

const legacyPriority = config.fallback_group[0];
assert(!config.priority_group && !config.priority_level, 'legacy Priority UCI section types should be removed');
assert(config.fallback_level.every(level => level['.type'] === 'fallback_level'), 'legacy Priority levels should migrate to fallback_level');
assert(legacyPriority.health_check_url === 'https://example.com/ping', 'selected Fallback health URL should survive migration');
assert(JSON.stringify(Object.keys(legacyPriority).sort()) === JSON.stringify(['.name', '.type', 'health_check_url', 'name', 'section']), 'Fallback behavior settings should reset to defaults');
for (const key of [
  'health_url',
  'active_check_interval',
  'check_timeout',
  'recovery_check_interval',
  'pick_fastest',
  'switch_to_faster_same_priority',
  'fastest_check_interval',
  'interrupt_exist_connections',
  'blacklist_timeout',
]) absent(legacyPriority, key, 'legacy-priority');

const servers = Object.fromEntries(config.server.map(server => [server['.name'], server]));
assert(servers.naive.naive_network === 'udp', 'explicit Naive network must survive migration');
assert(servers.naive.naive_quic_congestion_control === 'bbr', 'Naive congestion default missing');
assert(servers.mieru.mieru_transport === 'TCP', 'Mieru transport default missing');
assert(servers.mieru.mieru_user_hint_mandatory === '0', 'Mieru user hint default missing');
assert(servers.tuic.tuic_congestion_control === 'cubic', 'TUIC congestion default missing');
assert(servers.tuic.tuic_auth_timeout === '3s', 'TUIC auth timeout default missing');
assert(servers.tuic.tuic_heartbeat === '20s', 'explicit TUIC heartbeat must survive migration');
assert(servers.tuic.tuic_zero_rtt_handshake === '0', 'TUIC zero-RTT default missing');
assert(!Object.prototype.hasOwnProperty.call(servers.ssh, 'ssh_host_key_path'), 'optional empty SSH host key path must stay absent');
assert(servers['legacy-vless'].server_uuid === '11111111-1111-4111-8111-111111111111', 'legacy VLESS UUID must migrate');
assert(servers['legacy-vless'].vless_flow === 'xtls-rprx-vision', 'legacy VLESS flow must migrate');
assert(servers['legacy-vmess'].server_uuid === '22222222-2222-4222-8222-222222222222', 'legacy VMess UUID must migrate');
assert(servers['legacy-vmess'].vmess_alter_id === '7', 'legacy VMess alter ID must migrate');
assert(servers['legacy-shadowsocks'].server_password === 'ss-password', 'legacy Shadowsocks password must migrate');
assert(servers['legacy-socks'].server_username === 'alice', 'legacy SOCKS username must migrate');
assert(servers['legacy-socks'].server_password === 'socks-password', 'legacy SOCKS password must migrate');
assert(servers['legacy-trojan'].server_password === 'trojan-password', 'legacy Trojan password must migrate');
assert(servers['legacy-hysteria2'].server_password === 'hy2-password', 'legacy Hysteria2 password must migrate');
assert(servers['legacy-mtproto'].mtproto_secret === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'legacy MTProto secret must migrate');
assert(servers['legacy-mtproto'].mtproto_faketls === 'google.com', 'legacy MTProto FakeTLS domain must migrate');
absent(servers['legacy-mtproto'], 'mtproto_padding', 'legacy-mtproto');
for (const name of Object.keys(servers))
  absent(servers[name], 'server_users', name);

assert(out.removed_caches.includes('/tmp/sing-box/subscriptions/legacy-sub.json'), 'subscription runtime cache removal');
for (const path of [
  '/tmp/sing-box/subscriptions',
  '/etc/forkop/subscription-cache',
  '/var/run/forkop/subscription-update',
  '/var/run/forkop/subscription-links',
  '/var/run/forkop/subscription-metadata',
  '/var/run/forkop/outbound-metadata',
  '/var/run/forkop/section-cache',
  '/var/run/forkop/subscription-update.lock',
  '/var/run/forkop/subscription-update-jobs',
  '/var/run/forkop/subscription-bootstrap-retry.pid',
  '/var/run/forkop/list-update.timestamp',
  '/var/run/forkop_list_update.pid',
  '/tmp/sing-box/rulesets',
]) assert(out.removed_caches.includes(path), `native migration should remove obsolete cache ${path}`);
assert(JSON.stringify(out.removed_cron_markers) === JSON.stringify(['# forkop-list-update', '# forkop-subscription-update']), 'legacy list and subscription cron jobs should be migration-only cleanup');
NODE

cat >"$WORK_DIR/forkop-1.0.1.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.1",
    "component_update_check_enabled": "0"
  },
  "section": [
    {
      ".name": "main",
      ".type": "section",
      "action": "connection",
      "interfaces": [ "awg0", "tun0" ]
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture "$WORK_DIR/forkop-1.0.1.json" >"$WORK_DIR/forkop-1.0.2.json"

node - "$WORK_DIR/forkop-1.0.2.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const section = out.config.section[0];
const interfaces = out.config.section_interface || [];

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

assert(out.changed === true, '1.0.1 config should require migration');
assert(out.config.settings.config_version === '1.0.5', 'config schema version should advance to 1.0.5');
assert(out.config.settings.component_update_check_enabled === '1', 'updates from 1.0.1 and below should enable component update checks');
assert(JSON.stringify(out.config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'dns_fallback_modes', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'reset_fallback_defaults', 'remove_proxy_parameter_filters', 'server_filter_model', 'server_filter_modes', 'single_subscription_user_agent', 'subscription_headers', 'interface_display_names', 'remove_section_cache', 'remove_dashboard_sort_options', 'dns_server_uris', 'interface_domain_resolver_uris', 'readable_runtime_tags', 'urltest_expected_status', 'group_interrupt_defaults', 'subscription_user_agent_header']), 'named migrations should be recorded');
assert(!Object.prototype.hasOwnProperty.call(section, 'interfaces'), 'parent interface list should be removed');
assert(JSON.stringify(interfaces.map(item => item.name)) === JSON.stringify(['awg0', 'tun0']), 'interfaces should keep their order');
for (const item of interfaces) {
  assert(item.section === 'main', 'interface child should reference its parent');
  assert(item.display_name === item.name, 'interface display name should default to its interface name');
  assert(item.domain_resolver_enabled === '0', 'resolver should default to disabled');
  assert(!Object.prototype.hasOwnProperty.call(item, 'domain_resolver_dns_type'), 'resolver protocol option should be removed');
  assert(JSON.stringify(item.domain_resolver_dns_server) === JSON.stringify(['8.8.8.8']), 'resolver server default should become a list');
}
NODE

cat >"$WORK_DIR/forkop-1.0.5-interfaces.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks",
      "dns_fallback_modes", "native_rule_sets", "universal_rule_sets",
      "leaf_subscription_providers", "extended_server_defaults",
      "fallback_uci_tags", "reset_fallback_defaults", "remove_proxy_parameter_filters",
      "server_filter_model", "server_filter_modes",
      "single_subscription_user_agent", "subscription_headers"
    ]
  },
  "section_interface": [
    {
      ".name": "cfg01", ".type": "section_interface",
      "section": "main", "name": "awg0"
    },
    {
      ".name": "cfg02", ".type": "section_interface",
      "section": "main", "name": "wg0", "display_name": "Home VPN"
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-interfaces.json" >"$WORK_DIR/forkop-1.0.5-interfaces-output.json"

node - "$WORK_DIR/forkop-1.0.5-interfaces-output.json" "$WORK_DIR/forkop-1.0.5-interfaces-migrated.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const interfaces = out.config.section_interface;

if (!out.changed || interfaces[0].display_name !== 'awg0') {
  throw new Error('1.0.5 interface did not receive its current name as display name');
}
if (interfaces[1].display_name !== 'Home VPN') {
  throw new Error('existing interface display name was overwritten');
}
if (!out.config.settings.applied_migrations.includes('interface_display_names')) {
  throw new Error('interface display name migration was not recorded');
}
fs.writeFileSync(process.argv[3], JSON.stringify(out.config));
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-interfaces-migrated.json" >"$WORK_DIR/forkop-1.0.5-interfaces-rerun.json"

node - "$WORK_DIR/forkop-1.0.5-interfaces-rerun.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (out.changed) {
  throw new Error('interface display name migration is not idempotent');
}
NODE

cat >"$WORK_DIR/forkop-1.0.5-resolver.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks",
      "dns_fallback_modes", "native_rule_sets", "universal_rule_sets",
      "leaf_subscription_providers", "extended_server_defaults",
      "fallback_uci_tags", "reset_fallback_defaults", "remove_proxy_parameter_filters",
      "server_filter_model", "server_filter_modes",
      "single_subscription_user_agent", "subscription_headers",
      "interface_display_names", "remove_section_cache",
      "remove_dashboard_sort_options", "dns_server_uris"
    ]
  },
  "section": [
    { ".name": "main", ".type": "section", "action": "connection", "label": "Main" }
  ],
  "section_interface": [
    {
      ".name": "cfg01", ".type": "section_interface",
      "section": "main", "name": "awg0", "display_name": "awg0",
      "domain_resolver_enabled": "1",
      "domain_resolver_dns_type": "doh",
      "domain_resolver_dns_server": "dns.example/dns-query"
    },
    {
      ".name": "cfg02", ".type": "section_interface",
      "section": "main", "name": "wg0", "display_name": "wg0",
      "domain_resolver_enabled": "1",
      "domain_resolver_dns_type": "dot",
      "domain_resolver_dns_server": "1.1.1.1:853"
    },
    {
      ".name": "cfg03", ".type": "section_interface",
      "section": "main", "name": "tun0", "display_name": "tun0",
      "domain_resolver_enabled": "0",
      "domain_resolver_dns_type": "udp",
      "domain_resolver_dns_server": "8.8.8.8"
    },
    {
      ".name": "cfg04", ".type": "section_interface",
      "section": "main", "name": "eth2", "display_name": "eth2",
      "domain_resolver_enabled": "1",
      "domain_resolver_dns_server": "tls://9.9.9.9"
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-resolver.json" >"$WORK_DIR/forkop-1.0.5-resolver-output.json"

node - "$WORK_DIR/forkop-1.0.5-resolver-output.json" "$WORK_DIR/forkop-1.0.5-resolver-migrated.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const interfaces = out.config.section_interface;
const assert = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

assert(out.changed === true, 'released interface resolvers must require migration');
assert(out.config.settings.applied_migrations.includes('interface_domain_resolver_uris'),
  'interface domain resolver URI migration must be recorded');

const expected = [
  ['https://dns.example/dns-query', 'DoH resolver must keep its host and path'],
  ['tls://1.1.1.1:853', 'DoT resolver must keep its explicit port'],
  ['8.8.8.8', 'a plain UDP resolver must stay a bare address'],
  ['tls://9.9.9.9', 'an interface without a protocol option must keep its URI'],
];
interfaces.forEach((item, index) => {
  assert(!Object.prototype.hasOwnProperty.call(item, 'domain_resolver_dns_type'),
    `interface ${item.name} must lose the removed protocol option`);
  assert(JSON.stringify(item.domain_resolver_dns_server) === JSON.stringify([expected[index][0]]),
    expected[index][1]);
  assert(!Object.prototype.hasOwnProperty.call(item, 'domain_resolver_dns_fallback_strategy'),
    `interface ${item.name} must not gain a redundant query mode`);
  assert(!Object.prototype.hasOwnProperty.call(item, 'domain_resolver_dns_detour_enabled'),
    `interface ${item.name} must not gain a redundant DNS detour flag`);
});

fs.writeFileSync(process.argv[3], JSON.stringify(out.config));
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-resolver-migrated.json" >"$WORK_DIR/forkop-1.0.5-resolver-rerun.json"

node - "$WORK_DIR/forkop-1.0.5-resolver-rerun.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (out.changed) {
  throw new Error('interface domain resolver URI migration is not idempotent');
}
NODE

cat >"$WORK_DIR/forkop-1.0.2-disabled.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.2",
    "component_update_check_enabled": "0"
  },
  "section": []
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture "$WORK_DIR/forkop-1.0.2-disabled.json" >"$WORK_DIR/forkop-1.0.2-disabled-output.json"

node - "$WORK_DIR/forkop-1.0.2-disabled-output.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

assert(out.config.settings.component_update_check_enabled === '0', '1.0.2 config must preserve an explicitly disabled component check');
assert(out.config.settings.config_version === '1.0.5', '1.0.2 config should advance through the HTTP URL migration schema');
assert(JSON.stringify(out.config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'dns_fallback_modes', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'reset_fallback_defaults', 'remove_proxy_parameter_filters', 'server_filter_model', 'server_filter_modes', 'single_subscription_user_agent', 'subscription_headers', 'interface_display_names', 'remove_section_cache', 'remove_dashboard_sort_options', 'dns_server_uris', 'interface_domain_resolver_uris', 'readable_runtime_tags', 'urltest_expected_status', 'group_interrupt_defaults', 'subscription_user_agent_header']), 'newer configs should mark skipped migrations');
NODE

cat >"$WORK_DIR/forkop-1.0.4-http.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.4"
  },
  "section": [
    {
      ".name": "main",
      ".type": "section",
      "action": "connection",
      "selector_proxy_links": [
        "https://user:p%2540ss@[2001:db8::1]:8443/#Secure%20HTTP",
        "vless://00000000-0000-4000-8000-000000000001@example.com:443",
        "http://proxy.example:8080",
        "https://invalid.example/no-port"
      ],
      "outbound_jsons": [
        "{\"type\":\"direct\",\"tag\":\"http\"}"
      ]
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture "$WORK_DIR/forkop-1.0.4-http.json" >"$WORK_DIR/forkop-1.0.4-http-output.json"

node - "$WORK_DIR/forkop-1.0.4-http-output.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const section = out.config.section[0];
const jsonOutbounds = section.outbound_jsons.map(JSON.parse);

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

assert(out.config.settings.config_version === '1.0.5', '1.0.4 config should advance to schema 1.0.5');
assert(JSON.stringify(section.selector_proxy_links) === JSON.stringify([
  'https://user:p%2540ss@[2001:db8::1]:8443/#Secure%20HTTP',
  'vless://00000000-0000-4000-8000-000000000001@example.com:443',
  'http://proxy.example:8080',
  'https://invalid.example/no-port',
]), 'connection URLs must stay owned by sing-box parser outbounds');
assert(jsonOutbounds.length === 1 && jsonOutbounds[0].type === 'direct' && jsonOutbounds[0].tag === 'http',
  'the retired HTTP conversion must leave existing JSON outbounds unchanged');
assert(JSON.stringify(out.config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'dns_fallback_modes', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'reset_fallback_defaults', 'remove_proxy_parameter_filters', 'server_filter_model', 'server_filter_modes', 'single_subscription_user_agent', 'subscription_headers', 'interface_display_names', 'remove_section_cache', 'remove_dashboard_sort_options', 'dns_server_uris', 'interface_domain_resolver_uris', 'readable_runtime_tags', 'urltest_expected_status', 'group_interrupt_defaults', 'subscription_user_agent_header']), 'HTTP URL migration should be recorded');
NODE

cat >"$WORK_DIR/forkop-1.0.5-http.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.5"
  },
  "section": [
    {
      ".name": "main",
      ".type": "section",
      "action": "connection",
      "selector_proxy_links": [ "http://proxy.example:8080" ],
      "subscription_url_settings": "{\"https://example.com/subscription\":{\"auto_user_agent\":\"0\",\"user_agent\":\"Happ\",\"include_urltest_groups\":\"1\",\"hide_urltest_group_outbounds\":\"1\",\"hide_detour_outbounds\":\"1\",\"include_proxy_parameters\":\"1\",\"include_protocols\":[\"vless\"]},\"https://example.com/auto\":{\"auto_user_agent\":\"1\",\"user_agent\":\"v2rayN\"}}",
      "urltest_settings": "{\"fast\":{\"include_regex\":[\"ok\"],\"include_proxy_parameters\":\"1\",\"include_transports\":[\"grpc\"]}}",
      "fallback_level_settings": "{\"legacy\":{\"name\":\"Legacy\",\"exclude_proxy_parameters\":\"1\",\"exclude_securities\":[\"tls\"]}}"
    }
  ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "main",
      "url": "https://example.com/subscription", "auto_user_agent": "0", "user_agent": "Happ",
      "auto_hwid": "0", "hwid": "custom-router-hwid",
      "filter_mode": "mixed",
      "include_countries": [ "RU", "US" ],
      "include_regex": [ "fast", "premium" ],
      "exclude_outbounds": [ "Expired node" ],
      "include_proxy_parameters": "1", "include_protocols": [ "vless" ]
    },
    {
      ".name": "source_auto", ".type": "subscription_url", "section": "main",
      "url": "https://example.com/auto", "auto_user_agent": "1", "user_agent": "v2rayN", "auto_hwid": "1"
    }
  ],
  "urltest": [
    {
      ".name": "fast", ".type": "urltest", "section": "main", "name": "Fast",
      "filter_mode": "exclude",
      "exclude_countries": [ "DE" ],
      "exclude_regex": [ "slow", "expired" ],
      "exclude_proxy_parameters": "1", "exclude_transports": [ "grpc" ]
    }
  ],
  "priority_group": [
    {
      ".name": "release-group", ".type": "priority_group", "section": "main", "name": "Release fallback",
      "health_url": "https://release.example/204", "active_check_interval": "10s", "check_timeout": "2s",
      "interrupt_exist_connections": "0", "pin_dashboard": "0"
    }
  ],
  "priority_level": [
    {
      ".name": "release-level", ".type": "priority_level", "group": "release-group", "name": "Release level",
      "filter_mode": "include", "server_name": [ "Release node" ], "regex": [ "release" ]
    }
  ],
  "fallback_level": [
    {
      ".name": "level", ".type": "fallback_level", "group": "group", "name": "Level",
      "filter_mode": "include",
      "country": [ "NL" ],
      "server_name": [ "Primary node" ],
      "regex": [ "primary", "backup" ],
      "include_proxy_parameters": "1", "include_securities": [ "reality" ]
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture "$WORK_DIR/forkop-1.0.5-http.json" >"$WORK_DIR/forkop-1.0.5-http-output.json"

node - "$WORK_DIR/forkop-1.0.5-http-output.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const section = out.config.section[0];

if (JSON.stringify(section.selector_proxy_links) !== JSON.stringify(['http://proxy.example:8080']) || section.outbound_jsons) {
  console.error('1.0.5 and newer configs must not run the legacy HTTP URL conversion');
  process.exit(1);
}
const subscriptionSettings = JSON.parse(section.subscription_url_settings);
if (JSON.stringify(subscriptionSettings) !== JSON.stringify({
  'https://example.com/subscription': { header: ['User-Agent: Happ'] },
  'https://example.com/auto': { header: ['User-Agent: sing-box'] },
})) {
  console.error('subscription settings migration must move custom User-Agent values into the request headers');
  process.exit(1);
}
const urltestSettings = JSON.parse(section.urltest_settings);
const fallbackSettings = JSON.parse(section.fallback_level_settings);
if (JSON.stringify(urltestSettings) !== JSON.stringify({ fast: { include_regex: 'ok', server_filter_mode: 'all' } }) ||
    JSON.stringify(fallbackSettings) !== JSON.stringify({ legacy: { name: 'Legacy' } })) {
  console.error('proxy parameter migration must clean legacy JSON settings without losing other filters');
  process.exit(1);
}
const source = out.config.subscription_url[0];
const autoSource = out.config.subscription_url[1];
const urltest = out.config.urltest[0];
const level = out.config.fallback_level.find(item => item['.name'] === 'level');
const releaseLevel = out.config.fallback_level.find(item => item['.name'] === 'release-level');
const releaseGroup = out.config.fallback_group.find(item => item['.name'] === 'release-group');
const headerValue = (item, name) => {
  const prefix = `${name}:`.toLowerCase();
  const line = (item.header || []).find(value => `${value}`.toLowerCase().startsWith(prefix));
  return line == null ? undefined : `${line}`.slice(`${line}`.indexOf(':') + 1).trim();
};
if (source.server_filter_mode !== 'include' ||
    source.include_regex !== '(?:fast)|(?:premium)|(?:🇷🇺)|(?:🇺🇸)' ||
    JSON.stringify(source.exclude_outbounds) !== JSON.stringify(['Expired node']) ||
    Object.prototype.hasOwnProperty.call(source, 'filter_mode') ||
    Object.prototype.hasOwnProperty.call(source, 'include_countries')) {
  console.error('subscription filters were not migrated to the unified model');
  process.exit(1);
}
if (headerValue(source, 'User-Agent') !== 'Happ' ||
    `${source.header[0]}` !== 'User-Agent: Happ' ||
    Object.prototype.hasOwnProperty.call(source, 'user_agent') ||
    Object.prototype.hasOwnProperty.call(source, 'auto_user_agent') ||
    headerValue(autoSource, 'User-Agent') !== 'sing-box' ||
    Object.prototype.hasOwnProperty.call(autoSource, 'user_agent') ||
    Object.prototype.hasOwnProperty.call(autoSource, 'auto_user_agent')) {
  console.error('subscription child migration must move custom User-Agent values into the request headers');
  process.exit(1);
}
if (headerValue(source, 'X-HWID') !== 'custom-router-hwid' ||
    !headerValue(autoSource, 'X-HWID') ||
    source.auto_hwid !== undefined || source.hwid !== undefined ||
    autoSource.auto_hwid !== undefined || autoSource.hwid !== undefined) {
  console.error('subscription header migration must preserve a custom HWID and materialize automatic request headers');
  process.exit(1);
}
if (urltest.server_filter_mode !== 'exclude' ||
    urltest.exclude_regex !== '(?:slow)|(?:expired)|(?:🇩🇪)' ||
    Object.prototype.hasOwnProperty.call(urltest, 'filter_mode') ||
    Object.prototype.hasOwnProperty.call(urltest, 'exclude_countries')) {
  console.error('URLTest filters were not migrated to the unified model');
  process.exit(1);
}
if (level.server_filter_mode !== 'include' ||
    JSON.stringify(level.include_outbounds) !== JSON.stringify(['Primary node']) ||
    level.include_regex !== '(?:primary)|(?:backup)|(?:🇳🇱)' ||
    Object.prototype.hasOwnProperty.call(level, 'filter_mode') ||
    Object.prototype.hasOwnProperty.call(level, 'country') ||
    Object.prototype.hasOwnProperty.call(level, 'server_name') ||
    Object.prototype.hasOwnProperty.call(level, 'regex')) {
  console.error('Fallback filters were not migrated to the unified model');
  process.exit(1);
}
if (!releaseGroup || releaseGroup.health_check_url !== 'https://release.example/204' ||
    JSON.stringify(Object.keys(releaseGroup).sort()) !== JSON.stringify(['.name', '.type', 'health_check_url', 'name', 'section'])) {
  console.error('1.0.5 Fallback settings were not reset while preserving the selected URL');
  process.exit(1);
}
if (!releaseLevel || releaseLevel.server_filter_mode !== 'include' ||
    JSON.stringify(releaseLevel.include_outbounds) !== JSON.stringify(['Release node']) ||
    releaseLevel.include_regex !== 'release') {
  console.error(`1.0.5 Fallback level filters were not preserved: ${JSON.stringify(releaseLevel)}`);
  process.exit(1);
}
const removedFields = [
  'include_proxy_parameters', 'include_protocols', 'include_transports', 'include_securities',
  'exclude_proxy_parameters', 'exclude_protocols', 'exclude_transports', 'exclude_securities',
];
for (const child of [...(out.config.subscription_url || []), ...(out.config.urltest || []), ...(out.config.fallback_level || [])]) {
  if (removedFields.some(key => Object.prototype.hasOwnProperty.call(child, key))) {
    console.error('proxy parameter migration left a removed child-section field');
    process.exit(1);
  }
}
NODE

cat >"$WORK_DIR/readable-runtime-tags.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings", "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks", "dns_fallback_modes",
      "native_rule_sets", "universal_rule_sets", "leaf_subscription_providers",
      "extended_server_defaults", "fallback_uci_tags", "reset_fallback_defaults",
      "remove_proxy_parameter_filters", "server_filter_model", "server_filter_modes",
      "single_subscription_user_agent", "subscription_headers", "interface_display_names",
      "remove_section_cache", "remove_dashboard_sort_options", "dns_server_uris",
      "interface_domain_resolver_uris"
    ]
  },
  "section": [
    { ".name": "main", ".type": "section", "label": "Office/Main" },
    { ".name": "backup", ".type": "section", "label": "Office／Main" }
  ],
  "server": [
    { ".name": "server1", ".type": "server", "label": "Public" },
    { ".name": "server2", ".type": "server", "label": "Public" }
  ],
  "subscription_url": [
    { ".name": "sub1", ".type": "subscription_url", "section": "main", "node_prefix": "Premium/One", "prefix_nodes": "1" },
    { ".name": "sub2", ".type": "subscription_url", "section": "main", "tag": "Premium／One" },
    { ".name": "sub3", ".type": "subscription_url", "section": "backup" }
  ],
  "fallback_group": [
    { ".name": "group1", ".type": "fallback_group", "section": "main", "name": "Recovery" },
    { ".name": "group2", ".type": "fallback_group", "section": "main", "name": "Recovery" }
  ],
  "fallback_level": [
    { ".name": "level1", ".type": "fallback_level", "group": "group1", "name": "Primary" },
    { ".name": "level2", ".type": "fallback_level", "group": "group1", "name": "Primary" }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/readable-runtime-tags.json" >"$WORK_DIR/readable-runtime-tags-output.json"

node - "$WORK_DIR/readable-runtime-tags-output.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const config = out.config;
const assert = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

assert(JSON.stringify(config.section.map(item => item.label)) === JSON.stringify(['Office／Main', 'Office／Main #2']),
  'section display names must become slash-safe and globally unique');
assert(JSON.stringify(config.server.map(item => item.label)) === JSON.stringify(['Public', 'Public #2']),
  'server display names must become globally unique');
assert(JSON.stringify(config.subscription_url.map(item => item.tag)) === JSON.stringify(['Premium／One', 'Premium／One #2', 'sub1']),
  'subscription tags must migrate from the old prefix, deduplicate per section, and receive stable defaults');
assert(config.subscription_url.every(item => !Object.prototype.hasOwnProperty.call(item, 'node_prefix')),
  'the old subscription node prefix must be removed');
assert(config.subscription_url[0].show_subscription_name === '1' &&
  config.subscription_url.every(item => !Object.prototype.hasOwnProperty.call(item, 'prefix_nodes')),
  'the dashboard subscription-name toggle must survive migration');
assert(JSON.stringify(config.fallback_group.map(item => item.name)) === JSON.stringify(['Recovery', 'Recovery #2']),
  'Fallback groups must be unique within a section');
assert(JSON.stringify(config.fallback_level.map(item => item.name)) === JSON.stringify(['Primary', 'Primary #2']),
  'server groups must be unique within a Fallback');
assert(out.removed_caches.includes('/var/run/forkop/section-cache') &&
  out.removed_caches.includes('/var/run/forkop/runtime-manifest.json'),
  'readable tag migration must remove both legacy runtime graph files');
assert(config.settings.applied_migrations.at(-1) === 'subscription_user_agent_header',
  'readable runtime tag migration must be recorded');
NODE

cat >"$WORK_DIR/group-interrupt-defaults.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings", "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks", "dns_fallback_modes",
      "native_rule_sets", "universal_rule_sets", "leaf_subscription_providers",
      "extended_server_defaults", "fallback_uci_tags", "reset_fallback_defaults",
      "remove_proxy_parameter_filters", "server_filter_model", "server_filter_modes",
      "single_subscription_user_agent", "subscription_headers", "interface_display_names",
      "remove_section_cache", "remove_dashboard_sort_options", "dns_server_uris",
      "interface_domain_resolver_uris", "readable_runtime_tags", "urltest_expected_status"
    ]
  },
  "section": [{ ".name": "main", ".type": "section", "label": "Main" }],
  "urltest": [
    { ".name": "fast", ".type": "urltest", "section": "main", "name": "Fastest", "interrupt_exist_connections": "1" },
    { ".name": "kept", ".type": "urltest", "section": "main", "name": "Kept", "interrupt_exist_connections": "0" }
  ],
  "fallback_group": [
    { ".name": "group1", ".type": "fallback_group", "section": "main", "name": "Recovery", "interrupt_exist_connections": "1" }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture   "$WORK_DIR/group-interrupt-defaults.json" >"$WORK_DIR/group-interrupt-defaults-output.json"
node -e 'const fs = require("fs");
fs.writeFileSync(process.argv[2], JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).config));'   "$WORK_DIR/group-interrupt-defaults-output.json" "$WORK_DIR/group-interrupt-defaults-once.json"
FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture   "$WORK_DIR/group-interrupt-defaults-once.json" >"$WORK_DIR/group-interrupt-defaults-rerun.json"

node - "$WORK_DIR/group-interrupt-defaults-output.json" "$WORK_DIR/group-interrupt-defaults-rerun.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rerun = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const assert = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};
const has = (item) => Object.prototype.hasOwnProperty.call(item, 'interrupt_exist_connections');

const urltests = Object.fromEntries(out.config.urltest.map((item) => [item['.name'], item]));
assert(!has(urltests.fast), 'the released URLTest interrupt default must be dropped so the new default applies');
assert(urltests.kept.interrupt_exist_connections === '0', 'an explicit disabled flag must survive migration');
assert(!has(out.config.fallback_group[0]), 'the released Fallback interrupt default must be dropped');
assert(out.changed === true, 'dropping the released defaults must report a change');
assert(JSON.stringify(rerun.config.urltest) === JSON.stringify(out.config.urltest) &&
  JSON.stringify(rerun.config.fallback_group) === JSON.stringify(out.config.fallback_group),
  'rerunning the interrupt default migration must not change the groups again');
assert(!rerun.operations.some((item) => item.option === 'interrupt_exist_connections'),
  'rerunning the interrupt default migration must not touch the option again');
NODE

cat >"$WORK_DIR/forkop-1.0.5-dashboard-sort.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks",
      "dns_fallback_modes", "native_rule_sets", "universal_rule_sets",
      "leaf_subscription_providers", "extended_server_defaults",
      "fallback_uci_tags", "reset_fallback_defaults",
      "remove_proxy_parameter_filters", "server_filter_model",
      "server_filter_modes", "single_subscription_user_agent",
      "subscription_headers", "interface_display_names", "remove_section_cache"
    ]
  },
  "section": [
    {
      ".name": "main", ".type": "section", "action": "connection",
      "sort_by_latency": "1"
    }
  ],
  "urltest": [
    {
      ".name": "fast", ".type": "urltest", "section": "main",
      "name": "Fast", "pin_dashboard": "0"
    }
  ],
  "fallback_group": [
    {
      ".name": "fallback", ".type": "fallback_group", "section": "main",
      "name": "Fallback", "pin_dashboard": "1"
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-dashboard-sort.json" >"$WORK_DIR/forkop-1.0.5-dashboard-sort-output.json"

node - "$WORK_DIR/forkop-1.0.5-dashboard-sort-output.json" "$WORK_DIR/forkop-1.0.5-dashboard-sort-rerun.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const config = out.config;

if (!out.changed || config.section[0].sort_by_latency !== undefined ||
    config.urltest[0].pin_dashboard !== undefined ||
    config.fallback_group[0].pin_dashboard !== undefined) {
  console.error('dashboard sort UCI options were not deleted');
  process.exit(1);
}
if (config.urltest[0].name !== 'Fast' || config.fallback_group[0].name !== 'Fallback' ||
    !config.settings.applied_migrations.includes('remove_dashboard_sort_options') ||
    config.settings.applied_migrations.at(-1) !== 'subscription_user_agent_header') {
  console.error('dashboard sort migration changed unrelated settings or missed its marker');
  process.exit(1);
}

fs.writeFileSync(process.argv[3], JSON.stringify(config));
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-dashboard-sort-rerun.json" >"$WORK_DIR/forkop-1.0.5-dashboard-sort-rerun-output.json"

node - "$WORK_DIR/forkop-1.0.5-dashboard-sort-output.json" "$WORK_DIR/forkop-1.0.5-dashboard-sort-rerun-output.json" <<'NODE'
const fs = require('fs');
const first = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const second = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

if (second.changed || JSON.stringify(first.config) !== JSON.stringify(second.config)) {
  console.error('dashboard sort UCI option removal is not idempotent');
  process.exit(1);
}
NODE

cat >"$WORK_DIR/forkop-1.0.5-dns.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks",
      "dns_fallback_modes", "native_rule_sets", "universal_rule_sets",
      "leaf_subscription_providers", "extended_server_defaults",
      "fallback_uci_tags", "reset_fallback_defaults", "remove_proxy_parameter_filters",
      "server_filter_model", "server_filter_modes", "single_subscription_user_agent",
      "subscription_headers", "interface_display_names", "remove_section_cache",
      "remove_dashboard_sort_options"
    ],
    "dns_type": "doh",
    "dns_server": [ "dns.google/dns-query", "1.1.1.1:444/custom" ],
    "bootstrap_dns_server": [ "1.1.1.1", "[2606:4700:4700::1111]:5353" ]
  },
  "section": [
    {
      ".name": "dot", ".type": "section", "action": "dns",
      "dns_type": "dot", "dns_server": "9.9.9.9:5353",
      "domain_suffix": [ "dot.example" ]
    },
    {
      ".name": "doh", ".type": "section", "action": "dns",
      "dns_type": "doh", "dns_server": "dns.example/dns-query",
      "domain_suffix": [ "doh.example" ]
    },
    {
      ".name": "udp", ".type": "section", "action": "dns",
      "dns_type": "udp",
      "dns_server": "8.8.8.8",
      "domain_suffix": [ "udp.example" ]
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-dns.json" >"$WORK_DIR/forkop-1.0.5-dns-output.json"

node - "$WORK_DIR/forkop-1.0.5-dns-output.json" "$WORK_DIR/forkop-1.0.5-dns-rerun.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const config = out.config;
const sections = Object.fromEntries(config.section.map(section => [section['.name'], section]));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(out.changed, 'Forkop 1.0.5 DNS configuration should require URI migration');
assert(config.settings.dns_type === undefined, 'global DNS protocol selector should be removed');
assert(JSON.stringify(config.settings.dns_server) === JSON.stringify([
  'https://dns.google/dns-query',
  'https://1.1.1.1:444/custom',
]), 'main DNS servers should preserve DoH hosts, ports, paths, and order');
assert(JSON.stringify(config.settings.bootstrap_dns_server) === JSON.stringify([
  '1.1.1.1',
  '[2606:4700:4700::1111]:5353',
]), 'Bootstrap DNS servers should preserve their UDP endpoints and order without a redundant scheme');
assert(sections.dot.dns_type === undefined &&
  JSON.stringify(sections.dot.dns_server) === JSON.stringify(['tls://9.9.9.9:5353']),
  'DNS action should preserve the old DoT server as a list');
assert(sections.doh.dns_type === undefined &&
  JSON.stringify(sections.doh.dns_server) === JSON.stringify(['https://dns.example/dns-query']),
  'DNS action should preserve the old DoH path as a list');
assert(JSON.stringify(sections.udp.dns_server) === JSON.stringify(['8.8.8.8']),
  'DNS action should migrate explicit UDP without a redundant scheme');
assert(config.settings.applied_migrations.at(-1) === 'subscription_user_agent_header',
  'DNS URI migration marker should be recorded');

fs.writeFileSync(process.argv[3], JSON.stringify(config));
NODE

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture \
  "$WORK_DIR/forkop-1.0.5-dns-rerun.json" >"$WORK_DIR/forkop-1.0.5-dns-rerun-output.json"

node - "$WORK_DIR/forkop-1.0.5-dns-output.json" "$WORK_DIR/forkop-1.0.5-dns-rerun-output.json" <<'NODE'
const fs = require('fs');
const first = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const second = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (second.changed || JSON.stringify(first.config) !== JSON.stringify(second.config)) {
  throw new Error('DNS server URI migration is not idempotent');
}
NODE

cat >"$WORK_DIR/filter-enabled.json" <<'JSON'
{
  "settings": {
    ".name": "settings",
    ".type": "settings",
    "config_version": "1.0.5",
    "applied_migrations": [
      "interface_sections", "enable_component_checks", "http_connection_urls",
      "remove_server_country_and_dashboard_filter", "native_fallbacks",
      "native_rule_sets", "universal_rule_sets", "leaf_subscription_providers",
      "extended_server_defaults", "fallback_uci_tags", "reset_fallback_defaults",
      "remove_proxy_parameter_filters", "server_filter_model",
      "single_subscription_user_agent"
    ]
  },
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "main",
      "url": "https://example.com/sub", "filter_enabled": "1",
      "exclude_regex": "backup"
    }
  ],
  "urltest": [
    {
      ".name": "test", ".type": "urltest", "section": "main",
      "name": "Test", "filter_enabled": "1", "include_regex": "fast"
    }
  ],
  "fallback_level": [
    {
      ".name": "direct", ".type": "fallback_level", "group": "group",
      "name": "Direct", "direct": "1", "filter_enabled": "0"
    },
    {
      ".name": "remaining", ".type": "fallback_level", "group": "group",
      "name": "Remaining", "direct": "0", "filter_enabled": "0"
    }
  ]
}
JSON

FORKOP_LIB="$FORKOP_LIB" ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-fixture "$WORK_DIR/filter-enabled.json" >"$WORK_DIR/filter-enabled-output.json"

node - "$WORK_DIR/filter-enabled-output.json" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const source = out.config.subscription_url[0];
const urltest = out.config.urltest[0];
const levels = Object.fromEntries(out.config.fallback_level.map(level => [level['.name'], level]));

if (source.server_filter_mode !== 'exclude' ||
    urltest.server_filter_mode !== 'include' ||
    levels.direct.server_filter_mode !== 'direct' ||
    levels.remaining.server_filter_mode !== 'all') {
  console.error('boolean server filters were not migrated to explicit modes');
  process.exit(1);
}
for (const item of [source, urltest, ...Object.values(levels)]) {
  if (Object.prototype.hasOwnProperty.call(item, 'filter_enabled') ||
      Object.prototype.hasOwnProperty.call(item, 'direct')) {
    console.error('boolean server filter migration left obsolete fields');
    process.exit(1);
  }
}
NODE

cat >"$WORK_DIR/runtime-migrate.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.routing_excluded_ips=192.0.2.0/24
forkop.legacy=rule
forkop.legacy.enabled=1
forkop.legacy.connection_type=proxy
forkop.legacy.proxy_config_type=url
forkop.legacy.proxy_string=vless://one
forkop.old_direct=section
forkop.old_direct.enabled=1
forkop.old_direct.action=direct
forkop.vpn=section
forkop.vpn.enabled=1
forkop.vpn.connection_type=vpn
forkop.vpn.interface=awg0
forkop.vpn.domain_resolver_enabled=1
forkop.vpn.domain_resolver_dns_type=doh
forkop.vpn.domain_resolver_dns_server=https://dns.example/dns-query
EOF_UCI
mkdir -p "$WORK_DIR/runtime" "$WORK_DIR/persistent-cache"
: >"$WORK_DIR/runtime-migrate.log"
FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime-migrate.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/runtime-migrate.log" \
FORKOP_CONFIG_NAME="forkop" \
TMP_SUBSCRIPTION_FOLDER="$WORK_DIR/tmp-subscriptions" \
FORKOP_RUNTIME_STATE_DIR="$WORK_DIR/runtime" \
FORKOP_PERSISTENT_SUBSCRIPTION_CACHE_DIR="$WORK_DIR/persistent-cache" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate-podkop

grep -Fxq 'forkop.legacy=section' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime migration must convert legacy rule type through core.uci"
grep -Fxq 'forkop.legacy.action=connection' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime migration must write migrated action through core.uci"
grep -Fxq 'forkop.old_direct.action=bypass' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime migration must convert direct action to bypass through core.uci"
grep -Eq '^forkop\\.cfg[0-9a-f]+=$' "$WORK_DIR/runtime-migrate.state" && fail "anonymous fixture section should include a type"
grep -Fxq 'forkop.legacy.selector_proxy_links=vless://one' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime migration must keep connection URLs in the parent section"
if grep -Fq '=connection_url' "$WORK_DIR/runtime-migrate.state"; then
  fail "runtime migration must not create connection_url child sections"
fi
grep -Eq '^forkop\.cfg[0-9a-f]+=section_interface$' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime migration must create an anonymous interface settings section"
grep -Eq '^forkop\.cfg[0-9a-f]+\.section=vpn$' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime interface settings section must reference its parent"
grep -Eq '^forkop\.cfg[0-9a-f]+\.name=' "$WORK_DIR/runtime-migrate.state" ||
  fail "runtime interface settings section must store the interface name"
if grep -Fq 'forkop.legacy.urltest_enabled=' "$WORK_DIR/runtime-migrate.state"; then
  fail "runtime migration must delete migrated urltest_enabled through core.uci"
fi
if grep -Fq 'forkop.settings.routing_excluded_ips=' "$WORK_DIR/runtime-migrate.state"; then
  fail "runtime migration must delete removed routing_excluded_ips through core.uci"
fi
if grep -Fq 'forkop.legacy.proxy_string=' "$WORK_DIR/runtime-migrate.state"; then
  fail "runtime migration must delete legacy proxy_string through core.uci"
fi
grep -Fxq 'commit forkop' "$WORK_DIR/runtime-migrate.log" ||
  fail "runtime migration must commit through core.uci"

cat >"$WORK_DIR/runtime-version.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.1
forkop.settings.component_update_check_enabled=0
forkop.main=section
forkop.main.enabled=1
forkop.main.action=connection
forkop.main.interfaces=awg0
forkop.main.selector_proxy_links=http://proxy.example:8080
EOF_UCI
: >"$WORK_DIR/runtime-version.log"
FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime-version.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/runtime-version.log" \
FORKOP_CONFIG_NAME="forkop" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate

grep -Fxq 'forkop.settings.config_version=1.0.5' "$WORK_DIR/runtime-version.state" ||
  fail "runtime version migration must advance config_version"
grep -Fxq 'forkop.settings.component_update_check_enabled=1' "$WORK_DIR/runtime-version.state" ||
  fail "runtime version migration must enable component update checks"
grep -Fq 'forkop.settings.applied_migrations=interface_sections enable_component_checks http_connection_urls remove_server_country_and_dashboard_filter native_fallbacks dns_fallback_modes native_rule_sets universal_rule_sets leaf_subscription_providers extended_server_defaults fallback_uci_tags reset_fallback_defaults remove_proxy_parameter_filters server_filter_model server_filter_modes single_subscription_user_agent subscription_headers interface_display_names remove_section_cache remove_dashboard_sort_options dns_server_uris interface_domain_resolver_uris readable_runtime_tags urltest_expected_status group_interrupt_defaults subscription_user_agent_header' "$WORK_DIR/runtime-version.state" ||
  fail "runtime migration must record stable migration names"
grep -Fxq 'forkop.main.selector_proxy_links=http://proxy.example:8080' "$WORK_DIR/runtime-version.state" ||
  fail "runtime migration must preserve connection URLs for sing-box parser outbounds"
if grep -Fq 'forkop.main.outbound_jsons=' "$WORK_DIR/runtime-version.state"; then
  fail "runtime migration must not synthesize local JSON outbounds from connection URLs"
fi
grep -Eq '^forkop\.cfg[0-9a-f]+=section_interface$' "$WORK_DIR/runtime-version.state" ||
  fail "runtime version migration must create interface child settings"
if grep -Fq 'forkop.main.interfaces=' "$WORK_DIR/runtime-version.state"; then
  fail "runtime version migration must remove the parent interface list"
fi

: >"$WORK_DIR/runtime-version.log"
FORKOP_UCI_STATE_FILE="$WORK_DIR/runtime-version.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/runtime-version.log" \
FORKOP_CONFIG_NAME="forkop" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate
if grep -Fq 'commit forkop' "$WORK_DIR/runtime-version.log"; then
  fail "completed named migrations must be idempotent"
fi

cat >"$WORK_DIR/section-cache-removal.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.5
forkop.settings.applied_migrations=interface_sections enable_component_checks http_connection_urls remove_server_country_and_dashboard_filter native_fallbacks dns_fallback_modes native_rule_sets universal_rule_sets leaf_subscription_providers extended_server_defaults fallback_uci_tags reset_fallback_defaults remove_proxy_parameter_filters server_filter_model server_filter_modes single_subscription_user_agent subscription_headers interface_display_names
forkop.main=section
forkop.main.enabled=1
forkop.main.action=connection
forkop.main.outbound_jsons={"type":"direct"}
EOF_UCI
mkdir -p "$WORK_DIR/section-cache-removal/runtime/section-cache/nested"
printf 'old main cache\n' >"$WORK_DIR/section-cache-removal/runtime/section-cache/main.json"
printf 'old nested cache\n' >"$WORK_DIR/section-cache-removal/runtime/section-cache/nested/stale.json"
printf '{"old":"manifest"}\n' >"$WORK_DIR/section-cache-removal/runtime/runtime-manifest.json"
: >"$WORK_DIR/section-cache-removal.log"
FORKOP_UCI_STATE_FILE="$WORK_DIR/section-cache-removal.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/section-cache-removal.log" \
FORKOP_CONFIG_NAME="forkop" \
FORKOP_RUNTIME_STATE_DIR="$WORK_DIR/section-cache-removal/runtime" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate
[ ! -e "$WORK_DIR/section-cache-removal/runtime/section-cache" ] ||
  fail "1.0.5 migration must remove the complete legacy section-cache directory"
[ ! -e "$WORK_DIR/section-cache-removal/runtime/runtime-manifest.json" ] ||
  fail "readable tag migration must remove the obsolete runtime manifest"
grep -Fq 'remove_section_cache' "$WORK_DIR/section-cache-removal.state" ||
  fail "1.0.5 migration must record section-cache removal"
: >"$WORK_DIR/section-cache-removal.log"
FORKOP_UCI_STATE_FILE="$WORK_DIR/section-cache-removal.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/section-cache-removal.log" \
FORKOP_CONFIG_NAME="forkop" \
FORKOP_RUNTIME_STATE_DIR="$WORK_DIR/section-cache-removal/runtime" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate
if grep -Fq 'commit forkop' "$WORK_DIR/section-cache-removal.log"; then
  fail "section-cache removal migration must be idempotent"
fi

cat >"$WORK_DIR/cache-cleanup.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.5
forkop.settings.applied_migrations=interface_sections enable_component_checks http_connection_urls remove_server_country_and_dashboard_filter
forkop.settings.dns_fallback_strategy=sequential
forkop.settings.dns_check_interval=10s
forkop.settings.dns_recovery_check_interval=60s
forkop.settings.dns_check_timeout=2s
forkop.main=section
forkop.main.action=bypass
forkop.main.domain_ip_lists=existing.txt duplicate.txt
forkop.main.local_domain_lists=local-domains.txt duplicate.txt
forkop.main.local_subnet_lists=/etc/forkop/local-subnets.txt
forkop.main.remote_domain_lists=https://example.com/domains.txt
forkop.main.remote_subnet_lists=https://example.com/subnets.txt duplicate.txt
forkop.subscription=subscription_url
forkop.subscription.section=main
forkop.subscription.url=https://example.com/subscription
forkop.subscription.include_urltest_groups=1
forkop.subscription.hide_urltest_group_outbounds=1
forkop.subscription.hide_detour_outbounds=1
forkop.priority=priority_group
forkop.priority.section=main
forkop.priority.recovery_check_interval=45s
forkop.priority.health_url=https://example.com/ping
forkop.priority.pick_fastest=1
forkop.naive=server
forkop.naive.protocol=naive
forkop.tuic=server
forkop.tuic.protocol=tuic
forkop.tuic.tuic_heartbeat=20s
forkop.legacy_vless=server
forkop.legacy_vless.protocol=vless
forkop.legacy_vless.server_users=client|33333333-3333-4333-8333-333333333333|xtls-rprx-vision
EOF_UCI
mkdir -p \
  "$WORK_DIR/cache-migration/tmp-subscriptions" \
  "$WORK_DIR/cache-migration/persistent" \
  "$WORK_DIR/cache-migration/runtime/subscription-update" \
  "$WORK_DIR/cache-migration/runtime/subscription-links" \
  "$WORK_DIR/cache-migration/runtime/subscription-metadata" \
  "$WORK_DIR/cache-migration/runtime/outbound-metadata" \
  "$WORK_DIR/cache-migration/runtime/section-cache" \
  "$WORK_DIR/cache-migration/runtime/subscription-update.lock" \
  "$WORK_DIR/cache-migration/runtime/subscription-update-jobs" \
  "$WORK_DIR/cache-migration/legacy-rulesets"
for path in \
  "$WORK_DIR/cache-migration/tmp-subscriptions/stale" \
  "$WORK_DIR/cache-migration/persistent/stale" \
  "$WORK_DIR/cache-migration/runtime/subscription-update/stale" \
  "$WORK_DIR/cache-migration/runtime/subscription-links/stale" \
  "$WORK_DIR/cache-migration/runtime/subscription-metadata/stale" \
  "$WORK_DIR/cache-migration/runtime/outbound-metadata/stale" \
  "$WORK_DIR/cache-migration/runtime/section-cache/stale" \
  "$WORK_DIR/cache-migration/runtime/subscription-update.lock/stale" \
  "$WORK_DIR/cache-migration/runtime/subscription-update-jobs/active" \
  "$WORK_DIR/cache-migration/runtime/cache-format" \
  "$WORK_DIR/cache-migration/runtime/dns-failover.json" \
  "$WORK_DIR/cache-migration/runtime/dns-failover.pid" \
  "$WORK_DIR/cache-migration/runtime/priority.pid" \
  "$WORK_DIR/cache-migration/runtime/subscription-bootstrap-retry.pid" \
  "$WORK_DIR/cache-migration/runtime/list-update.timestamp" \
  "$WORK_DIR/cache-migration/list-update.pid" \
  "$WORK_DIR/cache-migration/legacy-rulesets/stale"; do
  printf 'stale\n' >"$path"
done

cat >"$WORK_DIR/fake-crontab" <<'EOF_CRONTAB_BIN'
#!/bin/sh
if [ "$1" = "-l" ]; then
  cat "$FORKOP_TEST_CRONTAB"
else
  cp "$1" "$FORKOP_TEST_CRONTAB"
fi
EOF_CRONTAB_BIN
chmod +x "$WORK_DIR/fake-crontab"
cat >"$WORK_DIR/legacy.crontab" <<'EOF_CRONTAB'
0 1 * * * /bin/true # keep
* * * * * /usr/bin/forkop list_update_if_due # forkop-list-update
* * * * * /usr/bin/forkop subscription_update_if_due # forkop-subscription-update
0 2 * * * /usr/bin/forkop component_updates_if_due # forkop-component-update-check
EOF_CRONTAB

FORKOP_UCI_STATE_FILE="$WORK_DIR/cache-cleanup.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/runtime-version.log" \
FORKOP_CONFIG_NAME="forkop" \
TMP_SUBSCRIPTION_FOLDER="$WORK_DIR/cache-migration/tmp-subscriptions" \
FORKOP_RUNTIME_STATE_DIR="$WORK_DIR/cache-migration/runtime" \
FORKOP_PERSISTENT_SUBSCRIPTION_CACHE_DIR="$WORK_DIR/cache-migration/persistent" \
FORKOP_LEGACY_LIST_UPDATE_STATE_FILE="$WORK_DIR/cache-migration/runtime/list-update.timestamp" \
FORKOP_LEGACY_LIST_UPDATE_PID_FILE="$WORK_DIR/cache-migration/list-update.pid" \
FORKOP_LEGACY_RULESET_CACHE_DIR="$WORK_DIR/cache-migration/legacy-rulesets" \
FORKOP_CRONTAB_BIN="$WORK_DIR/fake-crontab" \
FORKOP_TEST_CRONTAB="$WORK_DIR/legacy.crontab" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" migrate

for path in \
  "$WORK_DIR/cache-migration/tmp-subscriptions" \
  "$WORK_DIR/cache-migration/persistent" \
  "$WORK_DIR/cache-migration/runtime/subscription-update" \
  "$WORK_DIR/cache-migration/runtime/subscription-links" \
  "$WORK_DIR/cache-migration/runtime/subscription-metadata" \
  "$WORK_DIR/cache-migration/runtime/outbound-metadata" \
  "$WORK_DIR/cache-migration/runtime/section-cache" \
  "$WORK_DIR/cache-migration/runtime/subscription-update.lock" \
  "$WORK_DIR/cache-migration/runtime/subscription-update-jobs" \
  "$WORK_DIR/cache-migration/runtime/cache-format" \
  "$WORK_DIR/cache-migration/runtime/dns-failover.json" \
  "$WORK_DIR/cache-migration/runtime/dns-failover.pid" \
  "$WORK_DIR/cache-migration/runtime/priority.pid" \
  "$WORK_DIR/cache-migration/runtime/subscription-bootstrap-retry.pid" \
  "$WORK_DIR/cache-migration/runtime/list-update.timestamp" \
  "$WORK_DIR/cache-migration/list-update.pid" \
  "$WORK_DIR/cache-migration/legacy-rulesets"; do
  [ ! -e "$path" ] || fail "native migration must remove obsolete state $path"
done
grep -Fxq 'forkop.main.rule_set_with_subnets=existing.txt duplicate.txt local-domains.txt /etc/forkop/local-subnets.txt https://example.com/domains.txt https://example.com/subnets.txt' "$WORK_DIR/cache-cleanup.state" ||
  fail "native migration must merge legacy list sources into universal rule sets"
if grep -Eq 'forkop\.main\.(domain_ip_lists|local_domain_lists|local_subnet_lists|remote_domain_lists|remote_subnet_lists)=' "$WORK_DIR/cache-cleanup.state"; then
  fail "native migration must remove legacy list options"
fi
if grep -Eq 'forkop-(list|subscription)-update' "$WORK_DIR/legacy.crontab"; then
  fail "native migration must remove obsolete list and subscription cron jobs"
fi
grep -Fq '# forkop-component-update-check' "$WORK_DIR/legacy.crontab" ||
  fail "native migration must preserve component update cron jobs"
grep -Fxq 'forkop.settings.dns_main_fallback_strategy=parallel' "$WORK_DIR/cache-cleanup.state" ||
  fail "DNS migration must default Main fallback to parallel"
grep -Fxq 'forkop.settings.dns_bootstrap_fallback_strategy=parallel' "$WORK_DIR/cache-cleanup.state" ||
  fail "DNS migration must default Bootstrap fallback to parallel"
grep -Fxq 'forkop.settings.unified_delay=0' "$WORK_DIR/cache-cleanup.state" ||
  fail "extended migration must add the Unified Delay default"
if grep -Eq 'forkop\.settings\.dns_(check_interval|recovery_check_interval|check_timeout)=' "$WORK_DIR/cache-cleanup.state"; then
  fail "native migration must remove obsolete DNS health settings"
fi
if grep -Eq 'forkop\.subscription\.(include_urltest_groups|hide_urltest_group_outbounds|hide_detour_outbounds)=' "$WORK_DIR/cache-cleanup.state"; then
  fail "leaf subscription migration must remove provider group visibility options"
fi
grep -Fxq 'forkop.priority=fallback_group' "$WORK_DIR/cache-cleanup.state" ||
  fail "UCI tag migration must rename priority_group to fallback_group"
if grep -Eq 'forkop\.priority\.(recovery_check_interval|health_url|pick_fastest|blacklist_timeout)=' "$WORK_DIR/cache-cleanup.state"; then
  fail "native migration must remove obsolete Priority worker settings"
fi
grep -Fxq 'forkop.naive.naive_network=tcp' "$WORK_DIR/cache-cleanup.state" ||
  fail "server migration must add the Naive network default"
grep -Fxq 'forkop.naive.naive_quic_congestion_control=bbr' "$WORK_DIR/cache-cleanup.state" ||
  fail "server migration must add the Naive congestion default"
grep -Fxq 'forkop.tuic.tuic_auth_timeout=3s' "$WORK_DIR/cache-cleanup.state" ||
  fail "server migration must add the TUIC auth timeout default"
grep -Fxq 'forkop.tuic.tuic_heartbeat=20s' "$WORK_DIR/cache-cleanup.state" ||
  fail "server migration must preserve an explicit TUIC heartbeat"
grep -Fxq 'forkop.legacy_vless.server_uuid=33333333-3333-4333-8333-333333333333' "$WORK_DIR/cache-cleanup.state" ||
  fail "server migration must preserve the first legacy VLESS user"
grep -Fxq 'forkop.legacy_vless.vless_flow=xtls-rprx-vision' "$WORK_DIR/cache-cleanup.state" ||
  fail "server migration must preserve the legacy VLESS flow"
if grep -Fq 'forkop.legacy_vless.server_users=' "$WORK_DIR/cache-cleanup.state"; then
  fail "server migration must remove the legacy server_users option"
fi

: >"$WORK_DIR/uci-commit.log"
: >"$WORK_DIR/uci-commit.state"
FORKOP_UCI_STATE_FILE="$WORK_DIR/uci-commit.state" \
FORKOP_UCI_LOG_FILE="$WORK_DIR/uci-commit.log" \
FORKOP_CONFIG_NAME="forkop" \
FORKOP_INTERNAL_CONFIG_TRIGGER_GUARD="$WORK_DIR/internal-config-change" \
ucode -L "$FORKOP_LIB" "$MIGRATION" commit

grep -Fxq 'commit forkop' "$WORK_DIR/uci-commit.log" ||
  fail "commit mode must commit forkop through core.uci"

printf 'installer config migration checks passed\n'
