import { getConfigSections } from './getConfigSections';
import {
  getClashApiGroupLatency,
  getClashApiProxyLink,
  getClashApiProxyLatency,
  getDashboardSections,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
} from './getDashboardSections';
import { getClashApiSecret } from './getClashApiSecret';

export const CustomForkopMethods = {
  getConfigSections,
  getDashboardSections,
  getClashApiGroupLatency,
  getClashApiProxyLink,
  getClashApiProxyLatency,
  setClashApiGroupProxy,
  updateClashApiProxyProviders,
  getClashApiSecret,
};
