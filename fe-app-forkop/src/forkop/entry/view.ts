import { FORKOP_UCI_PACKAGE } from '../../constants';
import { injectGlobalStyles } from '../../helpers/injectGlobalStyles';
import { coreService } from '../services/core.service';
import { loadCoreFeatures } from '../services/coreFeatures.service';
import { DashboardTab } from '../tabs/dashboard';
import { DiagnosticTab } from '../tabs/diagnostic';
import { LogsTab } from '../tabs/logs';
import { MonitoringTab } from '../tabs/monitoring';
import { mountTabOption } from '../tabs/mountTab';
import {
  configureSectionSection,
  createSectionContent,
} from '../tabs/sections';
import {
  configureServerSection,
  createServerContent,
  prepareAddedServer,
} from '../tabs/servers';
import { createSettingsContent } from '../tabs/settings';
import { UpdatesTab } from '../tabs/updates';
import { configureGridSection } from './gridSection';

// A tab that renders itself rather than declaring CBI options: one anonymous
// section holding the node its controller is bound to.
function addMountedTab(
  map: CBIMap,
  type: string,
  title: string,
  tab: { render: () => HTMLElement; initController: () => unknown },
) {
  const section = map.section(form.TypedSection, type, title);
  section.anonymous = true;
  section.addremove = false;
  section.cfgsections = function () {
    return [type];
  };
  mountTabOption(section, type, tab);
}

// The whole page: one uci map with a tab per section type. This is what
// view/forkop/forkop.js hands to LuCI.
export const ForkopView = {
  // The forms offer only what the installed core can run, so what it can do
  // is read before they are built: one call the state service answers from
  // memory.
  load() {
    return loadCoreFeatures().catch((error) => {
      console.warn('[CORE_FEATURES]', error);
    });
  },

  async render() {
    injectGlobalStyles();

    const forkopMap = new form.Map(FORKOP_UCI_PACKAGE, _('Forkop Settings'));
    forkopMap.tabbed = true;

    const rulesSection = forkopMap.section(
      form.GridSection,
      'section',
      _('Sections'),
      _('Routing rules are checked from top to bottom'),
    );
    configureGridSection(
      rulesSection,
      'section',
      _('Section'),
      _('Add a section'),
    );
    const renderRuleContents = rulesSection.renderContents;
    rulesSection.renderContents = function (...args: unknown[]) {
      const node = renderRuleContents.apply(this, args) as HTMLElement;
      const placeholder = node.querySelector?.('.placeholder em');
      if (placeholder) {
        placeholder.textContent = _('Add a section to configure routing');
      }
      return node;
    };
    configureSectionSection(rulesSection);
    createSectionContent(rulesSection);

    const serverSection = forkopMap.section(
      form.GridSection,
      'server',
      _('Servers'),
      _('The router itself becomes a proxy server for your devices'),
    );
    configureGridSection(
      serverSection,
      'server',
      _('Server'),
      _('Add a server inbound'),
      prepareAddedServer,
    );
    configureServerSection(serverSection);
    createServerContent(serverSection);

    const settingsSection = forkopMap.section(
      form.TypedSection,
      'settings',
      _('Settings'),
    );
    settingsSection.anonymous = true;
    settingsSection.addremove = false;
    settingsSection.cfgsections = function () {
      return ['settings'];
    };
    createSettingsContent(settingsSection);

    addMountedTab(forkopMap, 'diagnostic', _('Status'), DiagnosticTab);
    addMountedTab(forkopMap, 'dashboard', _('Dashboard'), DashboardTab);
    addMountedTab(forkopMap, 'monitoring', _('Monitoring'), MonitoringTab);
    addMountedTab(forkopMap, 'logs', _('Logs'), LogsTab);
    addMountedTab(forkopMap, 'updates', _('Components'), UpdatesTab);

    const rendered = await forkopMap.render();
    coreService();

    return rendered;
  },
};
