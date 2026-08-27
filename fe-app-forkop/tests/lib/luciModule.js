// Loads a LuCI view module the way the LuCI loader does, so a test can call it
// instead of slicing function bodies out of the source text.
//
// A LuCI view starts with "require <class>" strings: they look like statements
// but the loader reads them as directives and resolves each dependency before
// evaluating the rest of the file. The file then ends in a
// `return baseclass.extend({...})` that names its public surface.
import fs from 'fs';
import path from 'path';

// LuCI installs a printf-like String.prototype.format that view code uses for
// its messages.
if (!String.prototype.format) {
  String.prototype.format = function (...args) {
    let index = 0;
    return this.replace(/%[sd]/g, () => `${args[((index += 1), index - 1)]}`);
  };
}

const REQUIRE_LINE = /^"require ([\w.]+)(?: as (\w+))?";$/;

export function createLoader(viewDir, globals = {}) {
  const loaded = new Map();

  function load(name) {
    if (loaded.has(name)) return loaded.get(name);

    const source = fs.readFileSync(path.join(viewDir, `${name}.js`), 'utf8');
    const lines = source.split('\n');
    const deps = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const matched = REQUIRE_LINE.exec(trimmed);
      if (matched) {
        deps.push([matched[1], matched[2]]);
        continue;
      }
      // The directives are the leading string literals; stop at real code.
      if (trimmed && !/^"[^"]*";$/.test(trimmed)) break;
    }

    const names = ['_', 'baseclass'];
    const values = [
      globals._ || ((text) => text),
      { extend: (value) => value },
    ];
    for (const [dep, alias] of deps) {
      if (dep === 'baseclass') continue;
      const local = alias || dep.split('.').pop();
      names.push(local);
      values.push(
        Object.prototype.hasOwnProperty.call(globals, local)
          ? globals[local]
          : load(dep.replace(/^view\.forkop\./, '')),
      );
    }
    for (const [key, value] of Object.entries(globals)) {
      if (names.includes(key)) continue;
      names.push(key);
      values.push(value);
    }

    const body = lines
      .filter((line) => !REQUIRE_LINE.test(line.trim()))
      .join('\n');
    const module = new Function(...names, body)(...values);
    loaded.set(name, module);
    return module;
  }

  return load;
}
