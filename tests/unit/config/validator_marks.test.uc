let t = require("t");
let v = require("validation");
let common = require("core.common");
let constants = require("core.constants");

const TAILSCALE_FWMARK_MASK = 0x00ff0000;

t.test("the Forkop marks stay clear of the Tailscale fwmark mask and of each other", () => {
    let fakeip = common.parse_number(constants.NFT_FAKEIP_MARK);
    let outbound = common.parse_number(constants.NFT_OUTBOUND_MARK);
    t.eq(fakeip & TAILSCALE_FWMARK_MASK, 0);
    t.eq(outbound & TAILSCALE_FWMARK_MASK, 0);
    t.ok(fakeip != outbound);
    v.accepts({});
});

t.test("marks overlapping Tailscale's or each other are refused", () => {
    v.refuses({}, "FakeIP mark overlaps Tailscale fwmark mask", { nft_fakeip_mark: "0x00100000" });
    v.refuses({}, "Outbound mark overlaps Tailscale fwmark mask", { nft_outbound_mark: "0x00200000" });
    v.refuses({}, "the same value", { nft_fakeip_mark: "0x00000400", nft_outbound_mark: "0x00000400" });
});

t.done();
