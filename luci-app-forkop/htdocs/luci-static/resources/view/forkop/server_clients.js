"use strict";
"require uci";
"require baseclass";
"require view.forkop.main as main";
"require view.forkop.server_util as util";
"require view.forkop.server_spec as spec";
"require view.forkop.server_validate as validate";

// Server clients are the accounts a server accepts. sing-box takes a list of users
// on every protocol Forkop serves, so each client is its own UCI section and owns
// its own credentials, name and enabled flag. A server without clients accepts
// nobody, so the form keeps at least one.

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;
const CLIENT_TYPE = "server_client";
const CLIENT_FIELDS = ["uuid", "password", "secret", "flow", "authorized_keys"];
const MAX_CLIENT_NAME_LENGTH = 64;

function ownerOf(section) {
  return `${(section && section.server) || ""}`;
}

function clientSections(sectionId) {
  return (uci.sections(UCI_PACKAGE, CLIENT_TYPE) || []).filter(
    (section) => ownerOf(section) === `${sectionId}`,
  );
}

function readClient(section) {
  return {
    id: section[".name"],
    enabled: section.enabled !== "0",
    name: `${section.name || ""}`,
    uuid: `${section.uuid || ""}`,
    password: `${section.password || ""}`,
    secret: `${section.secret || ""}`,
    flow: `${section.flow || ""}`,
    authorized_keys: util.asList(section.authorized_keys),
  };
}

function listClients(sectionId) {
  return clientSections(sectionId).map(readClient);
}

function setClientOption(clientId, key, value) {
  if (
    value == null ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  ) {
    uci.unset(UCI_PACKAGE, clientId, key);
    return;
  }
  uci.set(UCI_PACKAGE, clientId, key, value);
}

function usedNames(sectionId, exceptClientId) {
  return new Set(
    clientSections(sectionId)
      .filter((section) => section[".name"] !== exceptClientId)
      .map((section) => `${section.name || ""}`.trim().toLowerCase()),
  );
}

// A fresh client name: the server label for the first client, then numbered names,
// transliterated when the protocol sends the name as an account name.
function nextClientName(sectionId, protocol) {
  const taken = usedNames(sectionId);
  const login = spec.usesLoginName(protocol);
  const base = login
    ? util.slugify(spec.getServerName(sectionId), "client")
    : spec.getServerName(sectionId);

  if (base && !taken.has(base.toLowerCase())) {
    return base;
  }

  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base || "client"}-${index}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `client-${Date.now()}`;
}

function validateClientName(sectionId, clientId, value) {
  const name = `${value || ""}`.trim();

  if (!name) {
    return _("Client name is required");
  }
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    return _("Client name must not exceed %d characters").format(
      MAX_CLIENT_NAME_LENGTH,
    );
  }
  if (usedNames(sectionId, clientId).has(name.toLowerCase())) {
    return _("Client names must be unique within a server");
  }

  const protocol = spec.getProtocol(sectionId);
  if (spec.usesLoginName(protocol)) {
    return /^[A-Za-z0-9._-]+$/.test(name)
      ? true
      : _(
          "This protocol sends the name as the account name: use letters, digits, dots, underscores or hyphens",
        );
  }

  return /[\u0000-\u001F\u007F]/.test(name)
    ? _("Value must not contain control characters")
    : true;
}

function validateClientField(sectionId, field, value) {
  if (field === "uuid") {
    return validate.validateUuid(sectionId, value);
  }
  if (field === "secret") {
    return validate.validateMtprotoSecret(sectionId, value);
  }
  if (field === "password") {
    return spec.getProtocol(sectionId) === "shadowsocks"
      ? validate.validateShadowsocksPassword(sectionId, value)
      : validate.validateRequiredText(sectionId, value);
  }
  if (field === "authorized_keys") {
    return validate.validateAuthorizedKeys(sectionId, value);
  }
  return true;
}

// Credentials the protocol needs and the client does not have yet. Fields the
// protocol no longer uses are dropped: a client link is invalid after a protocol
// change anyway, and stale credentials would keep showing up in diagnostics.
function syncClient(sectionId, clientId) {
  const protocol = spec.getProtocol(sectionId);
  const fields = spec.credentialFields(protocol);

  CLIENT_FIELDS.filter((field) => !fields.includes(field)).forEach((field) =>
    uci.unset(UCI_PACKAGE, clientId, field),
  );

  fields.forEach((field) => {
    if (field === "flow" || field === "authorized_keys") {
      return;
    }
    if (!uci.get(UCI_PACKAGE, clientId, field)) {
      setClientOption(
        clientId,
        field,
        spec.generateCredential(sectionId, protocol, field),
      );
    }
  });

  const name = `${uci.get(UCI_PACKAGE, clientId, "name") || ""}`.trim();
  if (spec.usesLoginName(protocol)) {
    const slug = util.slugify(name, "client");
    if (slug !== name) {
      setClientOption(clientId, "name", slug);
    }
  } else if (!name) {
    setClientOption(clientId, "name", nextClientName(sectionId, protocol));
  }
}

function addClient(sectionId, values = {}) {
  const protocol = spec.getProtocol(sectionId);
  const clientId = uci.add(UCI_PACKAGE, CLIENT_TYPE);

  uci.set(UCI_PACKAGE, clientId, "server", sectionId);
  uci.set(UCI_PACKAGE, clientId, "enabled", "1");
  setClientOption(
    clientId,
    "name",
    values.name || nextClientName(sectionId, protocol),
  );
  spec.credentialFields(protocol).forEach((field) => {
    const value =
      values[field] || spec.generateCredential(sectionId, protocol, field);
    setClientOption(clientId, field, value);
  });

  return clientId;
}

function removeClient(clientId) {
  uci.remove(UCI_PACKAGE, clientId);
}

// Every protocol that carries clients keeps at least one, and every client keeps the
// credentials the current protocol needs.
function syncClients(sectionId) {
  const protocol = spec.getProtocol(sectionId);
  const sections = clientSections(sectionId);

  if (!spec.usesClients(protocol)) {
    sections.forEach((section) => removeClient(section[".name"]));
    return;
  }

  if (!sections.length) {
    addClient(sectionId);
    return;
  }

  sections.forEach((section) => syncClient(sectionId, section[".name"]));
}

function enabledClients(sectionId) {
  return listClients(sectionId).filter((client) => client.enabled);
}

// Clients created, changed or removed while the modal was open, so cancelling the
// dialog leaves the stored configuration exactly as it was.
function captureEditState(sectionId) {
  const state = uci.state;
  if (!state) {
    return null;
  }

  return {
    sectionId,
    existing: clientSections(sectionId).map((section) => section[".name"]),
    changes: JSON.parse(
      JSON.stringify(
        clientSections(sectionId).reduce((result, section) => {
          const id = section[".name"];
          result[id] = state.changes?.[UCI_PACKAGE]?.[id] ?? null;
          return result;
        }, {}),
      ),
    ),
    deletes: Object.keys(state.deletes?.[UCI_PACKAGE] || {}).filter((id) =>
      isClientOf(id, sectionId, state),
    ),
  };
}

function isClientOf(clientId, sectionId, state) {
  const values = state?.values?.[UCI_PACKAGE]?.[clientId];
  return (
    !!values &&
    values[".type"] === CLIENT_TYPE &&
    `${values.server || ""}` === `${sectionId}`
  );
}

function restoreEditState(snapshot) {
  const state = uci.state;
  if (!snapshot || !state) {
    return;
  }

  const existing = new Set(snapshot.existing);

  clientSections(snapshot.sectionId).forEach((section) => {
    const id = section[".name"];
    if (!existing.has(id)) {
      uci.remove(UCI_PACKAGE, id);
    }
  });

  Object.entries(snapshot.changes || {}).forEach(([id, changes]) => {
    if (changes == null) {
      delete state.changes?.[UCI_PACKAGE]?.[id];
      return;
    }
    state.changes ??= {};
    state.changes[UCI_PACKAGE] ??= {};
    state.changes[UCI_PACKAGE][id] = JSON.parse(JSON.stringify(changes));
  });

  const keptDeletes = new Set(snapshot.deletes || []);
  Object.keys(state.deletes?.[UCI_PACKAGE] || {})
    .filter((id) => existing.has(id) && !keptDeletes.has(id))
    .forEach((id) => delete state.deletes[UCI_PACKAGE][id]);
  keptDeletes.forEach((id) => {
    state.deletes ??= {};
    state.deletes[UCI_PACKAGE] ??= {};
    state.deletes[UCI_PACKAGE][id] = true;
  });
}

return baseclass.extend({
  CLIENT_TYPE,
  addClient,
  captureEditState,
  clientSections,
  enabledClients,
  listClients,
  removeClient,
  restoreEditState,
  setClientOption,
  syncClients,
  validateClientField,
  validateClientName,
});
