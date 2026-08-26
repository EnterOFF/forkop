#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const legacyStem = String.fromCharCode(112, 111, 100, 107, 111, 112);
const legacyAppDir = `luci-app-${legacyStem}-plus`;

function usage() {
  console.error("Usage: config_contract_matrix.js --current <repo> --stable <repo> [--check]");
  process.exit(2);
}

function parseArgs(argv) {
  const args = { check: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") {
      args.check = true;
    } else if (arg === "--current" || arg === "--stable") {
      if (!argv[i + 1]) usage();
      args[arg.slice(2)] = path.resolve(argv[++i]);
    } else {
      usage();
    }
  }
  if (!args.current || !args.stable) usage();
  return args;
}

function gitDescribe(repo) {
  const result = spawnSync("git", ["describe", "--tags", "--always", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();

  const fallback = path.basename(repo).match(/[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9]+)?/);
  return fallback ? fallback[0] : "";
}

function readFileIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "sandbox") continue;
      walkFiles(full, result);
    } else {
      result.push(full);
    }
  }
  return result;
}

function ensure(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      name: key,
      ui: [],
      backend: [],
      defaults: [],
      examples: [],
      migrations: [],
    });
  }
  return map.get(key);
}

function addUnique(array, value) {
  if (value && !array.includes(value)) array.push(value);
}

function rel(repo, file) {
  return path.relative(repo, file).replace(/\\/g, "/");
}

function extractBraceBody(data, marker) {
  const markerIndex = data.indexOf(marker);
  if (markerIndex < 0) return "";

  const start = data.indexOf("{", markerIndex);
  if (start < 0) return "";

  let depth = 0;
  for (let i = start; i < data.length; i++) {
    const char = data[i];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return data.slice(start + 1, i);
    }
  }

  return "";
}

function extractObjectKeys(data, constName) {
  const body = extractBraceBody(data, `const ${constName}`);
  return [...body.matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map((match) => match[1]);
}

function extractFunctionFirstStringArgs(data, functionName, callName) {
  const body = extractBraceBody(data, `function ${functionName}`);
  const pattern = new RegExp(`${callName}\\(\\s*["']([^"']*)["']`, "g");
  return [...body.matchAll(pattern)].map((match) => match[1]);
}

function extractFunctionSecondStringArgs(data, functionName, callName) {
  const body = extractBraceBody(data, `function ${functionName}`);
  const pattern = new RegExp(`${callName}\\(\\s*[^,]+,\\s*["']([^"']*)["']`, "g");
  return [...body.matchAll(pattern)].map((match) => match[1]);
}

// The server form reads its choice lists from tables and from inline arrays, so the
// values are collected from those instead of from literal o.value() calls.
//
// A tab that lives in the bundle has its top level rewritten to var, so a table
// is looked for under either keyword.
function extractBracketedBlock(data, name) {
  for (const declaration of [`const ${name} = [`, `var ${name} = [`]) {
    const start = data.indexOf(declaration);
    if (start < 0) continue;
    const end = data.indexOf("\n];", start);
    if (end >= 0) return data.slice(start, end);
  }
  return "";
}

function extractSpecValues(specData, name, pattern) {
  const block = extractBracketedBlock(specData, name);
  return block ? [...block.matchAll(pattern)].map((match) => match[1]) : [];
}

// [ "a", "b" ].forEach((value) => o.value(value, value)) and the same shape with a
// destructured pair.
function extractInlineArrayValues(block) {
  const result = [];
  const pattern = /\[([^\]]*)\]\s*\.forEach\(\s*\(?\s*(?:\[[^\]]*\]|[A-Za-z0-9_]+)\s*\)?\s*=>\s*o(?:ption)?\.value\(/g;
  for (const match of block.matchAll(pattern)) {
    for (const literal of match[1].matchAll(/["']([^"']+)["']/g)) {
      result.push(literal[1]);
    }
  }
  return result;
}

function enrichUiValues(fileData, option, block, values, specData) {
  // callName is a regex: a tab that lives in the bundle now has its locals
  // renamed when two modules name one the same, so option.value() reads as
  // option2.value() in the generated file and the pattern allows the suffix.
  if (option === "action" && block.includes("populateActionOptionValues(")) {
    for (const value of extractFunctionFirstStringArgs(fileData, "populateActionOptionValues", "option\\d*\\.value"))
      addUnique(values, value);
  }

  if (option === "protocol" && block.includes("populateProtocolValues(")) {
    for (const constName of ["PROTOCOL_LABELS", "TAILSCALE_PROTOCOL_LABELS", "BASE_PROTOCOL_LABELS", "EXTENDED_PROTOCOL_LABELS", "CUSTOM_PROTOCOL_LABELS"]) {
      for (const value of extractObjectKeys(fileData, constName))
        addUnique(values, value);
    }
  }

  if (option === "transport" && block.includes("populateTransportValues(")) {
    for (const value of extractFunctionSecondStringArgs(fileData, "populateTransportValues", "addOptionValue"))
      addUnique(values, value);
  }

  for (const value of extractInlineArrayValues(block)) addUnique(values, value);

  const tables = specData || fileData;
  if (!tables) return;

  if (block.includes("PROTOCOLS.forEach") || block.includes("protocolIds()")) {
    for (const value of extractSpecValues(tables, "PROTOCOLS", /^\s*id:\s*\"([A-Za-z0-9_]+)\"/gm))
      addUnique(values, value);
  }

  if (block.includes("TRANSPORTS.forEach") || block.includes("transportChoices()")) {
    for (const value of extractSpecValues(tables, "TRANSPORTS", /^\s*\[\"([A-Za-z0-9_-]+)\",/gm))
      addUnique(values, value);
  }

  if (block.includes("SHADOWSOCKS_METHODS.forEach") || block.includes("shadowsocksMethods()")) {
    for (const value of extractSpecValues(tables, "SHADOWSOCKS_METHODS", /^\s*\{\s*id:\s*\"([^\"]+)\"/gm))
      addUnique(values, value);
  }

  if (block.includes("CLIENT_FINGERPRINTS.forEach") || block.includes("clientFingerprints()")) {
    for (const value of extractSpecValues(tables, "CLIENT_FINGERPRINTS", /^\s*\"([A-Za-z0-9_-]+)\",?/gm))
      addUnique(values, value);
  }
}

function extractUi(repo, fields) {
  const currentViewDir = path.join(
    repo,
    "luci-app-forkop",
    "htdocs",
    "luci-static",
    "resources",
    "view",
    "forkop",
  );
  const legacyViewDir = path.join(repo, legacyAppDir, "htdocs", "luci-static", "resources", "view", legacyStem);
  const viewDir = fs.existsSync(currentViewDir) ? currentViewDir : legacyViewDir;
  const files = walkFiles(viewDir).filter((file) => file.endsWith(".js"));
  // Older releases kept the server tables in their own module.
  const specData = readFileIfExists(path.join(viewDir, "server_spec.js")) || null;

  for (const file of files) {
    const data = readFileIfExists(file);
    const optionRe = /\.(option|taboption)\(\s*(?:(["'])[^"']+\2\s*,\s*)?([^,\n]+)\s*,\s*["']([^"']+)["']/g;
    const matches = [...data.matchAll(optionRe)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const option = match[4];
      const start = match.index;
      const end = i + 1 < matches.length ? matches[i + 1].index : data.length;
      const block = data.slice(start, end);
      const field = ensure(fields, option);
      const type = match[3].trim().replace(/\s+/g, " ");
      const defaults = [...block.matchAll(/\bo\.default\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]);
      const values = [...block.matchAll(/\bo\.value\(\s*["']([^"']*)["']/g)].map((m) => m[1]);
      enrichUiValues(data, option, block, values, specData);
      addUnique(
        field.ui,
        JSON.stringify({
          file: rel(repo, file),
          type,
          default: defaults[0] || "",
          values: values.sort(),
        }),
      );
    }

  }
}

function extractConfigDefaults(repo, fields) {
  const currentFile = path.join(repo, "forkop", "files", "etc", "config", "forkop");
  const legacyFile = path.join(repo, legacyStem, "files", "etc", "config", legacyStem);
  const file = fs.existsSync(currentFile) ? currentFile : legacyFile;
  const data = readFileIfExists(file);
  for (const line of data.split(/\n/)) {
    const match = line.match(/^\s*(#\s*)?(option|list)\s+([A-Za-z0-9_]+)\s+['"]?([^'"]*)/);
    if (!match) continue;
    const field = ensure(fields, match[3]);
    const item = `${rel(repo, file)}:${match[2]}:${match[4]}`;
    addUnique(match[1] ? field.examples : field.defaults, item);
  }
}

function extractBackend(repo, fields) {
  const backendRoot = fs.existsSync(path.join(repo, "forkop")) ? "forkop" : legacyStem;
  const roots = [
    path.join(repo, backendRoot, "files", "usr", "lib"),
    path.join(repo, backendRoot, "files", "usr", "bin"),
    path.join(repo, backendRoot, "files", "etc", "init.d"),
  ];
  const files = roots
    .flatMap((root) => walkFiles(root))
    .filter((file) => /\.(sh|uc)$/.test(file) || ["forkop", legacyStem].includes(path.basename(file)));
  const installer = path.join(repo, "install.sh");
  if (fs.existsSync(installer)) files.push(installer);

  const shellOptionRe = /\bconfig_(?:get|get_bool|list_foreach)\s+\S+\s+(?:"[^"]+"|'[^']+'|\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\})\s+["']([A-Za-z0-9_]+)["']/g;
  const ucodeOptionRe = /\b(?:option|list_option|bool_option|int_option)\(\s*[^,\n]+,\s*["']([A-Za-z0-9_]+)["']/g;
  const ucodeStaticOptionKeyArrayRe = /^\s*\[\s*["']([A-Za-z0-9_]+)["']\s*,/gm;
  const migrationRe = new RegExp(`\\b(?:forkop|${legacyStem})_uci_(?:set_option|set_option_if_missing|delete_option|add_list_unique)\\s+["'$A-Za-z0-9_{}.-]+\\s+["']([A-Za-z0-9_]+)["']`, "g");
  const ucodeMigrationRe = /\b(?:set_option|set_option_if_missing|delete_option|add_list_unique)\(\s*[^,\n]+,\s*[^,\n]+,\s*["']([A-Za-z0-9_]+)["']/g;
  // A migration that drops a whole list of options names them in a constant and
  // loops, so the option never appears as a literal argument. The constant is the
  // declaration, so it counts as the migration that retires those fields.
  const ucodeRemovedOptionListRe = /const REMOVED_[A-Z_]+ = \[([^\]]*)\]/g;
  const quotedNameRe = /["']([A-Za-z0-9_]+)["']/g;

  for (const file of files) {
    const data = readFileIfExists(file);
    const backendScanData = data.replace(/\\"/g, '"');
    for (const match of backendScanData.matchAll(shellOptionRe)) {
      addUnique(ensure(fields, match[1]).backend, rel(repo, file));
    }
    for (const match of backendScanData.matchAll(ucodeOptionRe)) {
      addUnique(ensure(fields, match[1]).backend, rel(repo, file));
    }
    if (backendScanData.includes("option(server, field[0]")) {
      for (const match of backendScanData.matchAll(ucodeStaticOptionKeyArrayRe)) {
        addUnique(ensure(fields, match[1]).backend, rel(repo, file));
      }
    }
    for (const match of backendScanData.matchAll(migrationRe)) {
      addUnique(ensure(fields, match[1]).migrations, rel(repo, file));
    }
    for (const match of backendScanData.matchAll(ucodeMigrationRe)) {
      addUnique(ensure(fields, match[1]).migrations, rel(repo, file));
    }
    for (const match of backendScanData.matchAll(ucodeRemovedOptionListRe)) {
      for (const name of match[1].matchAll(quotedNameRe)) {
        addUnique(ensure(fields, name[1]).migrations, rel(repo, file));
      }
    }
  }
}

function extractRepo(repo) {
  const fields = new Map();
  extractUi(repo, fields);
  extractConfigDefaults(repo, fields);
  extractBackend(repo, fields);
  return fields;
}

function publicPresence(field) {
  return field && (field.ui.length || field.backend.length || field.defaults.length || field.examples.length || field.migrations.length);
}

function compactField(field) {
  if (!field) return null;
  return {
    ui: field.ui.map((item) => JSON.parse(item)).sort((a, b) => a.file.localeCompare(b.file) || a.type.localeCompare(b.type)),
    backend: field.backend.slice().sort(),
    defaults: field.defaults.slice().sort(),
    examples: field.examples.slice().sort(),
    migrations: field.migrations.slice().sort(),
  };
}

function classify(stable, current) {
  if (publicPresence(stable) && publicPresence(current)) return "supported";
  if (publicPresence(stable) && current && current.migrations.length) return "migrated";
  if (publicPresence(stable)) return "missing_current";
  return "added_current";
}

function buildMatrix(currentRepo, stableRepo) {
  const stable = extractRepo(stableRepo);
  const current = extractRepo(currentRepo);
  const names = Array.from(new Set([...stable.keys(), ...current.keys()])).sort();
  const fields = names.map((name) => {
    const stableField = stable.get(name);
    const currentField = current.get(name);
    return {
      name,
      status: classify(stableField, currentField),
      stable: compactField(stableField),
      current: compactField(currentField),
    };
  });

  const summary = {};
  for (const field of fields) summary[field.status] = (summary[field.status] || 0) + 1;

  return {
    stable: {
      path: stableRepo,
      version: gitDescribe(stableRepo),
    },
    current: {
      path: currentRepo,
      version: gitDescribe(currentRepo),
    },
    summary,
    fields,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const matrix = buildMatrix(args.current, args.stable);
  process.stdout.write(JSON.stringify(matrix, null, 2) + "\n");

  if (args.check) {
    const missing = matrix.fields.filter((field) => field.status === "missing_current");
    if (missing.length) {
      console.error(`Missing current config fields from stable contract: ${missing.map((f) => f.name).join(", ")}`);
      process.exit(1);
    }
  }
}

main();
