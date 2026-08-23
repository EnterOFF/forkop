const mountNodes = new Map<string, HTMLElement>();

/**
 * The node a tab's controller is bound to, kept across renders of the form it
 * lives in.
 *
 * LuCI rebuilds a whole `form.Map` whenever a section is added, removed or
 * edited - `map.save()` ends in `renderContents()`, which empties the map and
 * asks every option for its value again. A tab that returned a freshly rendered
 * tree there handed the form a new set of elements while its controller stayed
 * bound to the ones it had already mounted: listeners, timers and cached data
 * all kept writing into a tree no longer on the page, and the new one kept the
 * placeholder it was rendered with. The logs pane showed "Loading logs" from the
 * first edit until the page was reloaded.
 *
 * Returning the same node instead lets the form move it back into place, which
 * is all it needs, and the controller keeps working - along with the scroll
 * position, the search text and everything else the user had put there.
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
  try {
    void initController();
  } catch (error) {
    console.error(`[TABS] Failed to start the ${key} controller`, error);
  }

  return node;
}

/** Test seam: drops the remembered nodes so each case mounts its own. */
export function resetMountedTabs(): void {
  mountNodes.clear();
}
