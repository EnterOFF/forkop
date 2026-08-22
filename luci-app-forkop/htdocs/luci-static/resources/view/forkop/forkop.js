"use strict";
"require view";
"require form";
"require baseclass";
"require uci";
"require ui";
"require dom";
"require view.forkop.main as main";

// Global settings
"require view.forkop.settings as settings";

// Sections
"require view.forkop.section as section";

// Server
"require view.forkop.server as server";

// Dashboard
"require view.forkop.dashboard as dashboard";

// Monitoring
"require view.forkop.monitoring as monitoring";

// Logs
"require view.forkop.logs as logs";

// Diagnostic
"require view.forkop.diagnostic as diagnostic";

// Updates
"require view.forkop.updates as updates";

const UCI_PACKAGE = main.FORKOP_UCI_PACKAGE;

function renderSectionAdd(sectionRef, extra_class) {
  const el = E("div", { class: "cbi-section-create" });
  const buttonTitle = sectionRef.titleFn("addbtntitle") || _("Add");
  const button = E(
    "button",
    {
      class: "cbi-button cbi-button-add",
      title: buttonTitle,
      click: ui.createHandlerFn(sectionRef, "handleAdd"),
      disabled: sectionRef.map.readonly || null,
    },
    [buttonTitle],
  );

  if (extra_class) {
    el.classList.add(extra_class);
  }

  el.appendChild(button);

  return el;
}

// A section id stays in the config for good, so it names the type it belongs to.
// LuCI's createSID() is not that name: its "new" prefix marks a section the browser
// has not saved yet, and handing it to add() as an explicit name writes that marker
// to /etc/config/forkop forever. Every section gets an id, including the children
// nothing points at, because an anonymous one can only be addressed as @type[index]:
// libuci numbers those by position across the whole file, so the address of a client
// moves when a client of another server is removed and a stored command then edits
// the wrong section. The suffix is random rather than the lowest free number, because
// a number given back after a delete would quietly rebind a stale pointer:
// dns_detour_section and the other section references are not cleared when their
// target is removed. Each view that creates a section carries this helper, because a
// name imported across two views is undefined in a browser that cached one of them
// before an app upgrade.
const SECTION_ID_PREFIXES = {
  fallback_group: "group",
  fallback_level: "level",
  section: "section",
  section_interface: "iface",
  server: "server",
  server_client: "client",
  subscription_url: "sub",
  tunnel: "tunnel",
  tunnel_peer: "peer",
  urltest: "urltest",
};
const issuedSectionIds = new Set();

function nextSectionId(typeName) {
  const prefix = SECTION_ID_PREFIXES[typeName] || typeName;

  for (let i = 0; i < 100; i += 1) {
    const id = `${prefix}_${Math.floor(Math.random() * 0x1000000)
      .toString(16)
      .padStart(6, "0")}`;

    // A staged child reaches uci only when its parent is saved, so an id handed out
    // earlier in the same dialog is not visible through uci.get() yet.
    if (!issuedSectionIds.has(id) && !uci.get(UCI_PACKAGE, id)) {
      issuedSectionIds.add(id);
      return id;
    }
  }

  return `${prefix}_${Date.now().toString(16)}`;
}

function addLabeledSection(sectionRef) {
  const configName = sectionRef.uciconfig || sectionRef.map.config;
  const prefix = sectionRef.sectiontype === "section" ? "Section" : "Server";
  const label = `${prefix} #${sectionRef.cfgsections().length + 1}`;
  const sectionId = sectionRef.map.data.add(
    configName,
    sectionRef.sectiontype,
    nextSectionId(sectionRef.sectiontype),
  );

  sectionRef.map.data.set(configName, sectionId, "label", label);
  return sectionId;
}

function getRuleEditButtonText() {
  const label = _("Edit rule action");

  return label === "Edit rule action" ? "Edit" : label;
}

function configureGridSection(sectionRef, type, title, addTitle) {
  sectionRef.anonymous = false;
  sectionRef.addremove = true;
  sectionRef.sortable = true;
  sectionRef.rowcolors = true;
  sectionRef.nodescriptions = true;
  sectionRef.modaltitle = function (section_id) {
    const label = uci.get(UCI_PACKAGE, section_id, "label");
    return section_id ? `${title}: ${label || section_id}` : addTitle;
  };
  sectionRef.sectiontitle = function (section_id) {
    return uci.get(UCI_PACKAGE, section_id, "label") || section_id;
  };
  sectionRef.renderSectionAdd = function (extra_class) {
    return renderSectionAdd(sectionRef, extra_class);
  };
  sectionRef.addLabeledSection = function () {
    return addLabeledSection(this);
  };
  sectionRef.handleAdd = function () {
    const sectionId = this.addLabeledSection();
    const mapNode = this.getPreviousModalMap();
    const prevMap = mapNode ? dom.findClassInstance(mapNode) : this.map;

    prevMap.addedSection = sectionId;
    return this.renderMoreOptionsModal(sectionId);
  };

  if (type === "section") {
    sectionRef.renderRowActions = function (section_id) {
      return form.TableSection.prototype.renderRowActions.call(
        this,
        section_id,
        getRuleEditButtonText(),
      );
    };
  }
}

const EntryPoint = {
  async render() {
    main.injectGlobalStyles();
    const uiCapabilities = {
      loaded: false,
      zapretInstalled: false,
      zapret2Installed: false,
      byedpiInstalled: false,
      serverInboundsEnabledCount: -1,
    };
    let uiCapabilitiesPromise = null;

    const applyUiCapabilities = function () {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(main.FORKOP_ACTION_PROVIDERS_AVAILABILITY_EVENT, {
            detail: {
              zapretInstalled: uiCapabilities.zapretInstalled,
              zapret2Installed: uiCapabilities.zapret2Installed,
              byedpiInstalled: uiCapabilities.byedpiInstalled,
            },
          }),
        );
      }

      if (main.store && typeof main.store.set === "function") {
        const currentSystemInfo = main.store.get().diagnosticsSystemInfo;
        main.store.set({
          diagnosticsSystemInfo: {
            ...currentSystemInfo,
            providerInfoLoaded: true,
            zapret_installed: uiCapabilities.zapretInstalled ? 1 : 0,
            zapret2_installed: uiCapabilities.zapret2Installed ? 1 : 0,
            byedpi_installed: uiCapabilities.byedpiInstalled ? 1 : 0,
            server_inbounds_enabled_count:
              uiCapabilities.serverInboundsEnabledCount,
            zapret_version: uiCapabilities.zapretInstalled
              ? currentSystemInfo.zapret_version
              : "not installed",
            zapret2_version: uiCapabilities.zapret2Installed
              ? currentSystemInfo.zapret2_version
              : "not installed",
            byedpi_version: uiCapabilities.byedpiInstalled
              ? currentSystemInfo.byedpi_version
              : "not installed",
          },
        });
      }
    };

    const updateUiCapabilities = function (data) {
      uiCapabilities.loaded = true;
      uiCapabilities.zapretInstalled = Boolean(
        Number(data?.zapret_installed) === 1,
      );
      uiCapabilities.zapret2Installed = Boolean(
        Number(data?.zapret2_installed) === 1,
      );
      uiCapabilities.byedpiInstalled = Boolean(
        Number(data?.byedpi_installed) === 1,
      );
      const serverInboundsEnabledCount =
        typeof data?.server_inbounds_enabled_count !== "undefined"
          ? Number(data.server_inbounds_enabled_count)
          : -1;
      uiCapabilities.serverInboundsEnabledCount = Number.isFinite(
        serverInboundsEnabledCount,
      )
        ? serverInboundsEnabledCount
        : -1;

      applyUiCapabilities();

      return uiCapabilities;
    };

    const loadUiCapabilities = function () {
      if (uiCapabilities.loaded) {
        return Promise.resolve(uiCapabilities);
      }

      if (uiCapabilitiesPromise) {
        return uiCapabilitiesPromise;
      }

      uiCapabilitiesPromise = main.ForkopShellMethods.getUiCapabilities()
        .then((response) => {
          if (!response?.success) {
            throw new Error("UI capabilities request failed");
          }

          return updateUiCapabilities(response.data);
        })
        .catch((error) => {
          // Nothing else can answer, so the tabs are told the providers are
          // absent rather than left waiting for an availability event.
          console.warn("Failed to load Forkop UI capabilities", error);
          return updateUiCapabilities({});
        })
        .finally(() => {
          uiCapabilitiesPromise = null;
        });

      return uiCapabilitiesPromise;
    };

    const forkopMap = new form.Map(
      UCI_PACKAGE,
      _("Forkop Settings"),
      _("Configuration for Forkop service"),
    );
    forkopMap.tabbed = true;
    const originalHandleSaveApply = forkopMap.handleSaveApply;
    forkopMap.handleSaveApply = function (ev, mode) {
      const refreshUiState = function () {
        main.ForkopShellMethods.getUiState()
          .then((response) => {
            if (
              response?.success &&
              typeof main.applyUiStateToStore === "function"
            ) {
              main.applyUiStateToStore(response.data);
            }
          })
          .catch(() => null);
      };

      if (main.store && typeof main.store.set === "function") {
        const servicesInfoWidget = main.store.get().servicesInfoWidget;
        main.store.set({
          servicesInfoWidget: {
            ...servicesInfoWidget,
            data: {
              ...servicesInfoWidget.data,
              forkopStatus: "reloading",
            },
          },
        });
      }

      return Promise.resolve(originalHandleSaveApply.call(this, ev, mode))
        .then((result) => {
          window.setTimeout(refreshUiState, 250);

          return result;
        })
        .catch((error) => {
          refreshUiState();

          throw error;
        });
    };

    const rulesSection = forkopMap.section(
      form.GridSection,
      "section",
      _("Sections"),
      _("Drag rows to change order. The rule at the top is checked first."),
    );
    configureGridSection(
      rulesSection,
      "section",
      _("Section"),
      _("Add a section"),
    );
    const renderRuleContents = rulesSection.renderContents;
    rulesSection.renderContents = function () {
      const node = renderRuleContents.apply(this, arguments);
      const placeholder = node.querySelector?.(".placeholder em");
      if (placeholder) {
        placeholder.textContent = _("Add a section to configure routing");
      }
      return node;
    };
    section.configureSectionSection(rulesSection, {
      loadActionProvidersAvailability: loadUiCapabilities,
    });
    section.createSectionContent(rulesSection);

    const serverSection = forkopMap.section(
      form.GridSection,
      "server",
      _("Servers"),
      _("Accept external proxy connections and route them with sing-box."),
    );
    configureGridSection(
      serverSection,
      "server",
      _("Server"),
      _("Add a server inbound"),
    );
    server.configureServerSection(serverSection);
    server.createServerContent(serverSection);

    const settingsSection = forkopMap.section(
      form.TypedSection,
      "settings",
      _("Settings"),
    );
    settingsSection.anonymous = true;
    settingsSection.addremove = false;
    settingsSection.cfgsections = function () {
      return ["settings"];
    };
    settings.createSettingsContent(settingsSection, uiCapabilities);

    const diagnosticSection = forkopMap.section(
      form.TypedSection,
      "diagnostic",
      _("Diagnostics"),
    );
    diagnosticSection.anonymous = true;
    diagnosticSection.addremove = false;
    diagnosticSection.cfgsections = function () {
      return ["diagnostic"];
    };
    diagnostic.createDiagnosticContent(diagnosticSection);

    const dashboardSection = forkopMap.section(
      form.TypedSection,
      "dashboard",
      _("Dashboard"),
    );
    dashboardSection.anonymous = true;
    dashboardSection.addremove = false;
    dashboardSection.cfgsections = function () {
      return ["dashboard"];
    };
    dashboard.createDashboardContent(dashboardSection);

    const monitoringSection = forkopMap.section(
      form.TypedSection,
      "monitoring",
      _("Monitoring"),
    );
    monitoringSection.anonymous = true;
    monitoringSection.addremove = false;
    monitoringSection.cfgsections = function () {
      return ["monitoring"];
    };
    monitoring.createMonitoringContent(monitoringSection);

    const logsSection = forkopMap.section(form.TypedSection, "logs", _("Logs"));
    logsSection.anonymous = true;
    logsSection.addremove = false;
    logsSection.cfgsections = function () {
      return ["logs"];
    };
    logs.createLogsContent(logsSection);

    const updatesSection = forkopMap.section(
      form.TypedSection,
      "updates",
      _("Components"),
    );
    updatesSection.anonymous = true;
    updatesSection.addremove = false;
    updatesSection.cfgsections = function () {
      return ["updates"];
    };
    updates.createUpdatesContent(updatesSection);

    await loadUiCapabilities().catch(() => null);

    const rendered = await forkopMap.render();
    main.coreService({
      waitForLogWatcherStart: loadUiCapabilities,
      logWatcherStartDelayMs: 5000,
    });

    return rendered;
  },
};

return view.extend(EntryPoint);
