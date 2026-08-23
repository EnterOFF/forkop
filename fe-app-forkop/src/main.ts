'use strict';
'require baseclass';
'require fs';
'require uci';
'require ui';

import './helpers/structuredClonePolyfill';

export { validateIP } from './validators/validateIp';
export { validateDomain } from './validators/validateDomain';
export { validateDNS } from './validators/validateDns';
export { validateUrl } from './validators/validateUrl';
export { validatePath } from './validators/validatePath';
export { validateSubnet } from './validators/validateSubnet';
export { bulkValidate } from './validators/bulkValidate';
export { validateOutboundJson } from './validators/validateOutboundJson';
export { validateProxyUrl } from './validators/validateProxyUrl';
export { analyzeStaticHosts } from './validators/validateStaticHosts';
export {
  parseWireGuardConfig,
  parseWireGuardInput,
  validateAmneziaSignature,
  validateWireGuardKey,
} from './helpers/parseWireGuardConfig';
export { generateAmneziaParameters } from './helpers/generateAmneziaParameters';
export { parseValueList } from './helpers/parseValueList';
export { getProxyUrlName } from './helpers/getProxyUrlName';
export { injectGlobalStyles } from './helpers/injectGlobalStyles';
export { showToast } from './helpers/showToast';
export { getClashUIUrl } from './helpers/getClashApiUrl';
export { getOutboundTagBySection } from './forkop/runtimeTags';
export { ForkopShellMethods } from './forkop/methods/shell';
export { coreService } from './forkop/services/core.service';
export { store } from './forkop/services/store.service';
export { applyUiStateToStore } from './forkop/services/uiState.service';
export { DashboardTab } from './forkop/tabs/dashboard';
export { DiagnosticTab } from './forkop/tabs/diagnostic';
export { MonitoringTab } from './forkop/tabs/monitoring';
export { LogsTab } from './forkop/tabs/logs';
export { UpdatesTab } from './forkop/tabs/updates';
export {
  DEFAULT_LATENCY_TEST_URL,
  DOMAIN_LIST_OPTIONS,
  LATENCY_TEST_URL_OPTIONS,
  FORKOP_ACTION_PROVIDERS_AVAILABILITY_EVENT,
  FORKOP_UCI_PACKAGE,
} from './constants';
