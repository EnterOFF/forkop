let t = require("t");
let rule = require("config.rule");

const DOMAIN_KINDS = [ "domain", "domain_suffix", "domain_keyword", "domain_regex" ];

function condition(key, combined_text, combined_list) {
    let kind = key == "domain" || key == "domain_suffix" ? "domains" : "generic";
    return rule.rule_condition_csv_value(key, kind, "0", "0", "", "", combined_text, combined_list);
}

// What a section's combined domain field turns into, one kind at a time, the
// way config/connections.uc asks for it.
function domain_conditions(combined_text, combined_list) {
    let result = {};
    for (let key in DOMAIN_KINDS)
        result[key] = condition(key, combined_text, combined_list);
    return result;
}

const TEXT_A = "full:a.example\nb.example\nkeyword:ads\nregex:^tracker\\.\n";
const TEXT_B = "full:c.example\nd.example\nkeyword:beacon\n";

t.test("the combined domain text splits by its prefixes", () => {
    t.eq(domain_conditions(TEXT_A, ""), {
        domain: "a.example",
        domain_suffix: "b.example",
        domain_keyword: "ads",
        domain_regex: "^tracker\\."
    });
});

t.test("the whitespace-separated list form splits the same way", () => {
    t.eq(domain_conditions("", "full:e.example f.example keyword:beacon"), {
        domain: "e.example",
        domain_suffix: "f.example",
        domain_keyword: "beacon",
        domain_regex: ""
    });
});

// The four kinds are answered from one classification pass; a wrong cache key
// would hand a section the values of the one asked before it.
t.test("two sections asked in turn each keep their own values", () => {
    let expected = {
        [TEXT_A]: { domain: "a.example", domain_suffix: "b.example", domain_keyword: "ads", domain_regex: "^tracker\\." },
        [TEXT_B]: { domain: "c.example", domain_suffix: "d.example", domain_keyword: "beacon", domain_regex: "" }
    };
    for (let round = 0; round < 2; round++)
        for (let key in DOMAIN_KINDS)
            for (let text in [ TEXT_A, TEXT_B ])
                t.eq(condition(key, text, ""), expected[text][key], key);
});

t.test("an international entry is punycoded for every kind", () => {
    t.eq(domain_conditions("сайт.рф full:пример.испытание keyword:пример regex:^сайт[.]рф$", ""), {
        domain: "xn--e1afmkfd.xn--80akhbyknj4f",
        domain_suffix: "xn--80aswg.xn--p1ai",
        domain_keyword: "xn--e1afmkfd",
        domain_regex: "^xn--80aswg[.]xn--p1ai$"
    });
});

t.test("the combined field comes before the legacy per-kind one, which a suffix ignores", () => {
    t.eq(rule.rule_condition_csv_value("domain", "domains", "0", "0", "legacy.example", "",
        "full:one.example keyword:skip regex:^skip suffix.example", "full:list.example keyword:list-skip"),
        "one.example,list.example,legacy.example");
    t.eq(rule.rule_condition_csv_value("domain_suffix", "domains", "0", "0", "legacy.example", "legacy-list.example",
        "full:one.example suffix.example keyword:skip", "full:list-full.example list.example"),
        "suffix.example,list.example");
});

t.test("a subnet condition takes the list unless the text mode is on, and drops what is not an address", () => {
    t.eq(rule.rule_condition_csv_value("ip_cidr", "subnets", "1", "0",
        "198.51.100.1\nbad-value\n203.0.113.0/24", "10.0.0.0/8", "", ""),
        "198.51.100.1,203.0.113.0/24");
    t.eq(rule.rule_condition_csv_value("ip_cidr", "subnets", "0", "0",
        "198.51.100.1", "10.0.0.0/8 192.0.2.1", "", ""),
        "10.0.0.0/8,192.0.2.1");
});

t.done();
