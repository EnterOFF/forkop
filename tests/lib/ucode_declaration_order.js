// ucode compiles a name that is not a local binding yet as a global lookup, so a
// function may only call helpers and use bindings that are declared earlier in the
// same file. Calling one that is declared later fails at run time with "left-hand
// side is not a function", and only on the branch that reaches the call.
const fs = require("fs");
const path = require("path");

const BUILTINS = new Set([
  "abs", "assert", "b64dec", "b64enc", "call", "catch", "chr", "clock", "const",
  "delete", "die", "exists", "exit", "filter", "for", "function", "gc", "getenv",
  "gmtime", "hex", "hexdec", "hexenc", "if", "in", "index", "int", "join", "json",
  "keys", "length", "let", "loadstring", "localtime", "lc", "ltrim", "map", "match",
  "max", "min", "ord", "pop", "print", "printf", "push", "regexp", "render",
  "replace", "require", "return", "reverse", "rindex", "rtrim", "shift", "signal",
  "slice", "sleep", "sort", "sourcepath", "split", "sprintf", "substr", "switch",
  "system", "time", "timegm", "timelocal", "trim", "try", "uc", "uchr", "uniq",
  "unshift", "values", "warn", "while", "wildcard",
]);

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(full));
    } else if (entry.name.endsWith(".uc")) {
      result.push(full);
    }
  }
  return result;
}

const root = process.argv[2];
const problems = [];

for (const file of walk(root)) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const declared = new Map();
  const functions = [];

  lines.forEach((line, index) => {
    const declaration = line.match(/^function ([A-Za-z_][A-Za-z0-9_]*)\(/);
    if (declaration) {
      if (!declared.has(declaration[1])) declared.set(declaration[1], index);
      functions.push({ name: declaration[1], start: index });
      return;
    }
    const binding = line.match(/^(?:let|const) ([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (binding && !declared.has(binding[1])) declared.set(binding[1], index);
  });

  functions.forEach((fn, position) => {
    const end =
      position + 1 < functions.length ? functions[position + 1].start : lines.length;
    for (let i = fn.start; i < end; i += 1) {
      // A member call resolves on the object, so only bare calls are checked.
      for (const call of lines[i].matchAll(
        /(?:^|[^.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
      )) {
        const name = call[1];
        if (BUILTINS.has(name) || !declared.has(name)) continue;
        if (declared.get(name) > fn.start) {
          problems.push(
            `${path.relative(root, file).replaceAll("\\", "/")}:${i + 1}: ${fn.name}() uses ${name}() declared later at line ${declared.get(name) + 1}`,
          );
        }
      }
    }
  });
}

if (problems.length) {
  console.error("FAIL: ucode helpers used before their declaration:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

process.stdout.write(`ucode declaration order checked\n`);
