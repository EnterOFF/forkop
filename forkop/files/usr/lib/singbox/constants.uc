const DNS_SERVER_TAG = "dns-server";
const FAKEIP_DNS_SERVER_TAG = "fakeip-server";
const BOOTSTRAP_DNS_SERVER_TAG = "bootstrap-dns-server";
const DNSMASQ_DNS_SERVER_TAG = "dnsmasq-server";
const HOSTS_DNS_SERVER_TAG = "hosts-server";
const FAKEIP_DNS_RULE_TAG = "fakeip-dns-rule-tag";
const FAKEIP_RULESET_DNS_RULE_TAG = "fakeip-ruleset-dns-rule-tag";
const SERVICE_FAKEIP_DNS_RULE_TAG = "service-fakeip-dns-rule-tag";

const TPROXY_INBOUND_TAG = "tproxy-in";
const TPROXY_INBOUND_ADDRESS = "0.0.0.0";
const TPROXY_INBOUND6_TAG = "tproxy6-in";
const TPROXY_INBOUND6_ADDRESS = "::1";
const TPROXY_INBOUND_PORT = 1602;
const DNS_INBOUND_TAG = "dns-in";
const DNS_INBOUND_ADDRESS = "127.0.0.42";
const DNS_INBOUND_PORT = 53;
const SOURCE_DNS_INBOUND_TAG = "source-dns-in";
const SOURCE_DNS_INBOUND_ADDRESS = "::";
const SOURCE_DNS_INBOUND_PORT = 1603;
const SYSTEM_TPROXY_INBOUND_TAG = "system-in";
const SYSTEM_TPROXY_INBOUND6_TAG = "system6-in";
const SYSTEM_TPROXY_INBOUND_PORT = 1604;
const SYSTEM_DNS_INBOUND_TAG = "system-dns-in";
const SYSTEM_DNS_INBOUND_ADDRESS = "::";
const SYSTEM_DNS_INBOUND_PORT = 1605;

const SERVICE_MIXED_INBOUND_ADDRESS = "127.0.0.1";
const WARP_PROFILES_MIXED_INBOUND_TAG = "service-warp-in";
const WARP_PROFILES_MIXED_INBOUND_PORT = 4536;
const DIRECT_OUTBOUND_TAG = "direct-out";
const CLASH_API_CONTROLLER_PORT = 9090;
// The mark sing-box puts on its own traffic is the one the nft table lets pass.
const OUTBOUND_MARK = hex(require("core.constants").NFT_OUTBOUND_MARK);
// The cache file keeps every name it hands an address to until the range comes
// round again, in tmpfs, at about 170 bytes a name: 65536 addresses a family.
const FAKEIP_INET4_RANGE = "198.18.0.0/16";
const FAKEIP_INET6_RANGE = "fc00::/112";

const URLTEST_DEFAULT_IDLE_TIMEOUT = "30m";
const CHECK_PROXY_IP_DOMAIN = "ip.podkop.fyi";
const FAKEIP_TEST_DOMAIN = "fakeip.podkop.fyi";
const TMP_SING_BOX_FOLDER = "/tmp/sing-box";
// The comment on the nftables rules the Servers tab writes. The service marks its
// rules with it and the inbound check looks for it in the loaded chain, because
// those ports are an nftables.d include and never appear in `uci show firewall`.
const SERVER_FIREWALL_COMMENT = "forkop: server ports";

// Outbound types a subscription can produce. sing-box builds provider nodes
// from outbounds only, so endpoint protocols and the types its parsers refuse
// are not offered here.
const FILTERABLE_PROVIDER_TYPES = [
    "vless", "vmess", "trojan", "shadowsocks",
    "hysteria2", "hysteria", "tuic", "anytls",
    "naive", "mieru", "snell", "shadowtls",
    "sudoku", "trusttunnel", "masque",
    "ssh", "tor", "socks", "http"
];

// A group also holds the servers a section configures itself, which is the
// only way a tunnel or a network interface becomes a member.
const FILTERABLE_GROUP_TYPES = [
    ...FILTERABLE_PROVIDER_TYPES,
    "wireguard", "amneziawg", "warp", "tailscale", "openvpn-client", "openconnect", "direct"
];

// sing-box resolves a manual link at runtime, so the generated "parser"
// outbound has to be matched by the protocol its link carries. The schemes are
// the ones ParseSubscriptionLink accepts in the core; a scheme missing here
// leaves the node with no protocol, and a group filtering by protocol then
// keeps a server it was told to exclude.
const LINK_SCHEME_OUTBOUND_TYPES = {
    "ss": "shadowsocks",
    "vmess": "vmess",
    "vless": "vless",
    "trojan": "trojan",
    "tuic": "tuic",
    "anytls": "anytls",
    "hy": "hysteria",
    "hysteria": "hysteria",
    "hy2": "hysteria2",
    "hysteria2": "hysteria2",
    "mieru": "mieru",
    "mierus": "mieru",
    "naive+https": "naive",
    "naive+quic": "naive",
    "http2": "naive",
    "http3": "naive",
    "socks": "socks",
    "socks4": "socks",
    "socks4a": "socks",
    "socks5": "socks",
    "socks5h": "socks"
};

// A subscription fills in the detour of every server it imports from its cascade
// connection. Repeating it in the free-form patch would silently fight the
// control beside it, so it is refused instead of resolved by precedence.
const RESERVED_OVERRIDE_PATCH_PATHS = [ "detour" ];

const RESERVED_TAGS = {
    [DNS_SERVER_TAG]: true,
    [FAKEIP_DNS_SERVER_TAG]: true,
    [BOOTSTRAP_DNS_SERVER_TAG]: true,
    [DNSMASQ_DNS_SERVER_TAG]: true,
    [HOSTS_DNS_SERVER_TAG]: true,
    [FAKEIP_DNS_RULE_TAG]: true,
    [FAKEIP_RULESET_DNS_RULE_TAG]: true,
    [SERVICE_FAKEIP_DNS_RULE_TAG]: true,
    [TPROXY_INBOUND_TAG]: true,
    [TPROXY_INBOUND6_TAG]: true,
    [DNS_INBOUND_TAG]: true,
    [SOURCE_DNS_INBOUND_TAG]: true,
    [SYSTEM_TPROXY_INBOUND_TAG]: true,
    [SYSTEM_TPROXY_INBOUND6_TAG]: true,
    [SYSTEM_DNS_INBOUND_TAG]: true,
    [WARP_PROFILES_MIXED_INBOUND_TAG]: true,
    [DIRECT_OUTBOUND_TAG]: true
};

function as_string(value) {
    return value == null ? "" : "" + value;
}

function tag(base, postfix) {
    let candidate = as_string(base) + "-" + as_string(postfix);
    return RESERVED_TAGS[candidate] ? candidate + "-1" : candidate;
}

function outbound_tag(section_name) {
    return as_string(section_name);
}

function child_tag(section_name, display_name) {
    return as_string(section_name) + "/" + as_string(display_name);
}

function domain_resolver_tag(section_name) {
    return tag(section_name, "domain-resolver");
}

// The display name verbatim, the way outbound_tag takes a section name: the tab
// shows it and the Clash API reports it, so anything added here would be a second
// name for the same listener. The runtime check refuses a name Forkop already uses,
// which is what a suffix would otherwise be for.
function server_inbound_tag(display_name) {
    return as_string(display_name);
}

function tailscale_dns_server_tag(section_name) {
    return tag("server-" + as_string(section_name), "tailscale-dns");
}

return {
    DNS_SERVER_TAG,
    FAKEIP_DNS_SERVER_TAG,
    BOOTSTRAP_DNS_SERVER_TAG,
    DNSMASQ_DNS_SERVER_TAG,
    HOSTS_DNS_SERVER_TAG,
    TPROXY_INBOUND_TAG,
    TPROXY_INBOUND_ADDRESS,
    TPROXY_INBOUND6_TAG,
    TPROXY_INBOUND6_ADDRESS,
    TPROXY_INBOUND_PORT,
    DNS_INBOUND_TAG,
    DNS_INBOUND_ADDRESS,
    DNS_INBOUND_PORT,
    SOURCE_DNS_INBOUND_TAG,
    SOURCE_DNS_INBOUND_ADDRESS,
    SOURCE_DNS_INBOUND_PORT,
    SYSTEM_TPROXY_INBOUND_TAG,
    SYSTEM_TPROXY_INBOUND6_TAG,
    SYSTEM_TPROXY_INBOUND_PORT,
    SYSTEM_DNS_INBOUND_TAG,
    SYSTEM_DNS_INBOUND_ADDRESS,
    SYSTEM_DNS_INBOUND_PORT,
    SERVICE_MIXED_INBOUND_ADDRESS,
    WARP_PROFILES_MIXED_INBOUND_TAG,
    WARP_PROFILES_MIXED_INBOUND_PORT,
    DIRECT_OUTBOUND_TAG,
    CLASH_API_CONTROLLER_PORT,
    OUTBOUND_MARK,
    FAKEIP_INET4_RANGE,
    FAKEIP_INET6_RANGE,
    URLTEST_DEFAULT_IDLE_TIMEOUT,
    CHECK_PROXY_IP_DOMAIN,
    FAKEIP_TEST_DOMAIN,
    TMP_SING_BOX_FOLDER,
    SERVER_FIREWALL_COMMENT,
    FILTERABLE_PROVIDER_TYPES,
    FILTERABLE_GROUP_TYPES,
    RESERVED_OVERRIDE_PATCH_PATHS,
    LINK_SCHEME_OUTBOUND_TYPES,
    RESERVED_TAGS,
    tag,
    outbound_tag,
    child_tag,
    domain_resolver_tag,
    server_inbound_tag,
    tailscale_dns_server_tag
};
