// What LuCI hands the bundle, for a test that imports a module directly.
//
// LuCI passes the bundle its dependencies through the "require" prologue, so
// inside the bundle they are globals rather than imports. A module that calls
// one of them while it is being evaluated - rpc.declare() at module scope is the
// usual case - needs it to exist before the first import runs.
//
// Only what a module needs at evaluation time belongs here. Anything a test
// actually exercises it stubs itself, so a new dependency on LuCI stays visible
// instead of quietly resolving against a default that does nothing.
//
// The LuCI globals are declared as `const` in src/luci.d.ts, which is what the
// view code needs and what makes them unassignable by name; they are installed
// through the object instead.
const globals = globalThis as unknown as Record<string, unknown>;

globals._ = (key: string) => key;

globals.rpc = {
  declare: () => () => Promise.resolve([]),
};

// A LuCI class base: something with its own extend(), which the CBI widgets
// subclass while their module is being evaluated. Nothing renders here - a test
// that wants to see a widget render builds its own.
function extendableClass(name: string) {
  function Widget() {}
  (Widget as unknown as { widget: string }).widget = name;
  Widget.prototype = {};
  (Widget as unknown as { extend: unknown }).extend = function extend(
    this: { prototype: object },
    members: object,
  ) {
    function Subclass() {}
    (Subclass as unknown as { widget: string }).widget = name;
    Subclass.prototype = Object.assign(Object.create(this.prototype), members);
    (Subclass as unknown as { extend: unknown }).extend = extend;
    return Subclass;
  };
  return Widget;
}

const classesNamed = (names: string[]) =>
  Object.fromEntries(names.map((name) => [name, extendableClass(name)]));

globals.ui = {
  ...classesNamed(['DynamicList']),
  showModal: () => undefined,
  hideModal: () => undefined,
};

globals.form = classesNamed([
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
]);

// LuCI installs String.prototype.format in luci.js, and the view modules use it
// for messages with placeholders. The tests need the same substitution.
if (typeof (String.prototype as { format?: unknown }).format !== 'function') {
  Object.defineProperty(String.prototype, 'format', {
    value: function format(this: string, ...args: unknown[]): string {
      let index = 0;
      return this.replace(/%[sdq]/g, (match) => {
        const value = args[index];
        index += 1;
        if (match === '%d') {
          return `${Number(value)}`;
        }
        return `${value}`;
      });
    },
    writable: true,
    configurable: true,
  });
}
