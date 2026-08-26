// The LuCI runtime a test needs, as stubs it can install.
//
// The tabs are TypeScript modules inside the bundle now, so a test imports the
// function it is about directly. What it cannot import is LuCI: a module inside
// the bundle takes uci, dom, document and E off the globals the "require"
// prologue fills in, so a test that drives one has to answer as LuCI would.

import { webcrypto } from 'node:crypto';

import {
  addAnnotationIssue,
  finalizeAnnotations,
  getDuplicateValueText,
  getValidationHeaderText,
} from '../../forkop/cbi/annotations';
import {
  SYSTEM_DEVICE_VALUE,
  createLocalDeviceDynamicListWidget,
  normalizeOptionValues,
} from '../../forkop/cbi/localDevices';
import { ButtonAddSettingsDynamicList } from '../../forkop/cbi/dynamicList';
import {
  addDynamicListItem,
  updateDynamicListItemLabel,
  validateUniqueDynamicListItemName,
} from '../../forkop/cbi/listItems';
import {
  childItemInputValue,
  cleanupRemovedChildItems,
  isExistingChildItem,
} from '../../forkop/cbi/childItems';
import { childPendingSettingsStore } from '../../forkop/cbi/itemSettings';
import {
  SINGLE_FIELD_MODAL_CLASS,
  ensureSingleFieldModalStyles,
  showChildItemSettingsModal,
} from '../../forkop/cbi/modal';
import { configureTextareaOption } from '../../forkop/cbi/annotatedTextarea';
import { keepUnavailableSectionChoice } from '../../forkop/cbi/choices';
import {
  GRID_KIND_COLUMN_WIDTH,
  GRID_SWITCH_COLUMN_WIDTH,
} from '../../forkop/cbi/constants';
import { validateDomain } from '../../validators/validateDomain';
import { validateOutboundJson } from '../../validators/validateOutboundJson';
import { validateSubnet } from '../../validators/validateSubnet';

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
    // What a view still outside the bundle reaches for. The helpers here are the
    // shipped ones, imported straight from src - a view reaching one of them in a
    // test sees exactly what the browser would.
    main: {
      FORKOP_UCI_PACKAGE: 'forkop',
      showToast: noop,
      validatePath: (value) => ({
        valid: /^\/[A-Za-z0-9_./-]+$/.test(`${value}`),
      }),
      validateDomain,
      validateOutboundJson,
      validateSubnet,
      addAnnotationIssue,
      finalizeAnnotations,
      getDuplicateValueText,
      getValidationHeaderText,
      SYSTEM_DEVICE_VALUE,
      createLocalDeviceDynamicListWidget,
      normalizeOptionValues,
      // The shared CBI layer. The Servers and Settings views reach it through
      // the bundle now, so these are the shipped implementations rather than
      // stand-ins for them.
      GRID_KIND_COLUMN_WIDTH,
      GRID_SWITCH_COLUMN_WIDTH,
      SINGLE_FIELD_MODAL_CLASS,
      ButtonAddSettingsDynamicList,
      addDynamicListItem,
      updateDynamicListItemLabel,
      validateUniqueDynamicListItemName,
      childItemInputValue,
      cleanupRemovedChildItems,
      isExistingChildItem,
      childPendingSettingsStore,
      ensureSingleFieldModalStyles,
      showChildItemSettingsModal,
      configureTextareaOption,
      keepUnavailableSectionChoice,
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
