#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"

cat >"$WORK_DIR/reload.uc" <<'UCODE'
const SINGBOX_UC = 'singbox', STATE_UC = 'state', RULESET_SYNC_UC = 'rulesets';
const CONFIG_NAME = 'forkop', RT_TABLE_NAME = 'forkop', NFT_TABLE_NAME = 'ForkopTable';
const NFT_FAKEIP_MARK = 'mark', RELOAD_READY_WINDOW = 2, READY_HOLD = 2;
let capture = true, ready = true, populated = true, reloaded = false, cleaned = false;
let worker = true, failure = '', nft_expected = false, rebuilds = 0;
function as_string(value) { return '' + value; }
function log_message() {}
function config_get() { return '/config.json'; }
function file_md5() { return 'hash'; }
function refresh_cron() { return 0; }
function module_success(module, args) {
    assert(module == RULESET_SYNC_UC && args[0] == 'stop-worker');
    worker = false;
    return true;
}
function command_success_from_args(args) {
    assert(join(' ', slice(args, 0, 5)) == 'nft add table inet ForkopTable');
    let pause = args[5] == '{ flags dormant; }';
    assert(ready, 'capture must not be restored before sing-box readiness');
    if (failure == (pause ? 'pause' : 'resume')) return false;
    capture = !pause;
    return true;
}
function cleanup_failed_runtime() { cleaned = true; capture = false; }
function abort_reload(status, touched) {
    if (touched) cleanup_failed_runtime();
    return status;
}
function singbox_init_config_for_live_reload(populate) {
    if (populate) populated = true;
    return 0;
}
function nft_rebuild_runtime() {
    assert(ready, 'capture must wait for sing-box readiness');
    rebuilds++;
    capture = true;
    populated = false;
    return 0;
}
function nft_populate_runtime_sets() {
    assert(capture && ready);
    populated = true;
    return 0;
}
function module_status(module, args) {
    if (args[0] == 'reload-sing-box-runtime') {
        assert(!capture, 'hot reload must pause capture before sockets close');
        assert(worker == !nft_expected, 'core-only reload must preserve the rule-set worker');
        ready = false;
        reloaded = true;
    } else if (args[0] == 'wait-sing-box-ready') {
        assert(!capture);
        if (failure == 'ready') return 1;
        ready = true;
    } else if (args[0] == 'wait-forkop-ready') {
        assert(capture && ready && populated);
    } else if (args[0] == 'start-worker') {
        assert(capture && ready && populated);
        worker = true;
    }
    return 0;
}
UCODE
sed -n '/^function apply_reload_plan(/,/^}$/p' "$FORKOP_LIB/service/lifecycle.uc" >>"$WORK_DIR/reload.uc"
cat >>"$WORK_DIR/reload.uc" <<'UCODE'
for (let core in [0, 1]) {
    for (let nft in [0, 1]) {
        for (let fail in core ? ['', 'pause', 'ready', 'resume'] : ['']) {
            capture = ready = populated = worker = true;
            reloaded = cleaned = false;
            failure = fail;
            nft_expected = nft == 1;
            rebuilds = 0;
            let status = apply_reload_plan({ needs_sing_box_reload: core, needs_nft_rebuild: nft, needs_cron_refresh: 1 }, 1);
            if (failure == '') {
                assert(status == 0 && capture && ready && populated && worker);
                assert(reloaded == (core == 1) && rebuilds == nft);
            } else {
                assert(status != 0 && cleaned && !capture);
                if (failure == 'pause') assert(!reloaded);
            }
        }
    }
}
UCODE
ucode "$WORK_DIR/reload.uc"
ucode -L "$FORKOP_LIB" -e '
let nft = require("nft.state");
for (let flags in [null, "dormant", ["dormant"]]) {
    let tables = sprintf("%J", { nftables: [{ table: { family: "inet", name: "ForkopTable", flags } }] });
    assert(nft.table_active_output(tables, "inet", "ForkopTable") == (flags == null));
    assert(!nft.table_active_output(tables, "inet", "missing"));
    let text = "table inet ForkopTable {\n" + (flags == null ? "" : "\tflags dormant\n") + "}\n";
    assert(nft.table_active_output(text, "inet", "ForkopTable") == (flags == null));
    assert(!nft.table_active_output(text, "inet", "missing"));
}
assert(!nft.table_active_output("invalid", "inet", "ForkopTable"));
'
printf 'reload capture safety checks passed\n'
