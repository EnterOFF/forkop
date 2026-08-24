#!/usr/bin/env ucode

// Whether dnsmasq still carries Forkop-managed DNS state. The question is asked
// from two places with very different budgets: dns/apply.uc answers it once per
// rollback, and the LuCI status feed answers it behind every poll. Spawning an
// interpreter for the second caller cost more than the rest of the status
// computation together, so the predicate lives in a module both can require.

let uci = require("core.uci");

const CONFIG_NAME = getenv("FORKOP_CONFIG_NAME") || "forkop";
const SB_DNS_INBOUND_ADDRESS = getenv("SB_DNS_INBOUND_ADDRESS") || "127.0.0.42";

// The dnsmasq options Forkop writes under its own prefix. Their mere presence
// proves Forkop touched the instance, whatever their value.
const MANAGED_OPTIONS = [
    "forkop_server",
    "forkop_noresolv",
    "forkop_cachesize",
    "forkop_rebind_protection",
    "forkop_notinterface"
];

function as_string(value) {
    return value == null ? "" : "" + value;
}

function words(value) {
    value = trim(as_string(value));
    return value == "" ? [] : split(value, /[ \t\r\n]+/);
}

function list_has(values, needle) {
    for (let value in words(values))
        if (value == needle)
            return true;
    return false;
}

function dnsmasq_legacy_instance_exists() {
    return uci.exists("dhcp.forkop");
}

function dnsmasq_default_servers() {
    return uci.get("dhcp.@dnsmasq[0].server");
}

function dnsmasq_default_has_forkop_dns() {
    return list_has(dnsmasq_default_servers(), SB_DNS_INBOUND_ADDRESS);
}

function dnsmasq_has_forkop_managed_state() {
    if (dnsmasq_default_has_forkop_dns())
        return true;

    for (let option in MANAGED_OPTIONS)
        if (uci.get("dhcp.@dnsmasq[0]." + option) != "")
            return true;

    return dnsmasq_legacy_instance_exists();
}

return {
    CONFIG_NAME,
    SB_DNS_INBOUND_ADDRESS,
    MANAGED_OPTIONS,
    list_has,
    dnsmasq_legacy_instance_exists,
    dnsmasq_default_servers,
    dnsmasq_default_has_forkop_dns,
    dnsmasq_has_forkop_managed_state
};
