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
grep -Fq '{ id: "remove_proxy_parameter_filters", run: remove_proxy_parameter_filters }' "$MIGRATION" ||
  fail "proxy parameter filter removal must have a stable named marker"
grep -Fq '{ id: "server_filter_model", run: migrate_server_filter_model }' "$MIGRATION" ||
  fail "server filter migration must have a stable named marker"
grep -Fq "list applied_migrations 'native_rule_sets'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the native rule-set migration as already applied"
grep -Fq "list applied_migrations 'universal_rule_sets'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the universal rule-set migration as already applied"
grep -Fq "list applied_migrations 'leaf_subscription_providers'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the leaf subscription migration as already applied"
grep -Fq "list applied_migrations 'fallback_uci_tags'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the Fallback UCI tag migration as already applied"
grep -Fq "list applied_migrations 'remove_proxy_parameter_filters'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the proxy parameter filter removal as already applied"
grep -Fq "list applied_migrations 'server_filter_model'" "$ROOT_DIR/forkop/files/etc/config/forkop" ||
  fail "new-install config must mark the server filter migration as already applied"
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
      domain_ip_lists: [ '/etc/forkop/dns-list.yml' ]
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
assert(JSON.stringify(config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'remove_proxy_parameter_filters', 'server_filter_model']), 'legacy config should record named migrations');

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function absent(object, key, label) {
  assert(!Object.prototype.hasOwnProperty.call(object, key), `${label}: ${key} should be absent`);
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
assert(config.settings.dns_fallback_strategy === 'sequential', 'native DNS fallback should default to ordered sequential attempts');
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
assert(legacySubSource.user_agent === 'Agent/1.0', 'subscription user-agent setting');
assert(legacySubSource.auto_user_agent === '0', 'subscription user-agent manual mode');
assert(legacySubSource.auto_hwid === '1', 'subscription HWID auto-generation');
assert(legacySubSource.prefix_nodes === '0', 'subscription node prefix disabled by default');
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
assert(legacySubUrltest.filter_enabled === '1', 'legacy-sub URLTest filter activation migrated');
absent(legacySubUrltest, 'filter_mode', 'legacy-sub URLTest');
absent(legacySubUrltest, 'detect_server_country', 'legacy-sub URLTest');
assert(legacySubUrltest.interrupt_exist_connections === '1', 'legacy-sub URLTest interrupt default migrated');
assert(legacySubUrltest.pin_dashboard === '1', 'legacy-sub URLTest dashboard pin default migrated');
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
assert(legacyListSubSource.user_agent === 'ListAgent/2.0', 'legacy list subscription user-agent migrated');
assert(legacyListSubSource.auto_user_agent === '0', 'legacy list subscription manual user-agent mode');
assert(legacyListSubSource.subscription_update_interval === '6h', 'legacy list subscription interval migrated');
assert(legacyListSubAutoSource.auto_user_agent === '1', 'legacy list subscription without User-Agent stays automatic');
assert(!Object.prototype.hasOwnProperty.call(legacyListSubAutoSource, 'user_agent'), 'automatic legacy list subscription should not get user-agent');
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
assert(legacyUrltestConfig.filter_enabled === '1', 'legacy-urltest URLTest filter activation migrated');
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
assert(JSON.stringify(legacyDnsList.rule_set) === JSON.stringify(['/etc/forkop/dns-list.yml']), 'DNS lists should migrate without subnet settings');
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
assert(legacyVpnInterface.domain_resolver_dns_type === 'doh', 'vpn domain resolver type migrated');
assert(legacyVpnInterface.domain_resolver_dns_server === 'https://dns.example/dns-query', 'vpn domain resolver server migrated');
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
assert(migratedLegacyOutbound.detour === 'legacy-url-out', 'legacy JSON cascade embedded in outbound');
assert(migratedLegacyOutbound.tag === 'legacy-outbound-json-1-out', 'legacy tagless JSON outbound gets a stable list tag');
absent(legacyOutbound, 'outbound_detour_enabled', 'legacy-outbound');
absent(legacyOutbound, 'outbound_detour_section', 'legacy-outbound');

const legacyOutboundCollision = sections['legacy-outbound-collision'];
assert(legacyOutboundCollision.outbound_jsons.length === 2, 'legacy JSON outbound is appended to an existing list');
assert(JSON.parse(legacyOutboundCollision.outbound_jsons[1]).tag === 'legacy-outbound-collision-json-2-out-1', 'legacy JSON outbound tag avoids existing list tags');

const legacyPriority = config.fallback_group[0];
assert(!config.priority_group && !config.priority_level, 'legacy Priority UCI section types should be removed');
assert(config.fallback_level.every(level => level['.type'] === 'fallback_level'), 'legacy Priority levels should migrate to fallback_level');
assert(legacyPriority.blacklist_timeout === '15s', 'native Priority fallback should preserve the old recovery timeout');
for (const key of [
  'health_url',
  'active_check_interval',
  'check_timeout',
  'recovery_check_interval',
  'pick_fastest',
  'switch_to_faster_same_priority',
  'fastest_check_interval',
  'interrupt_exist_connections',
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
assert(out.removed_caches.includes('/var/run/forkop/section-cache/legacy-sub.json'), 'section cache removal');
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
assert(JSON.stringify(out.config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'remove_proxy_parameter_filters', 'server_filter_model']), 'named migrations should be recorded');
assert(!Object.prototype.hasOwnProperty.call(section, 'interfaces'), 'parent interface list should be removed');
assert(JSON.stringify(interfaces.map(item => item.name)) === JSON.stringify(['awg0', 'tun0']), 'interfaces should keep their order');
for (const item of interfaces) {
  assert(item.section === 'main', 'interface child should reference its parent');
  assert(item.domain_resolver_enabled === '0', 'resolver should default to disabled');
  assert(item.domain_resolver_dns_type === 'udp', 'resolver protocol default');
  assert(item.domain_resolver_dns_server === '8.8.8.8', 'resolver server default');
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
assert(JSON.stringify(out.config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'remove_proxy_parameter_filters', 'server_filter_model']), 'newer configs should mark skipped migrations');
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
  'vless://00000000-0000-4000-8000-000000000001@example.com:443',
  'https://invalid.example/no-port',
]), 'only valid native HTTP proxy links should leave Connection URLs');
assert(jsonOutbounds.length === 3, 'migrated HTTP outbounds should precede the existing JSON list');
assert(JSON.stringify(jsonOutbounds[0]) === JSON.stringify({
  type: 'http',
  tag: 'Secure HTTP',
  server: '2001:db8::1',
  server_port: 8443,
  username: 'user',
  password: 'p@ss',
  tls: { enabled: true },
}), 'HTTPS URL should preserve its name, credentials, IPv6 server, port, and TLS');
assert(JSON.stringify(jsonOutbounds[1]) === JSON.stringify({
  type: 'http',
  tag: 'http-1',
  server: 'proxy.example',
  server_port: 8080,
}), 'unnamed HTTP URL should receive a unique http tag');
assert(jsonOutbounds[2].type === 'direct' && jsonOutbounds[2].tag === 'http', 'existing JSON outbounds should remain unchanged');
assert(JSON.stringify(out.config.settings.applied_migrations) === JSON.stringify(['interface_sections', 'enable_component_checks', 'http_connection_urls', 'remove_server_country_and_dashboard_filter', 'native_fallbacks', 'native_rule_sets', 'universal_rule_sets', 'leaf_subscription_providers', 'extended_server_defaults', 'fallback_uci_tags', 'remove_proxy_parameter_filters', 'server_filter_model']), 'HTTP URL migration should be recorded');
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
      "subscription_url_settings": "{\"https://example.com/subscription\":{\"user_agent\":\"Happ\",\"include_urltest_groups\":\"1\",\"hide_urltest_group_outbounds\":\"1\",\"hide_detour_outbounds\":\"1\",\"include_proxy_parameters\":\"1\",\"include_protocols\":[\"vless\"]}}",
      "urltest_settings": "{\"fast\":{\"include_regex\":[\"ok\"],\"include_proxy_parameters\":\"1\",\"include_transports\":[\"grpc\"]}}",
      "fallback_level_settings": "{\"legacy\":{\"name\":\"Legacy\",\"exclude_proxy_parameters\":\"1\",\"exclude_securities\":[\"tls\"]}}"
    }
  ],
  "subscription_url": [
    {
      ".name": "source", ".type": "subscription_url", "section": "main",
      "url": "https://example.com/subscription", "user_agent": "Happ",
      "filter_mode": "mixed",
      "include_countries": [ "RU", "US" ],
      "include_regex": [ "fast", "premium" ],
      "exclude_outbounds": [ "Expired node" ],
      "include_proxy_parameters": "1", "include_protocols": [ "vless" ]
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
const sourceSettings = JSON.parse(section.subscription_url_settings)['https://example.com/subscription'];
if (JSON.stringify(sourceSettings) !== JSON.stringify({ user_agent: 'Happ' })) {
  console.error('leaf subscription migration must remove legacy provider group options without losing request settings');
  process.exit(1);
}
const urltestSettings = JSON.parse(section.urltest_settings);
const fallbackSettings = JSON.parse(section.fallback_level_settings);
if (JSON.stringify(urltestSettings) !== JSON.stringify({ fast: { include_regex: 'ok', filter_enabled: '0' } }) ||
    JSON.stringify(fallbackSettings) !== JSON.stringify({ legacy: { name: 'Legacy' } })) {
  console.error('proxy parameter migration must clean legacy JSON settings without losing other filters');
  process.exit(1);
}
const source = out.config.subscription_url[0];
const urltest = out.config.urltest[0];
const level = out.config.fallback_level[0];
if (source.filter_enabled !== '1' ||
    source.include_regex !== '(?:fast)|(?:premium)|(?:🇷🇺)|(?:🇺🇸)' ||
    JSON.stringify(source.exclude_outbounds) !== JSON.stringify(['Expired node']) ||
    Object.prototype.hasOwnProperty.call(source, 'filter_mode') ||
    Object.prototype.hasOwnProperty.call(source, 'include_countries')) {
  console.error('subscription filters were not migrated to the unified model');
  process.exit(1);
}
if (urltest.filter_enabled !== '1' ||
    urltest.exclude_regex !== '(?:slow)|(?:expired)|(?:🇩🇪)' ||
    Object.prototype.hasOwnProperty.call(urltest, 'filter_mode') ||
    Object.prototype.hasOwnProperty.call(urltest, 'exclude_countries')) {
  console.error('URLTest filters were not migrated to the unified model');
  process.exit(1);
}
if (level.filter_enabled !== '1' ||
    JSON.stringify(level.include_outbounds) !== JSON.stringify(['Primary node']) ||
    level.include_regex !== '(?:primary)|(?:backup)|(?:🇳🇱)' ||
    Object.prototype.hasOwnProperty.call(level, 'filter_mode') ||
    Object.prototype.hasOwnProperty.call(level, 'country') ||
    Object.prototype.hasOwnProperty.call(level, 'server_name') ||
    Object.prototype.hasOwnProperty.call(level, 'regex')) {
  console.error('Fallback filters were not migrated to the unified model');
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
grep -Fq 'forkop.settings.applied_migrations=interface_sections enable_component_checks http_connection_urls remove_server_country_and_dashboard_filter native_fallbacks native_rule_sets universal_rule_sets leaf_subscription_providers extended_server_defaults fallback_uci_tags remove_proxy_parameter_filters server_filter_model' "$WORK_DIR/runtime-version.state" ||
  fail "runtime migration must record stable migration names"
grep -Eq '^forkop\.main\.outbound_jsons=\{ "type": "http", "tag": "http", "server": "proxy\.example", "server_port": 8080 \}$' "$WORK_DIR/runtime-version.state" ||
  fail "runtime migration must convert native HTTP proxy links to JSON outbounds"
if grep -Fq 'forkop.main.selector_proxy_links=' "$WORK_DIR/runtime-version.state"; then
  fail "runtime migration must remove converted HTTP connection URLs"
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

cat >"$WORK_DIR/cache-cleanup.state" <<'EOF_UCI'
forkop.settings=settings
forkop.settings.config_version=1.0.5
forkop.settings.applied_migrations=interface_sections enable_component_checks http_connection_urls remove_server_country_and_dashboard_filter
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
grep -Fxq 'forkop.settings.dns_fallback_strategy=sequential' "$WORK_DIR/cache-cleanup.state" ||
  fail "native migration must add the DNS fallback strategy default"
grep -Fxq 'forkop.settings.unified_delay=0' "$WORK_DIR/cache-cleanup.state" ||
  fail "extended migration must add the Unified Delay default"
if grep -Eq 'forkop\.settings\.dns_(check_interval|recovery_check_interval|check_timeout)=' "$WORK_DIR/cache-cleanup.state"; then
  fail "native migration must remove obsolete DNS health settings"
fi
if grep -Eq 'forkop\.subscription\.(include_urltest_groups|hide_urltest_group_outbounds|hide_detour_outbounds)=' "$WORK_DIR/cache-cleanup.state"; then
  fail "leaf subscription migration must remove provider group visibility options"
fi
grep -Fxq 'forkop.priority.blacklist_timeout=45s' "$WORK_DIR/cache-cleanup.state" ||
  fail "native migration must preserve the old Priority recovery timeout"
grep -Fxq 'forkop.priority=fallback_group' "$WORK_DIR/cache-cleanup.state" ||
  fail "UCI tag migration must rename priority_group to fallback_group"
if grep -Eq 'forkop\.priority\.(recovery_check_interval|health_url|pick_fastest)=' "$WORK_DIR/cache-cleanup.state"; then
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
