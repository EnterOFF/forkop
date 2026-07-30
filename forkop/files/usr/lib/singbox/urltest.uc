#!/usr/bin/env ucode

let common = require("core.common");

let as_string = common.as_string;
let array_or_empty = common.array_or_empty;
let object_or_empty = common.object_or_empty;

function regex_matches(value, pattern) {
    pattern = as_string(pattern);
    if (pattern == "")
        return false;

    try {
        return match(as_string(value), regexp(pattern)) != null;
    }
    catch (e) {
        return false;
    }
}

function regex_matching_tag_array(tags, names, regexes) {
    tags = array_or_empty(tags);
    names = object_or_empty(names);
    regexes = array_or_empty(regexes);
    let result = [];

    for (let tag in tags) {
        let name = names[tag];
        name = name == null || as_string(name) == "" ? tag : as_string(name);

        for (let pattern in regexes) {
            if (regex_matches(name, pattern)) {
                push(result, tag);
                break;
            }
        }
    }

    return result;
}

return {
    regex_matching_tag_array
};
