import { beforeEach, describe, expect, it } from 'vitest';
import { applyUiStateToStore } from '../uiState.service';
import { store } from '../store.service';
import { Forkop } from '../../types';
import {
  clearLocalActionOverlay,
  setLocalComponentAction,
  setLocalServiceAction,
  setLocalSubscriptionAction,
} from '../localActionOverlay.service';

function createUiState(
  actions: Partial<Forkop.UiState['actions']> = {},
  capabilities: Partial<Forkop.UiState['capabilities']> = {},
  forkop: Partial<Forkop.GetStatus> = {},
): Forkop.UiState {
  return {
    service: {
      forkop: {
        running: 0,
        enabled: 1,
        status: 'stopped but enabled',
        busy: 'start',
        dns_configured: 0,
        ...forkop,
      },
      sing_box: {
        running: 0,
        enabled: 1,
        status: 'stopped but enabled',
      },
    },
    capabilities: {
      zapret_installed: 1,
      zapret2_installed: 0,
      byedpi_installed: 1,
      server_inbounds_enabled_count: 0,
      ...capabilities,
    },
    actions: {
      service: [],
      component: [],
      ...actions,
    },
  };
}

describe('applyUiStateToStore', () => {
  beforeEach(() => {
    clearLocalActionOverlay();
    store.reset();
  });

  it('applies service, capability, and running action state before first render', () => {
    applyUiStateToStore(
      createUiState({
        service: [
          {
            success: true,
            running: true,
            kind: 'service',
            action: 'start',
            job_id: 'service-1',
          },
        ],
        component: [
          {
            success: true,
            running: true,
            job_id: 'component-1',
            component: 'zapret',
            action: 'install',
            message: 'Install is running',
            current_version: '',
            latest_version: '',
            changed: false,
          },
        ],
      }),
    );

    const state = store.get();

    expect(state.servicesInfoWidget).toMatchObject({
      loading: false,
      failed: false,
      data: {
        forkopEnabled: 1,
        forkopRunning: 0,
        forkopStatus: 'stopped but enabled',
        forkopBusy: 'start',
      },
    });
    expect(state.diagnosticsSystemInfo).toMatchObject({
      providerInfoLoaded: true,
      zapret_installed: 1,
      zapret2_installed: 0,
      byedpi_installed: 1,
      server_inbounds_enabled_count: 0,
    });
    expect(state.diagnosticsActions.start.loading).toBe(false);
    expect(state.sectionsWidget.subscriptionUpdatingSections).toEqual({});
    expect(state.updatesActions.zapretInstall.loading).toBe(true);
  });

  it('clears finished persisted action flags while preserving local enable actions', () => {
    store.set({
      diagnosticsActions: {
        ...store.get().diagnosticsActions,
        start: { loading: true },
        enable: { loading: true },
      },
      sectionsWidget: {
        ...store.get().sectionsWidget,
        subscriptionUpdatingSections: { main: true },
      },
      updatesActions: {
        ...store.get().updatesActions,
        zapretInstall: { loading: true },
      },
    });

    applyUiStateToStore(createUiState());

    const state = store.get();

    expect(state.diagnosticsActions.start.loading).toBe(false);
    expect(state.diagnosticsActions.enable.loading).toBe(true);
    expect(state.sectionsWidget.subscriptionUpdatingSections).toEqual({});
    expect(state.updatesActions.zapretInstall.loading).toBe(false);
  });

  it('keeps locally started actions loading until their owner clears them', () => {
    setLocalComponentAction('zapretInstall', true);
    setLocalSubscriptionAction('proxy', true);
    setLocalServiceAction('restart', true);

    applyUiStateToStore(createUiState());

    expect(store.get().updatesActions.zapretInstall.loading).toBe(true);
    expect(store.get().sectionsWidget.subscriptionUpdatingSections).toEqual({
      proxy: true,
    });
    expect(store.get().diagnosticsActions.restart.loading).toBe(true);

    clearLocalActionOverlay();
    applyUiStateToStore(createUiState());

    expect(store.get().updatesActions.zapretInstall.loading).toBe(false);
    expect(store.get().sectionsWidget.subscriptionUpdatingSections).toEqual({});
    expect(store.get().diagnosticsActions.restart.loading).toBe(false);
  });

  // The overlay only covers the click-to-report gap: once the runtime reports
  // the job, `busy` owns the operation and the local flag is handed over, so a
  // page that misses the completion cannot keep the row loading forever.
  it('hands a locally started service action over to the runtime report', () => {
    setLocalServiceAction('restart', true);

    applyUiStateToStore(
      createUiState(
        {
          service: [
            {
              success: true,
              running: true,
              kind: 'service',
              action: 'restart',
              job_id: 'service-1',
            },
          ],
        },
        {},
        { running: 1, status: 'running & enabled', busy: 'restart' },
      ),
    );
    // The runtime has the job now; the next application without it must not
    // resurrect the local flag.
    applyUiStateToStore(
      createUiState({}, {}, { running: 1, status: 'running & enabled' }),
    );

    expect(store.get().diagnosticsActions.restart.loading).toBe(false);
  });

  // Applying settings is not a restart: the service keeps running through it,
  // and the status has to keep saying so while `busy` carries the operation.
  it('reports an apply without claiming the service went down', () => {
    applyUiStateToStore(
      createUiState(
        {},
        {},
        {
          running: 1,
          status: 'running & enabled',
          busy: 'apply',
        },
      ),
    );

    const state = store.get();

    expect(state.servicesInfoWidget.data).toMatchObject({
      forkopRunning: 1,
      forkopStatus: 'running & enabled',
      forkopBusy: 'apply',
    });
    expect(state.diagnosticsActions.restart.loading).toBe(false);
  });

  it('carries no operation when the runtime reports none', () => {
    applyUiStateToStore(
      createUiState(
        {},
        {},
        { running: 1, status: 'running & enabled', busy: null },
      ),
    );

    expect(store.get().servicesInfoWidget.data.forkopBusy).toBeNull();
  });

  it('keeps current sing-box package info while an update is running', () => {
    store.set({
      diagnosticsSystemInfo: {
        ...store.get().diagnosticsSystemInfo,
        providerInfoLoaded: true,
        sing_box_version: '1.13.14-extended-2.5.2-forkop.1',
        sing_box_compressed: 1,
        zapret_installed: 0,
        zapret2_installed: 0,
        byedpi_installed: 1,
        server_inbounds_enabled_count: 0,
      },
    });

    applyUiStateToStore(
      createUiState(
        {
          component: [
            {
              success: true,
              running: true,
              job_id: 'sing-box-install',
              component: 'sing_box',
              action: 'install',
              message: 'Install is running',
              current_version: '',
              latest_version: '',
              changed: false,
            },
          ],
        },
        {
          zapret_installed: 1,
          zapret2_installed: 1,
          byedpi_installed: 0,
          server_inbounds_enabled_count: 2,
        },
      ),
    );

    expect(store.get().diagnosticsSystemInfo).toMatchObject({
      providerInfoLoaded: true,
      sing_box_version: '1.13.14-extended-2.5.2-forkop.1',
      sing_box_compressed: 1,
      zapret_installed: 1,
      zapret2_installed: 1,
      byedpi_installed: 0,
      server_inbounds_enabled_count: 2,
    });
    expect(store.get().updatesActions.singBoxInstall.loading).toBe(true);
  });

  it('marks the running sing-box install action without pretending it is installed', () => {
    applyUiStateToStore(
      createUiState({
        component: [
          {
            success: true,
            running: true,
            job_id: 'sing-box-install',
            component: 'sing_box',
            action: 'install',
            message: 'Install is running',
            current_version: '',
            latest_version: '',
            changed: false,
          },
        ],
      }),
    );

    expect(store.get().diagnosticsSystemInfo).toMatchObject({
      sing_box_compressed: 0,
    });
    expect(store.get().updatesActions.singBoxInstall.loading).toBe(true);
  });
});
