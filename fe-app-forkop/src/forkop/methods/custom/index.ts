import { getConfigSections } from './getConfigSections';
import {
  closeAllClashApiConnections,
  closeClashApiConnection,
  getClashApiConnections,
  getClashApiConnectionsSummary,
  getClashApiGroupLatency,
  getClashApiProxyExit,
  getClashApiProxyLink,
  getClashApiProxyLatency,
  getClashApiTailscale,
  pingClashApiTailscalePeer,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
  updateClashApiRuleProviders,
} from './clashApi';
import { getDashboardSections } from './getDashboardSections';

export const CustomForkopMethods = {
  getConfigSections,
  getDashboardSections,
  getClashApiConnections,
  getClashApiConnectionsSummary,
  getClashApiGroupLatency,
  getClashApiProxyExit,
  getClashApiProxyLink,
  getClashApiProxyLatency,
  getClashApiTailscale,
  pingClashApiTailscalePeer,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
  updateClashApiRuleProviders,
  closeClashApiConnection,
  closeAllClashApiConnections,
};
