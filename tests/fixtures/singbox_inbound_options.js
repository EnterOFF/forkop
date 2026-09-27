// Rebuilds singbox_inbound_options.json from the option structs of a sing-box
// checkout:
//
//     node tests/fixtures/singbox_inbound_options.js <sing-box>/option
//
// The snapshot is the nested set of JSON keys each inbound the Servers tab
// builds accepts, which tests/singbox/server_options.test.uc holds the
// generator to. Only the shape matters: which key exists under which object, and
// which struct a nested object expands into.
//
// The Go source is simple enough to read with a struct scanner: a field is either
// `Name Type `json:"key,..."`` or an embedded type with no name and no tag, which is
// flattened into the parent the way encoding/json does. Anything without a json tag
// and without a name is an embedded struct; anything with `json:"-"` is skipped.
"use strict";

const fs = require("fs");
const path = require("path");

const STRUCT_RE = /^type\s+(\w+)\s+struct\s*\{$/;
// `type AnyTLSUser _anyTLSUser`: the public type carries the custom JSON handling
// and the underscore-prefixed one holds the fields.
const ALIAS_RE = /^type\s+(\w+)\s+(\w+)$/;

function readStructs(optionDir) {
  const structs = new Map();
  const aliases = new Map();

  for (const name of fs.readdirSync(optionDir).sort()) {
    if (!name.endsWith(".go") || name.endsWith("_test.go")) continue;
    const lines = fs
      .readFileSync(path.join(optionDir, name), "utf8")
      .split("\n");

    let current = null;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (current === null) {
        const match = STRUCT_RE.exec(line.trim());
        if (match) {
          current = { name: match[1], fields: [] };
          continue;
        }
        const alias = ALIAS_RE.exec(line.trim());
        if (alias) aliases.set(alias[1], alias[2]);
        continue;
      }
      if (line.trim() === "}") {
        structs.set(current.name, current.fields);
        current = null;
        continue;
      }
      const field = parseField(line);
      if (field) current.fields.push(field);
    }
  }

  for (const [name, target] of aliases) {
    if (!structs.has(name) && structs.has(target)) {
      structs.set(name, structs.get(target));
    }
  }

  return structs;
}

function parseField(line) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("//")) return null;

  const tagMatch = /`[^`]*\bjson:"([^"]*)"/.exec(trimmed);
  const withoutTag = trimmed.replace(/`[^`]*`\s*$/, "").trim();

  if (tagMatch) {
    const key = tagMatch[1].split(",")[0];
    if (key === "-" || key === "") return null;
    const parts = withoutTag.split(/\s+/);
    if (parts.length < 2) return null;
    return { kind: "field", key, goType: parts.slice(1).join(" ") };
  }

  // An embedded struct: one bare type name, optionally qualified or a pointer.
  if (/^[*]?[A-Za-z_][\w.]*$/.test(withoutTag)) {
    return { kind: "embedded", goType: withoutTag.replace(/^[*]/, "") };
  }
  return null;
}

// The element type behind a pointer, slice, map or Listable wrapper.
function baseType(goType) {
  let value = goType.trim();
  for (;;) {
    const next = value
      .replace(/^\*/, "")
      .replace(/^\[\]/, "")
      .replace(/^map\[[^\]]+\]/, "")
      .replace(/^badoption\.Listable\[(.*)\]$/, "$1")
      .trim();
    if (next === value) break;
    value = next;
  }
  return value.replace(/^option\./, "");
}

function expand(structs, structName, seen = new Set()) {
  const fields = structs.get(structName);
  if (!fields || seen.has(structName)) return {};

  const nextSeen = new Set(seen).add(structName);
  const result = {};
  for (const field of fields) {
    if (field.kind === "embedded") {
      Object.assign(result, expand(structs, baseType(field.goType), nextSeen));
      continue;
    }
    const nested = structs.has(baseType(field.goType))
      ? expand(structs, baseType(field.goType), nextSeen)
      : null;
    result[field.key] = nested && Object.keys(nested).length ? nested : true;
  }
  return result;
}

// The struct each sing-box inbound type is registered with, plus the Tailscale
// endpoint the Servers tab also builds.
const INBOUND_STRUCTS = {
  mixed: "HTTPMixedInboundOptions",
  socks: "SocksInboundOptions",
  vless: "VLESSInboundOptions",
  vmess: "VMessInboundOptions",
  trojan: "TrojanInboundOptions",
  shadowsocks: "ShadowsocksInboundOptions",
  hysteria2: "Hysteria2InboundOptions",
  tuic: "TUICInboundOptions",
  anytls: "AnyTLSInboundOptions",
  naive: "NaiveInboundOptions",
  ssh: "SSHInboundOptions",
  mieru: "MieruInboundOptions",
  mtproxy: "MTProxyInboundOptions",
  tailscale: "TailscaleEndpointOptions",
};

// The V2Ray transport object is a union: the type field picks which of the
// per-transport structs the remaining keys come from, so all of them are merged.
const TRANSPORT_STRUCTS = [
  "V2RayHTTPOptions",
  "V2RayWebsocketOptions",
  "V2RayQUICOptions",
  "V2RayGRPCOptions",
  "V2RayHTTPUpgradeOptions",
  "V2RayXHTTPOptions",
  "V2RayKCPOptions",
];

function buildSchema(optionDir) {
  const structs = readStructs(optionDir);
  const schema = {};

  for (const [type, structName] of Object.entries(INBOUND_STRUCTS)) {
    if (!structs.has(structName)) {
      throw new Error(`missing inbound option struct: ${structName}`);
    }
    const expanded = expand(structs, structName);
    if (type === "hysteria2") {
      Object.assign(expanded.obfs, expand(structs, "Hysteria2ObfsGecko"));
    }
    if (expanded.transport === true || typeof expanded.transport === "object") {
      const transport = { type: true };
      for (const name of TRANSPORT_STRUCTS) {
        Object.assign(transport, expand(structs, name));
      }
      // Mieru names a plain string "transport"; only the V2Ray union is an object.
      expanded.transport =
        structName === "MieruInboundOptions" ? true : transport;
    }
    schema[type] = expanded;
  }

  return schema;
}

function sortedKeys(value) {
  if (value === true) return true;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys(value[key])]),
  );
}

const optionDir = process.argv[2];
if (!optionDir) {
  console.error("Usage: node tests/fixtures/singbox_inbound_options.js <sing-box>/option");
  process.exit(2);
}
fs.writeFileSync(
  path.join(__dirname, "singbox_inbound_options.json"),
  JSON.stringify(sortedKeys(buildSchema(optionDir)), null, 2) + "\n",
);
