// In-memory ucode ubus module: calls go to the handlers a test registers and are recorded.

let handlers = {};
let calls = [];
let published = {};
let subscribers = [];
let connect_fails = false;

function copy(value) {
    return value == null ? null : json(sprintf("%J", value));
}

function connect() {
    if (connect_fails)
        return null;

    return {
        call: function(object, method, args) {
            push(calls, { object, method, args: copy(args) });
            let handler = handlers[object + "." + method];
            if (handler == null)
                return null;
            return type(handler) == "function" ? handler(copy(args)) : copy(handler);
        },

        publish: function(name, methods) {
            published[name] = methods;
            return { remove: function() { delete published[name]; } };
        },

        subscriber: function(notify, remove) {
            let entry = { notify, remove, objects: [] };
            push(subscribers, entry);
            return {
                subscribe: function(object) {
                    push(entry.objects, object);
                    return true;
                },
                unsubscribe: function(object) {
                    entry.objects = filter(entry.objects, (name) => name != object);
                    return true;
                }
            };
        },

        disconnect: function() {
            return true;
        },

        error: function() {
            return null;
        }
    };
}

function __on(object_method, reply) {
    handlers[object_method] = reply;
}

function __notify(object, notification_type, data) {
    for (let entry in subscribers)
        if (index(entry.objects, object) >= 0)
            entry.notify({ type: notification_type, data: copy(data) });
}

// Calls a method of a published object the way a client would, and returns what
// it replied - immediately or through a deferred request.
function __invoke(name, method, args) {
    let methods = published[name];
    if (methods == null || methods[method] == null)
        die("no published method " + name + "." + method);

    let request = { args: args ?? {}, deferred: false, replied: null };
    request.defer = function() { request.deferred = true; };
    request.reply = function(value) { request.replied = copy(value); };
    let result = methods[method].call(request);
    if (!request.deferred)
        request.replied = copy(result);
    return request;
}

function __reset() {
    handlers = {};
    calls = [];
    published = {};
    subscribers = [];
    connect_fails = false;
}

function __calls() {
    return copy(calls);
}

function __refuse_connections() {
    connect_fails = true;
}

return {
    connect, __on, __notify, __invoke, __reset, __calls, __refuse_connections,
    __published: function(name) { return published[name]; }
};
