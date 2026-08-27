// Reads literals out of a source file without depending on how it is laid out.
//
// Several tables in this repository are repeated across layers on purpose - a
// browser caches every LuCI view on its own, so a tab cannot import a name from
// another tab - and a contract test is what keeps the copies equal. Matching a
// line shape with a regex ties that test to today's formatting: reflow a list and
// the extraction returns a shorter one, which only fails loudly while the other
// side of the comparison is read by evaluating real code.
//
// So a declaration is found by name, the balanced region after it is taken whole,
// and that region is evaluated. Comments, line breaks, trailing commas, nested
// arrays and a _() call around a label all read the same, and a declaration that
// stopped being a literal raises instead of returning nothing.
const fs = require("fs");

const OPENERS = { "(": ")", "[": "]", "{": "}" };
const CLOSERS = new Set([")", "]", "}"]);

// Strings and comments are what a naive scan trips over: a brace inside a message
// moves the depth, and an apostrophe in a sentence starts a string that never ends.
// Both are stepped over here. Returns the index after the inert run and, for a
// string, its raw contents - or null when nothing inert starts at this index.
function skipInert(source, index) {
  const char = source[index];

  if (char === '"' || char === "'" || char === "`") {
    let cursor = index + 1;
    while (cursor < source.length && source[cursor] !== char) {
      cursor += source[cursor] === "\\" ? 2 : 1;
    }
    return { next: cursor + 1, text: source.slice(index + 1, cursor) };
  }

  if (char === "/" && source[index + 1] === "/") {
    const line = source.indexOf("\n", index);
    return { next: line < 0 ? source.length : line + 1, text: null };
  }

  if (char === "/" && source[index + 1] === "*") {
    const end = source.indexOf("*/", index);
    return { next: end < 0 ? source.length : end + 2, text: null };
  }

  return null;
}

// The bracketed region that starts at this index, up to the bracket that closes it.
function balancedExpression(source, start, name) {
  let depth = 0;
  let index = start;

  while (index < source.length) {
    const inert = skipInert(source, index);
    if (inert) {
      index = inert.next;
      continue;
    }

    const char = source[index];
    if (OPENERS[char]) {
      depth += 1;
    } else if (CLOSERS.has(char)) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
      if (depth < 0) {
        break;
      }
    } else if (depth === 0 && (char === ";" || char === "\n")) {
      break;
    }

    index += 1;
  }

  throw new Error(`${name} is not declared as a bracketed literal`);
}

function readLiteral(source, name) {
  const declaration = new RegExp(
    `(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:const|let|var)[ \\t]+${name}[ \\t]*=[ \\t]*`,
  );
  const matched = declaration.exec(source);
  if (!matched) {
    throw new Error(`${name} is not declared in the source`);
  }

  const expression = balancedExpression(
    source,
    matched.index + matched[0].length,
    name,
  );

  // The tables name UI labels through _(), which a test only needs the text of.
  // eslint-disable-next-line no-new-func
  return new Function("_", `"use strict"; return (${expression});`)(
    (text) => text,
  );
}

// The names a table holds: the entries of an array or a Set, or the keys of an
// object. Every caller wants the same thing out of the three shapes.
function readNameList(source, name) {
  const value = readLiteral(source, name);

  if (value instanceof Set) {
    return [...value];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.keys(value);
  }

  throw new Error(`${name} is not a list, a set or an object`);
}

// The first string of every entry, for a table of pairs such as a port and the
// name of what already binds it.
function readEntryHeads(source, name) {
  return readLiteral(source, name).map((entry) =>
    Array.isArray(entry) ? `${entry[0]}` : `${entry}`,
  );
}

// A whole named function, header and body, for a test that would rather call the
// code than read it. The end comes from balancing the braces of the body, so it does
// not depend on what happens to be declared next - anchoring on the following
// function makes an unrelated edit there look like a missing contract.
function readFunction(source, name) {
  const declaration = new RegExp(
    `(?:^|\\n)[ \\t]*(?:async[ \\t]+)?function[ \\t]+${name}[ \\t]*\\(`,
  );
  const matched = declaration.exec(source);
  if (!matched) {
    throw new Error(`${name} is not declared as a function`);
  }

  const start = matched.index + (source[matched.index] === "\n" ? 1 : 0);
  const paramsStart = source.indexOf("(", matched.index);
  const params = balancedExpression(source, paramsStart, name);
  const bodyStart = source.indexOf("{", paramsStart + params.length);
  if (bodyStart < 0) {
    throw new Error(`${name} has no body`);
  }

  const body = balancedExpression(source, bodyStart, name);
  return source.slice(start, bodyStart + body.length);
}

// Every string the source spells out, wherever it stands. A check that has to
// consider all the values a file names - rather than one table it names them in -
// reads them from here and filters, which no rearrangement of the tables changes.
function readStringLiterals(source) {
  const literals = [];
  let index = 0;

  while (index < source.length) {
    const inert = skipInert(source, index);
    if (!inert) {
      index += 1;
      continue;
    }
    if (inert.text !== null) {
      literals.push(inert.text);
    }
    index = inert.next;
  }

  return literals;
}

function readFile(file) {
  return fs.readFileSync(file, "utf8");
}

module.exports = {
  readLiteral,
  readNameList,
  readEntryHeads,
  readFunction,
  readStringLiterals,
  readFile,
};

if (require.main === module) {
  const [file, name, mode = "names"] = process.argv.slice(2);
  if (!file || !name) {
    process.stderr.write(
      "usage: source_literal.js <file> <declaration> [names|heads]\n",
    );
    process.exit(2);
  }

  try {
    const source = readFile(file);
    const values =
      mode === "heads"
        ? readEntryHeads(source, name)
        : readNameList(source, name);
    process.stdout.write(`${values.join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`${file}: ${error.message}\n`);
    process.exit(1);
  }
}
