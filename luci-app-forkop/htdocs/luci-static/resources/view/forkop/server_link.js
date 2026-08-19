"use strict";
"require fs";
"require uci";
"require ui";
"require baseclass";
"require view.forkop.main as main";
"require view.forkop.server_qr as qr";
"require view.forkop.server_util as util";
"require view.forkop.server_spec as spec";

// Share links for the clients of a server. The field names and encodings follow the
// link parser in the Forkop core (parser/link), so a link produced here is a link
// the core would accept back, and clients that follow the same conventions read it.

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const STYLE_ID = "forkop-server-link-styles";

function option(sectionId, name) {
  return uci.get(UCI_PACKAGE, sectionId, name) || "";
}

function optionList(sectionId, name) {
  return util.asList(uci.get(UCI_PACKAGE, sectionId, name));
}

function getPublicHost(sectionId) {
  return option(sectionId, "public_host") || util.getBrowserHost();
}

function getListenPort(sectionId) {
  return option(sectionId, "listen_port");
}

function clientLabel(sectionId, client) {
  return `${client?.name || ""}`.trim() || spec.getServerName(sectionId);
}

// A server that keeps Forkop's own certificate path serves a self-signed
// certificate, so its links have to tell the client to accept it.
function usesGeneratedCertificate(sectionId) {
  const path = option(sectionId, "tls_certificate_path");
  return !path || path === spec.defaultTlsCertificatePath(sectionId);
}

function isSelfSignedTls(sectionId) {
  return (
    spec.getEffectiveSecurity(sectionId) === "tls" &&
    usesGeneratedCertificate(sectionId)
  );
}

function transportQuery(sectionId, params, grpcKey) {
  const transport = option(sectionId, "transport") || "tcp";
  params.type = transport === "raw" ? "tcp" : transport;

  if (transport === "ws" || transport === "httpupgrade") {
    params.path = option(sectionId, "transport_path");
    params.host = option(sectionId, "transport_host");
  } else if (transport === "xhttp") {
    params.path = option(sectionId, "transport_path") || "/";
    params.host = option(sectionId, "transport_host");
    params.mode = option(sectionId, "transport_xhttp_mode") || "auto";
  } else if (transport === "grpc") {
    params[grpcKey] = option(sectionId, "transport_service_name");
  } else if (transport === "http") {
    params.path = option(sectionId, "transport_path");
    params.host = optionList(sectionId, "transport_hosts").join(",");
  }

  return transport;
}

function tlsQuery(sectionId, params, includeSecurity) {
  const security = spec.getEffectiveSecurity(sectionId);

  if (security === "none") {
    if (includeSecurity) {
      params.security = "none";
    }
    return security;
  }

  if (includeSecurity) {
    params.security = security;
  }

  if (security === "reality") {
    params.sni =
      option(sectionId, "tls_server_name") ||
      option(sectionId, "reality_handshake_server");
    params.pbk = option(sectionId, "reality_public_key");
    params.sid = optionList(sectionId, "reality_short_id")[0] || "";
    params.fp = option(sectionId, "client_fingerprint") || "chrome";
  } else {
    params.sni = option(sectionId, "tls_server_name");
    if (usesGeneratedCertificate(sectionId)) {
      params.insecure = "1";
    }
  }

  const alpn = optionList(sectionId, "tls_alpn").join(",");
  if (alpn) {
    params.alpn = alpn;
  }

  return security;
}

function shareUrl(scheme, sectionId, userInfo, params, label) {
  const host = util.formatHostForUri(getPublicHost(sectionId));
  const port = getListenPort(sectionId);
  const query = util.encodeQuery(params || {});

  return `${scheme}://${userInfo ? `${userInfo}@` : ""}${host}:${port}${
    query ? `?${query}` : ""
  }#${encodeURIComponent(label)}`;
}

function buildVlessLink(sectionId, client) {
  const params = {};
  const security = tlsQuery(sectionId, params, true);

  if (security === "reality" && (!params.pbk || !params.sid)) {
    return "";
  }

  transportQuery(sectionId, params, "serviceName");
  params.encryption = "none";
  if (client.flow && client.flow !== "none") {
    params.flow = client.flow;
  }

  return shareUrl(
    "vless",
    sectionId,
    encodeURIComponent(client.uuid),
    params,
    clientLabel(sectionId, client),
  );
}

function buildTrojanLink(sectionId, client) {
  const params = {};
  const security = tlsQuery(sectionId, params, true);

  // The core refuses to represent a plaintext Trojan outbound as a share link,
  // because no client format carries it.
  if (security === "none") {
    return "";
  }

  transportQuery(sectionId, params, "grpc-service-name");

  return shareUrl(
    "trojan",
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildVmessLink(sectionId, client) {
  const params = {};
  const security = tlsQuery(sectionId, params, false);
  const transportParams = {};
  const transport = transportQuery(sectionId, transportParams, "serviceName");
  const payload = {
    v: "2",
    ps: clientLabel(sectionId, client),
    add: getPublicHost(sectionId),
    port: getListenPort(sectionId),
    id: client.uuid,
    aid: "0",
    scy: "auto",
    net: transport === "raw" ? "tcp" : transport,
    type: "none",
    host: transportParams.host || "",
    path: transportParams.path || transportParams.serviceName || "",
    tls: security === "tls" ? "tls" : "",
    sni: security === "tls" ? params.sni || "" : "",
    alpn: security === "tls" ? params.alpn || "" : "",
  };

  if (params.insecure) {
    payload.insecure = "1";
  }

  // Unpadded standard base64, the encoding the core generator emits.
  return `vmess://${util.base64Encode(JSON.stringify(payload)).replace(/=+$/, "")}`;
}

function buildShadowsocksLink(sectionId, client) {
  const method = spec.getShadowsocksMethod(sectionId);
  // A 2022 server holds its own pre-shared key and every client adds its own, so the
  // client password is the two keys joined the way sing-box expects them.
  const password = spec.isShadowsocks2022(method)
    ? `${option(sectionId, "shadowsocks_psk")}:${client.password}`
    : client.password;

  return shareUrl(
    "ss",
    sectionId,
    util.base64UrlEncode(`${method}:${password}`),
    {},
    clientLabel(sectionId, client),
  );
}

function buildMixedLinks(sectionId, client) {
  const userInfo = spec.isAuthenticationEnabled(sectionId)
    ? `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}`
    : "";
  const label = clientLabel(sectionId, client);

  return [
    shareUrl("socks5", sectionId, userInfo, {}, label),
    shareUrl("http", sectionId, userInfo, {}, label),
  ];
}

function buildHysteria2Link(sectionId, client, context = {}) {
  const params = {};
  tlsQuery(sectionId, params, false);

  const certificatePin = util.normalizeSha256(context.tlsCertificateSha256);
  if (certificatePin) {
    params.pinSHA256 = certificatePin;
  }

  const obfsType = option(sectionId, "hysteria2_obfs_type");
  if (obfsType === "salamander") {
    params.obfs = obfsType;
    params["obfs-password"] = option(sectionId, "hysteria2_obfs_password");
  }

  const upMbps = option(sectionId, "hysteria2_up_mbps");
  const downMbps = option(sectionId, "hysteria2_down_mbps");
  if (upMbps) {
    params.up = upMbps;
  }
  if (downMbps) {
    params.down = downMbps;
  }

  return shareUrl(
    "hysteria2",
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildTuicLink(sectionId, client) {
  const params = {};
  tlsQuery(sectionId, params, false);

  const congestion = option(sectionId, "tuic_congestion_control");
  if (congestion && congestion !== "cubic") {
    params.congestion_control = congestion;
  }
  const heartbeat = option(sectionId, "tuic_heartbeat");
  if (heartbeat) {
    params.heartbeat_interval = heartbeat;
  }
  if (option(sectionId, "tuic_zero_rtt_handshake") === "1") {
    params.zero_rtt_handshake = "true";
  }

  return shareUrl(
    "tuic",
    sectionId,
    `${encodeURIComponent(client.uuid)}:${encodeURIComponent(client.password)}`,
    params,
    clientLabel(sectionId, client),
  );
}

function buildAnytlsLink(sectionId, client) {
  const params = {};
  tlsQuery(sectionId, params, false);

  return shareUrl(
    "anytls",
    sectionId,
    encodeURIComponent(client.password),
    params,
    clientLabel(sectionId, client),
  );
}

function buildNaiveLink(sectionId, client) {
  const params = {};
  tlsQuery(sectionId, params, false);

  // naive+quic marks the HTTP/3 listener; the HTTP/2 listener uses naive+https.
  const scheme =
    option(sectionId, "naive_network") === "udp" ? "naive+quic" : "naive+https";

  return shareUrl(
    scheme,
    sectionId,
    `${encodeURIComponent(client.name)}:${encodeURIComponent(client.password)}`,
    params,
    clientLabel(sectionId, client),
  );
}

function buildMtprotoLink(sectionId, client) {
  const secret = spec.normalizeMtprotoBaseSecret(client.secret);
  if (!secret) {
    return "";
  }

  return `https://t.me/proxy?${util.encodeQuery({
    server: getPublicHost(sectionId),
    port: getListenPort(sectionId),
    secret: spec.buildMtprotoFullSecret(
      secret,
      spec.getMtprotoFaketls(sectionId),
    ),
  })}`;
}

function hasRequiredCredentials(sectionId, client) {
  const protocol = spec.getProtocol(sectionId);

  return spec
    .credentialFields(protocol)
    .filter((field) => field !== "flow" && field !== "authorized_keys")
    .every((field) => {
      if (field === "password" && !spec.isAuthenticationEnabled(sectionId)) {
        return true;
      }
      return !!client[field];
    });
}

// Every link a client can be handed. Most protocols produce one; the SOCKS5 / HTTP
// listener produces one per scheme it answers.
function buildClientLinks(sectionId, client, context = {}) {
  const protocol = spec.getProtocol(sectionId);

  // Only protocols the spec gives a link scheme have a share link at all; SSH and
  // Mieru have no URI format, so the dialog shows their credentials instead.
  if (
    !client ||
    !spec.linkScheme(protocol) ||
    !getPublicHost(sectionId) ||
    !getListenPort(sectionId) ||
    !hasRequiredCredentials(sectionId, client)
  ) {
    return [];
  }

  switch (protocol) {
    case "vless":
      return [buildVlessLink(sectionId, client)].filter(Boolean);
    case "vmess":
      return [buildVmessLink(sectionId, client)];
    case "trojan":
      return [buildTrojanLink(sectionId, client)].filter(Boolean);
    case "shadowsocks":
      return [buildShadowsocksLink(sectionId, client)];
    case "mixed":
      return buildMixedLinks(sectionId, client);
    case "hysteria2":
      return [buildHysteria2Link(sectionId, client, context)];
    case "tuic":
      return [buildTuicLink(sectionId, client)];
    case "anytls":
      return [buildAnytlsLink(sectionId, client)];
    case "naive":
      return [buildNaiveLink(sectionId, client)];
    case "mtproto":
      return [buildMtprotoLink(sectionId, client)].filter(Boolean);
    default:
      return [];
  }
}

// Credentials to read out for protocols that have no share link format, so the
// dialog is still useful for SSH and Mieru.
function clientCredentialRows(sectionId, client) {
  const protocol = spec.getProtocol(sectionId);
  const rows = [];

  if (spec.usesLoginName(protocol)) {
    rows.push([_("Username"), client.name]);
  }
  if (client.password) {
    rows.push([_("Password"), client.password]);
  }
  if (client.uuid) {
    rows.push([_("UUID"), client.uuid]);
  }
  if (protocol === "mieru") {
    rows.push([_("Transport"), option(sectionId, "mieru_transport") || "TCP"]);
  }
  if (protocol === "ssh" && client.authorized_keys.length) {
    rows.push([
      _("Authorized keys"),
      _("%d configured").format(client.authorized_keys.length),
    ]);
  }

  return rows;
}

function normalizeSha256Response(response) {
  if ((response.code ?? 0) !== 0 || !response.stdout) {
    throw new Error(response.stderr || response.stdout || "");
  }

  const data = JSON.parse(response.stdout);
  if (!data.success) {
    throw new Error(data.message || "");
  }

  return util.normalizeSha256(data.sha256);
}

// Hysteria2 clients pin the certificate instead of trusting it, so the fingerprint
// of Forkop's generated certificate is read from the router.
function loadLinkContext(sectionId) {
  const certificatePinExpected =
    spec.getProtocol(sectionId) === "hysteria2" &&
    usesGeneratedCertificate(sectionId);

  if (!certificatePinExpected) {
    return Promise.resolve({
      certificatePinExpected,
      tlsCertificateSha256: "",
    });
  }

  return fs
    .exec("/usr/bin/forkop", ["get_tls_certificate_sha256", sectionId])
    .then(normalizeSha256Response)
    .catch((error) => {
      console.warn(
        error?.message || "Failed to read generated TLS certificate pin",
        error,
      );
      return "";
    })
    .then((tlsCertificateSha256) => ({
      certificatePinExpected,
      tlsCertificateSha256,
    }));
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      "style",
      { id: STYLE_ID },
      `
.fkp-server-info{display:flex;flex-direction:column;gap:14px;width:620px;max-width:100%;box-sizing:border-box}
.fkp-server-info__header{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fkp-server-info__title{font-weight:600;font-size:15px}
.fkp-server-info__badge{display:inline-flex;align-items:center;padding:2px 8px;font-size:11px;font-weight:600;border-radius:4px;border:1px solid var(--border-color,rgba(128,128,128,0.25));background:rgba(128,128,128,0.08);line-height:1.4}
.fkp-server-info__address{font-family:monospace;font-size:12px;background:rgba(128,128,128,0.12);padding:2px 6px;border-radius:4px}
.fkp-server-info__tabs{display:flex;flex-wrap:wrap;gap:6px}
.fkp-server-info__tab{padding:4px 12px !important;font-size:12px !important;height:auto !important;min-height:26px !important;float:none !important;margin:0 !important}
.fkp-server-info__tab--active{border-color:var(--primary,#0069d9) !important;box-shadow:inset 0 -2px 0 var(--primary,#0069d9)}
.fkp-server-info__body{display:flex;gap:20px;align-items:flex-start;width:100%;box-sizing:border-box}
.fkp-server-info__qr{display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;width:180px}
.fkp-server-info__qr-image{width:180px;height:180px;display:block;image-rendering:pixelated}
.fkp-server-info__details{display:flex;flex-direction:column;gap:12px;flex-grow:1;min-width:0}
.fkp-server-info__grid{display:flex;flex-direction:column;gap:8px;background:rgba(128,128,128,0.08);padding:12px;border:1px solid rgba(128,128,128,0.15);box-sizing:border-box}
.fkp-server-info__row{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.fkp-server-info__label{font-size:11px;opacity:0.65;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;flex-shrink:0}
.fkp-server-info__value{font-family:monospace;font-size:12px;word-break:break-all;text-align:right}
.fkp-server-info__link-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.fkp-server-info__link{width:100% !important;max-width:100% !important;font-family:monospace;font-size:11px;padding:8px 10px;resize:none;min-height:54px;box-sizing:border-box;margin:0 !important;line-height:1.4;word-break:break-all;float:none !important;position:static !important;border-radius:0 !important;background-color:transparent !important}
.fkp-server-info__actions{display:flex;flex-wrap:wrap;gap:6px}
.fkp-server-info__button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:3px 10px !important;font-size:11px !important;height:auto !important;min-height:24px !important;float:none !important;position:static !important;margin:0 !important}

@media (max-width:640px){
.fkp-server-info{width:100%}
.fkp-server-info__body{flex-direction:column;align-items:center;gap:16px}
.fkp-server-info__qr{width:100%;max-width:180px}
.fkp-server-info__details{width:100%}
.fkp-server-info__value{text-align:left}
}
`,
    ),
  );
}

function renderRow(label, value) {
  return E("div", { class: "fkp-server-info__row" }, [
    E("span", { class: "fkp-server-info__label" }, label),
    E("span", { class: "fkp-server-info__value" }, value),
  ]);
}

function renderCopyButton(label, text) {
  const button = E(
    "button",
    {
      class: "btn cbi-button cbi-button-neutral fkp-server-info__button",
      type: "button",
      click: (ev) => {
        ev.preventDefault();
        util.copyText(text, (copied) =>
          main.showToast(
            copied ? _("Copied") : _("Failed to copy!"),
            copied ? "success" : "error",
          ),
        );
      },
    },
    [util.iconSvg("copy"), " ", E("span", {}, label)],
  );

  return button;
}

function renderLinkBlock(label, link) {
  return E("div", { class: "fkp-server-info__link-block" }, [
    E("span", { class: "fkp-server-info__label" }, label),
    E(
      "textarea",
      {
        class: "cbi-input-textarea fkp-server-info__link",
        readonly: "readonly",
        rows: 3,
        click: (ev) => ev.currentTarget.select(),
      },
      link,
    ),
    E("div", { class: "fkp-server-info__actions" }, [
      renderCopyButton(_("Copy"), link),
    ]),
  ]);
}

function linkTitle(sectionId, index, total) {
  if (spec.getProtocol(sectionId) === "mixed") {
    return index === 0 ? _("SOCKS5 link") : _("HTTP link");
  }
  return total > 1 ? _("Link %d").format(index + 1) : _("Client link");
}

function renderWarnings(sectionId, context, clients) {
  const warnings = [];
  const protocol = spec.getProtocol(sectionId);

  if (!clients.length) {
    warnings.push(
      _("This server has no enabled clients, so nobody can connect."),
    );
  }
  if (
    protocol === "hysteria2" &&
    context.certificatePinExpected &&
    !context.tlsCertificateSha256
  ) {
    warnings.push(
      _(
        "Certificate pin is unavailable. Apply or restart the server to generate the default certificate, then open this dialog again.",
      ),
    );
  }
  if (isSelfSignedTls(sectionId) && protocol !== "hysteria2") {
    warnings.push(
      _(
        "The server uses a self-signed certificate, so the links disable certificate verification. Point the certificate path at a real certificate to remove that.",
      ),
    );
  }
  if (util.isPrivateOrReservedIp(getPublicHost(sectionId))) {
    warnings.push(
      _(
        "The public address is a private or reserved address, so these links only work from inside the local network.",
      ),
    );
  }

  return warnings.map((message) =>
    E("div", { class: "alert-message warning" }, message),
  );
}

function renderClientBody(sectionId, client, context) {
  const links = buildClientLinks(sectionId, client, context);
  const rows = [renderRow(_("Client"), clientLabel(sectionId, client))];

  clientCredentialRows(sectionId, client).forEach(([label, value]) =>
    rows.push(renderRow(label, value)),
  );

  const qrImage = links.length ? qr.qrSvgDataUri(links[0]) : "";

  return E("div", { class: "fkp-server-info__body" }, [
    E("div", { class: "fkp-server-info__qr" }, [
      qrImage
        ? E("img", {
            class: "fkp-server-info__qr-image",
            src: qrImage,
            alt: _("Client link QR code"),
          })
        : E(
            "em",
            {},
            links.length
              ? _("QR code is too large")
              : _("This protocol has no share link"),
          ),
    ]),
    E("div", { class: "fkp-server-info__details" }, [
      E("div", { class: "fkp-server-info__grid" }, rows),
      ...links.map((link, index) =>
        renderLinkBlock(linkTitle(sectionId, index, links.length), link),
      ),
    ]),
  ]);
}

function renderInfoContent(sectionId, clients, context) {
  const protocol = spec.getProtocol(sectionId);
  const security = spec.getEffectiveSecurity(sectionId);
  const securitySuffix =
    security && security !== "none" ? ` + ${spec.securityLabel(security)}` : "";
  const body = E("div", {});
  const tabs = E("div", { class: "fkp-server-info__tabs" });
  const allLinks = clients.flatMap((client) =>
    buildClientLinks(sectionId, client, context),
  );

  const select = (index) => {
    Array.from(tabs.children).forEach((node, position) =>
      node.classList.toggle("fkp-server-info__tab--active", position === index),
    );
    body.replaceChildren(renderClientBody(sectionId, clients[index], context));
  };

  clients.forEach((client, index) => {
    tabs.appendChild(
      E(
        "button",
        {
          class: "btn cbi-button cbi-button-neutral fkp-server-info__tab",
          type: "button",
          click: (ev) => {
            ev.preventDefault();
            select(index);
          },
        },
        clientLabel(sectionId, client),
      ),
    );
  });

  if (clients.length) {
    select(0);
  }

  return E("div", { class: "fkp-server-info" }, [
    E("div", { class: "fkp-server-info__header" }, [
      E(
        "span",
        { class: "fkp-server-info__title" },
        spec.getServerName(sectionId),
      ),
      E(
        "span",
        { class: "fkp-server-info__badge" },
        `${spec.protocolLabel(protocol)}${securitySuffix}`,
      ),
      E(
        "span",
        { class: "fkp-server-info__address" },
        `${getPublicHost(sectionId)}:${getListenPort(sectionId)}`,
      ),
    ]),
    ...renderWarnings(sectionId, context, clients),
    clients.length > 1 ? tabs : "",
    body,
    allLinks.length > 1
      ? E("div", { class: "fkp-server-info__actions" }, [
          renderCopyButton(_("Copy all links"), allLinks.join("\n")),
        ])
      : "",
  ]);
}

function showServerInfoModal(sectionId, clients) {
  injectStyles();

  const content = E("div", { class: "fkp-server-info" }, [
    E("em", {}, _("Loading client links...")),
  ]);

  ui.showModal(
    _("Connect to this server"),
    [
      content,
      E("div", { class: "button-row" }, [
        E(
          "button",
          {
            class: "btn cbi-button cbi-button-neutral",
            type: "button",
            click: () => ui.hideModal(),
          },
          _("Close"),
        ),
      ]),
    ],
    "cbi-modal",
  );

  return loadLinkContext(sectionId)
    .catch(() => ({ certificatePinExpected: false, tlsCertificateSha256: "" }))
    .then((context) => {
      const node = renderInfoContent(sectionId, clients, context);
      content.replaceWith(node);
    });
}

return baseclass.extend({
  buildClientLinks,
  showServerInfoModal,
});
