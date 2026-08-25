#!/usr/bin/env ucode

function as_string(value) {
    return value == null ? "" : "" + value;
}

function env(name, fallback) {
    let value = getenv(name);
    return value == null ? as_string(fallback) : as_string(value);
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function constants_map() {
    let c = {};

    c.FORKOP_VERSION = env("FORKOP_VERSION", "__COMPILED_VERSION_VARIABLE__");
    c.FORKOP_CONFIG_NAME = env("FORKOP_CONFIG_NAME", "forkop");
    c.FORKOP_CONFIG = env("FORKOP_CONFIG", "/etc/config/" + c.FORKOP_CONFIG_NAME);
    c.FORKOP_BIN = env("FORKOP_BIN", "/usr/bin/forkop");
    c.FORKOP_SERVICE_NAME = env("FORKOP_SERVICE_NAME", "forkop");
    c.FORKOP_SERVICE_INIT = env("FORKOP_SERVICE_INIT", "/etc/init.d/forkop");
    c.FORKOP_RELEASE_REPO = env("FORKOP_RELEASE_REPO", "ushan0v/forkop");
    c.FORKOP_LUCI_VIEW_DIR = env("FORKOP_LUCI_VIEW_DIR", "/www/luci-static/resources/view/forkop");
    c.FORKOP_LUCI_I18N_DOMAIN = env("FORKOP_LUCI_I18N_DOMAIN", "forkop");

    c.CHECK_PROXY_IP_DOMAIN = env("CHECK_PROXY_IP_DOMAIN", "ip.podkop.fyi");
    c.FAKEIP_TEST_DOMAIN = env("FAKEIP_TEST_DOMAIN", "fakeip.podkop.fyi");
    c.TMP_SING_BOX_FOLDER = env("TMP_SING_BOX_FOLDER", "/tmp/sing-box");
    c.CLOUDFLARE_OCTETS = env("CLOUDFLARE_OCTETS", "8.47 162.159 188.114");
    c.COREUTILS_BASE64_REQUIRED_VERSION = env("COREUTILS_BASE64_REQUIRED_VERSION", "9.7");
    c.RT_TABLE_NAME = env("RT_TABLE_NAME", "forkop");

    c.NFT_TABLE_NAME = env("NFT_TABLE_NAME", "ForkopTable");
    c.NFT_LOCALV4_SET_NAME = env("NFT_LOCALV4_SET_NAME", "localv4");
    c.NFT_LOCALV6_SET_NAME = env("NFT_LOCALV6_SET_NAME", "localv6");
    c.NFT_INTERFACE_SET_NAME = env("NFT_INTERFACE_SET_NAME", "forkop_interfaces");
    c.NFT_FAKEIP_MARK = env("NFT_FAKEIP_MARK", "0x04000000");
    c.NFT_OUTBOUND_MARK = env("NFT_OUTBOUND_MARK", "0x08000000");

    c.SB_REQUIRED_VERSION = env("SB_REQUIRED_VERSION", "1.13.18-extended-2.6.5-f39");
    c.SB_FAKEIP_INET4_RANGE = env("SB_FAKEIP_INET4_RANGE", "198.18.0.0/15");
    c.SB_FAKEIP_INET6_RANGE = env("SB_FAKEIP_INET6_RANGE", "fc00::/18");
    c.SB_TPROXY_INBOUND_TAG = env("SB_TPROXY_INBOUND_TAG", "tproxy-in");
    c.SB_TPROXY_INBOUND6_ADDRESS = env("SB_TPROXY_INBOUND6_ADDRESS", "::1");
    c.SB_TPROXY_INBOUND_PORT = env("SB_TPROXY_INBOUND_PORT", "1602");
    c.SB_DNS_INBOUND_ADDRESS = env("SB_DNS_INBOUND_ADDRESS", "127.0.0.42");
    c.SB_SERVICE_MIXED_INBOUND_ADDRESS = env("SB_SERVICE_MIXED_INBOUND_ADDRESS", "127.0.0.1");
    c.SB_SERVICE_MIXED_INBOUND_PORT = env("SB_SERVICE_MIXED_INBOUND_PORT", "4534");
    c.SB_CLASH_API_CONTROLLER_PORT = env("SB_CLASH_API_CONTROLLER_PORT", "9090");

    c.SRS_MAIN_URL = env("SRS_MAIN_URL", "https://github.com/itdoginfo/allow-domains/releases/latest/download");
    c.SRS_ADS_HAGEZI_PRO_URL = env("SRS_ADS_HAGEZI_PRO_URL", "https://github.com/zxc-rv/ad-filter/releases/latest/download/adlist.srs");
    c.SRS_SUPERCELL_URL = env("SRS_SUPERCELL_URL", "https://raw.githubusercontent.com/ushan0v/sing-box-supercell-ruleset/main/supercell.srs");
    c.COMMUNITY_SERVICES = env("COMMUNITY_SERVICES", "russia_inside russia_outside ukraine_inside geoblock block porn news anime youtube hdrezka tiktok google_ai google_play hodca discord meta twitter cloudflare cloudfront digitalocean hetzner ovh telegram roblox ads_hagezi_pro supercell github");

    return c;
}

function print_shell_env(constants) {
    for (let name in sort(keys(constants)))
        print(name, "=", shell_quote(constants[name]), "\n");
}

function module_exports() {
    return constants_map();
}

if (sourcepath(1) != null && sourcepath(1) != "")
    return module_exports();

let mode = ARGV[0] || "";
let constants = constants_map();

if (mode == "shell-env")
    print_shell_env(constants);
else if (mode == "json")
    print(sprintf("%J", constants), "\n");
else if (mode == "get")
    print(as_string(constants[ARGV[1]]), "\n");
else {
    warn("Usage: core/constants.uc <shell-env|json|get> ...\n");
    exit(1);
}
