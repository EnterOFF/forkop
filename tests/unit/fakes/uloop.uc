// A stand-in for the ucode uloop module: nothing runs on its own, a test fires
// the recorded timers and intervals itself.

let timers = [];
let running = false;
let on_run = null;

function schedule(kind, ms, callback) {
    let entry = { kind, ms, callback, cancelled: false };
    push(timers, entry);
    return {
        cancel: function() { entry.cancelled = true; return true; },
        set: function(next_ms) { entry.ms = next_ms; entry.cancelled = false; return true; },
        remaining: function() { return entry.ms; }
    };
}

function __fire(kind) {
    let fired = 0;
    for (let entry in timers) {
        if (entry.cancelled || (kind != null && entry.kind != kind))
            continue;
        if (entry.kind == "timer")
            entry.cancelled = true;
        entry.callback();
        fired++;
    }
    return fired;
}

function __reset() {
    timers = [];
    running = false;
    on_run = null;
}

// What happens while the loop runs; run() returns once it is done.
function __on_run(fn) {
    on_run = fn;
}

return {
    init: function() { return true; },
    run: function() {
        running = true;
        if (on_run != null)
            on_run();
        running = false;
        return 0;
    },
    end: function() { running = false; return true; },
    running: function() { return running; },
    timer: function(ms, callback) { return schedule("timer", ms, callback); },
    interval: function(ms, callback) { return schedule("interval", ms, callback); },
    __fire,
    __reset,
    __on_run,
    __timers: function() { return timers; }
};
