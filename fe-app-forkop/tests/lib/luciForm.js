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
//     import { createHarness } from '../lib/luciForm.js';
//     const h = createHarness();
//     const view = h.bundle;                     // the shipped bundle
//     h.uci.add('forkop', 'section', 'section_a');
//     const map = new h.form.Map('forkop');
//     view.createSectionContent(map.section(h.form.GridSection, 'section'));
//     await h.openDialog(listOption, 'section_a', itemId);   // returns { save }
//     await h.openDialogWith(() => button.onclick());   // one stacked on it
import { webcrypto } from 'crypto';
import { loadBundle } from './bundle.js';

/* --------------------------------------------------------- class machinery */

// LuCI's baseclass: Class.extend(props) subclasses, this.super(method, args)
// walks up the chain. __init__ lives on the constructor here rather than on the
// prototype, so it keeps its own walk; every other method is looked up the way
// LuCI's Class.super does - start above the prototype whose frame is running,
// and keep a per-method stack so a super inside a super goes one further up.
function makeClass(name, init, parent) {
  function Ctor(...args) {
    const chain = [];
    for (let c = Ctor; c; c = c.__parent__) chain.unshift(c.__init__);
    let level = chain.length - 1;
    const superStacks = {};
    this.super = (method, superArgs) => {
      if (method === '__init__') {
        level -= 1;
        const fn = chain[level];
        const out = fn ? fn.apply(this, superArgs || []) : undefined;
        level += 1;
        return out;
      }
      const stack = (superStacks[method] ??= []);
      let proto = Object.getPrototypeOf(
        stack.length ? stack[0] : Object.getPrototypeOf(this),
      );
      while (
        proto != null &&
        !Object.prototype.hasOwnProperty.call(proto, method)
      ) {
        proto = Object.getPrototypeOf(proto);
      }
      if (proto == null) return null;
      const member = proto[method];
      if (superArgs === undefined) return member;
      if (typeof member !== 'function') {
        throw new ReferenceError(`${method} is not a function in base class`);
      }
      stack.unshift(proto);
      try {
        return member.apply(
          this,
          Array.isArray(superArgs) ? superArgs : [superArgs],
        );
      } finally {
        stack.shift();
      }
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
  if (typeof y === 'object' && y instanceof RegExp)
    return x == null ? false : y.test(x);
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
      if (Object.prototype.hasOwnProperty.call(y, k) && !isEqual(x[k], y[k]))
        return false;
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
  remove() {
    this.parentNode?.removeChild(this);
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
  const node = new FakeNode(
    typeof tag === 'string' ? tag : 'span',
    isAttrs ? attrs : {},
  );
  const kids = Array.isArray(attrs) ? attrs : children;
  if (Array.isArray(kids)) {
    kids.forEach((kid) => {
      if (kid instanceof FakeNode) node.appendChild(kid);
      else if (typeof kid === 'string') node.textContent += kid;
    });
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
    return Object.entries(this.data).map(([name, section]) => ({
      '.name': name,
      ...section,
    }));
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
    triggerValidation() {},
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
          if (this.rmempty || this.optional)
            return Promise.resolve(this.remove(sid));
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
  // A <select> can only hand back one of its own options. LuCI marks an option
  // selected only when it matches the stored value, so a stored value that is not
  // among the choices leaves nothing selected and the browser falls back to the
  // first option - which is then what the save writes. It matters wherever the
  // choices are decided at load time: by which providers are installed, or by
  // which other sections exist.
  const ListValue = Value.extend({
    __name__: 'CBI.ListValue',
    formvalue(sid) {
      const value = this.widgetValue(sid);
      const keys = (this.keylist || []).map((key) => `${key ?? ''}`);
      if (!keys.length) return value == null ? null : value;
      if (keys.includes(`${value ?? ''}`)) return `${value ?? ''}`;
      // An empty choice, or an optional option, puts "-- please choose --" first.
      return this.optional || keys.includes('') ? '' : keys[0];
    },
  });
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
          if (this.rmempty || this.optional)
            return Promise.resolve(this.remove(sid));
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
      return `${this.widgetValue(sid) ?? ''}` === this.enabled
        ? this.enabled
        : this.disabled;
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
            Promise.resolve(child.load(sid)).then((value) =>
              child.cfgvalue(sid, value),
            ),
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
      // The tab order of the page, so a check can see which tabs it declared
      // and in what order without walking the rendered tree.
      CBIMap.declaredSectionTypes.push(section.sectiontype);
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
            const val =
              res && res[0].isActive(res[1]) ? res[0].formvalue(res[1]) : null;
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
  CBIMap.declaredSectionTypes = [];

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

export function createHarness(packageName = 'forkop') {
  // Whatever the page logged while it was being built.
  const messages = [];

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
      return Object.prototype.hasOwnProperty.call(section, opt)
        ? section[opt]
        : null;
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
      // Recorded like any other write: a save that adds a child item the user did
      // not ask for is the same kind of defect as one that deletes an option.
      operations.push(`add ${type} ${sid}`);
      return sid;
    },
    remove(pkg, sid) {
      // And a save that takes a whole section away is the worst of them: the
      // passwords of a server's accounts, the peers of a tunnel, the levels of a
      // fallback group all live in sections of their own.
      if (store.has(sid))
        operations.push(`remove ${store.get(sid)['.type']} ${sid}`);
      store.delete(sid);
    },
    get_first() {
      return null;
    },
    // Everything is already in the store, so loading a package is a no-op that
    // still has to be awaitable: a view that preloads one before building its
    // dialog would otherwise fail on the missing method.
    load() {
      return Promise.resolve();
    },
  };
  const uciData = {
    get: (...args) => uci.get(...args),
    set: (...args) => uci.set(...args),
    unset: (...args) => uci.unset(...args),
    sections: (...args) => uci.sections(...args),
    // LuCI's uci module keeps the loaded package under state.values, and a view
    // may read it straight from there rather than through sections(): the
    // Settings page builds its section dropdowns that way. Without it those
    // dropdowns come up empty in a test and every value looks like it survives.
    get state() {
      const values = {};
      for (const [sid, section] of store) values[sid] = section;
      return { values: { [packageName]: values } };
    },
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
    // The page starts its polling services on the way out of render(), and a
    // hidden tab is how they are told to stand down. Answering "visible" here
    // would leave a wait loop running against stubs for the rest of the test
    // file, which no check is about and every check would have to survive.
    visibilityState: 'hidden',
    querySelector: (selector) =>
      selector === '#modal_overlay > .modal.cbi-modal' ? modal : null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    head: new FakeNode('head'),
    body: new FakeNode('body'),
    documentElement: new FakeNode('html'),
    addEventListener() {},
    removeEventListener() {},
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

  // The alerts the page raised through LuCI, in order.
  const notifications = [];

  // What a forkop command answers, by name; a test replaces one with the
  // answer it is about. The default is the one command a page cannot get
  // through without: the Reality identity a server dialog generates. Answering
  // it keeps a test from reporting the dialog's own failure notice as its output.
  const commands = {
    generate_reality_keypair: () =>
      Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          success: true,
          private_key: 'wIWKZmAoiFsYIPFCwG8FRPHKn0P6PLh0hbBjPfKgpU0',
          public_key: 'SSw7I859PPdN4DQ7fxV9fobXM61Ms3mqZRlIY1aJvHQ',
        }),
      }),
  };

  // What the loader hands every module, main.js included. main.js is loaded
  // with exactly these, so the constants, validators and helpers a view reads
  // out of it are the shipped ones and anything it looks up in uci finds the
  // model this harness is driving rather than a second one.
  const moduleGlobals = {
    form,
    ui: {
      DynamicList: makeClass('ui.DynamicList', function () {}),
      addNotification(title, body, kind) {
        notifications.push({ title, text: body?.textContent ?? '', kind });
      },
    },
    uci,
    fs: {
      read: () => Promise.resolve(''),
      exec: (command, args) => {
        const answer = commands[`${args?.[0] ?? ''}`];
        return answer ? answer(args) : Promise.resolve({});
      },
    },
    network: { getDevices: () => Promise.resolve([]) },
    widgets: { DeviceSelect: form.MultiValue, NetworkSelect: form.MultiValue },
    L,
    E,
    document: documentStub,
    window: {
      crypto: webcrypto,
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      location: {
        hostname: 'router.lan',
        href: 'http://router.lan/',
        protocol: 'http:',
      },
    },
    poll: { add() {}, remove() {} },
    dom: { content() {}, append() {} },
    rpc: { declare: () => () => Promise.resolve({}) },
    // The page narrates what its services are doing, and a check here is about
    // what it wrote rather than what it said. The lines are kept instead of
    // printed, so a failure can still show them.
    console: {
      log: (...args) => messages.push(args.join(' ')),
      info: (...args) => messages.push(args.join(' ')),
      warn: (...args) => messages.push(args.join(' ')),
      error: (...args) => messages.push(args.join(' ')),
    },
  };

  const bundle = loadBundle(moduleGlobals);

  // The bundle as a view sees it. Everything real comes straight from it; the
  // few members listed here are the ones that would otherwise reach out of the
  // process, and a save must not depend on what they answer. The catch-all
  // keeps an unlisted name from throwing.
  const main = new Proxy(
    Object.assign({}, bundle, {
      store: {},
      ForkopShellMethods: new Proxy(
        {},
        { get: () => () => Promise.resolve({}) },
      ),
    }),
    {
      get: (target, prop) =>
        prop in target
          ? target[prop]
          : () => (/^validate/.test(prop) ? { valid: true } : ''),
    },
  );

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
  //
  // save() answers whether the dialog closed. A dialog refuses a save by throwing
  // out of its own onSave - a peer list that is empty, a name another item holds -
  // and the stacked dialog swallows that to keep the modal open, so a refused save
  // is indistinguishable from a clean one by what it wrote: both wrote nothing. A
  // check that only counts writes passes on every dialog it never managed to save.
  async function openDialog(option, ownerId, itemValue, context = {}) {
    return openDialogWith(
      () =>
        option.renderItemSettingsModal(
          ownerId,
          itemValue,
          option,
          null,
          null,
          context,
        ),
      `dialog for ${option.option}`,
    );
  }

  // The buttons a dialog puts in the row, also those it groups in a span.
  const buttonsIn = (nodes) =>
    nodes.flatMap((node) =>
      node instanceof FakeNode
        ? [...(node.attrs.click ? [node] : []), ...buttonsIn(node.childNodes)]
        : [],
    );

  // Opens any dialog, one stacked on an open dialog included, through what the
  // page calls to open it: a button's onclick, say.
  async function openDialogWith(open, label = 'dialog') {
    const buttons = [];
    const originalAppend = buttonRow.append.bind(buttonRow);
    buttonRow.append = (...nodes) => {
      buttons.push(...buttonsIn(nodes));
      return originalAppend(...nodes);
    };
    const first = dialogMaps.length;
    try {
      await open();
    } finally {
      buttonRow.append = originalAppend;
    }
    const saveButton =
      buttons.find((node) =>
        `${node.attrs.class ?? ''}`.includes('cbi-button-positive'),
      ) ?? buttons[buttons.length - 1];
    if (!saveButton) throw new Error(`${label} did not open`);
    // Each open dialog hangs its own title next to the heading and takes it away
    // again when it closes, so the count says whether this one is still up.
    const openTitles = heading.childNodes.length;
    // The heading carries each open dialog's title after the one it is stacked on.
    const title = heading.childNodes[heading.childNodes.length - 1];
    return {
      map: dialogMaps[first],
      title: `${title?.textContent ?? ''}`.replace(/^ » /, ''),
      save: async () => {
        await saveButton.attrs.click();
        return { saved: heading.childNodes.length < openTitles };
      },
    };
  }

  // What the page told the user in a toast, in order.
  const toasts = () =>
    documentStub.body.childNodes
      .filter((node) => node.className === 'toast-container')
      .flatMap((container) =>
        container.childNodes.map((toast) => toast.textContent),
      );

  return {
    bundle: main,
    form,
    uci,
    store,
    operations,
    messages,
    commands,
    notifications,
    openDialog,
    openDialogWith,
    toasts,
  };
}
