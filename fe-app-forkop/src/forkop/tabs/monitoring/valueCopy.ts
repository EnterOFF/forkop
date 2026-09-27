function compactMonitoringText(value: string): string {
  return value
    .replace(/\u2026/g, '')
    .trim()
    .replace(/\s+/g, '');
}

// A value too wide for its cell is cut off with an ellipsis, and selecting what
// shows of it copies all of it: a selection that starts where the value does
// and covers about as much of it as fits in the cell counts as the whole value.
// Anything less copies what was selected.
export function shouldCopyFullMonitoringValue(
  element: HTMLElement,
  selectedText: string,
  fullText: string,
): boolean {
  const selected = selectedText.replace(/\u2026/g, '').trim();
  const full = fullText.trim();

  if (!selected || !full) {
    return false;
  }

  if (selected === full) {
    return true;
  }

  if (element.scrollWidth <= element.clientWidth + 1) {
    return false;
  }

  const compactSelected = compactMonitoringText(selectedText);
  const compactFull = compactMonitoringText(fullText);

  if (!compactFull.startsWith(compactSelected)) {
    return false;
  }

  const visibleChars = Math.floor(
    (element.clientWidth / Math.max(element.scrollWidth, 1)) *
      compactFull.length,
  );

  return compactSelected.length >= Math.max(4, visibleChars - 2);
}
