const mountNodes = new Map<string, HTMLElement>();

/**
 * The node a tab's controller is bound to, kept across renders of the form it
 * lives in.
 *
 * LuCI rebuilds a whole `form.Map` whenever a section is added, removed or
 * edited - `map.save()` ends in `renderContents()`, which empties the map and
 * asks every option for its value again. The controller stays bound to the node
 * it mounted, so the form is handed that same node again and moves it back into
 * place, with the scroll position, the search text and everything else the user
 * had put there.
 */
export function mountTab(
  key: string,
  render: () => HTMLElement,
  initController: () => unknown,
): HTMLElement {
  let node = mountNodes.get(key);

  if (!node) {
    node = render();
    mountNodes.set(key, node);
  }

  // The form is mid-render and the node is already the one it will show, so a
  // controller that cannot start must not take the render down with it: the tab
  // keeps whatever it last had instead of the whole page losing its content.
  const report = (error: unknown) =>
    console.error(`[TABS] Failed to start the ${key} controller`, error);
  try {
    Promise.resolve(initController()).catch(report);
  } catch (error) {
    report(error);
  }

  return node;
}

/** Test seam: drops the remembered nodes so each case mounts its own. */
export function resetMountedTabs(): void {
  mountNodes.clear();
}

/**
 * The one option a mounted tab declares: a DummyValue whose value is the node
 * the tab's controller is bound to.
 *
 * Every tab that renders itself rather than declaring CBI options is added to
 * the page this way, so the form has something to lay out and the controller
 * has somewhere to write.
 */
export function mountTabOption(
  section: CBISection,
  key: string,
  tab: { render: () => HTMLElement; initController: () => unknown },
): void {
  const o = section.option(form.DummyValue, '_mount_node');
  o.rawhtml = true;
  o.cfgvalue = () => mountTab(key, tab.render, tab.initController);
}
