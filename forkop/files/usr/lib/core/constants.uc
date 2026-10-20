// Forkop's own names, paths and marks; the sing-box configuration's are in singbox/constants.uc.

return {
    FORKOP_VERSION: "__COMPILED_VERSION_VARIABLE__",
    FORKOP_CONFIG_NAME: "forkop",
    FORKOP_BIN: "/usr/bin/forkop",
    FORKOP_SERVICE_INIT: "/etc/init.d/forkop",
    // START in the init script, which names its rc.d links.
    FORKOP_START_PRIORITY: "99",
    FORKOP_RELEASE_REPO: "ushan0v/forkop",
    FORKOP_LUCI_VIEW_DIR: "/www/luci-static/resources/view/forkop",
    FORKOP_LUCI_I18N_DOMAIN: "forkop",
    // Tags match at the start of a message, so a LuCI login on a Forkop page stays out.
    FORKOP_LOG_PATTERN: "^\\(forkop\\|sing-box\\)\\|^procd: .*\\(forkop\\|sing-box\\)",

    RT_TABLE_NAME: "forkop",

    NFT_TABLE_NAME: "ForkopTable",
    NFT_LOCALV4_SET_NAME: "localv4",
    NFT_LOCALV6_SET_NAME: "localv6",
    NFT_INTERFACE_SET_NAME: "forkop_interfaces",
    NFT_PAUSE_CHAIN_NAME: "capture_pause",
    NFT_FAKEIP_MARK: "0x04000000",
    NFT_OUTBOUND_MARK: "0x08000000",
    // A redirect hooked earlier would take a query before Forkop sees it.
    NFT_DNS_REDIRECT_PRIORITY: -101,
    NFT_SYSTEM_DNS_REDIRECT_PRIORITY: -100,

    SB_REQUIRED_VERSION: "1.14.3-r1"
};
