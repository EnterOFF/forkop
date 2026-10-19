// Seeds the fake uci from the fixture shape the tests describe a configuration
// in: { settings: {...}, section: [...], server: [...], ... } for /etc/config/forkop,
// plus dhcp_dnsmasq for the first dnsmasq section of /etc/config/dhcp.

let uci = require("uci");
let core_uci = require("core.uci");
let core_url = require("core.url");

const TYPES = [
    "settings", "section", "server", "server_client", "subscription_url", "section_interface",
    "connection_link", "urltest", "fallback_group", "fallback_level", "tunnel", "tunnel_peer"
];

// The connection_link children a section dials, named the way the page names a
// pasted link: after the link itself, or "Node #N" by its position, and "#1" on
// for a name an earlier link already took.
function links(section_name, uris, extra) {
    let result = [];
    let taken = {};
    for (let i = 0; i < length(uris); i++) {
        let base = core_url.link_name(uris[i]) || "Node #" + (i + 1);
        let name = base;
        for (let number = 1; taken[name]; number++)
            name = base + " #" + number;
        taken[name] = true;
        push(result, {
            ".name": section_name + "_link" + (i + 1),
            section: section_name,
            uri: uris[i],
            name,
            order: "" + i,
            ...(extra ?? {})
        });
    }
    return result;
}

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

return { seed, settings, links };
