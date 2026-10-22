// The configuration as a migration step sees it: every section of /etc/config/forkop in file
// order, each option as UCI holds it, a string or an array for a list. Steps change these
// objects directly; config.migration writes the difference back.

let common = require("core.common");

let as_string = common.as_string;

function name(section) {
    return as_string(section[".name"]);
}

function of_type(model, type_name) {
    return filter(model.sections, (section) => section[".type"] == type_name);
}

function find(model, section_name) {
    for (let section in model.sections)
        if (section[".name"] == section_name)
            return section;
    return null;
}

function settings(model) {
    let section = find(model, "settings");
    return section != null && section[".type"] == "settings" ? section : null;
}

function children(model, type_name, owner_key, owner) {
    owner = as_string(owner);
    return filter(model.sections, (section) => section[".type"] == type_name && as_string(section[owner_key]) == owner);
}

// An added section is anonymous, as the page adds them. Its name is a placeholder that no UCI
// name can be, and that the runtime replaces, in every option naming it, by the one UCI gives.
function add(model, type_name, options) {
    model.added = (model.added ?? 0) + 1;
    let section = { ...(options ?? {}), ".name": ".new-" + model.added, ".type": type_name, ".anonymous": true };
    push(model.sections, section);
    return section;
}

function add_named(model, type_name, section_name, options) {
    let section = { ...(options ?? {}), ".name": section_name, ".type": type_name, ".anonymous": false };
    push(model.sections, section);
    return section;
}

function remove(model, section) {
    model.sections = filter(model.sections, (item) => item !== section);
}

function value(section, key) {
    return common.option(section, key, "");
}

function present(section, key) {
    return section[key] != null;
}

// A list as a list, a single option as one value.
function list(section, key) {
    let raw = section[key];
    if (type(raw) == "array")
        return raw;
    raw = as_string(raw);
    return raw == "" ? [] : [ raw ];
}

// A list as a list, a single option split on whitespace, as list_option reads it.
function words(section, key) {
    return common.list_option(section, key);
}

function flag(section, key, fallback) {
    return common.bool_option(section, key, fallback);
}

function unset(section, keys) {
    for (let key in keys)
        delete section[key];
}

return { name, of_type, find, settings, children, add, add_named, remove, value, present, list, words, flag, unset };
