"use strict";
"require rpc";
"require uci";
"require baseclass";
"require view.forkop.main as main";
"require view.forkop.server_util as util";
"require view.forkop.server_spec as spec";

// Every value check the server form applies. The rules follow what sing-box
// actually accepts, so a form that validates produces a configuration the service
// can start with instead of one that fails on the router.

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;

// Inbound types the raw JSON field accepts, taken from the inbound registry the
// Forkop core builds.
const JSON_INBOUND_TYPES = new Set([
  "tun",
  "redirect",
  "tproxy",
  "direct",
  "socks",
  "http",
  "mixed",
  "shadowsocks",
  "vmess",
  "trojan",
  "naive",
  "shadowtls",
  "vless",
  "anytls",
  "mieru",
  "ssh",
  "bond",
  "failover",
  "trusttunnel",
  "hysteria",
  "tuic",
  "hysteria2",
  "mtproto",
  "sudoku",
  "snell",
  "call",
]);

const callNetworkInterfaceDump = rpc.declare({
  object: "network.interface",
  method: "dump",
  expect: { interface: [] },
});

let defaultPublicHostPromise = null;
let defaultPublicHostCache = null;
let systemPortsPromise = null;
let systemPortsCache = null;

function isEmptyValue(value) {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) &&
      value.filter((item) => item != null && item !== "").length === 0)
  );
}

function valueList(value) {
  return (Array.isArray(value) ? value : [value]).filter(
    (item) => item != null && item !== "",
  );
}

function validateRequired(_sectionId, value) {
  return isEmptyValue(value) ? _("This field is required") : true;
}

function validateRequiredText(_sectionId, value) {
  if (isEmptyValue(value)) {
    return _("This field is required");
  }

  return /[\u0000-\u001F\u007F]/.test(`${value}`)
    ? _("Value must not contain control characters")
    : true;
}

function validatePort(_sectionId, value) {
  const port = parseInt(value, 10);
  if (!/^[0-9]+$/.test(value) || port < 1 || port > 65535) {
    return _("Port must be between 1 and 65535");
  }
  return true;
}

function validateUuid(_sectionId, value) {
  return /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(
    `${value || ""}`,
  )
    ? true
    : _("Use a valid UUID");
}

function validateHost(_sectionId, value) {
  return util.isHost(value) ? true : _("Use a domain name or IP address");
}

function validateOptionalHost(_sectionId, value) {
  return isEmptyValue(value) || util.isHost(value)
    ? true
    : _("Use a domain name or IP address");
}

function validateListenAddress(_sectionId, value) {
  const address = util.normalizeHost(value);
  return address === "0.0.0.0" ||
    address === "::" ||
    util.isIpv4(address) ||
    util.isIpv6(address)
    ? true
    : _("Use an IP listen address");
}

function validateOptionalIp(_sectionId, value) {
  const address = util.normalizeHost(value);
  return isEmptyValue(value) || util.isIpv4(address) || util.isIpv6(address)
    ? true
    : _("Use an IP address");
}

function validateFilePath(_sectionId, value) {
  const path = `${value || ""}`;

  if (isEmptyValue(path)) {
    return _("This field is required");
  }

  const validation = main.validatePath(path);
  return validation.valid && path !== "/" && !path.endsWith("/")
    ? true
    : _("Specify a file path");
}

function validateOptionalFilePath(sectionId, value) {
  return isEmptyValue(value) ? true : validateFilePath(sectionId, value);
}

function validateTlsCertificatePath(sectionId, value) {
  const result = validateFilePath(sectionId, value);
  if (result !== true) {
    return result;
  }

  return `${value}` ===
    `${uci.get(UCI_PACKAGE, sectionId, "tls_key_path") || ""}`
    ? _("Specify different files")
    : true;
}

function validateTlsKeyPath(sectionId, value) {
  const result = validateFilePath(sectionId, value);
  if (result !== true) {
    return result;
  }

  return `${value}` ===
    `${uci.get(UCI_PACKAGE, sectionId, "tls_certificate_path") || ""}`
    ? _("Specify different files")
    : true;
}

function validateHttpUrl(_sectionId, value) {
  try {
    const url = new URL(`${value || ""}`);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      util.isHost(url.hostname)
      ? true
      : _("Use an HTTP or HTTPS URL");
  } catch (_error) {
    return _("Use an HTTP or HTTPS URL");
  }
}

// Forkop overwrites the tag of a raw inbound with the server name, so a tag in the
// pasted object is silently lost. Rejecting it is clearer than dropping it.
function validateInboundJson(_sectionId, value) {
  if (isEmptyValue(value)) {
    return _("Inbound JSON cannot be empty");
  }

  let parsed;
  try {
    parsed = JSON.parse(`${value}`);
  } catch (_error) {
    return _("Invalid JSON format");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.type !== "string" ||
    !parsed.type
  ) {
    return _("Inbound JSON must be an object with a type field");
  }

  const type = parsed.type.trim();
  if (parsed.type !== type || !JSON_INBOUND_TYPES.has(type)) {
    return _("Unsupported JSON inbound type");
  }

  if (parsed.tag != null) {
    return _("Remove the tag field: Forkop sets the tag from the server name");
  }

  if (parsed.listen_port != null) {
    const port = validatePort(null, `${parsed.listen_port}`);
    if (port !== true) {
      return port;
    }
  }

  return true;
}

function validateDurationValue(value) {
  return /^([0-9]+(ns|us|ms|s|m|h))+$/.test(`${value || ""}`);
}

function validateRequiredDuration(_sectionId, value) {
  return validateDurationValue(value)
    ? true
    : _("Use a duration like 30s, 5m, or 1h30m");
}

function validateOptionalNonNegativeInteger(_sectionId, value) {
  return isEmptyValue(value) || /^[0-9]+$/.test(`${value}`)
    ? true
    : _("Use a non-negative integer");
}

function validateOptionalPositiveInteger(_sectionId, value) {
  return isEmptyValue(value) || /^[1-9][0-9]*$/.test(`${value}`)
    ? true
    : _("Use a positive integer");
}

function validateTransportPath(_sectionId, value) {
  return isEmptyValue(value) || `${value}`.startsWith("/")
    ? true
    : _("Transport path must start with /");
}

function validateOptionalHostList(_sectionId, value) {
  return valueList(value).some((item) => !util.isHost(item))
    ? _("Use a domain name or IP address")
    : true;
}

function validateGrpcServiceName(_sectionId, value) {
  return isEmptyValue(value) || /^[A-Za-z0-9_.-]+$/.test(`${value}`)
    ? true
    : _("Use letters, digits, dots, underscores, or hyphens");
}

function normalizeCidrOrIp(value) {
  const normalized = `${value || ""}`.trim();
  if (!normalized.includes("/") && util.isIpv4(normalized)) {
    return `${normalized}/32`;
  }
  if (!normalized.includes("/") && util.isIpv6(normalized)) {
    return `${normalized}/128`;
  }
  return normalized;
}

function isValidCidr(item) {
  const [address, prefix, extra] = `${item}`.split("/");
  if (extra != null || prefix == null || !/^[0-9]+$/.test(prefix)) {
    return false;
  }
  const prefixNumber = parseInt(prefix, 10);
  if (util.isIpv4(address)) {
    return prefixNumber >= 0 && prefixNumber <= 32;
  }
  if (util.isIpv6(address)) {
    return prefixNumber >= 0 && prefixNumber <= 128;
  }
  return false;
}

function validateOptionalCidrOrIp(value) {
  if (isEmptyValue(value)) {
    return true;
  }

  return valueList(value).some((item) => !isValidCidr(normalizeCidrOrIp(item)))
    ? _(
        "Use CIDR prefixes or IP addresses like 192.168.1.0/24, 192.168.1.10, or 2001:db8::1",
      )
    : true;
}

// sing-box decodes every short ID as hex bytes, so an odd digit count is refused at
// start-up and eight bytes is the hard limit. The form has to reject exactly the
// same values instead of letting the service die on apply.
function validateShortId(_sectionId, value) {
  const values = valueList(value);

  if (values.length === 0) {
    return _("This field is required");
  }

  if (values.some((item) => !/^(?:[0-9a-fA-F]{2})+$/.test(`${item}`))) {
    return _("Reality short ID must use an even number of hex digits");
  }

  if (values.some((item) => `${item}`.length > 16)) {
    return _("Reality short ID must not exceed 16 hex digits");
  }

  const seen = new Set();
  if (
    values.some((item) => {
      const normalized = `${item}`.toLowerCase();
      if (seen.has(normalized)) {
        return true;
      }
      seen.add(normalized);
      return false;
    })
  ) {
    return _("Reality short IDs must be unique");
  }

  return true;
}

function validateMtprotoSecret(_sectionId, value) {
  const secret = spec.normalizeMtprotoBaseSecret(value);

  if (!secret) {
    return _("Use 32 hex characters");
  }
  if (secret === "00000000000000000000000000000000") {
    return _("Use a non-zero secret");
  }

  return true;
}

function validateSecurity(sectionId, value) {
  const protocol = spec.getProtocol(sectionId);
  const selected = value || spec.defaultSecurity(protocol);

  return spec.securitiesFor(protocol).includes(selected)
    ? true
    : _("Unsupported security mode for this protocol");
}

// Tailscale reduces the hostname to a DNS label, so anything it would rewrite is
// rejected here and the form offers a transliterated suggestion instead.
function validateTailscaleHostname(_sectionId, value) {
  const hostname = `${value || ""}`.trim();

  if (!hostname) {
    return _("This field is required");
  }
  if (hostname.length > 63) {
    return _("Tailscale hostname must not exceed 63 characters");
  }

  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(hostname)
    ? true
    : _(
        "Use lowercase letters, digits and hyphens: Tailscale rewrites anything else",
      );
}

function validateShadowsocksPassword(sectionId, value) {
  const required = validateRequiredText(sectionId, value);
  if (required !== true) {
    return required;
  }

  const method = spec.getShadowsocksMethod(sectionId);
  const keyBytes = spec.shadowsocksKeyBytes(method);
  if (keyBytes === 0) {
    return true;
  }

  let decoded = null;
  try {
    decoded = atob(`${value}`.trim());
  } catch (_error) {
    decoded = null;
  }

  return decoded != null && decoded.length === keyBytes
    ? true
    : _("This method needs a base64 key of %d bytes").format(keyBytes);
}

function validateAuthorizedKeys(_sectionId, value) {
  return valueList(value).some(
    (item) =>
      !/^(ssh|ecdsa|sk-ssh|sk-ecdsa)[A-Za-z0-9@.-]*\s+[A-Za-z0-9+/=]+(\s.*)?$/.test(
        `${item}`.trim(),
      ),
  )
    ? _("Use an OpenSSH public key line, for example ssh-ed25519 AAAA...")
    : true;
}

// Ports another Forkop server, another Forkop inbound or a router service already
// listens on. sing-box refuses to start on a taken port, and the runtime check in
// Diagnostics only reports it after the fact.
function occupiedPorts(currentSectionId) {
  const owners = new Map();

  const claim = (port, owner) => {
    const normalized = `${port || ""}`.trim();
    if (!/^[0-9]+$/.test(normalized) || owners.has(normalized)) {
      return;
    }
    owners.set(normalized, owner);
  };

  spec.RESERVED_PORTS.forEach((owner, port) => claim(port, owner));

  (uci.sections(UCI_PACKAGE, "server") || []).forEach((server) => {
    if (server[".name"] === currentSectionId || server.enabled === "0") {
      return;
    }
    if (!spec.hasListener(server.protocol || spec.DEFAULT_PROTOCOL)) {
      return;
    }
    claim(
      server.listen_port,
      _("server %s").format(server.label || server[".name"]),
    );
  });

  (uci.sections(UCI_PACKAGE, "section") || []).forEach((section) => {
    if (section.enabled === "0" || section.mixed_proxy_enabled !== "1") {
      return;
    }
    claim(
      section.mixed_proxy_port,
      _("section %s").format(section.label || section[".name"]),
    );
  });

  (systemPortsCache || []).forEach((entry) => claim(entry.port, entry.owner));

  return owners;
}

function validateListenPort(sectionId, value) {
  const result = validatePort(sectionId, value);
  if (result !== true) {
    return result;
  }

  const owner = occupiedPorts(sectionId).get(`${value}`.trim());
  return owner ? _("Port %s is already used by %s").format(value, owner) : true;
}

// Ports taken by services outside Forkop's own configuration. Read once per page so
// the port check can name uhttpd or dropbear instead of only failing on apply.
function loadSystemPorts() {
  if (systemPortsCache != null) {
    return Promise.resolve(systemPortsCache);
  }
  if (systemPortsPromise) {
    return systemPortsPromise;
  }

  systemPortsPromise = Promise.all([
    uci.load("uhttpd").catch(() => null),
    uci.load("dropbear").catch(() => null),
  ])
    .then(() => {
      const entries = [];
      const addListen = (value, owner) => {
        util.asList(value).forEach((item) => {
          const port = `${item}`.trim().split(":").pop();
          if (/^[0-9]+$/.test(port)) {
            entries.push({ port, owner });
          }
        });
      };

      (uci.sections("uhttpd") || []).forEach((section) => {
        addListen(section.listen_http, _("LuCI web interface"));
        addListen(section.listen_https, _("LuCI web interface"));
      });
      (uci.sections("dropbear") || []).forEach((section) => {
        if (section.enable !== "0") {
          addListen(section.Port || "22", _("router SSH"));
        }
      });

      systemPortsCache = entries;
      return systemPortsCache;
    })
    .catch(() => {
      systemPortsCache = [];
      return systemPortsCache;
    })
    .finally(() => {
      systemPortsPromise = null;
    });

  return systemPortsPromise;
}

function getInterfaceIpAddresses(networkInterface) {
  const addressLists = ["ipv4-address", "ipv6-address"].map((key) =>
    networkInterface &&
    typeof networkInterface === "object" &&
    Array.isArray(networkInterface[key])
      ? networkInterface[key]
      : [],
  );

  return addressLists
    .flat()
    .map((address) =>
      util.normalizeHost(
        address && typeof address === "object" ? address.address : address,
      ),
    )
    .filter((address) => util.isIpv4(address) || util.isIpv6(address));
}

function chooseDefaultPublicHost(networkInterfaces) {
  const interfaces = Array.isArray(networkInterfaces) ? networkInterfaces : [];
  const upInterfaces = interfaces.filter(
    (networkInterface) => networkInterface && networkInterface.up !== false,
  );
  const publicIp = upInterfaces
    .flatMap(getInterfaceIpAddresses)
    .find((ip) => !util.isPrivateOrReservedIp(ip));

  if (publicIp) {
    return publicIp;
  }

  const lanInterface =
    upInterfaces.find((networkInterface) => {
      const name = `${networkInterface.interface || ""}`;
      const device = `${networkInterface.device || networkInterface.l3_device || ""}`;
      return name === "lan" || device === "br-lan";
    }) || {};
  const lanIp = getInterfaceIpAddresses(lanInterface).find(
    (ip) => ip !== "::1" && !ip.startsWith("127."),
  );

  if (lanIp) {
    return lanIp;
  }

  return (
    upInterfaces
      .flatMap(getInterfaceIpAddresses)
      .find((ip) => ip !== "::1" && !ip.startsWith("127.")) ||
    util.getBrowserHost()
  );
}

function loadDefaultPublicHost() {
  if (defaultPublicHostCache != null) {
    return Promise.resolve(defaultPublicHostCache);
  }
  if (defaultPublicHostPromise) {
    return defaultPublicHostPromise;
  }

  defaultPublicHostPromise = callNetworkInterfaceDump()
    .then((networkInterfaces) => {
      defaultPublicHostCache = chooseDefaultPublicHost(networkInterfaces);
      return defaultPublicHostCache;
    })
    .catch(() => util.getBrowserHost())
    .finally(() => {
      defaultPublicHostPromise = null;
    });

  return defaultPublicHostPromise;
}

function applyDefaultPublicHost(sectionId, host) {
  const normalizedHost = util.normalizeHost(host);
  const currentHost = util.normalizeHost(
    uci.get(UCI_PACKAGE, sectionId, "public_host"),
  );
  const browserHost = util.getBrowserHost();

  if (
    normalizedHost &&
    (!currentHost || currentHost === browserHost || currentHost === "127.0.0.1")
  ) {
    uci.set(UCI_PACKAGE, sectionId, "public_host", normalizedHost);
  }
}

function preloadServerModalData() {
  return Promise.all([
    loadDefaultPublicHost().catch(() => null),
    loadSystemPorts().catch(() => null),
  ]);
}

return baseclass.extend({
  applyDefaultPublicHost,
  chooseDefaultPublicHost,
  loadDefaultPublicHost,
  occupiedPorts,
  preloadServerModalData,
  validateAuthorizedKeys,
  validateGrpcServiceName,
  validateHost,
  validateHttpUrl,
  validateInboundJson,
  validateListenAddress,
  validateListenPort,
  validateMtprotoSecret,
  validateOptionalCidrOrIp,
  validateOptionalFilePath,
  validateOptionalHost,
  validateOptionalHostList,
  validateOptionalIp,
  validateOptionalNonNegativeInteger,
  validateOptionalPositiveInteger,
  validatePort,
  validateRequired,
  validateRequiredDuration,
  validateRequiredText,
  validateSecurity,
  validateShadowsocksPassword,
  validateShortId,
  validateTailscaleHostname,
  validateTlsCertificatePath,
  validateTlsKeyPath,
  validateTransportPath,
  validateUuid,
});
