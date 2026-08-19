"use strict";
"require form";
"require baseclass";
"require dom";
"require fs";
"require uci";
"require ui";
"require view.forkop.main as main";
"require view.forkop.server_util as util";
"require view.forkop.server_spec as spec";
"require view.forkop.server_validate as validate";
"require view.forkop.server_clients as clients";
"require view.forkop.server_link as link";

// The Servers tab: the LuCI form for one sing-box inbound per section. Protocol
// knowledge lives in server_spec, value checks in server_validate, accounts in
// server_clients and share links in server_link, so this file only wires them into
// form options and the grid.

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const STYLE_ID = "forkop-server-styles";
const ROUTING_SECTION_ACTIONS = [
  "connection",
  "proxy",
  "outbound",
  "vpn",
  "byedpi",
  "zapret",
  "zapret2",
];
const TAILSCALE_DETOUR_ACTIONS = ["connection", "proxy", "outbound", "vpn"];

function injectServerStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  document.head.appendChild(
    E(
      "style",
      { id: STYLE_ID },
      `
.fkp-server-icon-button{box-sizing:border-box;vertical-align:middle}
.fkp-server-icon-button__glyph{display:inline-flex;align-items:center}
.fkp-server-validation-summary{margin:0 0 12px}
#cbi-${UCI_PACKAGE}-server > h3:nth-child(1){display:none}
#cbi-${UCI_PACKAGE}-server > .cbi-section-remove{margin-bottom:-32px}
#cbi-${UCI_PACKAGE}-server .cbi-section-actions > div{display:inline-flex;align-items:center;gap:4px}
#cbi-${UCI_PACKAGE}-server .cbi-section-actions{text-align:right}

.fkp-protocol-summary{margin-top:6px}

.fkp-clients{display:flex;flex-direction:column;gap:8px;min-width:0}
.fkp-clients__item{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid var(--border-color,rgba(128,128,128,0.25));background:rgba(128,128,128,0.05);box-sizing:border-box}
.fkp-clients__item--disabled{opacity:0.6}
.fkp-clients__line{display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px}
.fkp-clients__field{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 180px}
.fkp-clients__field--name{flex:1 1 140px}
.fkp-clients__field > label{font-size:11px;opacity:0.65;text-transform:uppercase;letter-spacing:0.05em;font-weight:700}
.fkp-clients__field input,.fkp-clients__field select,.fkp-clients__field textarea{width:100% !important;max-width:100% !important;box-sizing:border-box;margin:0 !important;float:none !important}
.fkp-clients__field > div{display:flex;gap:4px;align-items:center;min-width:0}
.fkp-clients__field > div > input{min-width:0}
.fkp-clients__actions{display:flex;gap:4px;align-items:center;padding-bottom:2px}
.fkp-clients__actions .btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 8px !important;height:auto !important;min-height:26px !important;float:none !important;margin:0 !important}
.fkp-clients__toggle{display:flex;align-items:center;gap:6px;font-size:12px;padding-bottom:4px}
.fkp-clients__error{color:var(--danger-color,#c9302c);font-size:11px}
.fkp-clients__add{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;float:none !important;margin:0 !important}
.fkp-clients__hint{font-size:11px;opacity:0.7}
`,
    ),
  );
}

function getProtocol(sectionId) {
  return spec.getProtocol(sectionId);
}

function getWidget(sectionId, option) {
  return document.getElementById(
    `widget.cbid.${UCI_PACKAGE}.${sectionId}.${option}`,
  );
}

function getControlWidget(sectionId, option) {
  const widget = getWidget(sectionId, option);

  if (!widget) {
    return null;
  }

  if (/^(INPUT|SELECT|TEXTAREA)$/.test(widget.tagName)) {
    return widget;
  }

  return typeof widget.querySelector === "function"
    ? widget.querySelector("input:not([type='hidden']), select, textarea")
    : null;
}

function getSelectWidget(sectionId, option) {
  const widget = getControlWidget(sectionId, option);

  return widget && widget.tagName === "SELECT" ? widget : null;
}

function setWidgetValue(sectionId, option, value) {
  const widget = getControlWidget(sectionId, option);

  if (!widget) {
    uci.set(UCI_PACKAGE, sectionId, option, value);
    return;
  }

  widget.value = value;
  uci.set(UCI_PACKAGE, sectionId, option, value);
  widget.dispatchEvent(new Event("input", { bubbles: true }));
  widget.dispatchEvent(new Event("change", { bubbles: true }));
}

function isRoutingSectionAction(action) {
  return ROUTING_SECTION_ACTIONS.indexOf(`${action || ""}`) !== -1;
}

function loadRoutingSectionChoices(option) {
  const sections = option.map?.data?.state?.values?.[UCI_PACKAGE] ?? {};

  option.keylist = [];
  option.vallist = [];

  for (const sectionName in sections) {
    const section = sections[sectionName];

    if (
      section[".type"] === "section" &&
      section.enabled !== "0" &&
      isRoutingSectionAction(section.action)
    ) {
      option.keylist.push(sectionName);
      option.vallist.push(section.label || sectionName);
    }
  }

  return Promise.resolve();
}

function getTailscaleDetourTargetSections(currentSectionId) {
  return (uci.sections(UCI_PACKAGE, "section") || []).filter(
    (section) =>
      section[".name"] &&
      section[".name"] !== currentSectionId &&
      section.enabled !== "0" &&
      TAILSCALE_DETOUR_ACTIONS.includes(section.action || ""),
  );
}

function populateTailscaleDetourValues(option, currentSectionId) {
  option.keylist = [];
  option.vallist = [];
  getTailscaleDetourTargetSections(currentSectionId).forEach((section) => {
    option.value(section[".name"], section.label || section[".name"]);
  });
}

function loadServerTableOptions(sectionRef) {
  const sectionIds = sectionRef.cfgsections();
  const tasks = [];

  for (let i = 0; i < sectionIds.length; i += 1) {
    const sectionId = sectionIds[i];

    for (let j = 0; j < sectionRef.children.length; j += 1) {
      const option = sectionRef.children[j];

      if (option.disable || option.modalonly) {
        continue;
      }

      tasks.push(
        Promise.resolve(option.load.call(option, sectionId)).then((value) => {
          option.cfgvalue(sectionId, value);
        }),
      );
    }
  }

  return Promise.all(tasks);
}

function renderSecurityChoices(select, protocol, selectedSecurity) {
  select.replaceChildren(
    ...spec.securitiesFor(protocol).map((security) =>
      E(
        "option",
        {
          value: security,
          selected: security === selectedSecurity ? "" : null,
        },
        spec.securityLabel(security),
      ),
    ),
  );
}

// The security list depends on the protocol, and LuCI cannot express that with
// depends(), so the choices are rebuilt whenever the protocol changes.
function syncSecurityChoices(sectionId) {
  const protocol = getProtocol(sectionId);
  const select = getSelectWidget(sectionId, "security");
  const stored = uci.get(UCI_PACKAGE, sectionId, "security");
  const nextSecurity = spec.securitiesFor(protocol).includes(stored)
    ? stored
    : spec.defaultSecurity(protocol);

  if (select) {
    renderSecurityChoices(select, protocol, nextSecurity);
    if (
      Array.from(select.options).some((option) => option.value === nextSecurity)
    ) {
      select.value = nextSecurity;
    }
  }

  if (stored !== nextSecurity) {
    uci.set(UCI_PACKAGE, sectionId, "security", nextSecurity);
  }

  if (select) {
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function getModalNode() {
  return document.querySelector(
    "body.modal-overlay-active > #modal_overlay > .modal.cbi-modal",
  );
}

function clearServerValidationMessage() {
  const modal = getModalNode();

  if (modal) {
    modal
      .querySelectorAll(".fkp-server-validation-summary")
      .forEach((node) => node.remove());
  }
}

function showServerValidationMessage(error) {
  const modal = getModalNode();

  if (!modal) {
    return;
  }

  clearServerValidationMessage();

  const message = error?.message || "";
  const summary = E(
    "div",
    {
      class: "alert-message warning fkp-server-validation-summary",
    },
    [
      E("strong", {}, _("Cannot save server")),
      E("div", {}, _("Fix the highlighted fields and save again.")),
      message ? E("small", {}, message) : "",
    ],
  );
  const buttonRow = modal.querySelector(".button-row");
  modal.insertBefore(summary, buttonRow || modal.firstChild);

  const invalidNode = modal.querySelector(
    ".cbi-input-invalid, .fkp-clients__error:not(:empty)",
  );
  if (invalidNode) {
    invalidNode.scrollIntoView({ block: "center", behavior: "smooth" });
    if (typeof invalidNode.focus === "function") {
      invalidNode.focus({ preventScroll: true });
    }
  }
}

function hasRealityKeypair(sectionId) {
  return (
    !!uci.get(UCI_PACKAGE, sectionId, "reality_private_key") &&
    !!uci.get(UCI_PACKAGE, sectionId, "reality_public_key")
  );
}

function generateRealityKeypair(sectionId) {
  return fs
    .exec("/usr/bin/forkop", ["generate_reality_keypair"])
    .then((response) => {
      if ((response.code ?? 0) !== 0 || !response.stdout) {
        throw new Error(response.stderr || response.stdout || "");
      }

      const data = JSON.parse(response.stdout);
      if (!data.success || !data.private_key || !data.public_key) {
        throw new Error(data.message || "");
      }

      setWidgetValue(sectionId, "reality_private_key", data.private_key);
      setWidgetValue(sectionId, "reality_public_key", data.public_key);
    })
    .catch((error) => {
      console.warn(
        error?.message || "Failed to generate Reality key pair",
        error,
      );
    });
}

function generateRealityKeypairIfMissing(sectionId) {
  return hasRealityKeypair(sectionId)
    ? Promise.resolve()
    : generateRealityKeypair(sectionId);
}

function shouldGenerateRealityKeypair(sectionId) {
  return (
    getProtocol(sectionId) === "vless" &&
    spec.getEffectiveSecurity(sectionId) === "reality"
  );
}

function prepareServerModal(sectionId) {
  clients.syncClients(sectionId);

  return shouldGenerateRealityKeypair(sectionId)
    ? generateRealityKeypairIfMissing(sectionId)
    : Promise.resolve();
}

function configureServerTextareaOption(option) {
  const originalRenderWidget = option.renderWidget;

  option.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = originalRenderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    );
    const textarea =
      node && typeof node.querySelector === "function"
        ? node.querySelector("textarea")
        : node;

    if (textarea) {
      textarea.setAttribute("spellcheck", "false");
      textarea.setAttribute("autocomplete", "off");
      textarea.setAttribute("autocorrect", "off");
      textarea.setAttribute("autocapitalize", "off");
      textarea.setAttribute("data-gramm", "false");
      textarea.setAttribute("data-gramm_editor", "false");
      textarea.setAttribute("data-enable-grammarly", "false");
      textarea.style.resize = "vertical";
      textarea.style.maxWidth = "100%";
    }

    return node;
  };
}

// Adds a button that replaces a generated value with a fresh one. Rotating a secret
// in place is otherwise impossible without emptying the field first.
function addRegenerateButton(option, generate) {
  const originalRenderWidget = option.renderWidget;

  option.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = originalRenderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    );
    const label = _("Generate a new value");

    dom.append(
      node,
      E(
        "button",
        {
          class: "btn cbi-button cbi-button-neutral",
          type: "button",
          title: label,
          "aria-label": label,
          click: (ev) => {
            ev.preventDefault();
            setWidgetValue(sectionId, option.option, generate(sectionId));
          },
        },
        util.iconSvg("dice"),
      ),
    );

    return node;
  };
}

function addProtocolSummary(option) {
  const originalRenderWidget = option.renderWidget;

  option.renderWidget = function (sectionId, optionIndex, cfgvalue) {
    const node = originalRenderWidget.call(
      this,
      sectionId,
      optionIndex,
      cfgvalue,
    );
    const summary = E(
      "div",
      { class: "cbi-value-description fkp-protocol-summary" },
      spec.protocolSummary(getProtocol(sectionId)),
    );
    const select = node?.querySelector?.("select") || node;

    if (select && typeof select.addEventListener === "function") {
      select.addEventListener("change", () => {
        summary.textContent = spec.protocolSummary(select.value);
      });
    }

    dom.append(node, summary);

    return node;
  };
}

function renderClientCredentialInput(sectionId, client, field, onChange) {
  if (field === "flow") {
    const select = E(
      "select",
      { class: "cbi-input-select" },
      [
        ["", _("None")],
        ["xtls-rprx-vision", "xtls-rprx-vision"],
      ].map(([value, text]) =>
        E(
          "option",
          { value, selected: client.flow === value ? "" : null },
          text,
        ),
      ),
    );
    select.addEventListener("change", () => onChange(select.value));
    return { node: select, getValue: () => select.value };
  }

  if (field === "authorized_keys") {
    const textarea = E(
      "textarea",
      {
        class: "cbi-input-textarea",
        rows: 2,
        spellcheck: "false",
        placeholder: "ssh-ed25519 AAAA...",
      },
      client.authorized_keys.join("\n"),
    );
    const read = () =>
      textarea.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    textarea.addEventListener("change", () => onChange(read()));
    return { node: textarea, getValue: read };
  }

  const widget = new ui.Textfield(client[field] || "", {
    password: field === "password" || field === "secret",
  });
  const node = widget.render();
  node.addEventListener("widget-change", () => onChange(widget.getValue()));

  return { node, getValue: () => widget.getValue() };
}

function credentialFieldLabel(sectionId, field) {
  if (field === "uuid") {
    return _("UUID");
  }
  if (field === "password") {
    return getProtocol(sectionId) === "shadowsocks" &&
      spec.isShadowsocks2022(spec.getShadowsocksMethod(sectionId))
      ? _("Client pre-shared key")
      : _("Password");
  }
  if (field === "secret") {
    return _("Secret");
  }
  if (field === "flow") {
    return _("Flow");
  }
  return _("Authorized keys");
}

function renderClientItem(sectionId, client, state) {
  const protocol = getProtocol(sectionId);
  const fields = spec
    .credentialFields(protocol)
    .filter(
      (field) =>
        field !== "password" || spec.isAuthenticationEnabled(sectionId),
    );
  const item = E("div", { class: "fkp-clients__item" });
  const error = E("div", { class: "fkp-clients__error" });
  const readers = {};

  const refreshDisabled = () =>
    item.classList.toggle("fkp-clients__item--disabled", !client.enabled);

  const enabledInput = E("input", {
    type: "checkbox",
    checked: client.enabled ? "" : null,
  });
  enabledInput.addEventListener("change", () => {
    client.enabled = enabledInput.checked;
    uci.set(
      UCI_PACKAGE,
      client.id,
      "enabled",
      enabledInput.checked ? "1" : "0",
    );
    refreshDisabled();
  });

  const nameInput = E("input", {
    type: "text",
    class: "cbi-input-text",
    value: client.name,
    placeholder: spec.usesLoginName(protocol) ? _("Login") : _("Name"),
  });
  nameInput.addEventListener("change", () => {
    client.name = nameInput.value.trim();
    clients.setClientOption(client.id, "name", client.name);
    state.validate();
  });
  readers.name = () => nameInput.value.trim();

  const fieldNodes = fields.map((field) => {
    const control = renderClientCredentialInput(
      sectionId,
      client,
      field,
      (value) => {
        client[field] = value;
        clients.setClientOption(client.id, field, value);
        state.validate();
      },
    );
    readers[field] = control.getValue;

    return E(
      "div",
      { class: `fkp-clients__field fkp-clients__field--${field}` },
      [E("label", {}, credentialFieldLabel(sectionId, field)), control.node],
    );
  });

  const actions = [];
  const generated = fields.filter((field) =>
    ["uuid", "password", "secret"].includes(field),
  );
  if (generated.length) {
    const label = _("Generate new credentials");
    actions.push(
      E(
        "button",
        {
          class: "btn cbi-button cbi-button-neutral",
          type: "button",
          title: label,
          "aria-label": label,
          click: (ev) => {
            ev.preventDefault();
            generated.forEach((field) => {
              client[field] = spec.generateCredential(
                sectionId,
                protocol,
                field,
              );
              clients.setClientOption(client.id, field, client[field]);
            });
            state.rerender();
          },
        },
        util.iconSvg("dice"),
      ),
    );
  }

  const removeLabel = _("Remove client");
  actions.push(
    E(
      "button",
      {
        class: "btn cbi-button cbi-button-remove",
        type: "button",
        title: removeLabel,
        "aria-label": removeLabel,
        click: (ev) => {
          ev.preventDefault();
          clients.removeClient(client.id);
          state.rerender();
        },
      },
      util.iconSvg("trash"),
    ),
  );

  dom.append(item, [
    E("div", { class: "fkp-clients__line" }, [
      E("label", { class: "fkp-clients__toggle" }, [
        enabledInput,
        E("span", {}, _("Enabled")),
      ]),
      E("div", { class: "fkp-clients__field fkp-clients__field--name" }, [
        E(
          "label",
          {},
          spec.usesLoginName(protocol) ? _("Login") : _("Client name"),
        ),
        nameInput,
      ]),
      ...fieldNodes,
      E("div", { class: "fkp-clients__actions" }, actions),
    ]),
    error,
  ]);

  refreshDisabled();

  return { node: item, error, client, readers };
}

// Validates the visible rows and reports every problem inline. The option's parse()
// reuses the result so an invalid client blocks the save.
function validateClientItems(sectionId, items) {
  let firstError = "";

  items.forEach((item) => {
    const messages = [];
    const nameResult = clients.validateClientName(
      sectionId,
      item.client.id,
      item.readers.name(),
    );
    if (nameResult !== true) {
      messages.push(nameResult);
    }

    Object.keys(item.readers)
      .filter((field) => field !== "name")
      .forEach((field) => {
        const result = clients.validateClientField(
          sectionId,
          field,
          item.readers[field](),
        );
        if (result !== true) {
          messages.push(result);
        }
      });

    item.error.textContent = messages.join("; ");
    if (!firstError && messages.length) {
      firstError = `${item.client.name || item.client.id}: ${messages[0]}`;
    }
  });

  return firstError;
}

function renderClientsEditor(sectionId, option) {
  const container = E("div", { class: "fkp-clients" });
  const state = {};
  let items = [];

  state.validate = () => {
    option.clientError = validateClientItems(sectionId, items);
    return option.clientError;
  };

  state.rerender = () => {
    clients.syncClients(sectionId);
    items = clients
      .listClients(sectionId)
      .map((client) => renderClientItem(sectionId, client, state));

    const addLabel = _("Add client");
    container.replaceChildren(
      ...items.map((item) => item.node),
      E(
        "button",
        {
          class: "btn cbi-button cbi-button-add fkp-clients__add",
          type: "button",
          click: (ev) => {
            ev.preventDefault();
            clients.addClient(sectionId);
            state.rerender();
          },
        },
        [util.iconSvg("plus"), " ", E("span", {}, addLabel)],
      ),
      E(
        "div",
        { class: "fkp-clients__hint" },
        spec.usesLoginName(getProtocol(sectionId))
          ? _(
              "Each client is a separate account. Its name is the login the client sends.",
            )
          : _(
              "Each client is a separate account with its own credentials and its own link.",
            ),
      ),
    );

    state.validate();
  };

  state.rerender();

  return container;
}

function getServerEditButtonText() {
  const label = _("Edit rule action");

  return label === "Edit rule action" ? "Edit" : label;
}

function renderServerRowActions(sectionRef, sectionId) {
  const editLabel = getServerEditButtonText();
  const deleteLabel = _("Delete");
  const infoLabel = _("Connect to this server");
  const tdEl = E(
    "td",
    { class: "td cbi-section-table-cell nowrap cbi-section-actions" },
    E("div"),
  );
  const actionsEl = tdEl.lastElementChild;
  const actionButtons = [];

  if (spec.usesClients(getProtocol(sectionId))) {
    actionButtons.push(
      E(
        "button",
        {
          title: infoLabel,
          "aria-label": infoLabel,
          class: "cbi-button center fkp-server-icon-button",
          style: "display:inline-block;",
          click: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            link.showServerInfoModal(
              sectionId,
              clients.enabledClients(sectionId),
            );
          },
        },
        E(
          "span",
          { class: "fkp-server-icon-button__glyph" },
          util.iconSvg("qr"),
        ),
      ),
    );
  }

  dom.append(actionsEl, [
    ...actionButtons,
    E(
      "button",
      {
        title: editLabel,
        class: "btn cbi-button cbi-button-edit",
        click: ui.createHandlerFn(
          sectionRef,
          "renderMoreOptionsModal",
          sectionId,
        ),
      },
      editLabel,
    ),
  ]);

  if (sectionRef.addremove) {
    dom.append(
      actionsEl,
      E(
        "button",
        {
          title: deleteLabel,
          class: "btn cbi-button cbi-button-remove",
          click: ui.createHandlerFn(sectionRef, "handleRemove", sectionId),
          disabled: sectionRef.map.readonly || null,
        },
        deleteLabel,
      ),
    );
  }

  return tdEl;
}

function cloneUciState(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function isEmptyObject(value) {
  return value && Object.keys(value).length === 0;
}

function setUciSectionState(bucketName, sectionId, value) {
  const state = uci.state;

  if (!state) {
    return;
  }

  state[bucketName] ??= {};
  const bucket = state[bucketName];

  if (value == null) {
    delete bucket[UCI_PACKAGE]?.[sectionId];
    if (isEmptyObject(bucket[UCI_PACKAGE])) {
      delete bucket[UCI_PACKAGE];
    }
    return;
  }

  bucket[UCI_PACKAGE] ??= {};
  bucket[UCI_PACKAGE][sectionId] = cloneUciState(value);
}

function captureServerEditState(sectionId) {
  const state = uci.state;
  const clientState = clients.captureEditState(sectionId);

  if (!state || state.creates?.[UCI_PACKAGE]?.[sectionId]) {
    return { sectionId, clients: clientState };
  }

  return {
    sectionId,
    changes: cloneUciState(state.changes?.[UCI_PACKAGE]?.[sectionId]),
    deletes: cloneUciState(state.deletes?.[UCI_PACKAGE]?.[sectionId]),
    restoreSection: true,
    clients: clientState,
  };
}

function restoreServerEditState(snapshot) {
  if (!snapshot) {
    return;
  }

  clients.restoreEditState(snapshot.clients);

  if (!snapshot.restoreSection) {
    return;
  }

  setUciSectionState("changes", snapshot.sectionId, snapshot.changes);
  setUciSectionState("deletes", snapshot.sectionId, snapshot.deletes);
}

function removeServerClients(sectionId) {
  clients
    .clientSections(sectionId)
    .forEach((section) => clients.removeClient(section[".name"]));
}

function configureServerSection(sectionRef) {
  sectionRef.sortable = false;
  sectionRef.nodescriptions = true;
  sectionRef.load = function () {
    // The main page table renders only non-modal fields; full server defaults
    // are loaded by LuCI's cloned modal map when the user opens Add/Edit.
    return loadServerTableOptions(this);
  };

  sectionRef.renderMoreOptionsModal = function (sectionId, ev) {
    this.serverEditSnapshots ??= {};
    this.serverEditSnapshots[sectionId] = captureServerEditState(sectionId);

    return prepareServerModal(sectionId).then(() =>
      form.GridSection.prototype.renderMoreOptionsModal.call(
        this,
        sectionId,
        ev,
      ),
    );
  };

  sectionRef.handleAdd = function () {
    const sectionId = this.addLabeledSection();
    const mapNode = this.getPreviousModalMap();
    const prevMap = mapNode ? dom.findClassInstance(mapNode) : this.map;

    prevMap.addedSection = sectionId;
    spec.applyProtocolDefaults(sectionId, spec.DEFAULT_PROTOCOL, true);

    validate
      .loadDefaultPublicHost()
      .then((host) => validate.applyDefaultPublicHost(sectionId, host))
      .catch(() => null);

    return this.renderMoreOptionsModal(sectionId);
  };

  // Removing a server has to take its clients with it, otherwise they stay behind
  // as sections pointing at a server that no longer exists.
  sectionRef.handleRemove = function (sectionId, ev) {
    removeServerClients(sectionId);

    return form.GridSection.prototype.handleRemove.call(this, sectionId, ev);
  };

  sectionRef.handleModalCancel = function (modalMap, ev, isSaving) {
    const sectionId = modalMap?.section;
    const snapshot = sectionId ? this.serverEditSnapshots?.[sectionId] : null;

    if (sectionId && this.serverEditSnapshots) {
      delete this.serverEditSnapshots[sectionId];
    }

    if (!isSaving) {
      restoreServerEditState(snapshot);
    }

    return form.GridSection.prototype.handleModalCancel.call(
      this,
      modalMap,
      ev,
      isSaving,
    );
  };

  sectionRef.handleModalSave = function (modalMap, ev) {
    clearServerValidationMessage();

    const mapNode = this.getActiveModalMap();
    const activeMap = dom.findClassInstance(mapNode);

    return activeMap
      .parse()
      .then(() =>
        form.GridSection.prototype.handleModalSave.call(this, modalMap, ev),
      )
      .catch((error) => showServerValidationMessage(error));
  };

  sectionRef.renderRowActions = function (sectionId) {
    return renderServerRowActions(this, sectionId);
  };
}

function addIdentityOptions(section) {
  let o = section.option(form.Flag, "enabled", _("Enable"));
  o.default = "1";
  o.rmempty = false;
  o.editable = true;
  o.width = "6rem";

  o = section.option(form.DummyValue, "_protocol_display", _("Protocol"));
  o.modalonly = false;
  o.cfgvalue = function (sectionId) {
    return spec.protocolLabel(getProtocol(sectionId));
  };
  o.textvalue = function (sectionId) {
    return spec.protocolLabel(getProtocol(sectionId));
  };
  o.width = "9rem";

  o = section.option(form.DummyValue, "_endpoint_display", _("Address"));
  o.modalonly = false;
  o.textvalue = function (sectionId) {
    if (!spec.hasListener(getProtocol(sectionId))) {
      return "—";
    }
    const host = uci.get(UCI_PACKAGE, sectionId, "public_host") || "";
    const port = uci.get(UCI_PACKAGE, sectionId, "listen_port") || "";
    return host && port ? `${host}:${port}` : "—";
  };
  o.cfgvalue = o.textvalue;
  o.width = "12rem";

  o = section.option(form.DummyValue, "_clients_display", _("Clients"));
  o.modalonly = false;
  o.textvalue = function (sectionId) {
    if (!spec.usesClients(getProtocol(sectionId))) {
      return "—";
    }
    const all = clients.listClients(sectionId);
    const enabled = all.filter((client) => client.enabled).length;
    return all.length === enabled ? `${enabled}` : `${enabled} / ${all.length}`;
  };
  o.cfgvalue = o.textvalue;
  o.width = "6rem";

  o = section.option(form.Value, "label", _("Server name"));
  o.modalonly = true;
  o.rmempty = false;
  o.validate = function (sectionId, value) {
    const required = validate.validateRequiredText(sectionId, value);
    if (required !== true) {
      return required;
    }
    const normalized = `${value}`.trim();
    if (normalized.includes("/")) {
      return _("Server name must not contain /");
    }
    if (spec.RESERVED_RUNTIME_TAGS.has(normalized)) {
      return _("This server name is reserved by Forkop");
    }
    return [
      ...(uci.sections(UCI_PACKAGE, "server") || []),
      ...(uci.sections(UCI_PACKAGE, "section") || []),
    ].some(
      (item) =>
        item[".name"] !== sectionId &&
        `${item.label || item[".name"] || ""}`.trim() === normalized,
    )
      ? _("Server name must be unique")
      : true;
  };

  o = section.option(form.ListValue, "protocol", _("Protocol"));
  spec
    .protocolIds()
    .forEach((protocol) => o.value(protocol, spec.protocolLabel(protocol)));
  o.default = spec.DEFAULT_PROTOCOL;
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequired;
  o.onchange = function (_ev, sectionId, value) {
    spec.applyProtocolDefaults(sectionId, value, true);
    clients.syncClients(sectionId);
    syncSecurityChoices(sectionId);
    if (
      value === "vless" &&
      spec.getEffectiveSecurity(sectionId) === "reality"
    ) {
      generateRealityKeypairIfMissing(sectionId);
    }
  };
  addProtocolSummary(o);
}

function addTailscaleOptions(section) {
  const dependsOnTailscale = (option) =>
    option.depends("protocol", "tailscale");

  let o = section.option(
    form.Value,
    "tailscale_auth_key",
    _("Tailscale auth key"),
    _("Auth Key from the Tailscale admin console"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validate.validateRequired;
  dependsOnTailscale(o);

  o = section.option(
    form.Value,
    "tailscale_control_url",
    _("Tailscale control URL"),
    _(
      "Address of the coordination server. Change it if you use a custom server.",
    ),
  );
  o.default = "https://controlplane.tailscale.com";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateHttpUrl;
  dependsOnTailscale(o);

  o = section.option(
    form.Flag,
    "tailscale_detour_enabled",
    _("Control plane through section"),
    _("Connect to the coordination server through a section"),
  );
  o.default = "0";
  o.modalonly = true;
  o.rmempty = false;
  dependsOnTailscale(o);

  o = section.option(
    form.ListValue,
    "tailscale_detour_section",
    _("Control plane through"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.depends({ protocol: "tailscale", tailscale_detour_enabled: "1" });
  o.load = function (sectionId) {
    populateTailscaleDetourValues(this, sectionId);
    return uci.get(UCI_PACKAGE, sectionId, "tailscale_detour_section") || "";
  };
  o.validate = function (sectionId, value) {
    if (!value) {
      return _("Select a section");
    }
    if (value === sectionId) {
      return _("Current section cannot be used as its own transit section");
    }
    return getTailscaleDetourTargetSections(sectionId).some(
      (target) => target[".name"] === value,
    )
      ? true
      : _("Select a section");
  };

  o = section.option(
    form.Value,
    "tailscale_hostname",
    _("Tailscale hostname"),
    _(
      "Name shown in the Tailscale admin console. Renaming the server keeps it, because a new hostname registers a new machine.",
    ),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateTailscaleHostname;
  o.load = function (sectionId) {
    const current = uci.get(UCI_PACKAGE, sectionId, "tailscale_hostname");
    if (current) {
      return current;
    }
    const value = spec.defaultTailscaleHostname(sectionId);
    uci.set(UCI_PACKAGE, sectionId, "tailscale_hostname", value);
    return value;
  };
  dependsOnTailscale(o);

  o = section.option(
    form.Flag,
    "tailscale_advertise_exit_node",
    _("Advertise as exit node"),
    _(
      "Offer this router as an exit node so other devices can send all their traffic through it.",
    ),
  );
  o.default = "1";
  o.modalonly = true;
  o.rmempty = false;
  dependsOnTailscale(o);

  o = section.option(
    form.DynamicList,
    "tailscale_advertise_routes",
    _("Advertise routes"),
    _(
      "Specify local subnets to give other devices in your Tailscale network access to them.",
    ),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = (_sectionId, value) => validate.validateOptionalCidrOrIp(value);
  dependsOnTailscale(o);

  o = section.option(
    form.Flag,
    "tailscale_accept_routes",
    _("Accept routes"),
    _("Accept subnets advertised by other devices in your Tailscale network."),
  );
  o.default = "0";
  o.modalonly = true;
  o.rmempty = true;
  dependsOnTailscale(o);
}

function addJsonInboundOptions(section) {
  const o = section.option(
    form.TextValue,
    "inbound_json",
    _("Inbound JSON"),
    _(
      "A complete sing-box inbound object. Forkop sets the tag from the server name, so leave the tag out.",
    ),
  );
  o.depends("protocol", "json_inbound");
  o.rows = 10;
  o.wrap = "soft";
  o.textarea = true;
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateInboundJson;
  configureServerTextareaOption(o);
}

function addListenerOptions(section) {
  const dependsOnListener = (option) =>
    spec
      .protocolsWithListener()
      .forEach((protocol) => option.depends("protocol", protocol));

  let o = section.option(
    form.Value,
    "listen",
    _("Listen address"),
    _("Use 0.0.0.0 for every IPv4 address, or :: for every address."),
  );
  o.default = "0.0.0.0";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateListenAddress;
  dependsOnListener(o);

  o = section.option(form.Value, "listen_port", _("Listen port"));
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateListenPort;
  dependsOnListener(o);
  addRegenerateButton(o, () => util.randomPort());

  o = section.option(
    form.Value,
    "public_host",
    _("Public host"),
    _(
      "Address clients connect to. It only goes into the client links; the server still listens on the address above.",
    ),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateHost;
  dependsOnListener(o);
  o.load = function (sectionId) {
    return validate.loadDefaultPublicHost().then((host) => {
      validate.applyDefaultPublicHost(sectionId, host);
      return uci.get(UCI_PACKAGE, sectionId, "public_host") || host || "";
    });
  };
}

function addShadowsocksOptions(section) {
  let o = section.option(
    form.ListValue,
    "shadowsocks_method",
    _("Method"),
    _(
      "The 2022 methods add replay protection and use base64 keys; the older AEAD methods accept any password.",
    ),
  );
  spec.shadowsocksMethods().forEach((method) => o.value(method, method));
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequired;
  o.depends("protocol", "shadowsocks");
  o.onchange = function (_ev, sectionId, value) {
    const keyBytes = spec.shadowsocksKeyBytes(value);
    if (keyBytes > 0) {
      setWidgetValue(
        sectionId,
        "shadowsocks_psk",
        util.generatePresharedKey(keyBytes),
      );
    } else {
      uci.unset(UCI_PACKAGE, sectionId, "shadowsocks_psk");
    }
    // Client keys are method specific, so they are reissued with the method.
    clients.listClients(sectionId).forEach((client) => {
      clients.setClientOption(
        client.id,
        "password",
        spec.generateCredential(sectionId, "shadowsocks", "password"),
      );
    });
  };

  o = section.option(
    form.Value,
    "shadowsocks_psk",
    _("Server pre-shared key"),
    _("Shared by every client of a 2022 server, in addition to its own key."),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validate.validateShadowsocksPassword;
  spec
    .shadowsocksMethods()
    .filter((method) => spec.isShadowsocks2022(method))
    .forEach((method) =>
      o.depends({ protocol: "shadowsocks", shadowsocks_method: method }),
    );
  addRegenerateButton(o, (sectionId) =>
    util.generatePresharedKey(
      spec.shadowsocksKeyBytes(spec.getShadowsocksMethod(sectionId)) || 32,
    ),
  );
}

function addClientOptions(section) {
  let o = section.option(
    form.Flag,
    "mixed_auth_enabled",
    _("Require authentication"),
    _("Without authentication anyone who reaches the port can use the proxy."),
  );
  o.default = "1";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "mixed");

  o = section.option(form.DummyValue, "_clients", _("Clients"));
  o.modalonly = true;
  spec.protocolIds().forEach((protocol) => {
    if (spec.usesClients(protocol)) {
      o.depends("protocol", protocol);
    }
  });
  o.cfgvalue = function () {
    return "";
  };
  o.renderWidget = function (sectionId) {
    return renderClientsEditor(sectionId, this);
  };
  o.parse = function (sectionId) {
    if (!spec.usesClients(getProtocol(sectionId))) {
      return Promise.resolve();
    }

    if (!clients.enabledClients(sectionId).length) {
      return Promise.reject(
        new Error(_("Add at least one enabled client to this server")),
      );
    }

    return this.clientError
      ? Promise.reject(new Error(this.clientError))
      : Promise.resolve();
  };
}

function addRoutingOptions(section) {
  let o = section.option(
    form.ListValue,
    "routing_mode",
    _("Routing mode"),
    _(
      "What happens to the traffic clients send: the same rules the router uses, straight out through the WAN, or one chosen section.",
    ),
  );
  o.value("rules", _("Rules"));
  o.value("direct", _("Direct"));
  o.value("section", _("Selected section"));
  o.default = "rules";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequired;

  o = section.option(form.ListValue, "routing_section", _("Routing section"));
  o.depends("routing_mode", "section");
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateRequired;
  o.cfgvalue = function (sectionId) {
    return uci.get(UCI_PACKAGE, sectionId, "routing_section");
  };
  o.load = function () {
    return loadRoutingSectionChoices(this);
  };
}

function addSecurityOptions(section) {
  const streamProtocols = ["vless", "vmess", "trojan"];
  const tlsProtocols = ["hysteria2", "naive", "anytls", "tuic"];
  const addTlsDepends = (option) => {
    streamProtocols.forEach((protocol) =>
      option.depends({ protocol, security: "tls" }),
    );
    tlsProtocols.forEach((protocol) => option.depends("protocol", protocol));
  };
  const addRealityDepends = (option) =>
    option.depends({ protocol: "vless", security: "reality" });

  let o = section.option(form.ListValue, "security", _("Security"));
  o.value("reality", "Reality");
  o.value("tls", "TLS");
  o.value("none", _("None"));
  o.rmempty = false;
  o.modalonly = true;
  [...streamProtocols, ...tlsProtocols].forEach((protocol) =>
    o.depends("protocol", protocol),
  );
  o.validate = validate.validateSecurity;
  o.onchange = function (_ev, sectionId, value) {
    if (value === "reality") {
      generateRealityKeypairIfMissing(sectionId);
    }
  };
  {
    const originalRenderWidget = o.renderWidget;
    o.renderWidget = function (sectionId, optionIndex, cfgvalue) {
      const node = originalRenderWidget.call(
        this,
        sectionId,
        optionIndex,
        cfgvalue,
      );
      window.setTimeout(() => syncSecurityChoices(sectionId), 0);
      return node;
    };
  }

  o = section.option(
    form.Value,
    "tls_server_name",
    _("Server name / SNI"),
    _("The name the certificate is issued for, and the name clients send."),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateHost;
  o.load = function (sectionId) {
    const current = util.normalizeHost(
      uci.get(UCI_PACKAGE, sectionId, "tls_server_name"),
    );
    if (current) {
      return current;
    }

    const fallback = "www.microsoft.com";
    uci.set(UCI_PACKAGE, sectionId, "tls_server_name", fallback);
    return fallback;
  };
  addTlsDepends(o);
  addRealityDepends(o);

  o = section.option(
    form.MultiValue,
    "tls_alpn",
    _("ALPN"),
    _("Protocols offered during the TLS handshake. Leave empty for defaults."),
  );
  o.value("h3", "h3");
  o.value("h2", "h2");
  o.value("http/1.1", "http/1.1");
  o.create = false;
  o.rmempty = true;
  o.modalonly = true;
  addTlsDepends(o);
  addRealityDepends(o);

  o = section.option(
    form.Value,
    "tls_certificate_path",
    _("Certificate path"),
    _(
      "Forkop generates a self-signed certificate at the default path. Point this at a real certificate to let clients verify it.",
    ),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateTlsCertificatePath;
  o.load = function (sectionId) {
    const current = uci.get(UCI_PACKAGE, sectionId, "tls_certificate_path");
    if (current) {
      return current;
    }
    const value = spec.defaultTlsCertificatePath(sectionId);
    uci.set(UCI_PACKAGE, sectionId, "tls_certificate_path", value);
    return value;
  };
  addTlsDepends(o);

  o = section.option(form.Value, "tls_key_path", _("Key path"));
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateTlsKeyPath;
  o.load = function (sectionId) {
    const current = uci.get(UCI_PACKAGE, sectionId, "tls_key_path");
    if (current) {
      return current;
    }
    const value = spec.defaultTlsKeyPath(sectionId);
    uci.set(UCI_PACKAGE, sectionId, "tls_key_path", value);
    return value;
  };
  addTlsDepends(o);

  o = section.option(
    form.Value,
    "reality_handshake_server",
    _("Reality fake site"),
    _(
      "A real HTTPS site the router forwards unrecognised connections to. It has to be reachable from the router.",
    ),
  );
  o.default = "www.microsoft.com";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateHost;
  addRealityDepends(o);

  o = section.option(
    form.Value,
    "reality_handshake_server_port",
    _("Reality fake site port"),
  );
  o.default = "443";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validatePort;
  addRealityDepends(o);

  o = section.option(
    form.Value,
    "reality_private_key",
    _("Reality private key"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validate.validateRequired;
  addRealityDepends(o);

  o = section.option(
    form.Value,
    "reality_public_key",
    _("Reality public key"),
    _("Clients need this key. Forkop puts it into the client links."),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateRequired;
  addRealityDepends(o);
  {
    const originalRenderWidget = o.renderWidget;
    o.renderWidget = function (sectionId, optionIndex, cfgvalue) {
      const node = originalRenderWidget.call(
        this,
        sectionId,
        optionIndex,
        cfgvalue,
      );
      const label = _("Generate a new key pair");

      dom.append(
        node,
        E(
          "button",
          {
            class: "btn cbi-button cbi-button-neutral",
            type: "button",
            title: label,
            "aria-label": label,
            click: (ev) => {
              ev.preventDefault();
              generateRealityKeypair(sectionId);
            },
          },
          util.iconSvg("dice"),
        ),
      );

      return node;
    };
  }

  o = section.option(
    form.DynamicList,
    "reality_short_id",
    _("Reality short ID"),
    _(
      "An even number of hex digits, up to 16. Several IDs can be served at once; clients get the first one.",
    ),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateShortId;
  o.load = function (sectionId) {
    const current = util.asList(
      uci.get(UCI_PACKAGE, sectionId, "reality_short_id"),
    );
    if (current.length) {
      return current;
    }
    const value = util.randomHex(4);
    uci.set(UCI_PACKAGE, sectionId, "reality_short_id", [value]);
    return [value];
  };
  addRealityDepends(o);

  o = section.option(
    form.Value,
    "reality_max_time_difference",
    _("Reality max time difference"),
    _("How far a client clock may drift before the handshake is refused."),
  );
  o.default = "1m";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateRequiredDuration;
  addRealityDepends(o);

  o = section.option(
    form.ListValue,
    "client_fingerprint",
    _("Client fingerprint"),
    _("The TLS fingerprint clients are told to imitate."),
  );
  spec.clientFingerprints().forEach((value) => o.value(value, value));
  o.default = "chrome";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequired;
  addRealityDepends(o);
}

function addTransportOptions(section) {
  const streamProtocols = spec.protocolsWith("transport");
  const dependsOnTransport = (option, transport) =>
    streamProtocols.forEach((protocol) =>
      option.depends({ protocol, transport }),
    );

  let o = section.option(
    form.ListValue,
    "transport",
    _("Transport"),
    _("How the protocol is carried. Clients have to use the same transport."),
  );
  spec.transportChoices().forEach(([value, label]) => o.value(value, label));
  o.default = "tcp";
  o.rmempty = false;
  o.modalonly = true;
  streamProtocols.forEach((protocol) => o.depends("protocol", protocol));

  o = section.option(form.Value, "transport_path", _("Transport path"));
  o.modalonly = true;
  o.validate = validate.validateTransportPath;
  ["ws", "http", "httpupgrade", "xhttp"].forEach((transport) =>
    dependsOnTransport(o, transport),
  );

  o = section.option(form.Value, "transport_host", _("Transport host"));
  o.modalonly = true;
  o.validate = validate.validateOptionalHost;
  ["ws", "httpupgrade", "xhttp"].forEach((transport) =>
    dependsOnTransport(o, transport),
  );

  o = section.option(form.ListValue, "transport_xhttp_mode", _("XHTTP mode"));
  o.value("auto", "auto");
  o.value("packet-up", "packet-up");
  o.value("stream-up", "stream-up");
  o.value("stream-one", "stream-one");
  o.default = "auto";
  o.rmempty = false;
  o.modalonly = true;
  dependsOnTransport(o, "xhttp");

  o = section.option(form.DynamicList, "transport_hosts", _("HTTP hosts"));
  o.modalonly = true;
  o.validate = validate.validateOptionalHostList;
  dependsOnTransport(o, "http");

  o = section.option(form.Value, "transport_service_name", _("gRPC service"));
  o.modalonly = true;
  o.validate = validate.validateGrpcServiceName;
  dependsOnTransport(o, "grpc");
}

function addMultiplexOptions(section) {
  const multiplexProtocols = spec.protocolsWith("multiplex");

  let o = section.option(
    form.Flag,
    "multiplex_enabled",
    _("Accept multiplexing"),
    _(
      "Lets clients carry several streams over one connection. Clients that do not use it are unaffected.",
    ),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  multiplexProtocols.forEach((protocol) => o.depends("protocol", protocol));

  o = section.option(
    form.Flag,
    "multiplex_padding",
    _("Require multiplex padding"),
    _("Refuses multiplexed clients that do not pad their streams."),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  multiplexProtocols.forEach((protocol) =>
    o.depends({ protocol, multiplex_enabled: "1" }),
  );

  o = section.option(
    form.Flag,
    "multiplex_brutal_enabled",
    _("TCP Brutal"),
    _(
      "Congestion control with a fixed target rate. It needs the tcp-brutal kernel module on both sides.",
    ),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  multiplexProtocols.forEach((protocol) =>
    o.depends({ protocol, multiplex_enabled: "1" }),
  );

  ["up", "down"].forEach((direction) => {
    const option = section.option(
      form.Value,
      `multiplex_brutal_${direction}_mbps`,
      direction === "up"
        ? _("Brutal upload (Mbps)")
        : _("Brutal download (Mbps)"),
    );
    option.modalonly = true;
    option.rmempty = true;
    option.validate = validate.validateOptionalPositiveInteger;
    multiplexProtocols.forEach((protocol) =>
      option.depends({
        protocol,
        multiplex_enabled: "1",
        multiplex_brutal_enabled: "1",
      }),
    );
  });
}

function addHysteria2Options(section) {
  let o = section.option(
    form.ListValue,
    "hysteria2_obfs_type",
    _("Obfuscation"),
    _("Wraps the QUIC packets so they no longer look like QUIC."),
  );
  o.value("", _("None"));
  o.value("salamander", "salamander");
  o.default = "";
  o.modalonly = true;
  o.depends("protocol", "hysteria2");

  o = section.option(
    form.Value,
    "hysteria2_obfs_password",
    _("Obfuscation password"),
  );
  o.modalonly = true;
  o.rmempty = false;
  o.password = true;
  o.validate = validate.validateRequired;
  o.load = function (sectionId) {
    const current = uci.get(UCI_PACKAGE, sectionId, "hysteria2_obfs_password");
    if (current) {
      return current;
    }
    const value = util.generatePassword();
    uci.set(UCI_PACKAGE, sectionId, "hysteria2_obfs_password", value);
    return value;
  };
  o.depends({ protocol: "hysteria2", hysteria2_obfs_type: "salamander" });
  addRegenerateButton(o, () => util.generatePassword());

  o = section.option(
    form.Value,
    "hysteria2_up_mbps",
    _("Upload limit (Mbps)"),
    _(
      "Bandwidth the server offers each client. Leave both limits empty to let BBR decide.",
    ),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validate.validateOptionalPositiveInteger;
  o.depends("protocol", "hysteria2");

  o = section.option(
    form.Value,
    "hysteria2_down_mbps",
    _("Download limit (Mbps)"),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validate.validateOptionalPositiveInteger;
  o.depends("protocol", "hysteria2");

  o = section.option(
    form.Flag,
    "hysteria2_ignore_client_bandwidth",
    _("Ignore client bandwidth"),
    _("Refuses the rates a client asks for and uses BBR instead."),
  );
  o.default = "0";
  o.modalonly = true;
  o.rmempty = true;
  o.depends("protocol", "hysteria2");
}

function addProtocolOptions(section) {
  let o = section.option(
    form.ListValue,
    "naive_network",
    _("Network"),
    _("HTTP/2 runs over TCP, HTTP/3 over UDP."),
  );
  o.value("tcp", "TCP (HTTP/2)");
  o.value("udp", "UDP (HTTP/3)");
  o.value("tcp_udp", _("TCP and UDP"));
  o.default = "tcp";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "naive");

  o = section.option(
    form.ListValue,
    "naive_quic_congestion_control",
    _("QUIC congestion control"),
  );
  ["bbr", "bbr_standard", "bbr2", "bbr2_variant", "cubic", "reno"].forEach(
    (value) => o.value(value, value),
  );
  o.default = "bbr";
  o.rmempty = false;
  o.modalonly = true;
  o.depends({ protocol: "naive", naive_network: "udp" });
  o.depends({ protocol: "naive", naive_network: "tcp_udp" });

  o = section.option(
    form.DynamicList,
    "ssh_host_key_path",
    _("SSH host key path"),
    _(
      "Optional. Without a path, sing-box creates a temporary host key on start.",
    ),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validate.validateOptionalFilePath;
  o.depends("protocol", "ssh");

  o = section.option(form.ListValue, "mieru_transport", _("Transport"));
  o.value("TCP", "TCP");
  o.value("UDP", "UDP");
  o.default = "TCP";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "mieru");

  o = section.option(
    form.Flag,
    "mieru_user_hint_mandatory",
    _("Require Mieru user hint"),
    _(
      "Speeds up handshakes on a busy server, but only clients that send the hint can connect.",
    ),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  o.depends("protocol", "mieru");

  o = section.option(
    form.ListValue,
    "tuic_congestion_control",
    _("Congestion control"),
  );
  o.value("cubic", "cubic");
  o.value("new_reno", "new_reno");
  o.value("bbr", "bbr");
  o.default = "cubic";
  o.rmempty = false;
  o.modalonly = true;
  o.depends("protocol", "tuic");

  o = section.option(form.Value, "tuic_auth_timeout", _("Auth timeout"));
  o.default = "3s";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequiredDuration;
  o.depends("protocol", "tuic");

  o = section.option(form.Value, "tuic_heartbeat", _("Heartbeat"));
  o.default = "10s";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequiredDuration;
  o.depends("protocol", "tuic");

  o = section.option(
    form.Flag,
    "tuic_zero_rtt_handshake",
    _("Enable insecure 0-RTT handshake"),
    _("Saves one round trip and allows replay attacks in exchange."),
  );
  o.default = "0";
  o.rmempty = true;
  o.modalonly = true;
  o.depends("protocol", "tuic");
}

function addMtprotoOptions(section) {
  const dependsOnMtproto = (option) => option.depends("protocol", "mtproto");

  let o = section.option(
    form.Value,
    "mtproto_faketls",
    _("FakeTLS host"),
    _("The host name the proxy pretends to serve. It is part of the secret."),
  );
  o.default = "google.com";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateHost;
  dependsOnMtproto(o);

  o = section.option(
    form.Value,
    "mtproto_concurrency",
    _("Concurrency"),
    _("Maximum simultaneous connections. Empty means the sing-box default."),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validate.validateOptionalNonNegativeInteger;
  dependsOnMtproto(o);

  o = section.option(
    form.Value,
    "mtproto_domain_fronting_port",
    _("Fronting port"),
    _("Where unrecognised connections are forwarded, usually 443."),
  );
  o.default = "443";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validatePort;
  dependsOnMtproto(o);

  o = section.option(
    form.Value,
    "mtproto_domain_fronting_ip",
    _("Fronting IP"),
  );
  o.modalonly = true;
  o.rmempty = true;
  o.validate = validate.validateOptionalIp;
  dependsOnMtproto(o);

  o = section.option(
    form.Flag,
    "mtproto_domain_fronting_proxy_protocol",
    _("Fronting proxy protocol"),
  );
  o.default = "0";
  o.modalonly = true;
  o.rmempty = true;
  dependsOnMtproto(o);

  o = section.option(form.ListValue, "mtproto_prefer_ip", _("Preferred IP"));
  o.value("prefer-ipv4", "prefer-ipv4");
  o.value("prefer-ipv6", "prefer-ipv6");
  o.value("only-ipv4", "only-ipv4");
  o.value("only-ipv6", "only-ipv6");
  o.default = "prefer-ipv4";
  o.rmempty = false;
  o.modalonly = true;
  o.validate = validate.validateRequired;
  dependsOnMtproto(o);

  o = section.option(
    form.Flag,
    "mtproto_auto_update",
    _("Auto update"),
    _("Keeps the Telegram data centre list up to date by itself."),
  );
  o.default = "0";
  o.modalonly = true;
  o.rmempty = true;
  dependsOnMtproto(o);

  o = section.option(
    form.Flag,
    "mtproto_allow_fallback_on_unknown_dc",
    _("Fallback on unknown DC"),
  );
  o.default = "0";
  o.modalonly = true;
  o.rmempty = true;
  dependsOnMtproto(o);

  o = section.option(
    form.Value,
    "mtproto_tolerate_time_skewness",
    _("Time skew tolerance"),
  );
  o.default = "3s";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateRequiredDuration;
  dependsOnMtproto(o);

  o = section.option(form.Value, "mtproto_idle_timeout", _("Idle timeout"));
  o.default = "5m";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateRequiredDuration;
  dependsOnMtproto(o);

  o = section.option(
    form.Value,
    "mtproto_handshake_timeout",
    _("Handshake timeout"),
  );
  o.default = "10s";
  o.modalonly = true;
  o.rmempty = false;
  o.validate = validate.validateRequiredDuration;
  dependsOnMtproto(o);
}

function createServerContent(section) {
  injectServerStyles();

  addIdentityOptions(section);
  addTailscaleOptions(section);
  addJsonInboundOptions(section);
  addListenerOptions(section);
  addShadowsocksOptions(section);
  addClientOptions(section);
  addRoutingOptions(section);
  addSecurityOptions(section);
  addTransportOptions(section);
  addMultiplexOptions(section);
  addHysteria2Options(section);
  addProtocolOptions(section);
  addMtprotoOptions(section);
}

return baseclass.extend({
  configureServerSection,
  createServerContent,
  preloadServerModalData: validate.preloadServerModalData,
});
