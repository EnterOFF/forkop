// The LuCI runtime a test needs, as stubs it can install.
//
// The tabs are TypeScript modules inside the bundle now, so a test imports the
// function it is about directly. What it cannot import is LuCI: a module inside
// the bundle takes uci, dom, document and E off the globals the "require"
// prologue fills in, so a test that drives one has to answer as LuCI would.

import { webcrypto } from 'node:crypto';

// Installs a uci model as the global the bundle reads. A module inside the
// bundle takes uci from LuCI rather than importing it, so a test that drives one
// puts its model where the module looks.
export function installUciStub(sections = {}) {
  const stub = createUciStub(sections);
  globalThis.uci = stub;
  return stub;
}

// The whole LuCI runtime a bundled module reaches for, installed as globals:
// the same stubs a handwritten view is loaded against, only put where the bundle
// looks instead of passed in. A module inside the bundle takes uci, dom,
// document and E off LuCI rather than importing them, so a test that drives one
// has to answer as LuCI would.
//
// The widgets are the mounted frames document.getElementById() finds, keyed by
// the cbid each carries.
export function installLuciStubs(sections = {}, widgets = {}) {
  const uci = createUciStub(sections);

  for (const [name, value] of Object.entries(defaultStubs(uci, widgets))) {
    globalThis[name] = value;
  }

  return uci;
}

// A UCI model shaped like the one LuCI keeps in the browser: sections keyed by
// name, each carrying .name and .type, with list options stored as arrays.
function createUciStub(sections = {}) {
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
  const noop = () => {};
  const options = [];

  const section = {
    options,
    option(widget, name, title, description) {
      // Built on the widget's own prototype, so an option answers with whatever
      // that widget class provides on top of what the tab sets here - the child
      // item list gets most of its behaviour that way.
      const option = Object.assign(Object.create(widget?.prototype ?? null), {
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
      });
      options.push(option);
      return option;
    },
    // A tab is a heading over a group of options; nothing here renders one, and
    // the options land in one list either way.
    tab: noop,
    taboption(_tab, ...args) {
      return section.option(...args);
    },
  };

  return section;
}
