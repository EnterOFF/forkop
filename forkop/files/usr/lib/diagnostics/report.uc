let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let constants = require("core.constants");
let core_ip = require("core.ip");
let core_url = require("core.url");
let uci = require("core.uci");
let mask = require("diagnostics.mask");

const LOG_LINES = 200;

let paths = {
    forkop_config: "/etc/config/forkop"
};

function output(argv) {
    return exec.output(argv) ?? "";
}

function last_lines(text, count) {
    let lines = split(rtrim(text ?? "", "\n"), "\n");
    return join("\n", slice(lines, length(lines) > count ? length(lines) - count : 0)) + "\n";
}

function server_hosts() {
    let result = [];
    for (let section in uci.section_objects(constants.FORKOP_CONFIG_NAME, "server"))
        for (let key in [ "public_host", "tls_server_name" ]) {
            let host = lc(trim(common.option(section, key, "")));
            if (host != "" && match(host, /[a-z]/) != null && index(host, ":") < 0)
                push(result, host);
        }
    return result;
}

// Public resolvers stay readable: which one the router asks matters to any DNS question.
function resolver_addresses(settings) {
    let result = [];
    for (let key in [ "dns_server", "bootstrap_dns_server" ])
        for (let server in common.list_option(settings, key)) {
            let host = core_url.host(server) || server;
            if (core_ip.valid_ip(host))
                push(result, host);
        }
    return result;
}

function report(visibility, checks) {
    let masked = visibility != "raw";
    let settings = uci.get_all(constants.FORKOP_CONFIG_NAME, "settings") ?? {};
    let sing_box = common.read_json_file(common.option(settings, "config_path", ""));
    let hosts = masked ? sort(uniq([ ...mask.hosts(sing_box), ...server_hosts() ]), (a, b) => length(b) - length(a)) : [];
    let resolvers = resolver_addresses(settings);
    let text = (value) => masked ? mask.text(value, hosts, resolvers) : value;
    let names = (value) => masked ? mask.names(value, hosts) : value;
    let forkop = fs.readfile(paths.forkop_config) ?? "";

    return {
        checks: text(checks ?? ""),
        log: text(last_lines(output([ "logread", "-e", constants.FORKOP_LOG_PATTERN ]), LOG_LINES)),
        forkop_config: names(masked ? mask.forkop_config(forkop) : forkop),
        sing_box_config: sing_box == null ? "" : names(sprintf("%.2J\n", masked ? mask.sing_box_config(sing_box) : sing_box)),
        nftables: text(output([ "nft", "-t", "list", "table", "inet", constants.NFT_TABLE_NAME ])),
        ip_rules: text(output([ "ip", "-4", "rule" ]) + output([ "ip", "-6", "rule" ]))
    };
}

return { paths, report };
