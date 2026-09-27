// The LuCI page cannot ask ucode while a dialog validates or the dashboard
// draws, so it carries its own copy of a few backend tables.
// tests/fixtures/page_contract.json is what both copies are held to: this file
// checks the backend against it, fe-app-forkop/tests/pageContract.test.js the
// page.

let t = require("t");
let fs = require("fs");
let repo = require("repo");
let fixture = require("fixture");
let constants = require("singbox.constants");
let rulesets = require("singbox.rulesets");
let connections = require("config.connections");
let mask = require("diagnostics.mask");
let state_service = require("service.state_service");

let contract = json(fs.readfile(repo.path("tests/fixtures/page_contract.json")));

t.test("the reserved ports are every port Forkop's own inbounds bind", () => {
    let ports = [ constants.CLASH_API_CONTROLLER_PORT ];
    for (let name in keys(constants))
        if (match(name, /_INBOUND_PORT$/))
            push(ports, constants[name]);
    t.eq(sort(uniq(ports), (a, b) => a - b), contract.reserved_ports);
});

t.test("the reserved tags are the ones Forkop gives its own listeners", () => {
    t.eq(sort(keys(constants.RESERVED_TAGS)), contract.reserved_tags);
});

t.test("the community rule sets are the ones the generator can download, each from its own URL", () => {
    t.eq(sort(keys(rulesets.COMMUNITY_SERVICES)), contract.community_rule_sets);
    let urls = map(contract.community_rule_sets, rulesets.community_url);
    t.eq(length(uniq(urls)), length(urls));
});

t.test("the filterable server types are the ones the validator accepts", () => {
    t.eq(constants.FILTERABLE_PROVIDER_TYPES, contract.provider_types);
    t.eq(constants.FILTERABLE_GROUP_TYPES, contract.group_types);
});

t.test("the reserved override paths are the ones the validator refuses", () => {
    t.eq(constants.RESERVED_OVERRIDE_PATCH_PATHS, contract.reserved_override_patch_paths);
});

t.test("the diagnostics check the domains the generated configuration answers for", () => {
    t.eq(constants.FAKEIP_TEST_DOMAIN, contract.check_domains.fakeip);
    t.eq(constants.CHECK_PROXY_IP_DOMAIN, contract.check_domains.ip);
});

// The dashboard describes a group from the same UCI options the generator
// reads, so an unset option has to mean the same thing on both sides.
t.test("an unset group option means what the dashboard says it means", () => {
    fixture.seed({
        section: [ { ".name": "proxy", action: "connection" } ],
        urltest: [ { ".name": "fast", section: "proxy", name: "Fast" } ],
        fallback_group: [ { ".name": "safe", section: "proxy", name: "Safe" } ]
    });
    connections.load();
    let section = { ".name": "proxy" };

    let urltest = contract.urltest_defaults;
    t.eq(connections.urltest_testing_url(section, "fast"), urltest.testing_url);
    t.eq(connections.urltest_expected_status(section, "fast"), urltest.expected_status);
    t.eq(connections.urltest_check_interval(section, "fast"), urltest.check_interval);
    t.eq(int(connections.urltest_tolerance(section, "fast")), urltest.tolerance);
    t.eq(connections.urltest_idle_timeout(section, "fast"), "", "left to sing-box");
    t.eq(constants.URLTEST_DEFAULT_IDLE_TIMEOUT, urltest.idle_timeout, "what sing-box applies");
    t.eq(connections.urltest_interrupt_exist_connections(section, "fast"), urltest.interrupt_exist_connections);

    let fallback = contract.fallback_defaults;
    t.eq(connections.fallback_group_health_check_url(section, "safe"), fallback.health_check_url);
    t.eq(connections.fallback_group_health_check_interval(section, "safe"), fallback.health_check_interval);
    t.eq(connections.fallback_group_health_check_timeout(section, "safe"), fallback.health_check_timeout);
    t.eq(connections.fallback_group_attempt_timeout(section, "safe"), fallback.attempt_timeout);
    t.eq(connections.fallback_group_expected_status(section, "safe"), fallback.expected_status);
    t.eq(connections.fallback_group_idle_timeout(section, "safe"), fallback.idle_timeout);
    t.eq(connections.fallback_group_interrupt_exist_connections(section, "safe"), fallback.interrupt_exist_connections);
});

t.test("the state service parks a request as long as the page expects", () => {
    t.eq(state_service.MAX_WAIT_MS, contract.state_wait_ms);
});

t.test("the option every password field is stored in is masked in diagnostics", () => {
    for (let field, stored in contract.password_fields) {
        let masked = mask.forkop_config("config tunnel 'probe'\n\toption " + stored + " 'secret-value'\n");
        t.excludes(masked, "secret-value", field);
    }
});

t.done();
