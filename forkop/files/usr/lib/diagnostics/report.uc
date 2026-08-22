// Renders the machine readable check results into the text of `forkop
// global_check`. Every function here takes a value the checks already
// produced and returns lines; nothing in this module inspects the router, so
// the report layout can be changed and tested without a live system.

function as_string(value) {
    return value == null ? "" : "" + value;
}

function object_or_empty(value) {
    return type(value) == "object" ? value : {};
}

function field(value, key) {
    return type(value) == "object" && value[key] != null ? as_string(value[key]) : "";
}

function number_field(value, key) {
    let text = field(value, key);
    return text == "" ? 0 : int(text);
}

// The checks report flags as 1/0 numbers, but they travel through JSON and
// through UCI strings, so both shapes are accepted.
function is_set(value) {
    return as_string(value) == "1";
}

function flag_line(value, key, ok_message, fail_message) {
    return is_set(value[key]) ? ok_message : fail_message;
}

function system_info(value) {
    value = object_or_empty(value);
    let lines = [
        "🕳️ Forkop:   " + (field(value, "forkop_version") || "unknown"),
        "🕳️ LuCI App:      " + (field(value, "luci_app_version") || "unknown"),
        "📦 Sing-box:      " + (field(value, "sing_box_version") || "unknown")
    ];

    if (is_set(value.zapret_installed))
        push(lines, "🧵 Zapret:        " + (field(value, "zapret_version") || "unknown"));
    if (is_set(value.zapret2_installed))
        push(lines, "🧵 Zapret2:       " + (field(value, "zapret2_version") || "unknown"));
    if (is_set(value.byedpi_installed))
        push(lines, "🧵 ByeDPI:        " + (field(value, "byedpi_version") || "unknown"));

    push(lines, "🛜 OpenWrt:       " + (field(value, "openwrt_version") || "unknown"));
    push(lines, "🛜 Device:        " + (field(value, "device_model") || "unknown"));
    return lines;
}

function sing_box_check(value) {
    value = object_or_empty(value);
    return [
        flag_line(value, "sing_box_installed", "✅ Sing-box installed", "❌ Sing-box installed"),
        flag_line(value, "sing_box_version_ok", "✅ Sing-box version is compatible (newer than 1.12.4)", "❌ Sing-box version is not compatible (older than 1.12.4)"),
        flag_line(value, "sing_box_service_exist", "✅ Sing-box service exist", "❌ Sing-box service exist"),
        flag_line(value, "sing_box_autostart_disabled", "✅ Sing-box autostart disabled", "❌ Sing-box autostart disabled"),
        flag_line(value, "sing_box_process_running", "✅ Sing-box process running", "❌ Sing-box process running"),
        flag_line(value, "sing_box_ports_listening", "✅ Sing-box listening ports", "❌ Sing-box listening ports")
    ];
}

function fakeip_check(value) {
    value = object_or_empty(value);
    if (is_set(value.fakeip) || value.fakeip == true)
        return [ "✅ Sing-box FakeIP DNS works: " + field(value, "IP") ];
    return [ "❌ Sing-box FakeIP DNS does NOT work" ];
}

// Returns the DNS section plus whether the DHCP configuration still has to be
// dumped after it, which happens when Forkop does not own dnsmasq or when the
// configuration no longer matches the template Forkop writes.
function dns_check(value, dont_touch_dhcp) {
    value = object_or_empty(value);
    let lines = [];
    let bootstrap_dns_server = field(value, "bootstrap_dns_server");
    let dump_dhcp_config = false;

    if (bootstrap_dns_server != "")
        push(lines, (is_set(value.bootstrap_dns_status) ? "✅ Bootstrap DNS: " : "❌ Bootstrap DNS: ") + bootstrap_dns_server);

    push(lines, (is_set(value.dns_status) ? "✅ Main DNS: " : "❌ Main DNS: ") + (field(value, "dns_server") || "unknown"));
    push(lines, is_set(value.dns_on_router) ? "✅ DNS on router" : "❌ DNS on router");

    if (dont_touch_dhcp) {
        push(lines, "⚠️ dont_touch_dhcp is enabled. 📄 DHCP config:");
        dump_dhcp_config = true;
    }
    else if (!is_set(value.dhcp_config_status)) {
        push(lines, "❌ DHCP configuration differs from template. 📄 DHCP config:");
        dump_dhcp_config = true;
    }
    else {
        push(lines, "✅ /etc/config/dhcp");
    }

    return { lines, dump_dhcp_config };
}

function nft_check(value) {
    if (type(value) != "object")
        return null;

    let lines = [
        flag_line(value, "table_exist", "✅ Table exist", "❌ Table exist"),
        flag_line(value, "rules_mangle_exist", "✅ Rules mangle exist", "❌ Rules mangle exist"),
        flag_line(value, "rules_mangle_counters", "✅ Rules mangle counters", "⚠️  Rules mangle counters"),
        flag_line(value, "rules_mangle_output_exist", "✅ Rules mangle output exist", "❌ Rules mangle output exist"),
        flag_line(value, "rules_mangle_output_counters", "✅ Rules mangle output counters", "⚠️  Rules mangle output counters"),
        flag_line(value, "rules_proxy_exist", "✅ Rules proxy exist", "❌ Rules proxy exist"),
        flag_line(value, "rules_proxy_counters", "✅ Rules proxy counters", "⚠️  Rules proxy counters")
    ];

    push(lines, is_set(value.rules_other_mark_exist)
        ? "⚠️  Additional marking rules found:"
        : "✅ No other marking rules found");
    return lines;
}

function inbound_item_lines(item, wan_ip) {
    let lines = [];
    let label = field(item, "label");
    let protocol = field(item, "protocol");
    let listen = field(item, "listen");
    let listen_port = field(item, "listen_port");
    let public_host = field(item, "public_host");
    let required_proto = field(item, "required_proto");

    if (is_set(item.runtime_ok))
        push(lines, "[OK] " + label + ": runtime " + field(item, "tag") + " [" + protocol + "]");
    else
        push(lines, "[FAIL] " + label + ": generated inbound is missing or differs from UCI");

    if (protocol == "json_inbound") {
        push(lines, "[OK] " + label + ": JSON inbound uses custom listen settings");
    }
    else if (protocol != "tailscale") {
        if (is_set(item.listening))
            push(lines, "[OK] " + label + ": listening on " + listen + ":" + listen_port + " [" + required_proto + "]");
        else
            push(lines, "[FAIL] " + label + ": not listening on " + listen + ":" + listen_port + " [" + required_proto + "]");

        if (is_set(item.port_conflict))
            push(lines, "[FAIL] " + label + ": " + listen + ":" + listen_port + " [" + required_proto + "] is already used by " + field(item, "port_conflict_owners"));
        else
            push(lines, "[OK] " + label + ": no local port conflict detected");

        if (is_set(item.firewall_required)) {
            if (is_set(item.firewall_open))
                push(lines, "[OK] " + label + ": firewall accepts " + required_proto + "/" + listen_port + " from WAN");
            else
                push(lines, "[FAIL] " + label + ": firewall does not accept " + required_proto + "/" + listen_port + " from WAN");
        }
        else {
            // A listener that cannot be reached from WAN needs no rule, which is an
            // answer and not a complaint - the same verdict the Diagnostics tab gives.
            push(lines, "[OK] " + label + ": no firewall rule needed for listen address " + listen);
        }
    }
    else {
        push(lines, "[OK] " + label + ": Tailscale endpoint does not need a public firewall port");
    }

    if (is_set(item.routes_configured))
        push(lines, "[OK] " + label + ": route rules for inbound exist");
    else
        push(lines, "[WARN] " + label + ": route rules for inbound were not found");

    if (protocol != "tailscale" && protocol != "json_inbound") {
        if (public_host == "") {
            push(lines, "[WARN] " + label + ": public host is empty");
        }
        else if (field(item, "public_host_resolved") == "0")
            push(lines, "[WARN] " + label + ": public host does not resolve: " + public_host);
        else if (field(item, "public_host_public") == "0")
            push(lines, "[WARN] " + label + ": public host is not public: " + public_host);
        else if (field(item, "public_host_matches_wan") == "0")
            push(lines, "[WARN] " + label + ": public host resolves to " + field(item, "public_host_ips") + ", WAN is " + wan_ip);
        else
            push(lines, "[OK] " + label + ": public host " + public_host);
    }

    return lines;
}

function inbounds_check(value) {
    if (type(value) != "object")
        return null;

    let enabled_count = number_field(value, "enabled_count");
    let wan_ip = field(value, "wan_ip");

    if (enabled_count == 0)
        return [ "[OK] No enabled server inbounds" ];

    let lines = [];
    if (number_field(value, "wan_public") == 1)
        push(lines, "[OK] WAN public IP: " + wan_ip);
    else if (wan_ip != "")
        push(lines, "[WARN] WAN IP is not public: " + wan_ip);
    else
        push(lines, "[WARN] WAN IP was not detected");

    let items = type(value.items) == "array" ? value.items : [];
    for (let i = 0; i < enabled_count; i++)
        for (let line in inbound_item_lines(type(items[i]) == "object" ? items[i] : {}, wan_ip))
            push(lines, line);

    return lines;
}

// The dnsmasq section of /etc/config/dhcp, printed when the DNS check reports
// that Forkop is not the one steering resolution. Takes the file split into
// lines so that this module never touches the filesystem.
function dnsmasq_config(config_lines) {
    let result = [];
    let in_dnsmasq = false;

    for (let line in config_lines) {
        if (match(as_string(line), /^config /) != null) {
            let fields = split(trim(as_string(line)), /[ \t\r\n]+/);
            in_dnsmasq = length(fields) >= 2 && fields[1] == "dnsmasq";
        }

        if (in_dnsmasq)
            push(result, line);
    }

    return result;
}

// Marking rules outside the Forkop table steal packets from the proxy chain,
// so the ones a foreign table installs are quoted verbatim in the report.
function nft_other_mark_lines(data, table_name) {
    table_name = as_string(table_name);
    let result = [];
    let in_forkop_table = false;

    for (let line in split(as_string(data), "\n")) {
        line = as_string(line);
        if (index(line, "table inet " + table_name) >= 0) {
            in_forkop_table = true;
            continue;
        }

        if (match(line, /^table/) != null)
            in_forkop_table = false;

        if (!in_forkop_table && (index(line, "mark set") >= 0 || index(line, "meta mark") >= 0))
            push(result, line);
    }

    return result;
}

return {
    system_info,
    sing_box_check,
    fakeip_check,
    dns_check,
    nft_check,
    inbounds_check,
    dnsmasq_config,
    nft_other_mark_lines
};
