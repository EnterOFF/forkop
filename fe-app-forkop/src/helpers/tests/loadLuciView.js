// Loads a LuCI view module the way LuCI does: the "require" prologue is resolved
// against sibling view modules and a small set of stubs, and the trailing
// baseclass.extend() call returns the module's exports.

import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const viewDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../luci-app-forkop/htdocs/luci-static/resources/view/forkop',
);

// A UCI model shaped like the one LuCI keeps in the browser: sections keyed by
// name, each carrying .name and .type, with list options stored as arrays.
export function createUciStub(sections = {}) {
  const values = {};

  const ensure = (name, type) => {
    values[name] ??= { '.name': name, '.type': type || 'server' };
    return values[name];
  };

  for (const [name, section] of Object.entries(sections)) {
    const target = ensure(name, section['.type']);
    Object.assign(target, section, { '.name': name });
  }

  let anonymous = 0;

  return {
    values,
    state: {
      values: { forkop: values },
      changes: {},
      deletes: {},
      creates: {},
    },
    get(_package, sectionId, option) {
      const section = values[sectionId];
      if (!section) return null;
      if (option === undefined) return section;
      return section[option] === undefined ? null : section[option];
    },
    get_all(_package, sectionId) {
      return values[sectionId] || null;
    },
    set(_package, sectionId, option, value) {
      ensure(sectionId)[option] = value;
    },
    unset(_package, sectionId, option) {
      delete values[sectionId]?.[option];
    },
    add(_package, type) {
      anonymous += 1;
      const name = `cfg${String(anonymous).padStart(6, '0')}`;
      ensure(name, type);
      return name;
    },
    remove(_package, sectionId) {
      delete values[sectionId];
    },
    sections(_package, type) {
      return Object.values(values).filter(
        (section) => !type || section['.type'] === type,
      );
    },
    load() {
      return Promise.resolve();
    },
  };
}

function defaultStubs(uci) {
  const noop = () => {};
  const element = () => ({
    setAttribute: noop,
    appendChild: noop,
    querySelector: () => null,
    style: {},
    classList: { add: noop, remove: noop, toggle: noop },
  });

  return {
    uci,
    fs: { exec: () => Promise.resolve({ code: 0, stdout: '{}' }) },
    ui: { showModal: noop, hideModal: noop, Textfield: class {} },
    dom: { append: noop, findClassInstance: () => null },
    form: {},
    rpc: { declare: () => () => Promise.resolve([]) },
    baseclass: { extend: (exports) => exports },
    main: {
      FORKOP_UCI_PACKAGE: 'forkop',
      showToast: noop,
      validatePath: (value) => ({
        valid: /^\/[A-Za-z0-9_./-]+$/.test(`${value}`),
      }),
    },
    window: {
      crypto: webcrypto,
      location: { hostname: 'router.lan' },
      setTimeout: noop,
    },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      head: { appendChild: noop },
      body: { appendChild: noop, removeChild: noop },
      createElement: element,
      createElementNS: element,
    },
    E: () => element(),
  };
}

const cache = new Map();

export function loadLuciView(name, uci) {
  const key = `${name}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const source = fs.readFileSync(path.join(viewDir, `${name}.js`), 'utf8');
  const stubs = defaultStubs(uci);
  const args = [];
  const argValues = [];
  const body = [];

  for (const line of source.split('\n')) {
    const required = line.match(
      /^"require ([A-Za-z0-9_.]+)(?: as ([A-Za-z0-9_]+))?";$/,
    );
    if (!required) {
      body.push(line);
      continue;
    }

    const [, module, alias] = required;
    const binding = alias || module;
    args.push(binding);
    // main.js is the generated application bundle; the tests only need the few
    // helpers the server modules read from it, so the stub stands in for it.
    const sibling =
      module.startsWith('view.forkop.') && module !== 'view.forkop.main'
        ? module.slice('view.forkop.'.length)
        : '';
    argValues.push(
      sibling ? loadLuciView(sibling, uci) : stubs[alias || module],
    );
  }

  for (const [binding, value] of Object.entries(stubs)) {
    if (!args.includes(binding)) {
      args.push(binding);
      argValues.push(value);
    }
  }

  const factory = new Function(...args, body.join('\n'));
  const exports = factory(...argValues);
  cache.set(key, exports);
  return exports;
}

export function resetLuciViewCache() {
  cache.clear();
}
