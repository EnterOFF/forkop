// The session store, when there is one. A browser configured to block site
// data throws on the property rather than answering null, and a page rendered
// for a thumbnail has no window at all, so every reader goes through here.
export function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
