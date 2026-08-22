// Loads a LuCI view module the way LuCI does: the "require" prologue is resolved
// against stubs, and the trailing baseclass.extend() call returns the module's
// exports. A view keeps most of its logic private, so the caller may name the
// internal functions it wants added to those exports.

import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validateDomain } from '../../validators/validateDomain';
import { validateOutboundJson } from '../../validators/validateOutboundJson';
import { validateSubnet } from '../../validators/validateSubnet';

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

// The views a view requires. They are loaded through the same machinery rather
// than reimplemented, so a test that reaches one of their helpers exercises the
// shipped code. Their own prologues name only the stubs built here, so this
// never recurses back into a view.
const DEPENDENCY_VIEWS = {
  annotate: 'annotations',
  localDevices: 'local_devices',
  dpi: 'dpi_strategy',
};

const dependencyCache = new Map();

function loadDependencyView(file, uci) {
  if (dependencyCache.has(file)) {
    return dependencyCache.get(file);
  }

  const noop = () => {};
  const stubs = {
    baseclass: { extend: (exports) => exports },
    rpc: { declare: () => () => Promise.resolve([]) },
    uci,
    ui: { showModal: noop, hideModal: noop },
    form: FORM_CLASSES,
    main: { FORKOP_UCI_PACKAGE: 'forkop', showToast: noop },
    E: () => null,
  };

  const exports = instantiateView(file, [], stubs);
  dependencyCache.set(file, exports);
  return exports;
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
      ...UI_CLASSES,
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
      // The validators a view delegates to are the shipped ones, so a test that
      // reaches one of them sees what the browser would.
      validateDomain,
      validateOutboundJson,
      validateSubnet,
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
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: noop,
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
    network: { getDevices: () => Promise.resolve([]) },
    ...Object.fromEntries(
      Object.entries(DEPENDENCY_VIEWS).map(([binding, file]) => [
        binding,
        loadDependencyView(file, uci),
      ]),
    ),
  };
}

// The cbi/form widget classes, by name. They carry no behaviour: a tab picks one
// per option and the choice is what a test wants to see.
// A LuCI widget base: a class with its own extend(), which the tabs subclass at
// module scope. Nothing renders here, so the stub only has to stay extendable.
function extendableWidget(name) {
  function Widget() {}
  Widget.widget = name;
  Widget.prototype = {};
  Widget.extend = function extend(members) {
    function Subclass() {}
    Subclass.widget = name;
    Subclass.prototype = Object.assign(Object.create(this.prototype), members);
    Subclass.extend = extend;
    return Subclass;
  };
  return Widget;
}

const FORM_CLASSES = Object.fromEntries(
  [
    'DummyValue',
    'DynamicList',
    'Flag',
    'GridSection',
    'ListValue',
    'MultiValue',
    'NamedSection',
    'TableSection',
    'TextValue',
    'TypedSection',
    'Value',
  ].map((name) => [name, extendableWidget(name)]),
);

// The ui widget bases a view subclasses. Only the names the views reach for are
// listed; anything else stays absent so a new dependency is visible.
const UI_CLASSES = Object.fromEntries(
  ['Dropdown', 'DynamicList', 'Textarea', 'Textfield'].map((name) => [
    name,
    extendableWidget(name),
  ]),
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
// A view either passes an object literal or the name of one it built above, and
// both endings are rewritten in place.
function exposeInternals(source, names) {
  if (!names.length) {
    return source;
  }

  const injected = names.map((name) => `  ${name},`).join('\n');
  const marker = 'return baseclass.extend({';
  const at = source.lastIndexOf(marker);
  if (at >= 0) {
    return `${source.slice(0, at + marker.length)}\n${injected}${source.slice(
      at + marker.length,
    )}`;
  }

  const named = source.match(
    /return baseclass\.extend\(([A-Za-z_$][\w$]*)\);\s*$/,
  );
  if (!named) {
    throw new Error('module does not end in baseclass.extend( ... )');
  }

  return source.replace(
    named[0],
    `return baseclass.extend(Object.assign({}, ${named[1]}, {\n${injected}\n}));\n`,
  );
}

const cache = new Map();

function instantiateView(name, expose, stubs) {
  const source = exposeInternals(
    fs.readFileSync(path.join(viewDir, `${name}.js`), 'utf8'),
    expose,
  );
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

  return new Function(...args, body.join('\n'))(...argValues);
}

export function loadLuciView(name, uci, expose = [], widgets = {}) {
  const key = `${name}:${expose.join(',')}:${Object.keys(widgets).join(',')}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const exports = instantiateView(name, expose, defaultStubs(uci, widgets));
  cache.set(key, exports);
  return exports;
}

export function resetLuciViewCache() {
  cache.clear();
  dependencyCache.clear();
}
