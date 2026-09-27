// Seeds the fake uci from the fixture shape the tests describe a configuration
// in: { settings: {...}, section: [...], server: [...], ... } for /etc/config/forkop,
// plus dhcp_dnsmasq for the first dnsmasq section of /etc/config/dhcp.

let uci = require("uci");
let core_uci = require("core.uci");

const TYPES = [
    "settings", "section", "server", "server_client", "subscription_url", "section_interface",
    "urltest", "fallback_group", "fallback_level", "tunnel", "tunnel_peer"
];

function listed(data, type_name) {
    let value = data[type_name] ?? data[type_name + "s"];
    if (type(value) == "object")
        return [ value ];
    return type(value) == "array" ? value : [];
}

function seed(data) {
    data = data ?? {};
    uci.__reset();
    core_uci.reset();

    let sections = [];
    for (let type_name in TYPES)
        for (let section in listed(data, type_name)) {
            let entry = { ...section };
            entry[".type"] = entry[".type"] ?? type_name;
            if (type_name == "settings")
                entry[".name"] = entry[".name"] ?? "settings";
            push(sections, entry);
        }
    uci.__seed("forkop", sections);

    if (data.dhcp_dnsmasq != null)
        uci.__seed("dhcp", [ { ".type": "dnsmasq", ...data.dhcp_dnsmasq } ]);
}

// The settings every generated configuration needs, merged with the test's own.
function settings(extra) {
    return {
        config_path: "/etc/sing-box/config.json",
        dns_server: "1.1.1.1",
        ...(extra ?? {})
    };
}

return { seed, settings };
