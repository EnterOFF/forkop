import { beforeEach, describe, expect, it } from 'vitest';
import { applyUiStateToStore } from '../uiState.service';
import { store } from '../store.service';
import { Forkop } from '../../types';
import {
  clearLocalActionOverlay,
  setLocalComponentAction,
  setLocalLatencyAction,
  setLocalServiceAction,
  setLocalSubscriptionAction,
} from '../localActionOverlay.service';

function createUiState(
  actions: Partial<Forkop.UiState['actions']> = {},
  capabilities: Partial<Forkop.UiState['capabilities']> = {},
): Forkop.UiState {
  return {
    service: {
      forkop: {
        running: 0,
        enabled: 1,
        status: 'starting',
        dns_configured: 0,
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
      latency: [],
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
        latency: [
          {
            success: true,
            running: true,
            kind: 'latency',
            latency_type: 'group',
            section: 'main',
            tag: 'AUTO',
            job_id: 'latency-1',
            progress: {
              completed: 2,
              total: 5,
              failed: 1,
              pending: ['three', 'four', 'five'],
            },
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
        forkopStatus: 'starting',
      },
    });
    expect(state.diagnosticsSystemInfo).toMatchObject({
      providerInfoLoaded: true,
      zapret_installed: 1,
      zapret2_installed: 0,
      byedpi_installed: 1,
      server_inbounds_enabled_count: 0,
    });
    expect(state.diagnosticsActions.start.loading).toBe(true);
    expect(state.sectionsWidget.subscriptionUpdatingSections).toEqual({});
    expect(state.sectionsWidget.latencyFetchingSections).toEqual({
      main: true,
    });
    expect(state.sectionsWidget.latencyProgressSections).toEqual({
      main: {
        completed: 2,
        total: 5,
        failed: 1,
        pending: ['three', 'four', 'five'],
      },
    });
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
        latencyFetchingSections: { main: true },
        latencyProgressSections: {
          main: {
            completed: 1,
            total: 2,
            failed: 0,
          },
        },
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
    expect(state.sectionsWidget.latencyFetchingSections).toEqual({});
    expect(state.sectionsWidget.latencyProgressSections).toEqual({});
    expect(state.updatesActions.zapretInstall.loading).toBe(false);
  });

  it('keeps locally started actions loading until their owner clears them', () => {
    setLocalComponentAction('zapretInstall', true);
    setLocalSubscriptionAction('proxy', true);
    setLocalLatencyAction('gemini', true);
    setLocalServiceAction('restart', true);

    applyUiStateToStore(createUiState());

    expect(store.get().updatesActions.zapretInstall.loading).toBe(true);
    expect(store.get().sectionsWidget.subscriptionUpdatingSections).toEqual({
      proxy: true,
    });
    expect(store.get().sectionsWidget.latencyFetchingSections).toEqual({
      gemini: true,
    });
    expect(store.get().diagnosticsActions.restart.loading).toBe(true);

    clearLocalActionOverlay();
    applyUiStateToStore(createUiState());

    expect(store.get().updatesActions.zapretInstall.loading).toBe(false);
    expect(store.get().sectionsWidget.subscriptionUpdatingSections).toEqual({});
    expect(store.get().sectionsWidget.latencyFetchingSections).toEqual({});
    expect(store.get().diagnosticsActions.restart.loading).toBe(false);
  });

  it('preserves local latency progress while waiting for runtime progress', () => {
    setLocalLatencyAction('gemini', true);
    store.set({
      sectionsWidget: {
        ...store.get().sectionsWidget,
        latencyFetchingSections: { gemini: true },
        latencyProgressSections: {
          gemini: {
            completed: 0,
            total: 3,
            failed: 0,
          },
        },
      },
    });

    applyUiStateToStore(createUiState());

    expect(store.get().sectionsWidget.latencyFetchingSections).toEqual({
      gemini: true,
    });
    expect(store.get().sectionsWidget.latencyProgressSections).toEqual({
      gemini: {
        completed: 0,
        total: 3,
        failed: 0,
      },
    });
  });

  it('preserves latency progress for running runtime actions without progress', () => {
    store.set({
      sectionsWidget: {
        ...store.get().sectionsWidget,
        latencyFetchingSections: { main: true },
        latencyProgressSections: {
          main: {
            completed: 2,
            total: 5,
            failed: 0,
          },
        },
      },
    });

    applyUiStateToStore(
      createUiState({
        latency: [
          {
            success: true,
            running: true,
            kind: 'latency',
            latency_type: 'proxy_list',
            section: 'main',
            tag: '["one","two"]',
            job_id: 'latency-1',
          },
        ],
      }),
    );

    expect(store.get().sectionsWidget.latencyFetchingSections).toEqual({
      main: true,
    });
    expect(store.get().sectionsWidget.latencyProgressSections).toEqual({
      main: {
        completed: 2,
        total: 5,
        failed: 0,
      },
    });
  });

  it('applies bulk latency results with the matching progress state', () => {
    store.set({
      sectionsWidget: {
        ...store.get().sectionsWidget,
        data: [
          {
            withTagSelect: true,
            code: 'main',
            sectionName: 'main',
            displayName: 'Main',
            outbounds: [
              {
                code: 'proxy-a',
                displayName: 'Proxy A',
                latency: 100,
                type: 'VLESS',
                selected: false,
              },
              {
                code: 'auto',
                displayName: 'Auto',
                latency: 200,
                type: 'URLTest',
                selected: true,
                urlTestInfo: {
                  code: 'auto',
                  displayName: 'Auto',
                  outbounds: [
                    {
                      code: 'proxy-b',
                      displayName: 'Proxy B',
                      latency: 200,
                      type: 'Trojan',
                      selected: true,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    applyUiStateToStore(
      createUiState({
        latency: [
          {
            success: true,
            running: true,
            kind: 'latency',
            latency_type: 'proxy_list',
            section: 'main',
            tag: '["proxy-a","auto"]',
            job_id: 'latency-1',
            progress: {
              completed: 2,
              total: 2,
              failed: 0,
              pending: [],
              latencies: {
                'proxy-a': 321,
                'proxy-b': 456,
              },
            },
          },
        ],
      }),
    );

    const state = store.get().sectionsWidget;
    expect(state.latencyProgressSections.main.latencies).toEqual({
      'proxy-a': 321,
      'proxy-b': 456,
    });
    expect(state.data[0].outbounds[0].latency).toBe(321);
    expect(state.data[0].outbounds[1].latency).toBe(456);
    expect(state.data[0].outbounds[1].urlTestInfo?.outbounds[0].latency).toBe(
      456,
    );
  });

  it('maps a running reload action to the restart control', () => {
    applyUiStateToStore(
      createUiState({
        service: [
          {
            success: true,
            running: true,
            kind: 'service',
            action: 'reload',
            job_id: 'service-reload',
          },
        ],
      }),
    );

    expect(store.get().diagnosticsActions.restart.loading).toBe(true);
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
