// A LuCI view is one big function the browser evaluates, so a name that no
// longer exists is not a load error - it throws the first time the line runs.
// That is how a removed helper survived in two save handlers: every attempt to
// save a section threw ReferenceError inside handleModalSave, which is a
// synchronous throw, so the Save button spun forever and nothing said why.
//
// no-undef answers the question the browser answers too late: which identifiers
// a file reads and never defines. The globals a view gets are its own - the
// require prologue names them - plus the ones LuCI and the browser provide.
import fs from 'fs';
import path from 'path';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { VIEW_DIR } from '../lib/paths.js';

// What a LuCI view may reach without declaring it: the page globals, the
// translation helpers LuCI installs, and the element builder.
const PROVIDED = [
  'window',
  'document',
  'location',
  'navigator',
  'history',
  'screen',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'queueMicrotask',
  'console',
  'fetch',
  'URL',
  'URLSearchParams',
  'Blob',
  'File',
  'FileReader',
  'FormData',
  'Headers',
  'Request',
  'Response',
  'AbortController',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
  'TextEncoder',
  'TextDecoder',
  'WebSocket',
  'Worker',
  'getComputedStyle',
  'matchMedia',
  'atob',
  'btoa',
  'HTMLElement',
  'DecompressionStream',
  'CompressionStream',
  'escape',
  'unescape',
  'alert',
  'confirm',
  'prompt',
  'localStorage',
  'sessionStorage',
  'crypto',
  'performance',
  'structuredClone',
  'Image',
  'L',
  'E',
  '_',
  'N_',
  'cbi_update_table',
  'XHR',
];

const REQUIRE_LINE = /^"require ([A-Za-z0-9_.]+)(?: as ([A-Za-z0-9_]+))?";$/gm;

const views = fs.readdirSync(VIEW_DIR).filter((name) => name.endsWith('.js'));

describe.each(views)('%s', (name) => {
  it('reads no name nothing defines', () => {
    const source = fs.readFileSync(path.join(VIEW_DIR, name), 'utf8');
    // The require prologue is what LuCI passes the factory as arguments.
    const injected = [...source.matchAll(REQUIRE_LINE)].map(
      (match) => match[2] || match[1],
    );

    const messages = new Linter().verify(
      // A view is the body of a function, so its trailing return is wrapped away.
      `(function () {\n${source}\n});\n`,
      {
        languageOptions: {
          ecmaVersion: 2023,
          sourceType: 'script',
          globals: Object.fromEntries(
            [...PROVIDED, ...injected].map((global) => [global, 'readonly']),
          ),
        },
        linterOptions: { reportUnusedDisableDirectives: false },
        rules: { 'no-undef': 'error' },
      },
      name,
    );

    expect(
      messages
        .map((message) => `${message.line}: ${message.message}`)
        .join('\n'),
    ).toBe('');
  });
});

it('finds the built views at all', () => {
  expect(views).not.toEqual([]);
});
