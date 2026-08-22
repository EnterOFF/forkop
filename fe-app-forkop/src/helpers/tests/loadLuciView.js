// Loads a LuCI view module the way LuCI does: the "require" prologue is resolved
// against stubs, and the trailing baseclass.extend() call returns the module's
// exports. A view keeps most of its logic private, so the caller may name the
// internal functions it wants added to those exports.

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

function defaultStubs(uci, widgets) {
  const noop = () => {};
  const element = () => ({
    setAttribute: noop,
    appendChild: noop,
    addEventListener: noop,
    replaceChildren: noop,
    querySelector: () => null,
    style: { setProperty: noop },
    classList: { add: noop, remove: noop, toggle: noop },
  });

  return {
    uci,
    fs: { exec: () => Promise.resolve({ code: 0, stdout: '{}' }) },
    ui: {
      // classList.add() rejects a token with a space in it, and LuCI spreads the
      // class arguments straight into it, so a joined class list throws where the
      // real dialog is opened and the button that opens it silently does nothing.
      showModal(_title, _children, ...classes) {
        classes.forEach((name) => {
          if (/\s/u.test(`${name}`)) {
            throw new Error(`invalid modal class token: ${name}`);
          }
        });
      },
      hideModal: noop,
      Textfield: class {},
    },
    dom: {
      append: noop,
      content: noop,
      // LuCI walks up from the node it is given looking for the widget instance, so a
      // mounted frame carries its own.
      findClassInstance: (node) => node?.instance || null,
    },
    // Enough of cbi/form to let a tab declare its options for real. Every widget
    // class is its own marker so a test can see which one an option was given, and
    // the option itself is a plain recorder: the tabs only ever set properties on it
    // and call value() and depends().
    form: FORM_CLASSES,
    rpc: { declare: () => () => Promise.resolve([]) },
    baseclass: { extend: (exports) => exports },
    main: {
      FORKOP_UCI_PACKAGE: 'forkop',
      showToast: noop,
      validatePath: (value) => ({
        valid: /^\/[A-Za-z0-9_./-]+$/.test(`${value}`),
      }),
    },
    // The Servers tab borrows the child item list widget from the Sections tab.
    // Loading that tab would pull in its whole dependency tree, so the shared
    // helpers stand in for it.
    sectionui: {
      ButtonAddSettingsDynamicList: class {},
      // The reserved tag list is the Sections tab's, so the stub carries the same
      // names the runtime check refuses.
      RESERVED_RUNTIME_TAGS: new Set([
        'dns-server',
        'fakeip-server',
        'bootstrap-dns-server',
        'dnsmasq-server',
        'hosts-server',
        'fakeip-dns-rule-tag',
        'fakeip-ruleset-dns-rule-tag',
        'service-fakeip-dns-rule-tag',
        'tproxy-in',
        'tproxy6-in',
        'dns-in',
        'source-dns-in',
        'system-in',
        'system6-in',
        'system-dns-in',
        'service-mixed-in',
        'direct-out',
      ]),
      addDynamicListItem: noop,
      childItemInputValue: (_sectionId, value) => `${value ?? ''}`,
      childPendingSettingsStore: () => ({}),
      cleanupRemovedChildItems: noop,
      configureTextareaOption: noop,
      isExistingChildItem: (_sectionId, itemId) =>
        Boolean(uci.get('forkop', `${itemId}`, '.type')),
      showChildItemSettingsModal: noop,
      updateDynamicListItemLabel: noop,
      validateUniqueDynamicListItemName: () => true,
    },
    window: {
      crypto: webcrypto,
      location: { hostname: 'router.lan' },
      setTimeout: noop,
    },
    document: {
      // A mounted widget, keyed by the id of the frame it renders. Every LuCI widget
      // carries that id; only some also name the inner control widget.<cbid>, so
      // looking for the control finds nothing for a checkbox.
      getElementById: (id) => widgets[id] || null,
      querySelector: () => null,
      head: { appendChild: noop },
      body: { appendChild: noop, removeChild: noop },
      createElement: element,
      createElementNS: element,
    },
    E: () => element(),
  };
}

// The cbi/form widget classes, by name. They carry no behaviour: a tab picks one
// per option and the choice is what a test wants to see.
const FORM_CLASSES = Object.fromEntries(
  [
    'DummyValue',
    'DynamicList',
    'Flag',
    'GridSection',
    'ListValue',
    'MultiValue',
    'TextValue',
    'TypedSection',
    'Value',
  ].map((name) => [name, { widget: name }]),
);

// A section that records what a tab declares on it instead of rendering anything.
// Returned options are plain objects, so a tab setting rmempty, a default or a
// validate on one is simply read back off the record.
export function createFormSectionStub() {
  const options = [];

  const section = {
    options,
    option(widget, name, title, description) {
      const option = {
        widget: widget && widget.widget ? widget.widget : 'unknown',
        name,
        title,
        description,
        choices: [],
        dependencies: [],
        value(key, label) {
          this.choices.push([key, label]);
          return this;
        },
        depends(first, second) {
          this.dependencies.push(
            typeof first === 'object' && first !== null
              ? first
              : { [first]: second },
          );
          return this;
        },
      };
      options.push(option);
      return option;
    },
    taboption(_tab, ...args) {
      return section.option(...args);
    },
  };

  return section;
}

// Adds the named internals to the object the module hands to baseclass.extend().
function exposeInternals(source, names) {
  if (!names.length) {
    return source;
  }

  const marker = 'return baseclass.extend({';
  const at = source.lastIndexOf(marker);
  if (at < 0) {
    throw new Error('module does not end in baseclass.extend({ ... })');
  }

  const injected = names.map((name) => `  ${name},`).join('\n');
  return `${source.slice(0, at + marker.length)}\n${injected}${source.slice(
    at + marker.length,
  )}`;
}

const cache = new Map();

export function loadLuciView(name, uci, expose = [], widgets = {}) {
  const key = `${name}:${expose.join(',')}:${Object.keys(widgets).join(',')}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const source = exposeInternals(
    fs.readFileSync(path.join(viewDir, `${name}.js`), 'utf8'),
    expose,
  );
  const stubs = defaultStubs(uci, widgets);
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
    argValues.push(stubs[binding]);
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
