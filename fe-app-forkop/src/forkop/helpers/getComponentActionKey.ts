import type { StoreType } from '../services/store.service';
import type { Forkop } from '../types';

export type UpdatesActionKey = keyof StoreType['updatesActions'];

const componentActionKeyMap: Record<string, UpdatesActionKey> = {
  'forkop:check_update': 'forkopCheck',
  'forkop:install': 'forkopInstall',
  'sing_box:check_update': 'singBoxCheck',
  'sing_box:install': 'singBoxInstall',
};

export function getComponentActionKey(
  component: Forkop.ComponentName,
  action: Forkop.ComponentAction,
): UpdatesActionKey | undefined {
  return componentActionKeyMap[`${component}:${action}`];
}
