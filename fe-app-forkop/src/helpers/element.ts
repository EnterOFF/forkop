// LuCI's E() takes a lone string child as markup and hands it to innerHTML,
// while the same string inside an array becomes text. The strings the tabs put
// on the page are values - a node name from a subscription, a log line, a
// domain a client asked for - so here a lone string is text too.
//
// The name E is left free in this module, so the call below reaches LuCI's.
function element(...args: unknown[]) {
  if (
    args.length >= 3 &&
    (typeof args[2] === 'string' || typeof args[2] === 'number')
  ) {
    args[2] = [String(args[2])];
  }
  return (E as unknown as (...args: unknown[]) => HTMLElement)(...args);
}

const textE = element as unknown as typeof E;

export { textE as E };
