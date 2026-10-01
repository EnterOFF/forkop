// Fills the sets of the sections that take subnets from rule-set providers with
// what the providers hold, and keeps them filled: the worker follows the Clash
// API's provider events and rewrites a section when a provider it reads changed.
// Each section is its own nft transaction, so the largest section, not the sum of
// them, is what nft has to hold at once.

let fs = require("fs");
let common = require("core.common");
let exec = require("core.exec");
let constants = require("core.constants");
let core_ip = require("core.ip");
let library = require("core.library");
let uci = require("core.uci");
let worker_process = require("service.worker");
let clash_api = require("singbox.clash_api");
let nft_apply = require("nft.apply");
let nft_sections = require("nft.sections");
let connections = require("config.connections");

const TABLE = constants.NFT_TABLE_NAME;
const MAX_ELEMENTS_PER_LINE = 256;
const MAX_LINE_LENGTH = 8192;
const EVENT_WAIT_SECONDS = 60;
const RETRY_MIN_SECONDS = 3;
const RETRY_MAX_SECONDS = 300;

let as_string = common.as_string;

// Per section: the key of what its sets were last filled from, and the key nft
// or the snapshot refused. Everything a section's transaction is made of is in
// its key, so a refused key is not tried again until a provider or the section
// changes.
let applied = {};
let refused = {};

function normalize_ranges(ranges) {
    sort(ranges, (left, right) => left.start == right.start ? left.end - right.end : left.start - right.start);

    let result = [];
    for (let current in ranges) {
        let last = length(result) > 0 ? result[length(result) - 1] : null;
        if (last != null && current.start <= last.end + 1) {
            if (current.end > last.end)
                last.end = current.end;
            continue;
        }
        push(result, { start: current.start, end: current.end });
    }
    return result;
}

// The section's own ports, which the reader of that option has already
// normalized to numbers and ranges.
function section_ranges(csv) {
    let ranges = [];
    for (let value in split(as_string(csv), ",")) {
        let matched = match(value, /^([0-9]+)(-([0-9]+))?$/);
        if (matched != null)
            push(ranges, { start: int(matched[1]), end: int(matched[3] ?? matched[1]) });
    }
    return normalize_ranges(ranges);
}

function snapshot_ranges(values, label) {
    if (type(values) != "array")
        die(label + ": port_ranges must be an array");
    for (let value in values)
        if (type(value) != "object" || type(value.start) != "int" || type(value.end) != "int" ||
            value.start < 1 || value.end > 65535 || value.start > value.end)
            die(label + ": invalid port range");
    return normalize_ranges(map(values, (value) => ({ start: value.start, end: value.end })));
}

// Only the two transports nft can be told to match: the core exports nothing
// else, so anything else is a snapshot this reader does not understand.
function snapshot_protocols(values, label) {
    if (values == null)
        return [];
    if (type(values) != "array")
        die(label + ": networks must be an array");
    for (let value in values)
        if (value != "tcp" && value != "udp")
            die(label + ": unsupported network " + as_string(value));
    return uniq(values);
}

function intersect_ranges(first, second) {
    let result = [];
    for (let left in first)
        for (let right in second) {
            let start = max(left.start, right.start);
            let end = min(left.end, right.end);
            if (start <= end)
                push(result, { start, end });
        }
    return normalize_ranges(result);
}

function port_text(range) {
    return range.start == range.end ? "" + range.start : range.start + "-" + range.end;
}

// A provider prefix goes into the transaction unquoted, so anything that is not
// part of an address stops it. Checked, not parsed: a country-sized list is
// written as it came.
function prefix_is_nft_safe(prefix, family) {
    return type(prefix) == "string" && (family == 4
        ? index(prefix, ".") >= 0 && match(prefix, /[^0-9.\/]/) == null
        : index(prefix, ":") >= 0 && match(prefix, /[^0-9A-Fa-f:.\/]/) == null);
}

function compare_addresses(left, right) {
    for (let i = 0; i < length(left); i++)
        if (left[i] != right[i])
            return left[i] - right[i];
    return 0;
}

// The next or the previous address, null past either end.
function step_address(address, delta) {
    let result = [ ...address ];
    for (let i = length(result) - 1; i >= 0; i--) {
        let value = result[i] + delta;
        if (value >= 0 && value <= 255) {
            result[i] = value;
            return result;
        }
        result[i] = delta > 0 ? 0 : 255;
    }
    return null;
}

// The first and the last address of the block of `bits` leading bits, as bytes.
function block_bounds(address, bits) {
    let low = [], high = [];
    for (let i = 0; i < length(address); i++) {
        let kept = min(max(bits - i * 8, 0), 8);
        let mask = (0xff << (8 - kept)) & 0xff;
        push(low, address[i] & mask);
        push(high, (address[i] & mask) | (~mask & 0xff));
    }
    return { low, high };
}

function prefix_bounds(prefix, family, label) {
    let parts = split(as_string(prefix), "/");
    let address = length(parts) <= 2 ? iptoarr(parts[0]) : null;
    let bits = length(parts) == 2 && match(parts[1], /^[0-9]+$/) ? int(parts[1]) : length(parts) == 1 ? 128 : -1;
    if (address == null || length(address) != (family == 4 ? 4 : 16) || bits < 0 || bits > 128 ||
        (length(parts) == 2 && bits > length(address) * 8))
        die(label + ": invalid IP prefix " + as_string(prefix));
    return block_bounds(address, min(bits, length(address) * 8));
}

// A segment that is exactly a block reads as the prefix it came from.
function segment_text(low, high) {
    if (compare_addresses(low, high) == 0)
        return arrtoip(low);
    for (let bits = length(low) * 8 - 1; bits >= 0; bits--) {
        let block = block_bounds(low, bits);
        if (compare_addresses(block.low, low) != 0)
            break;
        if (compare_addresses(block.high, high) == 0)
            return arrtoip(low) + "/" + bits;
    }
    return arrtoip(low) + "-" + arrtoip(high);
}

// The elements of a set keyed on an address and a port must not overlap: the
// kernel refuses one that starts or ends inside another unless both are the
// same, and the whole transaction with it. Swept along the address space, the
// boxes become segments, each carrying the union of the port ranges of every box
// covering it, and neighbours that carry the same ranges are joined.
function disjoint(boxes) {
    let events = [];
    for (let box in boxes) {
        push(events, { at: box.low, box, open: true });
        let after = step_address(box.high, 1);
        if (after != null)
            push(events, { at: after, box, open: false });
    }
    sort(events, (left, right) => compare_addresses(left.at, right.at));

    let segments = [];
    let active = [];
    for (let i = 0; i < length(events);) {
        let at = events[i].at;
        for (; i < length(events) && compare_addresses(events[i].at, at) == 0; i++) {
            let event = events[i];
            active = event.open ? [ ...active, event.box ] : filter(active, (box) => box != event.box);
        }
        if (length(active) == 0)
            continue;

        let ranges = {};
        for (let box in active)
            ranges[box.key] = [ ...(ranges[box.key] ?? []), ...box.ranges ];
        let groups = map(sort(keys(ranges)), (key) => [ key, normalize_ranges(ranges[key]) ]);
        let signature = sprintf("%J", groups);
        let high = i < length(events) ? step_address(events[i].at, -1) : map(at, () => 255);

        let last = length(segments) > 0 ? segments[length(segments) - 1] : null;
        if (last != null && last.signature == signature && compare_addresses(step_address(last.high, 1) ?? [], at) == 0)
            last.high = high;
        else
            push(segments, { low: at, high, signature, groups });
    }

    let elements = [];
    for (let segment in segments) {
        let address = segment_text(segment.low, segment.high);
        for (let group in segment.groups)
            for (let range in group[1])
                push(elements, address + (group[0] == "" ? "" : " . " + group[0]) + " . " + port_text(range));
    }
    return { elements, count: length(segments) };
}

// A group limited to ports goes into the address-port set, one limited to a
// transport into the set whose key also carries the transport. The section's
// own ports narrow either, and a group they do not overlap selects nothing.
function add_groups(boxes, groups, family, ports, label) {
    if (type(groups) != "array")
        die(label + " must be an array");

    for (let i = 0; i < length(groups); i++) {
        let group = groups[i];
        let where = label + "[" + i + "]";
        if (type(group) != "object" || type(group.prefixes) != "array" || length(group.prefixes) == 0)
            die(where + ": invalid prefixes");
        let protocols = snapshot_protocols(group.networks, where);
        let ranges = snapshot_ranges(group.port_ranges, where);
        if (length(ranges) == 0 && length(protocols) == 0)
            die(where + ": unconstrained group");

        if (length(ports) > 0)
            ranges = length(ranges) > 0 ? intersect_ranges(ranges, ports) : ports;
        else if (length(ranges) == 0)
            ranges = [ { start: 1, end: 65535 } ];
        if (length(ranges) == 0)
            continue;

        for (let prefix in group.prefixes) {
            let bounds = prefix_bounds(prefix, family, where);
            if (length(protocols) == 0)
                push(boxes.pairs, { ...bounds, key: "", ranges });
            for (let protocol in protocols)
                push(boxes.triples, { ...bounds, key: protocol, ranges });
        }
    }
}

// The elements of each set the section owns, or null while one of its providers
// has not loaded yet. The section's own addresses are user input rather than
// something the core produced, so one nft cannot match is dropped, as the table
// drops it, instead of stopping the section.
function section_plan(snapshot, entry) {
    let m = entry.matchers;
    let ports = section_ranges(m.ports);
    let plain = { "4": [], "6": [] };
    let boxes = { "4": { pairs: [], triples: [] }, "6": { pairs: [], triples: [] } };

    for (let value in split(m.subnets, ",")) {
        let family = core_ip.ip_family(value);
        if (family != 0)
            push(plain[family], value);
    }

    for (let tag in m.subnet_tags) {
        let provider = snapshot.providers[tag];
        let label = "provider " + tag;
        if (provider == null)
            die("missing rule-set provider: " + tag);
        if (type(provider) != "object" || type(provider.revision) != "int")
            die(label + ": malformed snapshot");
        if (provider.revision < 1)
            return null;
        let ip_cidr = provider.ip_cidr;
        if (type(ip_cidr) != "object")
            die(label + ": missing ip_cidr snapshot");
        if (type(ip_cidr.digest) != "string" || ip_cidr.digest == "")
            die(label + ": ip_cidr snapshot carries no digest");

        for (let family in [ 4, 6 ]) {
            let prefixes = ip_cidr[family == 4 ? "ipv4" : "ipv6"];
            if (type(prefixes) != "array")
                die(label + ".ip_cidr.ipv" + family + " must be an array");
            for (let prefix in prefixes) {
                if (!prefix_is_nft_safe(prefix, family))
                    die(label + ": invalid IP prefix " + as_string(prefix));
                push(plain["" + family], prefix);
            }
            add_groups(boxes["" + family], ip_cidr[family == 4 ? "scoped_ipv4" : "scoped_ipv6"], family, ports,
                label + ".ip_cidr.scoped_ipv" + family);
        }
    }

    let s = m.sets;
    let pairs4 = disjoint(boxes["4"].pairs), pairs6 = disjoint(boxes["6"].pairs);
    let triples4 = disjoint(boxes["4"].triples), triples6 = disjoint(boxes["6"].triples);
    return {
        section: as_string(entry.section[".name"]),
        sets: [
            [ s.subnets, plain["4"] ], [ s.subnets6, plain["6"] ],
            [ s.ip_ports, pairs4.elements ], [ s.ip6_ports, pairs6.elements ],
            [ s.proto_ports, triples4.elements ], [ s.proto6_ports, triples6.elements ]
        ],
        scoped: pairs4.count + pairs6.count + triples4.count + triples6.count
    };
}

// One set replaced in place: nft applies the file as one transaction, so the
// flush and the elements that follow it are never observed apart. Duplicates
// two providers share are dropped, and the elements go in bounded lines.
function write_set(handle, set_name, elements) {
    handle.write("flush set inet " + TABLE + " " + set_name + "\n");
    let prefix = "add element inet " + TABLE + " " + set_name + " { ";
    let line = [];
    let line_length = 0;
    let written = 0;
    let last = null;

    for (let element in sort(elements)) {
        if (element == last)
            continue;
        last = element;
        written++;
        if (length(line) >= MAX_ELEMENTS_PER_LINE || line_length + length(element) + 2 > MAX_LINE_LENGTH) {
            handle.write(prefix + join(", ", line) + " }\n");
            line = [];
            line_length = 0;
        }
        push(line, element);
        line_length += length(element) + 2;
    }
    if (length(line) > 0)
        handle.write(prefix + join(", ", line) + " }\n");
    return written;
}

// The transaction goes to a file, so that what this process holds is released
// before nft starts allocating. The count is the addresses the sets now hold.
function apply_plan(plan) {
    let now = clock();
    let path = sprintf("/tmp/forkop-ruleset-sync.%d.%d.nft", now[0], now[1]);
    let handle = fs.open(path, "w");
    if (!handle)
        die("cannot write the nft transaction");
    let count = plan.scoped;
    for (let i = 0; i < length(plan.sets); i++) {
        let written = write_set(handle, plan.sets[i][0], plan.sets[i][1]);
        if (i < 2)
            count += written;
        plan.sets[i] = null;
    }
    handle.close();

    let result = exec.combined([ "nft", "-f", path ]);
    fs.unlink(path);
    if (result.status != 0)
        die(nft_apply.refusal({ status: result.status, stderr: result.output }));
    return count;
}

// A provider's revision starts over with every core, so across a reload only
// its digest tells content already written from new content.
function plan_key(snapshot, entry) {
    let m = entry.matchers;
    let parts = [ m.subnets, m.ports ];
    for (let tag in m.subnet_tags)
        push(parts, tag + ":" + (snapshot.providers[tag]?.ip_cidr?.digest ?? ""));
    return join("\t", parts);
}

// The sections of the table whose subnets a provider feeds, which is what the
// worker exists for. A configuration naming two sections alike has no table:
// building it refuses that.
function native_sections(sections) {
    return filter(nft_sections.with_priority_sets(sections).sections, (entry) => length(entry.matchers.subnet_tags) > 0);
}

function configured_sections() {
    return uci.section_objects(constants.FORKOP_CONFIG_NAME, "section");
}

// The providers each of those sections reads: the one input of the worker the
// table's script does not carry. A section's own addresses and ports are in the
// script, so a change to them rebuilds the table and starts the worker anyway.
function subnet_sources(sections) {
    let result = {};
    for (let entry in native_sections(sections))
        result[as_string(entry.section[".name"])] = entry.matchers.subnet_tags;
    return result;
}

// Every section fed by a provider whose inputs changed, each on its own: one
// refused does not keep the others from loading.
function sync(snapshot, sections) {
    let native = native_sections(sections);
    let loaded = 0, written = 0;
    for (let entry in native) {
        let name = as_string(entry.section[".name"]);
        let key = plan_key(snapshot, entry);
        if (applied[name] == key || refused[name] == key)
            continue;

        try {
            let plan = section_plan(snapshot, entry);
            if (plan == null)
                continue;
            loaded += apply_plan(plan);
            applied[name] = key;
            delete refused[name];
            written++;
        }
        catch (e) {
            delete applied[name];
            refused[name] = key;
            exec.log("error", "Failed to load the rule-set subnets of section '" + connections.section_display_name(entry.section) + "' into nftables: " + e.message);
        }
    }

    if (written > 0)
        exec.log("info", "Loaded " + loaded + " rule-set subnets into nftables" +
            (written == length(native) ? "" : " for " + written + " of " + length(native) + " sections"));
    return { loaded, written };
}

// The snapshot is parsed straight out of curl's pipe: read into a string first,
// it would exist twice, and on a country-sized list that is megabytes.
function snapshot(api) {
    return clash_api.curl(api, [ "-fsS", "--connect-timeout", "2", "--max-time", "10" ], "/providers/rules", (argv) => {
        let pipe = fs.popen(exec.command_line(argv) + " 2>/dev/null", "r");
        if (!pipe)
            return null;
        let value = null;
        try {
            value = json(pipe);
        }
        catch (e) {
        }
        let ok = pipe.close() == 0 && type(value?.providers) == "object" && type(value?.revision) == "int";
        return ok ? value : null;
    });
}

// The revision synced from, null when the controller gave no snapshot, and
// false when no section takes subnets from a provider.
function sync_once(api) {
    let sections = configured_sections();
    if (length(native_sections(sections)) == 0)
        return false;
    let value = snapshot(api);
    if (value == null)
        return null;
    sync(value, sections);
    return value.revision;
}

// true once a provider changed, false when none did within the wait, null when
// the controller could not be asked. The controller answers at once when its
// revision is no longer the one given, and otherwise when a provider updates.
function next_change(api, revision, seconds) {
    let result = clash_api.curl(api, [ "-fsS", "--connect-timeout", "2", "--max-time", "" + seconds ],
        "/providers/rules/events?since=" + revision, exec.capture);
    if (result.status == 28)
        return false;
    return result.status == 0 && type(common.parse_json(result.stdout)?.revision) == "int" ? true : null;
}

// procd keeps the sources the worker was started with, which is how a reload
// tells whether they changed.
function worker_spec(sources) {
    return {
        name: "forkop-ruleset-sync",
        instance: "sync",
        command: [ constants.FORKOP_BIN, "sync_rule_sets" ],
        env: { FORKOP_LIB: library.dir() },
        pid_file: "/var/run/forkop/ruleset-sync.pid",
        data: sources == null ? null : { subnet_sources: sources }
    };
}

// A controller that does not answer is looked up again and asked later and
// later; one that does is followed by its events. A reloaded core drops the
// wait, so the worker syncs from the new one and writes only what changed.
function worker() {
    worker_process.announce(worker_spec());
    let api = clash_api.controller();
    let delay = RETRY_MIN_SECONDS;
    let revision = sync_once(api);
    while (revision !== false) {
        let change = revision == null ? null : next_change(api, revision, EVENT_WAIT_SECONDS);
        if (change === false)
            continue;
        if (change == null) {
            sleep(delay * 1000);
            delay = min(delay * 2, RETRY_MAX_SECONDS);
            api = clash_api.controller();
        }
        revision = sync_once(api);
        if (revision != null)
            delay = RETRY_MIN_SECONDS;
    }
    worker_process.retire(worker_spec());
}

function stop_worker() {
    return worker_process.stop(worker_spec());
}

// Only while a section takes its subnets from a provider. A fresh worker has
// written nothing yet, so it fills every section.
function start_worker() {
    let sources = subnet_sources(configured_sections());
    if (length(sources) == 0)
        return stop_worker();
    return worker_process.start(worker_spec(sources));
}

// Whether the running worker reads what the configuration says: the same
// providers for the same sections, or no worker while no section reads one.
function worker_current() {
    let spec = worker_spec(subnet_sources(configured_sections()));
    if (length(spec.data.subnet_sources) == 0)
        return !worker_process.running(spec);
    return worker_process.current(spec);
}

return { sync, worker_spec, worker, start_worker, stop_worker, worker_current };
