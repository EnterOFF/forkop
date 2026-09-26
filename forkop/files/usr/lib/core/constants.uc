// Forkop's own names, paths and marks. What the generated sing-box
// configuration binds and names lives in singbox/constants.uc.

return {
    FORKOP_VERSION: "__COMPILED_VERSION_VARIABLE__",
    FORKOP_CONFIG_NAME: "forkop",
    FORKOP_BIN: "/usr/bin/forkop",
    FORKOP_SERVICE_INIT: "/etc/init.d/forkop",
    FORKOP_RELEASE_REPO: "ushan0v/forkop",
    FORKOP_LUCI_VIEW_DIR: "/www/luci-static/resources/view/forkop",
    FORKOP_LUCI_I18N_DOMAIN: "forkop",

    RT_TABLE_NAME: "forkop",

    NFT_TABLE_NAME: "ForkopTable",
    NFT_LOCALV4_SET_NAME: "localv4",
    NFT_LOCALV6_SET_NAME: "localv6",
    NFT_INTERFACE_SET_NAME: "forkop_interfaces",
    NFT_FAKEIP_MARK: "0x04000000",
    NFT_OUTBOUND_MARK: "0x08000000",

    SB_REQUIRED_VERSION: "1.13.18-extended-2.6.5-f39"
};
