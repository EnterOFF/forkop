// The interface is written in English and translated into Russian by the
// catalogs under luci-app-forkop/po, which `yarn locales` regenerates from the
// built bundle. Two things go wrong there quietly: a string with no entry falls
// back to English in an otherwise Russian page, and an entry no source asks for
// any more is dead weight nobody notices. Both directions are compared against
// every _() call the sources make.
import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { ROOT, SRC } from './lib/paths.js';

const PO = path.join(ROOT, 'luci-app-forkop/po/ru/forkop.po');
const POT = path.join(ROOT, 'luci-app-forkop/po/templates/forkop.pot');
const po = fs.readFileSync(PO, 'utf8');

function unescapePo(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function entries(text) {
  const result = new Map();
  const entryRe =
    /^msgid ((?:"(?:\\.|[^"\\])*"\s*)+)msgstr ((?:"(?:\\.|[^"\\])*"\s*)+)/gm;
  const joined = (parts) =>
    unescapePo(
      [...parts.matchAll(/"((?:\\.|[^"\\])*)"/g)]
        .map((part) => part[1])
        .join(''),
    );
  for (const entry of text.matchAll(entryRe)) {
    const id = joined(entry[1]);
    if (id) result.set(id, joined(entry[2]));
  }
  return result;
}

function sourceFiles(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name !== 'tests') sourceFiles(full, out);
    } else if (/\.(ts|js)$/.test(item.name)) out.push(full);
  }
  return out;
}

// Every string the interface asks the catalog for.
function translatedStrings() {
  const used = new Set();
  const callRe = /_\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([^`]*)`)/g;
  for (const file of sourceFiles(SRC)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(callRe)) {
      used.add(
        unescapePo(match[1] ?? match[2] ?? match[3]).replace(/\\'/g, "'"),
      );
    }
  }
  return used;
}

describe('a catalog', () => {
  it.each([
    ['the ru catalog', PO],
    ['the template', POT],
  ])('%s lists exactly the strings the sources use', (_label, file) => {
    const ids = [...entries(fs.readFileSync(file, 'utf8')).keys()];
    const used = translatedStrings();
    expect(
      ids.filter((id) => !used.has(id)),
      'entries for strings no source asks for',
    ).toEqual([]);
    expect(
      [...used].filter((id) => !ids.includes(id)),
      'strings with no entry',
    ).toEqual([]);
  });

  it('translates every string', () => {
    const untranslated = [...entries(po)]
      .filter(([, translation]) => translation === '')
      .map(([id]) => id);
    expect(untranslated).toEqual([]);
  });

  // LuCI closes every one of its alerts with Dismiss; a Forkop entry for the
  // key would change what all of them say.
  it('leaves Dismiss to LuCI', () => {
    expect(entries(po).has('Dismiss')).toBe(false);
  });
});
