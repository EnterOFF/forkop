import { getConfigSections } from './getConfigSections';
import {
  closeAllClashApiConnections,
  closeClashApiConnection,
  getClashApiConnections,
  getClashApiConnectionsSummary,
  getClashApiGroupLatency,
  getClashApiProxyLink,
  getClashApiProxyLatency,
  getDashboardSections,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
  updateClashApiRuleProviders,
} from './getDashboardSections';
import { getClashApiSecret } from './getClashApiSecret';

export const CustomForkopMethods = {
  getConfigSections,
  getDashboardSections,
  getClashApiConnections,
  getClashApiConnectionsSummary,
  getClashApiGroupLatency,
  getClashApiProxyLink,
  getClashApiProxyLatency,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
  updateClashApiRuleProviders,
  closeClashApiConnection,
  closeAllClashApiConnections,
  getClashApiSecret,
};
