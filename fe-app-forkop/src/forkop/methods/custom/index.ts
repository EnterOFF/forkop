import { getConfigSections } from './getConfigSections';
import {
  getClashApiGroupLatency,
  getClashApiProxyLatency,
  getDashboardSections,
  setClashApiGroupProxy,
} from './getDashboardSections';
import { getClashApiSecret } from './getClashApiSecret';

export const CustomForkopMethods = {
  getConfigSections,
  getDashboardSections,
  getClashApiGroupLatency,
  getClashApiProxyLatency,
  setClashApiGroupProxy,
  getClashApiSecret,
};
