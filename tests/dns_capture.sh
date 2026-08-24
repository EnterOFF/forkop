#!/usr/bin/env bash
set -eo pipefail

# The DNS capture contract of the generated sing-box config: which inbounds
# exist, which server answers queries nothing matched, and what changes when the
# resolver moves, when the user routes unmatched DNS through Forkop, and when
# the capture is disabled entirely.

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
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "unmatched_dns_mode": "forkop"
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

cat >"$WORK_DIR/no-capture.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"],
    "disable_dns_capture": "1"
  },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "outbound",
      "outbound_jsons": ["{\"type\":\"direct\",\"tag\":\"fixture\"}"],
      "domain_suffix": ["example.org"]
    },
    {
      ".name": "scoped", ".type": "section", "enabled": "1", "action": "outbound",
      "outbound_jsons": ["{\"type\":\"direct\",\"tag\":\"fixture2\"}"],
      "domain_suffix": ["scoped.example.org"],
      "source_ip_cidr": ["192.168.1.60/32"]
    }
  ]
}
JSON

generate "$WORK_DIR/system-proxy.json" "$WORK_DIR/system-proxy-config.json"
generate "$WORK_DIR/moved-resolver.json" "$WORK_DIR/moved-resolver-config.json"
generate "$WORK_DIR/disabled-resolver.json" "$WORK_DIR/disabled-resolver-config.json"
generate "$WORK_DIR/no-capture.json" "$WORK_DIR/no-capture-config.json"

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

// The local resolver is dialed where dnsmasq actually listens, and in the
// forkop unmatched mode only its own zone stays with it.
let moved = json(fs.readfile(ARGV[1]));
let local_server = find_tag(moved.dns.servers, "dnsmasq-server");
assert(local_server != null && local_server.server_port == 5353, "the fallback follows a moved dnsmasq port");
assert(dns_rule(moved, r => r.server == "dns-server" && contains(r.inbound, "source-dns-in") && r.domain_regex == null && r.domain_suffix == null && r.query_type == null) != null, "forkop mode resolves unmatched client DNS itself");
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

// A dnsmasq moved off port 53 entirely leaves whoever took the port over.
let disabled_resolver = json(fs.readfile(ARGV[2]));
assert(find_tag(disabled_resolver.dns.servers, "dnsmasq-server").server_port == 53, "a disabled dnsmasq port falls back to 53");

// Disabling the capture removes the capture inbounds and everything that only
// made sense with them; the manual 127.0.0.42 entry point stays.
let none = json(fs.readfile(ARGV[3]));
assert(find_tag(none.inbounds, "source-dns-in") == null, "disabled capture must not listen for client DNS");
assert(find_tag(none.inbounds, "system-dns-in") == null, "disabled capture must not listen for router DNS");
assert(find_tag(none.inbounds, "dns-in") != null, "the manual resolver entry point stays available");
assert(find_tag(none.dns.servers, "dnsmasq-server") == null, "no rule can reach the local resolver without the capture");
assert(dns_rule(none, r => contains(r.inbound, "source-dns-in") || contains(r.inbound, "system-dns-in")) == null, "no rule may reference the absent capture inbounds");
assert(dns_rule(none, r => r.server == "fakeip-server" && contains(r.domain_suffix, "example.org")) != null, "unscoped domain rules keep serving the manual entry point");
assert(dns_rule(none, r => contains(r.domain_suffix, "scoped.example.org")) == null, "device-scoped DNS rules leave with the capture that fed them");
for (let rule in none.route.rules) {
    assert(!contains(rule.inbound, "source-dns-in") && !contains(rule.inbound, "system-dns-in"),
        "no route rule may reference the absent capture inbounds");
}
' "$WORK_DIR/system-proxy-config.json" "$WORK_DIR/moved-resolver-config.json" \
  "$WORK_DIR/disabled-resolver-config.json" "$WORK_DIR/no-capture-config.json"

printf 'DNS capture config checks passed\n'
