"use strict";
"require baseclass";

// Helpers the server modules share: host parsing, the encodings share links need,
// the secret generators the protocol defaults use, and the few DOM utilities the
// server form, the client editor and the information dialog all reach for.

function asList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.filter(Boolean) : [`${value}`];
}

function normalizeHost(host) {
  return `${host || ""}`.trim().replace(/^\[|\]$/g, "");
}

function isIpv4(value) {
  return /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$/.test(
    value,
  );
}

function isIpv6(value) {
  const normalized = normalizeHost(value);
  if (!normalized.includes(":")) {
    return false;
  }

  try {
    new URL(`http://[${normalized}]/`);
    return true;
  } catch (_error) {
    return false;
  }
}

function isHostname(value) {
  const hostname = normalizeHost(value);
  if (hostname.length < 1 || hostname.length > 253 || hostname.endsWith(".")) {
    return false;
  }

  return hostname
    .split(".")
    .every((part) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part),
    );
}

function isHost(value) {
  const host = normalizeHost(value);
  return isIpv4(host) || isIpv6(host) || isHostname(host);
}

function formatHostForUri(host) {
  const normalized = normalizeHost(host);
  return isIpv6(normalized) ? `[${normalized}]` : normalized;
}

function isPrivateOrReservedIpv4(value) {
  if (!isIpv4(value)) {
    return true;
  }

  const octets = value.split(".").map((part) => parseInt(part, 10));
  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}

function isPrivateOrReservedIp(value) {
  const normalized = normalizeHost(value).toLowerCase();
  if (isIpv4(normalized)) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (!isIpv6(normalized)) {
    return true;
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

function getBrowserHost() {
  return normalizeHost(window.location.hostname || "");
}

// A DNS label built from a display name: Tailscale hostnames and proxy user names
// travel through clients and consoles that only keep ASCII, so a name that cannot
// survive that trip is transliterated instead of being handed over unchanged.
const CYRILLIC_TRANSLITERATION = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function transliterate(value) {
  return Array.from(`${value || ""}`.toLowerCase())
    .map((char) =>
      CYRILLIC_TRANSLITERATION[char] === undefined
        ? char
        : CYRILLIC_TRANSLITERATION[char],
    )
    .join("");
}

function slugify(value, fallback) {
  const slug = transliterate(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return slug || `${fallback || ""}`;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);

  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return bytes;
}

function bytesToString(bytes) {
  return Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function randomHex(byteLength) {
  return Array.from(randomBytes(byteLength))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stringToHex(value) {
  return Array.from(unescape(encodeURIComponent(`${value || ""}`)))
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function hexToString(value) {
  const hex = `${value || ""}`;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    return "";
  }

  const bytes = hex.match(/../g).map((byte) => parseInt(byte, 16));
  try {
    return decodeURIComponent(escape(bytesToString(bytes)));
  } catch (_error) {
    return "";
  }
}

function base64Encode(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function base64UrlEncode(value) {
  return base64Encode(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateUuid() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generatePassword() {
  return base64UrlEncode(bytesToString(randomBytes(18)));
}

// Shadowsocks 2022 pre-shared keys are standard base64 of exactly the key length
// the cipher takes, so they are generated from the byte count instead of a random
// printable password.
function generatePresharedKey(byteLength) {
  return btoa(bytesToString(randomBytes(byteLength)));
}

function generateMtprotoSecret() {
  const secret = randomHex(16);
  return secret === "00000000000000000000000000000000"
    ? "11111111111111111111111111111111"
    : secret;
}

function randomPort() {
  const bytes = randomBytes(2);
  const value = (bytes[0] << 8) | bytes[1];
  return `${20000 + (value % 30000)}`;
}

function normalizeSha256(value) {
  const normalized = `${value || ""}`.trim().replace(/:/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : "";
}

function encodeQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(`${value}`)}`,
    )
    .join("&");
}

function svgEl(tag, attrs = {}, children = []) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null) {
      element.setAttribute(key, `${value}`);
    }
  });
  (Array.isArray(children) ? children : [children])
    .filter(Boolean)
    .forEach((child) => element.appendChild(child));
  return element;
}

const ICON_PATHS = {
  copy: [
    ["rect", { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" }],
    ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }],
  ],
  check: [["polyline", { points: "20 6 9 17 4 12" }]],
  info: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M12 16v-4" }],
    ["path", { d: "M12 8h.01" }],
  ],
  dice: [
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "3", ry: "3" }],
    ["path", { d: "M8 8h.01" }],
    ["path", { d: "M16 8h.01" }],
    ["path", { d: "M8 16h.01" }],
    ["path", { d: "M16 16h.01" }],
    ["path", { d: "M12 12h.01" }],
  ],
  trash: [
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" }],
    ["path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }],
  ],
  plus: [
    ["path", { d: "M12 5v14" }],
    ["path", { d: "M5 12h14" }],
  ],
  qr: [
    ["rect", { x: "3", y: "3", width: "5", height: "5" }],
    ["rect", { x: "16", y: "3", width: "5", height: "5" }],
    ["rect", { x: "3", y: "16", width: "5", height: "5" }],
    [
      "path",
      {
        d: "M16 16h1v1h-1zM20 16h1v1h-1zM16 20h1v1h-1zM20 20h1v1h-1zM18 18h1v1h-1z",
      },
    ],
  ],
};

function iconSvg(name) {
  const attrs = {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  };

  return svgEl(
    "svg",
    attrs,
    (ICON_PATHS[name] || ICON_PATHS.qr).map(([tag, tagAttrs]) =>
      svgEl(tag, tagAttrs),
    ),
  );
}

function copyText(text, notify) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    document.execCommand("copy");
    copied = true;
  } catch (error) {
    console.warn("Failed to copy server client link", error);
  }

  document.body.removeChild(textarea);

  if (typeof notify === "function") {
    notify(copied);
  }

  return copied;
}

return baseclass.extend({
  asList,
  base64Encode,
  base64UrlEncode,
  copyText,
  encodeQuery,
  formatHostForUri,
  generateMtprotoSecret,
  generatePassword,
  generatePresharedKey,
  generateUuid,
  getBrowserHost,
  hexToString,
  iconSvg,
  isHost,
  isIpv4,
  isIpv6,
  isPrivateOrReservedIp,
  normalizeHost,
  normalizeSha256,
  randomHex,
  randomPort,
  slugify,
  stringToHex,
});
