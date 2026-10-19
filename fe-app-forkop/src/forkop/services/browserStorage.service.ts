// The browser's stores, when there are any. A browser configured to block site
// data throws on the property rather than answering null, and a page rendered
// for a thumbnail has no window at all, so every reader goes through here.
function getStorage(name: 'sessionStorage' | 'localStorage'): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window[name];
  } catch {
    return null;
  }
}

export function getSessionStorage() {
  return getStorage('sessionStorage');
}

export function getLocalStorage() {
  return getStorage('localStorage');
}
