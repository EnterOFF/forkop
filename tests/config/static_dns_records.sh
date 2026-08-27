#!/usr/bin/env bash
set -eo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
VALIDATOR="$FORKOP_LIB/config/validator.uc"

generate() {
  ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture "$1" "$2" 192.168.1.1 0
}

validate() {
  ucode -L "$FORKOP_LIB" "$VALIDATOR" validate-runtime-fixture "$1" '{}'
}

assert_rejects() {
  local label="$1"
  local fixture="$2"
  local expected="$3"
  local output

  if output="$(validate "$fixture" 2>&1)"; then
    fail "$label should be rejected"
  fi

  printf '%s\n' "$output" | grep -Fq "$expected" ||
    fail "$label: expected message containing '$expected', got '$output'"
}

cat >"$WORK_DIR/records.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "static_hosts_text": "# pinned by hand\n130.255.77.28 ntc.party www.ntc.party\n2a03:4000::1 NTC.party\n\n198.51.100.7 example.com # trailing note\n"
  },
  "section": [
    { ".name": "pinned", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["ntc.party"] },
    { ".name": "direct_rule", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

cat >"$WORK_DIR/empty.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"]
  },
  "section": [
    { ".name": "pinned", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["ntc.party"] }
  ]
}
JSON

generate "$WORK_DIR/records.json" "$WORK_DIR/records-config.json"
generate "$WORK_DIR/empty.json" "$WORK_DIR/empty-config.json"

ucode -e '
let fs = require("fs");

function assert(condition, message) {
    if (!condition) {
        warn("FAIL: ", message, "\n");
        exit(1);
    }
}

function find_tag(items, tag) {
    for (let item in items || [])
        if (item.tag == tag)
            return item;
    return null;
}

function index_of(items, predicate) {
    for (let i = 0; i < length(items || []); i++)
        if (predicate(items[i]))
            return i;
    return -1;
}

function last_index_of(items, predicate) {
    let found = -1;
    for (let i = 0; i < length(items || []); i++)
        if (predicate(items[i]))
            found = i;
    return found;
}

let records = json(fs.readfile(ARGV[0]));
let hosts = find_tag(records.dns.servers, "hosts-server");
assert(hosts != null, "static DNS records must add the hosts server");
assert(hosts.type == "hosts", "static DNS records must use the native hosts transport");
assert(hosts.path == null, "static DNS records must not read files outside the Forkop configuration");
assert(sprintf("%J", hosts.predefined["ntc.party"]) == sprintf("%J", ["130.255.77.28", "2a03:4000::1"]),
    "repeated domains must collect every configured address");
assert(sprintf("%J", hosts.predefined["www.ntc.party"]) == sprintf("%J", ["130.255.77.28"]),
    "additional domains on a line must keep the line address");
assert(hosts.predefined["example.com"] != null, "comments and mixed case must not drop records");
assert(hosts.predefined["NTC.party"] == null, "domains must be normalized to lower case");

let hosts_dns_index = index_of(records.dns.rules, function(rule) { return rule.server == "hosts-server"; });
let fakeip_index = last_index_of(records.dns.rules, function(rule) { return rule.server == "fakeip-server"; });
let dnsmasq_index = index_of(records.dns.rules, function(rule) { return rule.server == "dnsmasq-server"; });
assert(hosts_dns_index > fakeip_index, "sections must keep FakeIP answers for client queries");
assert(hosts_dns_index < dnsmasq_index, "static records must answer before the dnsmasq fallback");
assert(sprintf("%J", records.dns.rules[hosts_dns_index].domain) ==
    sprintf("%J", ["ntc.party", "www.ntc.party", "example.com"]), "static record domains changed");
assert(records.dns.rules[hosts_dns_index].query_type == null,
    "the static record rule must also match the lookups sing-box makes for its own dialing");

let hosts_route_index = index_of(records.route.rules, function(rule) {
    return rule.action == "resolve" && rule.server == "hosts-server";
});
let section_route_index = index_of(records.route.rules, function(rule) {
    return rule.action == "route" && sprintf("%J", rule.domain_suffix) == sprintf("%J", ["ntc.party"]);
});
assert(hosts_route_index >= 0, "static records must pin the address sing-box dials");
assert(hosts_route_index < section_route_index, "static records must resolve before a section routes the connection");

for (let config_path in [ ARGV[0], ARGV[1] ]) {
    let config = json(fs.readfile(config_path));
    for (let rule in config.route.rules) {
        if (rule.action != "resolve" || rule.server == "hosts-server")
            continue;
        if (rule.domain == "ip.podkop.fyi")
            continue;
        assert(rule.server == null,
            "section resolve rules must follow dns.rules instead of pinning the main DNS server");
    }
}

let empty = json(fs.readfile(ARGV[1]));
assert(find_tag(empty.dns.servers, "hosts-server") == null, "an empty record list must not add the hosts server");
assert(index_of(empty.dns.rules, function(rule) { return rule.server == "hosts-server"; }) == -1,
    "an empty record list must not add a DNS rule");
assert(index_of(empty.route.rules, function(rule) { return rule.server == "hosts-server"; }) == -1,
    "an empty record list must not add a route rule");
' "$WORK_DIR/records-config.json" "$WORK_DIR/empty-config.json"

cat >"$WORK_DIR/invalid-address.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "static_hosts_text": "ntc.party 130.255.77.28\n"
  },
  "section": [
    { ".name": "direct_rule", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

cat >"$WORK_DIR/invalid-domain.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "static_hosts_text": "130.255.77.28 ntc..party\n"
  },
  "section": [
    { ".name": "direct_rule", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

cat >"$WORK_DIR/missing-domain.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "static_hosts_text": "130.255.77.28\n"
  },
  "section": [
    { ".name": "direct_rule", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

assert_rejects "a domain in the address column" "$WORK_DIR/invalid-address.json" "invalid address 'ntc.party'"
assert_rejects "a malformed domain" "$WORK_DIR/invalid-domain.json" "invalid domain 'ntc..party'"
assert_rejects "a record without a domain" "$WORK_DIR/missing-domain.json" "must contain an address followed by at least one domain"

printf 'Static DNS record checks passed\n'
