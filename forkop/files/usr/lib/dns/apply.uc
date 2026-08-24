#!/usr/bin/env ucode

let uci = require("core.uci");
let dns_state = require("dns.state");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const SB_DNS_INBOUND_ADDRESS = getenv("SB_DNS_INBOUND_ADDRESS") || "127.0.0.42";
const DNSMASQ_INIT = getenv("DNSMASQ_INIT") || "/etc/init.d/dnsmasq";

function as_string(value) {
    return value == null ? "" : "" + value;
}

function shell_quote(value) {
    return "'" + replace(as_string(value), /'/g, "'\\''") + "'";
}

function run(command) {
    return system(command) == 0;
}

function words(value) {
    value = trim(as_string(value));
    return value == "" ? [] : split(value, /[ \t\r\n]+/);
}

function truthy(value) {
    value = lc(as_string(value));
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

function log(message, level) {
    level = as_string(level || "info");
    run("logger -t " + shell_quote("forkop") + " " + shell_quote("[" + level + "] " + as_string(message)));
}

function restart_dnsmasq() {
    return run("[ -x " + shell_quote(DNSMASQ_INIT) + " ] && " + shell_quote(DNSMASQ_INIT) + " restart");
}

let list_has = dns_state.list_has;
let dnsmasq_legacy_instance_exists = dns_state.dnsmasq_legacy_instance_exists;
let dnsmasq_default_servers = dns_state.dnsmasq_default_servers;
let dnsmasq_has_forkop_managed_state = dns_state.dnsmasq_has_forkop_managed_state;

function dnsmasq_management_disabled() {
    return truthy(uci.get(CONFIG_NAME + ".settings.dont_touch_dhcp"));
}

function dnsmasq_legacy_interfaces() {
    let legacy_dnsmasq_section = "forkop";
    let legacy_interfaces = uci.get("dhcp." + legacy_dnsmasq_section + ".interface");
    if (legacy_interfaces == "")
        legacy_interfaces = uci.get(CONFIG_NAME + ".settings.source_network_interfaces");
    if (legacy_interfaces == "")
        legacy_interfaces = "br-lan";

    return legacy_interfaces;
}

function restore_dnsmasq_rebind_protection(managed_global_dns) {
    let value = uci.get("dhcp.@dnsmasq[0].forkop_rebind_protection");
    if (value == "__unset__")
        uci.delete("dhcp.@dnsmasq[0].rebind_protection");
    else if (value != "")
        uci.set("dhcp.@dnsmasq[0].rebind_protection", value);
    else if (managed_global_dns)
        uci.set("dhcp.@dnsmasq[0].rebind_protection", "1");
    uci.delete("dhcp.@dnsmasq[0].forkop_rebind_protection");
}

// Restores one dnsmasq option from the backup Forkop took before changing it.
function restore_dnsmasq_config_option(key, backup_key) {
    uci.set("dhcp.@dnsmasq[0]." + key, uci.get("dhcp.@dnsmasq[0]." + backup_key));
    uci.delete("dhcp.@dnsmasq[0]." + backup_key);
}

function dnsmasq_cleanup_legacy_instance() {
    let legacy_instance_present = dnsmasq_legacy_instance_exists();
    let legacy_interfaces = legacy_instance_present ? dnsmasq_legacy_interfaces() : "";

    uci.delete("dhcp.forkop");

    let backup_notinterfaces = uci.get("dhcp.@dnsmasq[0].forkop_notinterface");
    if (backup_notinterfaces != "") {
        uci.delete("dhcp.@dnsmasq[0].notinterface");
        for (let value in words(backup_notinterfaces))
            uci.add_list("dhcp.@dnsmasq[0].notinterface", value);
        uci.delete("dhcp.@dnsmasq[0].forkop_notinterface");
        return;
    }

    if (legacy_instance_present) {
        for (let value in words(legacy_interfaces))
            uci.del_list("dhcp.@dnsmasq[0].notinterface", value);
    }

    uci.delete("dhcp.@dnsmasq[0].forkop_notinterface");
}

function dnsmasq_restore_default_instance() {
    let server_list = dnsmasq_default_servers();
    let backup_servers = uci.get("dhcp.@dnsmasq[0].forkop_server");
    let managed_global_dns = list_has(server_list, SB_DNS_INBOUND_ADDRESS);

    uci.delete("dhcp.@dnsmasq[0].server");
    if (backup_servers != "") {
        for (let value in words(backup_servers))
            uci.add_list("dhcp.@dnsmasq[0].server", value);
    }
    else {
        for (let value in words(server_list)) {
            if (value != SB_DNS_INBOUND_ADDRESS)
                uci.add_list("dhcp.@dnsmasq[0].server", value);
        }
    }
    uci.delete("dhcp.@dnsmasq[0].forkop_server");

    if (uci.get("dhcp.@dnsmasq[0].forkop_noresolv") != "")
        restore_dnsmasq_config_option("noresolv", "forkop_noresolv");
    else if (managed_global_dns)
        uci.set("dhcp.@dnsmasq[0].noresolv", "0");

    if (uci.get("dhcp.@dnsmasq[0].forkop_cachesize") != "")
        restore_dnsmasq_config_option("cachesize", "forkop_cachesize");
    else if (managed_global_dns)
        uci.set("dhcp.@dnsmasq[0].cachesize", "150");

    restore_dnsmasq_rebind_protection(managed_global_dns);
}

// Forkop captures DNS through interface-scoped nftables rules, so dnsmasq is
// never configured for it any more - only cleaned up when an older revision, or
// a crash, left its settings behind.
function dnsmasq_restore(quiet) {
    if (!uci.available())
        return true;

    if (!dnsmasq_has_forkop_managed_state()) {
        if (!quiet)
            log("dnsmasq already uses non-Forkop DNS settings; restore is not required", "info");
        return true;
    }

    if (!quiet)
        log("Restoring DNS settings in dnsmasq", "info");

    dnsmasq_cleanup_legacy_instance();
    dnsmasq_restore_default_instance();
    uci.commit("dhcp");

    return restart_dnsmasq();
}

function failsafe_restore() {
    if (!uci.available())
        return true;

    if (dnsmasq_management_disabled()) {
        if (!dnsmasq_has_forkop_managed_state()) {
            log("DNS rollback skipped: dont_touch_dhcp is enabled and no Forkop dnsmasq changes were found", "info");
            return true;
        }

        log("Rolling back previous Forkop dnsmasq changes because dont_touch_dhcp is enabled", "warn");
    }
    else {
        log("Rolling back Forkop DNS changes in dnsmasq", "warn");
    }

    let status = dnsmasq_restore(true);
    if (status)
        log("DNS rollback completed after the failed Forkop runtime", "info");
    else
        log("DNS rollback failed; keeping Forkop marked unclean for recovery", "error");
    return status;
}

let mode = ARGV[0] || "";

if (mode == "restore")
    exit(dnsmasq_restore(false) ? 0 : 1);
else if (mode == "failsafe-restore")
    exit(failsafe_restore() ? 0 : 1);
else if (mode == "has-managed-state")
    exit(dnsmasq_has_forkop_managed_state() ? 0 : 1);

warn("Usage: dns/apply.uc <restore|failsafe-restore|has-managed-state>\n");
exit(1);
