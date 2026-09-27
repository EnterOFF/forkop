#!/usr/bin/env ucode

let ip = require("core.ip");
let domain_config = require("config.domain");

function as_string(value) {
    return value == null ? "" : "" + value;
}

function strip_list_comment(line) {
    line = replace(as_string(line), /[[:space:]]*\/\/.*$/, "");
    return replace(line, /[[:space:]]*#.*$/, "");
}

function text_list_values(value, separator_mode) {
    let result = [];
    separator_mode = as_string(separator_mode);

    for (let line in split(as_string(value), "\n")) {
        line = strip_list_comment(line);
        line = separator_mode == "comma-space"
            ? replace(line, /[ ,]/g, "\n")
            : replace(line, /,/g, "\n");

        for (let item in split(line, "\n")) {
            item = trim(replace(item, /\r/g, ""));
            if (item != "")
                push(result, item);
        }
    }

    return result;
}

function whitespace_fields(value) {
    let result = [];
    for (let item in split(trim(as_string(value)), /[ \t\r\n]+/))
        if (item != "")
            push(result, item);
    return result;
}

function strip_repeated_domain_prefix(prefix, body) {
    let marker = prefix + ":";

    while (domain_config.ascii_lower(substr(body, 0, length(marker))) == marker)
        body = trim(substr(body, length(marker)));

    return body;
}

function prefixed_domain_kind_value(value) {
    value = trim(as_string(value));

    if (value == "")
        return null;

    let colon = index(value, ":");
    let prefix = "";
    let body = value;
    if (colon > 0) {
        let candidate = domain_config.ascii_lower(substr(value, 0, colon));
        if (candidate == "full" || candidate == "keyword" || candidate == "regex") {
            prefix = candidate;
            body = substr(value, colon + 1);
        }
        else {
            return null;
        }
    }

    body = trim(body);
    if (prefix != "")
        body = strip_repeated_domain_prefix(prefix, body);

    if (body == "")
        return null;

    if (prefix == "") {
        let normalized = domain_config.suffix_to_ascii(body);
        return normalized == null ? null : { kind: "domain_suffix", value: normalized };
    }

    if (prefix == "full") {
        let normalized = domain_config.suffix_to_ascii(body);
        return normalized == null ? null : { kind: "domain", value: normalized };
    }

    if (prefix == "keyword") {
        let normalized = domain_config.keyword_to_ascii(body);
        return normalized == null ? null : { kind: "domain_keyword", value: normalized };
    }

    let normalized = domain_config.regex_to_ascii(body);
    return normalized == null ? null : { kind: "domain_regex", value: normalized };
}

function domain_value_for_key(value, key) {
    key = as_string(key);

    if (key == "domain" || key == "domain_suffix")
        return domain_config.suffix_to_ascii(value);
    if (key == "domain_keyword")
        return domain_config.keyword_to_ascii(value);
    if (key == "domain_regex")
        return domain_config.regex_to_ascii(value);

    return null;
}

function normalize_domain_subnet_value(value, kind) {
    kind = as_string(kind);
    if (kind == "domains")
        return domain_config.suffix_to_ascii(value);
    if (kind == "subnets")
        return ip.valid_ip_or_cidr(value) ? value : null;

    die("unknown value kind '" + kind + "'");
}

function filter_domain_subnet_values(values, kind) {
    let result = [];
    kind = as_string(kind);

    if (kind != "domains" && kind != "subnets")
        die("unknown value kind '" + kind + "'");

    for (let value in values) {
        let normalized = normalize_domain_subnet_value(value, kind);
        if (normalized != null)
            push(result, normalized);
    }

    return result;
}

function condition_text_csv_value(value, kind) {
    kind = as_string(kind);

    if (kind == "domains")
        return join(",", filter_domain_subnet_values(text_list_values(value, "comma-space"), "domains"));
    if (kind == "subnets")
        return join(",", filter_domain_subnet_values(text_list_values(value, "comma-space"), "subnets"));

    return join(",", text_list_values(value, "comma"));
}

function legacy_condition_csv_value(kind, text_mode, conditions_text_mode, text_value, list_value) {
    if (int(text_mode || 0) == 1 || int(conditions_text_mode || 0) == 1)
        return condition_text_csv_value(text_value, kind);

    list_value = as_string(list_value);
    if (list_value != "")
        return kind == "subnets"
            ? condition_text_csv_value(list_value, kind)
            : replace(list_value, / /g, ",");

    text_value = as_string(text_value);
    if (text_value != "")
        return condition_text_csv_value(text_value, kind);

    return replace(list_value, / /g, ",");
}

const COMBINED_DOMAIN_KINDS = [ "domain", "domain_suffix", "domain_keyword", "domain_regex" ];

// Which kind an entry belongs to does not depend on the kind being asked for,
// so one pass classifies every entry and the four answers are read off the
// result. Each list keeps the order the per-kind walk produced, so the
// conditions and the reload-state signatures built from them do not change.
function combined_domain_kind_csv_values(items) {
    let values = {};
    for (let kind in COMBINED_DOMAIN_KINDS)
        values[kind] = [];

    for (let item in items) {
        let normalized = prefixed_domain_kind_value(item);
        if (normalized != null && values[normalized.kind] != null)
            push(values[normalized.kind], normalized.value);
    }

    let result = {};
    for (let kind in COMBINED_DOMAIN_KINDS)
        result[kind] = join(",", values[kind]);

    return result;
}

// A section is asked for all four domain kinds in a row, from the same text and
// the same list, and a signature or a generated rule set asks again later. One
// entry is enough to collapse those four passes into one; holding more would
// keep whole domain lists alive for no further gain.
let combined_list_key = null;
let combined_list_values = null;
let combined_text_key = null;
let combined_text_values = null;

function combined_domain_csv_value(value, requested_kind) {
    value = as_string(value);

    if (combined_list_key != value) {
        combined_list_values = combined_domain_kind_csv_values(split(value, ","));
        combined_list_key = value;
    }

    return as_string(combined_list_values[as_string(requested_kind)]);
}

function combined_domain_text_csv_value(value, requested_kind) {
    value = as_string(value);

    if (combined_text_key != value) {
        combined_text_values = combined_domain_kind_csv_values(text_list_values(value, "comma-space"));
        combined_text_key = value;
    }

    return as_string(combined_text_values[as_string(requested_kind)]);
}

function concat_csv_values(first, second) {
    first = as_string(first);
    second = as_string(second);
    if (first != "" && second != "")
        return first + "," + second;
    return first + second;
}

function combined_condition_csv_value(requested_key, legacy_kind, text_mode, conditions_text_mode, text_value, list_value, combined_text_value, combined_list_value) {
    let combined_text_values = combined_domain_text_csv_value(combined_text_value, requested_key);
    let combined_list_values = combined_domain_csv_value(replace(as_string(combined_list_value), / /g, ","), requested_key);
    let combined_values = concat_csv_values(combined_text_values, combined_list_values);

    if (requested_key == "domain_suffix")
        return combined_values;

    let legacy_values = legacy_condition_csv_value(legacy_kind, text_mode, conditions_text_mode, text_value, list_value);
    return concat_csv_values(combined_values, legacy_values);
}

function rule_condition_csv_value(key, kind, text_mode, conditions_text_mode, text_value, list_value, combined_text_value, combined_list_value) {
    if (key == "domain" || key == "domain_suffix" || key == "domain_keyword" || key == "domain_regex")
        return combined_condition_csv_value(key, kind, text_mode, conditions_text_mode, text_value, list_value, combined_text_value, combined_list_value);

    return legacy_condition_csv_value(kind, text_mode, conditions_text_mode, text_value, list_value);
}

function normalize_port_number_value(value) {
    value = trim(as_string(value));
    if (value == "" || match(value, /^[0-9]+$/) == null)
        return null;

    let number = int(value);
    return number >= 1 && number <= 65535 ? number : null;
}

function normalize_port_condition_value(value) {
    value = trim(as_string(value));
    if (value == "")
        return null;

    let dash = index(value, "-");
    if (dash < 0) {
        let number = normalize_port_number_value(value);
        return number == null ? null : as_string(number);
    }

    let start = normalize_port_number_value(substr(value, 0, dash));
    let end = normalize_port_number_value(substr(value, dash + 1));
    if (start == null || end == null || start > end)
        return null;

    return start == end ? as_string(start) : sprintf("%d-%d", start, end);
}

function append_unique_port(result, seen, item) {
    let normalized = normalize_port_condition_value(item);
    if (normalized == null || seen[normalized])
        return;

    seen[normalized] = true;
    push(result, normalized);
}

function rule_ports_csv_value(list_values, text_value) {
    let result = [];
    let seen = {};
    let normalized_list = replace(as_string(list_values), /[[:space:]]+/g, "\n");

    for (let item in split(normalized_list, "\n"))
        append_unique_port(result, seen, item);

    for (let item in text_list_values(text_value, "comma-space"))
        append_unique_port(result, seen, item);

    return join(",", result);
}

let community_subnet_lists = {
    twitter: true,
    meta: true,
    telegram: true,
    cloudflare: true,
    hetzner: true,
    ovh: true,
    digitalocean: true,
    cloudfront: true,
    discord: true,
    roblox: true
};

function community_service_has_subnet_list(value) {
    return community_subnet_lists[as_string(value)] == true;
}

return {
    text_list_values,
    normalize_port_condition_value,
    prefixed_domain_kind_value,
    domain_value_for_key,
    normalize_domain_subnet_value,
    rule_condition_csv_value,
    rule_ports_csv_value,
    community_service_has_subnet_list,
};
