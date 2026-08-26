// Whether the page is the tab the user is looking at.
//
// A long poll that keeps running behind a hidden tab costs the router a request
// it has nobody to answer for, so both feeds stop while the page is in the
// background. Outside a browser - a check that loads the bundle - there is no
// document, and the answer is yes, so nothing is skipped for want of one.
export function isDocumentVisible() {
  return (
    typeof document === 'undefined' ||
    !document.visibilityState ||
    document.visibilityState === 'visible'
  );
}
