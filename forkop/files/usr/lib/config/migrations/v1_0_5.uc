// 1.0.2 → 1.0.5. 1.0.5 dropped HTTP and HTTPS proxy links: its own migration turned each one
// into an HTTP JSON outbound under the link's name. That step is repeated here as released, so
// a configuration from 1.0.2 reaches what 1.0.5 made of it.

let model = require("config.migrations.model");
let url = require("config.migrations.url_1_0_5");
let common = require("core.common");

let as_string = common.as_string;

function unique_tag(base, taken) {
    base = trim(base);
    if (base == "")
        base = "http";
    if (!taken[base])
        return base;
    for (let suffix = 1; suffix < 100000; suffix++)
        if (!taken[base + "-" + suffix])
            return base + "-" + suffix;
    return base + "-overflow";
}

function http_outbound(link, tag_name) {
    link = url.before(url.decode(link), [ "#" ]);
    let scheme = url.scheme(link);
    if (scheme != "http" && scheme != "https")
        return null;

    let port = url.port(link);
    let path = url.path(link);
    if (url.host(link) == "" || match(port, /^[0-9]+$/) == null || int(port) < 1 || int(port) > 65535 ||
        (path != "" && path != "/") || index(link, "?") >= 0)
        return null;

    let outbound = { type: "http", tag: tag_name, server: url.host(link), server_port: int(port) };
    let credentials = url.userinfo(link);
    if (credentials != "") {
        let colon = index(credentials, ":");
        outbound.username = colon >= 0 ? substr(credentials, 0, colon) : credentials;
        if (colon >= 0)
            outbound.password = substr(credentials, colon + 1);
    }
    if (scheme == "https")
        outbound.tls = { enabled: true };
    return outbound;
}

function http_links_become_outbounds(config) {
    for (let section in model.of_type(config, "section")) {
        let existing = model.list(section, "outbound_jsons");
        let taken = {};
        for (let value in existing) {
            let outbound = common.parse_json(value);
            let tag_name = type(outbound) == "object" ? trim(as_string(outbound.tag)) : "";
            if (tag_name != "")
                taken[tag_name] = true;
        }

        let links = [];
        let converted = [];
        for (let link in model.list(section, "selector_proxy_links")) {
            let tag_name = unique_tag(url.fragment(link), taken);
            let outbound = http_outbound(link, tag_name);
            if (outbound == null) {
                push(links, link);
                continue;
            }
            taken[tag_name] = true;
            push(converted, sprintf("%J", outbound));
        }
        if (length(converted) == 0)
            continue;

        if (length(links) > 0)
            section.selector_proxy_links = links;
        else
            delete section.selector_proxy_links;
        section.outbound_jsons = [ ...converted, ...existing ];
    }
}

return {
    version: "1.0.5",
    types: [ "settings", "section", "server", "subscription_url", "section_interface", "urltest", "priority_group", "priority_level" ],
    steps: [ http_links_become_outbounds ]
};
