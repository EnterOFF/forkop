// tests/setup/global-mocks.ts
globalThis._ = (key: string) => key;

// LuCI installs String.prototype.format in luci.js, and the view modules use it for
// messages with placeholders. The tests need the same substitution.
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
