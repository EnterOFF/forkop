// The name a new entry is offered: "<prefix> #N", N one past the highest number
// a taken name under that prefix carries. A count of the entries would offer a
// name still in use once an earlier entry had been removed, and the dialog would
// refuse its own suggestion.
export function nextNumberedName(prefix: string, taken: string[]) {
  const marker = `${prefix} #`;
  const highest = Math.max(
    0,
    ...taken.map((name) => {
      const label = `${name}`.trim();
      const digits = label.slice(marker.length);
      return label.startsWith(marker) && /^\d+$/.test(digits)
        ? Number(digits)
        : 0;
    }),
  );
  return `${marker}${highest + 1}`;
}
