import type { StoreType } from './store.service';

type UpdatesActionKey = keyof StoreType['updatesActions'];
type ServiceActionKey = 'restart' | 'start' | 'stop';

const componentActions = new Set<UpdatesActionKey>();
const subscriptionSections = new Set<string>();
const serviceActions = new Set<ServiceActionKey>();

function setMembership<T>(set: Set<T>, value: T, active: boolean) {
  if (active) {
    set.add(value);
  } else {
    set.delete(value);
  }
}

export function setLocalComponentAction(
  action: UpdatesActionKey,
  active: boolean,
) {
  setMembership(componentActions, action, active);
}

export function setLocalSubscriptionAction(section: string, active: boolean) {
  if (section) {
    setMembership(subscriptionSections, section, active);
  }
}

export function setLocalServiceAction(
  action: keyof StoreType['diagnosticsActions'],
  active: boolean,
) {
  if (action === 'restart' || action === 'start' || action === 'stop') {
    setMembership(serviceActions, action, active);
  }
}

export function getLocalActionOverlay() {
  return {
    componentActions: new Set(componentActions),
    subscriptionSections: new Set(subscriptionSections),
    serviceActions: new Set(serviceActions),
  };
}

export function clearLocalActionOverlay() {
  componentActions.clear();
  subscriptionSections.clear();
  serviceActions.clear();
}
