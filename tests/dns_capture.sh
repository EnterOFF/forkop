#!/usr/bin/env bash
set -eo pipefail

# The DNS capture contract of the generated sing-box config: which inbounds
# exist, which server answers queries nothing matched, and what changes when
# dnsmasq is reconfigured or the user sends unmatched DNS back to the router.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

generate() {
  ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture "$1" "$2" 192.168.1.1 0
}

cat >"$WORK_DIR/system-proxy.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"]
  },
  "section": [
    {
      ".name": "vpn", ".type": "section", "enabled": "1", "action": "outbound",
      "outbound_jsons": ["{\"type\":\"direct\",\"tag\":\"fixture\"}"],
      "fully_routed_ips": ["@system"]
    }
  ]
}
JSON

cat >"$WORK_DIR/moved-resolver.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"]
  },
  "dhcp_dnsmasq": { "port": "5353", "domain": "home" },
  "section": [
    { ".name": "direct", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

cat >"$WORK_DIR/resolver-mode.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "unmatched_dns_mode": "router"
  },
  "dhcp_dnsmasq": { "port": "5353", "domain": "home" },
  "section": [
    { ".name": "direct", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

cat >"$WORK_DIR/disabled-resolver.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"]
  },
  "dhcp_dnsmasq": { "port": "0" },
  "section": [
    { ".name": "direct", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

generate "$WORK_DIR/system-proxy.json" "$WORK_DIR/system-proxy-config.json"
generate "$WORK_DIR/moved-resolver.json" "$WORK_DIR/moved-resolver-config.json"
generate "$WORK_DIR/resolver-mode.json" "$WORK_DIR/resolver-mode-config.json"
generate "$WORK_DIR/disabled-resolver.json" "$WORK_DIR/disabled-resolver-config.json"

ucode -e '
let fs = require("fs");
function assert(value, message) { if (!value) die(message + "\n"); }
function find_tag(values, tag) { for (let value in values || []) if (value.tag == tag) return value; return null; }
function contains(values, needle) {
    if (type(values) == "string") return values == needle;
    for (let value in values || []) if (value == needle) return true;
    return false;
}
function dns_rule(config, matcher) { for (let rule in config.dns.rules || []) if (rule != null && matcher(rule)) return rule; return null; }

// A section that fully routes the System device captures the router DNS, and
// the fallback for the captured router queries is the Forkop DNS: the local
// resolver forwards upstream through the very capture that brought the query
// here, so answering the router from it would loop.
let system = json(fs.readfile(ARGV[0]));
assert(find_tag(system.inbounds, "system-dns-in") != null, "fully routed System proxy must add the system DNS inbound");
assert(dns_rule(system, r => r.server == "dns-server" && contains(r.inbound, "system-dns-in") && r.domain == null && r.domain_suffix == null) != null, "unmatched router DNS resolves through the Forkop DNS");
assert(dns_rule(system, r => r.server == "dnsmasq-server" && contains(r.inbound, "system-dns-in")) == null, "router queries never route to the local resolver");

// The fallback goes to whoever owns loopback 53 - the resolver the router
// itself uses - and not to the port dnsmasq was moved to, which would walk
// around a front resolver like AdGuard Home and drop its filtering. By default
// Forkop answers everything no rule claimed, and only the zone the local
// resolver is authoritative for is left with it.
let moved = json(fs.readfile(ARGV[1]));
let local_server = find_tag(moved.dns.servers, "dnsmasq-server");
assert(local_server != null && local_server.server == "127.0.0.1" && local_server.server_port == 53, "the fallback always dials the resolver that owns loopback 53");
assert(dns_rule(moved, r => r.server == "dns-server" && contains(r.inbound, "source-dns-in") && r.domain_regex == null && r.domain_suffix == null && r.query_type == null) != null, "unmatched client DNS is resolved by Forkop itself");
assert(dns_rule(moved, r => r.server == "dnsmasq-server" && contains(r.inbound, "source-dns-in") && r.domain_regex == "^[^.]+$") != null, "single-label names stay on the local resolver");
assert(dns_rule(moved, r => r.server == "dnsmasq-server" && contains(r.inbound, "source-dns-in") && r.domain_suffix == ".home") != null, "the DHCP domain stays on the local resolver");
assert(dns_rule(moved, r => r.server == "dnsmasq-server" && contains(r.inbound, "source-dns-in") && contains(r.query_type, "PTR")) != null, "reverse lookups stay on the local resolver");
let forkop_fallback_seen = false;
for (let rule in moved.dns.rules) {
    if (rule.server == "dns-server" && contains(rule.inbound, "source-dns-in") && rule.domain_regex == null)
        forkop_fallback_seen = true;
    if (rule.server == "dnsmasq-server" && contains(rule.inbound, "source-dns-in"))
        assert(!forkop_fallback_seen, "the local zone must be answered before the forkop fallback");
}

// Sending unmatched queries back to the router hands the local resolver
// everything again: one rule for the whole client inbound, and no zone rules
// carved out of it, because there is nothing left to carve them out of.
let resolver_mode = json(fs.readfile(ARGV[2]));
assert(dns_rule(resolver_mode, r => r.server == "dnsmasq-server" && contains(r.inbound, "source-dns-in") && r.domain_regex == null && r.domain_suffix == null && r.query_type == null) != null, "router mode returns unmatched client DNS to the local resolver");
assert(dns_rule(resolver_mode, r => r.server == "dns-server" && contains(r.inbound, "source-dns-in") && r.domain == null && r.domain_suffix == null && r.rule_set == null) == null, "router mode leaves no unmatched client queries on the Forkop DNS");
assert(dns_rule(resolver_mode, r => r.server == "dnsmasq-server" && r.domain_regex == "^[^.]+$") == null, "router mode has no local zone to carve out");

// A dnsmasq with its DNS switched off leaves whoever took the port over.
let disabled_resolver = json(fs.readfile(ARGV[3]));
assert(find_tag(disabled_resolver.dns.servers, "dnsmasq-server").server_port == 53, "a disabled dnsmasq port changes nothing about the fallback");

' "$WORK_DIR/system-proxy-config.json" "$WORK_DIR/moved-resolver-config.json" \
  "$WORK_DIR/resolver-mode-config.json" "$WORK_DIR/disabled-resolver-config.json"

printf 'DNS capture config checks passed\n'
