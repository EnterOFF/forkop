// A small stand-in for LuCI's form.js, enough to build a view's real option set
// outside a browser and run a save over it.
//
// Reach for this when a test has to answer "what would this dialog write?"
// rather than "does the source say X". The rules that decide it - when an option
// is active, and what parse() does with an active or a hidden one - are copied
// from /www/luci-static/resources/form.js and are the whole point of the file;
// keep them in step with LuCI rather than making them convenient:
//
//   AbstractValue.parse   active and empty      -> remove when rmempty/optional
//                         active and changed    -> write
//                         hidden                -> remove unless retain
//   FlagValue.parse       active, value=default -> remove when rmempty/optional
//                         active, otherwise     -> write
//                         hidden                -> remove unless retain
//   Map.isDependencySatisfied  the depends() evaluator, verbatim
//
// rmempty is true by default in LuCI, and every option starts hidden-free; both
// matter, so neither is changed here.
//
// Usage:
//     const { createHarness } = require('./helpers/luci_form.js');
//     const h = createHarness(rootDir);
//     const view = h.load('section');            // evaluates the view module
//     h.uci.add('forkop', 'section', 'section_a');
//     const map = new h.form.Map('forkop');
//     view.createSectionContent(map.section(h.form.GridSection, 'section'));
//     await h.openDialog(listOption, 'section_a', itemId);   // returns { save }
const path = require('path');

/* --------------------------------------------------------- class machinery */

// LuCI's baseclass: Class.extend(props) subclasses, this.super('__init__', args)
// walks up the chain.
function makeClass(name, init, parent) {
  function Ctor(...args) {
    const chain = [];
    for (let c = Ctor; c; c = c.__parent__) chain.unshift(c.__init__);
    let level = chain.length - 1;
    this.super = (method, superArgs) => {
      if (method !== '__init__') return undefined;
      level -= 1;
      const fn = chain[level];
      const out = fn ? fn.apply(this, superArgs || []) : undefined;
      level += 1;
      return out;
    };
    const last = chain[chain.length - 1];
    if (last) last.apply(this, args);
  }
  Ctor.prototype = Object.create(parent ? parent.prototype : Object.prototype);
  Ctor.prototype.constructor = Ctor;
  Ctor.prototype.__name__ = name;
  Ctor.__init__ = init;
  Ctor.__parent__ = parent || null;
  Ctor.extend = function (props) {
    const Sub = makeClass(props.__name__ || name, props.__init__ || init, Ctor);
    Object.assign(Sub.prototype, props);
    Sub.prototype.constructor = Sub;
    return Sub;
  };
  return Ctor;
}

/* ---------------------------------------------------- LuCI value comparison */

function isEqual(x, y) {
  if (typeof y === 'object' && y instanceof RegExp) return x == null ? false : y.test(x);
  if (x != null && y != null && typeof x !== typeof y) return false;
  if ((x == null && y != null) || (x != null && y == null)) return false;
  if (Array.isArray(x)) {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!isEqual(x[i], y[i])) return false;
  } else if (typeof x === 'object') {
    for (const k in x) {
      if (
        Object.prototype.hasOwnProperty.call(x, k) &&
        !Object.prototype.hasOwnProperty.call(y, k)
      ) {
        return false;
      }
    }
    for (const k in y) {
      if (Object.prototype.hasOwnProperty.call(y, k) && !isEqual(x[k], y[k])) return false;
    }
  } else if (x !== y) {
    return false;
  }
  return true;
}

function isContained(x, y) {
  if (Array.isArray(x)) return x.indexOf(y) !== -1;
  if (typeof x === 'string') return x.split(/\s+/).indexOf(y) !== -1;
  return false;
}

/* ------------------------------------------------------------------ the DOM */

// Just enough of an element for the dialog plumbing: the stacked settings dialog
// looks up the open modal, swaps its button row and hangs the rendered map next
// to it.
class FakeNode {
  constructor(tag, attrs) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.childNodes = [];
    this.parentNode = null;
    this.textContent = '';
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    };
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  appendChild(node) {
    this.childNodes.push(node);
    if (node instanceof FakeNode) node.parentNode = this;
    return node;
  }
  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    if (node instanceof FakeNode) node.parentNode = null;
  }
  insertBefore(node) {
    return this.appendChild(node);
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  insertAdjacentHTML() {}
  get nextElementSibling() {
    return null;
  }
}

function E(tag, attrs, children) {
  const isAttrs = attrs && typeof attrs === 'object' && !Array.isArray(attrs);
  const node = new FakeNode(typeof tag === 'string' ? tag : 'span', isAttrs ? attrs : {});
  const kids = Array.isArray(attrs) ? attrs : children;
  if (Array.isArray(kids)) {
    kids.forEach((kid) => kid instanceof FakeNode && node.appendChild(kid));
  }
  return node;
}

/* ------------------------------------------------------------------- config */

class JSONConfig {
  constructor(data) {
    this.data = JSON.parse(JSON.stringify(data));
  }
  get(pkg, sid, opt) {
    const section = this.data[sid];
    if (!section) return null;
    if (opt == null) return section;
    return section[opt] === undefined ? null : section[opt];
  }
  set(pkg, sid, opt, val) {
    this.data[sid] ??= {};
    this.data[sid][opt] = val;
  }
  unset(pkg, sid, opt) {
    if (this.data[sid]) delete this.data[sid][opt];
  }
  sections() {
    return Object.entries(this.data).map(([name, section]) => ({ '.name': name, ...section }));
  }
  add(pkg, type, name) {
    this.data[name] = {};
    return name;
  }
  remove() {}
}

/* -------------------------------------------------------------------- forms */

function buildForm(uciData) {
  const AbstractValue = makeClass(
    'CBI.AbstractValue',
    function (map, section, option, ...rest) {
      this.map = map;
      this.section = section;
      this.option = option;
      this.title = rest[0];
      this.description = rest[1];
      this.config = map.config;
      this.deps = [];
      this.data = {};
      this.rmempty = true;
      this.default = null;
      this.size = null;
      this.optional = false;
      this.retain = false;
    },
  );

  Object.assign(AbstractValue.prototype, {
    depends(field, value) {
      this.deps.push(typeof field === 'string' ? { [field]: value } : field);
    },
    value(key, title) {
      this.keylist ??= [];
      this.vallist ??= [];
      this.keylist.push(key);
      this.vallist.push(title);
    },
    load(sid) {
      return this.map.data.get(
        this.map.config,
        this.ucisection ?? sid,
        this.ucioption ?? this.option,
      );
    },
    // cfgvalue holds what load() answered, exactly as LuCI stores it during
    // Map.load(); a custom load() therefore decides what parse() compares against.
    cfgvalue(sid, setValue) {
      if (arguments.length === 2) {
        this.data[sid] = setValue;
        return undefined;
      }
      return this.data[sid];
    },
    // No test touches a widget, so it still holds what render() put in it.
    widgetValue(sid) {
      const cval = this.cfgvalue(sid);
      return cval != null ? cval : this.default;
    },
    formvalue(sid) {
      const value = this.widgetValue(sid);
      return value == null ? null : value;
    },
    checkDepends(sid) {
      return this.map.isDependencySatisfied(this.deps, this.map.config, sid);
    },
    isActive(sid) {
      return this.checkDepends(sid);
    },
    isValid() {
      return true;
    },
    stripTags(value) {
      return `${value ?? ''}`;
    },
    write(sid, value) {
      this.map.data.set(
        this.map.config,
        this.ucisection ?? sid,
        this.ucioption ?? this.option,
        value,
      );
    },
    remove(sid) {
      const opt = this.ucioption ?? this.option;
      for (const sibling of this.section.children) {
        if (sibling === this || sibling.ucioption == null) continue;
        if ((sibling.ucioption ?? sibling.option) !== opt) continue;
        if (!sibling.isActive(sid)) continue;
        return;
      }
      this.map.data.unset(this.map.config, this.ucisection ?? sid, opt);
    },
    parse(sid) {
      if (this.isActive(sid)) {
        const cval = this.cfgvalue(sid);
        const fval = this.formvalue(sid);
        if (fval == null || fval === '') {
          if (this.rmempty || this.optional) return Promise.resolve(this.remove(sid));
          return Promise.reject(
            new TypeError(`Option "${this.option}" must not be empty.`),
          );
        }
        if (this.forcewrite || !isEqual(cval, fval)) {
          return Promise.resolve(this.write(sid, fval));
        }
        return Promise.resolve();
      }
      if (!this.retain) return Promise.resolve(this.remove(sid));
      return Promise.resolve();
    },
  });

  const Value = AbstractValue.extend({ __name__: 'CBI.Value' });
  const ListValue = Value.extend({ __name__: 'CBI.ListValue' });
  const DynamicList = Value.extend({
    __name__: 'CBI.DynamicList',
    formvalue(sid) {
      const value = this.widgetValue(sid);
      if (value == null) return [];
      return (Array.isArray(value) ? value : [value]).filter(
        (item) => `${item ?? ''}` !== '',
      );
    },
    parse(sid) {
      if (this.isActive(sid)) {
        const cval = this.cfgvalue(sid);
        const fval = this.formvalue(sid);
        if (fval == null || fval.length === 0) {
          if (this.rmempty || this.optional) return Promise.resolve(this.remove(sid));
          return Promise.reject(
            new TypeError(`Option "${this.option}" must not be empty.`),
          );
        }
        if (this.forcewrite || !isEqual(cval, fval)) {
          return Promise.resolve(this.write(sid, fval));
        }
        return Promise.resolve();
      }
      if (!this.retain) return Promise.resolve(this.remove(sid));
      return Promise.resolve();
    },
  });
  const MultiValue = DynamicList.extend({ __name__: 'CBI.MultiValue' });
  const TextValue = Value.extend({ __name__: 'CBI.TextValue' });
  const DummyValue = Value.extend({ __name__: 'CBI.DummyValue' });
  const ButtonValue = Value.extend({
    __name__: 'CBI.ButtonValue',
    parse() {
      return Promise.resolve();
    },
  });
  const FlagValue = Value.extend({
    __name__: 'CBI.FlagValue',
    __init__(...args) {
      this.super('__init__', args);
      this.enabled = '1';
      this.disabled = '0';
      this.default = this.disabled;
    },
    formvalue(sid) {
      return `${this.widgetValue(sid) ?? ''}` === this.enabled ? this.enabled : this.disabled;
    },
    parse(sid) {
      if (this.isActive(sid)) {
        const fval = this.formvalue(sid);
        if (fval == this.default && (this.optional || this.rmempty)) {
          return Promise.resolve(this.remove(sid));
        }
        return Promise.resolve(this.write(sid, fval));
      }
      if (!this.retain) return Promise.resolve(this.remove(sid));
      return Promise.resolve();
    },
  });

  const AbstractSection = makeClass(
    'CBI.AbstractSection',
    function (map, sectionType, ...rest) {
      this.map = map;
      this.config = map.config;
      this.sectiontype = sectionType;
      this.title = rest[0];
      this.description = rest[1];
      this.children = [];
      this.tabs = [];
    },
  );
  Object.assign(AbstractSection.prototype, {
    cfgsections() {
      return [this.section ?? 'settings'];
    },
    option(Cls, name, ...rest) {
      const option = new Cls(this.map, this, name, ...rest);
      this.children.push(option);
      return option;
    },
    tab(name, title) {
      this.tabs.push({ name, title, children: [] });
      this.tabs[name] = this.tabs[this.tabs.length - 1];
    },
    taboption(tabName, Cls, name, ...rest) {
      const option = this.option(Cls, name, ...rest);
      option.tab = tabName;
      return option;
    },
    load() {
      const tasks = [];
      for (const sid of this.cfgsections()) {
        for (const child of this.children) {
          tasks.push(
            Promise.resolve(child.load(sid)).then((value) => child.cfgvalue(sid, value)),
          );
        }
      }
      return Promise.all(tasks);
    },
    parse() {
      const tasks = [];
      for (const sid of this.cfgsections()) {
        for (const child of this.children) tasks.push(child.parse(sid));
      }
      return Promise.all(tasks);
    },
  });
  const NamedSection = AbstractSection.extend({
    __name__: 'CBI.NamedSection',
    __init__(map, section, ...rest) {
      this.super('__init__', [map, section, ...rest]);
      this.section = section;
    },
    cfgsections() {
      return [this.section];
    },
  });
  const TypedSection = AbstractSection.extend({ __name__: 'CBI.TypedSection' });
  const TableSection = TypedSection.extend({ __name__: 'CBI.TableSection' });
  const GridSection = TableSection.extend({ __name__: 'CBI.GridSection' });

  const CBIMap = makeClass('CBI.Map', function (config, ...rest) {
    this.config = config;
    this.data = uciData;
    this.title = rest[0];
    this.description = rest[1];
    this.children = [];
  });
  Object.assign(CBIMap.prototype, {
    section(Cls, ...args) {
      const section = new Cls(this, ...args);
      this.children.push(section);
      return section;
    },
    lookupOption(name, sid) {
      for (const section of this.children) {
        for (const option of section.children) {
          if (option.option === name) return [option, sid];
        }
      }
      return null;
    },
    isDependencySatisfied(depends, configName, sectionId) {
      let def = false;
      if (!Array.isArray(depends) || !depends.length) return true;
      for (let i = 0; i < depends.length; i++) {
        let istat = true;
        const reverse = depends[i]['!reverse'];
        const contains = depends[i]['!contains'];
        for (const dep in depends[i]) {
          if (dep === '!reverse' || dep === '!contains') continue;
          if (dep === '!default') {
            def = true;
            istat = false;
          } else {
            const res = this.lookupOption(dep, sectionId, configName);
            const val = res && res[0].isActive(res[1]) ? res[0].formvalue(res[1]) : null;
            const equal = contains
              ? isContained(val, depends[i][dep])
              : isEqual(val, depends[i][dep]);
            istat = istat && equal;
          }
        }
        if (istat ^ reverse) return true;
      }
      return def;
    },
    checkDepends() {},
    findElement() {
      return null;
    },
    load() {
      return Promise.all(this.children.map((section) => section.load()));
    },
    render() {
      return this.load().then(() => new FakeNode('div'));
    },
    parse() {
      return Promise.all(this.children.map((section) => section.parse()));
    },
  });
  const JSONMap = CBIMap.extend({
    __name__: 'CBI.JSONMap',
    __init__(data, ...rest) {
      this.super('__init__', ['json', ...rest]);
      this.config = 'json';
      this.data = new JSONConfig(data);
    },
  });

  return {
    Map: CBIMap,
    JSONMap,
    NamedSection,
    TypedSection,
    TableSection,
    GridSection,
    Value,
    ListValue,
    DynamicList,
    MultiValue,
    TextValue,
    DummyValue,
    Flag: FlagValue,
    Button: ButtonValue,
  };
}

/* ----------------------------------------------------------------- harness */

function readDomainListOptions(root) {
  const source = require('fs').readFileSync(
    path.join(root, 'fe-app-forkop/src/constants.ts'),
    'utf8',
  );
  const start = source.indexOf('export const DOMAIN_LIST_OPTIONS = {');
  const end = source.indexOf('};', start);
  if (start < 0 || end < 0) {
    throw new Error('DOMAIN_LIST_OPTIONS not found in fe-app-forkop/src/constants.ts');
  }
  const options = {};
  for (const [, key, label] of source
    .slice(start, end)
    .matchAll(/^\s*(\w+):\s*'([^']*)',/gm)) {
    options[key] = label;
  }
  if (!Object.keys(options).length) {
    throw new Error('DOMAIN_LIST_OPTIONS is empty, so rule set values cannot be told apart');
  }
  return options;
}

function createHarness(root, packageName = 'forkop') {
  const viewDir = path.join(
    root,
    'luci-app-forkop/htdocs/luci-static/resources/view/forkop',
  );
  const { createLoader } = require(path.join(root, 'tests/helpers/luci_module.js'));

  // Every write the views make, in order, so a test can assert that a save
  // touched nothing.
  const store = new Map();
  const operations = [];
  let anonymous = 0;
  const uci = {
    sections(pkg, type, cb) {
      const list = Array.from(store.values()).filter(
        (section) => !type || section['.type'] === type,
      );
      if (cb) list.forEach(cb);
      return list;
    },
    get(pkg, sid, opt) {
      const section = store.get(sid);
      if (!section) return null;
      if (opt == null) return section;
      return Object.prototype.hasOwnProperty.call(section, opt) ? section[opt] : null;
    },
    set(pkg, sid, opt, val) {
      const section = store.get(sid);
      if (!section) return;
      if (!isEqual(section[opt] ?? null, val ?? null)) {
        operations.push(`set ${sid}.${opt}=${JSON.stringify(val)}`);
      }
      section[opt] = val;
    },
    unset(pkg, sid, opt) {
      const section = store.get(sid);
      if (!section) return;
      // LuCI only records a delete for an option the section actually has.
      if (Object.prototype.hasOwnProperty.call(section, opt)) {
        operations.push(`del ${sid}.${opt}`);
      }
      delete section[opt];
    },
    add(pkg, type, name) {
      const sid = name || `cfg${(anonymous += 1)}`;
      if (store.has(sid)) return null;
      store.set(sid, { '.name': sid, '.type': type });
      return sid;
    },
    remove(pkg, sid) {
      store.delete(sid);
    },
    get_first() {
      return null;
    },
  };
  const uciData = {
    get: (...args) => uci.get(...args),
    set: (...args) => uci.set(...args),
    unset: (...args) => uci.unset(...args),
    sections: (...args) => uci.sections(...args),
  };

  const form = buildForm(uciData);

  const modal = new FakeNode('div');
  const activeMap = new FakeNode('div');
  const buttonRow = new FakeNode('div');
  const heading = new FakeNode('h4');
  new FakeNode('div').appendChild(activeMap);
  modal.querySelector = (selector) => {
    if (selector.startsWith('.cbi-map')) return activeMap;
    if (selector.startsWith('div.button-row')) return buttonRow;
    if (selector === 'h4') return heading;
    return null;
  };

  const documentStub = {
    querySelector: (selector) =>
      selector === '#modal_overlay > .modal.cbi-modal' ? modal : null,
    getElementById: () => null,
    createElement: (tag) => new FakeNode(tag),
    head: new FakeNode('head'),
    body: new FakeNode('body'),
  };

  const L = {
    bind: (fn, self, ...bound) => fn.bind(self, ...bound),
    resource: (...parts) => parts.join('/'),
    toArray(value) {
      if (value == null) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'object') return [value];
      const text = String(value).trim();
      return text === '' ? [] : text.split(/\s+/);
    },
    error(kind, message) {
      throw new Error(`${kind}: ${message}`);
    },
  };

  // Anything a view reaches for that a save cannot depend on: constants keep
  // their real values, everything else answers harmlessly.
  const main = new Proxy(
    {
      FORKOP_UCI_PACKAGE: packageName,
      FORKOP_ACTION_PROVIDERS_AVAILABILITY_EVENT: 'forkop:action-providers-availability',
      DEFAULT_LATENCY_TEST_URL: 'https://www.gstatic.com/generate_204',
      LATENCY_TEST_URL_OPTIONS: [],
      // The built-in list names decide which of a section's rule sets are
      // community lists and which are URLs the user typed, so a save that cannot
      // tell them apart rewrites both options. They come from the frontend
      // source rather than a copy, which would answer a question of its own.
      DOMAIN_LIST_OPTIONS: readDomainListOptions(root),
      store: {},
      ForkopShellMethods: new Proxy({}, { get: () => () => Promise.resolve({}) }),
      parseValueList: (value) =>
        Array.isArray(value)
          ? value
          : `${value ?? ''}`.split(/[\s,]+/).filter(Boolean),
    },
    {
      get: (target, prop) =>
        prop in target
          ? target[prop]
          : () => (/^validate/.test(prop) ? { valid: true } : ''),
    },
  );
  const dpi = new Proxy(
    {
      BYEDPI_DEFAULT_CMD_OPTS: '',
      ZAPRET2_DEFAULT_NFQWS2_OPT: '',
      ZAPRET_DEFAULT_NFQWS_OPT: '',
      ZAPRET_LEGACY_DEFAULT_NFQWS_OPT: '',
    },
    { get: (target, prop) => (prop in target ? target[prop] : () => ({})) },
  );

  const load = createLoader(viewDir, {
    form,
    ui: { DynamicList: makeClass('ui.DynamicList', function () {}), addNotification() {} },
    uci,
    fs: { read: () => Promise.resolve(''), exec: () => Promise.resolve({}) },
    network: { getDevices: () => Promise.resolve([]) },
    main,
    dpi,
    annotate: new Proxy({}, { get: () => () => '' }),
    localDevices: {
      SYSTEM_DEVICE_VALUE: '__system__',
      createLocalDeviceDynamicListWidget: () => ({}),
      normalizeOptionValues: (value) => (Array.isArray(value) ? value : []),
    },
    widgets: { DeviceSelect: form.MultiValue, NetworkSelect: form.MultiValue },
    L,
    E,
    document: documentStub,
    window: {
      crypto: require('crypto').webcrypto,
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      location: { hostname: 'router.lan', href: 'http://router.lan/', protocol: 'http:' },
    },
    poll: { add() {}, remove() {} },
    dom: { content() {}, append() {} },
    rpc: { declare: () => () => Promise.resolve({}) },
  });

  // Every dialog the views open, so a test can reach a nested one.
  const dialogMaps = [];
  const OriginalJSONMap = form.JSONMap;
  form.JSONMap = OriginalJSONMap.extend({
    __init__(...args) {
      this.super('__init__', args);
      dialogMaps.push(this);
    },
  });

  // Opens a child item's settings dialog and hands back its map plus the Save
  // the dialog installed, so a test can press it the way the user does.
  async function openDialog(option, ownerId, itemValue, context = {}) {
    const buttons = [];
    const originalAppend = buttonRow.append.bind(buttonRow);
    buttonRow.append = (...nodes) => {
      nodes.forEach((node) => node?.attrs?.click && buttons.push(node));
      return originalAppend(...nodes);
    };
    const first = dialogMaps.length;
    try {
      await option.renderItemSettingsModal(
        ownerId,
        itemValue,
        option,
        null,
        null,
        context,
      );
    } finally {
      buttonRow.append = originalAppend;
    }
    const saveButton = buttons[buttons.length - 1];
    if (!saveButton) throw new Error(`dialog for ${option.option} did not open`);
    return {
      map: dialogMaps[first],
      save: () => saveButton.attrs.click(),
    };
  }

  return { load, form, uci, store, operations, openDialog, isEqual };
}

module.exports = { createHarness, isEqual, makeClass, FakeNode, E };
