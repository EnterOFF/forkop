import type { StoreType } from '../services/store.service';
import type { Forkop } from '../types';

export type UpdatesActionKey = keyof StoreType['updatesActions'];

const componentActionKeyMap: Record<string, UpdatesActionKey> = {
  'forkop:check_update': 'forkopCheck',
  'forkop:install': 'forkopInstall',
  'sing_box:check_update': 'singBoxCheck',
  'sing_box:install': 'singBoxInstall',
  'zapret:check_update': 'zapretCheck',
  'zapret:install': 'zapretInstall',
  'zapret:remove': 'zapretRemove',
  'zapret2:check_update': 'zapret2Check',
  'zapret2:install': 'zapret2Install',
  'zapret2:remove': 'zapret2Remove',
  'byedpi:check_update': 'byedpiCheck',
  'byedpi:install': 'byedpiInstall',
  'byedpi:remove': 'byedpiRemove',
};

export function getComponentActionKey(
  component: Forkop.ComponentName,
  action: Forkop.ComponentAction,
): UpdatesActionKey | undefined {
  return componentActionKeyMap[`${component}:${action}`];
}
