#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const decisionPath = process.argv[2];
const matrixArgs = process.argv.slice(3);
if (!decisionPath || !matrixArgs.length || matrixArgs.some((value) => !value.includes("="))) {
  fail("Usage: config_migration_audit.js <decisions.json> <version=matrix.json>...");
}

const decisions = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
if (decisions.dev_fields) {
  fail("migration decisions must classify unpublished fields as non_release_fields, not as supported dev migrations");
}
const matrices = matrixArgs.map((value) => {
  const separator = value.indexOf("=");
  return {
    version: value.slice(0, separator),
    matrix: JSON.parse(fs.readFileSync(value.slice(separator + 1), "utf8")),
  };
});

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function canonicalDefaultHistory(repo) {
  if (!repo) return { fields: new Map(), sectionTypes: new Map() };
  const configPath = "forkop/files/etc/config/forkop";
  const first = git(repo, ["rev-parse", "1.0.2^{commit}"]);
  const later = git(repo, ["rev-list", "--reverse", "1.0.2..HEAD", "--", configPath]);
  const commits = [...new Set([first, ...later.split(/\n/).filter(Boolean)])];
  const fields = new Map();
  const sectionTypes = new Map();

  for (const commit of commits) {
    const data = git(repo, ["show", `${commit}:${configPath}`]);
    for (const line of data.split(/\n/)) {
      const fieldMatch = line.match(/^\s*(?:#\s*)?(option|list)\s+([A-Za-z0-9_]+)\s+['"]?([^'"]*)/);
      if (fieldMatch) {
        const entry = fields.get(fieldMatch[2]) || { first_commit: commit, last_commit: commit, kinds: new Set(), values: new Set() };
        entry.last_commit = commit;
        entry.kinds.add(fieldMatch[1]);
        entry.values.add(fieldMatch[3]);
        fields.set(fieldMatch[2], entry);
      }
      const sectionMatch = line.match(/^\s*(?:#\s*)?config\s+([A-Za-z0-9_]+)/);
      if (sectionMatch) {
        const entry = sectionTypes.get(sectionMatch[1]) || { first_commit: commit, last_commit: commit };
        entry.last_commit = commit;
        sectionTypes.set(sectionMatch[1], entry);
      }
    }
  }
  return { fields, sectionTypes };
}

const defaultHistory = canonicalDefaultHistory(process.env.CONFIG_HISTORY_REPO);

function sourceFieldHistory(repo) {
  const fields = new Map();
  if (!repo) return fields;
  const patch = execFileSync("git", [
    "-C", repo, "log", "--format=commit %H", "--unified=0", "-p", "1.0.2..HEAD", "--",
    "forkop/files/etc/config/forkop", "forkop/files/usr/lib",
    "fe-app-forkop/src", "luci-app-forkop/htdocs",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let commit = "";
  const patterns = [
    /^\s*(?:#\s*)?(?:option|list)\s+([A-Za-z0-9_]+)/,
    /\.(?:option|taboption)\(\s*(?:["'][^"']+["']\s*,\s*)?[^,\n]+,\s*["']([A-Za-z0-9_]+)["']/,
    /\b(?:option|list_option|bool_option|int_option|list_value|whitespace_list_value|child_option|child_list|child_bool)\(\s*[^,\n]+,\s*["']([A-Za-z0-9_]+)["']/,
    /\b(?:set_option|set_option_if_missing|delete_option|add_list_unique)\(\s*[^,\n]+,\s*[^,\n]+,\s*["']([A-Za-z0-9_]+)["'](?!\s*\+)/,
  ];
  for (const rawLine of patch.split(/\n/)) {
    if (rawLine.startsWith("commit ")) {
      commit = rawLine.slice(7).trim();
      continue;
    }
    if (!/^[+-][^+-]/.test(rawLine)) continue;
    const line = rawLine.slice(1);
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const entry = fields.get(match[1]) || { commits: new Set() };
      if (commit) entry.commits.add(commit);
      fields.set(match[1], entry);
    }
  }
  return fields;
}

const sourceHistory = sourceFieldHistory(process.env.CONFIG_HISTORY_REPO);

const history = new Map();
for (const { version, matrix } of matrices) {
  for (const field of matrix.fields) {
    const stable = field.stable;
    if (!stable || !(stable.ui.length || stable.backend.length || stable.defaults.length || stable.examples.length)) continue;
    const entry = history.get(field.name) || { versions: [], statuses: new Set() };
    entry.versions.push(version);
    entry.statuses.add(field.status);
    history.set(field.name, entry);
  }
}

const explicit = decisions.fields || {};
const unresolved = [];
for (const [name, entry] of history) {
  const needsDecision = entry.statuses.has("missing_current") || entry.statuses.has("migrated");
  if (needsDecision && !explicit[name]) unresolved.push(name);
}
if (unresolved.length) {
  fail(`historic fields without an explicit migration decision: ${unresolved.sort().join(", ")}`);
}

for (const [name, decision] of Object.entries(explicit)) {
  if (!history.has(name)) fail(`decision references no 1.0.2-1.0.5 field: ${name}`);
  if (!["preserve", "rename", "convert", "remove", "ignore"].includes(decision.action)) {
    fail(`field ${name} has invalid migration action: ${decision.action}`);
  }
  if (!decision.reason) fail(`field ${name} needs a concrete migration reason`);
  if ((decision.action === "rename" || decision.action === "convert") && !decision.target) {
    fail(`field ${name} needs a migration target`);
  }
}

const requiredSectionTypes = new Set([
  "settings", "section", "server", "subscription_url", "section_interface",
  "urltest", "priority_group", "priority_level", "fallback_group",
  "fallback_level", "server_client", "tunnel", "tunnel_peer",
]);
for (const name of defaultHistory.sectionTypes.keys()) requiredSectionTypes.add(name);
const sectionDecisions = decisions.section_types || {};
const missingSections = [...requiredSectionTypes].filter((name) => !sectionDecisions[name]);
if (missingSections.length) {
  fail(`section types without an explicit migration decision: ${missingSections.join(", ")}`);
}
for (const [name, decision] of Object.entries(sectionDecisions)) {
  if (!["preserve", "rename", "add"].includes(decision.action) || !decision.reason) {
    fail(`section type ${name} needs a valid action and reason`);
  }
}

const requiredNonReleaseFields = new Set([
  "tunnel_jsons",
  "tunnel_jsons[].endpoint.amnezia.itime",
  "tunnel_jsons[].endpoint.amnezia.j1",
  "tunnel_jsons[].endpoint.amnezia.j2",
  "tunnel_jsons[].endpoint.amnezia.j3",
  "tunnel_jsons[].endpoint.exit_node_allow_lan_access",
]);
for (const { matrix } of matrices) {
  for (const field of matrix.fields) {
    const current = field.current;
    const configured = current && (current.ui.length || current.backend.length || current.defaults.length || current.examples.length);
    if (field.status === "added_current" && !history.has(field.name) && current && current.migrations.length && !configured) {
      requiredNonReleaseFields.add(field.name);
    }
  }
}
const nonReleaseFields = decisions.non_release_fields || {};
for (const name of defaultHistory.fields.keys()) {
  if (!history.has(name) && !currentOnlyField(matrices, name)) requiredNonReleaseFields.add(name);
}
for (const name of sourceHistory.keys()) {
  if (!history.has(name) && !currentOnlyField(matrices, name)) requiredNonReleaseFields.add(name);
}
const missingNonReleaseFields = [...requiredNonReleaseFields].filter((name) => !nonReleaseFields[name]);
if (missingNonReleaseFields.length) {
  fail(`non-release fields without an explicit ignore decision: ${missingNonReleaseFields.join(", ")}`);
}
for (const [name, decision] of Object.entries(nonReleaseFields)) {
  if (decision.action !== "ignore" || !decision.reason || decision.target) {
    fail(`non-release field ${name} must have only an ignore action and a reason`);
  }
}

const nonReleaseValues = decisions.non_release_values || {};
for (const [field, values] of Object.entries(nonReleaseValues)) {
  for (const [value, decision] of Object.entries(values)) {
    if (decision.action !== "ignore" || !decision.reason || decision.target) {
      fail(`non-release value ${field}=${value} must have only an ignore action and a reason`);
    }
  }
}

const currentOnly = new Set();
for (const { matrix } of matrices) {
  for (const field of matrix.fields) {
    const current = field.current;
    const configured = current && (current.ui.length || current.backend.length || current.defaults.length || current.examples.length);
    if (field.status === "added_current" && !history.has(field.name) && configured) currentOnly.add(field.name);
  }
}

function currentOnlyField(allMatrices, name) {
  return allMatrices.some(({ matrix }) => matrix.fields.some((field) => {
    if (field.name !== name || !field.current) return false;
    const current = field.current;
    return current.ui.length || current.backend.length || current.defaults.length || current.examples.length;
  }));
}

const rows = [];
for (const name of [...history.keys()].sort()) {
  const entry = history.get(name);
  const decision = explicit[name] || {
    action: "preserve",
    target: name,
    reason: "The current UI or backend still owns the same option; migration must leave its value unchanged.",
  };
  rows.push({ name, versions: entry.versions.join(","), ...decision });
}
for (const name of [...currentOnly].sort()) {
  rows.push({
    name,
    versions: "NEXT",
    action: "add",
    target: name,
    reason: "The option was added after 1.0.5 and uses the current default when absent.",
  });
}

function decisionFor(name) {
  if (explicit[name]) return explicit[name];
  if (nonReleaseFields[name]) return nonReleaseFields[name];
  if (history.has(name)) {
    return {
      action: "preserve",
      target: name,
      reason: "The current UI or backend still owns the same option; migration must leave its value unchanged.",
    };
  }
  if (currentOnly.has(name)) {
    return {
      action: "add",
      target: name,
      reason: "The option was added after 1.0.5 and uses the current default when absent.",
    };
  }
  return null;
}

for (const name of sourceHistory.keys()) {
  if (!decisionFor(name)) fail(`source-history field has no final decision: ${name}`);
}

process.stdout.write(JSON.stringify({
  source_versions: matrices.map(({ version }) => version),
  section_types: sectionDecisions,
  non_release_fields: nonReleaseFields,
  non_release_values: nonReleaseValues,
  default_history: [...defaultHistory.fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({
    name,
    first_commit: entry.first_commit,
    last_commit: entry.last_commit,
    kinds: [...entry.kinds].sort(),
    values: [...entry.values].sort(),
    decision: decisionFor(name),
  })),
  section_history: [...defaultHistory.sectionTypes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({
    name,
    first_commit: entry.first_commit,
    last_commit: entry.last_commit,
    decision: sectionDecisions[name],
  })),
  source_history: [...sourceHistory.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({
    name,
    commits: [...entry.commits],
    decision: decisionFor(name),
  })),
  fields: rows,
}, null, 2) + "\n");
process.stderr.write(`audited ${history.size} historic and ${currentOnly.size} added config fields\n`);
