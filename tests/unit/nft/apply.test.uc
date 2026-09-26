let t = require("t");
let stub = require("stub");
let fixture = require("fixture");
let fs = require("fs");
let nft = require("nft.apply");

function built(data) {
    fixture.seed(data);
    return nft.build();
}

function script_lines(data) {
    return split(built(data).script, "\n");
}

function has(lines, line, label) {
    t.ok(index(lines, line) >= 0, (label ?? "missing line") + ": " + line);
}

function lacks(lines, text, label) {
    t.eq(filter(lines, (line) => index(line, text) >= 0), [], label ?? ("unexpected " + text));
}

function before(lines, first, second, label) {
    let a = index(lines, first), b = index(lines, second);
    t.ok(a >= 0 && b >= 0 && a < b, label + ": " + first + " before " + second);
}

const T = "add rule inet ForkopTable ";

t.test("the base table captures the source interfaces, FakeIP and the TProxy inbounds", () => {
    let lines = script_lines({ settings: { source_network_interfaces: "br-lan tun0", exclude_ntp: "1" } });
    t.eq(slice(lines, 0, 3), [ "table inet ForkopTable", "delete table inet ForkopTable", "add table inet ForkopTable" ],
        "the table is created, deleted and built again in one transaction");
    has(lines, "add set inet ForkopTable localv4 { type ipv4_addr; flags interval; auto-merge; }");
    has(lines, "add set inet ForkopTable localv6 { type ipv6_addr; flags interval; auto-merge; }");
    t.ok(length(filter(lines, (l) => index(l, "add element inet ForkopTable localv4 { 0.0.0.0/8,10.0.0.0/8,127.0.0.0/8") == 0)) == 1);
    has(lines, "add set inet ForkopTable forkop_interfaces { type ifname; flags interval; }");
    has(lines, "add element inet ForkopTable forkop_interfaces { br-lan }");
    has(lines, "add element inet ForkopTable forkop_interfaces { tun0 }");
    has(lines, "add chain inet ForkopTable mangle { type filter hook prerouting priority -149; policy accept; }", "mangle runs after the Tailscale connmark restore");
    has(lines, T + "priority_output_rules meta mark != 0 return", "a provider mark is preserved");
    has(lines, "add chain inet ForkopTable dns_redirect { type nat hook prerouting priority -101; policy accept; }");
    has(lines, T + "dns_redirect iifname @forkop_interfaces udp dport 53 counter redirect to :1603");
    has(lines, T + "dns_redirect iifname @forkop_interfaces tcp dport 53 counter redirect to :1603");
    has(lines, T + "mangle iifname @forkop_interfaces ip6 daddr @localv6 ip6 daddr != fc00::/18 return", "local IPv6 keeps FakeIP6 captured");
    has(lines, T + "mangle jump priority_rules");
    has(lines, T + "proxy meta mark & 0x04000000 == 0x04000000 meta l4proto tcp tproxy ip to :1602 counter");
    has(lines, T + "proxy meta mark & 0x04000000 == 0x04000000 meta l4proto tcp tproxy ip6 to [::1]:1602 counter");
    before(lines, T + "proxy iifname lo meta mark & 0x04000000 == 0x04000000 meta l4proto tcp tproxy ip to :1604 counter accept",
        T + "proxy meta mark & 0x04000000 == 0x04000000 meta l4proto tcp tproxy ip to :1602 counter", "System TProxy classification");
    has(lines, T + "proxy iifname lo meta mark & 0x04000000 == 0x04000000 meta l4proto tcp tproxy ip6 to [::1]:1604 counter accept");
    has(lines, T + "mangle_output meta mark 0x08000000 counter return");
    has(lines, T + "mangle_output jump priority_output_rules");
    has(lines, "insert rule inet ForkopTable mangle udp dport 123 return", "the NTP exclusion");
    for (let pair in [ [ "ip", "198.18.0.0/15" ], [ "ip6", "fc00::/18" ] ])
        for (let proto in [ "tcp", "udp" ])
            has(lines, T + "mangle_output " + pair[0] + " daddr " + pair[1] + " meta l4proto " + proto + " meta mark set 0x04000000 counter",
                "the router's own FakeIP traffic");
    for (let absent in [ "forkop_subnets", "forkop_ports", "forkop_ip_ports", "forkop_dns_sources", "system_dns_redirect", "forkop_excluded" ])
        lacks(lines, absent);
});

t.test("excluded devices leave every capture before anything matches them", () => {
    let lines = script_lines({ settings: { routing_excluded_ips: "192.168.1.50 2001:db8::5/128" } });
    has(lines, "add set inet ForkopTable forkop_excluded { type ipv4_addr; flags interval; auto-merge; }");
    has(lines, "add element inet ForkopTable forkop_excluded { 192.168.1.50 }");
    has(lines, "add element inet ForkopTable forkop_excluded6 { 2001:db8::5/128 }");
    before(lines, T + "dns_redirect ip saddr @forkop_excluded counter return", T + "dns_redirect iifname @forkop_interfaces tcp dport 53 counter redirect to :1603",
        "the DNS exclusion");
    before(lines, T + "mangle ip saddr @forkop_excluded counter return", T + "mangle jump priority_rules", "the capture exclusion");
    has(lines, T + "mangle ip6 saddr @forkop_excluded6 counter return");
});

function priority_sections() {
    return [
        { ".name": "bypass_first", action: "bypass", ip_cidr: [ "198.51.100.0/24" ], fully_routed_ips: [ "192.168.1.10/32", "2001:db8::10/128", "@system" ] },
        { ".name": "wide_proxy", action: "proxy", ip_cidr: [ "0.0.0.0/0" ], fully_routed_ips: [ "192.168.1.20/32", "2001:db8::20/128", "@system" ] },
        { ".name": "port_bypass", action: "bypass", ports: [ "8443" ] },
        { ".name": "system_filter", action: "proxy", ip_cidr: [ "203.0.113.0/24" ], source_ip_cidr: [ "@system" ] },
        { ".name": "client_filter", action: "proxy", ip_cidr: [ "192.0.2.0/24" ], source_ip_cidr: [ "192.168.1.50/32" ] },
        { ".name": "builtin_subnets", action: "proxy", community_lists: [ "discord" ] },
        { ".name": "ip_and_ports", action: "proxy", ip_cidr: [ "203.0.113.0/24" ], ports: [ "8080" ] }
    ];
}

t.test("section rules keep configuration order and reach only the traffic their devices send", () => {
    let lines = script_lines({ settings: {}, section: priority_sections() });
    let local = "ip daddr != @localv4 ";
    has(lines, "add set inet ForkopTable forkop_rule_bypass_first_subnets { type ipv4_addr; flags interval; auto-merge; }");
    has(lines, T + "priority_rules iifname @forkop_interfaces ip saddr @forkop_rule_bypass_first_fully_sources " + local + "ip daddr != 198.18.0.0/15 counter accept",
        "a fully routed bypass takes real addresses");
    has(lines, T + "priority_rules iifname @forkop_interfaces ip6 saddr @forkop_rule_bypass_first_fully_sources6 ip6 daddr != @localv6 ip6 daddr != fc00::/18 counter accept");
    has(lines, T + "priority_rules iifname @forkop_interfaces ip saddr @forkop_rule_wide_proxy_fully_sources " + local + "meta l4proto tcp meta mark set 0x04000000 counter accept");
    has(lines, T + "priority_output_rules " + local + "ip daddr != 198.18.0.0/15 counter accept", "the System device fully routed around the proxy");
    has(lines, T + "priority_output_rules " + local + "meta l4proto tcp meta mark set 0x04000000 counter accept", "the System device fully routed through it");
    has(lines, T + "priority_output_rules " + local + "ip daddr @forkop_rule_system_filter_subnets meta mark set 0x04000000 counter accept");
    has(lines, T + "priority_rules iifname @forkop_interfaces ip saddr @forkop_rule_client_filter_sources " + local + "ip daddr @forkop_rule_client_filter_subnets meta mark set 0x04000000 counter accept");
    t.eq(filter(lines, (l) => index(l, "priority_rules iifname") >= 0 && index(l, "system_filter") >= 0), [], "a System-only filter on forwarded traffic");
    t.eq(filter(lines, (l) => index(l, "priority_output_rules") >= 0 && index(l, "client_filter") >= 0), [], "a client filter on the router's traffic");
    lacks(lines, "@system", "the System sentinel is not an address");
    has(lines, T + "priority_rules iifname @forkop_interfaces " + local + "ip daddr != 198.18.0.0/15 tcp dport @forkop_rule_port_bypass_ports counter accept");
    before(lines, T + "priority_rules iifname @forkop_interfaces " + local + "ip daddr != 198.18.0.0/15 ip daddr @forkop_rule_bypass_first_subnets counter accept",
        T + "priority_rules iifname @forkop_interfaces " + local + "ip daddr @forkop_rule_wide_proxy_subnets meta mark set 0x04000000 counter accept", "bypass order");

    has(lines, "add set inet ForkopTable forkop_rule_builtin_subnets_ip_ports { type ipv4_addr . inet_service; flags interval; auto-merge; }",
        "a built-in list's port-scoped addresses have a set a rule reads");
    has(lines, T + "priority_rules iifname @forkop_interfaces " + local + "ip daddr . udp dport @forkop_rule_builtin_subnets_ip_ports meta mark set 0x04000000 counter accept");
    has(lines, "add set inet ForkopTable forkop_rule_builtin_subnets_proto6_ports { type ipv6_addr . inet_proto . inet_service; flags interval; auto-merge; }");
    t.eq(length(filter(lines, (l) => index(l, "th dport @forkop_rule_builtin_subnets_proto_ports") >= 0)), 2, "one rule per chain covers both transports");
    has(lines, T + "priority_rules iifname @forkop_interfaces " + local + "ip daddr @forkop_rule_ip_and_ports_subnets tcp dport @forkop_rule_ip_and_ports_ports meta mark set 0x04000000 counter accept",
        "an address with a port is matched against both plain sets");
    has(lines, T + "priority_output_rules ip6 daddr != @localv6 ip6 daddr @forkop_rule_ip_and_ports_subnets6 udp dport @forkop_rule_ip_and_ports_ports meta mark set 0x04000000 counter accept");
    lacks(lines, "ip daddr @forkop_rule_ip_and_ports_subnets meta mark", "an address with a port is never matched without it");
    lacks(lines, T + "priority_rules iifname @forkop_interfaces " + local + "tcp dport @forkop_rule_ip_and_ports_ports", "a port next to an address on its own");

    for (let absent in [ "forkop_rule_port_bypass_subnets", "forkop_rule_port_bypass_sources", "forkop_rule_bypass_first_ports",
        "forkop_rule_bypass_first_sources", "forkop_rule_client_filter_fully_sources", "forkop_rule_system_filter_sources",
        "forkop_rule_ip_and_ports_ip_ports", "forkop_rule_ip_and_ports_proto_ports",
        "forkop_rule_bypass_first_proto_ports", "forkop_rule_builtin_subnets_ports" ])
        lacks(lines, "add set inet ForkopTable " + absent + " ", "no rule reads " + absent);
});

t.test("the sets are filled in the same transaction from what the configuration lists", () => {
    let lines = script_lines({ settings: {}, section: [
        { ".name": "disabled", enabled: "0", action: "proxy", ip_cidr: [ "192.0.2.1" ], ports: [ "53" ] },
        { ".name": "inline", action: "proxy", ip_cidr: [ "198.51.100.1", "203.0.113.0/24", "2001:db8::1" ], source_ip_cidr: [ "192.168.1.60/32" ],
            ports: [ "80", "443-444" ], fully_routed_ips: [ "192.168.1.20/32", "192.168.1.20/32", "2001:db8::20/128", "@system" ] },
        { ".name": "inline_no_ports", action: "bypass", ip_cidr: [ "198.51.100.200", "2001:db8::200" ], fully_routed_ips: [ "192.168.1.21/32" ] },
        { ".name": "ports_only", action: "proxy", ports: [ "53", "853" ], ports_text: "5353, 853" },
        { ".name": "ports_with_domain", action: "proxy", domain_suffix: [ "example.org" ], ports: [ "8443" ] },
        { ".name": "dns_only", action: "dns", domain_suffix: [ "dns-only.example" ], ip_cidr: [ "192.0.2.53" ], fully_routed_ips: [ "192.168.1.53/32" ] },
        { ".name": "vpn", action: "proxy", fully_routed_ips: [ "@system" ] }
    ] });
    has(lines, "add element inet ForkopTable forkop_rule_inline_subnets { 198.51.100.1,203.0.113.0/24 }", "addresses and ports are not multiplied");
    has(lines, "add element inet ForkopTable forkop_rule_inline_subnets6 { 2001:db8::1 }");
    has(lines, "add element inet ForkopTable forkop_rule_inline_ports { 80,443-444 }");
    lacks(lines, "forkop_rule_inline_ip_ports", "only a provider limits addresses to ports of its own");
    has(lines, "add element inet ForkopTable forkop_rule_inline_no_ports_subnets { 198.51.100.200 }");
    has(lines, "add element inet ForkopTable forkop_rule_inline_no_ports_subnets6 { 2001:db8::200 }");
    has(lines, "add element inet ForkopTable forkop_rule_ports_only_ports { 53,853,5353 }");
    has(lines, "add element inet ForkopTable forkop_rule_inline_fully_sources { 192.168.1.20/32 }");
    has(lines, "add element inet ForkopTable forkop_rule_inline_fully_sources6 { 2001:db8::20/128 }");
    has(lines, "add element inet ForkopTable forkop_rule_inline_sources { 192.168.1.60/32 }");
    before(lines, "add set inet ForkopTable forkop_rule_inline_subnets { type ipv4_addr; flags interval; auto-merge; }",
        "add element inet ForkopTable forkop_rule_inline_subnets { 198.51.100.1,203.0.113.0/24 }", "a set exists before it is filled");
    lacks(lines, "192.0.2.1", "a disabled section");
    lacks(lines, "forkop_rule_ports_with_domain_ports", "a port next to a domain is sing-box's to match");
    lacks(lines, "192.0.2.53", "a DNS section's addresses");
    lacks(lines, "@system");

    has(lines, "add chain inet ForkopTable system_dns_redirect { type nat hook output priority -151; policy accept; }",
        "a section routing the System device captures the router's DNS");
    has(lines, T + "system_dns_redirect meta mark != 0 return");
    before(lines, T + "system_dns_redirect ip daddr 127.0.0.0/8 return", T + "system_dns_redirect udp dport 53 counter redirect to :1605", "loopback first");
    has(lines, T + "system_dns_redirect ip6 daddr ::1 return");
});

t.test("the script is the same for the same configuration and moves with anything nft matches on", () => {
    let base = { source_network_interfaces: "br-lan" };
    let script = (sections, settings) => built({ settings: settings ?? base, section: sections ?? [] }).script;
    let baseline = script();
    t.eq(script(), baseline);
    for (let section in [
        { ".name": "s", action: "proxy" },
        { ".name": "s", action: "proxy", domain_suffix_text: "a.example\nb.example" },
        { ".name": "s", action: "proxy", label: "Renamed" },
        { ".name": "s", enabled: "0", action: "proxy", ip_cidr: "192.0.2.0/24" },
        { ".name": "s", action: "proxy", rule_set: "https://example.com/domains.lst" }
    ])
        t.eq(script([ section ]), baseline, "nothing of " + sprintf("%J", section) + " reaches nft");
    for (let section in [
        { ".name": "s", action: "proxy", ip_cidr: "192.0.2.0/24" },
        { ".name": "s", action: "proxy", ports: "443" },
        { ".name": "s", action: "proxy", rule_set_with_subnets: "https://example.com/subnets.srs" },
        { ".name": "s", action: "proxy", community_lists: "telegram" },
        { ".name": "s", action: "bypass", fully_routed_ips: "192.168.1.10/32" }
    ])
        t.ok(script([ section ]) != baseline, sprintf("%J", section) + " reaches nft");
    t.ok(script(null, { source_network_interfaces: "br-lan", exclude_ntp: "1" }) != baseline);
    t.ok(script(null, { source_network_interfaces: "br-lan tun0" }) != baseline);
    t.ok(script([ { ".name": "s", action: "proxy", ip_cidr: "192.0.2.0/24" } ]) != script([ { ".name": "s", action: "proxy", ip_cidr: "198.51.100.0/24" } ]),
        "the elements are part of the table");
});

t.test("a value nft cannot take is left out and reported when the table is applied", () => {
    let result = built({ settings: { routing_excluded_ips: "192.168.1.50 phone" } });
    t.eq(result.skipped, [ "'phone' is not IP or CIDR" ]);
    t.contains(split(result.script, "\n"), "add element inet ForkopTable forkop_excluded { 192.168.1.50 }");
});

function routing(ip_state) {
    let dir = stub.tmpdir();
    nft.paths.rt_tables = dir + "/rt_tables";
    let logs = [];
    let handlers = [
        [ "logger", (argv) => { push(logs, argv[3]); return {}; } ],
        [ "/usr/libexec/ip-full route list table forkop", { stdout: ip_state?.route4 ?? "" } ],
        [ "/usr/libexec/ip-full -6 route list table forkop", { stdout: ip_state?.route6 ?? "" } ],
        [ "/usr/libexec/ip-full -4 rule list table forkop", { stdout: ip_state?.rule4 ?? "" } ],
        [ "/usr/libexec/ip-full -6 rule list table forkop", { stdout: ip_state?.rule6 ?? "" } ],
        [ /'\/usr\/libexec\/ip-full'.* 'add' /, {} ],
        [ /^'nft' '-f' '-'/, { status: ip_state?.nft_status ?? 0 } ]
    ];
    return { dir, logs, handlers };
}

t.test("applying the table sets up its routing once and hands nft the whole script", () => {
    fixture.seed({ settings: {} });
    let r = routing();
    stub.commands(r.handlers);
    nft.apply(nft.build());
    let calls = stub.calls();
    stub.restore();
    t.eq(fs.readfile(nft.paths.rt_tables), "105 forkop\n");
    let commands = map(calls, (c) => join(" ", c.argv));
    for (let line in [ "/usr/libexec/ip-full route add local 0.0.0.0/0 dev lo table forkop", "/usr/libexec/ip-full -6 route add local ::/0 dev lo table forkop",
        "/usr/libexec/ip-full -4 rule add fwmark 0x04000000/0x04000000 table forkop priority 105", "/usr/libexec/ip-full -6 rule add fwmark 0x04000000/0x04000000 table forkop priority 105" ])
        t.contains(commands, line);
    let transactions = filter(calls, (c) => c.argv[0] == "nft");
    t.eq(length(transactions), 1, "one transaction");
    t.eq(split(transactions[0].stdin, "\n")[0], "table inet ForkopTable");
    t.contains(r.logs, "[debug] Added IPv4 tproxy route");

    let present = routing({ route4: "local default dev lo scope host", route6: "local default dev lo metric 1024 pref medium",
        rule4: "105: from all fwmark 0x4000000/0x4000000 lookup forkop", rule6: "105: from all fwmark 0x4000000/0x4000000 lookup podkop" });
    fs.writefile(nft.paths.rt_tables, "105 forkop\n");
    stub.commands(present.handlers);
    nft.apply(nft.build());
    commands = stub.command_lines();
    stub.restore();
    t.eq(filter(commands, (line) => index(line, " add ") >= 0), [], "routing that is in place is left alone");
    t.eq(present.logs, [], "and nothing is reported about it");
});

t.test("a refused transaction fails with the first line nft gave", () => {
    fixture.seed({ settings: {} });
    let r = routing({ route4: "local default dev lo scope host", route6: "local default dev lo metric 1024 pref medium",
        rule4: "105: from all fwmark 0x4000000/0x4000000 lookup forkop", rule6: "105: from all fwmark 0x4000000/0x4000000 lookup forkop" });
    fs.writefile(nft.paths.rt_tables, "105 forkop\n");
    stub.commands([ [ /^'nft' '-f' '-'/, (argv, command) => {
        fs.writefile(match(command, /2>'([^']+)'/)[1], "Error: syntax error, unexpected junk\nadd element inet ForkopTable localv4 { junk }\n");
        return { status: 1 };
    } ], ...r.handlers ]);
    let e = t.throws(() => nft.apply(nft.build()));
    stub.restore();
    t.eq(e.message, "nft refused the ruleset: Error: syntax error, unexpected junk");
});

t.test("bridge netfilter is switched off only where it is on", () => {
    let calls = (lsmod) => {
        stub.commands([ [ "lsmod", { stdout: lsmod } ], [ "sysctl -n", { stdout: "1\n" } ], [ "sysctl -w", {} ], [ "logger", {} ] ]);
        nft.ensure_bridge_netfilter_disabled();
        let lines = stub.command_lines();
        stub.restore();
        return filter(lines, (line) => substr(line, 0, 6) == "sysctl");
    };
    t.eq(calls("br_netfilter 32768 0\n"), [ "sysctl -n net.bridge.bridge-nf-call-iptables", "sysctl -w net.bridge.bridge-nf-call-iptables=0",
        "sysctl -w net.bridge.bridge-nf-call-ip6tables=0" ]);
    t.eq(calls(""), []);
});

t.done();
