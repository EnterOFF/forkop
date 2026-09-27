let t = require("t");
let uci = require("uci");
let core_uci = require("core.uci");

function seed_dhcp() {
    uci.__reset();
    core_uci.reset();
    uci.__seed("dhcp", [
        { ".name": "cfg01411c", ".type": "dnsmasq", server: [ "1.1.1.1", "8.8.8.8" ], noresolv: "0", cachesize: "150" },
        { ".name": "cfg02422d", ".type": "dnsmasq", server: [ "9.9.9.9" ], noresolv: "0" }
    ]);
}

t.test("an anonymous selector reads the section it counts to", () => {
    seed_dhcp();
    t.eq(core_uci.get("dhcp.@dnsmasq[0].server"), "1.1.1.1 8.8.8.8");
    t.eq(core_uci.get("dhcp.@dnsmasq[1].server"), "9.9.9.9");
    t.eq(core_uci.get_all("dhcp", "@dnsmasq[0]")[".name"], "cfg01411c");
});

t.test("an anonymous selector writes the section it counts to", () => {
    seed_dhcp();
    t.ok(core_uci.set("dhcp.@dnsmasq[0].noresolv", "1"));
    t.eq(core_uci.get("dhcp.cfg01411c.noresolv"), "1");

    t.ok(core_uci.delete("dhcp.@dnsmasq[0].server"));
    t.eq(core_uci.get("dhcp.cfg01411c.server"), "");

    t.ok(core_uci.add_list("dhcp.@dnsmasq[0].server", "127.0.0.42"));
    t.ok(core_uci.add_list("dhcp.@dnsmasq[0].server", "1.1.1.1"));
    t.eq(core_uci.get("dhcp.cfg01411c.server"), "127.0.0.42 1.1.1.1");

    t.ok(core_uci.del_list("dhcp.@dnsmasq[0].server", "127.0.0.42"));
    t.eq(core_uci.get("dhcp.cfg01411c.server"), "1.1.1.1");
    t.eq(core_uci.get("dhcp.cfg02422d.server"), "9.9.9.9", "the other section is untouched");
});

t.test("a write through a selector that counts past the last section fails", () => {
    seed_dhcp();
    t.eq(core_uci.delete("dhcp.@dnsmasq[9].server"), false);
});

t.done();
