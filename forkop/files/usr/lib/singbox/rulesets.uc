#!/usr/bin/env ucode

const SRS_MAIN_URL = "https://github.com/itdoginfo/allow-domains/releases/latest/download";
const SRS_ADS_HAGEZI_PRO_URL = "https://github.com/zxc-rv/ad-filter/releases/latest/download/adlist.srs";
const SRS_SUPERCELL_URL = "https://raw.githubusercontent.com/ushan0v/sing-box-supercell-ruleset/main/supercell.srs";
const SRS_GITHUB_URL = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/github.srs";

const COMMUNITY_SERVICES = {
    russia_inside: true,
    russia_outside: true,
    ukraine_inside: true,
    geoblock: true,
    block: true,
    porn: true,
    news: true,
    anime: true,
    youtube: true,
    hdrezka: true,
    tiktok: true,
    google_ai: true,
    google_play: true,
    hodca: true,
    discord: true,
    meta: true,
    twitter: true,
    cloudflare: true,
    cloudfront: true,
    digitalocean: true,
    hetzner: true,
    ovh: true,
    telegram: true,
    roblox: true,
    ads_hagezi_pro: true,
    supercell: true,
    github: true
};

function as_string(value) {
    return value == null ? "" : "" + value;
}

function is_community(name) {
    return COMMUNITY_SERVICES[as_string(name)] === true;
}

function community_url(name) {
    name = as_string(name);
    if (name == "ads_hagezi_pro")
        return SRS_ADS_HAGEZI_PRO_URL;
    if (name == "supercell")
        return SRS_SUPERCELL_URL;
    if (name == "github")
        return SRS_GITHUB_URL;
    return SRS_MAIN_URL + "/" + name + ".srs";
}

// Twelve hex digits that stand for a rule set reference too long to name a tag
// with. Two multiplicative hashes run over the bytes and each is folded to 24
// bits, so the pair fills the digits; the seeds happen to be FNV's basis and
// prime, but nothing here is FNV, and it does not matter - the only requirement
// is that the two accumulators mix differently, because this names a tag rather
// than checking anything. The numbers are frozen for the same reason: a changed
// constant renames every inline custom rule set in the generated config.
function hash12(value) {
    value = as_string(value);
    let first = 2166136261;
    let second = 16777619;

    for (let i = 0; i < length(value); i++) {
        let code = ord(substr(value, i, 1));
        first = (first * 33 + code) % 4294967296;
        second = (second * 131 + code) % 4294967296;
    }

    return sprintf("%06x%06x", first % 16777216, second % 16777216);
}

function section_tag(section_name, name, kind) {
    kind = as_string(kind);
    return kind == ""
        ? as_string(section_name) + "-" + as_string(name) + "-ruleset"
        : as_string(section_name) + "-" + as_string(name) + "-" + kind + "-ruleset";
}

function community_tag(section_name, community) {
    return section_tag(section_name, community, "community");
}

function custom_reference_tag(reference) {
    reference = as_string(reference);
    return is_community(reference)
        ? "builtin-" + reference + "-ruleset"
        : "inline-custom-" + hash12(reference) + "-ruleset";
}

function module_exports() {
    return {
        is_community,
        community_url,
        hash12,
        section_tag,
        community_tag,
        custom_reference_tag
    };
}

if ((sourcepath(1) != null && sourcepath(1) != "") || ARGV[0] == null)
    return module_exports();

let mode = ARGV[0] || "";

if (mode == "is-community")
    exit(is_community(ARGV[1]) ? 0 : 1);
else {
    warn("Usage: singbox/rulesets.uc is-community <name>\n");
    exit(1);
}
