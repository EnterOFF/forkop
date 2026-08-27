// The interface is written in English and translated into Russian by the
// catalogs under luci-app-forkop/po. Two things go wrong quietly there: a string
// with no catalog entry falls back to English in an otherwise Russian page, and
// an entry for a string no source asks for any more is dead weight nobody
// notices. Both directions are compared here against every _() call the frontend
// makes.
import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { getRuleEditButtonText } from '../../src/forkop/cbi/grid';
import { FRONTEND, ROOT, SRC, VIEW_DIR } from '../lib/paths.js';
import { tabSource } from '../lib/tabSource.js';

const PO = path.join(ROOT, 'luci-app-forkop/po/ru/forkop.po');
const POT = path.join(ROOT, 'luci-app-forkop/po/templates/forkop.pot');
const po = fs.readFileSync(PO, 'utf8');

/* --------------------------------------------------------- catalog reading */

function unescapePo(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function msgids(text) {
  const ids = [];
  const entryRe = /^msgid ((?:"(?:\\.|[^"\\])*"\s*)+)/gm;
  const partRe = /"((?:\\.|[^"\\])*)"/g;
  for (const entry of text.matchAll(entryRe)) {
    const joined = [...entry[1].matchAll(partRe)]
      .map((part) => part[1])
      .join('');
    if (joined) ids.push(unescapePo(joined));
  }
  return ids;
}

// The translation a catalog gives one msgid, or undefined when it has no entry.
function translationOf(text, msgid) {
  const lines = text.split('\n');
  const wanted = `msgid ${JSON.stringify(msgid)}`;
  const index = lines.indexOf(wanted);
  if (index < 0 || !lines[index + 1]?.startsWith('msgstr ')) return undefined;
  return unescapePo(lines[index + 1].slice('msgstr '.length).slice(1, -1));
}

function sourceFiles(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js)$/.test(item.name)) out.push(full);
  }
  return out;
}

// Every string the interface asks the catalog for. main.js is the generated
// bundle of the frontend sources, so it repeats what they already declare.
function translatedStrings() {
  const views = fs
    .readdirSync(VIEW_DIR)
    .filter((name) => name.endsWith('.js') && name !== 'main.js')
    .map((name) => fs.readFileSync(path.join(VIEW_DIR, name), 'utf8'));
  const frontend = sourceFiles(SRC).map((file) =>
    fs.readFileSync(file, 'utf8'),
  );

  const used = new Set();
  const callRe = /_\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`([^`]*)`)/g;
  for (const match of [...views, ...frontend].join('\n').matchAll(callRe)) {
    used.add(unescapePo(match[1] ?? match[2] ?? match[3]).replace(/\\'/g, "'"));
  }
  return used;
}

/* ---------------------------------------------------------- where they live */

describe('the catalogs', () => {
  it('live only under luci-app-forkop/po', () => {
    expect(fs.existsSync(path.join(FRONTEND, 'locales'))).toBe(false);
  });

  it.each([
    ['ru catalog', PO],
    ['template', POT],
  ])('%s lists exactly the strings the sources use', (_label, file) => {
    const ids = msgids(fs.readFileSync(file, 'utf8'));
    const used = translatedStrings();
    expect(
      ids.filter((id) => !used.has(id)).join('\n'),
      'entries for strings no source asks for',
    ).toBe('');
    expect(
      [...used].filter((id) => !ids.includes(id)).join('\n'),
      'strings with no entry',
    ).toBe('');
  });

  it('leaves no user-facing string untranslated', () => {
    const lines = po.split('\n');
    const untranslated = lines
      .map((line, index) => [line, lines[index + 1]])
      .filter(
        ([line, next]) =>
          line.startsWith('msgid "') &&
          line !== 'msgid ""' &&
          next === 'msgstr ""',
      )
      .map(([line]) => line);
    expect(untranslated).toEqual([]);
  });
});

/* ----------------------------------------------------- what the modals say */

// LuCI's own catalog owns "Dismiss" and closes its alerts with it; overriding
// that key changes what every LuCI alert on the router says.
describe('a Forkop modal', () => {
  // A dialog stacked on another one leaves with its own Back action, which is
  // what the button does there: the nested map comes out and the parent's own
  // buttons go back. Either way the key is ours.
  it('leaves a stacked dialog with its own Back action', async () => {
    expect(await tabSource('sections')).toContain("_('Back')");
  });

  it('does not use the shared LuCI Dismiss key', async () => {
    expect(await tabSource('sections')).not.toContain("_('Dismiss')");
  });

  it('translates Close as Закрыть', () => {
    expect(translationOf(po, 'Close')).toBe('Закрыть');
  });

  it('translates Back as Назад', () => {
    expect(translationOf(po, 'Back')).toBe('Назад');
  });

  it('does not translate Dismiss as Отмена', () => {
    expect(translationOf(po, 'Dismiss')).not.toBe('Отмена');
  });
});

/* -------------------------------------------------- the row action button */

// A row action button has to stay short, and LuCI's own catalog owns "Edit" and
// translates it as "Редактировать", which Forkop cannot override. So the button
// asks for a Forkop msgid and falls back to the English word when the catalog
// returns the msgid unchanged. Both grids show the button, so the helper belongs
// to the shared CBI layer rather than to either tab.
describe('the row action label', () => {
  const withTranslation = (answer, run) => {
    const globals = globalThis;
    const original = globals._;
    globals._ = answer;
    try {
      return run();
    } finally {
      globals._ = original;
    }
  };

  it('falls back to Edit when the catalog has no answer', () => {
    expect(withTranslation((key) => key, getRuleEditButtonText)).toBe('Edit');
  });

  it('uses the translation when the catalog has one', () => {
    expect(withTranslation(() => 'Изменить', getRuleEditButtonText)).toBe(
      'Изменить',
    );
  });

  it('stays the short Изменить in the Russian catalog', () => {
    expect(translationOf(po, 'Edit rule action')).toBe('Изменить');
  });

  it('is not defined a second time for the page', async () => {
    expect(await tabSource('entry')).not.toContain(
      'function getRuleEditButtonText',
    );
  });

  it('is what the Sections grid shows', async () => {
    expect(await tabSource('entry')).toContain('getRuleEditButtonText()');
  });
});

/* -------------------------------------------------------- the help texts */

describe('the Connection URL help', () => {
  it('summarizes the supported proxy URI types', async () => {
    expect(await tabSource('sections')).toContain(
      'Supported URIs: vless, vmess, shadowsocks, trojan, socks, http, tuic, hysteria, naiveproxy, mieru, anytls',
    );
  });

  it('starts with examples', async () => {
    expect(await tabSource('sections')).not.toContain('Native sing-box links:');
  });

  it.each([
    ['the sections tab', () => tabSource('sections')],
    ['the ru catalog', () => po],
    ['the template', () => fs.readFileSync(POT, 'utf8')],
  ])(
    'no longer advertises removed HTTP proxy links in %s',
    async (_label, read) => {
      expect(await read()).not.toContain('http(s)://, hy2/hysteria2:// links');
    },
  );
});

describe('the section fields', () => {
  it('say what the action applies to', async () => {
    expect(await tabSource('sections')).toContain(
      "What to do when this section's conditions match",
    );
  });

  it('leave the name without a redundant description', async () => {
    expect(await tabSource('sections')).not.toContain(
      'Visible name of this section',
    );
  });
});

// An empty grid keeps LuCI's own placeholder row, so the text goes inside the
// cell LuCI already made rather than replacing the row with one of ours.
it('the empty sections text preserves the LuCI table cell', async () => {
  expect(await tabSource('entry')).toContain(
    "querySelector?.('.placeholder em')",
  );
});
