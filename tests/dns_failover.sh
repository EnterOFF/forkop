#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORKOP_LIB="$ROOT_DIR/forkop/files/usr/lib"
GENERATOR="$FORKOP_LIB/singbox/generator.uc"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

generate() {
  mkdir -p "$2.section-cache"
  ucode -L "$FORKOP_LIB" "$GENERATOR" generate-config-fixture "$1" "$2" 192.168.1.1 0
}

cat >"$WORK_DIR/single.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings", "dns_type": "udp",
    "dns_server": ["77.88.8.8"], "bootstrap_dns_server": ["77.88.8.8"]
  },
  "section": [
    { ".name": "direct", ".type": "section", "enabled": "1", "action": "bypass", "domain_suffix": ["example.org"] }
  ]
}
JSON

cat >"$WORK_DIR/multi.json" <<'JSON'
{
  "settings": {
    ".name": "settings", ".type": "settings", "dns_type": "doh",
    "dns_server": ["dns.google/dns-query", "cloudflare-dns.com/dns-query"],
    "bootstrap_dns_server": ["1.1.1.1", "8.8.8.8"],
    "dns_fallback_strategy": "parallel",
    "dns_detour_enabled": "1", "dns_detour_section": "proxy"
  },
  "section": [
    {
      ".name": "proxy", ".type": "section", "enabled": "1", "action": "outbound",
      "outbound_jsons": ["{\"type\":\"direct\",\"tag\":\"fixture\"}"],
      "domain_suffix": ["example.org"]
    }
  ]
}
JSON

generate "$WORK_DIR/single.json" "$WORK_DIR/single-config.json"
generate "$WORK_DIR/multi.json" "$WORK_DIR/multi-config.json"

ucode -e '
let fs = require("fs");
function assert(value, message) { if (!value) die(message + "\n"); }
function find_tag(values, tag) { for (let value in values || []) if (value.tag == tag) return value; return null; }

let single = json(fs.readfile(ARGV[0]));
assert(length(single.dns.servers) == 3, "single DNS must use direct canonical transports plus FakeIP");
assert(find_tag(single.dns.servers, "dns-server").server == "77.88.8.8", "single main DNS changed");
assert(find_tag(single.dns.servers, "bootstrap-dns-server").server == "77.88.8.8", "single bootstrap DNS changed");
assert(length(single.inbounds) == 5, "single DNS must keep only standard traffic inbounds");

let multi = json(fs.readfile(ARGV[1]));
assert(length(multi.dns.servers) == 7, "multi DNS must create four candidates, two fallbacks and FakeIP");
assert(length(multi.inbounds) == 5, "native DNS fallback must keep only standard traffic inbounds");
let bootstrap = find_tag(multi.dns.servers, "bootstrap-dns-server");
let main = find_tag(multi.dns.servers, "dns-server");
assert(bootstrap.type == "fallback" && bootstrap.strategy == "parallel", "bootstrap must use native parallel fallback");
assert(main.type == "fallback" && main.strategy == "parallel", "main must use native parallel fallback");
assert(sprintf("%J", bootstrap.servers) == sprintf("%J", ["bootstrap-dns-server-1", "bootstrap-dns-server-2"]), "bootstrap order changed");
assert(sprintf("%J", main.servers) == sprintf("%J", ["dns-server-1", "dns-server-2"]), "main order changed");
for (let tag in main.servers) {
    let candidate = find_tag(multi.dns.servers, tag);
    assert(candidate.detour == "proxy-out", "main DNS candidate lost detour");
    assert(candidate.domain_resolver == "bootstrap-dns-server", "main DNS candidate lost bootstrap resolver");
}
assert(multi.route.default_domain_resolver == "bootstrap-dns-server", "detoured DNS must use bootstrap as endpoint resolver");
for (let inbound in multi.inbounds || [])
    assert(index(inbound.tag || "", "dns-health-") != 0, "legacy DNS health inbound remains");
' "$WORK_DIR/single-config.json" "$WORK_DIR/multi-config.json"

test ! -e "$FORKOP_LIB/singbox/dns_failover.uc"
! grep -Eq 'DNS_FAILOVER_UC|dns-failover-apply|patch-dns-config' \
  "$FORKOP_LIB/service/lifecycle.uc" "$FORKOP_LIB/singbox/runtime.uc"

printf 'Native DNS fallback checks passed\n'
