// The shipped LuCI bundle, evaluated outside a browser.
//
// luci-app-forkop/htdocs/.../view/forkop/main.js is what the frontend build
// produces, and it is a LuCI module like any other: a "require" prologue naming
// its dependencies and a `return baseclass.extend({...})` at the end. A test
// that wants to exercise the page as the router loads it takes it from here; a
// test about one module imports that module from src instead.
//
// What the bundle needs on top of LuCI is a browser: the tab service starts
// watching the DOM while the module is being evaluated. The stubs below exist to
// get past that, not to simulate anything; a caller that cares about one of them
// passes its own.
//
//     import { loadBundle } from '../lib/bundle.js';
//     const main = loadBundle();
//     main.createSectionContent(section);
//
//     loadBundle({ uci: myUciModel })   // read through a model of mine
import { webcrypto } from 'crypto';
import { createLoader } from './luciModule.js';
import { VIEW_DIR } from './paths.js';

function fakeNode() {
  const noop = () => {};
  return {
    appendChild: noop,
    removeChild: noop,
    setAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    replaceChildren: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: { setProperty: noop },
    dataset: {},
  };
}

// A LuCI class base: something with its own extend(), which the CBI widgets in
// the bundle subclass while the module is being evaluated. Nothing renders here.
function extendableClass(name) {
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

const classesNamed = (names) =>
  Object.fromEntries(names.map((name) => [name, extendableClass(name)]));

// Enough of LuCI and of a browser for the bundle to finish evaluating. Every one
// of these answers harmlessly: a test that depends on an answer overrides it.
function defaultGlobals() {
  const noop = () => {};
  return {
    form: classesNamed([
      'Button',
      'DummyValue',
      'DynamicList',
      'Flag',
      'GridSection',
      'JSONMap',
      'ListValue',
      'Map',
      'MultiValue',
      'NamedSection',
      'TableSection',
      'TextValue',
      'TypedSection',
      'Value',
    ]),
    fs: {
      read: () => Promise.resolve(''),
      exec: () => Promise.resolve({ code: 0, stdout: '' }),
    },
    rpc: { declare: () => () => Promise.resolve({}) },
    uci: {
      load: () => Promise.resolve([]),
      get: () => null,
      get_all: () => null,
      sections: () => [],
      set: noop,
      unset: noop,
    },
    ui: {
      ...classesNamed([
        'Dropdown',
        'DynamicList',
        'Select',
        'Textarea',
        'Textfield',
      ]),
      showModal: noop,
      hideModal: noop,
      addNotification: noop,
    },
    dom: { append: noop, content: noop, findClassInstance: () => null },
    network: { getDevices: () => Promise.resolve([]) },
    E: () => fakeNode(),
    L: {
      toArray: (value) =>
        value == null ? [] : Array.isArray(value) ? value : [value],
      bind: (fn, self, ...bound) => fn.bind(self, ...bound),
      resource: (...parts) => parts.join('/'),
      error: (kind, message) => {
        throw new Error(`${kind}: ${message}`);
      },
    },
    document: Object.assign(fakeNode(), {
      getElementById: () => null,
      createElement: () => fakeNode(),
      createElementNS: () => fakeNode(),
      head: fakeNode(),
      body: fakeNode(),
      documentElement: fakeNode(),
    }),
    window: {
      crypto: webcrypto,
      location: {
        hostname: 'router.lan',
        href: 'http://router.lan/',
        protocol: 'http:',
      },
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: noop,
      setTimeout,
      clearTimeout,
    },
    // The tab service observes the DOM as the bundle is evaluated.
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
}

export function loadBundle(globals = {}) {
  return createLoader(
    VIEW_DIR,
    Object.assign(defaultGlobals(), globals),
  )('main');
}
