import {
  DIAGNOSTICS_CHECKS,
  DIAGNOSTICS_CHECKS_MAP,
} from './checks/contstants';
import { IDiagnosticsChecksStoreItem, StoreType } from '../../services';

export interface DiagnosticsCheckOptions {
  includeInbounds?: boolean;
}

function createDiagnosticCheck(
  code: DIAGNOSTICS_CHECKS,
  description: string,
): IDiagnosticsChecksStoreItem {
  const meta = DIAGNOSTICS_CHECKS_MAP[code];

  return {
    code,
    title: meta.title,
    order: meta.order,
    description,
    items: [],
    state: 'skipped',
  };
}

export function getDiagnosticsChecks(
  description: string,
  options: DiagnosticsCheckOptions = {},
): Array<IDiagnosticsChecksStoreItem> {
  const checks = [
    DIAGNOSTICS_CHECKS.DNS,
    DIAGNOSTICS_CHECKS.SINGBOX,
    DIAGNOSTICS_CHECKS.NFT,
    DIAGNOSTICS_CHECKS.OUTBOUNDS,
  ];

  if (options.includeInbounds === true) {
    checks.push(DIAGNOSTICS_CHECKS.INBOUNDS);
  }

  checks.push(DIAGNOSTICS_CHECKS.FAKEIP);

  return checks.map((code) => createDiagnosticCheck(code, description));
}

export function getLoadingDiagnosticsChecks(
  options: DiagnosticsCheckOptions = {},
): Pick<StoreType, 'diagnosticsChecks'> {
  return {
    diagnosticsChecks: getDiagnosticsChecks(_('Pending'), options),
  };
}

export const initialDiagnosticStore: Pick<
  StoreType,
  | 'diagnosticsChecks'
  | 'diagnosticsRunAction'
  | 'diagnosticsActions'
  | 'diagnosticsSystemInfo'
  | 'updatesActions'
  | 'updatesChecks'
> = {
  diagnosticsSystemInfo: {
    loading: true,
    loaded: false,
    capabilitiesLoaded: false,
    forkop_version: 'loading',
    forkop_latest_version: 'loading',
    luci_app_version: 'loading',
    sing_box_version: 'loading',
    sing_box_compressed: 0,
    server_inbounds_enabled_count: -1,
    openwrt_version: 'loading',
    device_model: 'loading',
  },
  diagnosticsActions: {
    restart: {
      loading: false,
    },
    start: {
      loading: false,
    },
    stop: {
      loading: false,
    },
    enable: {
      loading: false,
    },
    disable: {
      loading: false,
    },
    globalCheck: {
      loading: false,
    },
    showConfig: {
      loading: false,
    },
    showSingBoxConfig: {
      loading: false,
    },
  },
  diagnosticsRunAction: { loading: false },
  diagnosticsChecks: getDiagnosticsChecks(_('Not running')),
  updatesActions: {
    forkopCheck: { loading: false },
    forkopInstall: { loading: false },
    singBoxCheck: { loading: false },
    singBoxInstall: { loading: false },
  },
  updatesChecks: {
    forkop: { status: null, latest_version: '', release_url: '' },
    sing_box: { status: null, latest_version: '', release_url: '' },
  },
};
