// The source of one LuCI tab, concatenated into a single file with its
// TypeScript syntax erased, and the path to it printed.
//
// Several checks here ask "does the source still say X" - that a field is
// declared before another, that a list writes through a named helper, that a
// placeholder still lists every prefix. A tab used to be one handwritten LuCI
// file, so they read it directly; it is now a directory of TypeScript modules.
//
// Erasing the types rather than reading the modules raw is what keeps those
// checks about code and not about annotations: every character that is not type
// syntax is left exactly where it was, so `function f(a, b) {` reads the same
// whether or not a and b were given types.
//
//     SECTION_TS="$(node "$ROOT_DIR/tests/helpers/tab_source.js" sections)"
//     grep -Fq "$expected" "$SECTION_TS"
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { parse } = require(
  path.join(ROOT, 'fe-app-forkop/node_modules/@babel/parser'),
);

// The directories each tab is built out of, in the order they are read. The
// shared CBI layer comes first because the checks that look for a helper the tab
// calls expect to find its definition above the call.
const TABS = {
  sections: [
    'fe-app-forkop/src/forkop/cbi',
    'fe-app-forkop/src/forkop/tabs/sections',
  ],
  servers: [
    'fe-app-forkop/src/forkop/cbi',
    'fe-app-forkop/src/forkop/tabs/servers',
  ],
  settings: [
    'fe-app-forkop/src/forkop/cbi',
    'fe-app-forkop/src/forkop/tabs/settings',
  ],
  // The page the tabs hang off, which is what the entry view used to be.
  entry: ['fe-app-forkop/src/forkop/entry'],
};

// The spans of a module that exist only for the type checker.
function typeSpans(source) {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript'],
    // A handwritten LuCI view ends in a bare return, and this is asked to erase
    // types from those too - there just are none.
    allowReturnOutsideFunction: true,
    // Without this a parenthesised expression is not a node of its own, and
    // erasing `(a || b) as T` would take the closing bracket with the type.
    createParenthesizedExpressions: true,
  });
  const spans = [];
  const drop = (start, end) => {
    if (end > start) spans.push([start, end]);
  };

  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;

    switch (node.type) {
      // Declarations that carry no runtime code at all.
      case 'TSInterfaceDeclaration':
      case 'TSTypeAliasDeclaration':
      case 'TSDeclareFunction':
      case 'TSModuleDeclaration':
        drop(parent && parent.type === 'ExportNamedDeclaration' ? parent.start : node.start, node.end);
        return;
      // `x: T` and `(a: T)`, plus the `?` that marks an optional parameter.
      case 'TSTypeAnnotation':
        drop(node.start, node.end);
        return;
      case 'TSTypeParameterInstantiation':
      case 'TSTypeParameterDeclaration':
        drop(node.start, node.end);
        return;
      // `value as T` and `value!`.
      case 'TSAsExpression':
      case 'TSNonNullExpression':
        drop(node.expression.end, node.end);
        break;
      // `import type { X } from ...`
      case 'ImportDeclaration':
        if (node.importKind === 'type') {
          drop(node.start, node.end);
          return;
        }
        break;
      default:
        break;
    }

    if (node.optional && node.typeAnnotation) {
      drop(node.typeAnnotation.start - 1, node.typeAnnotation.start);
    }
    // `function (this: T, a)` declares what `this` is; there is no such
    // parameter at run time, so it goes with its comma.
    const params = node.params;
    if (
      Array.isArray(params) &&
      params[0] &&
      params[0].type === 'Identifier' &&
      params[0].name === 'this'
    ) {
      drop(params[0].start, params[1] ? params[1].start : params[0].end);
    }
    // The `export` keyword in front of a declaration the old file did not have.
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      drop(node.start, node.declaration.start);
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value.type === 'string') visit(value, node);
    }
  };

  visit(ast.program, null);
  return spans;
}

function eraseTypes(source) {
  // An exported interface is named by two rules at once, so the spans are
  // merged before anything is cut - deleting overlapping ranges one after the
  // other takes characters that belong to neither.
  const spans = typeSpans(source).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  let out = source;
  for (const [start, end] of merged.reverse()) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function sourceFiles(dir) {
  const found = [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

// Erasing the types leaves the lines wrapped for the width the annotations
// took, so the result is laid out again with the project's own formatter. What
// comes out is the code as it would have been written without types - which is
// what these checks were written against.
const prettier = require(path.join(ROOT, 'fe-app-forkop/node_modules/prettier'));
const prettierConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fe-app-forkop/.prettierrc'), 'utf8'),
);

// doubleQuotes re-delimits every string the formatter can. A check written
// against the handwritten view it replaced compares against double-quoted code,
// and quote style is house formatting, not something those checks are about.
async function reformat(source, doubleQuotes = false) {
  return prettier.format(source, {
    ...prettierConfig,
    parser: 'babel',
    ...(doubleQuotes ? { singleQuote: false } : {}),
  });
}

async function tabSource(root, tab, doubleQuotes = false) {
  const dirs = TABS[tab];
  if (!dirs) {
    throw new Error(`unknown tab: ${tab}`);
  }

  const parts = [];
  for (const dir of dirs) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const name = path.relative(root, file).split(path.sep).join('/');
      parts.push(`// ---- ${name}`);
      parts.push(
        await reformat(eraseTypes(fs.readFileSync(file, 'utf8')), doubleQuotes),
      );
    }
  }
  return parts.join('\n');
}

// One top-level declaration of the tab, by name, taken whole.
//
// The checks that used to cut a region out with `sed -n '/^function a(/,/^function
// b(/p'` were reading a single file, where what followed what was fixed. Asking
// for the declaration by name says what they meant and survives the tab being
// split across modules.
function readDeclaration(source, name) {
  const start = source.search(
    new RegExp(`^(?:async function|function|const|let) ${name}\\b`, 'm'),
  );
  if (start < 0) {
    throw new Error(`${name} is not declared at the top level of the tab`);
  }

  // The declaration ends at the first line that closes it in column zero -
  // `}` for a function, `});` or `];` for a value.
  const rest = source.slice(start);
  const end = rest.search(/\n(?:\}|\}\)|\};|\}\);|\];|\);)\n/);
  if (end < 0) {
    throw new Error(`${name} never ends`);
  }
  return rest.slice(0, rest.indexOf('\n', end + 1) + 1);
}

module.exports = { tabSource, eraseTypes, readDeclaration, reformat };

if (require.main === module) {
  const args = process.argv.slice(2);
  const doubleQuotes = args.includes('--double-quotes');
  const [tab, mode, name] = args.filter((arg) => arg !== '--double-quotes');
  (async () => {
    if (mode === '--file') {
      process.stdout.write(
        await reformat(
          eraseTypes(
            fs.readFileSync(path.join(ROOT, 'fe-app-forkop/src', name), 'utf8'),
          ),
          doubleQuotes,
        ),
      );
      return;
    }

    const source = await tabSource(ROOT, tab, doubleQuotes);
    if (mode === '--decl') {
      process.stdout.write(readDeclaration(source, name));
    } else {
      const target = path.join(
        os.tmpdir(),
        `forkop-tab-${tab}${doubleQuotes ? '-dq' : ''}.js`,
      );
      fs.writeFileSync(target, source);
      process.stdout.write(target);
    }
  })().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exit(1);
  });
}
